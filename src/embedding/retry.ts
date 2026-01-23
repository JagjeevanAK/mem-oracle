// Retry with exponential backoff + jitter for transient failures

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableStatuses?: number[];
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 6,
  baseDelayMs: 250,
  maxDelayMs: 10000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("socket hang up") ||
      message.includes("fetch failed")
    );
  }
  return false;
}

function calculateBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init);

      if (response.ok) {
        return response;
      }

      if (opts.retryableStatuses.includes(response.status)) {
        const retryAfter = response.headers.get("retry-after");
        let delay: number;

        if (retryAfter) {
          const retryAfterMs = parseInt(retryAfter, 10) * 1000;
          delay = isNaN(retryAfterMs)
            ? calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs)
            : Math.min(retryAfterMs, opts.maxDelayMs);
        } else {
          delay = calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
        }

        if (attempt < opts.maxAttempts - 1) {
          console.warn(
            `Retryable status ${response.status} from ${url}, attempt ${attempt + 1}/${opts.maxAttempts}, waiting ${delay}ms`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isRetryableError(error) && attempt < opts.maxAttempts - 1) {
        const delay = calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
        console.warn(
          `Network error: ${lastError.message}, attempt ${attempt + 1}/${opts.maxAttempts}, waiting ${delay}ms`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error(`Failed after ${opts.maxAttempts} attempts`);
}
