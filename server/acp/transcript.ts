import { TaskLogItem, ToolCallInfo } from '../../shared/types.js';
import { normalizeToolStatus, toolLabel } from '../../shared/agent/toolCall.js';
import { newId } from '../../shared/ids.js';
import { MAX_LOG_TEXT } from '../../shared/task/logWrites.js';
import { extractToolOutput, ParsedUpdate, SessionUpdate } from './schema.js';
import { AcpEvent } from './events.js';
import { AcpSessionRegistry } from './sessionRegistry.js';

type ChunkType = 'agent_say' | 'thought' | 'user_say';

interface OpenBuffers {
  taskId: string;
  messages: Map<string, OpenMessage>;
  toolCalls: Map<string, ToolCallInfo>;
}

/** A message being streamed in, one `session/update` chunk at a time. */
interface OpenMessage {
  id: string;
  text: string;
  type: ChunkType;
  startedAt: number;
}

/**
 * Turns the agent's stream of updates into board log entries.
 *
 * Two kinds of state make this more than a mapping. Streamed text arrives in
 * chunks that have to accumulate under one log id, so the board can re-render
 * the same message rather than append a hundred of them. And tool calls arrive
 * as partial updates — a title first, then input, then output — so each one is
 * merged onto what came before instead of replacing it.
 */
export class TranscriptStream {
  /**
   * What is open, per session (or per task, for an update with no session):
   * messages still streaming in by buffer key, and tool calls by id. Dropped
   * when the session's turn settles — nothing after the prompt's reply can
   * extend a message — so a long-lived board does not hold every message it
   * ever streamed.
   */
  private readonly open = new Map<string, OpenBuffers>();

  constructor(private readonly registry: AcpSessionRegistry) {}

  /**
   * What the updates so far said about one tool call. A permission prompt is
   * asked mid-turn, so the call is still in its session's open buffers.
   */
  knownToolCall(taskId: string, toolCallId: string): ToolCallInfo | undefined {
    for (const buffers of this.open.values()) {
      if (buffers.taskId !== taskId) continue;
      const call = buffers.toolCalls.get(toolCallId);
      if (call) return call;
    }
    return undefined;
  }

  /** A closed task's messages and tool calls will never be updated again. */
  forgetTask(taskId: string): void {
    for (const [scope, buffers] of this.open) {
      if (buffers.taskId === taskId) this.open.delete(scope);
    }
  }

  /** A settled turn's messages and tool calls will never be updated again. */
  forgetSession(sessionId: string): void {
    this.open.delete(sessionId);
  }

  private buffersFor(taskId: string, sessionId: string | undefined): OpenBuffers {
    const scope = sessionId ?? taskId;
    let buffers = this.open.get(scope);
    if (!buffers) {
      buffers = { taskId, messages: new Map(), toolCalls: new Map() };
      this.open.set(scope, buffers);
    }
    return buffers;
  }

  /** The event this update becomes, or null when there is nothing to say. */
  toEvent(taskId: string, parsed: ParsedUpdate, sessionId?: string): AcpEvent | null {
    switch (parsed.kind) {
      case 'user_chunk': {
        const buf = this.append(taskId, sessionId, `${parsed.messageId ?? ''}_user`, 'user_say', parsed.text);
        return { type: 'log', log: this.chunkLog(buf, 'User Prompt', sessionId) };
      }

      case 'agent_chunk': {
        const buf = this.append(taskId, sessionId, parsed.messageId ?? '', 'agent_say', parsed.text);
        return { type: 'log', log: this.chunkLog(buf, 'OpenCode Agent', sessionId, this.attributionOf(sessionId)) };
      }

      case 'thought_chunk': {
        const buf = this.append(taskId, sessionId, `${parsed.messageId ?? ''}_thought`, 'thought', parsed.text);
        return {
          type: 'log',
          log: this.chunkLog(buf, 'Agent Thought Process', sessionId, { durationMs: Date.now() - buf.startedAt })
        };
      }

      case 'tool_call':
        return this.toolCallEvent(taskId, parsed.update, sessionId);

      case 'session_info':
        return parsed.title ? { type: 'session_info', sessionId, title: parsed.title } : null;

      case 'ignored':
        return null;
    }
  }

  /**
   * Appends to the open buffer for `key`, starting a new one if the kind
   * changed. Past what the store keeps of a line the rest is dropped here: the
   * stored text is clipped to the same prefix anyway, and an agent that
   * streams a megabyte into one message should not cost a megabyte per chunk.
   */
  private append(taskId: string, sessionId: string | undefined, key: string, type: ChunkType, text: string): OpenMessage {
    const { messages } = this.buffersFor(taskId, sessionId);
    let buf = messages.get(key);
    if (!buf || buf.type !== type) {
      buf = { id: newId(), text: '', type, startedAt: Date.now() };
      messages.set(key, buf);
    }
    if (buf.text.length <= MAX_LOG_TEXT) buf.text += text;
    return buf;
  }

  private chunkLog(
    buf: OpenMessage,
    title: string,
    sessionId: string | undefined,
    metadata?: Record<string, unknown>
  ): TaskLogItem {
    return {
      id: buf.id,
      timestamp: Date.now(),
      type: buf.type,
      title,
      text: buf.text,
      sessionId,
      metadata
    };
  }

  /** Only worth attaching when it actually says something. */
  private attributionOf(sessionId: string | undefined): Record<string, unknown> | undefined {
    const attribution = sessionId ? this.registry.attribution(sessionId) : undefined;
    if (!attribution) return undefined;
    const known = attribution.model || attribution.agent || attribution.thinkingLevel;
    return known ? { ...attribution } : undefined;
  }

  private toolCallEvent(taskId: string, update: SessionUpdate, sessionId?: string): AcpEvent | null {
    const toolCallId = update.toolCallId ?? update.id;
    if (!toolCallId) return null;

    const incomingStatus = normalizeToolStatus(update.status);
    // A stopped session can still emit updates for calls already in flight.
    // Letting a `pending` one through would show the task working again.
    const stale = sessionId
      && this.registry.isCancelled(sessionId)
      && (incomingStatus === 'pending' || incomingStatus === 'in_progress');
    if (stale) return null;

    const { toolCalls } = this.buffersFor(taskId, sessionId);
    const previous = toolCalls.get(toolCallId);
    const locations = update.locations?.map((l) => l.path).filter((p): p is string => !!p);
    const output = extractToolOutput(update.content);
    const kind = typeof update.kind === 'string' ? update.kind : undefined;

    const info: ToolCallInfo = {
      toolCallId,
      name: previous?.name ?? toolLabel(update.title, update.kind),
      kind: kind ?? previous?.kind,
      status: incomingStatus ?? previous?.status ?? 'pending',
      rawInput: update.rawInput && Object.keys(update.rawInput).length > 0 ? update.rawInput : previous?.rawInput,
      output: output ?? previous?.output,
      locations: locations && locations.length > 0 ? locations : previous?.locations
    };
    toolCalls.set(toolCallId, info);

    return {
      type: 'log',
      log: {
        id: toolCallId,
        timestamp: Date.now(),
        type: 'tool_call',
        title: info.name,
        text: info.output || '',
        toolCall: info,
        sessionId
      }
    };
  }
}
