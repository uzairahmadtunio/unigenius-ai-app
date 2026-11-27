import { Link } from "react-router-dom";
import {
  Bot, BookOpen, Video, HelpCircle, Mic, Code2, FileText, CalendarCheck,
  ArrowRight, CheckCircle2,
} from "lucide-react";
import { slugify } from "@/lib/seo";

/**
 * Public landing content (Full SEO program, 26 Nov 2026).
 *
 * Rendered under the welcome hero inside the splash screen, so a
 * first-time visitor — and a search crawler — gets real, crawlable
 * content about the product instead of a bare welcome gate: what
 * UniGenius is, its features, the subjects it covers, how it works
 * and an FAQ (mirrored as FAQPage JSON-LD from Index). The hero and
 * the signed-in app are untouched.
 */

export const HOME_FAQS: { q: string; a: string }[] = [
  {
    q: "What is UniGenius AI?",
    a: "UniGenius AI is a free AI-powered study platform for Computer Science, Software Engineering and Artificial Intelligence university students. It brings your notes, topic pages, video lectures, past papers, a question bank of 2,500+ practice questions, viva preparation and a code lab together in one place.",
  },
  {
    q: "Is UniGenius AI free to use?",
    a: "Yes. You can sign up for free and use the core study tools — topic pages, lectures, notes, past papers and practice questions. An optional Pro plan (Rs 300/month, or a one-time Lifetime plan) unlocks higher AI limits and premium features.",
  },
  {
    q: "Which subjects does UniGenius cover?",
    a: "UniGenius covers 54 subjects across the CS, SE and AI degree programs — including Object Oriented Programming, Data Structures, Digital Logic Design, Database Systems, Operating Systems, Computer Networks, Discrete Structures and more — with 615 structured topic pages.",
  },
  {
    q: "How does the AI Tutor help me study?",
    a: "The AI Tutor explains topics in simple words with examples, then checks your understanding with a small question. It can also debug your code, generate practice quizzes matched to your semester and weak areas, and simulate viva questions so you walk into the exam hall prepared.",
  },
  {
    q: "Can I practise exam questions on UniGenius?",
    a: "Yes. The question bank holds 2,500+ MCQs and practice questions organised by subject and topic, with instant answers and explanations. Practice Mode adapts the difficulty to your level and gives extra weight to your weak areas.",
  },
  {
    q: "Does UniGenius have past papers and video lectures?",
    a: "Yes. You will find past papers, handwritten and typed notes, and 100+ curated video lecture playlists (in Urdu/Hindi and English) organised subject by subject, so you never have to hunt across ten different websites again.",
  },
];

const FEATURES = [
  { icon: Bot, title: "AI Tutor", text: "Chat with an AI professor for your own subjects — simple explanations, examples and instant doubt clearing.", href: "/ai-tutor" },
  { icon: BookOpen, title: "Topic Pages & Notes", text: "615 structured topic pages with key points, code examples and common mistakes, plus shared notes for every subject.", href: "/topics" },
  { icon: Video, title: "Video Lectures", text: "100+ curated lecture playlists in Urdu/Hindi and English, organised by subject and semester.", href: "/lectures" },
  { icon: HelpCircle, title: "Question Bank & Practice", text: "2,500+ MCQs and practice questions with explanations, adaptive difficulty and weak-area focus.", href: "/question-bank" },
  { icon: Mic, title: "Viva & Exam Prep", text: "Practise viva questions out loud, generate quizzes from your own material and walk in confident.", href: "/viva-prep" },
  { icon: Code2, title: "Code Lab", text: "Write and run code in 11+ languages, with AI analysis that lists your mistakes and shows the corrected code.", href: "/code-lab" },
  { icon: FileText, title: "Past Papers", text: "Previous exam papers in one place, so you can see exactly what your university asks.", href: "/past-papers" },
  { icon: CalendarCheck, title: "Study Planner & Classes", text: "A weekly study plan built for your semester, plus online classes where teachers share homework, tests and results.", href: "/classes" },
];

const POPULAR_SUBJECTS = [
  "Object Oriented Programming",
  "Data Structures and Algorithms (DSA)",
  "Digital Logic Design",
  "Database Systems",
  "Operating Systems",
  "Computer Networks",
  "Programming Fundamentals",
  "Discrete Structures",
  "Artificial Intelligence",
  "Software Engineering",
  "Applied Calculus",
  "Pakistan Studies",
];

interface PublicLandingProps {
  onGetStarted: () => void;
  onSignIn: () => void;
  onNavigate: (path: string) => void;
}

const PublicLanding = ({ onGetStarted, onSignIn, onNavigate }: PublicLandingProps) => (
  <div className="relative w-full bg-[#07060F] text-white">
    <div className="mx-auto max-w-5xl px-5 pb-20 pt-4 md:px-8">
      {/* What is UniGenius */}
      <section className="py-10">
        <h2 className="font-display text-2xl font-bold md:text-3xl">
          The AI study assistant for <span className="headline-text">CS, SE &amp; AI students</span>
        </h2>
        <p className="mt-4 max-w-3xl leading-relaxed text-white/70">
          UniGenius AI is built for university students of Computer Science, Software Engineering and
          Artificial Intelligence who are tired of hunting for notes, lectures and past papers across
          ten different websites. Everything for your degree — all four years, every semester — lives
          in one place: structured topic pages, an AI tutor that explains in simple words, video
          lectures, a question bank, viva practice and a code lab.
        </p>
        <p className="mt-3 max-w-3xl leading-relaxed text-white/70">
          Whether you are preparing for midterms, a lab viva or final exams, UniGenius matches the
          material to your semester and subjects, adapts practice questions to your level, and shows
          you exactly which topics need more work.
        </p>
      </section>

      {/* Features */}
      <section className="py-10">
        <h2 className="font-display text-2xl font-bold md:text-3xl">Everything you need, in one place</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <button
              key={f.title}
              type="button"
              onClick={() => onNavigate(f.href)}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-violet-400/40 hover:bg-white/[0.05]"
            >
              <f.icon className="h-6 w-6 text-violet-300" />
              <h3 className="mt-3 font-display text-base font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/60">{f.text}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-violet-300">
                Explore <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Subjects */}
      <section className="py-10">
        <h2 className="font-display text-2xl font-bold md:text-3xl">Notes &amp; topic pages for 54 subjects</h2>
        <p className="mt-3 max-w-3xl leading-relaxed text-white/70">
          Every subject is broken into structured topic pages with a short summary, key points, code
          examples and the mistakes students commonly make. Start with a popular subject:
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {POPULAR_SUBJECTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onNavigate(`/topics/${slugify(s)}`)}
              className="rounded-full border border-white/12 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-white/80 transition hover:border-violet-400/40 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onNavigate("/topics")}
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-300 hover:text-violet-200"
        >
          Browse all 615 topic pages <ArrowRight className="h-4 w-4" />
        </button>
      </section>

      {/* How it works */}
      <section className="py-10">
        <h2 className="font-display text-2xl font-bold md:text-3xl">How it works</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { step: "1", title: "Create your free account", text: "Sign up in seconds and pick your degree program and semester — your subjects appear automatically." },
            { step: "2", title: "Study your way", text: "Read topic pages, watch lectures, ask the AI Tutor, and practise questions matched to your level." },
            { step: "3", title: "Track and improve", text: "See your weak areas, keep your study streak alive, and walk into every exam prepared." },
          ].map((s) => (
            <div key={s.step} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <span className="font-display text-3xl font-black text-violet-400/70">{s.step}</span>
              <h3 className="mt-2 font-display text-base font-bold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/60">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="py-10">
        <h2 className="font-display text-2xl font-bold md:text-3xl">Frequently asked questions</h2>
        <div className="mt-6 space-y-3">
          {HOME_FAQS.map((f) => (
            <div key={f.q} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <h3 className="flex items-start gap-2 font-display text-base font-bold">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" /> {f.q}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-white/65">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-10 text-center">
        <h2 className="font-display text-2xl font-bold md:text-3xl">Start learning smarter today</h2>
        <p className="mx-auto mt-3 max-w-xl text-white/65">
          Join UniGenius AI free — your notes, lectures, questions and AI tutor are waiting.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onGetStarted}
            className="gradient-button rounded-2xl px-8 py-3 font-display text-sm font-bold text-white"
          >
            Get Started Free →
          </button>
          <button
            type="button"
            onClick={onSignIn}
            className="rounded-2xl border border-white/15 px-8 py-3 font-display text-sm font-bold text-white/85 transition hover:bg-white/5"
          >
            Sign in
          </button>
        </div>
        <nav className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/45">
          <Link to="/about" className="hover:text-white/80">About</Link>
          <Link to="/lectures" className="hover:text-white/80">Lectures</Link>
          <Link to="/courses" className="hover:text-white/80">Courses</Link>
          <Link to="/blog" className="hover:text-white/80">Study Guides</Link>
          <Link to="/contact" className="hover:text-white/80">Contact</Link>
          <Link to="/privacy" className="hover:text-white/80">Privacy</Link>
          <Link to="/terms" className="hover:text-white/80">Terms</Link>
        </nav>
        <p className="mt-6 text-[11px] uppercase tracking-widest text-white/30">
          Designed &amp; Founded by Uzair Ahmad
        </p>
      </section>
    </div>
  </div>
);

export default PublicLanding;
