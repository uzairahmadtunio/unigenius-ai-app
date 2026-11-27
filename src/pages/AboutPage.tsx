import { motion } from "framer-motion";
import { Sparkles, Target, Eye, Trophy, Linkedin, Github, Heart, Globe, BookOpen, Users } from "lucide-react";
import PageShell from "@/components/PageShell";
import { Card } from "@/components/ui/card";

const FOUNDER_AVATAR_URL =
  `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/avatars/d75e89ba-2aec-4ff7-a137-47c7c4777617/founder-avatar-violet.png`;

const highlights = [
  "AI Study Chat",
  "Quiz Generator",
  "Viva Simulation",
  "Code Lab",
  "Smart GPA Calculator",
  "Attendance Tracker",
  "Teacher Panel",
  "Study Planner",
  "Career Hub",
];

const offerings = [
  {
    title: "Topic pages",
    text: "615 structured topic pages across 54 subjects — every topic with a short summary, key points, examples and the mistakes students commonly make, matched to your semester's syllabus.",
  },
  {
    title: "Question bank",
    text: "2,527+ MCQs and practice questions with explanations, organised by subject and topic, so you can test yourself the way your examiner will — and see exactly which topics are still weak.",
  },
  {
    title: "Video lectures",
    text: "100+ curated lecture playlists in Urdu/Hindi and English for every subject. Watch the lecture, then read the matching topic page while it is still fresh.",
  },
  {
    title: "Notes & past papers",
    text: "A growing library of student notes and previous exam papers, so your revision is based on what your university actually asks, not on guesswork.",
  },
  {
    title: "Code Lab",
    text: "Write, run and debug code right in the browser, with AI analysis that points out your mistakes, explains them, and shows you the corrected code.",
  },
  {
    title: "AI tutor, quizzes & viva prep",
    text: "Ask questions in simple words, generate quizzes from your own topics, and practise your lab viva with an AI examiner before facing the real one.",
  },
  {
    title: "Classes for teachers",
    text: "Teachers can run a class with a simple join code, share materials, set assignments and tests, and see every student's results in one panel.",
  },
];

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { delay, duration: 0.5 },
});

const AboutPage = () => {
  return (
    <PageShell title="About UniGenius AI" seoTitle="About UniGenius AI — The AI Study Platform for CS, SE & AI Students" seoDescription="UniGenius AI is an AI-powered study platform built by Uzair Ahmad Tunio to help CS, SE & AI university students study smarter — notes, lectures, questions, viva prep and a code lab in one place." seoPath="/about" subtitle="Empowering students through AI" icon={<Sparkles className="w-5 h-5 text-primary" />}>
      <div className="space-y-8 max-w-5xl mx-auto">
        {/* Hero */}
        <motion.section {...fade(0)} className="glass rounded-2xl p-8 md:p-12 text-center border border-primary/20">
          <h2 className="font-display text-3xl md:text-5xl font-bold mb-4">
            Empowering Students Through <span className="gradient-text">AI</span>
          </h2>
          <p className="text-sm md:text-base text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            UniGenius AI is an AI-powered study platform built for university students of Computer Science,
            Software Engineering and Artificial Intelligence. Instead of hunting for notes, lectures and past
            papers across dozens of websites and group chats, you will find everything for your degree in one
            place: structured topic pages for 54 subjects, a question bank of 2,527+ practice questions, curated
            video lectures in Urdu/Hindi and English, notes, past papers, an AI tutor and a full code lab —
            organised by your program and semester, and free to use.
          </p>
        </motion.section>

        {/* Mission & Vision */}
        <div className="grid md:grid-cols-2 gap-4">
          <motion.div {...fade(0.1)}>
            <Card className="glass p-6 h-full border-primary/10">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-5 h-5 text-primary" />
                <h2 className="font-display text-xl font-bold">Our Mission</h2>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                To make quality academic help accessible to every student, not just those who can afford academies
                and private tuition. UniGenius uses modern AI to give every CS, SE and AI student clear explanations,
                structured notes and honest practice — matched to their own syllabus and semester — so that a
                student's results depend on their effort, not on their resources.
              </p>
            </Card>
          </motion.div>
          <motion.div {...fade(0.15)}>
            <Card className="glass p-6 h-full border-primary/10">
              <div className="flex items-center gap-2 mb-3">
                <Eye className="w-5 h-5 text-primary" />
                <h2 className="font-display text-xl font-bold">Our Vision</h2>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                To become Pakistan's most trusted AI-powered student platform: the first place learners open when
                they sit down to study, and a companion that supports them from their first semester to their
                final-year project — in academics, in skills, and in the careers they build afterwards.
              </p>
            </Card>
          </motion.div>
        </div>

        {/* What You Will Find */}
        <motion.section {...fade(0.18)}>
          <Card className="glass p-6 md:p-8 border-primary/10">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-5 h-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Everything You Need, in One Place</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5">
              A degree has four years, eight semesters and dozens of subjects — but a student's study material is
              usually scattered everywhere. UniGenius brings it together:
            </p>
            <div className="space-y-4">
              {offerings.map((o) => (
                <div key={o.title} className="flex gap-3">
                  <span className="mt-[7px] h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    <span className="font-semibold text-foreground">{o.title}.</span> {o.text}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        </motion.section>

        {/* Who It Is For */}
        <motion.section {...fade(0.22)}>
          <Card className="glass p-6 md:p-8 border-primary/10">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-5 h-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Who UniGenius Is For</h2>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              UniGenius is made for students of BS Computer Science, BS Software Engineering and BS Artificial
              Intelligence — from first-semester beginners meeting programming for the first time to final-year
              students preparing their projects and interviews. When you sign up, you pick your degree program and
              semester, and the platform arranges your subjects, topics and practice around them, with quizzes that
              adapt to your level and extra weight on your weak areas. Almost everything is free, because the
              students who need help the most are usually the ones who can least afford to pay for it. An optional
              Pro plan simply raises the AI limits for heavy users.
            </p>
          </Card>
        </motion.section>

        {/* Founder */}
        <motion.section {...fade(0.2)}>
          <Card className="glass p-6 md:p-10 border-primary/20">
            <h2 className="font-display text-2xl font-bold text-center mb-8">Meet the Founder</h2>
            <div className="flex flex-col md:flex-row items-center gap-8">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 rounded-full gradient-primary blur-2xl opacity-40" />
                <div className="relative w-40 h-40 md:w-48 md:h-48 rounded-full p-[3px] gradient-primary shadow-[0_0_30px_hsl(var(--primary)/0.4)]">
                  <img
                    src={FOUNDER_AVATAR_URL}
                    alt="Uzair Ahmad — Founder of UniGenius AI"
                    className="w-full h-full rounded-full object-cover"
                  />
                </div>
              </div>
              <div className="flex-1 text-center md:text-left">
                <h3 className="font-display text-2xl font-bold">Uzair Ahmad</h3>
                <p className="text-sm text-primary font-medium mt-1">Software Engineering Student</p>
                <p className="text-xs text-muted-foreground">The University of Larkano</p>
                <p className="text-sm text-muted-foreground mt-4 leading-relaxed">
                  UniGenius AI was created by Uzair Ahmad Tunio, a BS Software Engineering student at The University
                  of Larkano, after he lived the problem himself: lecture notes scattered across group chats, past
                  papers that surfaced a night before the exam, and no single place where a student could simply sit
                  down and study a topic properly. He built UniGenius as the platform he wished existed — starting
                  with his own subjects and semester, then growing it to cover the full four years of CS, SE and AI
                  degrees. Every feature here exists because a real student needed it: the viva simulator for the
                  night before a lab exam, the code lab for practising without a powerful laptop, and the question
                  bank for honest self-testing.
                </p>
                <p className="mt-4 font-display italic text-base gradient-text">"From a student, for students."</p>
                <div className="flex items-center justify-center md:justify-start gap-3 mt-5">
                  <a
                    href="https://www.linkedin.com/in/uzair-ahmad-tunio/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 text-xs hover:bg-primary/10 transition-colors"
                  >
                    <Linkedin className="w-3.5 h-3.5" /> LinkedIn
                  </a>
                  <a
                    href="https://github.com/uzairahmadtunio"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 text-xs hover:bg-primary/10 transition-colors"
                  >
                    <Github className="w-3.5 h-3.5" /> GitHub
                  </a>
                  <a
                    href="https://uzairahmadtunio.netlify.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 text-xs hover:bg-primary/10 transition-colors bg-primary/5"
                  >
                    <Globe className="w-3.5 h-3.5" /> Portfolio
                  </a>
                </div>
              </div>
            </div>
          </Card>
        </motion.section>

        {/* Achievements */}
        <motion.section {...fade(0.25)}>
          <Card className="glass p-6 md:p-8 border-primary/10">
            <div className="flex items-center gap-2 mb-5 justify-center">
              <Trophy className="w-5 h-5 text-primary" />
              <h2 className="font-display text-xl font-bold">Platform Highlights</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {highlights.map((h, i) => (
                <motion.div
                  key={h}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.05 * i }}
                  className="px-4 py-3 rounded-xl bg-primary/5 border border-primary/15 text-sm font-medium text-center hover:bg-primary/10 transition-colors"
                >
                  {h}
                </motion.div>
              ))}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.05 * highlights.length }}
                className="px-4 py-3 rounded-xl border border-dashed border-primary/25 text-sm font-medium text-center text-muted-foreground"
              >
                …and more
              </motion.div>
            </div>
          </Card>
        </motion.section>

        <motion.p {...fade(0.3)} className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          Built with <Heart className="w-3 h-3 text-primary" /> for students by Uzair Ahmad
        </motion.p>
      </div>
    </PageShell>
  );
};

export default AboutPage;
