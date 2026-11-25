import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode, decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { requireAuth } from "../_shared/auth.ts";
import { enforceBodySize, clampString } from "../_shared/limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Primary executor: Judge0 CE public instance (free, no key).
// https://ce.judge0.com — submissions with wait=true return the final result.
const JUDGE0_URL = "https://ce.judge0.com/submissions?base64_encoded=true&wait=true";

// Fallback executor: Wandbox (free public sandbox) — only for the three
// languages it covers well. NOTE: Wandbox retires old compiler versions;
// the previous Python breakage was caused by pinning cpython-3.12.7 after
// Wandbox removed it ("Unknown compiler" -> surfaced as a 500).
const WANDBOX_URL = "https://wandbox.org/api/compile.json";

interface LangTarget {
  judge0Id: number;
  label: string;
  wandboxCompiler?: string;
}

const LANG_MAP: Record<string, LangTarget> = {
  cpp:        { judge0Id: 105, label: "C++ (GCC 14.1.0)",        wandboxCompiler: "gcc-13.2.0" },
  c:          { judge0Id: 50,  label: "C (GCC 9.2.0)" },
  python:     { judge0Id: 109, label: "Python 3.13.2",           wandboxCompiler: "cpython-3.13.18" },
  javascript: { judge0Id: 97,  label: "JavaScript (Node.js 20)", wandboxCompiler: "nodejs-20.17.0" },
  typescript: { judge0Id: 101, label: "TypeScript 5.6" },
  java:       { judge0Id: 91,  label: "Java (JDK 17)" },
  csharp:     { judge0Id: 51,  label: "C# (Mono 6.6)" },
  php:        { judge0Id: 98,  label: "PHP 8.3" },
  go:         { judge0Id: 107, label: "Go 1.23" },
  rust:       { judge0Id: 108, label: "Rust 1.85" },
  ruby:       { judge0Id: 72,  label: "Ruby 2.7" },
};

const b64encode = (s: string) => encode(new TextEncoder().encode(s));
const b64decode = (s: string | null | undefined) =>
  s ? new TextDecoder().decode(decode(s)) : "";

interface ExecResult {
  compile: { stdout: string; stderr: string; code: number } | null;
  run: { stdout: string; stderr: string; code: number | null; signal: string | null };
  engine: string;
}

async function runJudge0(target: LangTarget, code: string, stdin: string): Promise<ExecResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 100_000);
  let resp: Response;
  try {
    resp = await fetch(JUDGE0_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "UniGeniusAI/1.0 (+https://unigenius.vercel.app)",
      },
      body: JSON.stringify({
        source_code: b64encode(code),
        language_id: target.judge0Id,
        stdin: b64encode(stdin),
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Execution service error (${resp.status})${resp.status === 429 ? " — rate limit, please retry in a few seconds" : ""}: ${text.slice(0, 200)}`);
  }

  const d = await resp.json();
  const statusId = Number(d.status?.id);
  const stdout = b64decode(d.stdout);
  const stderr = b64decode(d.stderr);
  const compileOut = b64decode(d.compile_output);
  const message = b64decode(d.message);
  const exitCode = typeof d.exit_code === "number"
    ? d.exit_code
    : (statusId === 3 ? 0 : null); // Accepted means the program exited cleanly

  // 6 = Compilation Error
  if (statusId === 6) {
    return {
      compile: { stdout: "", stderr: compileOut || message || "Compilation failed", code: 1 },
      run: { stdout: "", stderr: "", code: null, signal: null },
      engine: "judge0",
    };
  }
  // 13/14 = Internal / Exec Format Error — treat as service failure so the fallback runs.
  if (statusId === 13 || statusId === 14) {
    throw new Error(`Execution service error (Judge0 status ${statusId}: ${d.status?.description || "internal"})`);
  }
  // 5 = Time Limit Exceeded
  if (statusId === 5) {
    return {
      compile: null,
      run: {
        stdout,
        stderr: (stderr ? stderr + "\n" : "") + "Time limit exceeded — the program ran too long and was stopped.",
        code: null,
        signal: "SIGXCPU",
      },
      engine: "judge0",
    };
  }
  // 3/4 = Accepted / Wrong Answer (ran to completion); 7-12 = runtime errors.
  const isRuntimeError = statusId >= 7 && statusId <= 12;
  return {
    compile: null,
    run: {
      stdout,
      stderr: isRuntimeError ? (stderr || message || d.status?.description || "Runtime error") : stderr,
      code: exitCode,
      signal: null,
    },
    engine: "judge0",
  };
}

async function runWandbox(target: LangTarget, code: string, stdin: string): Promise<ExecResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  let resp: Response;
  try {
    resp = await fetch(WANDBOX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "UniGeniusAI/1.0 (+https://unigenius.vercel.app)",
      },
      body: JSON.stringify({ code, compiler: target.wandboxCompiler, stdin, save: false }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Execution service error (${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const exitCode = Number.isFinite(Number(data.status)) ? Number(data.status) : null;
  return {
    compile: (data.compiler_error || data.compiler_output)
      ? { stdout: data.compiler_output || "", stderr: data.compiler_error || "", code: data.compiler_error ? 1 : 0 }
      : null,
    run: {
      stdout: data.program_output || "",
      stderr: data.program_error || "",
      code: exitCode,
      signal: data.signal || null,
    },
    engine: "wandbox",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const tooBig = enforceBodySize(req, corsHeaders, 200_000);
  if (tooBig) return tooBig;

  try {
    const body = await req.json();
    const language = clampString(body.language, 16);
    const code = clampString(body.code, 50_000);
    let stdin = clampString(body.stdin, 20_000);
    if (stdin && !stdin.endsWith("\n")) stdin += "\n";

    const target = LANG_MAP[language];
    if (!target) {
      return new Response(
        JSON.stringify({ error: `Unsupported language: ${language}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!code.trim()) {
      return new Response(
        JSON.stringify({ error: "Code is empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const startedAt = Date.now();
    let result: ExecResult;
    try {
      result = await runJudge0(target, code, stdin);
    } catch (primaryErr) {
      console.error("Judge0 failed, trying fallback:", primaryErr);
      if (!target.wandboxCompiler) throw primaryErr;
      result = await runWandbox(target, code, stdin);
    }
    const elapsedMs = Date.now() - startedAt;

    return new Response(
      JSON.stringify({
        language,
        version: target.label,
        compile: result.compile,
        run: result.run,
        executionTimeMs: elapsedMs,
        engine: result.engine,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("execute-code error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
