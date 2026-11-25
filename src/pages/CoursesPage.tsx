import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Loader2, Search, GraduationCap, Play, Crown, Youtube, ArrowLeft,
  CheckCircle2, ChevronLeft, ChevronRight, FolderOpen, PlayCircle, ListVideo, Maximize,
  ExternalLink, Sparkles, HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageShell from "@/components/PageShell";
import { supabase } from "@/integrations/supabase/client";

type Course = {
  id: string;
  title: string;
  channel: string;
  playlist_id: string | null;
  external_url: string | null;
  thumb_video_id: string | null;
  thumbnail_url: string | null;
  buy_url: string | null;
  section: string | null;
  language: string | null;
  category: string;
  semester_hint: number | null;
  description: string | null;
  video_count: number | null;
  sort_order: number;
};

type CourseVideo = {
  id: string;
  video_id: string;
  title: string;
  position: number;
};

type CourseProgress = { watched: string[]; lastId: string | null };
type ProgressMap = Record<string, CourseProgress>;

const PROG_KEY = "ug-course-progress-v1";
const PAGE_SIZE = 60;

const loadProgress = (): ProgressMap => {
  try {
    return JSON.parse(localStorage.getItem(PROG_KEY) || "{}") as ProgressMap;
  } catch {
    return {};
  }
};
const saveProgress = (p: ProgressMap) => {
  try {
    localStorage.setItem(PROG_KEY, JSON.stringify(p));
  } catch {
    /* storage full/blocked — progress is best-effort */
  }
};

const isPremium = (c: Course) => !!c.external_url;
// Hub card artwork (ChatGPT-made, approved by Uzair 2026-11-23; files live in
// his Drive "Course Posters" folder, anyone-reader).
const HUB_PREMIUM_IMG = "https://drive.google.com/thumbnail?id=1eeOV1ubplh5tgJgeQqYpKluE93Ykl3o4&sz=w1000";
const HUB_FREE_IMG = "https://drive.google.com/thumbnail?id=1XVZGuG4HZfYhf2I1KKc8Dqq56hIGmRdO&sz=w1000";
const HUB_AI_IMG = "https://drive.google.com/thumbnail?id=1p_ABkzLG4LNdPTCN8fWQTamKreAtvTeS&sz=w1000";
const ytThumb = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
const driveThumb = (fileId: string) => `https://drive.google.com/thumbnail?id=${fileId}&sz=w320`;
const driveEmbedUrl = (fileId: string) => `https://drive.google.com/file/d/${fileId}/preview`;
const videoThumb = (course: Course, v: CourseVideo) =>
  isPremium(course) ? driveThumb(v.video_id) : ytThumb(v.video_id);
const coursePoster = (course: Course) => {
  if (isPremium(course)) return course.thumbnail_url;
  return course.thumb_video_id ? `https://i.ytimg.com/vi/${course.thumb_video_id}/hqdefault.jpg` : null;
};

/* ---------------- YouTube player with end detection (autoplay-next) ---------------- */

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<any> | null = null;
function loadYTApi(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prev) prev();
        resolve(window.YT);
      };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      window.setTimeout(() => resolve(window.YT || null), 6000);
    });
  }
  return ytApiPromise;
}

const YouTubePlayer = ({
  videoId,
  onEnded,
}: {
  videoId: string;
  onEnded: () => void;
}) => {
  const holderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const YT = await loadYTApi();
      if (cancelled) return;
      if (!YT || !holderRef.current) {
        setFallback(true);
        return;
      }
      if (playerRef.current) {
        playerRef.current.loadVideoById(videoId);
        return;
      }
      playerRef.current = new YT.Player(holderRef.current, {
        width: "100%",
        height: "100%",
        videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
        events: {
          onStateChange: (e: any) => {
            if (e.data === 0) endedRef.current();
          },
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  useEffect(
    () => () => {
      try {
        playerRef.current?.destroy();
      } catch {
        /* noop */
      }
      playerRef.current = null;
    },
    []
  );

  if (fallback) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&autoplay=1`}
        title="YouTube video"
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return (
    <div className="w-full h-full [&>iframe]:w-full [&>iframe]:h-full">
      <div ref={holderRef} className="w-full h-full" />
    </div>
  );
};

/* ---------------- Page ---------------- */

// Premium (Drive-hosted) player. Default = native HTML5 player streaming the
// file through /api/stream (real fullscreen, proper mobile controls). If the
// stream fails on a device, it auto-falls back to the Drive preview iframe,
// which adapts quality on slow networks. The student can switch manually;
// the choice is remembered.
function PremiumPlayer({ fileId, poster }: { fileId: string; poster: string }) {
  const [mode, setMode] = useState<"native" | "drive">(() => {
    try {
      return localStorage.getItem("ug-player-mode") === "drive" ? "drive" : "native";
    } catch {
      return "native";
    }
  });
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFailed(false);
  }, [fileId]);

  const effective = failed ? "drive" : mode;
  const pick = (m: "native" | "drive") => {
    setMode(m);
    setFailed(false);
    try {
      localStorage.setItem("ug-player-mode", m);
    } catch {
      /* best-effort */
    }
  };
  const goFullscreen = () => {
    if (effective === "native") {
      const v = videoRef.current as any;
      if (v?.requestFullscreen) {
        v.requestFullscreen().catch(() => {});
        return;
      }
      if (v?.webkitEnterFullscreen) {
        v.webkitEnterFullscreen();
        return;
      }
    }
    // Drive mode (or native fallback): fullscreen the stage — the iframe
    // fills it, which is how the Drive player is designed to be watched.
    const el = stageRef.current as any;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
  };

  return (
    <div>
      <div
        ref={stageRef}
        className="relative w-full overflow-hidden rounded-3xl border border-border bg-black h-[78vw] max-h-[64vh] sm:h-auto sm:aspect-video [&:fullscreen]:h-full [&:fullscreen]:max-h-none [&:fullscreen]:rounded-none [&:fullscreen]:border-0"
      >
        {effective === "native" ? (
          <video
            key={fileId}
            ref={videoRef}
            src={`/api/stream?id=${fileId}`}
            poster={poster}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 w-full h-full"
            onError={() => setFailed(true)}
          />
        ) : (
          <iframe
            key={fileId}
            src={driveEmbedUrl(fileId)}
            title="Course video"
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <Button size="sm" variant="outline" className="rounded-xl gap-1.5" onClick={goFullscreen}>
          <Maximize className="w-4 h-4" /> Full Screen
        </Button>
        <div className="flex rounded-xl border border-border overflow-hidden text-xs font-medium">
          <button
            onClick={() => pick("native")}
            className={`px-3 py-2 ${effective === "native" ? "gradient-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            Asli Player
          </button>
          <button
            onClick={() => pick("drive")}
            className={`px-3 py-2 ${effective === "drive" ? "gradient-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            Drive Player
          </button>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {effective === "native" ? "Full screen + clean controls" : "Works better on slow internet"}
        </span>
      </div>
      {failed && mode === "native" && (
        <p className="text-[11px] text-amber-500 mt-1.5">
          The main player did not load on this device — switched to the Drive player.
        </p>
      )}
      {effective === "drive" && (
        <p className="text-[11px] text-muted-foreground mt-1.5">
          In the Drive player, tap "Next Video" below when the video ends.
        </p>
      )}
    </div>
  );
}

const CoursesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const type = searchParams.get("type");
  const courseId = searchParams.get("course");
  const watchId = searchParams.get("v");

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [videoQuery, setVideoQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [videosByCourse, setVideosByCourse] = useState<Record<string, CourseVideo[]>>({});
  const [videosLoading, setVideosLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress());
  const [autoplay, setAutoplay] = useState(true);
  const playerTopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("courses" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      setCourses((data as unknown as Course[]) || []);
      setLoading(false);
    })();
  }, []);

  const premiumAll = useMemo(() => courses.filter((c) => isPremium(c) && c.section !== "ai"), [courses]);
  const aiAll = useMemo(() => courses.filter((c) => c.section === "ai"), [courses]);
  const freeAll = useMemo(() => courses.filter((c) => !isPremium(c)), [courses]);
  const sectionCourses = type === "premium" ? premiumAll : type === "ai" ? aiAll : type === "free" ? freeAll : [];
  const activeCourse = useMemo(
    () => courses.find((c) => c.id === courseId) || null,
    [courses, courseId]
  );

  const loadVideos = useCallback(
    async (id: string) => {
      if (videosByCourse[id]) return;
      setVideosLoading(true);
      const { data } = await supabase
        .from("course_videos" as any)
        .select("id, video_id, title, position")
        .eq("course_id", id)
        .order("position", { ascending: true });
      setVideosByCourse((prev) => ({ ...prev, [id]: (data as unknown as CourseVideo[]) || [] }));
      setVideosLoading(false);
    },
    [videosByCourse]
  );

  useEffect(() => {
    if (activeCourse) {
      loadVideos(activeCourse.id);
      setVisibleCount(PAGE_SIZE);
      setVideoQuery("");
    }
  }, [activeCourse?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeVideos = activeCourse ? videosByCourse[activeCourse.id] || [] : [];
  const watchVideo = useMemo(
    () => activeVideos.find((v) => v.id === watchId) || null,
    [activeVideos, watchId]
  );
  const watchIndex = watchVideo ? activeVideos.findIndex((v) => v.id === watchVideo.id) : -1;

  const markWatched = useCallback((cId: string, vId: string) => {
    setProgress((prev) => {
      const cur = prev[cId] || { watched: [], lastId: null };
      if (cur.lastId === vId && cur.watched.includes(vId)) return prev;
      const next: ProgressMap = {
        ...prev,
        [cId]: {
          watched: cur.watched.includes(vId) ? cur.watched : [...cur.watched, vId],
          lastId: vId,
        },
      };
      saveProgress(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (activeCourse && watchVideo) {
      markWatched(activeCourse.id, watchVideo.id);
      playerTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [watchVideo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- navigation helpers ---------- */
  const nav = (params: Record<string, string>) => {
    setSearchParams(params);
  };
  const goHub = () => nav({});
  const goSection = (t: string) => {
    setQuery("");
    setCategory("All");
    nav({ type: t });
  };
  const goCourse = (c: Course) => nav({ type: c.section === "ai" ? "ai" : isPremium(c) ? "premium" : "free", course: c.id });
  const goWatch = (c: Course, v: CourseVideo) =>
    nav({ type: isPremium(c) ? "premium" : "free", course: c.id, v: v.id });

  const goNext = useCallback(() => {
    if (!activeCourse || watchIndex < 0) return;
    const next = activeVideos[watchIndex + 1];
    if (next) goWatch(activeCourse, next);
  }, [activeCourse, activeVideos, watchIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const goPrev = () => {
    if (!activeCourse || watchIndex <= 0) return;
    const prev = activeVideos[watchIndex - 1];
    if (prev) goWatch(activeCourse, prev);
  };

  /* ---------- shared bits ---------- */
  const categories = useMemo(
    () => ["All", ...Array.from(new Set(sectionCourses.map((c) => c.category).filter(Boolean)))],
    [sectionCourses]
  );

  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sectionCourses.filter((c) => {
      if (category !== "All" && c.category !== category) return false;
      if (!q) return true;
      return (
        (c.title || "").toLowerCase().includes(q) ||
        (c.channel || "").toLowerCase().includes(q) ||
        (c.category || "").toLowerCase().includes(q)
      );
    });
  }, [sectionCourses, category, query]);

  const progressPct = (c: Course) => {
    const p = progress[c.id];
    const total = c.video_count || 0;
    if (!p || !total) return 0;
    return Math.min(100, Math.round((p.watched.length / total) * 100));
  };

  const renderVideoRow = (course: Course, v: CourseVideo, idx: number) => {
    const watched = progress[course.id]?.watched.includes(v.id);
    const current = watchVideo?.id === v.id;
    return (
      <button
        key={v.id}
        onClick={() => goWatch(course, v)}
        className={`w-full flex items-center gap-3 text-left px-2 py-2 rounded-xl transition-colors ${
          current ? "bg-primary/15 border border-primary/30" : "hover:bg-muted/60 border border-transparent"
        }`}
      >
        <span className="text-xs text-muted-foreground w-6 text-center shrink-0 font-medium">
          {current ? <Play className="w-3.5 h-3.5 mx-auto text-primary" /> : idx + 1}
        </span>
        <span className="relative w-28 sm:w-36 aspect-video rounded-lg overflow-hidden bg-gradient-to-br from-primary/25 via-muted to-primary/10 shrink-0 flex items-center justify-center">
          <PlayCircle className="w-6 h-6 text-primary/50" />
          <img
            src={videoThumb(course, v)}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
            className="absolute inset-0 w-full h-full object-cover"
          />
          {watched && !current && (
            <span className="absolute inset-0 bg-black/45 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </span>
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className={`block text-[13px] leading-snug line-clamp-2 ${current ? "font-semibold text-primary" : ""}`}>
            {v.title}
          </span>
          {current && <span className="block text-[11px] text-primary mt-0.5">Now playing</span>}
          {watched && !current && <span className="block text-[11px] text-muted-foreground mt-0.5">Watched</span>}
        </span>
      </button>
    );
  };

  const filteredVideos = useMemo(() => {
    const q = videoQuery.trim().toLowerCase();
    if (!q) return activeVideos;
    return activeVideos.filter((v) => v.title.toLowerCase().includes(q));
  }, [activeVideos, videoQuery]);

  const renderVideoList = (course: Course, limit: number) => (
    <>
      <div className="space-y-1">
        {filteredVideos.slice(0, limit).map((v) => renderVideoRow(course, v, activeVideos.findIndex((x) => x.id === v.id)))}
      </div>
      {filteredVideos.length > limit && (
        <Button variant="outline" className="w-full rounded-xl mt-3" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
          Aur videos dikhao ({filteredVideos.length - limit} baqi)
        </Button>
      )}
    </>
  );

  /* ---------- views ---------- */

  const hubCard = (
    kind: "premium" | "free" | "ai",
    title: string,
    blurb: string,
    count: number,
    totalVideos: number,
    _img: string | null
  ) => {
    // Compact Lectures-pattern row: muted tint tile, title + type pill,
    // FULL description (no clamp), real counts + source pill, chevron.
    const tile =
      kind === "premium"
        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
        : kind === "ai"
          ? "bg-primary/10 text-primary border-primary/20"
          : "bg-rose-500/10 text-rose-400 border-rose-500/20";
    const typePill =
      kind === "premium"
        ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
        : kind === "ai"
          ? "bg-primary/10 text-primary border-primary/25"
          : "bg-rose-500/10 text-rose-400 border-rose-500/25";
    const source = kind === "free" ? "YouTube" : "From our Drive";
    return (
      <button
        onClick={() => goSection(kind)}
        className="text-left glass rounded-2xl border border-border p-4 flex gap-3 items-center group hover:border-primary/40 transition-colors w-full"
      >
        <span className={`w-14 h-14 rounded-2xl shrink-0 flex items-center justify-center border ${tile}`}>
          {kind === "premium" ? <Crown className="w-6 h-6" /> : kind === "ai" ? <Sparkles className="w-6 h-6" /> : <Play className="w-6 h-6" />}
        </span>
        <span className="flex-1 min-w-0 space-y-1.5">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-display font-bold">{title}</span>
            <span className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full border ${typePill}`}>
              {kind === "premium" ? "PREMIUM" : kind === "ai" ? "AI" : "FREE"}
            </span>
          </span>
          <span className="block text-xs text-muted-foreground leading-relaxed">{blurb}</span>
          <span className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-semibold text-foreground">
              {count} courses{totalVideos ? ` • ${totalVideos.toLocaleString()} videos` : ""}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted/60 border border-border/50 text-muted-foreground">
              {kind === "free" ? <Youtube className="w-3 h-3" /> : <HardDrive className="w-3 h-3" />}
              {source}
            </span>
          </span>
        </span>
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
      </button>
    );
  };

  const renderHub = () => (
    <div className="space-y-3 pb-4">
      {hubCard(
        "premium",
        "Premium Courses",
        "Complete premium courses by Apna College — Development, DSA, Data Science and AI-ML. All videos stream from our own Drive, right inside the app.",
        premiumAll.length,
        premiumAll.reduce((s, c) => s + (c.video_count || 0), 0),
        HUB_PREMIUM_IMG
      )}
      {hubCard(
        "free",
        "Free Courses",
        "The best free courses from YouTube — Sigma Web Development, Python, Java, DSA, DBMS and much more. Completely free, watch inside the app.",
        freeAll.length,
        freeAll.reduce((s, c) => s + (c.video_count || 0), 0),
        HUB_FREE_IMG
      )}
      {hubCard(
        "ai",
        "AI Courses",
        "AI and skill courses — AI tools, automation agents, building your own apps, web design, UI/UX and content creation. Skills for the new economy, from our own Drive, inside the app.",
        aiAll.length,
        aiAll.reduce((s, c) => s + (c.video_count || 0), 0),
        HUB_AI_IMG
      )}
    </div>
  );

  const renderSection = () => (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" className="rounded-xl gap-1.5" onClick={goHub}>
          <ArrowLeft className="w-3.5 h-3.5" /> Courses
        </Button>
        <div className="flex items-center gap-2">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${type === "premium" ? "bg-amber-400/15" : type === "ai" ? "bg-violet-500/15" : "bg-red-500/15"}`}>
            {type === "premium" ? <Crown className="w-4 h-4 text-amber-400" /> : type === "ai" ? <Sparkles className="w-4 h-4 text-violet-400" /> : <Youtube className="w-4 h-4 text-red-500" />}
          </span>
          <div>
            <h2 className="font-display font-bold leading-tight">{type === "premium" ? "Premium Courses" : type === "ai" ? "AI Courses" : "Free Courses"}</h2>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {type === "premium" ? "From our own Drive — videos play inside the app" : type === "ai" ? "AI skills — from our own Drive, inside the app" : "YouTube courses — watch inside the app, completely free"}
            </p>
          </div>
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a course or channel — e.g. Sigma, Java, DSA…" className="pl-9 rounded-xl" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              category === cat ? "gradient-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {filteredCourses.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center space-y-2">
          <p className="text-3xl">🎓</p>
          <p className="font-display font-semibold">No course found</p>
          <p className="text-sm text-muted-foreground">Try a different word — new courses are added over time.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {filteredCourses.map((course) => {
            const premium = isPremium(course);
            const img = coursePoster(course);
            const listImg = img ? img.replace("sz=w1000", "sz=w400") : img;
            const pct = progressPct(course);
            const lastV = progress[course.id]?.lastId
              ? (videosByCourse[course.id] || []).find((v) => v.id === progress[course.id]?.lastId)
              : undefined;
            return (
              <motion.button
                key={course.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => goCourse(course)}
                className="text-left glass rounded-2xl border border-border p-3 flex gap-3 hover:border-primary/40 transition-colors"
              >
                <div className="relative w-32 aspect-video rounded-xl overflow-hidden shrink-0 bg-gradient-to-br from-red-500/15 via-muted/40 to-primary/10">
                  {listImg && <img src={listImg} alt={course.title} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />}
                  <span className="absolute inset-0 bg-black/20" />
                  {premium && course.section !== "ai" && (
                    <span className="absolute top-1.5 left-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-black flex items-center gap-1">
                      <Crown className="w-3 h-3" /> PREMIUM
                    </span>
                  )}
                  {course.section === "ai" && (
                    <span className="absolute top-1.5 left-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500 text-white flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> AI
                    </span>
                  )}
                  {course.language && (
                    <span className="absolute bottom-1.5 left-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/60 text-white">{course.language}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <h3 className="text-sm font-display font-semibold line-clamp-2 leading-snug">{course.title}</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {course.channel}
                    {course.video_count ? ` • ${course.video_count} videos` : ""}
                  </p>
                  <div className="mt-auto flex items-center gap-2 flex-wrap pt-1">
                    {course.language && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-foreground/80">{course.language}</span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {course.category}
                      {course.semester_hint ? ` • Semester ${course.semester_hint}+` : ""}
                    </span>
                  </div>
                  {pct > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <div className="h-1 w-16 shrink-0 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {pct}% watched{lastV ? ` • Last: ${lastV.title}` : ""} — open it and continue from there
                      </p>
                    </div>
                  )}
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderCourseHeader = (course: Course) => {
    const pct = progressPct(course);
    const lastId = progress[course.id]?.lastId;
    const lastVideo = lastId ? activeVideos.find((v) => v.id === lastId) : undefined;
    const firstVideo = activeVideos[0];
    return (
      <div className="glass rounded-3xl border border-border overflow-hidden">
        <div className="relative aspect-[16/7] sm:aspect-[16/5] bg-gradient-to-br from-red-500/15 via-muted/40 to-primary/10">
          {coursePoster(course) && (
            <img src={coursePoster(course)!} alt={course.title} className="absolute inset-0 w-full h-full object-cover" />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          {isPremium(course) && (
            <span className="absolute top-3 left-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-black flex items-center gap-1">
              <Crown className="w-3 h-3" /> PREMIUM
            </span>
          )}
          <div className="absolute bottom-3 left-4 right-4 text-white">
            <h2 className="font-display font-bold text-lg sm:text-2xl leading-tight drop-shadow">{course.title}</h2>
            <p className="text-xs sm:text-sm text-white/85">
              {course.channel} • {course.category} • {activeVideos.length || course.video_count || 0} videos
              {course.language ? ` • ${course.language}` : ""}
            </p>
          </div>
        </div>
        <div className="p-4 space-y-3">
          {course.description && <p className="text-sm text-muted-foreground leading-relaxed">{course.description}</p>}
          {pct > 0 && (
            <div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{pct}% of this course watched</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {lastVideo ? (
              <Button className="rounded-xl gradient-primary text-primary-foreground gap-1.5" onClick={() => goWatch(course, lastVideo)}>
                <PlayCircle className="w-4 h-4" /> Wahin se Aage — {lastVideo.title.length > 42 ? lastVideo.title.slice(0, 42) + "…" : lastVideo.title}
              </Button>
            ) : firstVideo ? (
              <Button className="rounded-xl gradient-primary text-primary-foreground gap-1.5" onClick={() => goWatch(course, firstVideo)}>
                <Play className="w-4 h-4" /> Play First Video
              </Button>
            ) : null}
            {isPremium(course) && course.external_url && (
              <a href={course.external_url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="rounded-xl gap-1.5">
                  <FolderOpen className="w-4 h-4" /> Drive Folder
                </Button>
              </a>
            )}
            {course.buy_url && (
              <a href={course.buy_url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="rounded-xl gap-1.5 border-amber-400/50 text-amber-500 hover:text-amber-400">
                  <ExternalLink className="w-4 h-4" /> Official Page — Course Khareedo
                </Button>
              </a>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCourse = (course: Course) => (
    <div className="space-y-4">
      <Button size="sm" variant="outline" className="rounded-xl gap-1.5" onClick={() => goSection(course.section === "ai" ? "ai" : isPremium(course) ? "premium" : "free")}>
        <ArrowLeft className="w-3.5 h-3.5" /> {isPremium(course) ? "Premium Courses" : "Free Courses"}
      </Button>
      {renderCourseHeader(course)}
      <div className="glass rounded-3xl border border-border p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2 px-1">
          <ListVideo className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold">Saari Videos</h3>
          <span className="text-xs text-muted-foreground">({activeVideos.length})</span>
        </div>
        <div className="relative mb-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={videoQuery} onChange={(e) => { setVideoQuery(e.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="Search a video in this course…" className="pl-9 rounded-xl" />
        </div>
        {videosLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading videos…
          </div>
        ) : activeVideos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {isPremium(course)
              ? "This course's videos are being copied to our Drive — they will play inside the app as soon as they are ready."
              : "This course's video list is coming soon."}
          </p>
        ) : filteredVideos.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No video found with this name.</p>
        ) : (
          renderVideoList(course, visibleCount)
        )}
      </div>
    </div>
  );

  const renderWatch = (course: Course, video: CourseVideo) => {
    const premium = isPremium(course);
    return (
      <div className="space-y-4">
        <Button size="sm" variant="outline" className="rounded-xl gap-1.5" onClick={() => goCourse(course)}>
          <ArrowLeft className="w-3.5 h-3.5" /> {course.title.length > 34 ? course.title.slice(0, 34) + "…" : course.title}
        </Button>

        <div ref={playerTopRef} className="scroll-mt-24">
          {premium ? (
            <PremiumPlayer key={video.id} fileId={video.video_id} poster={videoThumb(course, video)} />
          ) : (
            <div className="rounded-3xl overflow-hidden border border-border bg-black aspect-video">
              <YouTubePlayer key={video.id} videoId={video.video_id} onEnded={() => { if (autoplay) goNext(); }} />
            </div>
          )}
        </div>

        <div className="space-y-1">
          <h2 className="font-display font-bold text-base sm:text-lg leading-snug">{video.title}</h2>
          <p className="text-xs text-muted-foreground">
            {course.title} • Video {watchIndex + 1} / {activeVideos.length}
          </p>
          {course.buy_url && (
            <a
              href={course.buy_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-amber-500 underline underline-offset-2 pt-0.5"
            >
              <ExternalLink className="w-3 h-3" /> Ye course official page se khareedo
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="rounded-xl gap-1" onClick={goPrev} disabled={watchIndex <= 0}>
            <ChevronLeft className="w-4 h-4" /> Pichli
          </Button>
          <Button size="sm" className="rounded-xl gradient-primary text-primary-foreground gap-1" onClick={goNext} disabled={watchIndex >= activeVideos.length - 1}>
            Agli Video <ChevronRight className="w-4 h-4" />
          </Button>
          {!premium && (
            <button
              onClick={() => setAutoplay((a) => !a)}
              className={`text-xs font-medium px-3 py-2 rounded-xl border transition-colors ${
                autoplay ? "gradient-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground"
              }`}
            >
              Autoplay {autoplay ? "ON" : "OFF"}
            </button>
          )}
        </div>

        <div className="glass rounded-3xl border border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2 px-1">
            <ListVideo className="w-4 h-4 text-primary" />
            <h3 className="font-display font-semibold">Up Next</h3>
            <span className="text-xs text-muted-foreground">({activeVideos.length} videos)</span>
          </div>
          {renderVideoList(course, visibleCount)}
        </div>
      </div>
    );
  };

  return (
    <PageShell
      title="Courses"
      subtitle="Complete courses with full detail — like YouTube, in one place."
      icon={
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <GraduationCap className="w-5 h-5 text-primary" />
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : activeCourse && watchVideo ? (
        renderWatch(activeCourse, watchVideo)
      ) : activeCourse ? (
        renderCourse(activeCourse)
      ) : type === null ? (
        renderHub()
      ) : (
        renderSection()
      )}
    </PageShell>
  );
};

export default CoursesPage;
