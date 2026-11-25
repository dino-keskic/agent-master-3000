/**
 * Recognizing model image-count rejections and planning how many older
 * historical images to keep when recovering a session.
 *
 * OpenCode keeps earlier user attachments and tool-returned images inside a
 * session's history and sends all of them on every subsequent turn. Once a
 * conversation passes a model's cap (for instance Gemini's 10-image limit),
 * every follow-up and even `/compact` fails with the same error unless the
 * oldest images are trimmed from a continuation copy.
 */

export interface ImageLimitError {
  maxAllowed?: number;
  got?: number;
  model?: string;
}

const MAX_FOR_MODEL =
  /too many images.*?max(?:imum)?(?:\s+allowed)?(?:\s+for\s+model\s+([^\s:,]+))?\s+(?:is|of)\s+(\d+)(?:,\s*got\s+(\d+))?/i;
const SIMPLE_MAX = /too many images.*?(?:max(?:imum)?|limit|at most)\D+(\d+)(?:\D+got\s+(\d+))?/i;
const DEFAULT_FALLBACK_MAX = 10;

/**
 * Extract the model name and numeric image cap from a provider / OpenCode
 * error message when the failure is caused by too many images in context.
 */
export function parseImageLimitError(message: string | undefined): ImageLimitError | undefined {
  if (!message || !/too many images|maximum number of images/i.test(message)) return undefined;

  const modelMatch = MAX_FOR_MODEL.exec(message);
  if (modelMatch) {
    const model = modelMatch[1]?.trim() || undefined;
    const maxAllowed = Number(modelMatch[2]);
    const got = modelMatch[3] ? Number(modelMatch[3]) : undefined;
    return {
      ...(model ? { model } : {}),
      ...(Number.isFinite(maxAllowed) && maxAllowed > 0 ? { maxAllowed } : {}),
      ...(got !== undefined && Number.isFinite(got) ? { got } : {})
    };
  }

  const simpleMatch = SIMPLE_MAX.exec(message);
  if (simpleMatch) {
    const maxAllowed = Number(simpleMatch[1]);
    const got = simpleMatch[2] ? Number(simpleMatch[2]) : undefined;
    return {
      ...(Number.isFinite(maxAllowed) && maxAllowed > 0 ? { maxAllowed } : {}),
      ...(got !== undefined && Number.isFinite(got) ? { got } : {})
    };
  }

  return {};
}

/**
 * How many newest historical images to preserve in a trimmed session copy when
 * retrying a turn that itself carries `newTurnImages`.
 *
 * Leaves headroom inside the cap when possible so upcoming follow-ups or tool
 * screenshots do not immediately hit the same wall on the very next step.
 */
export function imageKeepBudget(maxAllowed: number | undefined, newTurnImages: number): number {
  const cap = maxAllowed && maxAllowed > 0 ? maxAllowed : DEFAULT_FALLBACK_MAX;
  const available = Math.max(0, cap - Math.max(0, newTurnImages));
  const headroom = available >= 3 ? Math.min(2, available - 1) : 0;
  return Math.max(0, Math.min(Math.floor(cap / 2), available - headroom));
}
