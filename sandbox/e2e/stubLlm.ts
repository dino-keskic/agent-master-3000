import http from 'node:http';

/**
 * A stand-in LLM for the end-to-end test: just enough of OpenAI's
 * `/v1/chat/completions` for OpenCode to hold a conversation with it.
 *
 * The e2e config registers it as an `@ai-sdk/openai-compatible` provider on
 * 127.0.0.1, so a real `opencode acp` turn needs no network, no account and no
 * key. Replies are scripted, not generated, so the test can assert exact text:
 *
 * - a prompt containing `TOOL_TRIGGER` gets a shell tool call first — `bash`
 *   on OpenCode 1.x, `shell` on 2.x — and the reply after the tool has run
 *   quotes its output back;
 * - a prompt containing `e2e:echo:<marker>` gets `STUB-ECHO <marker>`, so
 *   each of several follow-ups has a reply of its own to look for;
 * - `e2e:slow:<marker>` gets the same reply, streamed over a few seconds, so
 *   the test can act while a turn is still running;
 * - anything else — OpenCode's own title request included — gets `REPLY`.
 *
 * Plain `node:http`, no dependencies: it runs inside the test process, so the
 * test can also see exactly what OpenCode sent it.
 */

export const PROVIDER_ID = 'stub';
export const MODEL_ID = 'e2e-model';
export const REPLY = 'STUB-LLM-REPLY: hello from inside the sandbox';
export const TOOL_TRIGGER = 'e2e:run-tool';
export const TOOL_OUTPUT = 'e2e-tool-output';
export const TOOL_REPLY_PREFIX = 'STUB-LLM-AFTER-TOOL:';
export const ECHO_TRIGGER = 'e2e:echo:';
export const SLOW_TRIGGER = 'e2e:slow:';
/** How long a slow reply takes to stream, start to finish. */
export const SLOW_REPLY_MS = 4000;

/** The reply a prompt carrying `${ECHO_TRIGGER}<marker>` gets. */
export function echoReply(marker: string): string {
  return `STUB-ECHO ${marker}`;
}

interface ChatMessage {
  role?: string;
  content?: unknown;
}

export interface ChatRequest {
  model?: string;
  stream?: boolean;
  messages?: ChatMessage[];
  tools?: { function?: { name?: string } }[];
}

type Answer =
  | { text: string; slow?: boolean }
  | { toolCall: { id: string; name: string; arguments: string } };

/** The text of a chat message, whether it came as a string or as parts. */
function textOf(message: ChatMessage | undefined): string {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: { text?: unknown }) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

/** What each OpenCode calls its shell tool. */
const SHELL_TOOLS = ['bash', 'shell'];

/**
 * What to answer. Only the tail of the conversation matters: OpenCode resends
 * the whole history every step, so a tool result as the last message means the
 * call we asked for has run.
 */
export function decide(body: ChatRequest): Answer {
  const messages = body.messages ?? [];
  const last = messages[messages.length - 1];
  if (last?.role === 'tool') return { text: `${TOOL_REPLY_PREFIX} ${textOf(last).trim()}` };

  const offered = (body.tools ?? []).map((tool) => tool.function?.name);
  const shell = SHELL_TOOLS.find((name) => offered.includes(name));
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  // Only a request that offers tools is the turn itself; the title request
  // quotes the same prompt and must not answer for it.
  const echo = shell ? new RegExp(`(${ECHO_TRIGGER}|${SLOW_TRIGGER})(\\S+)`).exec(textOf(lastUser)) : null;
  if (echo?.[2]) return { text: echoReply(echo[2]), slow: echo[1] === SLOW_TRIGGER };
  if (shell && textOf(lastUser).includes(TOOL_TRIGGER)) {
    return {
      toolCall: {
        id: `call_${Date.now().toString(36)}`,
        name: shell,
        arguments: JSON.stringify({ command: `echo ${TOOL_OUTPUT}`, description: 'Print the e2e marker' })
      }
    };
  }
  return { text: REPLY };
}

const USAGE = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 };

function chunk(model: string, delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: 'chatcmpl-e2e',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  };
}

async function streamAnswer(res: http.ServerResponse, model: string, answer: Answer): Promise<void> {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  send(chunk(model, { role: 'assistant', content: '' }));
  if ('toolCall' in answer) {
    const { id, name, arguments: args } = answer.toolCall;
    send(chunk(model, { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] }));
    send(chunk(model, { tool_calls: [{ index: 0, function: { arguments: args } }] }));
    send(chunk(model, {}, 'tool_calls'));
  } else {
    // Several deltas, so the board sees a stream rather than one final message.
    const pieces = answer.slow ? [...answer.text] : answer.text.match(/.{1,12}/g) ?? [''];
    const pause = answer.slow ? SLOW_REPLY_MS / pieces.length : 0;
    for (const piece of pieces) {
      send(chunk(model, { content: piece }));
      if (pause) await new Promise((r) => setTimeout(r, pause));
    }
    send(chunk(model, {}, 'stop'));
  }
  send({ ...chunk(model, {}), choices: [], usage: USAGE });
  res.end('data: [DONE]\n\n');
}

function jsonAnswer(res: http.ServerResponse, model: string, answer: Answer): void {
  const message = 'toolCall' in answer
    ? {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: answer.toolCall.id,
          type: 'function',
          function: { name: answer.toolCall.name, arguments: answer.toolCall.arguments }
        }]
      }
    : { role: 'assistant', content: answer.text };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: 'chatcmpl-e2e',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: 'toolCall' in answer ? 'tool_calls' : 'stop' }],
    usage: USAGE
  }));
}

export interface StubLlm {
  port: number;
  /** Every completion request body, in arrival order. */
  requests: ChatRequest[];
  close(): Promise<void>;
}

/** Starts the stub on 127.0.0.1 — an ephemeral port unless one is given. */
export function startStubLlm(port = 0): Promise<StubLlm> {
  const requests: ChatRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (data: Buffer) => { raw += data.toString(); });
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_ID, object: 'model', owned_by: 'e2e' }] }));
        return;
      }
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      let body: ChatRequest;
      try {
        body = JSON.parse(raw || '{}') as ChatRequest;
      } catch {
        res.writeHead(400).end();
        return;
      }
      requests.push(body);
      const answer = decide(body);
      const model = body.model || MODEL_ID;
      if (body.stream) void streamAnswer(res, model, answer);
      else jsonAnswer(res, model, answer);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : port,
        requests,
        close: () => new Promise<void>((done) => server.close(() => done()))
      });
    });
  });
}
