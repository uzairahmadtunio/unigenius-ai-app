import { useState, useRef, useEffect, useCallback } from "react";
import { fetchWithRetry } from "@/lib/fetch-with-retry";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "@/hooks/use-smart-back";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Bot, User, MessageSquare, BookOpen, Code, ListChecks,
  FileQuestion, ArrowLeft, Mic, Paperclip, X, Upload, FileDown, File, RotateCcw,
  MonitorPlay, PlayCircle, ChevronDown, ChevronUp, LibraryBig,
} from "lucide-react";
import { generateProfessionalPDF, generateDOCX } from "@/lib/pdf-generator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { findSubjectById } from "@/data/subjects";
import { useDepartment, departmentInfo } from "@/contexts/DepartmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import Navbar from "@/components/Navbar";
import Seo from "@/components/Seo";
import Footer from "@/components/Footer";
import { toast } from "sonner";
import { authHeader } from "@/lib/auth-header";
import MarkdownMessage from "@/components/MarkdownMessage";
import { useFileDrop } from "@/hooks/use-file-drop";
import ChatSidebar from "@/components/ChatSidebar";
import SubjectStudySection from "@/components/SubjectStudySection";
import { ACCEPT_EXTENSIONS, isFileAllowed, getFileCategory, FILE_CATEGORY_STYLES, buildFileContentParts, DROP_ZONE_TEXT } from "@/lib/file-types";
import FileIcon from "@/components/FileIcon";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  fileNames?: string[];
  fileThumbnails?: string[];
  error?: boolean;
  retryText?: string;
}

interface AttachedFile {
  name: string;
  type: string;
  dataUrl: string;
  file: File;
  uploadProgress: number;
  thumbnailUrl?: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const TITLE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-title`;
const MAX_FILES = 20;
// File types handled by shared lib

const SubjectHubPage = () => {
  const { subjectId } = useParams<{ subjectId: string }>();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const [searchParams] = useSearchParams();
  const { department } = useDepartment();
  const { user } = useAuth();
  const result = findSubjectById(subjectId || "", department);

  // Custom subjects (from a student's own list) aren't in the hardcoded
  // curriculum — the grid passes their name/semester as query params.
  const nameParam = searchParams.get("name");
  const semParam = Number(searchParams.get("sem") || 0);

  const subjectName = result?.subject.name ?? nameParam ?? "Unknown Subject";
  const semester = semParam > 0 ? semParam : (result?.semester ?? 0);
  const icon = result?.subject.icon ?? "📚";
  const hasLab = result?.subject.hasLab ?? false;
  const deptName = result
    ? departmentInfo[result.department].fullName
    : department
      ? departmentInfo[department].fullName
      : "BS Software Engineering";

  const [mode, setMode] = useState<"tutor" | "viva">("tutor");
  // Hub view: the AI tutor chat, or the Notes Reader (topics + books).
  const [hubView, setHubView] = useState<"chat" | "study">("chat");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingFileIndex, setUploadingFileIndex] = useState(-1);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [titleGenerated, setTitleGenerated] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // This subject's lecture playlists, shown in a strip above the chat so a
  // student can watch a lecture without leaving the subject hub.
  type HubLecture = {
    id: string; subject: string; title: string; channel: string;
    playlist_id: string; thumb_video_id: string | null;
    language: string | null; video_count: number | null;
  };
  const [hubLectures, setHubLectures] = useState<HubLecture[]>([]);
  const [lecOpen, setLecOpen] = useState(true);
  const [lecPlaying, setLecPlaying] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("subject_lectures" as any)
        .select("id, subject, title, channel, playlist_id, thumb_video_id, language, video_count")
        .order("sort_order", { ascending: true });
      if (!data) return;
      const norm = (x: string) =>
        x.toLowerCase().replace(/\(.*?\)/g, " ").replace(/^introduction to /, "")
          .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      const target = norm(subjectName);
      const mine = (data as unknown as HubLecture[]).filter((l) => {
        const n = norm(l.subject);
        return n === target || n.includes(target) || target.includes(n);
      });
      setHubLectures(mine);
    })();
     
  }, [subjectName]);

  // Per-subject toolkit anchor: the tools/language every example must use,
  // so an overlapping topic is always taught from THIS subject's side.
  const subjectToolkit = (() => {
    const n = subjectName.toLowerCase();
    if (n.includes("programming fundamentals")) return "Write all code in C++ (the language this course uses), with dry runs and output tracing in your examples.";
    if (n.includes("object") && n.includes("oriented")) return "Write all code in Java, using classes, objects and the four OOP pillars in every example.";
    if (n.includes("data structure") || n.includes("(dsa)")) return "Use C++ code and Big-O complexity analysis in every example.";
    if (n.includes("database")) return "Use SQL queries, ER diagrams and relational schemas in every example.";
    if (n.includes("digital logic")) return "Use truth tables, Boolean algebra, K-maps and logic-circuit reasoning in every example.";
    if (n.includes("discrete")) return "Use sets, propositional logic, proofs and graph notation; stay mathematical — do not drift into programming.";
    if (n.includes("operating system")) return "Use process/threads, scheduling algorithms and memory-management calculations in every example.";
    if (n.includes("computer network")) return "Use the OSI/TCP-IP model, real protocols and subnetting calculations in every example.";
    if (n.includes("automata")) return "Use state diagrams, transition tables, regular expressions and grammars in every example.";
    if (n.includes("compiler")) return "Use grammars, parse trees and the compiler phases in every example.";
    if (n.includes("organization") || n.includes("assembly")) return "Use assembly language and CPU/datapath diagrams (described in text) in every example.";
    if (n.includes("web engineering")) return "Use HTML, CSS and JavaScript in every code example.";
    if (n.includes("python") || n.includes("machine learning") || n.includes("deep learning") || n.includes("artificial intelligence") || n.includes("data science") || n.includes("natural language") || n.includes("computer vision")) return "Use Python code examples (with the standard libraries of this subject) in every example.";
    if (n.includes("calculus") || n.includes("algebra") || n.includes("statistics") || n.includes("probability")) return "Work every example step-by-step with full mathematical working shown.";
    return "Use this subject's standard tools, notation and textbook examples in every explanation.";
  })();

  const systemPrompt = mode === "viva"
    ? `You are a strict but helpful university professor conducting a mock viva voce for "${subjectName}" in Semester ${semester} of a ${deptName} program. 

IMPORTANT RULES:
- Ask ONE question at a time, then wait for the student's answer
- Mix Roman Urdu and English naturally (like Pakistani university vivas), e.g., "Ye concept samjhao", "Iska output kya hoga?", "Acha, to agar hum ye change karein..."
- Start easy, then increase difficulty
- After the student answers, give brief feedback in the same Roman Urdu/English mix
- If the answer is wrong, guide them toward the correct answer
- Be encouraging but academically rigorous
- Cover different topics within ${subjectName} ONLY — if the student pulls the discussion toward another subject, bring it back to ${subjectName} with your next question

Start by greeting the student and asking your first viva question.`
    : `You are the dedicated professor of "${subjectName}" (Semester ${semester}, ${deptName} program) — a true master of THIS subject only, like a specialist who has taught ${subjectName} for years.

SUBJECT BOUNDARY (strict — follow it in every reply):
- Every explanation, example, analogy, code sample and practice question must be framed INSIDE ${subjectName}: its concepts, its standard tools, its notation and its textbook examples. ${subjectToolkit}
- Many topics overlap other subjects (for example "problem solving" or "logic" appear in several courses). When that happens, teach the topic from ${subjectName}'s angle only, with this subject's methods and examples — never drift into how another subject treats it.
- If the student asks something that clearly belongs to a different subject and has no real connection to ${subjectName}, do NOT teach that subject. In one or two lines, name the subject it belongs to, point them to that subject's hub, and offer the closest related topic inside ${subjectName} instead.
- Help with assignments, lab tasks, past papers and viva preparation ONLY for ${subjectName}.

TEACHING STYLE:
- Explain step-by-step from the student's level, then give one worked example and one quick check question.
- Use the subject's real terminology and exam-style phrasing, and share exam tips specific to ${subjectName}.
- Be encouraging and use markdown formatting. If the student writes in Roman Urdu, you may mirror it briefly, but keep technical terms in English.
- When the user uploads files (images, PDFs, documents), analyze them thoroughly — extract text via OCR from images, read PDF content, and discuss findings strictly in the context of ${subjectName}.`;

  const getWelcome = () => mode === "viva"
    ? `🎤 **Mock Viva Mode — ${subjectName}**\n\nAssalam-o-Alaikum! 👋 I'm your viva examiner. Today we'll cover the key concepts of "${subjectName}".\n\nReady? Let's begin...\n\n*Your first question is coming up...*`
    : `Assalam-o-Alaikum! 👋 Welcome to the **${subjectName}** Study Hub.\n\nI'm your specialized tutor for this subject. I can help you with:\n\n• Understanding key concepts\n• Solving assignments & lab tasks\n• Preparing for midterms & finals\n• Viva preparation & Practice MCQs\n• 📎 **Upload files** — images, PDFs, DOCX (up to 20 at once)\n• 🔍 **OCR** — extract text from photos & diagrams\n\nWhat would you like to study today?`;

  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "assistant", content: getWelcome() },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const { isDragOver, onDragOver, onDragLeave, onDrop } = useFileDrop(attachedFiles, setAttachedFiles, MAX_FILES, isStreaming);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [profileData, setProfileData] = useState<any>(null);

  // Fetch profile for export
  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("display_name, roll_number, section, university, current_semester")
      .eq("user_id", user.id).single().then(({ data }) => { if (data) setProfileData(data); });
  }, [user]);

  // "Ask Tutor about this topic" from a Notes Reader topic page lands
  // here with a prefilled question in sessionStorage.
  useEffect(() => {
    try {
      const pre = sessionStorage.getItem("ug-hub-prefill");
      if (pre) {
        sessionStorage.removeItem("ug-hub-prefill");
        setHubView("chat");
        setInput(pre);
      }
    } catch { /* storage unavailable */ }
     
  }, []);

  const handleExport = (content: string, format: "pdf" | "docx") => {
    const opts = {
      subject: subjectName,
      topic: content.slice(0, 60).replace(/[#*\n]/g, "").trim(),
      semester,
      docType: "assignment" as const,
      studentInfo: {
        name: profileData?.display_name || "",
        rollNumber: profileData?.roll_number || "",
        department: deptName,
        section: profileData?.section || "",
        university: profileData?.university || "The University of Larkano",
      },
    };
    if (format === "pdf") generateProfessionalPDF(content, opts);
    else generateDOCX(content, opts);
  };
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-load last active chat for this subject
  useEffect(() => {
    if (!user || !subjectId) return;
    const loadLastSession = async () => {
      // maybeSingle, not single: a student opening this subject's tutor
      // for the first time has no session yet, and .single() on zero
      // rows makes PostgREST answer 406 (console noise on every visit).
      const { data } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("user_id", user.id)
        .eq("subject", subjectId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        loadChat(data.id);
      }
    };
    loadLastSession();
  }, [user, subjectId]);

  const createChatSession = async (): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: user.id, title: `${subjectName} Chat`, subject: subjectId })
      .select("id")
      .single();
    if (error) { console.error("Failed to create chat session:", error); return null; }
    return data.id;
  };

  const saveMessage = async (chatId: string, role: string, content: string, fileNames?: string[], fileUrls?: string[]) => {
    if (!user) return;
    await supabase.from("chat_messages").insert({
      chat_id: chatId, user_id: user.id, role, content,
      file_names: fileNames || [], file_urls: fileUrls || [],
    });
    await supabase.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
  };

  const generateTitle = async (chatId: string, msgs: Message[]) => {
    if (!user || titleGenerated) return;
    try {
      const resp = await fetch(TITLE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${await authHeader()}`,
        },
        body: JSON.stringify({
          messages: msgs.filter(m => !m.id.startsWith("welcome")).map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const { title } = await resp.json();
      if (title && title !== "New Chat") {
        await supabase.from("chat_sessions").update({ title }).eq("id", chatId);
        setTitleGenerated(true);
        setSidebarRefresh(prev => prev + 1);
      }
    } catch (e) { console.error("Title generation error:", e); }
  };

  const loadChat = async (chatId: string) => {
    if (!user) return;
    setActiveChatId(chatId);
    setTitleGenerated(true);
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    if (error) { toast.error("Failed to load chat"); return; }
    const loadedMessages: Message[] = [
      { id: "welcome", role: "assistant", content: getWelcome() },
      ...(data || []).map((m: any) => ({
        id: m.id, role: m.role as "user" | "assistant", content: m.content,
        fileNames: m.file_names?.length > 0 ? m.file_names : undefined,
      })),
    ];
    setMessages(loadedMessages);
    setAttachedFiles([]);
    setInput("");
  };

  const handleNewChat = () => {
    setActiveChatId(null);
    setMessages([{ id: "welcome", role: "assistant", content: getWelcome() }]);
    setTitleGenerated(false);
    setAttachedFiles([]);
    setInput("");
  };

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, []);

  useEffect(() => { autoResize(); }, [input, autoResize]);

  const switchMode = (newMode: "tutor" | "viva") => {
    setMode(newMode);
    setAttachedFiles([]);
    setActiveChatId(null);
    setTitleGenerated(false);
    setMessages([{ id: "welcome-" + newMode, role: "assistant", content: newMode === "viva"
      ? `🎤 **Mock Viva Mode — ${subjectName}**\n\nAssalam-o-Alaikum! 👋 I'm your viva examiner. Ready? Let's begin...`
      : getWelcome()
    }]);
    setIsStreaming(false);
    setInput("");
    if (newMode === "viva") {
      setTimeout(() => handleSend("Start the viva"), 500);
    }
  };

  // ─── File handling ───────────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (attachedFiles.length + files.length > MAX_FILES) {
      toast.error("Maximum 20 files allowed per message for best AI analysis.");
      e.target.value = "";
      return;
    }
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) { toast.error(`File too large: ${f.name} (max 20MB)`); continue; }
      if (!isFileAllowed(f)) {
        toast.error(`Unsupported file: ${f.name}`); continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setAttachedFiles(prev => {
          if (prev.length >= MAX_FILES) return prev;
          return [...prev, {
            name: f.name, type: f.type, dataUrl, file: f,
            uploadProgress: 0,
            thumbnailUrl: f.type.startsWith("image/") ? dataUrl : undefined,
          }];
        });
      };
      reader.readAsDataURL(f);
    }
    e.target.value = "";
  };

  const removeFile = (idx: number) => setAttachedFiles(prev => prev.filter((_, i) => i !== idx));

  const uploadToStorage = async (files: AttachedFile[]): Promise<string[]> => {
    const urls: string[] = [];
    const userId = user?.id || "anonymous";
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setUploadingFileIndex(i);
      setAttachedFiles(prev => prev.map((af, idx) => idx === i ? { ...af, uploadProgress: 20 } : af));

      const ext = f.name.split(".").pop() || "bin";
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      setAttachedFiles(prev => prev.map((af, idx) => idx === i ? { ...af, uploadProgress: 50 } : af));

      const { error } = await supabase.storage.from("chat-uploads").upload(path, f.file, {
        contentType: f.type, upsert: false,
      });

      if (error) {
        console.error("Upload error:", error);
        urls.push("");
      } else {
        // chat-uploads is a PRIVATE bucket — signed URL (1 hour) instead of public.
        const { data: urlData } = await supabase.storage.from("chat-uploads").createSignedUrl(path, 3600);
        urls.push(urlData?.signedUrl || "");
      }
      setAttachedFiles(prev => prev.map((af, idx) => idx === i ? { ...af, uploadProgress: 100 } : af));
    }
    setUploadingFileIndex(-1);
    return urls;
  };

  // ─── Chat streaming ─────────────────────────────────────────
  const streamChat = async (allMessages: { role: string; content: string | any[] }[]) => {
    // Watchdog: cap the wait for response headers (60s) and for each
    // stream chunk (45s of silence) — a stalled provider must surface an
    // error, never an endless silent hang.
    const controller = new AbortController();
    const headerTimer = setTimeout(() => controller.abort(), 60000);
    let resp: Response;
    try {
      resp = await fetchWithRetry(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `${await authHeader()}`,
        },
        body: JSON.stringify({
          messages: [{ role: "system", content: systemPrompt }, ...allMessages],
        }),
        signal: controller.signal,
      });
    } catch (e: any) {
      if (controller.signal.aborted) {
        throw new Error("The AI took too long to respond — it may be busy or cooling down. Please try again.");
      }
      throw e;
    } finally {
      clearTimeout(headerTimer);
    }

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      throw new Error(errorData.error || `Error: ${resp.status}`);
    }
    if (!resp.body) throw new Error("No stream body");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = "";
    let assistantSoFar = "";
    const assistantId = Date.now().toString();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    const readWithTimeout = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The AI took too long to respond — it may be busy or cooling down. Please try again.")), 45000);
      });
      try {
        return await Promise.race([reader.read(), timeout]);
      } catch (e) {
        try { await reader.cancel(); } catch { /* ignore cancel errors */ }
        controller.abort();
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    while (true) {
      const { done, value } = await readWithTimeout();
      if (done) break;
      textBuffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") break;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) {
            assistantSoFar += content;
            const snapshot = assistantSoFar;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: snapshot } : m))
            );
          }
        } catch {
          textBuffer = line + "\n" + textBuffer;
          break;
        }
      }
    }
    return assistantSoFar;
  };

  // ─── Send handler ────────────────────────────────────────────
  const handleSend = async (text?: string) => {
    const msg = text || input.trim();
    if ((!msg && attachedFiles.length === 0) || isStreaming) return;

    const fileNames = attachedFiles.map(f => f.name);
    const fileThumbnails = attachedFiles.filter(f => f.type.startsWith("image/")).map(f => f.dataUrl);

    const displayContent = attachedFiles.length > 0
      ? `${msg}${msg ? "\n\n" : ""}📎 ${attachedFiles.length} file${attachedFiles.length > 1 ? "s" : ""} attached`
      : msg;

    const userMsg: Message = {
      id: Date.now().toString(), role: "user", content: displayContent,
      fileNames: fileNames.length > 0 ? fileNames : undefined,
      fileThumbnails: fileThumbnails.length > 0 ? fileThumbnails : undefined,
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsStreaming(true);

    try {
      let storageUrls: string[] = [];
      if (attachedFiles.length > 0 && user) {
        setIsUploading(true);
        storageUrls = await uploadToStorage(attachedFiles);
        setIsUploading(false);
      }

      // Ensure we have a chat session
      let chatId = activeChatId;
      if (!chatId && user) {
        chatId = await createChatSession();
        if (chatId) {
          setActiveChatId(chatId);
          setSidebarRefresh(prev => prev + 1);
        }
      }

      // Save user message to DB
      if (chatId && user) {
        await saveMessage(chatId, "user", displayContent, fileNames, storageUrls);
      }

      // Build multimodal API content
      let apiContent: string | any[];
      if (attachedFiles.length > 0) {
        const parts: any[] = [];
        if (msg) parts.push({ type: "text", text: msg });

        if (attachedFiles.length > 1) {
          parts.push({
            type: "text",
            text: `The student has uploaded ${attachedFiles.length} files for "${subjectName}". Analyze ALL files together. Provide a structured response: first an overview summary, then address each file individually (e.g., "**File 1: ${attachedFiles[0]?.name}** — ..."), and finally a combined conclusion.`,
          });
        }

        for (let i = 0; i < attachedFiles.length; i++) {
          parts.push(...(await buildFileContentParts(attachedFiles[i], i, attachedFiles.length, subjectName)));
        }
        apiContent = parts;
      } else {
        apiContent = msg;
      }

      const apiMessages = newMessages
        .filter((m) => !m.id.startsWith("welcome"))
        .map((m, i, arr) =>
          i === arr.length - 1
            ? { role: m.role, content: apiContent }
            : { role: m.role, content: m.content }
        );
      const assistantContent = await streamChat(apiMessages);

      // Save assistant message to DB
      if (chatId && user && assistantContent) {
        await saveMessage(chatId, "assistant", assistantContent);
      }

      // Generate title after first exchange
      const userMsgCount = newMessages.filter(m => m.role === "user").length;
      if (chatId && userMsgCount >= 1 && !titleGenerated) {
        const allMsgs = [...newMessages, { id: "temp", role: "assistant" as const, content: assistantContent }];
        generateTitle(chatId, allMsgs);
      }
    } catch (err: any) {
      // Visible error + retry, never a silent failure.
      setMessages((prev) => prev.filter((m) => !(m.role === "assistant" && m.content === "")));
      setMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `⚠️ ${err.message || "Something went wrong while contacting the AI."}`,
        error: true,
        retryText: msg,
      }]);
      toast.error(err.message || "Failed to get response");
    } finally {
      setIsStreaming(false);
      setAttachedFiles([]);
    }
  };

  // Study-mode quick prompts FILL the input (student adds their topic, then
  // sends). Viva-mode buttons are conversational replies and still send at once.
  const smartButtons = mode === "viva"
    ? [
        { icon: Mic, label: "I'm ready, ask next question" },
        { icon: BookOpen, label: "Explain the answer" },
        { icon: ListChecks, label: "Give me a hint" },
      ]
    : [
        { icon: MessageSquare, label: `Explain a topic from ${subjectName.split("(")[0].trim()}`, prompt: `Explain a topic from ${subjectName.split("(")[0].trim()}: ` },
        { icon: ListChecks, label: "Solve Step-by-Step", prompt: "Solve step-by-step: " },
        { icon: Code, label: "Give Code Example", prompt: "Give a code example of: " },
        { icon: FileQuestion, label: "Generate MCQs", prompt: "Generate MCQs on: " },
        { icon: BookOpen, label: "Prepare for Viva", prompt: "Prepare me for viva on: " },
      ];

  const fillPrompt = (prompt: string) => {
    setInput((prev) => {
      const t = prev.trim();
      return t ? `${prompt}${t}` : prompt;
    });
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const end = ta.value.length;
        ta.setSelectionRange(end, end);
      }
    });
  };

  // File icon handled by FileIcon component

  // Subjects that aren't in the built-in curriculum (scheme/pool names)
  // still open when the grid carried their name+semester in the URL.
  if (!result && !nameParam) {
    return (
      <div className="min-h-screen flex flex-col gradient-hero">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="glass rounded-2xl p-8 text-center space-y-4">
            <p className="text-4xl">🔍</p>
            <h2 className="font-display font-bold text-xl text-foreground">Subject Not Found</h2>
            <p className="text-sm text-muted-foreground">The subject you're looking for doesn't exist.</p>
            <Button onClick={() => navigate("/")} className="rounded-xl gradient-primary text-primary-foreground">
              Back to Dashboard
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col gradient-hero" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <Seo
        title={`${subjectName} — Notes, Lectures & Practice | UniGenius AI`}
        description={`Study ${subjectName} on UniGenius AI: structured topic pages, video lectures, notes, past papers and practice questions for this subject, all in one hub.`}
        path={`/subject/${subjectId}`}
      />
      <Navbar onMenuToggle={() => setMobileSidebarOpen(prev => !prev)} showMenu />
      {isDragOver && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="glass rounded-2xl p-8 flex flex-col items-center gap-3 border-2 border-dashed border-primary">
            <Upload className="w-10 h-10 text-primary" />
            <p className="font-display font-semibold text-foreground">Drop files here</p>
            <p className="text-xs text-muted-foreground">{DROP_ZONE_TEXT} — up to {MAX_FILES} files</p>
          </div>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        {/* Subject-specific Chat Sidebar */}
        <ChatSidebar
          activeChatId={activeChatId}
          onSelectChat={loadChat}
          onNewChat={handleNewChat}
          refreshTrigger={sidebarRefresh}
          subject={subjectId || null}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />

        <div className="flex-1 flex flex-col max-w-3xl mx-auto px-4 py-4 w-full">
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => goBack("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="text-2xl">{icon}</span>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-lg text-foreground truncate">{subjectName}</h1>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Semester {semester}</p>
              {hasLab && <Badge variant="secondary" className="text-xs rounded-lg">Lab</Badge>}
            </div>
          </div>
        </div>

        {/* View Toggle: Tutor Chat vs Notes Reader (Topics & Books) */}
        <div className="flex gap-2 mb-3">
          <Button
            variant={hubView === "chat" ? "default" : "outline"}
            size="sm"
            className={`rounded-xl text-xs gap-1.5 ${hubView === "chat" ? "gradient-primary text-primary-foreground" : ""}`}
            onClick={() => setHubView("chat")}
          >
            <MessageSquare className="w-3 h-3" /> AI Tutor
          </Button>
          <Button
            variant={hubView === "study" ? "default" : "outline"}
            size="sm"
            className={`rounded-xl text-xs gap-1.5 ${hubView === "study" ? "gradient-primary text-primary-foreground" : ""}`}
            onClick={() => setHubView("study")}
          >
            <LibraryBig className="w-3 h-3" /> Topics & Books
          </Button>
        </div>

        {/* Mode Toggle (chat view only) */}
        {hubView === "chat" && (
        <div className="flex gap-2 mb-4">
          <Button
            variant={mode === "tutor" ? "default" : "outline"}
            size="sm"
            className={`rounded-xl text-xs gap-1.5 ${mode === "tutor" ? "gradient-primary text-primary-foreground" : ""}`}
            onClick={() => mode !== "tutor" && switchMode("tutor")}
          >
            <BookOpen className="w-3 h-3" /> Study Mode
          </Button>
          <Button
            variant={mode === "viva" ? "default" : "outline"}
            size="sm"
            className={`rounded-xl text-xs gap-1.5 ${mode === "viva" ? "gradient-primary text-primary-foreground" : ""}`}
            onClick={() => mode !== "viva" && switchMode("viva")}
          >
            <Mic className="w-3 h-3" /> Mock Viva
          </Button>
        </div>
        )}

        {/* This subject's lectures (trial section — removable) */}
        {hubLectures.length > 0 && (
          <div className="mb-4 glass rounded-2xl border border-border overflow-hidden shrink-0">
            <button
              onClick={() => setLecOpen((o) => !o)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold"
            >
              <MonitorPlay className="w-4 h-4 text-red-500" />
              Lectures for this Subject
              <span className="text-xs font-medium text-muted-foreground">
                {hubLectures.length} playlists
              </span>
              <span className="ml-auto text-muted-foreground">
                {lecOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </span>
            </button>
            {lecOpen && (
              <div className="px-3 pb-3 space-y-3">
                {lecPlaying && (
                  <div className="aspect-video w-full bg-black rounded-xl overflow-hidden">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/videoseries?list=${lecPlaying}&rel=0`}
                      title="Subject lecture playlist"
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                )}
                <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
                  {hubLectures.map((lec) => (
                    <button
                      key={lec.id}
                      onClick={() => setLecPlaying(lec.playlist_id)}
                      className="w-52 shrink-0 text-left group"
                    >
                      <div className="relative aspect-video rounded-xl overflow-hidden bg-gradient-to-br from-red-500/15 via-muted/40 to-primary/10">
                        {lec.thumb_video_id && (
                          <img
                            src={`https://i.ytimg.com/vi/${lec.thumb_video_id}/hqdefault.jpg`}
                            alt={lec.title}
                            loading="lazy"
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        )}
                        <span className="absolute inset-0 bg-black/25 group-hover:bg-black/35 transition-colors" />
                        <PlayCircle className="w-9 h-9 text-white drop-shadow absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
                        {lec.language && (
                          <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-black/60 text-white">
                            {lec.language}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs font-medium leading-snug line-clamp-2">{lec.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {lec.channel}
                        {lec.video_count ? ` • ${lec.video_count} videos` : ""}
                      </p>
                    </button>
                  ))}
                </div>
                <a href="/lectures" className="inline-block text-xs font-medium text-primary hover:underline">
                  For all lectures and your progress, open the Lectures page →
                </a>
              </div>
            )}
          </div>
        )}

        {hubView === "study" ? (
          <SubjectStudySection subjectName={subjectName} subjectId={subjectId || ""} />
        ) : (<>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
              >
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0 mt-1">
                    <Bot className="w-4 h-4 text-primary-foreground" />
                  </div>
                )}
                <div className="max-w-[80%] space-y-2">
                  {/* Image thumbnails */}
                  {msg.role === "user" && msg.fileThumbnails && msg.fileThumbnails.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-end">
                      {msg.fileThumbnails.map((thumb, i) => (
                        <div key={i} className="w-20 h-20 rounded-xl overflow-hidden border border-border/30">
                          <img src={thumb} alt={`Upload ${i + 1}`} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                  {/* File name chips */}
                  {msg.role === "user" && msg.fileNames && msg.fileNames.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {msg.fileNames.map((name, i) => (
                        <span key={i} className="glass rounded-lg px-2 py-1 text-[10px] text-muted-foreground flex items-center gap-1">
                          <FileIcon fileName={name} size="xs" />
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "gradient-primary text-primary-foreground"
                        : "glass text-foreground"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <MarkdownMessage content={msg.content} />
                    ) : (
                      msg.content || "…"
                    )}
                  </div>
                  {msg.error && msg.retryText && (
                    <button
                      onClick={() => handleSend(msg.retryText)}
                      disabled={isStreaming}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors mt-1.5 disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Retry
                    </button>
                  )}
                  {/* Export buttons for long AI responses */}
                  {msg.role === "assistant" && msg.id !== "welcome" && msg.content.length > 300 && (
                    <div className="flex gap-1.5 mt-1.5">
                      <button
                        onClick={() => handleExport(msg.content, "pdf")}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        <FileDown className="w-3 h-3" /> PDF
                      </button>
                      <button
                        onClick={() => handleExport(msg.content, "docx")}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                      >
                        <File className="w-3 h-3" /> DOCX
                      </button>
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 mt-1">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {isStreaming && messages[messages.length - 1]?.role === "user" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
              <div className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="glass rounded-2xl px-4 py-3 flex items-center gap-2">
                 {isUploading ? (
                   <div className="space-y-1">
                     <span className="text-xs text-muted-foreground">
                       Uploading {uploadingFileIndex + 1}/{attachedFiles.length} — {Math.round(((uploadingFileIndex) / attachedFiles.length) * 100 + (attachedFiles[uploadingFileIndex]?.uploadProgress ?? 0) / attachedFiles.length)}%
                     </span>
                     <Progress value={Math.round(((uploadingFileIndex) / attachedFiles.length) * 100 + (attachedFiles[uploadingFileIndex]?.uploadProgress ?? 0) / attachedFiles.length)} className="h-1.5 w-40" />
                  </div>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse" />
                    <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse [animation-delay:0.2s]" />
                    <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse [animation-delay:0.4s]" />
                  </>
                )}
              </div>
            </motion.div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Smart Buttons */}
        <div className="flex flex-wrap gap-2 pb-3">
          {smartButtons.map((btn) => (
            <Button
              key={btn.label}
              variant="outline"
              size="sm"
              className="rounded-xl text-xs gap-1.5"
              onClick={() => ("prompt" in btn && btn.prompt ? fillPrompt(btn.prompt) : handleSend(btn.label))}
              disabled={isStreaming}
            >
              <btn.icon className="w-3 h-3" />
              {btn.label}
            </Button>
          ))}
        </div>

        {/* Attached files preview */}
        <AnimatePresence>
          {attachedFiles.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="pb-2 space-y-2"
            >
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] text-muted-foreground font-medium">
                  {`${attachedFiles.length}/${MAX_FILES} files attached`}
                </span>
                {attachedFiles.length > 1 && (
                  <button onClick={() => setAttachedFiles([])} className="text-[11px] text-destructive hover:text-destructive/80 transition-colors">
                    Clear all
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[240px] overflow-y-auto">
                {attachedFiles.map((f, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="glass rounded-xl overflow-hidden border border-border/50 relative group"
                  >
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-destructive/20 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    {f.thumbnailUrl ? (
                      <div className="w-[88px]">
                        <div className="w-full h-16 overflow-hidden">
                          <img src={f.thumbnailUrl} alt={f.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="px-2 py-1.5 space-y-1">
                          <p className="text-[10px] text-foreground truncate max-w-[72px]">{f.name}</p>
                          <p className="text-[9px] text-muted-foreground">{(f.file.size / 1024).toFixed(0)}KB</p>
                          {f.uploadProgress > 0 && f.uploadProgress < 100 && (
                            <Progress value={f.uploadProgress} className="h-1" />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="px-3 py-2 flex items-center gap-2 min-w-[120px]">
                        <div className={`w-9 h-9 rounded-lg ${FILE_CATEGORY_STYLES[getFileCategory(f.type)].bgColor} flex items-center justify-center flex-shrink-0`}>
                          <FileIcon fileName={f.name} mimeType={f.type} size="sm" />
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-[11px] text-foreground truncate max-w-[100px] font-medium">{f.name}</p>
                          <p className="text-[9px] text-muted-foreground">{(f.file.size / 1024).toFixed(0)}KB</p>
                          {f.uploadProgress > 0 && f.uploadProgress < 100 && (
                            <Progress value={f.uploadProgress} className="h-1" />
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input */}
        <div className="glass rounded-2xl p-2 flex gap-2 items-end">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            multiple
            accept={ACCEPT_EXTENSIONS}
            className="hidden"
          />
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl flex-shrink-0 relative"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming || attachedFiles.length >= MAX_FILES}
          >
            <Paperclip className="w-4 h-4" />
            {attachedFiles.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                {attachedFiles.length}
              </span>
            )}
          </Button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              attachedFiles.length > 0
                ? `Add a message about your ${attachedFiles.length} file${attachedFiles.length > 1 ? "s" : ""}...`
                : mode === "viva"
                ? "Type your answer..."
                : `Ask about ${subjectName}, or attach files…`
            }
            className="flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none min-h-[40px] max-h-[120px]"
            rows={1}
          />
          <Button
            size="icon"
            className="rounded-xl gradient-primary flex-shrink-0"
            onClick={() => handleSend()}
            disabled={(!input.trim() && attachedFiles.length === 0) || isStreaming}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        </>)}
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default SubjectHubPage;
