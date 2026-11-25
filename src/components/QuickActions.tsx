import { motion } from "framer-motion";
import { MessageSquare, Brain, Code, FileText, Briefcase, ClipboardList, CalendarCheck, Trophy, Users, Crown, Presentation, Archive, CalendarDays, TrendingUp, Calendar, Youtube, MonitorPlay, Layers, NotebookPen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useDepartment, departmentInfo } from "@/contexts/DepartmentContext";

const actions = [
  { icon: MessageSquare, label: "AI Tutor", desc: "Chat with your Professor", path: "/ai-tutor", tint: "bg-blue-500/10 text-blue-500 dark:text-blue-300" },
  { icon: Youtube, label: "Lectures", desc: "Subject-wise video lectures", path: "/lectures", tint: "bg-red-500/10 text-red-500 dark:text-red-300" },
  { icon: MonitorPlay, label: "Courses", desc: "Premium, Free & AI courses", path: "/courses", tint: "bg-indigo-500/10 text-indigo-500 dark:text-indigo-300" },
  { icon: CalendarDays, label: "Study Planner", desc: "AI-built weekly schedule", path: "/planner", tint: "bg-violet-500/10 text-violet-500 dark:text-violet-300" },
  { icon: TrendingUp, label: "Progress", desc: "Hours, charts & completion", path: "/progress", tint: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-300" },
  { icon: Calendar, label: "Calendar", desc: "Quizzes, exams & deadlines", path: "/calendar", tint: "bg-cyan-500/10 text-cyan-500 dark:text-cyan-300" },
  { icon: Brain, label: "Practice", desc: "Quizzes & Mock Tests", path: "/practice", tint: "bg-violet-500/10 text-violet-500 dark:text-violet-300" },
  { icon: Code, label: "Code Lab", desc: "Debug & Optimize Code", path: "/code-lab", tint: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-300" },
  { icon: FileText, label: "Docs Gen", desc: "Lab Manuals & Notes", path: "/docs-gen", tint: "bg-amber-500/10 text-amber-500 dark:text-amber-300" },
  { icon: CalendarCheck, label: "Attendance", desc: "Track & Monitor", path: "/attendance", tint: "bg-cyan-500/10 text-cyan-500 dark:text-cyan-300" },
  { icon: Trophy, label: "Leaderboard", desc: "Rankings & Points", path: "/leaderboard", tint: "bg-amber-500/10 text-amber-500 dark:text-amber-300" },
  { icon: ClipboardList, label: "Exam Prep", desc: "Midterms & Finals", path: "/exam-prep", tint: "bg-rose-500/10 text-rose-500 dark:text-rose-300" },
  { icon: Briefcase, label: "Career Hub", desc: "Interviews & Internships", path: "/career", tint: "bg-sky-500/10 text-sky-500 dark:text-sky-300" },
  { icon: Crown, label: "Premium", desc: "Unlock Pro features", path: "/premium", tint: "bg-amber-500/10 text-amber-500 dark:text-amber-300" },
  { icon: Layers, label: "Flashcards", desc: "Review with spaced repetition", path: "/flashcards", tint: "bg-fuchsia-500/10 text-fuchsia-500 dark:text-fuchsia-300" },
  { icon: NotebookPen, label: "Notes", desc: "Class notes & summaries", path: "/notes", tint: "bg-violet-500/10 text-violet-500 dark:text-violet-300" },
  { icon: Presentation, label: "Slides", desc: "AI Presentation Maker", path: "/presentations", tint: "bg-violet-500/10 text-violet-500 dark:text-violet-300" },
  { icon: Users, label: "Groups", desc: "Team Collaboration", path: "/groups", tint: "bg-violet-500/10 text-violet-500 dark:text-violet-300" },
  { icon: Archive, label: "Study Materials", desc: "Notes & Resources", path: "/study-materials", tint: "bg-teal-500/10 text-teal-500 dark:text-teal-300" },
];

const QuickActions = () => {
  const navigate = useNavigate();
  const { department } = useDepartment();
  // The AI Tutor card names the student's OWN department's professor —
  // it used to hardcode "SE Professor" for everyone.
  const tutorDesc = department
    ? `Chat with your ${departmentInfo[department].name} Professor`
    : "Chat with your Professor";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {actions.map((action) => (
        <motion.button
          key={action.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          whileHover={{ y: -4, scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate(action.path)}
          className="glass rounded-2xl p-4 text-left group transition-shadow hover:shadow-elevated"
        >
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 ${action.tint}`}>
            <action.icon className="w-5 h-5" />
          </div>
          <p className="font-display font-semibold text-sm text-foreground">{action.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{action.path === "/ai-tutor" ? tutorDesc : action.desc}</p>
        </motion.button>
      ))}
    </div>
  );
};

export default QuickActions;
