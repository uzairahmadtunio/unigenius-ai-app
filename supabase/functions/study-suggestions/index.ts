import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { generateContentWithFailover } from "../_shared/ai-failover.ts";
import { enforceBodySize, clampString, clampArray } from "../_shared/limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-ai-tier, x-ai-key-index",
};

// Takes the student's aggregated quiz stats (computed client-side from
// quiz_results) and returns a short personalised study-suggestion summary.
// Called on demand only (button), never on page load.
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const tooBig = enforceBodySize(req, corsHeaders, 60_000);
  if (tooBig) return tooBig;

  try {
    const body = await req.json();
    const subjects = clampArray<any>(body.subjects, 12).map((s) => ({
      subject: clampString(s?.subject, 120),
      attempts: Math.max(0, Math.min(999, Number(s?.attempts) || 0)),
      avgPct: Math.max(0, Math.min(100, Number(s?.avgPct) || 0)),
      trend: ["improving", "declining", "steady"].includes(s?.trend) ? s.trend : "steady",
    })).filter((s) => s.subject);
    const missed = clampArray<string>(body.missedQuestions, 8).map((q) => clampString(q, 300));

    if (subjects.length === 0) {
      return new Response(JSON.stringify({ error: "No quiz history to analyse" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemText = `You are a supportive study coach for a university student. Based ONLY on the quiz performance data provided, write a short personalised study summary.

RULES:
- summary: 2-3 sentences, encouraging but honest, naming the weakest subject(s) and the strongest.
- tips: 3-5 short, concrete, actionable tips tied to the actual data (specific subjects, specific missed questions where given). No generic filler like "study hard".
- Prioritise the lowest-average and declining subjects.`;

    const userText = [
      "Quiz performance by subject (average % over attempts, trend):",
      ...subjects.map((s) => `- ${s.subject}: ${s.avgPct}% average over ${s.attempts} attempt(s), trend ${s.trend}`),
      missed.length ? `\nRecently missed questions:\n${missed.map((q) => `- ${q}`).join("\n")}` : "",
    ].filter(Boolean).join("\n");

    const toolDecl = {
      function_declarations: [{
        name: "return_suggestions",
        description: "Return a study summary and actionable tips.",
        parameters: {
          type: "OBJECT",
          properties: {
            summary: { type: "STRING" },
            tips: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["summary", "tips"],
        },
      }],
    };

    const result = await generateContentWithFailover({
      modelPath: "gemini-3.1-flash-lite",
      geminiBody: {
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        tools: [toolDecl],
        tool_config: { function_calling_config: { mode: "ANY", allowed_function_names: ["return_suggestions"] } },
      },
      corsHeaders,
      meter: { userId: auth.userId, feature: "study-suggestions" },
    });
    if (result instanceof Response) return result;

    const fc = result.data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
    if (!fc) throw new Error("No function call in response");

    return new Response(JSON.stringify({
      summary: typeof fc.functionCall.args?.summary === "string" ? fc.functionCall.args.summary : "",
      tips: Array.isArray(fc.functionCall.args?.tips) ? fc.functionCall.args.tips.slice(0, 5) : [],
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "x-ai-tier": result.tier,
        "x-ai-key-index": String(result.keyIndex),
      },
    });
  } catch (e) {
    console.error("study-suggestions error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
