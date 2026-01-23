import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { fetchWithRetry } from "../src/embedding/retry";

describe("fetchWithRetry", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() => Promise.resolve(new Response("ok")));
    globalThis.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("should succeed on first attempt with 200", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response("success", { status: 200 }))
    );

    const response = await fetchWithRetry("https://api.test.com/embed", {
      method: "POST",
    });

    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("should retry on 429 and succeed", async () => {
    let attempts = 0;
    mockFetch.mockImplementation(() => {
      attempts++;
      if (attempts < 3) {
        return Promise.resolve(new Response("rate limited", { status: 429 }));
      }
      return Promise.resolve(new Response("success", { status: 200 }));
    });

    const response = await fetchWithRetry(
      "https://api.test.com/embed",
      { method: "POST" },
      { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 50 }
    );

    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test("should retry on 500 and succeed", async () => {
    let attempts = 0;
    mockFetch.mockImplementation(() => {
      attempts++;
      if (attempts < 2) {
        return Promise.resolve(new Response("server error", { status: 500 }));
      }
      return Promise.resolve(new Response("success", { status: 200 }));
    });

    const response = await fetchWithRetry(
      "https://api.test.com/embed",
      { method: "POST" },
      { maxAttempts: 3, baseDelayMs: 10 }
    );

    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("should return last response after max attempts on retryable status", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response("rate limited", { status: 429 }))
    );

    const response = await fetchWithRetry(
      "https://api.test.com/embed",
      { method: "POST" },
      { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 }
    );

    expect(response.status).toBe(429);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test("should not retry on 400 (non-retryable)", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response("bad request", { status: 400 }))
    );

    const response = await fetchWithRetry(
      "https://api.test.com/embed",
      { method: "POST" },
      { maxAttempts: 3, baseDelayMs: 10 }
    );

    expect(response.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("should retry on network error and succeed", async () => {
    let attempts = 0;
    mockFetch.mockImplementation(() => {
      attempts++;
      if (attempts < 2) {
        return Promise.reject(new Error("fetch failed"));
      }
      return Promise.resolve(new Response("success", { status: 200 }));
    });

    const response = await fetchWithRetry(
      "https://api.test.com/embed",
      { method: "POST" },
      { maxAttempts: 3, baseDelayMs: 10 }
    );

    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("should throw after max attempts on network error", async () => {
    mockFetch.mockImplementation(() =>
      Promise.reject(new Error("fetch failed"))
    );

    await expect(
      fetchWithRetry(
        "https://api.test.com/embed",
        { method: "POST" },
        { maxAttempts: 3, baseDelayMs: 10 }
      )
    ).rejects.toThrow("fetch failed");

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test("should respect retry-after header", async () => {
    let attempts = 0;
    const startTime = Date.now();
    
    mockFetch.mockImplementation(() => {
      attempts++;
      if (attempts < 2) {
        const headers = new Headers();
        headers.set("retry-after", "1");
        return Promise.resolve(new Response("rate limited", { status: 429, headers }));
      }
      return Promise.resolve(new Response("success", { status: 200 }));
    });

    await fetchWithRetry(
      "https://api.test.com/embed",
      { method: "POST" },
      { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 2000 }
    );

    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  test("should use custom retryable statuses", async () => {
    let attempts = 0;
    mockFetch.mockImplementation(() => {
      attempts++;
      if (attempts < 2) {
        return Promise.resolve(new Response("custom error", { status: 418 }));
      }
      return Promise.resolve(new Response("success", { status: 200 }));
    });

    const response = await fetchWithRetry(
      "https://api.test.com/embed",
      { method: "POST" },
      { maxAttempts: 3, baseDelayMs: 10, retryableStatuses: [418] }
    );

    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
