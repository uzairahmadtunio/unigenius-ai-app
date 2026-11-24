// Multi-Tier AI Failover Provider
// Tier 1: Lovable AI Gateway (managed, uses LOVABLE_API_KEY) — saves user's own quota
// Tier 2: Direct Gemini API with rotation across the key pool
// Tier 3: Groq Cloud (Llama-3.3-70b) — last-resort backup
// Tier 4: Generic OpenAI-compatible pool keys (provider 'openai_compat',
//         each with its own base_url + model — OpenRouter, Cloudflare,
//         GitHub Models, NVIDIA NIM, ...). Streaming: final fallback
//         after Groq. Non-streaming: tried after Gemini, before the
//         Lovable Gateway (that path previously had no open-model
//         fallback at all). Gemini/Groq tier order is unchanged.
//
// Key pool (auto-routing): keys are managed at runtime from the Admin Panel
// and stored in private.api_keys (see migration 20261121000000). The pool is
// loaded via the service-role-only RPC get_api_key_pool() and cached in
// memory for ~45s per worker. Legacy env-secret keys (GEMINI_KEY_1..20 /
// GEMINI_API_KEY / GROQ_API_KEY) remain as fallback for any value that is
// not present in the table — once a key is seeded into the table, the table
// row (enabled/status/cooldown) is authoritative for that key.
// Per-key health is reported back via report_api_key_result():
//   429            -> key benched (cooldown, honouring Gemini's retry delay)
//   401/403/badkey -> key marked invalid + disabled, reason recorded
//   success        -> error streak reset, last-used stamped

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Legacy env-secret Gemini keys (fallback / pre-seed pool).
export const GEMINI_KEYS: string[] = (() => {
  const keys: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const k = Deno.env.get(`GEMINI_KEY_${i}`);
    if (k) keys.push(k);
  }
  // Backward compat: fall back to single key if no rotated keys configured
  if (keys.length === 0) {
    const fallback = Deno.env.get("GEMINI_API_KEY");
    if (fallback) keys.push(fallback);
  }
  return keys;
})();

// Module-level memory of the last-working key index. Persists per worker instance.
let lastWorkingKeyIndex = 0;
let lastWorkingGroqIndex = 0;
let lastWorkingCompatIndex = 0;

export function getLastWorkingKeyIndex() {
  return lastWorkingKeyIndex;
}

// ---------------------------------------------------------------------------
// DB-backed key pool
// ---------------------------------------------------------------------------

interface PoolKey {
  id: string | null; // private.api_keys id; null for env-secret keys
  value: string;
  baseUrl?: string | null; // openai_compat only: provider endpoint root
  model?: string | null; // openai_compat only: per-key model id
  localDisabled?: boolean; // set when this worker learns the key is invalid
  localCooldownUntil?: number; // epoch ms; set when this worker sees a 429
}

const POOL_CACHE_TTL_MS = 45_000;
let poolCache: {
  fetchedAt: number;
  gemini: PoolKey[];
  groq: PoolKey[];
  openaiCompat: PoolKey[];
} | null = null;
let poolLoadInFlight: Promise<void> | null = null;

// Why the pool is empty (for fast, honest 503s): how many DB keys exist in
// total, how many are currently benched by a DB-level cooldown, and when
// the soonest one comes back (epoch ms).
let poolMeta = { totalDbKeys: 0, coolingDbKeys: 0, nextRetryAt: null as number | null };

/** Snapshot of pool availability for error reporting. */
export function getPoolCooldownInfo(): {
  geminiAvailable: number;
  groqAvailable: number;
  openaiCompatAvailable: number;
  totalDbKeys: number;
  coolingDbKeys: number;
  nextRetrySeconds: number | null;
} {
  return {
    geminiAvailable: poolCache?.gemini.length ?? 0,
    groqAvailable: poolCache?.groq.length ?? 0,
    openaiCompatAvailable: poolCache?.openaiCompat.length ?? 0,
    totalDbKeys: poolMeta.totalDbKeys,
    coolingDbKeys: poolMeta.coolingDbKeys,
    nextRetrySeconds: poolMeta.nextRetryAt
      ? Math.max(1, Math.ceil((poolMeta.nextRetryAt - Date.now()) / 1000))
      : null,
  };
}

/** Build the fast-fail 503 used when no provider can even be attempted. */
function poolUnavailableResponse(corsHeaders: Record<string, string>): Response {
  const info = getPoolCooldownInfo();
  let message: string;
  if (info.totalDbKeys > 0 && info.coolingDbKeys >= info.totalDbKeys && info.nextRetrySeconds) {
    message = `AI is catching its breath — all API keys are cooling down after heavy use. Please retry in about ${info.nextRetrySeconds} seconds.`;
  } else if (info.totalDbKeys === 0) {
    message = "AI is not configured yet — no API keys are available. Please try again later.";
  } else {
    message = "All AI providers are temporarily unavailable. Please try again.";
  }
  return new Response(JSON.stringify({ error: message }), {
    status: 503,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * fetch() with a hard timeout (AbortSignal.timeout). Without this, a
 * stalled provider connection can hang an edge request for minutes —
 * the client sees a silent, endless "thinking" state.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  opts?: { headersOnly?: boolean },
): Promise<Response> {
  if (!opts?.headersOnly) {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }
  // Streaming calls: the timeout exists to bound time-to-first-byte (a
  // hung attempt must not eat the whole request). Once the response
  // headers arrive the attempt has succeeded, so the abort timer is
  // cleared — left attached, it would saw off a healthy stream
  // mid-answer (a 10–20s attempt timer vs a 60s+ streamed reply). The
  // client's own stream deadline governs the body from here.
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new DOMException("Signal timed out.", "TimeoutError"));
  }, timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(timer);
    return resp;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

let serviceClient: any = null;
function getServiceClient(): any | null {
  if (serviceClient) return serviceClient;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  serviceClient = createClient(url, key);
  return serviceClient;
}

async function ensurePoolLoaded(): Promise<void> {
  if (poolCache && Date.now() - poolCache.fetchedAt < POOL_CACHE_TTL_MS) return;
  if (poolLoadInFlight) {
    await poolLoadInFlight;
    return;
  }
  poolLoadInFlight = (async () => {
    const dbGemini: PoolKey[] = [];
    const dbGroq: PoolKey[] = [];
    const dbCompat: PoolKey[] = [];
    const dbValues = new Set<string>();
    try {
      const sb = getServiceClient();
      if (sb) {
        const { data, error } = await sb.rpc("get_api_key_pool");
        if (error) {
          console.warn("api_keys pool load failed:", error.message);
        } else if (Array.isArray(data)) {
          const now = Date.now();
          let totalDb = 0;
          let coolingDb = 0;
          let nextRetryAt: number | null = null;
          for (const row of data as any[]) {
            if (!row?.key_value) continue;
            dbValues.add(row.key_value);
            totalDb++;
            if (!row.enabled) continue;
            if (row.status === "invalid") continue;
            if (row.cooldown_until && new Date(row.cooldown_until).getTime() > now) {
              coolingDb++;
              const until = new Date(row.cooldown_until).getTime();
              if (nextRetryAt === null || until < nextRetryAt) nextRetryAt = until;
              continue;
            }
            const entry: PoolKey = { id: row.id ?? null, value: row.key_value };
            if (row.provider === "groq") dbGroq.push(entry);
            else if (row.provider === "openai_compat") {
              // A compat key is only callable with both endpoint + model;
              // rows missing either stay out of the rotation (the Admin
              // Panel requires both at insert time, so this is a guard).
              if (row.base_url && row.model) {
                dbCompat.push({ ...entry, baseUrl: row.base_url, model: row.model });
              }
            } else dbGemini.push(entry);
          }
          poolMeta = { totalDbKeys: totalDb, coolingDbKeys: coolingDb, nextRetryAt };
        }
      }
    } catch (e) {
      console.warn("api_keys pool load threw:", e);
    }

    // Merge env-secret keys AFTER DB keys, but only for values the table
    // does not know about — a seeded key is governed by its table row.
    const gemini = [...dbGemini];
    for (const v of GEMINI_KEYS) {
      if (!dbValues.has(v) && !gemini.some((k) => k.value === v)) {
        gemini.push({ id: null, value: v });
      }
    }
    const groq = [...dbGroq];
    const envGroq = Deno.env.get("GROQ_API_KEY");
    if (envGroq && !dbValues.has(envGroq) && !groq.some((k) => k.value === envGroq)) {
      groq.push({ id: null, value: envGroq });
    }

    poolCache = { fetchedAt: Date.now(), gemini, groq, openaiCompat: dbCompat };
  })();
  try {
    await poolLoadInFlight;
  } finally {
    poolLoadInFlight = null;
  }
}

// ---------------------------------------------------------------------------
// Per-key health reporting (fire-and-forget; must never break an AI call)
// ---------------------------------------------------------------------------

const lastSuccessReportAt = new Map<string, number>();
const SUCCESS_REPORT_THROTTLE_MS = 60_000;

function reportKeyResult(
  entry: PoolKey,
  result: {
    success: boolean;
    status?: number | null;
    message?: string | null;
    cooldownSeconds?: number | null;
  },
): void {
  if (!entry.id) return; // env-secret keys have no DB row to update
  if (result.success) {
    const last = lastSuccessReportAt.get(entry.id) ?? 0;
    if (Date.now() - last < SUCCESS_REPORT_THROTTLE_MS) return;
    lastSuccessReportAt.set(entry.id, Date.now());
  }
  const p = (async () => {
    try {
      const sb = getServiceClient();
      if (!sb) return;
      await sb.rpc("report_api_key_result", {
        _key_id: entry.id,
        _success: result.success,
        _error_status: result.status ?? null,
        _error_message: result.message ?? null,
        _cooldown_seconds: result.cooldownSeconds ?? null,
      });
    } catch {
      // Health reporting is best-effort only.
    }
  })();
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(p);
}

async function safeReadBody(resp: Response): Promise<string> {
  try {
    const txt = await resp.clone().text();
    return txt.slice(0, 300);
  } catch {
    return "";
  }
}

/** Parse Gemini's RetryInfo delay (seconds) from a 429 body; default 60. */
async function parseRetryDelaySeconds(resp: Response): Promise<number> {
  try {
    const json = await resp.clone().json();
    const details = json?.error?.details || [];
    for (const d of details) {
      if (String(d?.["@type"] || "").includes("RetryInfo") && d.retryDelay) {
        const secs = parseFloat(String(d.retryDelay).replace(/s$/, ""));
        if (!Number.isNaN(secs)) return Math.min(Math.max(Math.ceil(secs), 10), 600);
      }
    }
  } catch {
    // fall through to default
  }
  return 60;
}

/** Record health for a failed Gemini attempt against a pool key. */
async function classifyGeminiFailure(entry: PoolKey, resp: Response): Promise<void> {
  const status = resp.status;
  if (status === 429) {
    const secs = await parseRetryDelaySeconds(resp);
    entry.localCooldownUntil = Date.now() + secs * 1000;
    reportKeyResult(entry, {
      success: false,
      status,
      message: "Rate limited / quota exhausted (HTTP 429)",
      cooldownSeconds: secs,
    });
  } else if (status === 401 || status === 403) {
    entry.localDisabled = true;
    const txt = await safeReadBody(resp);
    reportKeyResult(entry, { success: false, status, message: txt || `HTTP ${status}` });
  } else if (status === 400) {
    const txt = await safeReadBody(resp);
    if (/API_KEY_INVALID|api key not valid|invalid api key/i.test(txt)) {
      entry.localDisabled = true;
    }
    reportKeyResult(entry, { success: false, status, message: txt || "HTTP 400" });
  } else {
    const txt = await safeReadBody(resp);
    reportKeyResult(entry, { success: false, status, message: txt || `HTTP ${status}` });
  }
}

// Rotate on ANY key-level failure: rate-limit, server error, expired/leaked key (400/401/403).
const RETRYABLE_STATUSES = new Set([400, 401, 403, 429, 500, 502, 503, 504]);

// When Google's flagship Flash tier is capacity-limited (429/5xx from
// every key in the pool), fall back to the Lite model — it runs on
// separate capacity — before dropping to the last-resort tiers.
// callGeminiWithRotation returns null when every key failed with a
// retryable status, and a Response only for non-retryable statuses,
// so "capacity failure" is exactly: null, or a 429/5xx response.
const GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";
const CAPACITY_STATUSES = new Set([429, 500, 502, 503, 504]);

function isCapacityFailure(result: { response: Response } | null): boolean {
  return result === null || CAPACITY_STATUSES.has(result.response.status);
}

// Worker-local memory that a MODEL (not a key) is capacity-dead. A 503
// "high demand" is model-level: every key in the pool gets the same
// answer, so once a rotation proves that, later requests must not
// re-prove it key by key — the rotation fails fast and the caller
// falls back (Lite model / later tiers) immediately. The mark expires
// after 45s so the primary model is retried once Google's spike
// passes. Only 5xx counts toward the mark: a 429 is per-key/project
// quota, where the next key may genuinely still work.
const MODEL_CAPACITY_STATUSES = new Set([500, 502, 503, 504]);
const MODEL_DEAD_MS = 45_000;
const CAPACITY_BAIL_STREAK = 3;
const modelDeadUntil = new Map<string, number>();

function markModelCapacityDead(modelPath: string): void {
  modelDeadUntil.set(modelPath, Date.now() + MODEL_DEAD_MS);
}

export function isModelCapacityDead(modelPath: string): boolean {
  const until = modelDeadUntil.get(modelPath);
  return until !== undefined && until > Date.now();
}

interface CallResult {
  response: Response;
  tier: "lovable" | "gemini" | "groq" | "openai_compat";
  keyIndex: number; // -1 for lovable/groq
}

/**
 * Call Gemini's REST API directly, rotating across the pool keys on
 * rate-limit / server errors. Returns the first OK response along with
 * the key index (position in the effective pool) that succeeded.
 * Exported so generate-slide-image can use the same pool.
 */
export async function callGeminiWithRotation(
  modelPath: string,
  body: unknown,
  isStream: boolean,
  opts?: { attemptTimeoutMs?: number; deadlineMs?: number },
): Promise<{ response: Response; keyIndex: number } | null> {
  // Defaults are tuned for chat (fast first byte). Long non-streamed
  // generations (e.g. a 30-question quiz) may pass a larger budget —
  // a single attempt legitimately needs longer than 30s there, and the
  // chat-tuned budget made every key attempt abort as a "timeout".
  const attemptTimeoutMs = opts?.attemptTimeoutMs ?? 30_000;
  const deadlineMs = opts?.deadlineMs ?? 45_000;
  await ensurePoolLoaded();
  const pool = poolCache?.gemini ?? [];
  const totalKeys = pool.length;
  if (totalKeys === 0) return null;
  // Fast path: a rotation moments ago proved this MODEL (not a key) is
  // capacity-dead — every key gets the same 5xx. Fail immediately so
  // the caller falls back (Lite model / later tiers) instead of
  // re-burning seconds re-proving it on every request.
  if (isModelCapacityDead(modelPath)) {
    console.warn(`Gemini model ${modelPath} is in capacity cooldown — skipping rotation`);
    return null;
  }
  const startIdx = lastWorkingKeyIndex % totalKeys;
  const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";
  const action = isStream
    ? `${modelPath}:streamGenerateContent?alt=sse&key=`
    : `${modelPath}:generateContent?key=`;

  // Keys this worker knows are cooling down are skipped in BOTH passes —
  // Google already told us exactly when to come back, so re-hitting them
  // only burns time (this was half of the multi-minute chat hang). Pass 1
  // exists only to retry keys whose attempt threw (network blip) without a
  // verdict. Keys learned to be invalid are always skipped by this worker.
  // Every attempt is timeout-bounded and the whole rotation has a hard
  // deadline, so the caller always gets a fast, honest failure.
  const deadline = Date.now() + deadlineMs;
  let totalAttempted = 0;
  let totalCapacity = 0;
  let consecutiveCapacity = 0;
  for (let pass = 0; pass < 2; pass++) {
    let attempted = 0;
    for (let i = 0; i < totalKeys; i++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const idx = (startIdx + i) % totalKeys;
      const entry = pool[idx];
      if (entry.localDisabled) continue;
      if (entry.localCooldownUntil && entry.localCooldownUntil > Date.now()) continue;
      attempted++;
      totalAttempted++;
      try {
        const resp = await fetchWithTimeout(`${baseUrl}/${action}${entry.value}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }, Math.min(attemptTimeoutMs, remaining), { headersOnly: isStream });
        if (resp.ok) {
          lastWorkingKeyIndex = idx;
          reportKeyResult(entry, { success: true });
          return { response: resp, keyIndex: idx };
        }
        if (!RETRYABLE_STATUSES.has(resp.status)) {
          // Non-retryable error (e.g. 400 bad request, 404 retired model).
          // Still record it against the key so the failure is visible in
          // the Admin Panel instead of failing silently, then surface it.
          await classifyGeminiFailure(entry, resp);
          return { response: resp, keyIndex: idx };
        }
        console.warn(`Gemini key #${idx} returned ${resp.status}, rotating...`);
        await classifyGeminiFailure(entry, resp);
        if (MODEL_CAPACITY_STATUSES.has(resp.status)) {
          // Model-level failure: after a short streak, more keys will
          // not help — mark the model dead and bail so the caller can
          // fall back NOW instead of after the whole pool.
          consecutiveCapacity++;
          totalCapacity++;
          if (consecutiveCapacity >= CAPACITY_BAIL_STREAK) {
            markModelCapacityDead(modelPath);
            console.warn(
              `Gemini model ${modelPath} capacity-dead (${CAPACITY_BAIL_STREAK} consecutive 5xx) — bailing to fallback`,
            );
            return null;
          }
        }
      } catch (e) {
        console.warn(`Gemini key #${idx} threw:`, e);
        reportKeyResult(entry, {
          success: false,
          status: null,
          message: String(e).slice(0, 300),
        });
        // A stall/timeout is indistinguishable from provider overload
        // for routing purposes — count it toward the capacity streak.
        consecutiveCapacity++;
        totalCapacity++;
        if (consecutiveCapacity >= CAPACITY_BAIL_STREAK) {
          markModelCapacityDead(modelPath);
          console.warn(
            `Gemini model ${modelPath} capacity-dead (${CAPACITY_BAIL_STREAK} consecutive stalls) — bailing to fallback`,
          );
          return null;
        }
      }
    }
    if (attempted === 0 && pass === 0) continue;
    break;
  }
  // Every attempt failed on model capacity (e.g. a pool smaller than
  // the bail streak): remember it so the next request skips the dead
  // model instead of re-proving it key by key.
  if (totalAttempted >= 2 && totalCapacity === totalAttempted) {
    markModelCapacityDead(modelPath);
  }
  return null;
}

/**
 * Try Lovable AI Gateway (OpenAI-compatible) first. Only suitable for text-only payloads.
 * Returns null if the gateway fails or is unavailable.
 */
async function callLovableGateway(
  openaiPayload: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<Response | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const resp = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "edge-fetch",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(openaiPayload),
    }, timeoutMs, { headersOnly: true }); // streaming-only helper: bound first byte, not the stream
    if (resp.ok) return resp;
    console.warn("Lovable Gateway returned", resp.status);
    return null;
  } catch (e) {
    console.warn("Lovable Gateway threw:", e);
    return null;
  }
}

function toGatewayModel(modelPath: string): string {
  return modelPath.startsWith("google/") ? modelPath : `google/${modelPath}`;
}

/**
 * Tier 3: Groq (Llama-3.3-70b). OpenAI-compatible streaming.
 * Rotates across the Groq pool keys (DB first, env GROQ_API_KEY fallback).
 */
async function callGroq(
  openaiPayload: Record<string, unknown>,
  opts?: { attemptTimeoutMs?: number; deadlineMs?: number },
): Promise<Response | null> {
  await ensurePoolLoaded();
  const pool = poolCache?.groq ?? [];
  if (pool.length === 0) return null;
  const attemptTimeoutMs = opts?.attemptTimeoutMs ?? 30_000;
  const deadline = Date.now() + (opts?.deadlineMs ?? Number.POSITIVE_INFINITY);
  const body = { ...openaiPayload, model: "llama-3.3-70b-versatile" };
  const startIdx = lastWorkingGroqIndex % pool.length;

  for (let pass = 0; pass < 2; pass++) {
    let attempted = 0;
    for (let i = 0; i < pool.length; i++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const idx = (startIdx + i) % pool.length;
      const entry = pool[idx];
      if (entry.localDisabled) continue;
      if (entry.localCooldownUntil && entry.localCooldownUntil > Date.now()) continue;
      attempted++;
      try {
        const resp = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${entry.value}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }, Math.min(attemptTimeoutMs, remaining), { headersOnly: (openaiPayload as any)?.stream === true });
        if (resp.ok) {
          lastWorkingGroqIndex = idx;
          reportKeyResult(entry, { success: true });
          return resp;
        }
        console.warn("Groq key #", idx, "returned", resp.status);
        if (resp.status === 401 || resp.status === 403) {
          entry.localDisabled = true;
          reportKeyResult(entry, {
            success: false,
            status: resp.status,
            message: (await safeReadBody(resp)) || `HTTP ${resp.status}`,
          });
        } else if (resp.status === 429) {
          entry.localCooldownUntil = Date.now() + 60_000;
          reportKeyResult(entry, {
            success: false,
            status: 429,
            message: "Rate limited (HTTP 429)",
            cooldownSeconds: 60,
          });
        } else {
          reportKeyResult(entry, {
            success: false,
            status: resp.status,
            message: `HTTP ${resp.status}`,
          });
        }
      } catch (e) {
        console.warn("Groq threw:", e);
        reportKeyResult(entry, {
          success: false,
          status: null,
          message: String(e).slice(0, 300),
        });
      }
    }
    if (attempted === 0 && pass === 0) continue;
    break;
  }
  return null;
}

/**
 * Chat-completions URL for an OpenAI-compatible provider base URL.
 * base_url is stored without a trailing slash; tolerate one anyway.
 * Exported for unit tests.
 */
export function openAICompatChatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Tier 4: generic OpenAI-compatible providers. Modeled on callGroq —
 * same two-pass rotation, same local cooldown/disabled handling, same
 * reportKeyResult() health reporting — except each key carries its
 * own base_url + model (private.api_keys.base_url / .model).
 * Exported so the tier can be exercised directly in verification.
 */
export async function callOpenAICompatWithRotation(
  openaiPayload: Record<string, unknown>,
  opts?: { attemptTimeoutMs?: number; deadlineMs?: number },
): Promise<Response | null> {
  await ensurePoolLoaded();
  const pool = poolCache?.openaiCompat ?? [];
  if (pool.length === 0) return null;
  const timeoutMs = opts?.attemptTimeoutMs ?? 30_000;
  const deadline = Date.now() + (opts?.deadlineMs ?? Number.POSITIVE_INFINITY);
  const startIdx = lastWorkingCompatIndex % pool.length;

  for (let pass = 0; pass < 2; pass++) {
    let attempted = 0;
    for (let i = 0; i < pool.length; i++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const idx = (startIdx + i) % pool.length;
      const entry = pool[idx];
      if (entry.localDisabled) continue;
      if (entry.localCooldownUntil && entry.localCooldownUntil > Date.now()) continue;
      if (!entry.baseUrl || !entry.model) continue;
      attempted++;
      try {
        const resp = await fetchWithTimeout(openAICompatChatUrl(entry.baseUrl), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${entry.value}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...openaiPayload, model: entry.model }),
        }, Math.min(timeoutMs, remaining), { headersOnly: (openaiPayload as any)?.stream === true });
        if (resp.ok) {
          lastWorkingCompatIndex = idx;
          reportKeyResult(entry, { success: true });
          return resp;
        }
        console.warn("OpenAI-compat key #", idx, "returned", resp.status);
        if (resp.status === 401 || resp.status === 403) {
          entry.localDisabled = true;
          reportKeyResult(entry, {
            success: false,
            status: resp.status,
            message: (await safeReadBody(resp)) || `HTTP ${resp.status}`,
          });
        } else if (resp.status === 429) {
          entry.localCooldownUntil = Date.now() + 60_000;
          reportKeyResult(entry, {
            success: false,
            status: 429,
            message: "Rate limited (HTTP 429)",
            cooldownSeconds: 60,
          });
        } else {
          reportKeyResult(entry, {
            success: false,
            status: resp.status,
            message: (await safeReadBody(resp)) || `HTTP ${resp.status}`,
          });
        }
      } catch (e) {
        console.warn("OpenAI-compat threw:", e);
        reportKeyResult(entry, {
          success: false,
          status: null,
          message: String(e).slice(0, 300),
        });
      }
    }
    if (attempted === 0 && pass === 0) continue;
    break;
  }
  return null;
}

/**
 * Reshape an OpenAI chat-completion JSON into the Gemini
 * candidates[0].content.parts[] shape non-streaming callers expect
 * (same mapping the Lovable Gateway path applies). Exported for tests.
 */
export function openAIResponseToGeminiShape(json: any): any {
  const msg = json?.choices?.[0]?.message;
  const parts: any[] = [];
  if (msg?.content) parts.push({ text: String(msg.content) });
  for (const tc of msg?.tool_calls || []) {
    let args: any = {};
    try { args = JSON.parse(tc?.function?.arguments || "{}"); } catch { args = {}; }
    parts.push({ functionCall: { name: tc?.function?.name, args } });
  }
  return { candidates: [{ content: { parts } }] };
}

/**
 * Non-streaming OpenAI-compatible call shaped like Gemini output,
 * mirroring callLovableGatewayAsGemini for the compat tier.
 */
async function callOpenAICompatAsGemini(
  geminiBody: Record<string, unknown>,
  modelPath: string,
  attemptTimeoutMs?: number,
): Promise<any | null> {
  const payload = geminiBodyToOpenAI(geminiBody, modelPath);
  const resp = await callOpenAICompatWithRotation(
    payload,
    { attemptTimeoutMs: attemptTimeoutMs ?? 45_000 },
  );
  if (!resp) return null;
  try {
    const json = await resp.json();
    if (!json?.choices?.[0]?.message) {
      console.warn("OpenAI-compat (gen) returned no choices");
      return null;
    }
    return openAIResponseToGeminiShape(json);
  } catch (e) {
    console.warn("OpenAI-compat (gen) response parse failed:", e);
    return null;
  }
}

/**
 * Convert Gemini-native messages back into OpenAI chat-completion form (text-only).
 * Used when falling back to Lovable Gateway / Groq.
 */
export function geminiContentsToOpenAI(
  contents: any[],
  systemText?: string,
): any[] {
  const msgs: any[] = [];
  if (systemText) msgs.push({ role: "system", content: systemText });
  for (const c of contents || []) {
    const role = c.role === "model" ? "assistant" : "user";
    const blocks: any[] = [];
    for (const p of c.parts || []) {
      if (p.text) blocks.push({ type: "text", text: p.text });
      const inline = p.inline_data || p.inlineData;
      const mimeType = inline?.mime_type || inline?.mimeType;
      if (inline?.data && mimeType) {
        if (String(mimeType).startsWith("image/")) {
          blocks.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${inline.data}` } });
        } else if (String(mimeType).includes("pdf")) {
          blocks.push({ type: "file", file: { filename: "uploaded-brief.pdf", file_data: `data:${mimeType};base64,${inline.data}` } });
        }
      }
    }
    if (blocks.length === 1 && blocks[0].type === "text") msgs.push({ role, content: blocks[0].text });
    else if (blocks.length > 0) msgs.push({ role, content: blocks });
  }
  return msgs;
}

/**
 * Detects whether Gemini contents include non-text parts (images / files).
 */
export function hasMultimodal(contents: any[]): boolean {
  for (const c of contents || []) {
    for (const p of c.parts || []) {
      if (p.inline_data || p.inlineData || p.file_data || p.fileData) return true;
    }
  }
  return false;
}

/**
 * Does this accumulated SSE text contain at least one chunk with real
 * generated content? Role-only openers, finish chunks, heartbeats and
 * "[DONE]" do not count; a delta carrying text (or a tool call) does.
 * Unparseable lines are ignored — a data line split across network
 * chunks simply completes on a later read.
 */
function streamTextHasContent(text: string): boolean {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const jsonStr = t.slice(5).trim();
    if (!jsonStr || jsonStr === "[DONE]") continue;
    try {
      const parsed = JSON.parse(jsonStr);
      const delta = parsed?.choices?.[0]?.delta;
      if (delta) {
        if (typeof delta.content === "string" && delta.content.length > 0) return true;
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) return true;
        if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) return true;
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) return true;
      }
      const part = parsed?.candidates?.[0]?.content?.parts?.[0];
      if (part?.text || part?.functionCall) return true;
    } catch {
      // partial JSON — keep buffering
    }
  }
  return false;
}

/**
 * Confirm a provider SSE stream actually carries content before the
 * caller claims the tier succeeded. Some providers answer HTTP 200
 * with a non-SSE body (observed live 2026-11-24: the GitHub Models
 * compat key returns the literal text "OK" from this network) or an
 * immediately-empty stream — passing that through shows the user a
 * blank reply dressed as success. This peeks: it buffers until the
 * first content chunk, then returns a stream that replays the buffer
 * and continues with the live body (first-byte latency unchanged).
 * Returns null when the stream ends, errors, or stays content-free
 * for `timeoutMs` — the caller then falls through to the next tier
 * or the clean final error.
 */
async function confirmStreamContent(
  body: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStream<Uint8Array> | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const buffered: Uint8Array[] = [];
  let text = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        await reader.cancel().catch(() => {});
        return null;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutP = new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), remaining);
      });
      const readP = reader.read().then((r) => ({ timedOut: false as const, ...r }));
      readP.catch(() => {}); // if the timeout wins the race, swallow a late read error
      const r = await Promise.race([readP, timeoutP]);
      if (timer) clearTimeout(timer);
      if ((r as any).timedOut) {
        await reader.cancel().catch(() => {});
        return null;
      }
      const { done, value } = r as { done: boolean; value?: Uint8Array };
      if (done) return null;
      if (value) {
        buffered.push(value);
        text += decoder.decode(value, { stream: true });
        if (streamTextHasContent(text)) {
          return new ReadableStream<Uint8Array>({
            pull(controller) {
              if (buffered.length > 0) {
                controller.enqueue(buffered.shift()!);
                return;
              }
              return reader.read().then(({ done: d, value: v }) => {
                if (d) controller.close();
                else if (v) controller.enqueue(v);
              });
            },
            cancel(reason) {
              return reader.cancel(reason);
            },
          });
        }
      }
    }
  } catch {
    return null;
  }
}

/**
 * Streaming chat helper. Tries Tier 1 → Tier 2 → Tier 3 → Tier 4.
 * Returns an SSE-compatible Response in OpenAI delta format,
 * tagged with x-ai-tier and x-ai-key-index headers.
 */
export async function streamChatWithFailover({
  modelPath,
  geminiBody,
  systemText,
  contents,
  allowLovable = true,
  allowGroq = true,
  allowOpenAICompat = true,
  corsHeaders,
}: {
  modelPath: string;
  geminiBody: Record<string, unknown>;
  systemText?: string;
  contents: any[];
  allowLovable?: boolean;
  allowGroq?: boolean;
  allowOpenAICompat?: boolean;
  corsHeaders: Record<string, string>;
}): Promise<Response> {
  const multimodal = hasMultimodal(contents);

  // One shared time budget for the whole streaming path. Previously each
  // tier carried its own independent 30–45s budget and the tiers ran
  // back-to-back, so a request could take ~80s or more to produce its
  // first byte (measured live 2026-11-24: 79.9s — Gemini Flash rotation
  // burned its full 45s deadline against 503/timeout responses, then the
  // Flash-Lite rotation burned ~35s more, and only then did the healthy
  // last-resort tier answer). The client gives up at 60s, so the user
  // saw endless typing dots and no error. Now every tier gets a
  // shrinking slice of a single 55s budget: response headers always
  // arrive inside the client's cap, and the fallback tiers are actually
  // reached in time to help. The slices below are worst-case bounds,
  // rarely consumed in full: the Gemini rotation now bails out of a
  // capacity-dead model after 3 consecutive 5xx/stalls (and remembers
  // it for 45s per worker), so a Google "high demand" spike costs a
  // few seconds before the Lite model answers, not a full slice.
  const streamStart = Date.now();
  const STREAM_BUDGET_MS = 55_000;
  const remainingMs = () => STREAM_BUDGET_MS - (Date.now() - streamStart);

  // Tier 1: Lovable Gateway (supports text + image/PDF blocks in chat-completions format)
  if (allowLovable) {
    const openaiMessages = geminiContentsToOpenAI(contents, systemText);
    const lovableResp = await callLovableGateway({
      model: toGatewayModel(modelPath),
      messages: openaiMessages,
      max_tokens: (geminiBody as any)?.generationConfig?.maxOutputTokens || 8192,
      temperature: (geminiBody as any)?.generationConfig?.temperature ?? 0.5,
      stream: true,
    }, Math.max(1_000, Math.min(10_000, remainingMs())));
    if (lovableResp && lovableResp.body) {
      const confirmed = await confirmStreamContent(
        lovableResp.body,
        Math.max(1_000, Math.min(10_000, remainingMs())),
      );
      if (confirmed) {
        return new Response(confirmed, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "x-ai-tier": "lovable",
            "x-ai-key-index": "-1",
          },
        });
      }
      console.warn("Lovable Gateway stream carried no content — falling through");
    }
  }

  // Tier 2: Direct Gemini with key rotation
  let geminiResult = remainingMs() > 0
    ? await callGeminiWithRotation(modelPath, geminiBody, true, {
      attemptTimeoutMs: Math.min(10_000, remainingMs()),
      deadlineMs: Math.min(15_000, remainingMs()),
    })
    : null;
  if (!geminiResult?.response?.ok && modelPath !== GEMINI_FALLBACK_MODEL && isCapacityFailure(geminiResult) && remainingMs() > 4_000) {
    const fb = await callGeminiWithRotation(GEMINI_FALLBACK_MODEL, geminiBody, true, {
      attemptTimeoutMs: Math.min(10_000, remainingMs()),
      deadlineMs: Math.min(12_000, remainingMs()),
    });
    if (fb) geminiResult = fb;
  }
  if (geminiResult && geminiResult.response.ok) {
    const transformed = transformGeminiSSEToOpenAI(geminiResult.response);
    const confirmed = await confirmStreamContent(
      transformed,
      Math.max(1_000, Math.min(15_000, remainingMs())),
    );
    if (confirmed) {
      return new Response(confirmed, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "x-ai-tier": "gemini",
          "x-ai-key-index": String(geminiResult.keyIndex),
        },
      });
    }
    console.warn("Gemini stream carried no content — falling through");
  }

  // Tier 3: Groq backup
  if (allowGroq && remainingMs() > 2_000) {
    const openaiMessages = geminiContentsToOpenAI(contents, systemText);
    const groqResp = await callGroq(
      { messages: openaiMessages, stream: true },
      {
        attemptTimeoutMs: Math.min(15_000, remainingMs()),
        deadlineMs: Math.min(10_000, remainingMs()),
      },
    );
    if (groqResp && groqResp.body) {
      const confirmed = await confirmStreamContent(
        groqResp.body,
        Math.max(1_000, Math.min(10_000, remainingMs())),
      );
      if (confirmed) {
        return new Response(confirmed, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "x-ai-tier": "groq",
            "x-ai-key-index": "-1",
          },
        });
      }
      console.warn("Groq stream carried no content — falling through");
    }
  }

  // Tier 4: OpenAI-compatible pool keys (final fallback)
  if (allowOpenAICompat && remainingMs() > 2_000) {
    const openaiMessages = geminiContentsToOpenAI(contents, systemText);
    const compatResp = await callOpenAICompatWithRotation(
      {
        messages: openaiMessages,
        stream: true,
      },
      {
        attemptTimeoutMs: Math.min(20_000, remainingMs()),
        deadlineMs: Math.min(20_000, remainingMs()),
      },
    );
    if (compatResp && compatResp.body) {
      const confirmed = await confirmStreamContent(
        compatResp.body,
        Math.max(1_000, Math.min(15_000, remainingMs())),
      );
      if (confirmed) {
        return new Response(confirmed, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "x-ai-tier": "openai_compat",
            "x-ai-key-index": "-1",
          },
        });
      }
      console.warn("OpenAI-compat stream carried no content — falling through");
    }
  }

  // All tiers failed — if nothing could even be attempted (empty pool),
  // say exactly why and when to retry instead of a generic 503.
  if (getPoolCooldownInfo().geminiAvailable === 0) {
    return poolUnavailableResponse(corsHeaders);
  }
  return new Response(
    JSON.stringify({ error: "All AI providers are temporarily unavailable. Please try again." }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

/**
 * Recursively lowercases Gemini's schema "type" fields (OBJECT/ARRAY/STRING ...)
 * so the schema is valid JSON Schema for OpenAI-compatible tool calling.
 */
function geminiSchemaToOpenAI(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(geminiSchemaToOpenAI);
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "type" && typeof v === "string") {
      out.type = v.toLowerCase();
    } else if (k === "properties" && v && typeof v === "object") {
      out.properties = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        out.properties[pk] = geminiSchemaToOpenAI(pv);
      }
    } else if (k === "items") {
      out.items = geminiSchemaToOpenAI(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Translate a Gemini-style body (system_instruction + contents + tools/function_declarations)
 * into an OpenAI chat-completions body suitable for the Lovable AI Gateway.
 */
function geminiBodyToOpenAI(geminiBody: any, modelPath = "gemini-3.5-flash"): Record<string, unknown> {
  const systemText: string | undefined =
    geminiBody?.system_instruction?.parts?.map((p: any) => p.text).filter(Boolean).join("\n");
  const messages: any[] = [];
  if (systemText) messages.push({ role: "system", content: systemText });

  for (const c of geminiBody?.contents || []) {
    const role = c.role === "model" ? "assistant" : "user";
    const blocks: any[] = [];
    for (const p of c.parts || []) {
      if (p.text) blocks.push({ type: "text", text: p.text });
      const inline = p.inline_data || p.inlineData;
      if (inline?.data && inline?.mime_type) {
        if (String(inline.mime_type).startsWith("image/")) {
          blocks.push({
            type: "image_url",
            image_url: { url: `data:${inline.mime_type};base64,${inline.data}` },
          });
        } else if (String(inline.mime_type).includes("pdf")) {
          blocks.push({
            type: "file",
            file: { filename: "uploaded-brief.pdf", file_data: `data:${inline.mime_type};base64,${inline.data}` },
          });
        }
      }
    }
    if (blocks.length === 1 && blocks[0].type === "text") {
      messages.push({ role, content: blocks[0].text });
    } else if (blocks.length > 0) {
      messages.push({ role, content: blocks });
    }
  }

  const tools: any[] = [];
  let toolChoice: any;
  for (const t of geminiBody?.tools || []) {
    for (const fd of t.function_declarations || []) {
      tools.push({
        type: "function",
        function: {
          name: fd.name,
          description: fd.description || "",
          parameters: geminiSchemaToOpenAI(fd.parameters) || { type: "object", properties: {} },
        },
      });
    }
  }
  const allowed: string[] | undefined =
    geminiBody?.tool_config?.function_calling_config?.allowed_function_names;
  if (allowed && allowed.length === 1) {
    toolChoice = { type: "function", function: { name: allowed[0] } };
  } else if (tools.length > 0) {
    toolChoice = "auto";
  }

  return {
    model: toGatewayModel(modelPath),
    messages,
    max_tokens: geminiBody?.generationConfig?.maxOutputTokens || 8192,
    temperature: geminiBody?.generationConfig?.temperature ?? 0.5,
    ...(tools.length > 0 ? { tools, tool_choice: toolChoice } : {}),
  };
}

/**
 * Call Lovable AI Gateway and reshape the response to match Gemini's
 * candidates[0].content.parts[].functionCall shape that existing callers expect.
 */
async function callLovableGatewayAsGemini(
  geminiBody: Record<string, unknown>,
  modelPath: string,
): Promise<any | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const payload = geminiBodyToOpenAI(geminiBody, modelPath);
    const resp = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "edge-fetch",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }, 45_000);
    if (!resp.ok) {
      console.warn("Lovable Gateway (gen) returned", resp.status, await resp.text().catch(() => ""));
      return null;
    }
    const json = await resp.json();
    const msg = json?.choices?.[0]?.message;
    const parts: any[] = [];
    if (msg?.content) parts.push({ text: String(msg.content) });
    for (const tc of msg?.tool_calls || []) {
      let args: any = {};
      try { args = JSON.parse(tc?.function?.arguments || "{}"); } catch { args = {}; }
      parts.push({ functionCall: { name: tc?.function?.name, args } });
    }
    return { candidates: [{ content: { parts } }] };
  } catch (e) {
    console.warn("Lovable Gateway (gen) threw:", e);
    return null;
  }
}

/**
 * Non-streaming JSON helper (for tool-calling / structured output).
 * Order: Gemini key rotation → OpenAI-compatible pool → Lovable AI
 * Gateway fallback (LOVABLE_API_KEY). The compat tier gives this path
 * an open-model fallback it never had; the Lovable fallback remains
 * critical when Gemini keys are revoked/leaked.
 */
export async function generateContentWithFailover({
  modelPath,
  geminiBody,
  corsHeaders,
  attemptTimeoutMs,
  deadlineMs,
}: {
  modelPath: string;
  geminiBody: Record<string, unknown>;
  corsHeaders: Record<string, string>;
  attemptTimeoutMs?: number;
  deadlineMs?: number;
}): Promise<
  { data: any; tier: "gemini" | "lovable" | "openai_compat"; keyIndex: number } | Response
> {
  const budget = { attemptTimeoutMs, deadlineMs };
  let result = await callGeminiWithRotation(modelPath, geminiBody, false, budget);
  if (!result?.response?.ok && modelPath !== GEMINI_FALLBACK_MODEL && isCapacityFailure(result)) {
    const fb = await callGeminiWithRotation(GEMINI_FALLBACK_MODEL, geminiBody, false, budget);
    if (fb) result = fb;
  }

  // Success on Gemini
  if (result && result.response.ok) {
    const data = await result.response.json();
    return { data, tier: "gemini", keyIndex: result.keyIndex };
  }

  // Gemini failed (rate-limit, leaked key 403, server error, etc.) —
  // try the OpenAI-compatible pool, then the Lovable Gateway.
  if (result && !result.response.ok) {
    const errText = await result.response.text().catch(() => "");
    console.error("Gemini final error:", result.response.status, errText);
  }

  const compatData = await callOpenAICompatAsGemini(geminiBody, modelPath, attemptTimeoutMs);
  if (compatData) {
    return { data: compatData, tier: "openai_compat", keyIndex: -1 };
  }

  const lovableData = await callLovableGatewayAsGemini(geminiBody, modelPath);
  if (lovableData) {
    return { data: lovableData, tier: "lovable", keyIndex: -1 };
  }

  // Nothing could even be attempted (empty pool) — fast, specific 503.
  if (result === null && getPoolCooldownInfo().geminiAvailable === 0) {
    return poolUnavailableResponse(corsHeaders);
  }

  // Both providers failed
  const status = result?.response.status === 429 ? 429 : 503;
  const message = status === 429
    ? "Rate limit exceeded. Please try again shortly."
    : "AI service temporarily unavailable. Please try again.";
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

/**
 * Pipe Gemini SSE stream → OpenAI-compatible delta stream.
 */
function transformGeminiSSEToOpenAI(geminiResp: Response): ReadableStream<Uint8Array> {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    const reader = geminiResp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6);
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              await writer.write(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, index: 0 }] })}\n\n`,
                ),
              );
            }
          } catch {}
        }
      }
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch (e) {
      console.error("SSE transform error:", e);
    } finally {
      writer.close();
    }
  })();

  return readable;
}
