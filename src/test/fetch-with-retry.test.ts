import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "@/lib/fetch-with-retry";

// The AI chat path depends on this wrapper: 429s (rate limits) must be
// retried, everything else must pass through untouched and unretried.

const resp = (status: number) => new Response(null, { status });

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a successful response after exactly one call", async () => {
    (fetch as any).mockResolvedValue(resp(200));
    const out = await fetchWithRetry("https://x", undefined, { delayMs: 0 });
    expect(out.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and returns the eventual success", async () => {
    (fetch as any)
      .mockResolvedValueOnce(resp(429))
      .mockResolvedValueOnce(resp(429))
      .mockResolvedValueOnce(resp(200));
    const out = await fetchWithRetry("https://x", undefined, { maxRetries: 2, delayMs: 0 });
    expect(out.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxRetries and returns the last 429", async () => {
    (fetch as any).mockResolvedValue(resp(429));
    const out = await fetchWithRetry("https://x", undefined, { maxRetries: 2, delayMs: 0 });
    expect(out.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry non-429 error statuses", async () => {
    (fetch as any).mockResolvedValue(resp(500));
    const out = await fetchWithRetry("https://x", undefined, { maxRetries: 3, delayMs: 0 });
    expect(out.status).toBe(500);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("honours maxRetries: 0 (single attempt)", async () => {
    (fetch as any).mockResolvedValue(resp(429));
    const out = await fetchWithRetry("https://x", undefined, { maxRetries: 0, delayMs: 0 });
    expect(out.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes the request init through to fetch", async () => {
    (fetch as any).mockResolvedValue(resp(200));
    const init = { method: "POST", body: "{}" };
    await fetchWithRetry("https://x", init, { delayMs: 0 });
    expect(fetch).toHaveBeenCalledWith("https://x", init);
  });
});
