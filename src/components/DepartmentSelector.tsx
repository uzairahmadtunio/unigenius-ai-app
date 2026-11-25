import { motion } from "framer-motion";
import {
  GraduationCap,
  ArrowRight,
  ChevronRight,
  Code2,
  Cpu,
  Brain,
  type LucideIcon,
} from "lucide-react";
import { Department, departmentInfo, useDepartment } from "@/contexts/DepartmentContext";

const departments: Department[] = ["se", "cs", "ai"];

const departmentIcons: Record<Department, LucideIcon> = {
  se: Code2,
  cs: Cpu,
  ai: Brain,
};

const DepartmentSelector = () => {
  const { setDepartment } = useDepartment();

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto auth-grain"
      style={{
        background:
          "radial-gradient(900px 480px at 12% -5%, hsl(252 95% 68% / 0.16), transparent 60%), radial-gradient(820px 420px at 88% -10%, hsl(245 90% 66% / 0.12), transparent 60%), #07060F",
      }}
    >
      {/* Plum-black violet world — grid overlay + glow orbs, pinned to the viewport so they never clip or scroll with content */}
      <div className="auth-grid-overlay" />
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute w-[300px] h-[300px] sm:w-[500px] sm:h-[500px] rounded-full opacity-15"
          style={{ background: "radial-gradient(circle, hsla(258, 85%, 65%, 0.4), transparent)", top: "-10%", left: "-5%" }}
          animate={{ scale: [1, 1.2, 1], x: [0, 40, 0] }}
          transition={{ duration: 6, repeat: Infinity }}
        />
        <motion.div
          className="absolute w-[260px] h-[260px] sm:w-[400px] sm:h-[400px] rounded-full opacity-15"
          style={{ background: "radial-gradient(circle, hsla(275, 70%, 62%, 0.4), transparent)", bottom: "-5%", right: "-5%" }}
          animate={{ scale: [1, 1.3, 1], y: [0, -30, 0] }}
          transition={{ duration: 5, repeat: Infinity }}
        />
      </div>

      <div className="relative z-10 min-h-full w-full max-w-md sm:max-w-3xl mx-auto flex flex-col justify-center px-5 sm:px-6 pt-8 pb-28 md:py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6 sm:mb-10"
        >
          <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-4 sm:mb-5 shadow-elevated">
            <GraduationCap className="w-6 h-6 sm:w-8 sm:h-8 text-primary-foreground" />
          </div>
          <h1 className="text-[26px] leading-tight sm:text-4xl font-display font-bold text-foreground mb-2">
            Choose Your <span className="gradient-text">Department</span>
          </h1>
          <p className="text-muted-foreground text-[13px] sm:text-sm max-w-md mx-auto">
            Select your program to get personalized subjects, AI tutoring, and study resources tailored to your curriculum.
          </p>
        </motion.div>

        <div className="flex flex-col gap-3 sm:grid sm:grid-cols-3 sm:gap-4 w-full">
          {departments.map((dept, idx) => {
            const info = departmentInfo[dept];
            const Icon = departmentIcons[dept];
            return (
              <motion.button
                key={dept}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + idx * 0.1 }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setDepartment(dept)}
                className="glass rounded-2xl p-4 sm:p-5 text-left group transition-all hover:shadow-elevated flex items-center gap-3.5 sm:flex-col sm:items-start sm:gap-0 w-full"
              >
                <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br ${info.color} flex items-center justify-center shrink-0 sm:mb-4 shadow-sm`}>
                  <Icon className="w-[22px] h-[22px] sm:w-6 sm:h-6 text-white" strokeWidth={1.8} />
                </div>
                <div className="flex-1 min-w-0 sm:flex-none sm:w-full">
                  <h3 className="font-display font-bold text-[15px] sm:text-lg leading-snug text-foreground">{info.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 sm:mt-1">{info.fullName}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground/70 shrink-0 sm:hidden" />
                <div className="hidden sm:flex items-center gap-1 text-xs font-medium text-primary group-hover:gap-2 transition-all sm:mt-4">
                  Select <ArrowRight className="w-3 h-3" />
                </div>
              </motion.button>
            );
          })}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center text-xs text-muted-foreground mt-6 sm:mt-8"
        >
          You can change this anytime from your profile settings.
        </motion.p>
      </div>
    </div>
  );
};

export default DepartmentSelector;
