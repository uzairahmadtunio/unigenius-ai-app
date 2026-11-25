import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { GraduationCap, Code2, BookOpen, Award, Briefcase, FlaskConical } from "lucide-react";
import { useQuestionCount, formatCount } from "@/hooks/use-question-count";

interface SplashScreenProps {
  onComplete: () => void;
}

const subtitles = [
  "The Future of University Learning",
  "Your Lab Manual Companion",
  "Bunk Smarter, Not Harder",
  "Build Your Portfolio",
];

const floatingIcons = [
  { Icon: BookOpen, x: "12%", y: "18%", size: 28, delay: 0 },
  { Icon: Code2, x: "78%", y: "22%", size: 32, delay: 0.5 },
  { Icon: Award, x: "85%", y: "65%", size: 26, delay: 1 },
  { Icon: Briefcase, x: "8%", y: "72%", size: 30, delay: 1.5 },
  { Icon: FlaskConical, x: "50%", y: "85%", size: 24, delay: 0.8 },
  { Icon: GraduationCap, x: "25%", y: "82%", size: 22, delay: 1.2 },
];

const SplashScreen = ({ onComplete }: SplashScreenProps) => {
  const questionCount = useQuestionCount();
  const [stage, setStage] = useState(0);
  const [subtitleIdx, setSubtitleIdx] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(1), 600),
      setTimeout(() => setStage(2), 2000),
      setTimeout(() => setStage(3), 3200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Cycle subtitles every 3s after stage 1
  useEffect(() => {
    if (stage < 1) return;
    const interval = setInterval(() => {
      setSubtitleIdx((prev) => (prev + 1) % subtitles.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [stage]);

  const handleGetStarted = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleSignIn = useCallback(() => {
    onComplete();
    navigate("/auth");
  }, [onComplete, navigate]);

  // Typing animation text
  const headline = "Welcome to UniGenius AI";

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden auth-grain"
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6 }}
        style={{
          background:
            "radial-gradient(900px 480px at 12% -5%, hsl(252 95% 68% / 0.16), transparent 60%), radial-gradient(820px 420px at 88% -10%, hsl(245 90% 66% / 0.12), transparent 60%), #07060F",
        }}
      >
        {/* Faint grid overlay (auth world) */}
        <div className="auth-grid-overlay" />

        {/* Animated mesh gradient blobs — violet family only */}
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute w-[600px] h-[600px] rounded-full opacity-30 blur-3xl"
            style={{
              background: "radial-gradient(circle, hsl(262 80% 55% / 0.5), transparent 70%)",
              top: "-10%",
              left: "-5%",
            }}
            animate={{
              x: [0, 60, -30, 0],
              y: [0, 40, -20, 0],
              scale: [1, 1.15, 0.95, 1],
            }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute w-[500px] h-[500px] rounded-full opacity-25 blur-3xl"
            style={{
              background: "radial-gradient(circle, hsl(248 85% 60% / 0.5), transparent 70%)",
              top: "40%",
              right: "-10%",
            }}
            animate={{
              x: [0, -40, 20, 0],
              y: [0, -30, 50, 0],
              scale: [1, 1.1, 1.05, 1],
            }}
            transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute w-[400px] h-[400px] rounded-full opacity-20 blur-3xl"
            style={{
              background: "radial-gradient(circle, hsl(275 75% 55% / 0.4), transparent 70%)",
              bottom: "-5%",
              left: "30%",
            }}
            animate={{
              x: [0, 30, -40, 0],
              y: [0, -20, 30, 0],
              scale: [1, 1.2, 0.9, 1],
            }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        {/* Floating transparent icons — faint violet */}
        {floatingIcons.map(({ Icon, x, y, size, delay }, i) => (
          <motion.div
            key={i}
            className="absolute"
            style={{ left: x, top: y }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{
              opacity: [0.08, 0.18, 0.08],
              y: [0, -15, 0],
              rotate: [0, 10, -10, 0],
              scale: [0.9, 1.1, 0.9],
            }}
            transition={{
              duration: 6,
              delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <Icon
              style={{ width: size, height: size }}
              className="text-violet-300/25"
              strokeWidth={1.2}
            />
          </motion.div>
        ))}

        {/* Logo with pulse animation */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 180, damping: 14 }}
          className="mb-8 relative"
        >
          <motion.div
            className="absolute inset-0 rounded-2xl gradient-primary"
            style={{
              filter: "blur(20px)",
            }}
            animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="relative w-20 h-20 rounded-2xl flex items-center justify-center border border-white/15 gradient-primary shadow-[0_18px_38px_-12px_rgba(124,92,255,0.6)]"
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          >
            <GraduationCap className="w-10 h-10 text-white" />
          </motion.div>
        </motion.div>

        <div className="text-center space-y-5 relative z-10 px-4">
          {/* Typing headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={stage >= 0 ? { opacity: 1, y: 0 } : {}}
            className="text-4xl md:text-6xl font-display font-black text-white tracking-tight"
            style={{
              textShadow: "0 0 40px hsl(262 80% 60% / 0.3), 0 2px 10px hsl(0 0% 0% / 0.3)",
            }}
          >
            {headline.split("").map((char, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.05 * i, duration: 0.05 }}
                className={i >= 11 ? "headline-text" : undefined}
                style={i >= 11 ? { textShadow: "none" } : undefined}
              >
                {char}
              </motion.span>
            ))}
          </motion.h1>

          {/* Cycling subtitle */}
          <div className="h-8 relative flex items-center justify-center">
            <AnimatePresence mode="wait">
              {stage >= 1 && (
                <motion.p
                  key={subtitleIdx}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.5 }}
                  className="text-lg md:text-xl text-white/70 font-medium absolute"
                >
                  {subtitles[subtitleIdx]}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Get Started CTA */}
          <AnimatePresence>
            {stage >= 2 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="pt-4 space-y-3"
              >
                <motion.button
                  onClick={handleGetStarted}
                  className="gradient-button relative px-10 py-3.5 rounded-2xl font-display font-bold text-white text-base tracking-wide overflow-hidden group"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.97 }}
                  animate={{
                    boxShadow: [
                      "0 0 20px hsl(258 90% 65% / 0.35), 0 0 40px hsl(252 85% 60% / 0.18)",
                      "0 0 35px hsl(258 90% 65% / 0.55), 0 0 70px hsl(252 85% 60% / 0.28)",
                      "0 0 20px hsl(258 90% 65% / 0.35), 0 0 40px hsl(252 85% 60% / 0.18)",
                    ],
                  }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  {/* Glowing border overlay */}
                  <span
                    className="absolute inset-0 rounded-2xl opacity-60"
                    style={{
                      border: "1px solid hsl(258 90% 78% / 0.45)",
                    }}
                  />
                  Get Started →
                </motion.button>

                <p className="text-sm text-white/50">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={handleSignIn}
                    className="font-semibold text-violet-300 underline-offset-4 transition hover:text-violet-200 hover:underline"
                  >
                    Sign in
                  </button>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Stats + founder credit at bottom */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={stage >= 3 ? { opacity: 1 } : {}}
          transition={{ duration: 0.6 }}
          className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-4 px-6"
        >
          <div className="grid grid-cols-3 divide-x divide-white/[0.08] text-center">
            <div className="px-4 sm:px-6">
              <p className="font-display text-lg sm:text-xl font-bold text-white">55+</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Subjects</p>
            </div>
            <div className="px-4 sm:px-6">
              <p className="font-display text-lg sm:text-xl font-bold text-white">615</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Topic Pages</p>
            </div>
            <div className="px-4 sm:px-6">
              <p className="font-display text-lg sm:text-xl font-bold text-white">{formatCount(questionCount)}</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">Questions</p>
            </div>
          </div>
          <div className="w-16 h-px bg-white/15" />
          <p className="text-[11px] text-white/30 tracking-widest uppercase font-light">
            Designed & Founded by Uzair Ahmad
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default SplashScreen;
