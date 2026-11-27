import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Sparkles, BookMarked } from "lucide-react";
import { Button } from "@/components/ui/button";
import SplashScreen from "@/components/SplashScreen";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import FeedbackWidget from "@/components/FeedbackWidget";
import SemesterSelector from "@/components/SemesterSelector";
import SubjectGrid from "@/components/SubjectGrid";
import QuickActions from "@/components/QuickActions";
import DepartmentSelector from "@/components/DepartmentSelector";
import GlobalSearch from "@/components/GlobalSearch";
import AttendanceAlert from "@/components/AttendanceAlert";
import CareerReadinessWidget from "@/components/CareerReadinessWidget";
import NoticeBoard from "@/components/NoticeBoard";
import ExamCountdown from "@/components/ExamCountdown";
import VivaReminder from "@/components/VivaReminder";
import DailyStreakWidget from "@/components/DailyStreakWidget";
import QuizOfDayCard from "@/components/QuizOfDayCard";
import ContinueLearningCard from "@/components/ContinueLearningCard";
import BadgesRow from "@/components/BadgesRow";
import { useDepartment, departmentInfo } from "@/contexts/DepartmentContext";
import { useCurrentSemester } from "@/hooks/use-current-semester";
import { useAuth } from "@/contexts/AuthContext";
import { useViewMode } from "@/contexts/ViewModeContext";
import { lazyWithRetry } from "@/lib/lazy-retry";
import { Suspense } from "react";
import MyClassesSection from "@/components/home/MyClassesSection";
import Seo from "@/components/Seo";
import { HOME_FAQS } from "@/components/PublicLanding";

// Homepage structured data (Full SEO program): FAQPage mirrors the
// visible FAQ in the public landing sections; Organization + WebSite
// live statically in index.html.
const HOME_JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: HOME_FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "UniGenius AI",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    url: "https://unigenius.vercel.app/",
    description:
      "AI study assistant for CS, SE & AI university students: notes, topic pages, lectures, question bank, viva prep and a code lab.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "PKR" },
  },
];

// Lazy so the teacher panel stays out of the student entry bundle.
const TeacherHome = lazyWithRetry(() => import("@/pages/TeacherHome"));

const SPLASH_KEY = "unigenius-splash-shown";

const Index = () => {
  const [showSplash, setShowSplash] = useState(() => {
    return !sessionStorage.getItem(SPLASH_KEY);
  });
  // Profile-first shared semester (see hooks/use-current-semester.ts) —
  // the old localStorage-only state disagreed with My Subjects/Progress.
  const { semester, setSemester: handleSemesterChange } = useCurrentSemester();
  const { department } = useDepartment();
  const { user, loading: authLoading } = useAuth();
  const { mode } = useViewMode();
  const navigate = useNavigate();

  const handleSplashComplete = useCallback(() => {
    sessionStorage.setItem(SPLASH_KEY, "true");
    setShowSplash(false);
  }, []);

  // D-14: the marketing splash is for signed-out visitors. A returning
  // user with a valid session used to get stuck on it in every new tab
  // session — once auth resolves and a user exists, mark the splash
  // shown and go straight to the app. The DepartmentSelector gate
  // below is untouched (first-run onboarding stays exactly as is).
  useEffect(() => {
    if (!authLoading && user && showSplash) {
      sessionStorage.setItem(SPLASH_KEY, "true");
      setShowSplash(false);
    }
  }, [authLoading, user, showSplash]);

  if (showSplash) return (<><Seo path="/" jsonLd={HOME_JSON_LD} /><SplashScreen onComplete={handleSplashComplete} /></>);
  // Panels Program (Part A): in Teacher Mode the home IS the teacher
  // dashboard — the app behaves like a teacher's app end to end. This
  // sits before the department gate on purpose: a teacher's classes do
  // not depend on the student department onboarding.
  if (user && mode === "teacher") {
    return (
      <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" /></div>}>
        <TeacherHome />
      </Suspense>
    );
  }
  if (!department) return (<><Seo path="/" /><DepartmentSelector /></>);

  const deptInfo = departmentInfo[department];

  return (
    <div className="min-h-screen flex flex-col gradient-hero">
      <Seo path="/" jsonLd={HOME_JSON_LD} />
      <AttendanceAlert />
      <Navbar />

      <main className="flex-1 container mx-auto px-4 md:px-6 lg:px-10 py-6 md:py-8 space-y-6 pb-32 md:pb-8">
        {/* Hero */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="relative overflow-hidden text-center space-y-3">
          {/* Restrained violet aurora — decorative only, clipped to the
              hero so it adds no height or layout shift. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-28 left-1/2 -translate-x-1/2 h-64 w-[36rem] max-w-none rounded-full bg-primary/20 blur-3xl opacity-60" />
            <div className="absolute -top-12 left-[12%] h-40 w-40 rounded-full bg-violet-500/15 blur-3xl" />
            <div className="absolute -top-12 right-[12%] h-40 w-40 rounded-full bg-indigo-500/15 blur-3xl" />
          </div>
          <div className="relative inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            AI-Powered Study Assistant — {deptInfo.name}
          </div>
          <h1 className="relative font-display font-bold text-4xl md:text-5xl text-center text-foreground leading-tight">
            <span className="block">Learn Smarter.</span>
            <span className="block headline-text">Score Higher.</span>
            <span className="block">Grow Faster.</span>
          </h1>
          <p className="relative text-muted-foreground max-w-lg mx-auto text-sm">
            Your intelligent companion for {deptInfo.fullName} — from assignments to career prep.
          </p>
        </motion.section>

        {/* Streak + Career Readiness */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="grid lg:grid-cols-5 gap-4 md:gap-6">
          <div className="lg:col-span-3">
            <DailyStreakWidget />
          </div>
          <div className="lg:col-span-2">
            <CareerReadinessWidget />
          </div>
        </motion.section>

        {/* Global Search */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex justify-center">
          <GlobalSearch />
        </motion.section>

        {/* Viva Reminder */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <VivaReminder semester={semester} />
        </motion.section>

        {/* Quiz of the Day + Exam Countdown */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="grid md:grid-cols-2 gap-4 md:gap-6">
          <QuizOfDayCard />
          <ExamCountdown semester={semester} />
        </motion.section>

        {/* Due This Week strip (signed-in students). The classes list +
            join-by-code live on /classes via the Classes tile below —
            not on Home (Uzair, 26 Nov 2026). */}
        <MyClassesSection />

        {/* Notice Board */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <NoticeBoard />
        </motion.section>

        {/* Quick Actions */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <QuickActions />
        </motion.section>

        {/* Semester Selector */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
          <h2 className="font-display font-bold text-lg tracking-tight text-foreground">Select Semester</h2>
          <SemesterSelector selected={semester} onSelect={handleSemesterChange} />
        </motion.section>

        {/* Continue Learning */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <ContinueLearningCard />
        </motion.section>

        {/* Subject Grid */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display font-bold text-lg tracking-tight text-foreground">Semester {semester} Subjects</h2>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl gap-1.5 flex-shrink-0"
              onClick={() => navigate("/my-subjects")}
            >
              <BookMarked className="w-3.5 h-3.5" /> My Subjects
            </Button>
          </div>
          <SubjectGrid semester={semester} />
        </motion.section>

        {/* Badges */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <BadgesRow />
        </motion.section>

        {/* Feedback */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex justify-end">
          <FeedbackWidget />
        </motion.section>
      </main>

      <Footer />
    </div>
  );
};

export default Index;
