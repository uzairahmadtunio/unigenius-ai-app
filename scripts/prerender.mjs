#!/usr/bin/env node
/**
 * Build-time pre-rendering for public routes (SEO Round 2, 26 Nov 2026).
 *
 * The SPA ships one index.html whose raw HTML is a JS shell — crawlers
 * that do not execute JavaScript (Bing, DuckDuckGo, most AI crawlers)
 * saw an empty page. This script runs after `vite build` and writes a
 * real HTML file per public route into dist/<route>/index.html with:
 *   - the route's own title / meta description / canonical / og tags
 *   - the route's JSON-LD blocks
 *   - the route's real content as static, semantic HTML inside #root
 *
 * The app bundle is untouched: when a browser loads the page, React
 * mounts into #root and replaces the static content exactly as before,
 * so the signed-in experience is identical. Vercel serves the static
 * file when it exists and falls back to the SPA shell otherwise.
 *
 * FAIL-SOFT by design: any error (network, data, fs) logs a warning and
 * exits 0 without prerendering — a hiccup can never break a deploy,
 * the site simply keeps working as a pure SPA (same as Round 1).
 *
 * Data comes from the same public-read Supabase tables the app uses
 * (subject_topics, published topic_pages, subject_lectures, courses,
 * library_books, projects) plus src/data/blog-posts.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const SITE = "https://unigenius.vercel.app";

// ─── helpers (mirrors of src/lib/seo.ts — keep in sync) ──────────────
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const slugify = (text) =>
  (text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const stripMarkdown = (md) =>
  (md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const extractSummary = (bodyMd) => {
  const firstBlock = (bodyMd || "").trim().split(/\n\s*\n/)[0] || "";
  const plain = stripMarkdown(firstBlock);
  const m = plain.match(/^short summary:\s*(.+)$/i);
  return m ? m[1].trim() : plain;
};

const firstBlockText = (bodyMd) =>
  stripMarkdown((bodyMd || "").trim().split(/\n\s*\n/)[0] || "");

const extractHeadings = (bodyMd) => {
  const out = [];
  for (const line of (bodyMd || "").split("\n")) {
    const m = line.match(/^#{2,3}\s+(.+)$/);
    if (m) out.push(stripMarkdown(m[1]));
  }
  return out;
};

const metaDescription = (text, max = 158) => {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
};

function readEnv(name) {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(join(root, file), "utf8");
      const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* try next */ }
  }
  return null;
}

// ─── static page chrome ─────────────────────────────────────────────
const PRERENDER_CSS = `#ug-prerender{background:#07060f;color:#e9e7ff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.65;padding:24px 16px 48px}#ug-prerender main{max-width:920px;margin:0 auto}#ug-prerender h1{font-size:30px;line-height:1.25;margin:14px 0 10px}#ug-prerender h2{font-size:21px;margin:28px 0 8px}#ug-prerender h3{font-size:16px;margin:18px 0 6px}#ug-prerender p{color:#b9b7d9;margin:8px 0}#ug-prerender a{color:#a78bfa;text-decoration:none}#ug-prerender a:hover{text-decoration:underline}#ug-prerender ul{margin:8px 0;padding-left:20px;color:#b9b7d9}#ug-prerender li{margin:4px 0}#ug-prerender nav.top{max-width:920px;margin:0 auto;display:flex;gap:16px;flex-wrap:wrap;font-size:14px}#ug-prerender .crumbs{font-size:13px;color:#8f8cb8}#ug-prerender .cta{display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;padding:10px 20px;border-radius:12px;font-weight:700;margin:10px 8px 0 0}#ug-prerender footer{max-width:920px;margin:40px auto 0;font-size:13px;color:#8f8cb8;border-top:1px solid rgba(255,255,255,.12);padding-top:16px}`;

const chrome = (mainHtml) => `
<div id="ug-prerender"><style>${PRERENDER_CSS}</style>
<nav class="top"><a href="/"><strong>UniGenius AI</strong></a><a href="/topics">Topics</a><a href="/lectures">Lectures</a><a href="/courses">Courses</a><a href="/blog">Study Guides</a><a href="/about">About</a><a href="/contact">Contact</a></nav>
<main>
${mainHtml}
</main>
<footer>© 2026 UniGenius AI. All rights reserved. Designed &amp; Developed by Uzair Ahmad. · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/blog">Study Guides</a></footer>
</div>`;

// ─── head/body assembly ─────────────────────────────────────────────
function buildPage(template, { title, description, path, ogType = "website", jsonLd = [], bodyHtml }) {
  const url = path === "/" ? `${SITE}/` : `${SITE}${path}`;
  let html = template;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`);
  html = html.replace(/(<meta property="og:type" content=")[^"]*(")/, `$1${ogType}$2`);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);
  if (jsonLd.length) {
    const scripts = jsonLd
      .map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`)
      .join("\n    ");
    html = html.replace("</head>", `    ${scripts}\n  </head>`);
  }
  html = html.replace(/<div id="root">[\s\S]*?<\/div>\s*<\/body>/, `<div id="root">${bodyHtml}</div>\n  </body>`);
  return html;
}

const ld = {
  breadcrumb: (items) => ({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, url], i) => ({
      "@type": "ListItem", position: i + 1, name, item: url,
    })),
  }),
};

// ─── data fetch ─────────────────────────────────────────────────────
async function fetchAll(base, key, table, query) {
  const resp = await fetch(`${base}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`${table} fetch failed: HTTP ${resp.status}`);
  return resp.json();
}

async function main() {
  const templatePath = join(distDir, "index.html");
  if (!existsSync(templatePath)) {
    console.warn("[prerender] dist/index.html missing — skipping");
    return;
  }
  const template = readFileSync(templatePath, "utf8");
  if (!template.includes('id="ug-splash"')) {
    console.warn("[prerender] template has no splash marker — skipping (unexpected template)");
    return;
  }

  const url = readEnv("VITE_SUPABASE_URL");
  const key = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY") || readEnv("VITE_SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("Supabase URL/key not found in .env.local/.env");

  const [topicRows, pageRows, lectures, courses, books, projects] = await Promise.all([
    fetchAll(url, key, "subject_topics", "select=id,subject,semester,topic_no,title,slug&order=subject,topic_no"),
    fetchAll(url, key, "topic_pages", "select=topic_id,title,body_md,key_points,common_mistakes,code_examples&status=eq.published"),
    fetchAll(url, key, "subject_lectures", "select=subject,title,channel,language,video_count,semester&order=subject,sort_order"),
    fetchAll(url, key, "courses", "select=title,category,language,video_count&order=sort_order"),
    fetchAll(url, key, "library_books", "select=subject,title,author&order=title"),
    fetchAll(url, key, "projects", "select=title&order=title&limit=60"),
  ]);

  const pagesByTopic = new Map(pageRows.map((p) => [p.topic_id, p]));
  const subjects = new Map(); // slug -> { name, slug, topics: [] }
  for (const r of topicRows) {
    const sSlug = slugify(r.subject);
    if (!subjects.has(sSlug)) subjects.set(sSlug, { name: r.subject, slug: sSlug, topics: [] });
    subjects.get(sSlug).topics.push(r);
  }
  const subjectList = [...subjects.values()].sort((a, b) => a.name.localeCompare(b.name));

  let written = 0;
  const write = (routePath, pageOpts) => {
    const html = buildPage(template, pageOpts);
    if (routePath === "/") {
      writeFileSync(join(distDir, "index.html"), html);
    } else {
      const dir = join(distDir, routePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), html);
    }
    written++;
  };

  // ── Homepage ──────────────────────────────────────────────────────
  const HOME_FAQS = [
    ["What is UniGenius AI?", "UniGenius AI is a free AI-powered study platform for Computer Science, Software Engineering and Artificial Intelligence university students. It brings your notes, topic pages, video lectures, past papers, a question bank of 2,500+ practice questions, viva preparation and a code lab together in one place."],
    ["Is UniGenius AI free to use?", "Yes. You can sign up for free and use the core study tools — topic pages, lectures, notes, past papers and practice questions. An optional Pro plan (Rs 300/month, or a one-time Lifetime plan) unlocks higher AI limits and premium features."],
    ["Which subjects does UniGenius cover?", "UniGenius covers 54 subjects across the CS, SE and AI degree programs — including Object Oriented Programming, Data Structures, Digital Logic Design, Database Systems, Operating Systems, Computer Networks, Discrete Structures and more — with 615 structured topic pages."],
    ["How does the AI Tutor help me study?", "The AI Tutor explains topics in simple words with examples, then checks your understanding with a small question. It can also debug your code, generate practice quizzes matched to your semester and weak areas, and simulate viva questions so you walk into the exam hall prepared."],
    ["Can I practise exam questions on UniGenius?", "Yes. The question bank holds 2,500+ MCQs and practice questions organised by subject and topic, with instant answers and explanations. Practice Mode adapts the difficulty to your level and gives extra weight to your weak areas."],
    ["Does UniGenius have past papers and video lectures?", "Yes. You will find past papers, handwritten and typed notes, and 100+ curated video lecture playlists (in Urdu/Hindi and English) organised subject by subject, so you never have to hunt across ten different websites again."],
  ];
  const FEATURES = [
    ["AI Tutor", "Chat with an AI professor for your own subjects — simple explanations, examples and instant doubt clearing.", "/ai-tutor"],
    ["Topic Pages & Notes", "615 structured topic pages with key points, code examples and common mistakes, plus shared notes for every subject.", "/topics"],
    ["Video Lectures", "100+ curated lecture playlists in Urdu/Hindi and English, organised by subject and semester.", "/lectures"],
    ["Question Bank & Practice", "2,500+ MCQs and practice questions with explanations, adaptive difficulty and weak-area focus.", "/question-bank"],
    ["Viva & Exam Prep", "Practise viva questions out loud, generate quizzes from your own material and walk in confident.", "/viva-prep"],
    ["Code Lab", "Write and run code in 11+ languages, with AI analysis that lists your mistakes and shows the corrected code.", "/code-lab"],
    ["Past Papers", "Previous exam papers in one place, so you can see exactly what your university asks.", "/past-papers"],
    ["Study Planner & Classes", "A weekly study plan built for your semester, plus online classes where teachers share homework, tests and results.", "/classes"],
  ];
  const POPULAR = ["Object Oriented Programming", "Data Structures and Algorithms (DSA)", "Digital Logic Design", "Database Systems", "Operating Systems", "Computer Networks", "Programming Fundamentals", "Discrete Structures", "Artificial Intelligence", "Software Engineering", "Applied Calculus", "Pakistan Studies"];
  write("/", {
    title: "UniGenius AI: Master Your Logic",
    description: "UniGenius AI is the AI study assistant for CS, SE & AI university students: smart notes, topic pages, video lectures, a 2,500+ question bank, viva prep, a code lab and past papers — all in one place.",
    path: "/",
    jsonLd: [
      {
        "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: HOME_FAQS.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
      {
        "@context": "https://schema.org", "@type": "SoftwareApplication",
        name: "UniGenius AI", applicationCategory: "EducationalApplication", operatingSystem: "Web",
        url: `${SITE}/`,
        description: "AI study assistant for CS, SE & AI university students: notes, topic pages, lectures, question bank, viva prep and a code lab.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "PKR" },
      },
    ],
    bodyHtml: chrome(`
<h1>UniGenius AI: Master Your Logic</h1>
<p>UniGenius AI is the AI study assistant for CS, SE &amp; AI university students: smart notes, topic pages, video lectures, a 2,500+ question bank, viva prep, a code lab and past papers — all in one place.</p>
<a class="cta" href="/auth">Get Started Free</a>
<h2>The AI study assistant for CS, SE &amp; AI students</h2>
<p>UniGenius AI is built for university students of Computer Science, Software Engineering and Artificial Intelligence who are tired of hunting for notes, lectures and past papers across ten different websites. Everything for your degree — all four years, every semester — lives in one place: structured topic pages, an AI tutor that explains in simple words, video lectures, a question bank, viva practice and a code lab.</p>
<p>Whether you are preparing for midterms, a lab viva or final exams, UniGenius matches the material to your semester and subjects, adapts practice questions to your level, and shows you exactly which topics need more work.</p>
<h2>Everything you need, in one place</h2>
${FEATURES.map(([t, x, h]) => `<h3><a href="${h}">${esc(t)}</a></h3><p>${esc(x)}</p>`).join("\n")}
<h2>Notes &amp; topic pages for 54 subjects</h2>
<p>Every subject is broken into structured topic pages with a short summary, key points, code examples and the mistakes students commonly make. Start with a popular subject:</p>
<ul>${POPULAR.map((s) => `<li><a href="/topics/${slugify(s)}">${esc(s)}</a></li>`).join("")}</ul>
<p><a href="/topics">Browse all 615 topic pages</a></p>
<h2>How it works</h2>
<h3>1. Create your free account</h3><p>Sign up in seconds and pick your degree program and semester — your subjects appear automatically.</p>
<h3>2. Study your way</h3><p>Read topic pages, watch lectures, ask the AI Tutor, and practise questions matched to your level.</p>
<h3>3. Track and improve</h3><p>See your weak areas, keep your study streak alive, and walk into every exam prepared.</p>
<h2>Frequently asked questions</h2>
${HOME_FAQS.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("\n")}
<h2>Start learning smarter today</h2>
<p>Join UniGenius AI free — your notes, lectures, questions and AI tutor are waiting.</p>`),
  });

  // ── Section pages ─────────────────────────────────────────────────
  const section = (path, title, description, h1, inner, jsonLd = []) =>
    write(path, { title, description, path, jsonLd, bodyHtml: chrome(`<h1>${esc(h1)}</h1>\n${inner}`) });
  const paras = (arr) => arr.map((p) => `<p>${esc(p)}</p>`).join("\n");

  section("/about", "About UniGenius AI — The AI Study Platform for CS, SE & AI Students",
    "UniGenius AI is an AI-powered study platform built by Uzair Ahmad Tunio to help CS, SE & AI university students study smarter — notes, lectures, questions, viva prep and a code lab in one place.",
    "About UniGenius AI", `
<p>Empowering students through AI. UniGenius AI is an AI-powered study platform built for university students of Computer Science, Software Engineering and Artificial Intelligence. Instead of hunting for notes, lectures and past papers across dozens of websites and group chats, you will find everything for your degree in one place: structured topic pages for 54 subjects, a question bank of 2,527+ practice questions, curated video lectures in Urdu/Hindi and English, notes, past papers, an AI tutor and a full code lab — organised by your program and semester, and free to use.</p>
<h2>Our Mission</h2>
<p>To make quality academic help accessible to every student, not just those who can afford academies and private tuition. UniGenius uses modern AI to give every CS, SE and AI student clear explanations, structured notes and honest practice — matched to their own syllabus and semester — so that a student's results depend on their effort, not on their resources.</p>
<h2>Our Vision</h2>
<p>To become Pakistan's most trusted AI-powered student platform: the first place learners open when they sit down to study, and a companion that supports them from their first semester to their final-year project — in academics, in skills, and in the careers they build afterwards.</p>
<h2>Everything You Need, in One Place</h2>
<p>A degree has four years, eight semesters and dozens of subjects — but a student's study material is usually scattered everywhere. UniGenius brings it together:</p>
<p><strong>Topic pages.</strong> 615 structured topic pages across 54 subjects — every topic with a short summary, key points, examples and the mistakes students commonly make, matched to your semester's syllabus.</p>
<p><strong>Question bank.</strong> 2,527+ MCQs and practice questions with explanations, organised by subject and topic, so you can test yourself the way your examiner will — and see exactly which topics are still weak.</p>
<p><strong>Video lectures.</strong> 100+ curated lecture playlists in Urdu/Hindi and English for every subject. Watch the lecture, then read the matching topic page while it is still fresh.</p>
<p><strong>Notes &amp; past papers.</strong> A growing library of student notes and previous exam papers, so your revision is based on what your university actually asks, not on guesswork.</p>
<p><strong>Code Lab.</strong> Write, run and debug code right in the browser, with AI analysis that points out your mistakes, explains them, and shows you the corrected code.</p>
<p><strong>AI tutor, quizzes &amp; viva prep.</strong> Ask questions in simple words, generate quizzes from your own topics, and practise your lab viva with an AI examiner before facing the real one.</p>
<p><strong>Classes for teachers.</strong> Teachers can run a class with a simple join code, share materials, set assignments and tests, and see every student's results in one panel.</p>
<h2>Who UniGenius Is For</h2>
<p>UniGenius is made for students of BS Computer Science, BS Software Engineering and BS Artificial Intelligence — from first-semester beginners meeting programming for the first time to final-year students preparing their projects and interviews. When you sign up, you pick your degree program and semester, and the platform arranges your subjects, topics and practice around them, with quizzes that adapt to your level and extra weight on your weak areas. Almost everything is free, because the students who need help the most are usually the ones who can least afford to pay for it. An optional Pro plan simply raises the AI limits for heavy users.</p>
<h2>Meet the Founder</h2>
<h3>Uzair Ahmad</h3>
<p>Software Engineering Student, The University of Larkano. UniGenius AI was created by Uzair Ahmad Tunio, a BS Software Engineering student at The University of Larkano, after he lived the problem himself: lecture notes scattered across group chats, past papers that surfaced a night before the exam, and no single place where a student could simply sit down and study a topic properly. He built UniGenius as the platform he wished existed — starting with his own subjects and semester, then growing it to cover the full four years of CS, SE and AI degrees. Every feature here exists because a real student needed it: the viva simulator for the night before a lab exam, the code lab for practising without a powerful laptop, and the question bank for honest self-testing. "From a student, for students."</p>`);

  const lecturesBySubject = new Map();
  for (const l of lectures) {
    if (!lecturesBySubject.has(l.subject)) lecturesBySubject.set(l.subject, []);
    lecturesBySubject.get(l.subject).push(l);
  }
  section("/lectures", "Free Video Lectures for CS, SE & AI Students — UniGenius AI",
    "Watch 100+ curated video lecture playlists for every subject and semester — Programming, OOP, Data Structures, DLD, Databases and more, in Urdu/Hindi and English.",
    "Lectures", `
<p>The best YouTube lectures for every subject of every semester — search any topic and find the video right here. ${lectures.length} curated playlists in Urdu/Hindi and English, organised by subject.</p>
${[...lecturesBySubject.entries()].map(([s, ls]) => `<h2>${esc(s)}</h2><ul>${ls.map((l) => `<li>${esc(l.title)} — ${esc(l.channel || "")} · ${esc(l.language || "")} · ${l.video_count ?? ""} videos</li>`).join("")}</ul>`).join("\n")}`,
    [{
      "@context": "https://schema.org", "@type": "ItemList", name: "Video Lectures — UniGenius AI",
      itemListElement: lectures.slice(0, 50).map((l, i) => ({
        "@type": "ListItem", position: i + 1,
        item: { "@type": "Course", name: l.title, provider: { "@type": "Organization", name: "UniGenius AI" } },
      })),
    }]);

  section("/courses", "Free & Premium Courses for CS, SE & AI Students — UniGenius AI",
    "Complete video courses for Computer Science, Software Engineering and AI students — free, premium and AI-recommended courses with full playlists, in one place.",
    "Courses", `
${paras([
  "UniGenius brings complete video courses for Computer Science, Software Engineering and Artificial Intelligence students into one organised place. Instead of searching YouTube course by course and losing track of where you stopped, every course here is a full playlist with its videos in order, so you can start a subject and finish it properly. Courses are grouped into free courses you can watch right away, premium courses with deeper coverage, and AI-recommended courses matched to your subjects.",
  "Each course shows its language, category and video count before you begin, and your progress is remembered — leave halfway through a playlist and you can pick up exactly where you stopped. Whether you are learning programming fundamentals in your first semester, data structures and databases in the middle of your degree, or advanced AI topics near the end, there is a structured course path waiting for you.",
  "Not sure where to start? Pair a course with the matching topic pages and question bank inside UniGenius: watch the lectures, read the short summary and key points, then practise real questions on the same topic. That loop — watch, read, practise — is how toppers prepare, and it is built into every subject here.",
])}
<h2>All courses</h2>
<ul>${courses.map((c) => `<li>${esc(c.title)} — ${esc(c.category || "")} · ${esc(c.language || "")} · ${c.video_count ?? ""} videos</li>`).join("")}</ul>`);

  section("/premium", "UniGenius Pro — Plans for Students | UniGenius AI",
    "Go Pro on UniGenius AI: higher AI limits, premium courses and every feature unlocked. Pro is Rs 300/month, or get the one-time Lifetime plan and never pay again.",
    "Premium", paras([
      "UniGenius is free to use: topic pages, lectures, notes, past papers and a generous daily allowance of AI help are included for every student, because the platform exists to help students who cannot afford expensive coaching. Pro simply removes the limits — higher AI usage, premium courses and priority access to new features — for students who want more.",
      "Pro costs Rs 300 per month, deliberately priced below a single tuition class. If you know you will use UniGenius for your whole degree, the one-time Lifetime plan pays for itself in a year and never asks again. Every Pro subscription directly funds the servers and AI costs that keep the free version running for everyone else.",
    ]));

  section("/past-papers", "Past Papers for CS, SE & AI Exams — UniGenius AI",
    "Download past exam papers for Computer Science, Software Engineering and AI subjects — see exactly what your university asks and prepare with real papers.",
    "Past Papers", paras([
      "Past papers are the closest thing to the real exam you will ever get. Universities repeat question styles, favourite topics and marking patterns year after year, so working through previous papers shows you exactly what your teachers love to ask — and how much detail a full-marks answer needs. The UniGenius Past Paper Vault collects papers shared by students for CS, SE and AI subjects in one searchable place, organised by subject and paper type.",
      "Use them the smart way: finish a topic from the topic pages, then attempt its past-paper questions under timed conditions before checking any solution. The questions you miss become your revision list. If you have a paper your juniors would thank you for, sign in and upload it — the vault grows because students share.",
    ]));

  section("/contact", "Contact UniGenius AI — Support & Feedback",
    "Get in touch with the UniGenius AI team — questions, feedback, bug reports and suggestions for the AI study platform for CS, SE & AI students.",
    "Contact Us", paras([
      "UniGenius AI is built by a small student team, and feedback from students genuinely shapes what gets built next. Use this page for anything: a bug you spotted, a subject or topic page you want added, a lecture playlist you think belongs here, or an idea that would make studying easier for you. Questions about your account, Pro plans and payments are welcome too.",
      "We read every message. If your note is about a specific page or question, mentioning the subject and topic name helps us find it quickly and fix it faster.",
    ]));

  section("/question-bank", "Question Bank — 2,500+ MCQs & Practice Questions | UniGenius AI",
    "Practise 2,500+ teacher-curated MCQs and exam questions for CS, SE & AI subjects, organised by subject and topic with instant answers and explanations.",
    "Question Bank", paras([
      "The UniGenius question bank holds 2,500+ MCQs and practice questions curated by teachers for Computer Science, Software Engineering and AI subjects. Every question is organised by subject and topic, and comes with the correct answer and an explanation — so a wrong answer teaches you something instead of just costing you a mark. Filter by your semester to practise at exactly your level.",
      "Short on time before an exam? Pick one topic, attempt its questions honestly, then read the topic page for everything you missed and try again. Students who practise topic by topic — instead of rereading notes passively — consistently walk into the exam hall calmer and score higher.",
    ]));

  section("/notes", "Study Notes for CS, SE & AI Subjects — UniGenius AI",
    "Read and share study notes for Computer Science, Software Engineering and AI subjects — student-shared and curated notes for every semester, in one place.",
    "Notes", paras([
      "These notes are shared by students and curated for the subjects taught in CS, SE and AI degree programs — the same subjects you will find in the topic pages and question bank. Search by subject, open a note right here in the app, and use it alongside the matching topic page: the topic page gives you the structured summary and key points, the notes give you the classroom detail.",
      "You can also keep your own private notes here, so your handwritten scans, typed summaries and important PDFs live in one place instead of being lost in your phone gallery. Found a note genuinely helpful? Upvote it so other students find the best material first.",
    ]));

  section("/library", "Free Library — Open Books for CS, SE & AI Students | UniGenius AI",
    "Read free, openly-licensed textbooks and books for Computer Science, Software Engineering and AI subjects right inside UniGenius AI — no downloads needed.",
    "Library", `
<p>Free, openly-licensed books for your degree subjects, readable right inside UniGenius — no downloads needed.</p>
<ul>${books.map((b) => `<li>${esc(b.title)}${b.author ? ` — ${esc(b.author)}` : ""} (${esc(b.subject)})</li>`).join("")}</ul>`);

  section("/projects", "Semester & Final Year Project Ideas for CS, SE & AI Students | UniGenius AI",
    "Ready project ideas for every semester — from beginner mini-projects to final year projects — with full details, features and real examples.",
    "Projects", `
<p>Ready project ideas for every semester — from beginner mini-projects to final year projects — with full details, features and real examples.</p>
<ul>${projects.map((p) => `<li>${esc(p.title)}</li>`).join("")}</ul>`);

  section("/career", "Career Hub — Roadmaps, Skills & Interview Prep | UniGenius AI",
    "Career roadmaps, in-demand skills, DSA practice and interview preparation for CS, SE & AI students — plan your path from semester one to your first job.",
    "Career Hub", `<p>Career roadmaps, in-demand skills, DSA practice and interview preparation for CS, SE &amp; AI students — plan your path from semester one to your first job.</p>`);

  console.log(`[prerender] core routes done (${written}) — topics + blog next`);
  return { template, write, subjects, subjectList, pagesByTopic, written: () => written };
}

main()
  .then((ctx) => (ctx ? secondPhase(ctx) : undefined))
  .catch((e) => {
    console.warn(`[prerender] FAILED (fail-soft, SPA unaffected): ${e.message || e}`);
  });

// ─── topics + blog ──────────────────────────────────────────────────
function secondPhase({ write, subjectList, pagesByTopic, written }) {
  // /topics index
  write("/topics", {
    title: "Study Topics & Notes for 54 Subjects — UniGenius AI",
    description: "Browse 615 free topic pages and study notes for CS, SE & AI subjects: OOP, Data Structures, DLD, Databases, Operating Systems and more — with key points and code examples.",
    path: "/topics",
    jsonLd: [{
      "@context": "https://schema.org", "@type": "ItemList", name: "Study Topics — UniGenius AI",
      itemListElement: subjectList.map((s, i) => ({
        "@type": "ListItem", position: i + 1, name: s.name, url: `${SITE}/topics/${s.slug}`,
      })),
    }],
    bodyHtml: chrome(`
<h1>Study Topics &amp; Notes</h1>
<p>Browse 615 free topic pages and study notes for CS, SE &amp; AI subjects — each with a short summary, key points, code examples and common mistakes. Pick a subject:</p>
<ul>${subjectList.map((s) => {
      const sems = [...new Set(s.topics.map((t) => t.semester).filter((x) => x != null))].sort((a, b) => a - b);
      return `<li><a href="/topics/${s.slug}">${esc(s.name)}</a> — ${s.topics.length} topics${sems.length ? ` · Semester ${sems.join(", ")}` : ""}</li>`;
    }).join("")}</ul>`),
  });

  // Subject + topic pages
  for (const s of subjectList) {
    const sPath = `/topics/${s.slug}`;
    write(sPath, {
      title: `${s.name} Notes & Topics — UniGenius AI`,
      description: metaDescription(`Study ${s.name} topic by topic: ${s.topics.length} structured topic pages with short summaries, key points, code examples and common mistakes — free previews on UniGenius AI.`),
      path: sPath,
      jsonLd: [
        ld.breadcrumb([["Home", `${SITE}/`], ["Topics", `${SITE}/topics`], [s.name, `${SITE}${sPath}`]]),
        {
          "@context": "https://schema.org", "@type": "ItemList", name: `${s.name} topics`,
          itemListElement: s.topics.map((t, i) => ({
            "@type": "ListItem", position: i + 1, name: t.title, url: `${SITE}${sPath}/${t.slug}`,
          })),
        },
      ],
      bodyHtml: chrome(`
<p class="crumbs"><a href="/">Home</a> / <a href="/topics">Topics</a> / ${esc(s.name)}</p>
<h1>${esc(s.name)} Notes &amp; Topics</h1>
<p>Study ${esc(s.name)} topic by topic: ${s.topics.length} structured topic pages with short summaries, key points, code examples and common mistakes.</p>
<ul>${s.topics.map((t) => `<li><a href="${sPath}/${t.slug}">${esc(t.title)}</a></li>`).join("")}</ul>`),
    });

    s.topics.forEach((t, idx) => {
      const page = pagesByTopic.get(t.id);
      if (!page) return; // unpublished topic page — client shows its own state
      const tPath = `${sPath}/${t.slug}`;
      const summary = extractSummary(page.body_md);
      const headings = extractHeadings(page.body_md);
      const keyPoints = Array.isArray(page.key_points) ? page.key_points : [];
      const mistakes = Array.isArray(page.common_mistakes) ? page.common_mistakes : [];
      const codeCount = Array.isArray(page.code_examples) ? page.code_examples.length : 0;
      const prev = idx > 0 ? s.topics[idx - 1] : null;
      const next = idx < s.topics.length - 1 ? s.topics[idx + 1] : null;
      write(tPath, {
        title: `${page.title} — ${s.name} Notes | UniGenius AI`,
        description: metaDescription(`${page.title} — ${s.name} study notes: ${keyPoints[0] || summary}`),
        path: tPath,
        ogType: "article",
        jsonLd: [
          ld.breadcrumb([["Home", `${SITE}/`], ["Topics", `${SITE}/topics`], [s.name, `${SITE}${sPath}`], [page.title, `${SITE}${tPath}`]]),
          {
            "@context": "https://schema.org", "@type": "LearningResource",
            name: page.title,
            description: metaDescription(`${page.title} — ${s.name} study notes: ${keyPoints[0] || summary}`),
            url: `${SITE}${tPath}`,
            learningResourceType: "Study notes", educationalLevel: "University",
            about: { "@type": "Thing", name: s.name },
            isPartOf: { "@type": "WebSite", name: "UniGenius AI", url: `${SITE}/` },
            inLanguage: ["en", "ur"],
          },
        ],
        bodyHtml: chrome(`
<p class="crumbs"><a href="/">Home</a> / <a href="/topics">Topics</a> / <a href="${sPath}">${esc(s.name)}</a> / ${esc(page.title)}</p>
<p>${esc(s.name)} · Topic ${t.topic_no}</p>
<h1>${esc(page.title)}</h1>
<h2>Short summary</h2>
<p>${esc(firstBlockText(page.body_md))}</p>
${keyPoints.length ? `<h2>Key points</h2><ul>${keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}
<h2>Inside the full topic page</h2>
${headings.length ? `<ul>${headings.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
<p>${codeCount ? `${codeCount} code examples · ` : ""}${mistakes.length ? `${mistakes.length} common mistakes covered · ` : ""}Practice questions in the app.</p>
<p>This is a free preview. The complete topic page — full explanation, code examples and practice questions — is free with a UniGenius account.</p>
<a class="cta" href="/auth">Read the full page — free</a>
<a class="cta" href="/question-bank">Practise questions</a>
<p>${prev ? `<a href="${sPath}/${prev.slug}">← Previous: ${esc(prev.title)}</a> ` : ""}${next ? `<a href="${sPath}/${next.slug}">Next: ${esc(next.title)} →</a>` : ""}</p>`),
      });
    });
  }

  // Blog (study guides)
  const blog = JSON.parse(readFileSync(join(root, "src", "data", "blog-posts.json"), "utf8"));
  const posts = blog.articles || [];
  write("/blog", {
    title: "Study Guides & Exam Tips for CS, SE & AI Students | UniGenius AI",
    description: "Free study guides for university students: final exam plans, OOP, DLD, calculus and DSA guides, viva preparation and past-paper strategy from UniGenius AI.",
    path: "/blog",
    jsonLd: [{
      "@context": "https://schema.org", "@type": "ItemList", name: "UniGenius Study Guides",
      description: "Study guides and exam preparation articles for CS, SE and AI university students.",
      itemListElement: posts.map((p, i) => ({
        "@type": "ListItem", position: i + 1, name: p.title, url: `${SITE}/blog/${p.slug}`,
      })),
    }],
    bodyHtml: chrome(`
<h1>Study guides &amp; exam tips</h1>
<p>Practical guides written for Computer Science, Software Engineering and Artificial Intelligence students: how to plan your final-exam revision, how to study the hard subjects topic by topic, and how to walk into vivas and exams prepared. Every guide links into the matching topic pages, lectures and practice questions inside UniGenius.</p>
${posts.map((p) => `<h2><a href="/blog/${p.slug}">${esc(p.title)}</a></h2><p>${esc(p.description)}</p><p>${esc(p.tags.join(" · "))} · ${p.readingMinutes} min read</p>`).join("\n")}`),
  });

  posts.forEach((p, idx) => {
    const pPath = `/blog/${p.slug}`;
    const prev = idx > 0 ? posts[idx - 1] : null;
    const next = idx < posts.length - 1 ? posts[idx + 1] : null;
    write(pPath, {
      title: `${p.title} | UniGenius AI`,
      description: p.description,
      path: pPath,
      ogType: "article",
      jsonLd: [
        {
          "@context": "https://schema.org", "@type": "Article",
          headline: p.title, description: p.description, url: `${SITE}${pPath}`,
          datePublished: p.datePublished, dateModified: p.datePublished,
          author: { "@type": "Person", name: "Uzair Ahmad Tunio" },
          publisher: { "@id": `${SITE}/#organization` },
          image: `${SITE}/og-image.png`, inLanguage: "en",
          about: p.tags.map((t) => ({ "@type": "Thing", name: t })),
        },
        ld.breadcrumb([["Home", `${SITE}/`], ["Study Guides", `${SITE}/blog`], [p.title, `${SITE}${pPath}`]]),
      ],
      bodyHtml: chrome(`
<p class="crumbs"><a href="/">Home</a> / <a href="/blog">Study Guides</a> / ${esc(p.title)}</p>
<p>${esc(p.tags.join(" · "))} · ${p.readingMinutes} min read · ${esc(p.datePublished)}</p>
<h1>${esc(p.title)}</h1>
<p>${esc(p.intro)}</p>
${p.sections.map((s) => `<h2>${esc(s.heading)}</h2>${s.paragraphs.map((x) => `<p>${esc(x)}</p>`).join("")}${s.list ? `<ul>${s.list.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}`).join("\n")}
<h2>Keep studying</h2>
<p>${p.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(" · ")}</p>
<p>${prev ? `<a href="/blog/${prev.slug}">← Previous guide: ${esc(prev.title)}</a> ` : ""}${next ? `<a href="/blog/${next.slug}">Next guide: ${esc(next.title)} →</a>` : ""}</p>`),
    });
  });

  console.log(`[prerender] DONE — ${written()} routes prerendered`);
}
