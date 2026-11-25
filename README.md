# UniGenius AI — Smart University Study Assistant

**Master Your Logic.** One platform where a university student finds everything they need for all four years of their degree — notes, lectures, past papers, a question bank, AI tutoring, quizzes, flashcards and official degree schemes — instead of wandering across dozens of scattered sites, groups and drives.

🔗 **Live app:** https://unigenius.vercel.app

---

## The Problem

University students — especially at newer and under-resourced universities in Pakistan — study in chaos:

- Notes live in WhatsApp groups, past papers in random Drive folders, video lectures scattered across YouTube, and official scheme-of-studies documents are hard to find at all.
- There is no single place to practise exam-style questions, discover weak areas, or get a concept explained at 2 a.m. before a paper.
- Every semester, students repeat the same hunt from scratch, and material disappears when links expire or seniors graduate.

## The Solution

**UniGenius AI** brings the whole study workflow into one free, mobile-first web app:

- **AI Tutor & Chat** — ask anything and get structured, exam-ready explanations; the AI backend automatically routes across a pool of model providers (Gemini pool with per-key health tracking and failover, then gateway and Groq tiers) so the tutor stays up even when one provider is saturated.
- **AI Generators** — generate notes, summaries, quizzes, slides and documents from any topic or uploaded material, with PDF/Word export.
- **Quiz & Test System** — objective, subjective and mixed tests with automatic scoring, **weak-area feedback**, and full attempt history.
- **Question Bank** — 2,400+ hand-seeded MCQs across core computing subjects, searchable and filterable.
- **Flashcards** — generate decks from your own uploaded content, with due-for-review scheduling.
- **Lectures** — curated, verified YouTube playlists for core subjects, tagged by language (Urdu/Hindi vs English) and matched to your semester and subjects.
- **Notes & Past Papers** — community notes board with voting, plus past papers and study material organised by subject.
- **Code Lab** — in-browser code editor (Monaco) with AI code analysis and viva practice sessions.
- **My Subjects & Degree Schemes** — pick your university and programme: UniGenius ships scheme-of-studies data for **285 HEC-recognised universities** and dozens of verified degree schemes (HEC model curricula), and personalises your subjects, lectures and study plan around them.
- **Study Plans, Groups & Teacher Access** — weekly study plans, study groups, and a teacher module; admin panel with user/plan management.
- **PWA + Push Notifications** — installable app with study reminders.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS, shadcn/ui (Radix), Framer Motion |
| State / Data Fetching | TanStack React Query |
| Backend | Supabase — PostgreSQL (68 migrations), Auth (Google sign-in), Storage, Row-Level Security |
| Serverless | Supabase Edge Functions (Deno) — AI chat, quiz/flashcard/slide/document generation, answer grading, code execution & analysis, push notifications |
| AI | Google Gemini (multi-key pool with health-based failover routing), Groq and gateway fallbacks |
| Rich Content | Monaco Editor (Code Lab), KaTeX (LaTeX maths), jsPDF + docx export |
| Push | Firebase Cloud Messaging |
| Hosting | Vercel (frontend), Supabase Cloud (backend) |

## Running Locally

```bash
npm install
cp .env.example .env   # fill in your own Supabase project values
npm run dev
```

The database schema lives in `supabase/migrations/` and the AI/grading functions in `supabase/functions/` (they read their provider keys from server-side environment secrets — no keys are stored in this repository).

## Testing

The frontend ships with a Vitest + Testing Library suite — **198 tests across 21 files, all passing** — covering the pure logic the app depends on most: file text extraction (PDF/DOCX/PPTX/XLSX/RTF/HTML), quiz-question normalisation, adaptive-difficulty rules (level derivation, weak-topic extraction), the study-planner task builder (AI parsing + deterministic fallback), the text-to-speech voice resolver, note/past-paper file delivery, C++ linting, auth-header refresh, and storage helpers.

```bash
npm run test            # run the full suite once
npm run test:coverage   # same, with a v8 coverage report
npx tsc -p tsconfig.app.json --noEmit   # typecheck (must be clean)
```

Coverage is strongest exactly where correctness matters: the tested `src/lib` modules sit at ~92% branch coverage (statement coverage across the whole `src` tree is lower because most of it is presentational React, which is exercised by the typecheck, the production build, and live end-to-end verification of every user flow). Every fix in `CHANGES.md` names the verification that proved it — unit tests, API-level reproductions, or live click-throughs on the deployed build.

## Status

UniGenius is **live and in real use**: https://unigenius.vercel.app — sign in with Google and start studying. Free tier with an optional low-cost Premium plan.

## Built By

**Uzair Ahmad Tunio** — BS Software Engineering student, The University of Larkano, Sindh, Pakistan.
GitHub: https://github.com/uzairahmadtunio · Live: https://unigenius.vercel.app

*Submitted to AI Vibeathon 2026 (PromptWars × Echo Engineers, Hack2Skill).*
