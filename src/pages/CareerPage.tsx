import { useState, useRef, useCallback, useEffect } from "react";
import { fetchWithRetry } from "@/lib/fetch-with-retry";
import { authHeader } from "@/lib/auth-header";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase, Code, FileText, Mic, MicOff, Send, Bot, User,
  Play, CheckCircle, XCircle, Upload, FileUp, Award, Target,
  Lightbulb, ArrowRight, RefreshCw, Copy, Sparkles, List, Zap, TrendingUp, Medal
} from "lucide-react";
import SkillAnalyzer from "@/components/SkillAnalyzer";
import { extractTextFromFile } from "@/lib/extract-text";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartment } from "@/contexts/DepartmentContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import PageShell from "@/components/PageShell";
import MarkdownMessage from "@/components/MarkdownMessage";
import { fireCelebration, recordCareerActivity, checkAndAwardBadges, PRESET_DSA_PROBLEMS, type DSAProblem } from "@/lib/career-points";
import { formatFileSize } from "@/lib/utils";

type ActiveTab = "interview" | "dsa" | "cv" | "skills";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

// Human-readable error for a failed chat-function call: a 401 means the
// session is gone, not a raw "Unauthorized" (Bug #5 fix, 2026-11-25).
async function chatError(resp: Response, fallback: string): Promise<string> {
  if (resp.status === 401) return "Session expired — please sign in again";
  const d: any = await resp.json().catch(() => ({}));
  return d.error || `${fallback} (HTTP ${resp.status})`;
}

// ─── Interview Prep ───────────────────────────────────────────────
const InterviewPrep = () => {
  const { user } = useAuth();
  const [semester, setSemester] = useState("1");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const semesterTopics: Record<string, string> = {
    "1": "Programming Fundamentals, ICT, Calculus, Discrete Structures",
    "2": "OOP, Data Structures, Linear Algebra, Digital Logic",
    "3": "Algorithms, Database Systems, Computer Architecture, Software Requirements",
    "4": "Operating Systems, Computer Networks, Software Design & Architecture, Probability & Statistics",
    "5": "Software Construction, Web Engineering, Software Quality Engineering, Information Security",
    "6": "Software Project Management, Cloud Computing, Machine Learning, DevOps",
    "7": "Deep Learning, NLP, Computer Vision, FYP-I",
    "8": "Network Security, FYP-II, Electives",
  };

  const startInterview = async () => {
    setMessages([]);
    setIsLoading(true);

    try {
      // Server-owned interviewer prompt (audit F-04): the client sends
      // only the mode + semester; the chat function builds the prompt.
      const resp = await fetchWithRetry(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          mode: "interview",
          params: { semester },
          messages: [{ role: "user", content: "Start the interview." }],
        }),
      });

      if (!resp.ok) {
        // Surface the server's real reason (e.g. keys cooling down, rate
        // limit) instead of a generic "Failed to start interview".
        throw new Error(await chatError(resp, "Failed to start interview"));
      }

      let assistantText = "";
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ") || line.trim() === "" || line.startsWith(":")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const c = JSON.parse(json).choices?.[0]?.delta?.content;
            if (c) assistantText += c;
          } catch { /* skip malformed SSE chunk */ }
        }
      }

      setMessages([{ role: "assistant", content: assistantText }]);
    } catch (e: any) {
      toast.error(e.message || "Failed to start");
    } finally {
      setIsLoading(false);
    }
  };

  const sendAnswer = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || isLoading) return;

    const userMsg = { role: "user" as const, content: msg };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setIsLoading(true);

    try {
      const resp = await fetchWithRetry(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          mode: "interview",
          params: { semester },
          messages: newMsgs,
        }),
      });

      if (!resp.ok) {
        throw new Error(await chatError(resp, "Request failed"));
      }

      let assistantText = "";
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      setMessages(prev => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ") || line.trim() === "" || line.startsWith(":")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const c = JSON.parse(json).choices?.[0]?.delta?.content;
            if (c) {
              assistantText += c;
              const snap = assistantText;
              setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: snap } : m));
            }
          } catch { /* skip malformed SSE chunk */ }
        }
      }

      if (user && assistantText.includes("INTERVIEW_COMPLETE")) {
        const saved = await recordCareerActivity(user.id, "interview_complete", 15, { semester });
        if (saved) {
          fireCelebration(15);
          checkAndAwardBadges(user.id);
        }
      }
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally {
      setIsLoading(false);
    }
  };

  // Real voice answers via the Web Speech API (browser speech
  // recognition). The previous implementation only RECORDED audio and
  // inserted a placeholder — it never transcribed anything.
  const recognitionRef = useRef<any>(null);
  const speechSupported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice input is not supported in this browser — please type your answer.");
      return;
    }
    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e: any) => {
        let finalText = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        }
        if (finalText) setInput(prev => (prev ? prev + " " : "") + finalText.trim());
      };
      rec.onend = () => setIsRecording(false);
      rec.onerror = () => {
        setIsRecording(false);
        toast.error("Voice input stopped — check microphone permission.");
      };
      recognitionRef.current = rec;
      rec.start();
      setIsRecording(true);
      toast.info("Listening… speak your answer, click the mic again to stop.");
    } catch {
      toast.error("Voice input could not start in this browser.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Semester Focus</label>
          <Select value={semester} onValueChange={setSemester}>
            <SelectTrigger className="rounded-xl w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1,2,3,4,5,6,7,8].map(s => (
                <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={startInterview} disabled={isLoading} className="rounded-xl gap-2 gradient-primary">
          <Play className="w-4 h-4" />
          {messages.length > 0 ? "Restart Interview" : "Start Mock Interview"}
        </Button>
      </div>

      <div className="glass rounded-xl px-4 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Topics: </span>
        {semesterTopics[semester]}
      </div>

      {messages.length > 0 && (
        <div className="glass rounded-2xl p-4 space-y-4 max-h-[400px] overflow-y-auto">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
            >
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-3.5 h-3.5 text-primary-foreground" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === "user" ? "gradient-primary text-primary-foreground" : "glass text-foreground"
              }`}>
                {msg.role === "assistant" ? <MarkdownMessage content={msg.content} /> : msg.content}
              </div>
              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              )}
            </motion.div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {messages.length > 0 && (
        <div className="glass rounded-2xl p-2 flex gap-2 items-end">
          {speechSupported && (
            <Button
              variant="ghost"
              size="icon"
              className={`rounded-xl flex-shrink-0 ${isRecording ? "bg-destructive/20 text-destructive" : ""}`}
              onClick={toggleRecording}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAnswer(); } }}
            placeholder="Type your answer or use voice..."
            className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none min-h-[40px] max-h-[120px]"
            rows={1}
          />
          <Button size="icon" className="rounded-xl gradient-primary flex-shrink-0" onClick={() => sendAnswer()} disabled={!input.trim() || isLoading}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

// ─── DSA Practice ─────────────────────────────────────────────────
const DSAPractice = () => {
  const { user } = useAuth();
  const [selectedProblem, setSelectedProblem] = useState<DSAProblem | null>(null);
  const [code, setCode] = useState("");
  const [analysis, setAnalysis] = useState("");
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [solvedIds, setSolvedIds] = useState<Set<number>>(new Set());
  const [showHints, setShowHints] = useState(false);
  const [mode, setMode] = useState<"preset" | "ai">("preset");
  const [aiProblem, setAiProblem] = useState("");
  const [loadingProblem, setLoadingProblem] = useState(false);
  const [difficulty, setDifficulty] = useState("medium");

  // Load solved problems from career_activity
  useEffect(() => {
    if (!user) return;
    supabase.from("career_activity").select("metadata").eq("user_id", user.id).eq("activity_type", "dsa_solve").then(({ data }) => {
      if (data) {
        const ids = new Set<number>();
        data.forEach((a: any) => { if (a.metadata?.problem_id) ids.add(a.metadata.problem_id); });
        setSolvedIds(ids);
      }
    });
  }, [user]);

  const selectProblem = (p: DSAProblem) => {
    setSelectedProblem(p);
    setCode(p.starterCode);
    setAnalysis("");
    setShowHints(false);
  };

  const fetchAIProblem = async () => {
    setLoadingProblem(true);
    setAiProblem("");
    setAnalysis("");
    setCode("// Write your solution here\n\n");
    setSelectedProblem(null);

    try {
      const resp = await fetchWithRetry(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          mode: "dsa_problem",
          params: { difficulty },
          messages: [
            { role: "user", content: `Generate a ${difficulty} DSA problem. Make it unique and practical.` }
          ],
        }),
      });

      if (!resp.ok) {
        throw new Error(await chatError(resp, "Request failed"));
      }
      let text = "";
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try { const c = JSON.parse(json).choices?.[0]?.delta?.content; if (c) text += c; } catch { /* skip malformed SSE chunk */ }
        }
      }
      setAiProblem(text);
    } catch (e: any) {
      toast.error(e.message || "Failed to generate problem");
    } finally {
      setLoadingProblem(false);
    }
  };

  const analyzeSolution = async () => {
    if (!code.trim() || code.trim() === "// Write your solution here") {
      toast.error("Write your solution first!");
      return;
    }
    setLoadingAnalysis(true);
    setAnalysis("");

    const problemText = selectedProblem
      ? `## ${selectedProblem.title}\n${selectedProblem.description}\n${selectedProblem.examples}`
      : aiProblem;

    try {
      const resp = await fetchWithRetry(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          mode: "dsa_review",
          messages: [
            { role: "user", content: `**Problem:**\n${problemText}\n\n**My Solution:**\n\`\`\`cpp\n${code}\n\`\`\`` }
          ],
        }),
      });

      if (!resp.ok) {
        throw new Error(await chatError(resp, "Request failed"));
      }
      let text = "";
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const c = JSON.parse(json).choices?.[0]?.delta?.content;
            if (c) { text += c; setAnalysis(text); }
          } catch { /* skip malformed SSE chunk */ }
        }
      }

      // Award points if correct
      if (user && text.length > 50 && text.toLowerCase().includes("correct: yes")) {
        const isOptimized = text.toLowerCase().includes("optimized: yes");
        const basePoints = 20;
        const bonusPoints = isOptimized ? 10 : 0;
        const totalPoints = basePoints + bonusPoints;

        const metadata: any = { difficulty: selectedProblem?.difficulty || difficulty, optimized: isOptimized };
        if (selectedProblem) metadata.problem_id = selectedProblem.id;

        const saved = await recordCareerActivity(user.id, "dsa_solve", totalPoints, metadata);

        if (saved) {
          if (selectedProblem) setSolvedIds(prev => new Set(prev).add(selectedProblem.id));
          fireCelebration(totalPoints);
          checkAndAwardBadges(user.id);
        }
      } else if (text.toLowerCase().includes("correct: no")) {
        toast.info("Not quite right — review the feedback and try again!");
      }
    } catch (e: any) {
      toast.error(e.message || "Analysis failed");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex rounded-xl overflow-hidden border border-border">
          <button
            onClick={() => setMode("preset")}
            className={`px-4 py-2 text-xs font-medium transition-colors ${mode === "preset" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            <List className="w-3.5 h-3.5 inline mr-1.5" />10 Practice Problems
          </button>
          <button
            onClick={() => setMode("ai")}
            className={`px-4 py-2 text-xs font-medium transition-colors ${mode === "ai" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            <Zap className="w-3.5 h-3.5 inline mr-1.5" />AI Generated
          </button>
        </div>

        <Badge variant="secondary" className="text-[10px] gap-1 bg-primary/10 text-primary border border-primary/20">
          <Medal className="w-3 h-3" /> {solvedIds.size}/5 for DSA Warrior Badge
        </Badge>
      </div>

      {mode === "preset" ? (
        <>
          {/* Problem List */}
          {!selectedProblem && (
            <div className="grid gap-2">
              {PRESET_DSA_PROBLEMS.map((p) => {
                const solved = solvedIds.has(p.id);
                return (
                  <motion.button
                    key={p.id}
                    whileHover={{ x: 4 }}
                    onClick={() => selectProblem(p)}
                    className={`glass rounded-xl p-4 text-left flex items-center gap-3 transition-all ${solved ? "ring-1 ring-primary/30" : "hover:shadow-md"}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                      solved ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                    }`}>
                      {solved ? <CheckCircle className="w-4 h-4" /> : p.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground">{p.title}</p>
                      <p className="text-[11px] text-muted-foreground">{p.category}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                      p.difficulty === "easy"
                        ? "bg-primary/10 text-primary"
                        : p.difficulty === "medium"
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                          : "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        p.difficulty === "easy" ? "bg-primary" : p.difficulty === "medium" ? "bg-amber-400" : "bg-indigo-400"
                      }`} />
                      {p.difficulty}
                    </span>
                    {solved && <Badge variant="secondary" className="text-[10px] text-primary">+20 pts</Badge>}
                  </motion.button>
                );
              })}
            </div>
          )}

          {/* Selected Problem */}
          {selectedProblem && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="rounded-xl text-xs" onClick={() => { setSelectedProblem(null); setAnalysis(""); }}>
                  ← Back to Problems
                </Button>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                  selectedProblem.difficulty === "easy"
                    ? "bg-primary/10 text-primary"
                    : selectedProblem.difficulty === "medium"
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    selectedProblem.difficulty === "easy" ? "bg-primary" : selectedProblem.difficulty === "medium" ? "bg-amber-400" : "bg-indigo-400"
                  }`} />
                  {selectedProblem.difficulty}
                </span>
                <Badge variant="secondary" className="text-[10px]">{selectedProblem.category}</Badge>
              </div>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 space-y-3">
                <h3 className="font-display font-bold text-foreground">#{selectedProblem.id}: {selectedProblem.title}</h3>
                <p className="text-sm text-foreground/90">{selectedProblem.description}</p>
                <div className="text-sm"><MarkdownMessage content={selectedProblem.examples} /></div>
                <div className="text-xs text-muted-foreground"><MarkdownMessage content={selectedProblem.constraints} /></div>

                <Button variant="ghost" size="sm" className="rounded-xl text-xs gap-1" onClick={() => setShowHints(!showHints)}>
                  <Lightbulb className="w-3 h-3" /> {showHints ? "Hide" : "Show"} Hints
                </Button>
                {showHints && (
                  <div className="bg-muted rounded-xl p-3 text-xs space-y-1">
                    {selectedProblem.hints.map((h, i) => (
                      <p key={i} className="text-muted-foreground flex items-start gap-1.5">
                        <Lightbulb className="w-3 h-3 mt-0.5 shrink-0 text-primary" /> {h}
                      </p>
                    ))}
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </>
      ) : (
        /* AI Mode */
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Difficulty</label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger className="rounded-xl w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={fetchAIProblem} disabled={loadingProblem} className="rounded-xl gap-2 gradient-primary">
              {loadingProblem ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
              {aiProblem ? "New Problem" : "Generate Problem"}
            </Button>
          </div>

          {aiProblem && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5">
              <MarkdownMessage content={aiProblem} />
            </motion.div>
          )}
        </div>
      )}

      {/* Code Editor - shown when a problem is selected or AI problem generated */}
      {(selectedProblem || aiProblem) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-foreground text-sm">Your C++ Solution</h3>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs gap-1.5"
              onClick={() => { navigator.clipboard.writeText(code); toast.success("Copied!"); }}
            >
              <Copy className="w-3 h-3" /> Copy
            </Button>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full glass rounded-xl p-4 font-mono text-sm text-foreground min-h-[200px] resize-y outline-none focus:ring-2 focus:ring-primary/30"
            spellCheck={false}
          />
          <Button onClick={analyzeSolution} disabled={loadingAnalysis} className="rounded-xl gap-2 gradient-primary">
            {loadingAnalysis ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4" />}
            Submit & Analyze Solution
          </Button>
        </motion.div>
      )}

      {/* Analysis */}
      {analysis && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 space-y-2">
          <h3 className="font-display font-semibold text-foreground text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> AI Analysis
          </h3>
          <MarkdownMessage content={analysis} />
        </motion.div>
      )}
    </div>
  );
};

// ─── CV Optimizer ─────────────────────────────────────────────────
const CVOptimizer = () => {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [fileDataUrl, setFileDataUrl] = useState<string>("");
  const [analysis, setAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { toast.error("Max 10MB"); return; }
    setFile(f);
    setAnalysis("");
    const reader = new FileReader();
    reader.onload = () => setFileDataUrl(reader.result as string);
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  const analyzeCV = async () => {
    if (!file || !fileDataUrl) { toast.error("Upload a CV first"); return; }
    setIsAnalyzing(true);
    setAnalysis("");

    try {
      // Read the CV for real (audit F-03): PDF goes to the model
      // natively, images as images, and DOCX/TXT are read through the
      // browser extraction layer — previously DOCX was not accepted
      // at all and the prompt was supplied by the client (F-04).
      const parts: any[] = [];
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith(".pdf")) {
        parts.push({ type: "file", file: { name: file.name, mime_type: "application/pdf", data: fileDataUrl.split(",")[1] } });
      } else if (file.type.startsWith("image/")) {
        parts.push({ type: "image_url", image_url: { url: fileDataUrl } });
      } else {
        const extracted = await extractTextFromFile(file);
        if (!extracted || !extracted.text) {
          toast.error("This file could not be read. Please upload a PDF, DOCX or TXT file.");
          setIsAnalyzing(false);
          return;
        }
        parts.push({ type: "text", text: `----- CV TEXT (${file.name}) -----\n${extracted.text}\n----- END CV TEXT -----` });
      }

      parts.push({
        type: "text",
        text: "Analyze this CV/Resume for a Software Engineering student and score it out of 100 using your CV review format."
      });

      const resp = await fetchWithRetry(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await authHeader(),
        },
        body: JSON.stringify({
          mode: "cv_review",
          messages: [{ role: "user", content: parts }],
        }),
      });

      if (!resp.ok) throw new Error(await chatError(resp, "Analysis failed"));

      let text = "";
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const c = JSON.parse(json).choices?.[0]?.delta?.content;
            if (c) { text += c; setAnalysis(text); }
          } catch { /* skip malformed SSE chunk */ }
        }
      }

      // Extract score and record activity — also awards CV Ready badge
      if (user && text.length > 50) {
        const scoreMatch = text.match(/CV Score:\s*\[?\s*(\d+)\s*\/\s*100/i);
        const score = scoreMatch ? parseInt(scoreMatch[1]) : 50;
        const saved = await recordCareerActivity(user.id, "cv_score", score >= 80 ? 25 : 15, { score });
        if (saved) {
          fireCelebration(score >= 80 ? 25 : 15);
          checkAndAwardBadges(user.id);
        }
      }
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-2xl p-8 border-2 border-dashed border-border/50 hover:border-primary/40 transition-colors cursor-pointer text-center space-y-3"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
          className="hidden"
        />
        <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center mx-auto">
          {file ? <CheckCircle className="w-7 h-7 text-primary-foreground" /> : <Upload className="w-7 h-7 text-primary-foreground" />}
        </div>
        {file ? (
          <>
            <p className="font-display font-semibold text-foreground">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatFileSize(file.size)} — Click to replace</p>
          </>
        ) : (
          <>
            <p className="font-display font-semibold text-foreground">Drop your CV here</p>
            <p className="text-xs text-muted-foreground">Supports PDF, DOCX, TXT, PNG, JPG • Max 10MB</p>
            <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1">
              <Award className="w-3 h-3 text-primary" /> Uploading earns you the <strong>CV Ready</strong> badge!
            </p>
          </>
        )}
      </motion.div>

      {file && (
        <Button onClick={analyzeCV} disabled={isAnalyzing} className="rounded-xl gap-2 gradient-primary w-full">
          {isAnalyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
          {isAnalyzing ? "Analyzing your CV..." : "Analyze & Score My CV"}
        </Button>
      )}

      {analysis && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5">
          <MarkdownMessage content={analysis} />
        </motion.div>
      )}
    </div>
  );
};

// ─── Main Career Page ─────────────────────────────────────────────
const tabs = [
  { id: "interview" as ActiveTab, icon: Briefcase, label: "Interview Prep", desc: "AI Mock Interviews" },
  { id: "dsa" as ActiveTab, icon: Code, label: "DSA Practice", desc: "10 Problems + AI" },
  { id: "cv" as ActiveTab, icon: FileText, label: "CV Optimizer", desc: "AI Resume Scorer" },
  { id: "skills" as ActiveTab, icon: TrendingUp, label: "Skill Sync", desc: "Freelance Gigs" },
];

const CareerPage = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>("interview");

  return (
    <PageShell
      title="Career Hub"
      subtitle="Built by Uzair Ahmad"
      icon={
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <Briefcase className="w-5 h-5 text-primary" />
        </div>
      }
    >
      {/* D-3 fix: Career Hub is NOT a Pro feature — it appears nowhere
          in the Premium plan's Pro list, and the chat function's career
          modes serve every signed-in user. The old blanket
          "Pro Feature Locked" overlay sat on top of fully working
          features (DSA analysis, CV scoring) and blurred the mock
          interview AFTER a question had already been generated, which
          was both misleading and wasteful. Removed: no lock UI on
          features that are actually free. */}
      <div className="relative min-h-[400px]">
        <div className="space-y-6 pb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tabs.map((tab) => (
            <motion.button
              key={tab.id}
              whileHover={{ y: -2, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab(tab.id)}
              className={`glass rounded-2xl p-4 text-center transition-all ${
                activeTab === tab.id
                  ? "ring-2 ring-primary shadow-elevated"
                  : "hover:shadow-md"
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-2">
                <tab.icon className="w-5 h-5 text-primary" />
              </div>
              <p className="font-display font-semibold text-sm text-foreground">{tab.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{tab.desc}</p>
            </motion.button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "interview" && <InterviewPrep />}
            {activeTab === "dsa" && <DSAPractice />}
            {activeTab === "cv" && <CVOptimizer />}
            {activeTab === "skills" && <SkillAnalyzer />}
          </motion.div>
        </AnimatePresence>

        </div>
      </div>
    </PageShell>
  );
};

export default CareerPage;
