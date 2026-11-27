import { useState, useRef, useEffect, useCallback } from "react";
import { speak as speakTts } from "@/lib/tts";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, MicOff, Send, GraduationCap, Volume2, XCircle, BookOpen, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageShell from "@/components/PageShell";
import MarkdownMessage from "@/components/MarkdownMessage";
import { useAuth } from "@/contexts/AuthContext";
import { useSignInPrompt } from "@/components/SignInPrompt";
import { useDepartment } from "@/contexts/DepartmentContext";
import { getSubjects } from "@/data/subjects";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { authHeader } from "@/lib/auth-header";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "Easy — Basic concepts",
  medium: "Medium — Application level",
  hard: "Hard — Deep understanding",
};

const VIVA_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/viva-session`;

const VivaPage = () => {
  const { user } = useAuth();
  const { promptSignIn } = useSignInPrompt();
  const { department } = useDepartment();
  const [semester, setSemester] = useState(1);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("current_semester").eq("user_id", user.id).single()
      .then(({ data }) => { if (data?.current_semester) setSemester(data.current_semester); });
  }, [user]);

  const subjects = getSubjects(department, semester);

  const [selectedSubject, setSelectedSubject] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [difficulty, setDifficulty] = useState("medium");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const streamResponse = useCallback(async (allMessages: Message[]) => {
    setIsLoading(true);
    let assistantContent = "";

    try {
      const resp = await fetch(VIVA_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${await authHeader()}`,
        },
        body: JSON.stringify({ messages: allMessages, subject: selectedSubject, difficulty }),
      });

      if (!resp.ok || !resp.body) {
        if (resp.status === 429) { toast.error("Rate limited. Try again shortly."); return; }
        if (resp.status === 402) { toast.error("AI credits exhausted."); return; }
        throw new Error("Stream failed");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nlIdx);
          buffer = buffer.slice(nlIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantContent += delta;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
                }
                return [...prev, { role: "assistant", content: assistantContent }];
              });
            }
          } catch { /* partial json */ }
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to get response");
    } finally {
      setIsLoading(false);
    }
  }, [selectedSubject, difficulty]);

  const startViva = async () => {
    if (!selectedSubject) { toast.error("Please select a subject"); return; }
    setStarted(true);
    const initialMessages: Message[] = [
      { role: "user", content: `Start the viva examination for ${selectedSubject}. Begin with the first question.` }
    ];
    setMessages(initialMessages);
    await streamResponse(initialMessages);
  };

  const sendAnswer = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg: Message = { role: "user", content: input.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    await streamResponse(updated);
  };

  const resetViva = () => {
    setMessages([]);
    setStarted(false);
    setInput("");
  };

  const toggleListening = () => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      toast.error("Speech recognition not supported in this browser");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(prev => {
        if (event.results[event.results.length - 1].isFinal) {
          return prev + transcript + " ";
        }
        return prev;
      });
    };

    recognition.onerror = () => { setIsListening(false); };
    recognition.onend = () => { setIsListening(false); };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  };

  const speakText = (text: string) => {
    // Shared TTS path (src/lib/tts.ts): persisted gender, best-voice
    // resolution, sentence chunking; stops any line still playing.
    speakTts(text.replace(/[#*_`]/g, ""));
  };

  // The seeded first message ("Start the viva examination for …") is an
  // internal instruction for the viva-session function — it is part of
  // the API conversation but must NEVER render as a chat bubble. System
  // messages are filtered out for the same reason.
  const visibleMessages = messages.filter(
    (m) =>
      (m as { role: string }).role !== "system" &&
      !(m.role === "user" && m.content.startsWith("Start the viva examination for")),
  );

  if (!started) {
    return (
      <PageShell
        title="Viva Simulation"
        subtitle="AI-Powered Oral Examination"
        icon={<div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><GraduationCap className="w-5 h-5 text-primary" /></div>}
      >
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-lg mx-auto space-y-6 pb-6">
          <div className="glass rounded-2xl p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
                <Mic className="w-7 h-7 text-primary" />
              </div>
              <h2 className="font-display font-bold text-xl text-foreground">Mock Viva Examination</h2>
              <p className="text-sm text-muted-foreground">Select your subject and difficulty. The AI examiner will test your knowledge with progressive questions.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-primary" /> Subject
                </label>
                <Select value={selectedSubject} onValueChange={setSelectedSubject}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Choose a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map(s => (
                      <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-primary" /> Difficulty
                </label>
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Easy — Basic concepts</SelectItem>
                    <SelectItem value="medium">Medium — Application level</SelectItem>
                    <SelectItem value="hard">Hard — Deep understanding</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button onClick={() => { if (!user) { promptSignIn("Viva Prep"); return; } startViva(); }} className="w-full rounded-xl h-12 font-semibold gradient-button text-primary-foreground gap-2" disabled={!selectedSubject}>
              <Mic className="w-4 h-4" />
              {!user ? "Sign in to start" : "Start Viva"}
            </Button>
          </div>
        </motion.div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Viva Simulation"
      subtitle={selectedSubject}
      icon={<div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><GraduationCap className="w-5 h-5 text-primary" /></div>}
    >
      <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-220px)]">
        {/* Session state — the viva flow is a free-form examiner chat, so
            it tracks no question counter/total, timer or score in state;
            only the real session identity (subject + difficulty) is
            surfaced here, plus End Session. */}
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-medium text-primary">
            <BookOpen className="w-3 h-3" /> {selectedSubject}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-medium text-primary">
            <Layers className="w-3 h-3" /> {DIFFICULTY_LABELS[difficulty] || difficulty}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto rounded-xl gap-1.5 text-xs text-muted-foreground hover:text-destructive"
            onClick={resetViva}
          >
            <XCircle className="w-3.5 h-3.5" /> End Session
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1">
          <AnimatePresence>
            {visibleMessages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "gradient-primary text-primary-foreground"
                    : "glass border border-primary/25"
                }`}>
                  {msg.role === "assistant" ? (
                    <div className="space-y-2">
                      <MarkdownMessage content={msg.content} />
                      <button onClick={() => speakText(msg.content)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1">
                        <Volume2 className="w-3 h-3" /> Listen
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm">{msg.content}</p>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {isLoading && visibleMessages[visibleMessages.length - 1]?.role !== "assistant" && (
            <div className="flex justify-start">
              <div className="glass rounded-2xl px-4 py-3 border border-border/30">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:150ms]" />
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Answer area — big gradient mic + text field with Send */}
        <div className="glass rounded-2xl border border-border/30 p-3 space-y-2.5">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleListening}
              aria-label={isListening ? "Stop voice input" : "Answer by voice"}
              className={`w-12 h-12 rounded-full gradient-button text-primary-foreground flex items-center justify-center shrink-0 shadow-elevated transition-transform hover:scale-105 ${isListening ? "animate-pulse ring-2 ring-destructive/50" : ""}`}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <p className="text-xs text-muted-foreground leading-snug">
              {isListening ? "Listening... speak your answer" : "Tap to answer by voice, or type your answer below."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendAnswer()}
              placeholder={isListening ? "Listening... speak your answer" : "Type your answer..."}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none rounded-xl border border-border/50 px-3 py-2.5 focus:border-primary/50"
              disabled={isLoading}
            />
            <Button size="icon" className="rounded-xl gradient-button text-primary-foreground flex-shrink-0" onClick={sendAnswer} disabled={!input.trim() || isLoading}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            After you send an answer, the examiner replies above with feedback and the next question.
          </p>
        </div>
      </div>
    </PageShell>
  );
};

export default VivaPage;
