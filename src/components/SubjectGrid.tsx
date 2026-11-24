import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDepartment } from "@/contexts/DepartmentContext";
import { useMySubjects } from "@/hooks/use-my-subjects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, BookMarked, X } from "lucide-react";

interface SubjectGridProps {
  semester: number;
}

const HINT_KEY = "unigenius-mysubjects-hint-dismissed";

const SubjectGrid = ({ semester }: SubjectGridProps) => {
  const { department } = useDepartment();
  const { subjects, isCustom, resolved } = useMySubjects(semester);
  const navigate = useNavigate();
  const [hintDismissed, setHintDismissed] = useState(
    () => localStorage.getItem(HINT_KEY) === "1"
  );

  const showHint = resolved && !isCustom && !!department && !hintDismissed;

  const dismissHint = () => {
    localStorage.setItem(HINT_KEY, "1");
    setHintDismissed(true);
  };

  const openSubject = (subjectId: string, subjectName: string) => {
    // Always carry the name/semester along: scheme/pool subjects may not
    // exist in the hardcoded curriculum, and the hub falls back on these
    // params instead of showing "Subject Not Found".
    navigate(
      `/subject/${subjectId}?name=${encodeURIComponent(subjectName)}&sem=${semester}`
    );
  };

  return (
    <div className="space-y-4">
      {showHint && (
        <div className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
          <BookMarked className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-xs sm:text-sm text-muted-foreground flex-1">
            Set your subjects according to your university — every university has a different scheme of studies.
          </p>
          <Button
            size="sm"
            className="rounded-lg gradient-primary text-primary-foreground flex-shrink-0"
            onClick={() => navigate("/my-subjects")}
          >
            My Subjects
          </Button>
          <button
            onClick={dismissHint}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${department}-${semester}-${isCustom ? "custom" : "default"}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.3 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {subjects.map((subject) => (
            <motion.div
              key={subject.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              whileHover={{ y: -4 }}
              onClick={() => openSubject(subject.id, subject.name)}
              className="glass rounded-2xl p-5 cursor-pointer transition-shadow hover:shadow-elevated group"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{subject.icon}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display font-semibold text-foreground text-sm leading-tight group-hover:text-primary transition-colors">
                    {subject.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-2">
                    {subject.hasLab && (
                      <Badge variant="secondary" className="text-xs rounded-lg">
                        Lab
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <BookOpen className="w-3 h-3" /> Study
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default SubjectGrid;
