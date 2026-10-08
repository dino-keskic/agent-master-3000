import { z } from 'zod';

/**
 * Schemas for everything crossing the ACP boundary.
 *
 * `opencode acp` is a separate process whose stdout we parse; before this file
 * that payload was typed `any` and dug through with chained optional access, so
 * a protocol change surfaced as `undefined` deep inside the UI rather than as a
 * parse failure here. Every schema is permissive about *extra* fields (zod
 * strips unknown keys by default) but strict about the ones we rely on.
 */

/** JSON-RPC request ids are a string, number, or (rarely) null. */
export const jsonRpcIdSchema = z.union([z.string(), z.number()]);
export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;

export const jsonRpcMessageSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: jsonRpcIdSchema.optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string().optional(),
      data: z.unknown().optional()
    })
    .optional(),
  method: z.string().optional(),
  params: z.unknown().optional()
});

export type JsonRpcMessage = z.infer<typeof jsonRpcMessageSchema>;

/**
 * Agent → client request. JSON-RPC ids are per sender, so a `session/prompt`
 * we still have open can share a numeric id with a `session/request_permission`
 * the agent just sent — the presence of `method` is what distinguishes them.
 */
export function isIncomingJsonRpcRequest(
  msg: JsonRpcMessage
): msg is JsonRpcMessage & { method: string; id: JsonRpcId } {
  return typeof msg.method === 'string' && msg.method.length > 0 && msg.id !== undefined;
}

/** ACP content blocks arrive as a string, {text}, or a diff block. */
const contentBlockSchema = z.union([
  z.string(),
  z.object({
    type: z.literal('diff'),
    path: z.string().optional(),
    newText: z.string().optional()
  }),
  z.object({
    text: z.string().optional(),
    content: z.union([z.string(), z.object({ text: z.string().optional() })]).optional()
  })
]);

export type ContentBlock = z.infer<typeof contentBlockSchema>;

const toolLocationSchema = z.object({ path: z.string().optional() });

/**
 * One session update. `sessionUpdate` is the current discriminator; `type` is
 * accepted as the legacy spelling. Chunk variants share a shape, so they are
 * normalized to a single `kind` by `parseSessionUpdate` below.
 */
const sessionUpdateSchema = z.object({
  sessionUpdate: z.string().optional(),
  type: z.string().optional(),
  messageId: z.string().optional(),
  text: z.string().optional(),
  thought: z.string().optional(),
  content: z.union([z.object({ text: z.string().optional() }), z.array(contentBlockSchema)]).optional(),
  toolCallId: z.string().optional(),
  id: z.string().optional(),
  title: z.unknown().optional(),
  kind: z.unknown().optional(),
  status: z.unknown().optional(),
  rawInput: z.record(z.string(), z.unknown()).optional(),
  rawOutput: z.unknown().optional(),
  locations: z.array(toolLocationSchema).optional()
});

export const sessionNotificationSchema = z.object({
  sessionId: z.string().optional(),
  id: z.string().optional(),
  update: sessionUpdateSchema.optional()
});

export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;

export type ParsedUpdate =
  | { kind: 'user_chunk'; messageId?: string; text: string }
  | { kind: 'agent_chunk'; messageId?: string; text: string }
  | { kind: 'thought_chunk'; messageId?: string; text: string }
  | { kind: 'tool_call'; update: SessionUpdate }
  | { kind: 'session_info'; title?: string }
  | { kind: 'ignored' };

const USER_CHUNK = new Set(['user_message_chunk']);
const AGENT_CHUNK = new Set(['agent_message_chunk', 'message_chunk', 'text_chunk']);
const THOUGHT_CHUNK = new Set(['agent_thought_chunk', 'thought_chunk', 'thought']);
const TOOL_CALL = new Set(['tool_call', 'tool_call_update']);

function chunkText(update: SessionUpdate): string {
  const { content } = update;
  if (content && !Array.isArray(content) && typeof content.text === 'string') return content.text;
  return update.text ?? update.thought ?? '';
}

/**
 * Turns a raw notification into a tagged variant, so callers switch on `kind`
 * instead of re-deriving the discriminator from two possible field names.
 */
export function parseSessionUpdate(params: unknown): { sessionId?: string; parsed: ParsedUpdate } {
  const notification = sessionNotificationSchema.safeParse(params);
  if (!notification.success) return { parsed: { kind: 'ignored' } };

  const sessionId = notification.data.sessionId ?? notification.data.id;
  // Some builds send the update fields inline rather than nested under `update`.
  const inline = sessionUpdateSchema.safeParse(params);
  const update = notification.data.update ?? (inline.success ? inline.data : undefined);
  if (!update) return { sessionId, parsed: { kind: 'ignored' } };

  const discriminator = update.sessionUpdate ?? update.type ?? '';
  const messageId = update.messageId;

  if (USER_CHUNK.has(discriminator)) return { sessionId, parsed: { kind: 'user_chunk', messageId, text: chunkText(update) } };
  if (AGENT_CHUNK.has(discriminator)) return { sessionId, parsed: { kind: 'agent_chunk', messageId, text: chunkText(update) } };
  if (THOUGHT_CHUNK.has(discriminator)) return { sessionId, parsed: { kind: 'thought_chunk', messageId, text: chunkText(update) } };
  if (TOOL_CALL.has(discriminator)) return { sessionId, parsed: { kind: 'tool_call', update } };
  if (discriminator === 'session_info_update' || discriminator === 'session_info') {
    const title = typeof update.title === 'string' ? update.title : undefined;
    return { sessionId, parsed: { kind: 'session_info', title } };
  }

  return { sessionId, parsed: { kind: 'ignored' } };
}

/** Extracts readable text from a tool-call content array. */
export function extractToolOutput(content: unknown): string | undefined {
  const blocks = z.array(contentBlockSchema).safeParse(content);
  if (!blocks.success || blocks.data.length === 0) return undefined;

  const parts: string[] = [];
  for (const block of blocks.data) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if ('type' in block && block.type === 'diff') {
      parts.push(`${block.path ? `${block.path}\n` : ''}${block.newText ?? ''}`);
      continue;
    }
    if ('content' in block && typeof block.content === 'string') {
      parts.push(block.content);
      continue;
    }
    if ('content' in block && block.content && typeof block.content === 'object' && typeof block.content.text === 'string') {
      parts.push(block.content.text);
      continue;
    }
    if ('text' in block && typeof block.text === 'string') parts.push(block.text);
  }

  const joined = parts.join('\n').trim();
  return joined.length > 0 ? joined : undefined;
}

/** A single selectable option on a session config control. */
const configOptionValueSchema = z.object({
  value: z.string(),
  name: z.string().optional(),
  description: z.string().optional()
});

export const configOptionSchema = z.object({
  id: z.string(),
  currentValue: z.string().optional(),
  options: z.array(configOptionValueSchema).optional()
});

export const configOptionsSchema = z.array(configOptionSchema).catch([]);

export type ConfigOption = z.infer<typeof configOptionSchema>;

/** `session/new` and `session/load` both answer with a session plus its config. */
export const sessionResultSchema = z.object({
  sessionId: z.string().optional(),
  configOptions: configOptionsSchema.optional()
});

export const sessionListSchema = z.object({
  sessions: z
    .array(
      z.object({
        sessionId: z.string(),
        title: z.string().optional(),
        cwd: z.string().optional(),
        updatedAt: z.string().optional(),
        agent: z.string().optional()
      })
    )
    .catch([])
});

export const promptResultSchema = z.object({ stopReason: z.string().optional() });

/** Reads one control's options, e.g. every model the session will accept. */
export function optionValues(options: ConfigOption[], configId: string): string[] {
  return options.find((c) => c.id === configId)?.options?.map((o) => o.value) ?? [];
}

export function findOption(options: ConfigOption[], configId: string): ConfigOption | undefined {
  return options.find((c) => c.id === configId);
}

/**
 * Map a board-selected value onto the id OpenCode actually lists.
 *
 * The composer stores `github-copilot/kimi-k3`; a session loaded from the DB
 * might only list `kimi-k3`, or the other way around. An exact-only check
 * treated that as "not available" and silently kept whatever the session
 * already had — which is how a Kimi dropdown produced an Opus turn.
 */
export function resolveConfigValue(
  options: ConfigOption[],
  configId: string,
  requested: string
): string | undefined {
  const allowed = optionValues(options, configId);
  if (allowed.length === 0) return requested;
  if (allowed.includes(requested)) return requested;

  const lower = requested.toLowerCase();
  const exact = allowed.find((value) => value.toLowerCase() === lower);
  if (exact) return exact;

  const requestedId = (lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower);
  const byId = allowed.find((value) => {
    const id = (value.includes('/') ? value.slice(value.lastIndexOf('/') + 1) : value).toLowerCase();
    return id === requestedId;
  });
  return byId;
}

/* ------------------------------------------------------------------ *
 * Agent -> client requests.
 *
 * These are JSON-RPC *requests*, not notifications: the agent's turn is
 * blocked until we answer with a result keyed by the request id. Shapes
 * verified against opencode 1.18.15's bundled ACP schema.
 * ------------------------------------------------------------------ */

export const permissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always'])
});

const toolCallUpdateSchema = z.object({
  toolCallId: z.string(),
  title: z.string().nullish(),
  name: z.string().nullish(),
  kind: z.string().nullish(),
  status: z.string().nullish(),
  content: z.unknown().optional(),
  locations: z.array(z.object({ path: z.string().optional() })).nullish(),
  rawInput: z.record(z.string(), z.unknown()).optional()
});

/**
 * ACP v1 sends `toolCall`; v2 sends `title` + optional `subject`. Either is
 * enough to show the user what they are being asked about.
 */
export const requestPermissionParamsSchema = z
  .object({
    sessionId: z.string(),
    title: z.string().optional(),
    description: z.string().nullish(),
    toolCall: toolCallUpdateSchema.optional(),
    subject: z.unknown().optional(),
    options: z.array(permissionOptionSchema)
  })
  .refine((data) => !!data.toolCall || !!data.subject || !!data.title, {
    message: 'permission request needs a toolCall, subject, or title'
  });

/** Flatten v1 `toolCall` / v2 `subject` into the shape the board parks. */
export function permissionToolCallFrom(params: {
  sessionId: string;
  title?: string;
  toolCall?: z.infer<typeof toolCallUpdateSchema>;
  subject?: unknown;
}): z.infer<typeof toolCallUpdateSchema> {
  if (params.toolCall) return params.toolCall;
  const subject = params.subject && typeof params.subject === 'object'
    ? (params.subject as Record<string, unknown>)
    : undefined;
  const nested = subject?.toolCall;
  if (nested && typeof nested === 'object') {
    const parsed = toolCallUpdateSchema.safeParse(nested);
    if (parsed.success) return parsed.data;
  }
  const toolCallId =
    (typeof subject?.toolCallId === 'string' && subject.toolCallId)
    || params.sessionId;
  return {
    toolCallId,
    title: params.title ?? (typeof subject?.title === 'string' ? subject.title : undefined),
    kind: typeof subject?.kind === 'string' ? subject.kind : undefined,
    rawInput: subject?.rawInput && typeof subject.rawInput === 'object'
      ? (subject.rawInput as Record<string, unknown>)
      : undefined
  };
}

/** JSON-Schema primitives an elicitation form may request. */
const primitiveFieldSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean', 'array']).optional(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  enum: z.array(z.string()).optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).nullish(),
  items: z.object({ enum: z.array(z.string()).optional() }).optional()
});

export const elicitationParamsSchema = z.object({
  message: z.string(),
  mode: z.enum(['form', 'url']).optional().default('form'),
  url: z.string().optional(),
  requestedSchema: z
    .object({
      title: z.string().nullish(),
      description: z.string().nullish(),
      properties: z.record(z.string(), primitiveFieldSchema).default({}),
      required: z.array(z.string()).nullish()
    })
    .optional()
});

export type RequestPermissionParams = z.infer<typeof requestPermissionParamsSchema>;
export type ElicitationParams = z.infer<typeof elicitationParamsSchema>;
