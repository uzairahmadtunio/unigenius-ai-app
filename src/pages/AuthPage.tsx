import { useState } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  Sparkles,
  Layers,
  TrendingUp,
  Flame,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import confetti from "canvas-confetti";

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const rawNext = new URLSearchParams(window.location.search).get("next") || "";
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const returnUrl = window.location.origin + nextPath;
  const goNext = () => {
    navigate(nextPath);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Founder celebration 🎉
        if (data.user?.email === "uzairahmadtunio786@gmail.com") {
          const duration = 3000;
          const end = Date.now() + duration;
          const frame = () => {
            confetti({ particleCount: 8, angle: 60, spread: 55, origin: { x: 0 }, colors: ["#a855f7", "#6366f1", "#3b82f6"] });
            confetti({ particleCount: 8, angle: 120, spread: 55, origin: { x: 1 }, colors: ["#8B5CF6", "#818CF8", "#6E9BFF"] });
            if (Date.now() < end) requestAnimationFrame(frame);
          };
          frame();
          confetti({ particleCount: 300, spread: 160, origin: { y: 0.35 }, startVelocity: 45, gravity: 0.8 });
          toast.success("🎉 Welcome back, Founder! UniGenius is LIVE!");
        } else {
          toast.success("Welcome back!");
        }
        goNext();
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: returnUrl,
          },
        });
        if (error) throw error;
        toast.success("Account created! Check your email to verify.");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: returnUrl },
    });
    if (error) toast.error(error.message);
  };

  const inputClassName =
    "h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-11 pr-4 text-[15px] text-white outline-none transition placeholder:text-white/35 focus:border-primary/50 focus:ring-2 focus:ring-primary/60";

  const headlineClassName = "headline-text";

  return (
    <div className="auth-backdrop relative min-h-screen overflow-hidden bg-[#080614] text-white">
      {/* Backdrop layers: violet glow + faint grid + grain */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[#080614]" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_520px_at_15%_-10%,rgba(139,92,246,0.28),transparent_60%),radial-gradient(700px_500px_at_85%_110%,rgba(99,102,241,0.18),transparent_60%),radial-gradient(500px_380px_at_55%_45%,rgba(139,92,246,0.07),transparent_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black,transparent)]" />
        <div
          className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1600px] flex-col lg:grid lg:grid-cols-2">
        {/* LEFT showcase (desktop only) */}
        <motion.section
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative hidden flex-col justify-between px-10 py-10 lg:flex xl:px-16 xl:py-12"
        >
          {/* Top: logo + wordmark */}
          <div className="flex items-center gap-3">
            <div className="gradient-primary flex h-11 w-11 items-center justify-center rounded-2xl shadow-[0_10px_30px_-8px_rgba(139,92,246,0.55)]">
              <GraduationCap className="h-6 w-6 text-white" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-white">UniGenius</span>
          </div>

          {/* Middle: headline, copy, features, tutor card */}
          <div className="mt-14 max-w-xl xl:mt-16">
            <div className="flex items-center gap-3">
              <span className="h-px w-8 bg-violet-300/60" />
              <span className="text-[11px] font-semibold tracking-[0.3em] text-violet-300/80">
                AI STUDY PLATFORM
              </span>
            </div>

            <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight text-white xl:text-6xl">
              Learn smarter.
              <br />
              <span className={headlineClassName}>{"Score "}</span>
              <span className={`${headlineClassName} font-accent font-medium italic`}>higher.</span>
            </h1>

            <p className="mt-6 max-w-md text-base leading-relaxed text-white/60 xl:text-lg">
              Every subject, note, past paper and lecture for your degree — with an AI tutor that
              knows your syllabus. All in one place.
            </p>

            <ul className="mt-9 space-y-4">
              <li className="flex items-center gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-violet-300">
                  <Sparkles className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[15px] text-white/85">An AI tutor, trained on your subjects</span>
              </li>
              <li className="flex items-center gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-violet-300">
                  <Layers className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[15px] text-white/85">Notes, lectures &amp; past papers in one place</span>
              </li>
              <li className="flex items-center gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-violet-300">
                  <TrendingUp className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[15px] text-white/85">Track streaks, progress &amp; weak areas</span>
              </li>
            </ul>

            {/* AI Tutor showcase card */}
            <div className="relative mt-14 max-w-[540px]">
              {/* Floating streak chip */}
              <div className="absolute -top-6 right-4 z-10 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-[#17122B]/90 px-3.5 py-2.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-400/20 bg-violet-500/20 text-violet-300">
                  <Flame className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-[13px] font-bold leading-tight text-white">12-day streak</span>
                  <span className="block text-[11px] leading-tight text-white/50">Keep it going</span>
                </span>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)] backdrop-blur-xl">
                <div className="flex items-center gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.9)]" />
                  <span className="text-[11px] font-semibold tracking-[0.18em] text-white/70">AI TUTOR</span>
                  <span className="rounded-full border border-violet-400/30 bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-200">
                    Physics
                  </span>
                </div>
                <p className="mt-4 text-[15px] font-semibold text-white">
                  &ldquo;Explain entropy with a real-life example.&rdquo;
                </p>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  Think of your hostel room: it drifts toward disorder on its own, and only energy
                  spent tidying pushes it back...
                </p>
                <div className="mt-5 flex items-center gap-3 text-xs text-white/50">
                  <span className="shrink-0">Thermodynamics · 12 of 14 topics</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full w-[86%] rounded-full bg-gradient-to-r from-violet-500 to-indigo-400" />
                  </span>
                  <span className="font-semibold text-violet-300">86%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom: stats */}
          <div className="mt-14 border-t border-white/[0.07] pt-7">
            <div className="grid grid-cols-3 divide-x divide-white/[0.07]">
              <div className="pr-6">
                <p className="font-display text-2xl font-bold text-white">55+</p>
                <p className="mt-1 text-sm text-white/45">Subjects</p>
              </div>
              <div className="px-6">
                <p className="font-display text-2xl font-bold text-white">615</p>
                <p className="mt-1 text-sm text-white/45">Topic pages</p>
              </div>
              <div className="px-6">
                <p className="font-display text-2xl font-bold text-white">2,410</p>
                <p className="mt-1 text-sm text-white/45">Practice questions</p>
              </div>
            </div>
          </div>
        </motion.section>

        {/* RIGHT: form (also the whole mobile view) */}
        <section className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:px-10 xl:px-16">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="w-full max-w-[420px]"
          >
            {/* Mobile logo */}
            <div className="mb-8 flex justify-center lg:hidden">
              <div className="gradient-primary flex h-14 w-14 items-center justify-center rounded-2xl shadow-[0_12px_36px_-8px_rgba(139,92,246,0.6)]">
                <GraduationCap className="h-7 w-7 text-white" />
              </div>
            </div>

            <div className="text-center lg:text-left">
              <h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-[32px]">
                {isLogin ? "Welcome back" : "Create an account"}
              </h2>
              <p className="mt-2 text-[15px] text-white/55">
                {isLogin ? "Sign in to continue learning." : "Start your learning journey."}
              </p>
            </div>

            {/* Google */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-white text-[15px] font-semibold text-slate-900 shadow-[0_8px_30px_-10px_rgba(255,255,255,0.25)] transition hover:bg-white/90 active:scale-[0.99]"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>

            <div className="mt-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-[13px] text-white/40">or continue with email</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            {/* Email form */}
            <form onSubmit={handleEmailAuth} className="mt-6 space-y-3.5">
              {!isLogin && (
                <div className="relative">
                  <User className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-violet-300/80" />
                  <input
                    placeholder="Full Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClassName}
                    required
                  />
                </div>
              )}
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-violet-300/80" />
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClassName}
                  required
                />
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-violet-300/80" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputClassName} pr-11`}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 transition hover:text-white/70"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
              {isLogin && (
                <div className="flex justify-end pt-0.5">
                  <a
                    href="/forgot-password"
                    className="text-[13px] font-medium text-white/60 transition hover:text-violet-300"
                  >
                    Forgot password?
                  </a>
                </div>
              )}
              <div className="pt-1.5">
                <button
                  type="submit"
                  disabled={loading}
                  className="gradient-button flex h-12 w-full items-center justify-center rounded-xl text-[15px] font-semibold text-white shadow-[0_12px_40px_-12px_rgba(139,92,246,0.65)] transition hover:brightness-110 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
                >
                  {loading ? "Please wait..." : isLogin ? "Sign in" : "Create account"}
                </button>
              </div>
            </form>

            <p className="mt-6 text-center text-sm text-white/55 lg:text-left">
              {isLogin ? "New to UniGenius? " : "Already have an account? "}
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="font-semibold text-violet-300 underline-offset-4 transition hover:text-violet-200 hover:underline"
              >
                {isLogin ? "Create an account" : "Sign in"}
              </button>
            </p>

            {/* Mobile stats (desktop stats live in the left panel) */}
            <div className="mt-10 border-t border-white/[0.07] pt-6 lg:hidden">
              <div className="grid grid-cols-3 divide-x divide-white/[0.07] text-center">
                <div className="px-2">
                  <p className="font-display text-xl font-bold text-white">55+</p>
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">Subjects</p>
                </div>
                <div className="px-2">
                  <p className="font-display text-xl font-bold text-white">615</p>
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">Topic Pages</p>
                </div>
                <div className="px-2">
                  <p className="font-display text-xl font-bold text-white">2,410</p>
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">Questions</p>
                </div>
              </div>
            </div>

            <p className="mt-8 text-center text-[13px] leading-relaxed text-white/40 lg:mt-10 lg:text-left">
              By continuing, you agree to our{" "}
              <a href="/terms" className="font-medium text-white/75 underline-offset-4 transition hover:text-white hover:underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy" className="font-medium text-white/75 underline-offset-4 transition hover:text-white hover:underline">
                Privacy Policy
              </a>
              .
            </p>

            <p className="mt-4 text-center text-[13px] text-white/40 lg:text-left">
              Designed &amp; Developed by <span className="font-semibold text-white/80">Uzair Ahmad</span>
            </p>
          </motion.div>
        </section>
      </div>
    </div>
  );
};

export default AuthPage;
