import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";
import { generateContentWithFailover } from "../_shared/ai-failover.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-ai-tier, x-ai-key-index",
};

const json = (body: unknown, extraHeaders: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });

// ─── Question bank (service role) ─────────────────────────────────────
// The bank is the speed layer for Practice Mode: questions already in
// question_bank are served instantly with no AI call, AI only fills the
// remainder, and fresh AI questions are written back so coverage grows.
let serviceClient: any = null;
function getServiceClient(): any | null {
  if (serviceClient) return serviceClient;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  serviceClient = createClient(url, key);
  return serviceClient;
}

/** "Object-Oriented Programming (OOP)" -> "objectorientedprogramming" */
const norm = (s: string) =>
  (s || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, "");

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Find the subject string as stored in question_bank for a requested name. */
async function findBankSubject(sb: any, subject: string): Promise<string | null> {
  const { data, error } = await sb.from("question_bank").select("subject");
  if (error || !data) return null;
  const target = norm(subject);
  const hit = [...new Set(data.map((r: any) => r.subject as string))].find(
    (s) => norm(s) === target,
  );
  return hit ?? null;
}

interface BankMcq {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correct: string;
  explanation: string;
  topic: string;
  source: "bank";
}

async function fetchBankMcqs(
  sb: any,
  storedSubject: string,
  topic: string | undefined,
  limit: number,
): Promise<BankMcq[]> {
  const { data, error } = await sb
    .from("question_bank")
    .select("topic, question, option_a, option_b, option_c, option_d, correct_answer, explanation")
    .eq("subject", storedSubject);
  if (error || !data) return [];
  let rows = data as any[];
  if (topic) rows = rows.filter((r) => norm(r.topic) === norm(topic));
  return shuffle(rows)
    .slice(0, limit)
    .map((r) => ({
      question: r.question,
      options: { A: r.option_a, B: r.option_b, C: r.option_c, D: r.option_d },
      correct: r.correct_answer,
      explanation: r.explanation ?? "",
      topic: r.topic ?? "",
      source: "bank" as const,
    }));
}

/** Write fresh AI-generated MCQs back into the bank (dedupe by question text). */
async function saveToBank(
  sb: any,
  storedSubject: string,
  questions: any[],
  userId: string,
  semester: number | undefined,
) {
  try {
    const { data } = await sb.from("question_bank").select("question").eq("subject", storedSubject);
    const existing = new Set((data ?? []).map((r: any) => norm(r.question)));
    const rows = questions
      .filter((q) => q?.question && q?.options && q?.correct && !existing.has(norm(q.question)))
      .map((q) => ({
        created_by: userId,
        subject: storedSubject,
        topic: (q.topic || "General").toString().slice(0, 120),
        question: q.question,
        option_a: q.options.A,
        option_b: q.options.B,
        option_c: q.options.C,
        option_d: q.options.D,
        correct_answer: q.correct,
        explanation: q.explanation ?? "",
        semester: typeof semester === "number" ? semester : null,
      }));
    if (rows.length) {
      const { error } = await sb.from("question_bank").insert(rows);
      if (error) console.error("question_bank insert failed:", error.message);
    }
  } catch (e) {
    console.error("saveToBank failed:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  try {
    const {
      subject, department, count = 30, fileData, fileType, fileName, mode,
      topic, bankOnly = false, bankFirst = true, semester,
      difficulty, weakTopics,
    } = await req.json();

    // ─── Adaptive level guidance (optional, backward compatible) ──────
    // The client derives the student's level for the subject from their
    // quiz history and passes it here. When absent, generation behaves
    // exactly as before. Guidance applies ONLY to AI-generated questions
    // (bank questions are served as-is and never pass through here).
    const DIFFICULTY_GUIDANCE: Record<string, string> = {
      Easy: "recall and basic concepts — definitions, direct facts and simple one-step questions a beginner can answer after a first reading",
      Medium: "application — using concepts in short scenarios and standard problems, not just recalling them",
      Hard: "analysis and multi-step reasoning — questions that combine concepts, need several steps, or ask the student to compare/evaluate",
    };
    const validDifficulty =
      typeof difficulty === "string" && difficulty in DIFFICULTY_GUIDANCE
        ? difficulty
        : null;
    const validWeakTopics = Array.isArray(weakTopics)
      ? weakTopics.filter((t: unknown) => typeof t === "string" && t.trim()).slice(0, 5)
      : [];
    const adaptiveGuidance = (() => {
      if (!validDifficulty && validWeakTopics.length === 0) return "";
      let g = "\n\nADAPTIVE LEVEL GUIDANCE:";
      if (validDifficulty) {
        g += ` Target difficulty level: ${validDifficulty} — ${DIFFICULTY_GUIDANCE[validDifficulty]}. Keep every generated question at about this level.`;
      }
      if (validWeakTopics.length > 0) {
        g += ` The student is weak in these topics: ${validWeakTopics.join(", ")}. Aim roughly 40% of the generated questions at these weak topics (still tagged with their real topic), and spread the rest across the subject's other important topics.`;
      }
      return g;
    })();

    const sb = getServiceClient();
    const storedSubject = sb && subject && !fileData ? await findBankSubject(sb, subject) : null;

    // ─── Topic catalogue for a subject (bank topics + counts) ─────────
    if (mode === "topics") {
      if (!sb || !storedSubject) return json({ topics: [] });
      const { data } = await sb.from("question_bank").select("topic").eq("subject", storedSubject);
      const counts = new Map<string, number>();
      (data ?? []).forEach((r: any) => {
        const t = (r.topic || "").trim();
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      });
      const topics = [...counts.entries()]
        .map(([t, c]) => ({ topic: t, count: c }))
        .sort((a, b) => b.count - a.count);
      return json({ topics });
    }

    // ─── Subjective (short-answer) mode ───────────────────────────────
    // Returns open-ended questions with a model answer + key points the
    // grader (grade-answers) later scores student answers against.
    // Every question is tagged with its topic for the end-of-quiz report.
    if (mode === "subjective") {
      const numQ = Math.min(Math.max(count, 3), 10);
      const parts: any[] = [];
      let systemText = "";
      const topicRule = topic
        ? ` Every question must be strictly about the topic "${topic}" within this subject. Set each question's topic to "${topic}".`
        : ` Tag each question with topic = the specific topic of the subject it tests (a short name, e.g. "Loops", "Inheritance").`;

      if (fileData && fileType) {
        systemText = `You are a university exam question generator for ${department || "Software Engineering"} students. Analyze the uploaded file content carefully and write exactly ${numQ} short-answer (subjective) questions based SPECIFICALLY on the content of this file. Each question must be answerable in 3-6 sentences.`;
        const base64 = fileData.startsWith("data:") ? fileData.split(",")[1] : fileData;
        parts.push({ inline_data: { mime_type: fileType, data: base64 } });
        parts.push({ text: `Read ALL content in this uploaded file (${fileName || "file"}). First silently outline the file's sections and main topics, then distribute the questions across those sections in proportion to their size. Write exactly ${numQ} short-answer questions based ONLY on this content — every question must be answerable from the file itself, never from outside knowledge.${subject ? ` Subject context: ${subject}.` : ""} For each question, provide a complete model answer and the key points a correct answer must mention. Tag each question with topic = the section/topic of the file it comes from.` });
      } else {
        systemText = `You are a university exam question generator for ${department || "Software Engineering"} students. Write exactly ${numQ} short-answer (subjective) questions about "${subject}". Each question must be answerable in 3-6 sentences and test understanding, not memorised one-liners.${topicRule}`;
        parts.push({ text: `Write ${numQ} diverse short-answer questions for the subject "${subject}"${topic ? ` focused strictly on the topic "${topic}"` : " covering its most important concepts"}. For each question, provide a complete model answer (3-6 sentences) and the key points a correct answer must mention.${topicRule}` });
      }

      systemText += adaptiveGuidance;

      const saToolDecl = {
        function_declarations: [{
          name: "return_subjective_questions",
          description: `Return ${numQ} short-answer questions with model answers, key points and topic tags.`,
          parameters: {
            type: "OBJECT",
            properties: {
              questions: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    question: { type: "STRING" },
                    modelAnswer: { type: "STRING" },
                    keyPoints: { type: "ARRAY", items: { type: "STRING" } },
                    topic: { type: "STRING" },
                  },
                  required: ["question", "modelAnswer", "keyPoints", "topic"],
                },
              },
            },
            required: ["questions"],
          },
        }],
      };

      const saResult = await generateContentWithFailover({
        // Quiz generation is one long non-streamed call — give it a
        // bigger budget than the chat-tuned 30s/45s defaults, under
        // which every attempt aborted as a provider timeout.
        attemptTimeoutMs: 50_000,
        deadlineMs: 55_000,
        modelPath: "gemini-3.5-flash",
        geminiBody: {
          system_instruction: { parts: [{ text: systemText }] },
          contents: [{ role: "user", parts }],
          tools: [saToolDecl],
          tool_config: { function_calling_config: { mode: "ANY", allowed_function_names: ["return_subjective_questions"] } },
        },
        corsHeaders,
      });
      if (saResult instanceof Response) return saResult;

      const saFc = saResult.data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
      if (!saFc) throw new Error("No function call in response");
      return json(saFc.functionCall.args, {
        "x-ai-tier": saResult.tier,
        "x-ai-key-index": String(saResult.keyIndex),
      });
    }

    const numQuestions = Math.min(Math.max(count, 5), 30);

    // ─── Bank-only fast path (MCQ, no file) ───────────────────────────
    // Returns whatever the bank already has for this subject/topic with
    // NO AI call, so the quiz can start instantly; the client then asks
    // for the remainder separately.
    if (bankOnly) {
      if (!sb || !storedSubject) return json({ questions: [], bankCount: 0, aiCount: 0 });
      const bankQs = await fetchBankMcqs(sb, storedSubject, topic, numQuestions);
      return json({ questions: bankQs, bankCount: bankQs.length, aiCount: 0 }, { "x-ai-tier": "bank" });
    }

    // ─── MCQ mode ─────────────────────────────────────────────────────
    // Bank questions are merged in first (instant), AI generates only
    // the remainder, and the fresh AI questions are saved back.
    let bankQs: BankMcq[] = [];
    if (!fileData && bankFirst && sb && storedSubject) {
      bankQs = await fetchBankMcqs(sb, storedSubject, topic, numQuestions);
      if (bankQs.length >= numQuestions) {
        return json(
          { questions: bankQs.slice(0, numQuestions), bankCount: numQuestions, aiCount: 0 },
          { "x-ai-tier": "bank" },
        );
      }
    }
    const aiCount = numQuestions - bankQs.length;

    const parts: any[] = [];
    let systemText = "";

    // Answer-validity rules: every question must have exactly ONE answer that
    // is unambiguously correct under the language/ subject standard. In
    // particular, never build a question whose "correct" option depends on
    // undefined or unspecified behaviour in C/C++ (e.g. `a++ + ++a`, modifying
    // a variable twice between sequence points, signed integer overflow,
    // reading uninitialized memory, evaluation-order tricks) or on any other
    // non-standard trick. If a code snippet's output is not guaranteed by the
    // standard, do not ask about its output — ask about the concept instead.
    const VALIDITY_RULES = `

STRICT ANSWER-VALIDITY RULES:
- Every question must have exactly one option that is unambiguously correct.
- NEVER ask questions whose correct answer depends on undefined, unspecified, or implementation-defined behaviour — e.g. expressions like a++ + ++a, modifying the same variable twice in one expression, signed integer overflow, uninitialized variables, or operand evaluation order in C/C++/Java.
- Code-output questions are allowed ONLY when the output is fully guaranteed by the language standard for every conforming compiler/interpreter.
- Prefer concept, theory, and standard-guaranteed behaviour questions over trick questions.`;

    const topicRule = topic
      ? ` Every question must be strictly about the topic "${topic}" within the subject. Set each question's topic to "${topic}".`
      : ` Tag each question with topic = the specific topic of the subject it tests (a short name, e.g. "Loops", "Inheritance", "K-Maps").`;

    if (fileData && fileType) {
      const isImage = fileType.startsWith("image/");
      systemText = `You are a university exam question generator for ${department || "Software Engineering"} students. Analyze the uploaded file content carefully and generate exactly ${aiCount} MCQs based SPECIFICALLY on the content of this file.${VALIDITY_RULES}`;

      if (isImage) {
        const base64 = fileData.startsWith("data:") ? fileData.split(",")[1] : fileData;
        parts.push({ inline_data: { mime_type: fileType, data: base64 } });
        parts.push({ text: `This is an uploaded image (${fileName || "image"}). Read and analyze ALL text, diagrams, and content visible in this image. First silently outline the sections and main topics visible, then distribute the questions across them in proportion to their size. Then generate exactly ${aiCount} MCQs based ONLY on this content — every question must be answerable from this image alone, never from outside knowledge.${subject ? ` Subject context: ${subject}.` : ""} Tag each question with topic = the section/topic of the image it comes from.` });
      } else {
        const base64 = fileData.startsWith("data:") ? fileData.split(",")[1] : fileData;
        parts.push({ inline_data: { mime_type: fileType, data: base64 } });
        parts.push({ text: `Analyze this uploaded document thoroughly. First silently outline the document's sections and main topics, then distribute the questions across those sections in proportion to their size. Generate exactly ${aiCount} MCQs based ONLY on the specific content of this file — every question must be answerable from the file itself, never from outside knowledge.${subject ? ` Subject context: ${subject}.` : ""} Tag each question with topic = the section/topic of the file it comes from.` });
      }
    } else {
      systemText = `You are a university exam question generator for ${department} students. Generate exactly ${aiCount} diverse multiple choice questions about "${subject}".${VALIDITY_RULES}${topicRule}`;
      parts.push({ text: `Generate ${aiCount} diverse MCQs for the subject "${subject}"${topic ? ` focused strictly on the topic "${topic}"` : " covering all important topics"}. Each question must have 4 options (A, B, C, D), one correct answer, a brief explanation, and a topic tag.${topicRule} Remember: no question may depend on undefined or unspecified behaviour (such as a++ + ++a) — every correct answer must be guaranteed by the standard.` });
    }

    systemText += adaptiveGuidance;

    const toolDecl = {
      function_declarations: [{
        name: "return_mcqs",
        description: `Return ${aiCount} MCQs with options, correct answers, explanations and topic tags.`,
        parameters: {
          type: "OBJECT",
          properties: {
            questions: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  question: { type: "STRING" },
                  options: {
                    type: "OBJECT",
                    properties: {
                      A: { type: "STRING" },
                      B: { type: "STRING" },
                      C: { type: "STRING" },
                      D: { type: "STRING" },
                    },
                    required: ["A", "B", "C", "D"],
                  },
                  correct: { type: "STRING" },
                  explanation: { type: "STRING" },
                  topic: { type: "STRING" },
                },
                required: ["question", "options", "correct", "explanation", "topic"],
              },
            },
          },
          required: ["questions"],
        },
      }],
    };

    const result = await generateContentWithFailover({
      attemptTimeoutMs: 50_000,
      deadlineMs: 55_000,
      modelPath: "gemini-3.5-flash",
      geminiBody: {
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role: "user", parts }],
        tools: [toolDecl],
        tool_config: { function_calling_config: { mode: "ANY", allowed_function_names: ["return_mcqs"] } },
      },
      corsHeaders,
    });
    if (result instanceof Response) return result;

    const fc = result.data.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall);
    if (!fc) throw new Error("No function call in response");

    const aiQs = (fc.functionCall.args?.questions ?? []).map((q: any) => ({
      ...q,
      topic: q.topic || topic || "General",
      source: "ai" as const,
    }));

    // Grow the bank with the fresh subject/topic questions (never file ones).
    if (!fileData && sb && aiQs.length) {
      await saveToBank(sb, storedSubject ?? subject, aiQs, auth.userId, semester);
    }

    const questions = shuffle([...bankQs, ...aiQs]).slice(0, numQuestions);
    return json(
      { questions, bankCount: bankQs.length, aiCount: aiQs.length },
      { "x-ai-tier": result.tier, "x-ai-key-index": String(result.keyIndex) },
    );
  } catch (e) {
    console.error("generate-quiz error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
