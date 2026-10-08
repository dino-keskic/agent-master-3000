import fs from 'fs';
import { parseJsonc } from '../../shared/jsonc.js';
import { ModelPrice } from '../../shared/sessions/cost.js';
import { mergedConfigFilePaths } from '../setup/configLayers.js';
import { opencodeModelsPath } from '../setup/locations.js';
import { readDb } from './db.js';

export interface ModelInfo extends ModelPrice {
  provider: string;
  id: string;
  name?: string;
}

let cached: Map<string, ModelInfo> | null = null;
let cachedKey = '';

export function parseSessionModel(raw: unknown): { provider?: string; id?: string } {
  if (!raw) return {};
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        return parseSessionModel(JSON.parse(trimmed));
      } catch {
        // provider/id board model string
      }
    }
    const slash = trimmed.indexOf('/');
    if (slash > 0) return { provider: trimmed.slice(0, slash), id: trimmed.slice(slash + 1) };
    return { id: trimmed };
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : typeof obj.modelID === 'string' ? obj.modelID : undefined;
    const provider = typeof obj.providerID === 'string'
      ? obj.providerID
      : typeof obj.provider === 'string'
        ? obj.provider
        : undefined;
    return { provider, id };
  }
  return {};
}

/** A JSON object read off disk, or an empty one — every field still untrusted. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function parseModelCatalog(data: unknown): Map<string, ModelInfo> {
  const map = new Map<string, ModelInfo>();
  for (const [provider, entry] of Object.entries(asRecord(data))) {
    const models = asRecord(entry).models;
    if (!models || typeof models !== 'object') continue;
    for (const [id, raw] of Object.entries(asRecord(models))) {
      const model = asRecord(raw);
      const cost = asRecord(model.cost);
      const info: ModelInfo = {
        provider,
        id,
        name: typeof model.name === 'string' ? model.name : undefined,
        input: Number(cost.input) || 0,
        output: Number(cost.output) || 0,
        cacheRead: Number(cost.cache_read) || undefined,
        cacheWrite: Number(cost.cache_write) || undefined,
        contextLimit: Number(asRecord(model.limit).context) || undefined
      };
      map.set(`${provider}/${id}`, info);
      if (!map.has(id)) map.set(id, info);
    }
  }
  return map;
}

function fileMtime(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

/** OpenCode reads every config file as JSONC, `.json` too, so the board does. */
function readJsonObject(filePath: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  const parsed = parseJsonc(text);
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
}

/**
 * OpenCode's models.json is the provider catalog (often 1M windows).
 * `opencode.json` `provider.*.models.*.limit.context` is what the user
 * actually configured — that is the window the session is running against.
 */
function applyLimit(catalog: Map<string, ModelInfo>, provider: string, id: string, ctx: number): void {
  const existing = catalog.get(`${provider}/${id}`) || catalog.get(id);
  const overlaid: ModelInfo = {
    provider: existing?.provider || provider,
    id: existing?.id || id,
    name: existing?.name,
    input: existing?.input || 0,
    output: existing?.output || 0,
    cacheRead: existing?.cacheRead,
    cacheWrite: existing?.cacheWrite,
    contextLimit: ctx
  };
  catalog.set(`${provider}/${id}`, overlaid);
  catalog.set(id, overlaid);
}

export function overlayConfigLimits(
  catalog: Map<string, ModelInfo>,
  config: unknown
): Map<string, ModelInfo> {
  const providers = asRecord(config).provider;
  if (!providers || typeof providers !== 'object') return catalog;
  const providerLimits = new Map<string, Set<number>>();

  for (const [provider, entry] of Object.entries(asRecord(providers))) {
    const models = asRecord(entry).models;
    if (!models || typeof models !== 'object') continue;
    for (const [id, model] of Object.entries(asRecord(models))) {
      const ctx = Number(asRecord(asRecord(model).limit).context);
      if (!Number.isFinite(ctx) || ctx <= 0) continue;
      applyLimit(catalog, provider, id, ctx);
      const set = providerLimits.get(provider) || new Set<number>();
      set.add(ctx);
      providerLimits.set(provider, set);
    }
  }

  // Unknown models for a provider (not in the catalog, not listed in config)
  // still need a window — the one every listed sibling shares, if they agree.
  for (const [provider, limits] of providerLimits) {
    if (limits.size !== 1) continue;
    const ctx = [...limits][0]!;
    catalog.set(`${provider}/`, {
      provider,
      id: '',
      input: 0,
      output: 0,
      contextLimit: ctx
    });
  }
  return catalog;
}

export interface CachedCatalog {
  /** Changes whenever the catalog does, for the cache key. */
  stamp: string;
  read(): unknown;
}

/**
 * OpenCode 2 writes no `models.json`: it keeps the models.dev catalog in its
 * database, in `kv` under `models-dev:catalog:<hash of the URL>`, as
 * `{ updatedAt, digest, body }` with the same JSON as a string in `body`.
 * The newest one is the one it fetched last. Null on 1.x, which has no `kv`.
 */
export function catalogFromDb(): CachedCatalog | null {
  const db = readDb();
  if (!db) return null;
  let row: { value: string; time_updated: number } | undefined;
  try {
    row = db
      .prepare(`SELECT value, time_updated FROM kv WHERE key LIKE 'models-dev:catalog:%' ORDER BY time_updated DESC LIMIT 1`)
      .get() as typeof row;
  } catch {
    return null;
  }
  if (!row) return null;
  const { value } = row;
  return {
    stamp: `kv:${row.time_updated}`,
    read: () => {
      try {
        const body = asRecord(JSON.parse(value)).body;
        return typeof body === 'string' ? JSON.parse(body) : null;
      } catch {
        return null;
      }
    }
  };
}

/**
 * OpenCode's model list, with the context limits from every config file it
 * merges laid over it in the same order — so a limit set in the extra config
 * folder beats the global one, as it does for the agent, and a model a project
 * defines for itself has its limit too.
 *
 * The list is 1.x's `models.json`, or, when there is none, what 2.x cached in
 * its database.
 */
export function loadModelCatalog(
  catalogPath = opencodeModelsPath(),
  configPaths: readonly string[] = mergedConfigFilePaths(),
  fallback: () => CachedCatalog | null = catalogFromDb
): Map<string, ModelInfo> {
  const fromFile = fileMtime(catalogPath) > 0;
  const fromDb = fromFile ? null : fallback();
  const key = [
    fromDb ? fromDb.stamp : `${catalogPath}:${fileMtime(catalogPath)}`,
    ...configPaths.map((file) => `${file}:${fileMtime(file)}`)
  ].join('|');
  if (cached && cachedKey === key) return cached;

  const parsed = parseModelCatalog((fromDb ? fromDb.read() : readJsonObject(catalogPath)) || {});
  for (const file of configPaths) overlayConfigLimits(parsed, readJsonObject(file));
  cached = parsed;
  cachedKey = key;
  return cached;
}

export function lookupModelInfo(
  catalog: Map<string, ModelInfo>,
  provider?: string,
  modelId?: string
): ModelInfo | undefined {
  if (!modelId) return undefined;
  if (provider) {
    const exact = catalog.get(`${provider}/${modelId}`);
    if (exact) return exact;
  }
  const byId = catalog.get(modelId);
  if (byId) return byId;
  if (provider) {
    const fallback = catalog.get(`${provider}/`);
    if (fallback) return { ...fallback, id: modelId };
  }
  return undefined;
}

export function modelInfoForSession(rawModel: unknown, catalog = loadModelCatalog()): ModelInfo | undefined {
  const { provider, id } = parseSessionModel(rawModel);
  return lookupModelInfo(catalog, provider, id);
}
