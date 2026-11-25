import { ClipboardList, FileText, Mic, Layers, ChevronRight, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import PageShell from "@/components/PageShell";
import { motion } from "framer-motion";

interface ExamPrepFeature {
  icon: LucideIcon;
  title: string;
  desc: string;
  path: string;
  tile: string;
}

const features: ExamPrepFeature[] = [
  { icon: FileText, title: "Past Papers", desc: "Practice with previous years' midterm and final papers", path: "/past-papers", tile: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { icon: Mic, title: "Viva Prep", desc: "AI-simulated viva sessions for every subject", path: "/viva-prep", tile: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { icon: Layers, title: "Quick Revision", desc: "AI flashcards from your notes and lab manuals", path: "/flashcards", tile: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
];

const ExamPrepPage = () => {
  const navigate = useNavigate();

  return (
    <PageShell
      title="Exam Prep"
      subtitle="Midterms & Finals"
      icon={
        <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
          <ClipboardList className="w-5 h-5 text-rose-400" />
        </div>
      }
    >
      <div className="space-y-3">
        {features.map((f, i) => (
          <motion.button
            key={f.title}
            type="button"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            onClick={() => navigate(f.path)}
            className="glass rounded-2xl w-full text-left p-4 flex items-center gap-4 cursor-pointer hover:border-primary/30 border border-transparent transition-all hover:shadow-lg group min-h-[104px]"
          >
            <span className={`w-14 h-14 rounded-2xl border flex items-center justify-center flex-shrink-0 ${f.tile}`}>
              <f.icon className="w-6 h-6" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-display font-semibold text-foreground group-hover:text-primary transition-colors">{f.title}</span>
              <span className="block text-sm text-muted-foreground mt-1 leading-snug">{f.desc}</span>
            </span>
            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
          </motion.button>
        ))}
      </div>
    </PageShell>
  );
};

export default ExamPrepPage;
