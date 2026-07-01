export class FetchRetryError extends Error {
  readonly status: number | null;
  readonly response: Response | null;
  readonly cause: unknown;

  constructor(message: string, opts: { status?: number | null; response?: Response | null; cause?: unknown } = {}) {
    super(message);
    this.name = 'FetchRetryError';
    this.status = opts.status ?? null;
    this.response = opts.response ?? null;
    this.cause = opts.cause;
  }
}

export interface FetchWithRetryOptions extends RequestInit {
  retries?: number;
  baseDelayMs?: number;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;

function jitter(ms: number): number {
  const variance = ms * 0.25;
  return ms + (Math.random() * 2 - 1) * variance;
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    retries = DEFAULT_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    onRetry,
    signal,
    ...fetchInit
  } = options;

  let lastError: unknown = null;
  let lastStatus: number | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(input, { ...fetchInit, signal });

      if (response.ok) {
        return response;
      }

      // 4xx: deterministic, don't retry.
      if (response.status >= 400 && response.status < 500) {
        return response;
      }

      lastResponse = response;
      lastStatus = response.status;
      lastError = new FetchRetryError(`HTTP ${response.status}`, { status: response.status, response });
    } catch (err) {
      // Abort: propagate immediately.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      lastError = err;
      lastStatus = null;
      lastResponse = null;
    }

    if (attempt === retries) break;

    const delayMs = Math.round(jitter(baseDelayMs * Math.pow(3, attempt - 1)));
    const reason = lastStatus ? `status ${lastStatus}` : 'network error';
    console.warn(`[fetchWithRetry] attempt ${attempt}/${retries} failed (${reason}); retrying in ${delayMs}ms`);
    onRetry?.({ attempt, delayMs, reason });

    await sleep(delayMs, signal);
  }

  if (lastError instanceof FetchRetryError) throw lastError;
  throw new FetchRetryError('Fetch failed after retries', {
    status: lastStatus,
    response: lastResponse,
    cause: lastError,
  });
}
