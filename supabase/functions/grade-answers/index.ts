import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { generateContentWithFailover } from "../_shared/ai-failover.ts";
import { enforceBodySize, clampString, clampArray } from "../_shared/limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-ai-tier, x-ai-key-index",
};

// Each subjective answer is graded out of this many marks. The frontend
// (PracticePage) uses the same constant when it totals the attempt.
export const MAX_MARKS_PER_ANSWER = 5;

interface GradeItem {
  question: string;
  modelAnswer: string;
  keyPoints: string[];
  studentAnswer: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const tooBig = enforceBodySize(req, corsHeaders, 200_000);
  if (tooBig) return tooBig;

  try {
    const body = await req.json();
    const subject = clampString(body.subject, 200);
    const rawItems = clampArray<any>(body.items, 10);
    const items: GradeItem[] = rawItems.map((it) => ({
      question: clampString(it?.question, 2000),
      modelAnswer: clampString(it?.modelAnswer, 4000),
      keyPoints: clampArray<string>(it?.keyPoints, 8).map((k) => clampString(k, 300)),
      studentAnswer: clampString(it?.studentAnswer, 4000),
    })).filter((it) => it.question);

    if (items.length === 0) {
      return new Response(JSON.stringify({ error: "No answers to grade" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemText = `You are a fair, encouraging university examiner grading short-answer responses for the subject "${subject || "General"}". Grade each student answer against its model answer and key points.

GRADING RULES:
- Award an integer score from 0 to ${MAX_MARKS_PER_ANSWER} per answer.
- verdict: "correct" when the answer covers essentially all key points (score 4-${MAX_MARKS_PER_ANSWER}), "partial" when it covers some key points or has notable gaps (score 2-3), "wrong" when it misses the point, is blank, or is factually incorrect (score 0-1).
- A blank or "I don't know" answer scores 0 with verdict "wrong".
- Judge meaning, not wording — correct ideas in the student's own words earn full credit.
- whatWasRight: name the key points/ideas the student DID cover (empty string if none).
- whatWasMissing: name the key points/ideas that were absent or wrong (empty string if nothing important is missing).
- howToImprove: one concrete, specific tip for this answer.
- Return exactly one grade per item, in the same order, with the item's index.`;

    const userText = items.map((it, i) => [
      `ITEM ${i}:`,
      `Question: ${it.question}`,
      `Model answer: ${it.modelAnswer}`,
      it.keyPoints.length ? `Key points: ${it.keyPoints.join("; ")}` : "",
      `Student answer: ${it.studentAnswer || "(blank)"}`,
    ].filter(Boolean).join("\n")).join("\n\n");

    const toolDecl = {
      function_declarations: [{
        name: "return_grades",
        description: "Return one grade per submitted answer, in order.",
        parameters: {
          type: "OBJECT",
          properties: {
            grades: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  index: { type: "INTEGER" },
                  verdict: { type: "STRING", enum: ["correct", "partial", "wrong"] },
                  score: { type: "INTEGER" },
                  whatWasRight: { type: "STRING" },
                  whatWasMissing: { type: "STRING" },
                  howToImprove: { type: "STRING" },
                },
                required: ["index", "verdict", "score", "whatWasRight", "whatWasMissing", "howToImprove"],
              },
            },
          },
          required: ["grades"],
        },
      }],
    };

    const result = await generateContentWithFailover({
      modelPath: "gemini-3.5-flash",
      geminiBody: {
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        tools: [toolDecl],
        tool_config: { function_calling_config: { mode: "ANY", allowed_function_names: ["return_grades"] } },
      },
      corsHeaders,
      meter: { userId: auth.userId, feature: "grade-answers" },
    });
    if (result instanceof Response) return result;

    const fc = result.data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
    if (!fc) throw new Error("No function call in response");

    // Normalise: guarantee one grade per item, clamped scores.
    const rawGrades: any[] = Array.isArray(fc.functionCall.args?.grades) ? fc.functionCall.args.grades : [];
    const grades = items.map((_, i) => {
      const g = rawGrades.find((r) => r?.index === i) || rawGrades[i] || {};
      const score = Math.max(0, Math.min(MAX_MARKS_PER_ANSWER, Math.round(Number(g.score) || 0)));
      const verdict = ["correct", "partial", "wrong"].includes(g.verdict)
        ? g.verdict
        : score >= 4 ? "correct" : score >= 2 ? "partial" : "wrong";
      return {
        index: i,
        verdict,
        score,
        maxScore: MAX_MARKS_PER_ANSWER,
        whatWasRight: typeof g.whatWasRight === "string" ? g.whatWasRight : "",
        whatWasMissing: typeof g.whatWasMissing === "string" ? g.whatWasMissing : "",
        howToImprove: typeof g.howToImprove === "string" ? g.howToImprove : "",
      };
    });

    return new Response(JSON.stringify({ grades }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "x-ai-tier": result.tier,
        "x-ai-key-index": String(result.keyIndex),
      },
    });
  } catch (e) {
    console.error("grade-answers error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
