import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { Code, Loader2, Bot, ImagePlus, X, Copy, Check, RotateCcw, Terminal, Play, CheckCircle2, AlertTriangle, ListChecks, Wand2, ShieldCheck, ShieldAlert, Sparkles } from "lucide-react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import cssWorker from "monaco-editor/language/css/css.worker.js?worker";
import htmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

// F-05: self-host Monaco from the app bundle instead of the public
// jsdelivr CDN (runtime dependency + privacy/offline risk). The
// monaco-editor package was already installed via @monaco-editor/react.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });
import { Button } from "@/components/ui/button";
import { useDepartment, departmentInfo } from "@/contexts/DepartmentContext";
import PageShell from "@/components/PageShell";
import { toast } from "sonner";
import { authHeader } from "@/lib/auth-header";
import { lintCppCode } from "@/lib/cpp-linter";
import CodeLintWarnings from "@/components/CodeLintWarnings";
import ThinkingAnimation from "@/components/ThinkingAnimation";
import { notifyAiTier } from "@/lib/ai-tier-notifier";
import { useAdmin } from "@/hooks/use-admin";

// ---------------------------------------------------------------------------
// Languages — every entry here is verified against the execution backend
// (Judge0 CE via the execute-code edge function).
// ---------------------------------------------------------------------------
interface LangDef {
  id: string;
  label: string;
  file: string;
  monaco: string;
  template: string;
}

const LANGUAGES: LangDef[] = [
  { id: "cpp", label: "C++", file: "main.cpp", monaco: "cpp", template: `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, UniGenius!" << endl;\n    return 0;\n}\n` },
  { id: "c", label: "C", file: "main.c", monaco: "c", template: `#include <stdio.h>\n\nint main() {\n    printf("Hello, UniGenius!\\n");\n    return 0;\n}\n` },
  { id: "python", label: "Python", file: "main.py", monaco: "python", template: `# Welcome to UniGenius Code Lab\n\ndef hello():\n    print("Hello, UniGenius!")\n\nhello()\n` },
  { id: "javascript", label: "JavaScript", file: "main.js", monaco: "javascript", template: `// JavaScript\nconsole.log("Hello, UniGenius!");\n` },
  { id: "typescript", label: "TypeScript", file: "main.ts", monaco: "typescript", template: `// TypeScript\nconst message: string = "Hello, UniGenius!";\nconsole.log(message);\n` },
  { id: "java", label: "Java", file: "Main.java", monaco: "java", template: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, UniGenius!");\n    }\n}\n` },
  { id: "csharp", label: "C#", file: "Program.cs", monaco: "csharp", template: `using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello, UniGenius!");\n    }\n}\n` },
  { id: "php", label: "PHP", file: "main.php", monaco: "php", template: `<?php\necho "Hello, UniGenius!\\n";\n?>\n` },
  { id: "go", label: "Go", file: "main.go", monaco: "go", template: `package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, UniGenius!")\n}\n` },
  { id: "rust", label: "Rust", file: "main.rs", monaco: "rust", template: `fn main() {\n    println!("Hello, UniGenius!");\n}\n` },
  { id: "ruby", label: "Ruby", file: "main.rb", monaco: "ruby", template: `puts "Hello, UniGenius!"\n` },
];

const langDef = (id: string): LangDef => LANGUAGES.find((l) => l.id === id) || LANGUAGES[0];

const LS_PREFIX = "ug-codelab:v2:";
const lsGet = (k: string): string | null => { try { return localStorage.getItem(LS_PREFIX + k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(LS_PREFIX + k, v); } catch { /* storage full/blocked */ } };

interface Mistake { line: number; type: string; message: string; fix: string; }
interface AnalysisResult {
  status: "mistakes" | "clean";
  summary: string;
  mistakes: Mistake[];
  correctedCode: string | null;
  expectedOutput: string | null;
}
type VerifyState =
  | { kind: "verified"; output: string }
  | { kind: "failed"; detail: string }
  | { kind: "mismatch"; expected: string; actual: string }
  | { kind: "skipped"; detail: string };

type Phase = "idle" | "running" | "analyzing" | "verifying" | "revising";
type ConsoleLine = { type: "success" | "error" | "info"; text: string };
interface ExecSummary { status: "ok" | "compile_error" | "runtime_error"; compileStderr?: string; stdout?: string; stderr?: string; exitCode?: number | null; }

const normOutput = (s: string) => s.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/g, "")).join("\n").replace(/\n+$/g, "").trim();

const CodeLabPage = () => {
  const { department } = useDepartment();
  const { isAdmin } = useAdmin();
  const dept = department || "se";
  const deptDefaultLang = dept === "ai" ? "python" : "cpp";

  const [initial] = useState(() => {
    const savedLang = lsGet("lang");
    const lang = savedLang && LANGUAGES.some((l) => l.id === savedLang) ? savedLang : deptDefaultLang;
    return { lang, code: lsGet("code:" + lang) ?? langDef(lang).template, stdin: lsGet("stdin") ?? "" };
  });

  const [code, setCode] = useState(initial.code);
  const [language, setLanguage] = useState(initial.lang);
  const [stdinInput, setStdinInput] = useState(initial.stdin);
  const [phase, setPhase] = useState<Phase>("idle");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [verifyState, setVerifyState] = useState<VerifyState | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [errorImage, setErrorImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lintDismissed, setLintDismissed] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState<ConsoleLine[]>([]);
  const [activeTab, setActiveTab] = useState<"console" | "analysis">("console");
  const [lastRunSecs, setLastRunSecs] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const decorationsRef = useRef<string[]>([]);

  // "Run in Code Lab" handoff from Notes Reader topic pages.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("ug-codelab-prefill");
      if (!raw) return;
      sessionStorage.removeItem("ug-codelab-prefill");
      const prefill = JSON.parse(raw) as { code?: string; language?: string };
      if (prefill.language && LANGUAGES.some((l) => l.id === prefill.language)) {
        setLanguage(prefill.language);
        if (prefill.code) lsSet("code:" + prefill.language, prefill.code);
      }
      if (prefill.code) {
        setCode(prefill.code);
        toast.success("Code example loaded from the topic page — press Run & Analyze!");
      }
    } catch { /* malformed prefill — keep the saved/default code */ }
     
  }, []);

  // Persistence: code per language + last language + stdin.
  useEffect(() => { lsSet("lang", language); }, [language]);
  useEffect(() => {
    const t = setTimeout(() => lsSet("code:" + language, code), 300);
    return () => clearTimeout(t);
  }, [code, language]);
  useEffect(() => { lsSet("stdin", stdinInput); }, [stdinInput]);

  const lintErrors = useMemo(() => {
    if (language !== "cpp") return [];
    return lintCppCode(code);
  }, [code, language]);

  // ---- Monaco error decorations -------------------------------------------
  const clearErrorLines = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (model) monaco.editor.setModelMarkers(model, "codelab", []);
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
  }, []);

  const applyErrorLines = useCallback((mistakes: Mistake[]) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    const maxLine = model.getLineCount();
    const valid = mistakes.filter((m) => m.line >= 1 && m.line <= maxLine);
    monaco.editor.setModelMarkers(model, "codelab", valid.map((m) => ({
      severity: monaco.MarkerSeverity.Error,
      message: m.fix ? `${m.message} — ${m.fix}` : m.message,
      startLineNumber: m.line,
      startColumn: 1,
      endLineNumber: m.line,
      endColumn: model.getLineMaxColumn(m.line),
    })));
    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      valid.map((m) => ({
        range: new monaco.Range(m.line, 1, m.line, 1),
        options: { isWholeLine: true, className: "cl-error-line", linesDecorationsClassName: "cl-error-bar" },
      })),
    );
  }, []);

  // ---- Backend calls -------------------------------------------------------
  const executeCode = useCallback(async (src: string, lang: string, stdin: string) => {
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/execute-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `${await authHeader()}` },
        body: JSON.stringify({ code: src, language: lang, stdin }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return { ok: false as const, error: err.error || `Execution failed (${resp.status})` };
      }
      return { ok: true as const, result: await resp.json() };
    } catch (e: any) {
      return { ok: false as const, error: e?.message === "Failed to fetch" ? "Network error — check your connection" : (e?.message || "Execution failed") };
    }
  }, []);

  const callAnalyze = useCallback(async (payload: Record<string, unknown>): Promise<AnalysisResult> => {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `${await authHeader()}` },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Analysis failed (${resp.status})`);
    }
    notifyAiTier(resp, isAdmin);
    const data = await resp.json();
    if (!data?.analysis) throw new Error("Analysis failed — empty response");
    return data.analysis as AnalysisResult;
  }, [isAdmin]);

  /** Render an execution result into the console; returns the summary for the AI. */
  const pushExecResult = useCallback((result: any): ExecSummary => {
    const lines: ConsoleLine[] = [];
    let status: ExecSummary["status"] = "ok";
    if (result.compile?.stderr) {
      status = "compile_error";
      lines.push({ type: "error", text: "─── Compiler Errors ───" });
      result.compile.stderr.split("\n").forEach((l: string) => { if (l.trim()) lines.push({ type: "error", text: l }); });
    }
    if (result.run?.stdout) {
      lines.push({ type: "info", text: "─── Output ───" });
      result.run.stdout.split("\n").forEach((l: string, i: number, arr: string[]) => {
        if (l || i < arr.length - 1) lines.push({ type: "success", text: l });
      });
    }
    if (result.run?.stderr) {
      if (status === "ok") status = "runtime_error";
      lines.push({ type: "error", text: "─── Runtime Errors ───" });
      result.run.stderr.split("\n").forEach((l: string) => { if (l.trim()) lines.push({ type: "error", text: l }); });
    }
    if (result.run?.signal) {
      if (status === "ok") status = "runtime_error";
      lines.push({ type: "error", text: `Killed by signal: ${result.run.signal}` });
    }
    if (!result.compile?.stderr && !result.run?.stdout && !result.run?.stderr) {
      lines.push({ type: "info", text: "(No output)" });
    }
    const exitCode = result.run?.code;
    lines.push({
      type: exitCode === 0 ? "info" : "error",
      text: `> Exit code: ${exitCode ?? "?"}  •  Time: ${result.executionTimeMs}ms`,
    });
    setConsoleOutput((prev) => [...prev, ...lines]);
    return {
      status,
      compileStderr: result.compile?.stderr || undefined,
      stdout: result.run?.stdout || undefined,
      stderr: result.run?.stderr || undefined,
      exitCode: exitCode ?? null,
    };
  }, []);

  /** Execute the AI's corrected code and judge it honestly. */
  const verifyCorrected = useCallback(async (corrected: string, expected: string | null, lang: string, stdin: string): Promise<VerifyState> => {
    const r = await executeCode(corrected, lang, stdin);
    if (!r.ok) return { kind: "skipped", detail: r.error };
    const res = r.result;
    const failed = !!res.compile?.stderr || !!res.run?.signal ||
      (typeof res.run?.code === "number" && res.run.code !== 0) ||
      (res.run?.code === null && !!res.run?.stderr);
    if (failed) {
      const detail = (res.compile?.stderr || res.run?.stderr || "Corrected code did not run successfully").split("\n").filter((l: string) => l.trim()).slice(0, 4).join("\n");
      return { kind: "failed", detail };
    }
    const actual = res.run?.stdout || "";
    if (expected !== null && normOutput(actual) !== normOutput(expected)) {
      return { kind: "mismatch", expected, actual };
    }
    return { kind: "verified", output: actual };
  }, [executeCode]);

  // ---- Main flow -------------------------------------------------------------
  const runAndAnalyze = async (imageData?: string) => {
    if (!code.trim() && !imageData) { toast.error("Write some code or upload an error image!"); return; }
    if (language === "cpp" && lintErrors.length > 0 && !imageData) {
      setLintDismissed(false);
      toast.info(`${lintErrors.length} lint issue(s) detected — analyzing with AI anyway...`);
    }

    const t0 = performance.now();
    const def = langDef(language);
    setPhase("running");
    setAnalysisResult(null);
    setVerifyState(null);
    setServiceError(null);
    setAiError(null);
    clearErrorLines();
    setActiveTab("console");
    setConsoleOutput([{ type: "info", text: `> Running ${def.label} code in sandbox...` }]);

    // Step 1: real execution (skipped only for a screenshot-only request).
    let execSummary: ExecSummary | null = null;
    if (code.trim()) {
      const exec = await executeCode(code, language, stdinInput);
      if (!exec.ok) {
        // Honest stop: the run itself failed — no invented code diagnosis.
        setConsoleOutput((prev) => [...prev, { type: "error", text: `✗ Execution failed: ${exec.error}` }]);
        setServiceError(exec.error);
        setActiveTab("analysis");
        setPhase("idle");
        setLastRunSecs((performance.now() - t0) / 1000);
        return;
      }
      execSummary = pushExecResult(exec.result);
    }

    // Step 2: AI analysis with the real execution result.
    setConsoleOutput((prev) => [...prev, { type: "info", text: "> Sending to AI for analysis..." }]);
    setActiveTab("analysis");
    setPhase("analyzing");

    try {
      const payload: Record<string, unknown> = { code, language, stdin: stdinInput, exec: execSummary };
      if (imageData) payload.errorImage = imageData;
      let analysis = await callAnalyze(payload);

      // Step 3: verify the corrected code by actually running it.
      if (analysis.status === "mistakes" && analysis.correctedCode) {
        setAnalysisResult(analysis);
        applyErrorLines(analysis.mistakes);
        setPhase("verifying");
        let verify = await verifyCorrected(analysis.correctedCode, analysis.expectedOutput, language, stdinInput);

        // One self-correction round if verification failed.
        if (verify.kind === "failed" || verify.kind === "mismatch") {
          setPhase("revising");
          try {
            const revised = await callAnalyze({
              code, language, stdin: stdinInput, exec: execSummary,
              revision: {
                previousCorrectedCode: analysis.correctedCode,
                problem: verify.kind === "failed" ? "still_fails" : "output_mismatch",
                actualOutput: verify.kind === "mismatch" ? verify.actual : "",
                expectedOutput: verify.kind === "mismatch" ? verify.expected : (analysis.expectedOutput || ""),
                errorText: verify.kind === "failed" ? verify.detail : "",
              },
            });
            if (revised.status === "mistakes" && revised.correctedCode && revised.correctedCode !== analysis.correctedCode) {
              analysis = revised;
              setAnalysisResult(analysis);
              applyErrorLines(analysis.mistakes);
              setPhase("verifying");
              verify = await verifyCorrected(analysis.correctedCode, analysis.expectedOutput, language, stdinInput);
            }
          } catch { /* keep the first analysis + its honest verify state */ }
        }
        setVerifyState(verify);
      } else {
        setAnalysisResult(analysis);
        if (analysis.status === "mistakes") applyErrorLines(analysis.mistakes);
      }

      setConsoleOutput((prev) => [...prev, { type: "success", text: "✓ Analysis complete" }]);
    } catch (err: any) {
      setAiError(err.message || "Analysis failed");
      setConsoleOutput((prev) => [...prev, { type: "error", text: `✗ ${err.message || "Analysis failed"}` }]);
      if (err.message !== "Failed to fetch") toast.error(err.message || "Analysis failed");
    } finally {
      setPhase("idle");
      setLastRunSecs((performance.now() - t0) / 1000);
    }
  };

  const isBusy = phase !== "idle";

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setErrorImage(reader.result as string);
      toast.success("Error image attached! Click Run & Analyze to debug.");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          setErrorImage(reader.result as string);
          toast.success("Image pasted! Click Run & Analyze to debug.");
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  };

  const copyCorrected = async () => {
    if (!analysisResult?.correctedCode) return;
    await navigator.clipboard.writeText(analysisResult.correctedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Corrected code copied!");
  };

  const applyFixes = () => {
    if (!analysisResult?.correctedCode) return;
    setCode(analysisResult.correctedCode);
    clearErrorLines();
    toast.success("Fixes applied to the editor — press Run & Analyze to check.");
  };

  const switchLanguage = (id: string) => {
    setLanguage(id);
    setCode(lsGet("code:" + id) ?? langDef(id).template);
    setAnalysisResult(null);
    setVerifyState(null);
    setServiceError(null);
    setAiError(null);
    clearErrorLines();
  };

  const def = langDef(language);
  const phaseMessage =
    phase === "running" ? "Running your code..." :
    phase === "analyzing" ? "AI is checking your code — including logic mistakes..." :
    phase === "verifying" ? "Running the corrected code to verify it..." :
    phase === "revising" ? "First fix did not pass — AI is correcting it again..." : "";

  const typeChip = (t: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      syntax: { label: "Syntax", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
      logic: { label: "Logic", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
      runtime: { label: "Runtime", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
      warning: { label: "Warning", cls: "bg-yellow-500/15 text-yellow-200 border-yellow-500/30" },
    };
    const m = map[t] || map.warning;
    return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${m.cls}`}>{m.label}</span>;
  };

  return (
    <PageShell
      title="Code Lab"
      subtitle={`${department ? departmentInfo[department].name : "SE"} IDE`}
      icon={<div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center"><Code className="w-5 h-5 text-primary-foreground" /></div>}
    >
      <div className="space-y-0" onPaste={handlePaste}>
        {/* Top toolbar */}
        <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
          <div className="flex gap-2 overflow-x-auto max-w-full pb-1 -mx-0.5 px-0.5">
            {LANGUAGES.map((lang) => (
              <Button
                key={lang.id}
                variant={language === lang.id ? "default" : "outline"}
                size="sm"
                className={`rounded-xl text-xs shrink-0 ${language === lang.id ? "gradient-primary text-primary-foreground" : ""}`}
                onClick={() => switchLanguage(lang.id)}
              >
                {lang.label}
              </Button>
            ))}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => fileInputRef.current?.click()} title="Upload error screenshot">
              <ImagePlus className="w-3.5 h-3.5" /> Screenshot
            </Button>
            <Button
              onClick={() => runAndAnalyze(errorImage || undefined)}
              disabled={isBusy}
              size="sm"
              className="rounded-xl gradient-primary text-primary-foreground gap-1.5 text-xs px-4"
            >
              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {isBusy ? "Working..." : "Run & Analyze"}
            </Button>
          </div>
        </div>

        {!lintDismissed && (
          <CodeLintWarnings errors={lintErrors} onDismiss={() => setLintDismissed(true)} />
        )}

        {/* Split-screen: Editor + Console/Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border border-border/50 rounded-2xl overflow-hidden">
          {/* Code Editor Panel */}
          <div className="flex flex-col border-b lg:border-b-0 lg:border-r border-border/50">
            <div className="flex items-center gap-2 px-3 py-2 bg-background/80 border-b border-border/30">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
              </div>
              <span className="text-xs text-muted-foreground font-mono ml-2">{def.file}</span>
              {lastRunSecs !== null && !isBusy && (
                <span className="ml-auto text-[10px] text-muted-foreground">Last run: {lastRunSecs.toFixed(1)}s</span>
              )}
            </div>
            <div className="h-[320px] lg:h-[400px]">
              <Editor
                height="100%"
                language={def.monaco}
                theme="vs-dark"
                value={code}
                onMount={(editor, monaco) => { editorRef.current = editor; monacoRef.current = monaco; }}
                onChange={(v) => {
                  setCode(v || "");
                  if (decorationsRef.current.length > 0) clearErrorLines();
                }}
                options={{ fontSize: 14, minimap: { enabled: false }, padding: { top: 12 }, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", lineNumbers: "on", renderLineHighlight: "all", cursorBlinking: "smooth", glyphMargin: true }}
              />
            </div>
            {/* Stdin Input */}
            <div className="border-t border-border/30 bg-background/80 px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <Terminal className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">stdin input</span>
              </div>
              <textarea
                value={stdinInput}
                onChange={(e) => setStdinInput(e.target.value)}
                placeholder="Enter input values (one per line)..."
                className="w-full bg-[#0A0817] text-violet-200 font-mono text-xs rounded-md border border-border/30 px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/40"
                rows={2}
              />
            </div>
          </div>

          {/* Console / Analysis Panel */}
          <div className="flex flex-col">
            <div className="flex items-center gap-0 bg-background/80 border-b border-border/30">
              <button
                onClick={() => setActiveTab("console")}
                className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${activeTab === "console" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                <Terminal className="w-3 h-3 inline mr-1.5" />Console
              </button>
              <button
                onClick={() => setActiveTab("analysis")}
                className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${activeTab === "analysis" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                <Sparkles className="w-3 h-3 inline mr-1.5" />AI Analysis
              </button>
              {activeTab === "console" && consoleOutput.length > 0 && (
                <button onClick={() => setConsoleOutput([])} className="ml-auto mr-3 text-xs text-muted-foreground hover:text-foreground">
                  Clear
                </button>
              )}
            </div>

            <div className="bg-[#0A0817] overflow-auto h-[380px] lg:h-[460px]">
              {activeTab === "console" ? (
                <div className="p-3 font-mono text-xs space-y-1">
                  {consoleOutput.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50 gap-2 py-16">
                      <Terminal className="w-8 h-8" />
                      <p className="text-xs">Console output will appear here</p>
                      <p className="text-[10px]">Click "Run & Analyze" to start</p>
                    </div>
                  ) : (
                    consoleOutput.map((line, i) => (
                      <div key={i} className={`leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${
                        line.type === "success" ? "text-emerald-400" :
                        line.type === "error" ? "text-red-400" :
                        "text-violet-300"
                      }`}>
                        {line.text}
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="p-4 overflow-y-auto">
                  {serviceError ? (
                    <div className="flex flex-col items-center justify-center text-center gap-4 py-8">
                      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                        <AlertTriangle className="w-6 h-6 text-destructive" />
                      </div>
                      <div>
                        <p className="font-display font-semibold text-foreground text-sm">Execution Service Failed</p>
                        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{serviceError}</p>
                        <p className="text-xs text-muted-foreground mt-2 max-w-xs">The code was not run, so no AI diagnosis was made. Please try again.</p>
                      </div>
                      <Button onClick={() => runAndAnalyze(errorImage || undefined)} className="rounded-xl gap-2" variant="outline" size="sm">
                        <RotateCcw className="w-3 h-3" /> Retry
                      </Button>
                    </div>
                  ) : aiError && !analysisResult ? (
                    <div className="flex flex-col items-center justify-center text-center gap-4 py-8">
                      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                        <X className="w-6 h-6 text-destructive" />
                      </div>
                      <div>
                        <p className="font-display font-semibold text-foreground text-sm">Analysis Failed</p>
                        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{aiError}</p>
                      </div>
                      <Button onClick={() => runAndAnalyze(errorImage || undefined)} className="rounded-xl gap-2" variant="outline" size="sm">
                        <RotateCcw className="w-3 h-3" /> Retry
                      </Button>
                    </div>
                  ) : isBusy && !analysisResult ? (
                    <ThinkingAnimation message={phaseMessage || "Working..."} />
                  ) : analysisResult ? (
                    <div className="space-y-4">
                      {analysisResult.status === "clean" ? (
                        <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-3">
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-semibold text-emerald-300">No mistakes found</p>
                            {analysisResult.summary && <p className="text-xs text-foreground/80 leading-relaxed mt-1">{analysisResult.summary}</p>}
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* 1) Mistakes list — always on top */}
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <ListChecks className="w-4 h-4 text-primary" />
                              <p className="text-sm font-semibold text-foreground">
                                {analysisResult.mistakes.length} mistake{analysisResult.mistakes.length === 1 ? "" : "s"} found
                              </p>
                            </div>
                            {analysisResult.summary && (
                              <p className="text-xs text-muted-foreground leading-relaxed mb-3">{analysisResult.summary}</p>
                            )}
                            <ol className="space-y-2">
                              {analysisResult.mistakes.map((m, i) => (
                                <li key={i} className="bg-background/60 border border-border/40 rounded-xl p-3">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="w-5 h-5 rounded-md gradient-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                                    {m.line > 0 && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30">Line {m.line}</span>}
                                    {typeChip(m.type)}
                                  </div>
                                  <p className="text-xs text-foreground leading-relaxed mt-2">{m.message}</p>
                                  {m.fix && <p className="text-xs text-muted-foreground leading-relaxed mt-1"><span className="text-primary font-medium">Fix: </span>{m.fix}</p>}
                                </li>
                              ))}
                            </ol>
                            <p className="text-[11px] text-muted-foreground mt-2">The wrong lines are highlighted in red in the editor.</p>
                          </div>

                          {/* 2) Corrected code — below the list */}
                          {analysisResult.correctedCode && (
                            <div>
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <Wand2 className="w-4 h-4 text-primary" />
                                <p className="text-sm font-semibold text-foreground">Corrected Code</p>
                                <div className="ml-auto flex gap-1.5">
                                  <Button size="sm" variant="outline" className="rounded-lg text-[11px] h-7 gap-1" onClick={copyCorrected}>
                                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                    {copied ? "Copied" : "Copy"}
                                  </Button>
                                  <Button size="sm" className="rounded-lg text-[11px] h-7 gap-1 gradient-primary text-primary-foreground" onClick={applyFixes}>
                                    <Check className="w-3 h-3" /> Apply fixes
                                  </Button>
                                </div>
                              </div>
                              <div className="border border-border/40 rounded-xl overflow-hidden">
                                <Editor
                                  height={`${Math.min(Math.max(analysisResult.correctedCode.split("\n").length * 19 + 16, 60), 320)}px`}
                                  language={def.monaco}
                                  theme="vs-dark"
                                  value={analysisResult.correctedCode}
                                  options={{ readOnly: true, fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, lineNumbers: "on", wordWrap: "on", domReadOnly: true, renderLineHighlight: "none" }}
                                />
                              </div>

                              {/* 3) Verification — the corrected code was really run */}
                              {(phase === "verifying" || phase === "revising") && (
                                <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  {phase === "verifying" ? "Running the corrected code to verify it..." : "First fix did not pass — AI is correcting it again..."}
                                </div>
                              )}
                              {verifyState?.kind === "verified" && (
                                <div className="flex items-start gap-2.5 mt-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-3">
                                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                  <div className="text-xs">
                                    <p className="font-semibold text-emerald-300">Verified by running</p>
                                    <p className="text-foreground/80 mt-0.5">This corrected code was executed in the sandbox and ran successfully.</p>
                                    {verifyState.output.trim() && (
                                      <p className="font-mono text-emerald-200/90 mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]">Output: {verifyState.output.trim().split("\n").slice(0, 5).join("\n")}</p>
                                    )}
                                  </div>
                                </div>
                              )}
                              {verifyState?.kind === "failed" && (
                                <div className="flex items-start gap-2.5 mt-3 bg-destructive/10 border border-destructive/25 rounded-xl p-3">
                                  <ShieldAlert className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                                  <div className="text-xs">
                                    <p className="font-semibold text-destructive">Not verified — corrected code still fails</p>
                                    <p className="text-foreground/80 mt-0.5">We ran the AI's corrected code and it still did not work. Please check it before using:</p>
                                    <p className="font-mono text-red-300 mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{verifyState.detail}</p>
                                  </div>
                                </div>
                              )}
                              {verifyState?.kind === "mismatch" && (
                                <div className="flex items-start gap-2.5 mt-3 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3">
                                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                  <div className="text-xs">
                                    <p className="font-semibold text-amber-300">Output does not match</p>
                                    <p className="text-foreground/80 mt-0.5">The corrected code runs, but its output is different from what the AI expected. Double-check the logic before using it.</p>
                                    <p className="font-mono text-amber-200/90 mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]">Expected: {normOutput(verifyState.expected) || "(nothing)"}</p>
                                    <p className="font-mono text-amber-200/90 whitespace-pre-wrap [overflow-wrap:anywhere]">Actual: {normOutput(verifyState.actual) || "(nothing)"}</p>
                                  </div>
                                </div>
                              )}
                              {verifyState?.kind === "skipped" && (
                                <p className="text-[11px] text-muted-foreground mt-3">Verification run was unavailable ({verifyState.detail}) — the corrected code above was not re-run.</p>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center gap-3 py-12">
                      <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
                        <Bot className="w-5 h-5 text-primary-foreground" />
                      </div>
                      <div>
                        <p className="font-display font-semibold text-foreground text-sm">AI Code Analysis</p>
                        <p className="text-xs text-muted-foreground mt-1">Write code and click "Run & Analyze" — mistakes are listed here, wrong lines turn red in the editor, and the corrected code is verified by running it.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />

        {errorImage && (
          <div className="glass rounded-xl p-3 flex items-center gap-3 mt-3">
            <img src={errorImage} alt="Error" className="w-12 h-12 rounded-lg object-cover" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">Error image attached</p>
              <p className="text-xs text-muted-foreground">Will be analyzed with your code</p>
            </div>
            <button onClick={() => setErrorImage(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </PageShell>
  );
};

export default CodeLabPage;
