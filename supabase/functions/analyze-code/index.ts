import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireAuth } from "../_shared/auth.ts";
import { generateContentWithFailover } from "../_shared/ai-failover.ts";
import { enforceBodySize, clampString } from "../_shared/limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-ai-tier, x-ai-key-index",
};

const LANG_LABELS: Record<string, string> = {
  cpp: "C++", c: "C", python: "Python", javascript: "JavaScript",
  typescript: "TypeScript", java: "Java", csharp: "C#", php: "PHP",
  go: "Go", rust: "Rust", ruby: "Ruby",
};

interface ExecInfo {
  status: "ok" | "compile_error" | "runtime_error";
  compileStderr?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}

interface RevisionInfo {
  previousCorrectedCode: string;
  problem: "still_fails" | "output_mismatch";
  actualOutput?: string;
  expectedOutput?: string;
  errorText?: string;
}

const SYSTEM_TEXT = `You are an expert programming teacher for Pakistani university students (UniGenius Code Lab). The student's program was REALLY executed in a sandbox and you are given the real result. Find EVERY mistake — not only compile errors.

Actively hunt for LOGIC errors too:
- loop bounds and off-by-one mistakes (e.g. a loop that should include the last value but stops one early: \`i < 5\` when the values 1..5 are clearly intended),
- wrong operators or conditions (< vs <=, > vs >=, && vs ||, == vs =),
- wrong variable used, uninitialized variables, integer-division surprises, missing break in switch,
- wrong array/string indices, inverted conditions, wrong accumulation,
- anything that makes the OUTPUT wrong even when the program runs without errors.

Decide the INTENDED behaviour from the code itself (variable names, printed labels, comments, classic patterns). Example: code that sums with \`for (int i = 1; i < 5; i++) sum += i;\` and prints "Sum = " clearly intends 1+2+3+4+5 = 15 — \`i < 5\` is a LOGIC mistake: you MUST list it and fix it to \`i <= 5\`.

Reply with ONLY a JSON object — no markdown fences, no extra text:
{
  "status": "mistakes" | "clean",
  "summary": "<1 short sentence in Roman Urdu, easy words>",
  "mistakes": [
    { "line": <line number in the ORIGINAL code, 1-based>, "type": "syntax" | "logic" | "runtime" | "warning", "message": "<Roman Urdu: kya galti hai, asaan alfaaz mein, 1-2 lines>", "fix": "<Roman Urdu: isay kaise theek karein, 1 short line>" }
  ],
  "correctedCode": "<the COMPLETE corrected program as one string, or null when status is clean>",
  "expectedOutput": "<the EXACT stdout the corrected program prints with the given stdin — no extra spaces/lines; empty string if it prints nothing; null when status is clean>"
}

Rules:
- "line" always points at the line in the ORIGINAL code where the mistake is (first line = line 1).
- If the program failed to compile, STILL scan the whole program for logic errors and list them as well.
- correctedCode must be the full runnable program with ALL mistakes fixed — never a snippet, never add line numbers to it.
- expectedOutput must be computed carefully by mentally running correctedCode with the given stdin.
- If the code is fully correct (compiles/runs AND the logic is right), return status "clean", mistakes: [], correctedCode: null, expectedOutput: null, and a short encouraging summary in Roman Urdu.
- All explanation text (summary, message, fix) in Roman Urdu only. Code stays as code.`;

function extractJson(text: string): any | null {
  if (!text) return null;
  let t = text.trim();
  // Strip markdown fences if the model added them anyway.
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

function validateAnalysis(a: any): any | null {
  if (!a || typeof a !== "object") return null;
  if (a.status !== "mistakes" && a.status !== "clean") return null;
  const mistakes = Array.isArray(a.mistakes) ? a.mistakes.filter((m: any) =>
    m && typeof m.message === "string",
  ).map((m: any) => ({
    line: Number.isFinite(Number(m.line)) ? Number(m.line) : 0,
    type: ["syntax", "logic", "runtime", "warning"].includes(m.type) ? m.type : "warning",
    message: String(m.message).slice(0, 600),
    fix: typeof m.fix === "string" ? m.fix.slice(0, 300) : "",
  })) : [];
  if (a.status === "clean") {
    return { status: "clean", summary: String(a.summary || "").slice(0, 300), mistakes: [], correctedCode: null, expectedOutput: null };
  }
  return {
    status: "mistakes",
    summary: String(a.summary || "").slice(0, 300),
    mistakes,
    correctedCode: typeof a.correctedCode === "string" && a.correctedCode.trim() ? a.correctedCode : null,
    expectedOutput: typeof a.expectedOutput === "string" ? a.expectedOutput : null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const tooBig = enforceBodySize(req, corsHeaders, 8_000_000);
  if (tooBig) return tooBig;

  try {
    const body = await req.json();
    const code = clampString(body.code, 50_000);
    const language = clampString(body.language, 32) || "text";
    const langLabel = LANG_LABELS[language] || language;
    const stdin = clampString(body.stdin, 20_000);
    const errorImage = typeof body.errorImage === "string" && body.errorImage.length < 7_000_000 ? body.errorImage : null;
    const exec: ExecInfo | null = body.exec && typeof body.exec === "object" ? body.exec : null;
    const revision: RevisionInfo | null = body.revision && typeof body.revision === "object" ? body.revision : null;

    if (!code.trim() && !errorImage) {
      return new Response(JSON.stringify({ error: "Code is empty" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let userText = `Language: ${langLabel}\n\nStudent's code (line 1 is the first line):\n\`\`\`${language}\n${code}\n\`\`\`\n\nSTDIN given to the program:\n${stdin ? stdin : "(empty)"}\n`;

    if (exec) {
      userText += `\nREAL execution result: status = ${exec.status}`;
      if (exec.compileStderr) userText += `\nCompiler output:\n${String(exec.compileStderr).slice(0, 3000)}`;
      if (exec.stdout) userText += `\nProgram output (stdout):\n${String(exec.stdout).slice(0, 2000)}`;
      if (exec.stderr) userText += `\nRuntime error (stderr):\n${String(exec.stderr).slice(0, 2000)}`;
      if (exec.exitCode !== undefined) userText += `\nExit code: ${exec.exitCode}`;
      userText += "\n";
    } else if (!errorImage) {
      userText += `\n(The program was not executed — review the code statically.)\n`;
    }

    if (errorImage) {
      userText += `\nThe student also shared a screenshot of an error. Look at the screenshot, find the error in it, and fix the code accordingly.\n`;
    }

    if (revision) {
      userText += `\nIMPORTANT — VERIFICATION FAILED: your previous corrected code was executed in the sandbox and did NOT pass.`;
      if (revision.problem === "still_fails") {
        userText += `\nIt still failed. Error/output seen:\n${String(revision.errorText || "").slice(0, 2000)}\nActual stdout:\n${String(revision.actualOutput || "").slice(0, 1000)}`;
      } else {
        userText += `\nIt ran, but its output did not match the expected output.\nExpected stdout:\n${String(revision.expectedOutput || "").slice(0, 1000)}\nActual stdout:\n${String(revision.actualOutput || "").slice(0, 1000)}`;
      }
      userText += `\nPrevious corrected code:\n\`\`\`${language}\n${String(revision.previousCorrectedCode || "").slice(0, 20_000)}\n\`\`\`\nRe-check EVERY logic step carefully and return a new correctedCode that really runs and prints the expected output. Keep the mistakes list accurate for the ORIGINAL student code.`;
    }

    const parts: any[] = [{ text: userText }];
    if (errorImage) {
      const base64 = errorImage.startsWith("data:") ? errorImage.split(",")[1] : errorImage;
      const mimeMatch = errorImage.match(/^data:([^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
      parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
    }
    const contents = [{ role: "user", parts }];

    const result = await generateContentWithFailover({
      modelPath: "gemini-3.5-flash",
      geminiBody: {
        system_instruction: { parts: [{ text: SYSTEM_TEXT }] },
        contents,
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      },
      corsHeaders,
      // Total budget for the WHOLE failover chain (the tiers now share
      // it — see ai-failover): 75s worst case with at most 25s per
      // single attempt, so a dead key can never eat most of the budget
      // before the rotation moves on (audit fix 2026-11-27).
      attemptTimeoutMs: 25_000,
      deadlineMs: 75_000,
      meter: { userId: auth.userId, feature: "analyze-code" },
    });

    if (result instanceof Response) return result;

    const text = (result.data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p?.text || "")
      .join("");
    const analysis = validateAnalysis(extractJson(text));
    if (!analysis) {
      console.error("analyze-code: unparseable AI output:", text.slice(0, 500));
      return new Response(
        JSON.stringify({ error: "AI analysis could not be read. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ analysis, tier: result.tier }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "x-ai-tier": result.tier,
          "x-ai-key-index": String(result.keyIndex),
        },
      },
    );
  } catch (e) {
    console.error("analyze-code error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
