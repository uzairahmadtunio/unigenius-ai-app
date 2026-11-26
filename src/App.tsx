import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import { DepartmentProvider } from "@/contexts/DepartmentContext";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazy-retry";

// Route-level code splitting: every page below loads as its own chunk on
// first visit instead of shipping the whole app in one 3 MB bundle.
const ChatPage = lazyWithRetry(() => import("./pages/ChatPage"));
const AuthPage = lazyWithRetry(() => import("./pages/AuthPage"));
const ForgotPasswordPage = lazyWithRetry(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazyWithRetry(() => import("./pages/ResetPasswordPage"));
const PracticePage = lazyWithRetry(() => import("./pages/PracticePage"));
const CodeLabPage = lazyWithRetry(() => import("./pages/CodeLabPage"));
const DocsGenPage = lazyWithRetry(() => import("./pages/DocsGenPage"));
const ExamPrepPage = lazyWithRetry(() => import("./pages/ExamPrepPage"));
const VivaPage = lazyWithRetry(() => import("./pages/VivaPage"));
const PastPapersPage = lazyWithRetry(() => import("./pages/PastPapersPage"));
const FlashcardsPage = lazyWithRetry(() => import("./pages/FlashcardsPage"));
const CareerPage = lazyWithRetry(() => import("./pages/CareerPage"));
const SubjectHubPage = lazyWithRetry(() => import("./pages/SubjectHubPage"));
const TopicPage = lazyWithRetry(() => import("./pages/TopicPage"));
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"));
const MySubjectsPage = lazyWithRetry(() => import("./pages/MySubjectsPage"));
const AttendancePage = lazyWithRetry(() => import("./pages/AttendancePage"));
const LeaderboardPage = lazyWithRetry(() => import("./pages/LeaderboardPage"));
const GroupsPage = lazyWithRetry(() => import("./pages/GroupsPage"));
const GroupDetailPage = lazyWithRetry(() => import("./pages/GroupDetailPage"));
const PublicProfilePage = lazyWithRetry(() => import("./pages/PublicProfilePage"));
const AdminDashboard = lazyWithRetry(() => import("./pages/AdminDashboard"));
const PremiumPage = lazyWithRetry(() => import("./pages/PremiumPage"));
const PlannerPage = lazyWithRetry(() => import("./pages/PlannerPage"));
const ProgressPage = lazyWithRetry(() => import("./pages/ProgressPage"));
const CalendarPage = lazyWithRetry(() => import("./pages/CalendarPage"));
const NotesPage = lazyWithRetry(() => import("./pages/NotesPage"));
const PresentationPage = lazyWithRetry(() => import("./pages/PresentationPage"));
const TeacherDashboard = lazyWithRetry(() => import("./pages/TeacherDashboard"));
const StudyMaterialsPage = lazyWithRetry(() => import("./pages/StudyMaterialsPage"));
const QuestionBankPage = lazyWithRetry(() => import("./pages/QuestionBankPage"));
const LecturesPage = lazyWithRetry(() => import("./pages/LecturesPage"));
const LibraryPage = lazyWithRetry(() => import("./pages/LibraryPage"));
const CoursesPage = lazyWithRetry(() => import("./pages/CoursesPage"));
const ProjectsPage = lazyWithRetry(() => import("./pages/ProjectsPage"));
const ProjectDetailPage = lazyWithRetry(() => import("./pages/ProjectDetailPage"));
const AboutPage = lazyWithRetry(() => import("./pages/AboutPage"));
const ContactPage = lazyWithRetry(() => import("./pages/ContactPage"));
const PrivacyPage = lazyWithRetry(() => import("./pages/PrivacyPage"));
const TermsPage = lazyWithRetry(() => import("./pages/TermsPage"));

// F-06: central route guard for purely personal pages. Before this,
// only /admin and /teacher-dashboard checked auth; every other personal
// page relied on per-page handling. Guests now land on /auth instead.
const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
};

const PageFallback = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);
import GlobalAlertBanner from "./components/GlobalAlertBanner";
import SupportChatWidget from "./components/SupportChatWidget";
import MobileBottomNav from "./components/MobileBottomNav";
import ScrollToTop from "./components/ScrollToTop";
import RouteErrorBoundary from "./components/RouteErrorBoundary";
import { useEffect } from "react";

const queryClient = new QueryClient();

const DarkModeInit = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  return <>{children}</>;
};

const LocationBoundary = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  return <RouteErrorBoundary key={location.pathname}>{children}</RouteErrorBoundary>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <DepartmentProvider>
          <DarkModeInit>
            <Toaster />
            <Sonner />
            <GlobalAlertBanner />
            <BrowserRouter>
              <ScrollToTop />
              <Suspense fallback={<PageFallback />}>
              <LocationBoundary>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/ai-tutor" element={<ChatPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/practice" element={<PracticePage />} />
                <Route path="/code-lab" element={<CodeLabPage />} />
                <Route path="/docs-gen" element={<DocsGenPage />} />
                <Route path="/exam-prep" element={<ExamPrepPage />} />
                <Route path="/viva-prep" element={<VivaPage />} />
                <Route path="/past-papers" element={<PastPapersPage />} />
                <Route path="/flashcards" element={<RequireAuth><FlashcardsPage /></RequireAuth>} />
                <Route path="/career" element={<CareerPage />} />
                <Route path="/subject/:subjectId" element={<SubjectHubPage />} />
                <Route path="/subject/:subjectId/topic/:topicSlug" element={<TopicPage />} />
                <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
                <Route path="/my-subjects" element={<RequireAuth><MySubjectsPage /></RequireAuth>} />
                <Route path="/attendance" element={<RequireAuth><AttendancePage /></RequireAuth>} />
                <Route path="/leaderboard" element={<LeaderboardPage />} />
                <Route path="/groups" element={<RequireAuth><GroupsPage /></RequireAuth>} />
                <Route path="/groups/:groupId" element={<RequireAuth><GroupDetailPage /></RequireAuth>} />
                <Route path="/u/:rollNumber" element={<PublicProfilePage />} />
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/premium" element={<PremiumPage />} />
                <Route path="/planner" element={<RequireAuth><PlannerPage /></RequireAuth>} />
                <Route path="/progress" element={<RequireAuth><ProgressPage /></RequireAuth>} />
                <Route path="/calendar" element={<RequireAuth><CalendarPage /></RequireAuth>} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/presentations" element={<PresentationPage />} />
                <Route path="/study-materials" element={<StudyMaterialsPage />} />
                <Route path="/question-bank" element={<QuestionBankPage />} />
                <Route path="/lectures" element={<LecturesPage />} />
                <Route path="/library" element={<LibraryPage />} />
                {/* The books index lives at /library; /books used to 404. */}
                <Route path="/books" element={<Navigate to="/library" replace />} />
                <Route path="/courses" element={<CoursesPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
                <Route path="/teacher-dashboard" element={<TeacherDashboard />} />
                {/* Discoverability alias: the panel lives at /teacher-dashboard;
                    /teacher used to 404 even though the About page advertises a Teacher Panel. */}
                <Route path="/teacher" element={<Navigate to="/teacher-dashboard" replace />} />
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              </LocationBoundary>
              </Suspense>
              <MobileBottomNav />
              <SupportChatWidget />
            </BrowserRouter>
          </DarkModeInit>
        </DepartmentProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
