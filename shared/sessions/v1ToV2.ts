/**
 * One OpenCode 1.x session's history, rewritten the way OpenCode 2 stores it.
 *
 * OpenCode 2 migrates a 1.x database once, on its first start, and remembers
 * that it did. A session it never reached — the migration stopped on a bad
 * row, or a 1.x install kept writing to the file afterwards — stays in the
 * frozen 1.x tables, where 2.x cannot load it. `server/opencode/migrateV1.ts`
 * copies such a session across when the board needs it to be resumable; this
 * is the translation it writes.
 *
 * It follows OpenCode 2.0's own converter rule for rule, so a session copied
 * here is the one OpenCode would have made: one row per prompt or answer, the
 * parts folded into the answer's `content`, compactions as a row of their own,
 * and a closing `system` row naming the tools that were renamed. Where
 * OpenCode's would throw on a malformed row (and stop its whole migration),
 * this skips the row or fills the gap instead.
 *
 * What belongs here: the shape of the translation. Reading and writing the
 * database is `migrateV1.ts`'s. It runs a little past 400 lines because it is
 * one converter, kept in the order OpenCode's is so the two can be compared.
 */

type Json = Record<string, any>;

export interface V1MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

export interface V1PartRow extends V1MessageRow {
  message_id: string;
}

/** A `session_message` row, `data` not yet serialised. */
export interface V2MessageRow {
  id: string;
  session_id: string;
  type: string;
  seq: number;
  time_created: number;
  time_updated: number;
  data: Json;
}

export interface V1Conversion {
  messages: V2MessageRow[];
  /** The `session_v2` columns the history decides. `model` is serialised. */
  session: {
    agent: string | null;
    model: string | null;
    cost: number;
    tokens_input: number;
    tokens_output: number;
    tokens_reasoning: number;
    tokens_cache_read: number;
    tokens_cache_write: number;
  };
  /** The session's `event_sequence` counter: the last `seq` written, -1 for none. */
  watermark: number;
  /** Rows left out, and why. */
  skipped: { reason: 'invalid-message' | 'invalid-part' | 'orphan-part'; id: string }[];
}

export interface V1Session {
  id: string;
  agent?: string | null;
  model?: string | null;
}

/** What OpenCode 2 renamed, and what it changed under the names it kept. */
const RENAMED_TOOLS: Record<string, string> = { bash: 'shell', task: 'subagent', apply_patch: 'patch' };
const TOOLS_TAKING_PATH = ['read', 'edit', 'write'];
const TOOLS_REMOVED = ['todowrite'];
const FINISH_REASONS = ['stop', 'length', 'tool-calls', 'content-filter', 'error', 'unknown'];

function parse(text: string): Json | undefined {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function tokensOf(message: Json) {
  const tokens = message.tokens ?? {};
  return {
    input: num(tokens.input),
    output: num(tokens.output),
    reasoning: num(tokens.reasoning),
    cache: { read: num(tokens.cache?.read), write: num(tokens.cache?.write) }
  };
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function fnv1a(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const ch of text) hash = ((hash ^ BigInt(ch.codePointAt(0)!)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash;
}

/**
 * An id for a row OpenCode 1 never had (the synthetic half of a prompt, the
 * closing `system` row), sorting right after the row it comes from: the first
 * 16 characters are that row's, which is its prefix and timestamp. OpenCode
 * hashes with SHA-256; any stable hash will do, the ids only have to be unique.
 */
function derivedId(from: string, taken: Set<string>): string {
  for (let attempt = 0; ; attempt++) {
    const seed = `v1-synthetic:${from}${attempt ? `:${attempt}` : ''}`;
    // Two 64-bit hashes: 14 base62 digits need more than one holds.
    let hash = (fnv1a(seed) << 64n) | fnv1a(`${seed}#`);
    let tail = '';
    while (tail.length < 14) {
      tail = BASE62[Number(hash % 62n)] + tail;
      hash /= 62n;
    }
    const id = from.slice(0, 16) + tail;
    if (taken.has(id)) continue;
    taken.add(id);
    return id;
  }
}

/** UTF-8 text as base64, without Node's `Buffer`. */
function base64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function row(source: V1MessageRow, type: string, data: Json, id = source.id): V2MessageRow {
  return { id, session_id: source.session_id, type, seq: 0, time_created: source.time_created, time_updated: source.time_updated, data };
}

/** A file attached by URL survives as a note; its bytes were never stored. */
function unavailableFile(part: Json): string {
  const name = part.filename ?? (part.source?.type === 'resource' ? part.source.uri : part.url);
  return `[Attachment unavailable after migration: ${name} (${part.mime})]`;
}

/** A file pasted in as a `data:` URL, as 2.x carries one inline. */
function inlineFile(part: Json): Json[] {
  const url = String(part.url ?? '');
  if (!url.startsWith('data:')) return [];
  const comma = url.indexOf(',');
  if (comma < 0) return [];
  const head = url.slice(0, comma);
  const body = url.slice(comma + 1);
  let data: string;
  try {
    data = head.endsWith(';base64') ? body : base64(decodeURIComponent(body));
  } catch {
    return [];
  }
  const text = part.source?.text;
  return [{
    data,
    mime: part.mime,
    source: part.source?.type === 'resource' ? { type: 'uri', uri: part.source.uri } : { type: 'inline' },
    ...(part.filename ? { name: part.filename } : {}),
    ...(text ? { mention: { text: text.value, start: text.start, end: text.end } } : {})
  }];
}

function toolContent(part: Json, messageCreated: number): Json {
  const state = part.state ?? {};
  const base = { type: 'tool', id: part.callID, name: part.tool, ...(part.metadata ? { providerState: part.metadata } : {}) };
  const time = { created: state.time?.start ?? messageCreated, completed: state.time?.end ?? state.time?.start ?? messageCreated };
  if (state.status === 'completed') {
    const content = state.time?.compacted === undefined
      ? [
          { type: 'text', text: String(state.output ?? '') },
          ...(state.attachments ?? []).map((a: Json) => ({ type: 'file', uri: a.url, mime: a.mime, ...(a.filename ? { name: a.filename } : {}) }))
        ]
      : [{ type: 'text', text: '[Old tool result content cleared]' }];
    return { ...base, state: { status: 'completed', input: state.input, content, metadata: state.metadata }, time };
  }
  if (state.status === 'error') {
    return {
      ...base,
      state: {
        status: 'error',
        input: state.input,
        error: { type: 'tool.execution', message: state.error },
        ...(typeof state.metadata?.output === 'string' ? { content: [{ type: 'text', text: state.metadata.output }] } : {}),
        ...(state.metadata ? { metadata: state.metadata } : {})
      },
      time
    };
  }
  return {
    ...base,
    state: {
      status: 'error',
      input: state.input,
      error: { type: 'tool.interrupted', message: 'Tool execution was interrupted before V2 migration' },
      ...(state.status === 'running' && state.metadata ? { metadata: state.metadata } : {})
    },
    time: { created: state.status === 'running' ? (state.time?.start ?? messageCreated) : messageCreated }
  };
}

function errorOf(error: Json): Json {
  const name = error.name;
  const message = error.data && 'message' in error.data
    ? error.data.message
    : name === 'MessageOutputLengthError' ? 'The model exceeded its output limit' : name;
  const type = name === 'ProviderAuthError' ? 'provider.auth'
    : name === 'ContentFilterError' ? 'provider.content-filter'
    : name === 'ContextOverflowError' ? 'provider.invalid-request'
    : name === 'StructuredOutputError' || name === 'MessageOutputLengthError' ? 'provider.invalid-output'
    : name === 'MessageAbortedError' ? 'aborted'
    : name === 'APIError' ? 'provider.error'
    : 'unknown';
  return { type, message };
}

/** The note 2.x leaves at the end of a migrated session, if its tools moved under it. */
function toolChangeNotice(rows: V2MessageRow[]): string | undefined {
  const lastCompaction = rows.map((r) => r.type).lastIndexOf('compaction');
  const used = new Set(rows.slice(lastCompaction + 1).flatMap((r) =>
    r.type === 'assistant' && Array.isArray(r.data.content)
      ? r.data.content.flatMap((c: Json) => (c.type === 'tool' && typeof c.name === 'string' ? [c.name] : []))
      : []));
  const list = (names: string[]) => names.map((n) => `\`${n}\``).join(', ');
  const renamed = Object.keys(RENAMED_TOOLS).filter((n) => used.has(n));
  const takingPath = TOOLS_TAKING_PATH.filter((n) => used.has(n));
  const removed = TOOLS_REMOVED.filter((n) => used.has(n));
  const lines = [
    ...(renamed.length === 1 ? [`The \`${renamed[0]}\` tool is now \`${RENAMED_TOOLS[renamed[0]!]}\` and must be called by that name.`]
      : renamed.length > 1 ? [`The following tools were renamed and must be called by their new names: ${renamed.map((n) => `\`${n}\` is now \`${RENAMED_TOOLS[n]}\``).join('; ')}.`]
      : []),
    ...(used.has('task') ? ['The `subagent` tool takes `agent` instead of `subagent_type` and `sessionID` instead of `task_id`.'] : []),
    ...(takingPath.length === 1 ? [`The \`${takingPath[0]}\` tool now takes \`path\` instead of \`filePath\`.`]
      : takingPath.length > 1 ? [`The following tools now take \`path\` instead of \`filePath\`: ${list(takingPath)}.`]
      : []),
    ...(used.has('skill') ? ['The `skill` tool now takes `id` instead of `name`.'] : []),
    ...(removed.length === 1 ? [`The \`${removed[0]}\` tool is no longer available and must not be called.`]
      : removed.length > 1 ? [`The following tools are no longer available and must not be called: ${list(removed)}.`]
      : [])
  ];
  return lines.length ? ['The available tools have changed.', ...lines].join('\n\n') : undefined;
}

interface Parsed<R> { row: R; value: Json }

export function convertV1Session(session: V1Session, messageRows: V1MessageRow[], partRows: V1PartRow[]): V1Conversion {
  const skipped: V1Conversion['skipped'] = [];
  const messages: Parsed<V1MessageRow>[] = messageRows
    .flatMap((r) => {
      const value = parse(r.data);
      if (value && (value.role === 'user' || value.role === 'assistant')) return [{ row: r, value }];
      skipped.push({ reason: 'invalid-message', id: r.id });
      return [];
    })
    .sort((a, b) => a.row.time_created - b.row.time_created || a.row.id.localeCompare(b.row.id));
  const messageIds = new Set(messageRows.map((r) => r.id));
  const parts: Parsed<V1PartRow>[] = partRows
    .flatMap((r) => {
      if (!messageIds.has(r.message_id)) {
        skipped.push({ reason: 'orphan-part', id: r.id });
        return [];
      }
      const value = parse(r.data);
      if (value && typeof value.type === 'string') return [{ row: r, value }];
      skipped.push({ reason: 'invalid-part', id: r.id });
      return [];
    })
    .sort((a, b) => a.row.id.localeCompare(b.row.id));
  const partsOf = new Map<string, Json[]>();
  for (const p of parts) partsOf.set(p.row.message_id, [...(partsOf.get(p.row.message_id) ?? []), p.value]);
  const textOf = (id: string) => (partsOf.get(id) ?? []).filter((p) => p.type === 'text' && p.text).map((p) => p.text).join('\n\n');

  /** The transcript a compaction kept verbatim, as 2.x quotes it. */
  const recentTranscript = (span: Parsed<V1MessageRow>[]) => span.flatMap((m) => {
    const own = partsOf.get(m.row.id) ?? [];
    if (m.value.role === 'user') return [`[User]: ${own.filter((p) => p.type === 'text' && !p.ignored).map((p) => p.text).join('\n\n')}`];
    return own.flatMap((p) => p.type === 'text' ? [`[Assistant]: ${p.text}`]
      : p.type === 'reasoning' && p.text ? [`[Assistant reasoning]: ${p.text}`] : []);
  }).join('\n\n');

  const consumed = new Set<string>();
  const taken = new Set(messages.map((m) => m.row.id));

  const user = (m: Parsed<V1MessageRow>): V2MessageRow[] => {
    const own = partsOf.get(m.row.id) ?? [];
    const created = { time: { created: m.row.time_created } };
    const compaction = own.find((p) => p.type === 'compaction');
    if (compaction) {
      const summary = messages.find((a) => a.value.role === 'assistant' && a.value.parentID === m.row.id && a.value.summary === true);
      if (!summary) return [];
      consumed.add(summary.row.id);
      if (summary.value.error || summary.value.time?.completed === undefined) return [];
      const tailStart = compaction.tail_start_id ? messages.findIndex((x) => x.row.id === compaction.tail_start_id) : -1;
      const here = messages.findIndex((x) => x.row.id === m.row.id);
      return [row({ ...m.row, time_updated: Math.max(m.row.time_updated, summary.row.time_updated) }, 'compaction', {
        status: 'completed',
        reason: compaction.auto ? 'auto' : 'manual',
        summary: textOf(summary.row.id),
        recent: recentTranscript(tailStart < 0 ? [] : messages.slice(tailStart, here)),
        ...created
      })];
    }
    const subtasks = own.filter((p) => p.type === 'subtask');
    const texts = own.filter((p) => p.type === 'text' && !p.ignored);
    const files = own.filter((p) => p.type === 'file' && typeof p.url === 'string');
    const agents = own.filter((p) => p.type === 'agent');
    // A prompt that only launched a subagent lives on in that subagent's session.
    if (subtasks.length > 0 && texts.length === 0 && files.length === 0 && agents.length === 0) return [];
    const typed = texts.filter((p) => !p.synthetic);
    const synthetic = texts.filter((p) => p.synthetic);
    const inline = files.flatMap(inlineFile);
    const linked = files.filter((p) => !p.url.startsWith('data:')).map(unavailableFile);
    const text = own.flatMap((p) => p.type === 'text' && !p.ignored && !p.synthetic ? [p.text]
      : p.type === 'file' && typeof p.url === 'string' && !p.url.startsWith('data:') ? [unavailableFile(p)] : []).join('\n\n');
    const mentions = agents.map((p) => ({
      name: p.name,
      ...(p.source ? { mention: { text: p.source.value, start: p.source.start, end: p.source.end } } : {})
    }));
    const syntheticText = synthetic.map((p) => p.text).join('\n\n');
    if (!typed.length && !linked.length && synthetic.length && !inline.length && !mentions.length) {
      return [row(m.row, 'synthetic', { text: syntheticText, ...created })];
    }
    const prompt = row(m.row, 'user', {
      text,
      ...(inline.length ? { files: inline } : {}),
      ...(mentions.length ? { agents: mentions } : {}),
      ...created
    });
    if (!synthetic.length) return [prompt];
    return [prompt, row(m.row, 'synthetic', { text: syntheticText, ...created }, derivedId(m.row.id, taken))];
  };

  const assistant = (m: Parsed<V1MessageRow>): V2MessageRow[] => {
    const a = m.value;
    const own = partsOf.get(m.row.id) ?? [];
    // The answer that ran a subagent for a `/command` is that subagent's session's to keep.
    const parentParts = partsOf.get(a.parentID) ?? [];
    if (parentParts.some((p) => p.type === 'subtask') && own.some((p) => p.type === 'tool' && p.tool === 'task')) return [];
    const content = own.flatMap((p) => {
      if (p.type === 'text') return [{ type: 'text', text: p.text, ...(p.metadata ? { state: p.metadata } : {}) }];
      if (p.type === 'reasoning') {
        return [{
          type: 'reasoning',
          text: p.text,
          ...(p.metadata ? { state: p.metadata } : {}),
          time: { created: p.time?.start ?? m.row.time_created, ...(p.time?.end === undefined ? {} : { completed: p.time.end }) }
        }];
      }
      return p.type === 'tool' ? [toolContent(p, m.row.time_created)] : [];
    });
    const start = own.find((p) => p.type === 'step-start' && p.snapshot)?.snapshot
      ?? own.find((p) => p.type === 'snapshot')?.snapshot
      ?? own.find((p) => p.type === 'patch')?.hash;
    const end = own.filter((p) => p.type === 'step-finish' && p.snapshot).at(-1)?.snapshot;
    const changed = [...new Set(own.flatMap((p) => (p.type === 'patch' && Array.isArray(p.files) ? p.files : [])))];
    const finish = a.finish ? (FINISH_REASONS.includes(a.finish) ? a.finish : 'unknown') : undefined;
    return [row(m.row, 'assistant', {
      agent: a.agent ?? a.mode,
      model: { providerID: a.providerID, id: a.modelID, variant: a.variant ?? 'default' },
      content,
      ...(start || end || changed.length
        ? { snapshot: { ...(start ? { start } : {}), ...(end ? { end } : {}), ...(changed.length ? { files: changed } : {}) } }
        : {}),
      ...(finish ? { finish } : {}),
      cost: num(a.cost),
      tokens: tokensOf(a),
      ...(a.error ? { error: errorOf(a.error) } : {}),
      time: { created: m.row.time_created, ...(a.time?.completed === undefined ? {} : { completed: m.row.time_updated }) }
    })];
  };

  const rows = messages
    .flatMap((m) => (consumed.has(m.row.id) ? [] : m.value.role === 'user' ? user(m) : assistant(m)))
    .map((r, seq) => ({ ...r, seq }));
  const last = rows.at(-1);
  const notice = last ? toolChangeNotice(rows) : undefined;
  if (last && notice) {
    rows.push({ ...last, id: derivedId(last.id, taken), type: 'system', seq: rows.length, data: { text: notice, time: { created: last.time_created } } });
  }

  // Totals count every answer, including the ones folded into a compaction.
  const answers = messages.map((m) => m.value).filter((v) => v.role === 'assistant');
  const sum = (pick: (t: ReturnType<typeof tokensOf>) => number) => answers.reduce((n, v) => n + pick(tokensOf(v)), 0);
  const lastPrompt = [...messages].reverse().find((m) => {
    if (m.value.role !== 'user') return false;
    const own = partsOf.get(m.row.id) ?? [];
    return !own.some((p) => p.type === 'compaction') && !(own.length > 0 && own.every((p) => p.type === 'subtask'));
  })?.value;
  const promptModel = lastPrompt?.model
    ? JSON.stringify({ id: lastPrompt.model.modelID, providerID: lastPrompt.model.providerID, variant: lastPrompt.model.variant ?? 'default' })
    : null;
  return {
    messages: rows,
    session: {
      agent: session.agent ?? lastPrompt?.agent ?? null,
      model: session.model ?? promptModel,
      cost: answers.reduce((n, v) => n + num(v.cost), 0),
      tokens_input: sum((t) => t.input),
      tokens_output: sum((t) => t.output),
      tokens_reasoning: sum((t) => t.reasoning),
      tokens_cache_read: sum((t) => t.cache.read),
      tokens_cache_write: sum((t) => t.cache.write)
    },
    watermark: rows.length - 1,
    skipped
  };
}
