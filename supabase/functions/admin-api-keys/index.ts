import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin-only helper for the Admin Panel "API Keys" tab.
// Actions:
//   { action: "test", key_id }                 -> test a stored key
//   { action: "test", provider, key_value }    -> test an unsaved key
//   { action: "seed_env_keys" }                -> import legacy env-secret
//                                                 keys (GEMINI_KEY_1..20,
//                                                 GEMINI_API_KEY, GROQ_API_KEY)
//                                                 into private.api_keys
// Key values are used server-side only and are NEVER returned in responses.
// Test results are reported through report_api_key_result() so a stored
// key's health state in the panel reflects the test outcome.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Chat-completions URL for an OpenAI-compatible base URL. */
function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/**
 * Provider-side key validation. Gemini/Groq: list models (no generation
 * quota used). OpenAI-compatible: a minimal chat-completion probe
 * (1 output token), which validates endpoint + key + model together.
 */
async function testProviderKey(
  provider: string,
  keyValue: string,
  opts?: { baseUrl?: string | null; model?: string | null },
): Promise<{ ok: boolean; status: number; message: string }> {
  try {
    if (provider === "openai_compat") {
      const baseUrl = (opts?.baseUrl || "").trim();
      const model = (opts?.model || "").trim();
      if (!baseUrl || !model) {
        return {
          ok: false,
          status: 0,
          message: "OpenAI-compatible keys need a Base URL and a model to test.",
        };
      }
      const resp = await fetch(chatCompletionsUrl(baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${keyValue}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        }),
      });
      if (resp.ok) {
        const json = await resp.json().catch(() => null);
        if (json?.choices?.[0]?.message) {
          return {
            ok: true,
            status: resp.status,
            message: `Key works — model "${model}" answered the probe.`,
          };
        }
        return {
          ok: false,
          status: resp.status,
          message: "Provider answered HTTP 200 but returned no chat choices.",
        };
      }
      const txt = (await resp.text().catch(() => "")).slice(0, 300);
      return {
        ok: false,
        status: resp.status,
        message: txt || `Provider returned HTTP ${resp.status}`,
      };
    }

    let resp: Response;
    if (provider === "groq") {
      resp = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${keyValue}` },
      });
    } else {
      resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${keyValue}`,
      );
    }
    if (resp.ok) {
      return { ok: true, status: resp.status, message: "Key is valid and reachable." };
    }
    const txt = (await resp.text().catch(() => "")).slice(0, 300);
    return {
      ok: false,
      status: resp.status,
      message: txt || `Provider returned HTTP ${resp.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      message: `Network error while testing key: ${String(e).slice(0, 200)}`,
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Supabase not configured" }, 500);
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Admin role check (server-side; the UI tab alone is not the security boundary)
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) {
    return json({ error: "Admin access required" }, 403);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const action = body?.action ?? "test";

  // ---------------------------------------------------------------
  if (action === "seed_env_keys") {
    let inserted = 0;
    let alreadyPresent = 0;

    const candidates: { provider: string; label: string; value: string }[] = [];
    for (let i = 1; i <= 20; i++) {
      const v = Deno.env.get(`GEMINI_KEY_${i}`);
      if (v) candidates.push({ provider: "gemini", label: `Gemini key ${i} (from env)`, value: v });
    }
    if (candidates.length === 0) {
      const v = Deno.env.get("GEMINI_API_KEY");
      if (v) candidates.push({ provider: "gemini", label: "Gemini key (from env)", value: v });
    }
    const groq = Deno.env.get("GROQ_API_KEY");
    if (groq) candidates.push({ provider: "groq", label: "Groq key (from env)", value: groq });

    // Values already in the table (any state) count as present.
    const { data: pool } = await admin.rpc("get_api_key_pool");
    const existing = new Set<string>(
      Array.isArray(pool) ? pool.map((r: any) => `${r.provider}:${r.key_value}`) : [],
    );

    for (const c of candidates) {
      if (existing.has(`${c.provider}:${c.value}`)) {
        alreadyPresent++;
        continue;
      }
      const { error } = await admin.rpc("register_api_key", {
        _provider: c.provider,
        _label: c.label,
        _key_value: c.value,
      });
      if (!error) inserted++;
    }

    return json({
      ok: true,
      action,
      found_in_env: candidates.length,
      inserted,
      already_present: alreadyPresent,
      message:
        candidates.length === 0
          ? "No env-secret keys found on this project to import."
          : `Imported ${inserted} key(s); ${alreadyPresent} already in the pool.`,
    });
  }

  // ---------------------------------------------------------------
  if (action === "test") {
    let provider: string = body?.provider;
    let keyValue: string = body?.key_value;
    const keyId: string | null = body?.key_id ?? null;
    let baseUrl: string | null = body?.base_url ?? null;
    let model: string | null = body?.model ?? null;

    if (keyId) {
      // Resolve the stored key server-side via the service-role pool RPC.
      const { data: pool, error } = await admin.rpc("get_api_key_pool");
      if (error) return json({ ok: false, message: `Pool lookup failed: ${error.message}` });
      const row = Array.isArray(pool) ? pool.find((r: any) => r.id === keyId) : null;
      if (!row) return json({ ok: false, message: "Key not found in the pool." });
      provider = row.provider;
      keyValue = row.key_value;
      baseUrl = row.base_url ?? null;
      model = row.model ?? null;
    }

    if (!provider || !keyValue) {
      return json({ ok: false, message: "Provide either key_id or provider + key_value." }, 400);
    }
    if (provider !== "gemini" && provider !== "groq" && provider !== "openai_compat") {
      return json({ ok: false, message: `Unsupported provider: ${provider}` }, 400);
    }

    const started = Date.now();
    const result = await testProviderKey(provider, keyValue, { baseUrl, model });
    const latencyMs = Date.now() - started;

    // Reflect the outcome in the stored key's health state.
    if (keyId) {
      await admin.rpc("report_api_key_result", {
        _key_id: keyId,
        _success: result.ok,
        _error_status: result.ok ? null : result.status || null,
        _error_message: result.ok ? null : `Panel test: ${result.message}`.slice(0, 500),
        _cooldown_seconds: result.status === 429 ? 60 : null,
      });
    }

    return json({
      ok: result.ok,
      action,
      provider,
      status: result.status,
      latency_ms: latencyMs,
      message: result.message,
    });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
