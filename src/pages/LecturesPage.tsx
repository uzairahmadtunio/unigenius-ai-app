import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Youtube, PlayCircle, ExternalLink, MonitorPlay, Loader2, Search, Languages, ListVideo, CheckCircle2, Circle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageShell from "@/components/PageShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getSubjects } from "@/data/subjects";

type Lecture = {
  id: string;
  subject: string;
  title: string;
  channel: string;
  playlist_id: string;
  thumb_video_id: string | null;
  semester: number | null;
  sort_order: number;
  language: string | null;
  video_count: number | null;
};

type VideoHit = {
  id: string;
  video_id: string;
  title: string;
  position: number;
  lecture: { id: string; subject: string; channel: string; playlist_id: string; semester: number | null } | null;
};

const playlistWatchUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`;
const playlistEmbedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/videoseries?list=${id}&rel=0`;
const videoEmbedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0&autoplay=1`;
const videoWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const thumbUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

// Subject-name matching that survives naming variants between the subject
// pool and the lecture catalog ("Object-Oriented Programming (OOP)" vs
// "Object Oriented Programming", "ICT" vs "Introduction to ICT", ...).
const normalizeSubject = (name: string) =>
  name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/^introduction to /, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const subjectsMatch = (a: string, b: string) => {
  const na = normalizeSubject(a);
  const nb = normalizeSubject(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
};

// Stricter match used ONLY by the semester filter: a part-match counts
// only when the shorter name is at least 4 letters long. Without this,
// "AI" (from "Introduction to AI") matched "AI Ethics", so two Semester 2
// playlists appeared in the Semester 8 results.
const semesterSubjectMatch = (a: string, b: string) => {
  const na = normalizeSubject(a);
  const nb = normalizeSubject(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (Math.min(na.length, nb.length) < 4) return false;
  return na.includes(nb) || nb.includes(na);
};

const LecturesPage = () => {
  const { user } = useAuth();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [videoTotal, setVideoTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [semester, setSemester] = useState<number | "all">("all");
  const semesterTouched = useRef(false);
  // True only after the student personally clicks a semester button.
  // The profile auto-set (current semester) does NOT set this, so the
  // "My Subjects" view still opens by default; a real click switches
  // to the filtered catalog grid (see the render logic below).
  const [semesterChosen, setSemesterChosen] = useState(false);
  const [activeSubject, setActiveSubject] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [mySubjects, setMySubjects] = useState<{ name: string; semester: number | null }[]>([]);
  const [view, setView] = useState<"mine" | "browse">("browse");
  const viewTouched = useRef(false);
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(new Set());
  const [videoHits, setVideoHits] = useState<VideoHit[]>([]);
  const [searchingVideos, setSearchingVideos] = useState(false);
  // Lecture progress: watched video ids per lecture (DB for signed-in
  // students, localStorage for guests) — drives checkmarks, progress bars
  // and the Resume button.
  const [progress, setProgress] = useState<Record<string, string[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [listVideos, setListVideos] = useState<
    Record<string, { id: string; video_id: string; title: string; position: number }[]>
  >({});
  const [watchVideo, setWatchVideo] = useState<{ lectureId: string; videoId: string } | null>(null);

  useEffect(() => {
    (async () => {
      if (user) {
        const { data } = await supabase
          .from("user_lecture_progress" as any)
          .select("lecture_id, video_id")
          .eq("user_id", user.id);
        if (data) {
          const map: Record<string, string[]> = {};
          (data as any[]).forEach((r) => {
            (map[r.lecture_id] = map[r.lecture_id] || []).push(r.video_id);
          });
          setProgress(map);
        }
      } else {
        try {
          const raw = localStorage.getItem("ug-lecture-progress-v1");
          if (raw) setProgress(JSON.parse(raw));
        } catch {
          /* ignore */
        }
      }
    })();
  }, [user]);

  const setWatched = (lectureId: string, videoId: string, watched: boolean) => {
    setProgress((prev) => {
      const cur = new Set(prev[lectureId] || []);
      if (watched) cur.add(videoId);
      else cur.delete(videoId);
      const next = { ...prev, [lectureId]: Array.from(cur) };
      if (!user) {
        try {
          localStorage.setItem("ug-lecture-progress-v1", JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
    if (user) {
      if (watched) {
        supabase
          .from("user_lecture_progress" as any)
          .upsert({ user_id: user.id, lecture_id: lectureId, video_id: videoId })
          .then(() => {});
      } else {
        supabase
          .from("user_lecture_progress" as any)
          .delete()
          .eq("user_id", user.id)
          .eq("lecture_id", lectureId)
          .eq("video_id", videoId)
          .then(() => {});
      }
    }
  };

  const loadList = async (lectureId: string) => {
    if (listVideos[lectureId]) return listVideos[lectureId];
    const { data } = await supabase
      .from("lecture_videos" as any)
      .select("id, video_id, title, position")
      .eq("lecture_id", lectureId)
      .order("position", { ascending: true });
    const rows = (data as any[]) || [];
    setListVideos((prev) => ({ ...prev, [lectureId]: rows }));
    return rows;
  };

  const playListVideo = (lec: Lecture, v: { video_id: string }) => {
    setWatchVideo({ lectureId: lec.id, videoId: v.video_id });
    setPlayingId(null);
    setWatched(lec.id, v.video_id, true);
  };

  const resumeLecture = async (lec: Lecture) => {
    const rows = await loadList(lec.id);
    const watched = new Set(progress[lec.id] || []);
    const next = rows.find((v) => !watched.has(v.video_id)) || rows[0];
    if (next) playListVideo(lec, next);
  };

  useEffect(() => {
    (async () => {
      const [{ data }, { count }] = await Promise.all([
        supabase
          .from("subject_lectures" as any)
          .select("*")
          .order("subject", { ascending: true })
          .order("sort_order", { ascending: true }),
        supabase
          .from("lecture_videos" as any)
          .select("id", { count: "exact", head: true }),
      ]);
      if (data) setLectures(data as unknown as Lecture[]);
      if (typeof count === "number") setVideoTotal(count);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: subs }, { data: prof }] = await Promise.all([
        supabase.from("user_subjects" as any).select("name, semester").eq("user_id", user.id),
        supabase.from("profiles" as any).select("current_semester").eq("user_id", user.id).maybeSingle(),
      ]);
      if (subs) {
        const rows = (subs as any[]).map((r) => ({
          name: String(r.name),
          semester: typeof r.semester === "number" ? r.semester : null,
        }));
        setMySubjects(rows);
        if (rows.length > 0 && !viewTouched.current) setView("mine");
      }
      const sem = (prof as any)?.current_semester;
      if (!semesterTouched.current && typeof sem === "number" && sem >= 1) setSemester(sem);
    })();
  }, [user]);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const searching = debouncedQuery.length > 0;

  // Video-level topic search (YouTube-style): every word must match the title.
  useEffect(() => {
    if (!searching) {
      setVideoHits([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setSearchingVideos(true);
      let q = supabase
        .from("lecture_videos" as any)
        .select(
          "id, video_id, title, position, lecture:subject_lectures(id, subject, channel, playlist_id, semester)",
        );
      for (const word of debouncedQuery.split(/\s+/).filter(Boolean)) {
        q = q.ilike("title", `%${word}%`);
      }
      const { data } = await q.order("position", { ascending: true }).limit(60);
      if (!cancelled) {
        setVideoHits((data as unknown as VideoHit[]) || []);
        setSearchingVideos(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, searching]);

  const semesters = useMemo(() => {
    const set = new Set<number>();
    lectures.forEach((l) => {
      if (l.semester) set.add(l.semester);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [lectures]);

  // Semester filter is curriculum-aware: a playlist also belongs to a
  // semester when its SUBJECT is in that semester's curriculum (any
  // department), even if the playlist row itself was tagged with a
  // different semester. Previously Sem 8 showed only 2 playlists because
  // almost no rows carry semester=8, hiding the ML / Robotics / Data
  // Science playlists Sem-8 students actually need (24 Nov 2026).
  const bySemester = useMemo(() => {
    if (semester === "all") return lectures;
    const curriculumNames = (["se", "cs", "ai"] as const).flatMap((d) =>
      getSubjects(d, semester).map((s) => s.name),
    );
    return lectures.filter(
      (l) =>
        l.semester === semester ||
        curriculumNames.some((name) => semesterSubjectMatch(l.subject, name)),
    );
  }, [lectures, semester]);

  const isMine = (subject: string) => mySubjects.some((m) => subjectsMatch(subject, m.name));

  const subjects = useMemo(() => {
    const set = new Set(bySemester.map((l) => l.subject));
    const arr = Array.from(set);
    arr.sort((a, b) => {
      const am = isMine(a) ? 0 : 1;
      const bm = isMine(b) ? 0 : 1;
      return am - bm || a.localeCompare(b);
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bySemester, mySubjects]);

  // Playlist matches while searching (title / subject / channel).
  // After the student picks a semester, playlist results come from the
  // filtered list only; before that, search covers the whole catalog.
  const playlistMatches = useMemo(() => {
    if (!searching) return [];
    const q = debouncedQuery.toLowerCase();
    const base = semesterChosen ? bySemester : lectures;
    return base.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.subject.toLowerCase().includes(q) ||
        l.channel.toLowerCase().includes(q),
    );
  }, [searching, debouncedQuery, lectures, bySemester, semesterChosen]);

  const visible = useMemo(() => {
    if (activeSubject === "All") return bySemester;
    return bySemester.filter((l) => l.subject === activeSubject);
  }, [bySemester, activeSubject]);

  const grouped = useMemo(() => {
    const map = new Map<string, Lecture[]>();
    visible.forEach((l) => {
      const arr = map.get(l.subject) || [];
      arr.push(l);
      map.set(l.subject, arr);
    });
    return Array.from(map.entries()).sort((a, b) => {
      const am = isMine(a[0]) ? 0 : 1;
      const bm = isMine(b[0]) ? 0 : 1;
      return am - bm || a[0].localeCompare(b[0]);
    });
  }, [visible, mySubjects]);

  // "Mere Subjects" view: the student's own selected subjects, grouped by
  // the semester THEY placed them in, each with its catalog playlists.
  const mineGrouped = useMemo(() => {
    const semMap = new Map<string, { semester: number | null; subjects: { name: string; items: Lecture[] }[] }>();
    const sorted = [...mySubjects].sort(
      (a, b) => (a.semester ?? 99) - (b.semester ?? 99) || a.name.localeCompare(b.name),
    );
    for (const m of sorted) {
      const key = String(m.semester ?? "none");
      if (!semMap.has(key)) semMap.set(key, { semester: m.semester, subjects: [] });
      const items = lectures.filter((l) => subjectsMatch(l.subject, m.name));
      semMap.get(key)!.subjects.push({ name: items[0]?.subject || m.name, items });
    }
    return Array.from(semMap.values());
  }, [mySubjects, lectures]);

  const pickSemester = (s: number | "all") => {
    semesterTouched.current = true;
    setSemesterChosen(s !== "all");
    setSemester(s);
    setActiveSubject("All");
    setPlayingId(null);
  };

  // While the student is in the "My Subjects" view and has not picked a
  // semester yet, the semester bar shows "All" (that view lists every
  // semester). Picking a semester switches to the filtered grid below.
  const barSemester: number | "all" =
    view === "mine" && !semesterChosen ? "all" : semester;

  // badgeSemester: when a semester filter is active, callers pass the
  // SELECTED semester so every card in the filtered grid presents that
  // semester (the context being browsed) instead of the playlist's own
  // home-semester tag. Omitted (undefined) → the card keeps its own tag.
  const renderPlaylistCard = (lec: Lecture, i: number, badgeSemester?: number) => {
    const badgeSem = badgeSemester ?? lec.semester;
    const playing = playingId === `pl-${lec.id}`;
    const activeVideo = watchVideo?.lectureId === lec.id ? watchVideo.videoId : null;
    const total = lec.video_count || 0;
    const watchedCount = Math.min((progress[lec.id] || []).length, total || (progress[lec.id] || []).length);
    const showThumb = lec.thumb_video_id && !brokenThumbs.has(lec.id);
    const pct = total > 0 ? (watchedCount / total) * 100 : 0;
    // Compact horizontal card while browsing; the inline player takes
    // the full card width while something is playing.
    const isPlayingLayout = playing || !!activeVideo;
    return (
      <motion.div
        key={lec.id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(i * 0.04, 0.3) }}
        className={`glass rounded-2xl border border-border overflow-hidden flex ${isPlayingLayout ? "flex-col" : "flex-row"}`}
      >
        {activeVideo ? (
          <div className="aspect-video w-full bg-black">
            <iframe
              src={videoEmbedUrl(activeVideo)}
              title={lec.title}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : playing ? (
          <div className="aspect-video w-full bg-black">
            <iframe
              src={playlistEmbedUrl(lec.playlist_id)}
              title={lec.title}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <button
            onClick={() => { setWatchVideo(null); setPlayingId(`pl-${lec.id}`); }}
            className="relative w-[7.5rem] sm:w-44 shrink-0 self-start aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-red-500/15 via-muted/40 to-primary/10 group block m-3 mr-0 sm:m-4 sm:mr-0"
          >
            {showThumb && (
              <img
                src={thumbUrl(lec.thumb_video_id!)}
                alt={lec.title}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setBrokenThumbs((prev) => new Set(prev).add(lec.id))}
              />
            )}
            <span className="absolute inset-0 bg-black/25 group-hover:bg-black/35 transition-colors" />
            <PlayCircle className="w-10 h-10 text-white drop-shadow-lg absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 group-hover:scale-110 transition-transform" />
            <span className="absolute top-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-black/60 text-white max-w-[55%] truncate">
              {lec.subject}
            </span>
            {badgeSem ? (
              <span className="absolute top-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-black/60 text-white">
                Sem {badgeSem}
              </span>
            ) : null}
            <span className="absolute bottom-1.5 right-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-black/60 text-white flex items-center gap-1">
              <Youtube className="w-3 h-3 text-red-500" /> Playlist
            </span>
          </button>
        )}
        <div className="p-3 sm:p-4 flex flex-col gap-1.5 flex-1 min-w-0">
          <h3 className="font-semibold leading-snug text-sm line-clamp-2">{lec.title}</h3>
          <p className="text-xs text-muted-foreground truncate">{lec.channel} • Full playlist • YouTube</p>
          {lec.language && (
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 border border-primary/25 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Languages className="w-3 h-3" /> {lec.language}
            </span>
          )}
          {total > 0 && watchedCount > 0 && (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full gradient-primary rounded-full transition-all"
                  style={{ width: `max(14px, ${pct}%)` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {watchedCount}/{total} watched
                {watchedCount >= total ? " — playlist complete!" : ""}
                {pct > 0 && pct < 5 ? " · just started" : ""}
              </p>
            </div>
          )}
          {/* Exactly ONE primary action (Watch). Resume / Videos /
              YouTube stay available as quiet ghost actions so no
              working flow is lost. */}
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1.5">
            <Button
              size="sm"
              className="rounded-xl flex-1 min-w-[7rem]"
              variant={playing || activeVideo ? "secondary" : "default"}
              onClick={() => {
                if (activeVideo) setWatchVideo(null);
                else setPlayingId(playing ? null : `pl-${lec.id}`);
              }}
            >
              <MonitorPlay className="w-4 h-4 mr-1.5" />
              {playing || activeVideo ? "Close" : "Watch here"}
            </Button>
            {total > 0 && watchedCount > 0 && watchedCount < total && (
              <Button size="sm" variant="ghost" className="rounded-xl text-muted-foreground hover:text-foreground px-2" onClick={() => resumeLecture(lec)}>
                <Play className="w-4 h-4 mr-1" /> Resume
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="rounded-xl text-muted-foreground hover:text-foreground px-2"
              onClick={() => {
                if (expandedId === lec.id) setExpandedId(null);
                else {
                  setExpandedId(lec.id);
                  loadList(lec.id);
                }
              }}
            >
              <ListVideo className="w-4 h-4 mr-1" /> Videos
            </Button>
            <Button size="sm" variant="ghost" className="rounded-xl text-muted-foreground hover:text-foreground px-2" asChild>
              <a href={playlistWatchUrl(lec.playlist_id)} target="_blank" rel="noreferrer">
                <ExternalLink className="w-4 h-4 mr-1" />
                YouTube
              </a>
            </Button>
          </div>
          {expandedId === lec.id && (
            <div className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-border/60 divide-y divide-border/50">
              {!listVideos[lec.id] ? (
                <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading videos…
                </div>
              ) : (
                listVideos[lec.id].map((v) => {
                  const w = (progress[lec.id] || []).includes(v.video_id);
                  return (
                    <div key={v.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40">
                      <button
                        onClick={() => playListVideo(lec, v)}
                        className="flex items-center gap-2 flex-1 text-left min-w-0"
                      >
                        <Play className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        <span className={`truncate ${w ? "text-muted-foreground" : ""}`}>
                          {v.position + 1}. {v.title}
                        </span>
                      </button>
                      <button
                        onClick={() => setWatched(lec.id, v.video_id, !w)}
                        title={w ? "Remove from watched" : "Mark as watched"}
                        className="shrink-0"
                      >
                        {w ? (
                          <CheckCircle2 className="w-5 h-5 text-primary" />
                        ) : (
                          <Circle className="w-5 h-5 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  const renderVideoCard = (hit: VideoHit, i: number) => {
    const playing = playingId === `vid-${hit.id}`;
    const showThumb = !brokenThumbs.has(hit.id);
    return (
      <motion.div
        key={hit.id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(i * 0.03, 0.3) }}
        className={`glass rounded-2xl border border-border overflow-hidden flex ${playing ? "flex-col" : "flex-row"}`}
      >
        {playing ? (
          <div className="aspect-video w-full bg-black">
            <iframe
              src={videoEmbedUrl(hit.video_id)}
              title={hit.title}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <button
            onClick={() => { setPlayingId(`vid-${hit.id}`); if (hit.lecture?.id) setWatched(hit.lecture.id, hit.video_id, true); }}
            className="relative w-[7.5rem] sm:w-44 shrink-0 self-start aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-red-500/15 via-muted/40 to-primary/10 group block m-3 mr-0 sm:m-4 sm:mr-0"
          >
            {showThumb && (
              <img
                src={thumbUrl(hit.video_id)}
                alt={hit.title}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setBrokenThumbs((prev) => new Set(prev).add(hit.id))}
              />
            )}
            <span className="absolute inset-0 bg-black/25 group-hover:bg-black/35 transition-colors" />
            <PlayCircle className="w-10 h-10 text-white drop-shadow-lg absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 group-hover:scale-110 transition-transform" />
            {hit.lecture?.subject && (
              <span className="absolute top-1.5 left-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-black/60 text-white max-w-[90%] truncate">
                {hit.lecture.subject}
              </span>
            )}
          </button>
        )}
        <div className="p-3 sm:p-4 flex flex-col gap-1.5 flex-1 min-w-0">
          <h3 className="font-semibold leading-snug text-sm line-clamp-2">{hit.title}</h3>
          <p className="text-xs text-muted-foreground truncate">
            {hit.lecture?.channel}
            {hit.lecture?.semester ? ` • Semester ${hit.lecture.semester}` : ""}
          </p>
          <div className="mt-auto flex items-center gap-1.5 pt-1.5">
            <Button
              size="sm"
              className="rounded-xl flex-1 min-w-[7rem]"
              variant={playing ? "secondary" : "default"}
              onClick={() => { if (!playing && hit.lecture?.id) setWatched(hit.lecture.id, hit.video_id, true); setPlayingId(playing ? null : `vid-${hit.id}`); }}
            >
              <MonitorPlay className="w-4 h-4 mr-1.5" />
              {playing ? "Close" : "Watch here"}
            </Button>
            <Button size="sm" variant="ghost" className="rounded-xl text-muted-foreground hover:text-foreground px-2" asChild>
              <a href={videoWatchUrl(hit.video_id)} target="_blank" rel="noreferrer">
                <ExternalLink className="w-4 h-4 mr-1" />
                YouTube
              </a>
            </Button>
          </div>
        </div>
      </motion.div>
    );
  };

  // SEO (Full SEO program): Course ItemList built from the live playlists.
  const lecturesJsonLd = lectures.length
    ? {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "UniGenius AI — Video Lectures by Subject",
        numberOfItems: lectures.length,
        itemListElement: lectures.slice(0, 50).map((l, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "Course",
            name: l.title,
            description: `${l.subject} video lecture playlist by ${l.channel}, curated on UniGenius AI.`,
            provider: { "@type": "Organization", name: "UniGenius AI", sameAs: "https://unigenius.vercel.app/" },
          },
        })),
      }
    : undefined;

  return (
    <PageShell
      title="Lectures"
      seoTitle="Free Video Lectures for CS, SE & AI Students — UniGenius AI"
      seoDescription="Watch 100+ curated video lecture playlists for every subject and semester — Programming, OOP, Data Structures, DLD, Databases and more, in Urdu/Hindi and English."
      seoPath="/lectures"
      seoJsonLd={lecturesJsonLd}
      subtitle="The best YouTube lectures for every subject of every semester — search any topic and find the video right here."
      icon={
        <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
          <Youtube className="w-5 h-5 text-red-500" />
        </div>
      }
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPlayingId(null);
            }}
            placeholder="Search any topic — derivative, k-map, loops, pointers…"
            className="pl-9 rounded-xl"
          />
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          Catalog: {lectures.length} playlists
          {videoTotal !== null ? ` • ${videoTotal.toLocaleString()} videos` : ""} — search works on every
          video title, just like YouTube.
        </p>

        {searching ? (
          <div className="space-y-8">
            {playlistMatches.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-base font-semibold">
                  Playlists{" "}
                  <span className="text-xs font-medium text-muted-foreground">
                    {playlistMatches.length} found
                  </span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {playlistMatches.map((lec, i) =>
                    renderPlaylistCard(
                      lec,
                      i,
                      semesterChosen && semester !== "all" ? semester : undefined,
                    ),
                  )}
                </div>
              </section>
            )}
            <section className="space-y-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                Videos
                {searchingVideos ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">
                    {videoHits.length} found{videoHits.length >= 60 ? " (first 60)" : ""}
                  </span>
                )}
              </h2>
              {!searchingVideos && videoHits.length === 0 ? (
                <div className="glass rounded-2xl border border-border p-8 text-center text-muted-foreground">
                  No video found for "{debouncedQuery}" — check the spelling or try another word
                  (for example, just "derivative").
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {videoHits.map((hit, i) => renderVideoCard(hit, i))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <>
            {/* View toggle: student's own subjects vs full catalog —
                one segmented pill track, gradient active segment. */}
            {user && mySubjects.length > 0 && (
              <div className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
                <button
                  onClick={() => { viewTouched.current = true; setView("mine"); setSemesterChosen(false); setPlayingId(null); }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    view === "mine" && !semesterChosen
                      ? "gradient-button text-primary-foreground shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  My Subjects
                </button>
                <button
                  onClick={() => { viewTouched.current = true; setView("browse"); setPlayingId(null); }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    view === "browse" || semesterChosen
                      ? "gradient-button text-primary-foreground shadow"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  All Lectures
                </button>
              </div>
            )}

            {/* Semester filter — visible in BOTH views. It used to live
                only inside the catalog view, while the page opens in the
                "My Subjects" view for signed-in students — and that view
                (mineGrouped) never reads the semester at all, so picking
                Semester 8 changed nothing there. Now picking a semester
                always switches to the filtered catalog grid below. */}
            <div className="flex flex-nowrap items-center gap-2 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-1 shrink-0">
                Semester
              </span>
              {["all", ...semesters].map((s) => (
                <button
                  key={String(s)}
                  onClick={() => pickSemester(s as number | "all")}
                  className={`px-3.5 py-1.5 rounded-full text-sm border transition-colors shrink-0 whitespace-nowrap ${
                    barSemester === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border bg-muted/30 hover:bg-muted/60"
                  }`}
                >
                  {s === "all" ? "All" : `Semester ${s}`}
                </button>
              ))}
            </div>

            {view === "mine" && mySubjects.length > 0 && !semesterChosen ? (
              loading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading lectures…
                </div>
              ) : (
                <div className="space-y-10">
                  <p className="-mt-2 text-xs text-muted-foreground">
                    These lectures match your own subjects. To change them, update{" "}
                    <a href="/my-subjects" className="underline font-medium text-foreground">
                      My Subjects
                    </a>{" "}
                    — the lectures will update automatically.
                  </p>
                  {mineGrouped.map(({ semester: sem, subjects: subs }) => (
                    <div key={String(sem)} className="space-y-6">
                      <h2 className="text-lg font-bold">
                        {sem ? `Semester ${sem}` : "Your Subjects"}{" "}
                        <span className="text-xs font-medium text-muted-foreground">your selection</span>
                      </h2>
                      {subs.map(({ name, items }) => (
                        <section key={name} className="space-y-3">
                          <h3 className="text-base font-semibold flex items-center gap-2">
                            {name}
                            {items.length > 0 && (
                              <span className="text-xs font-medium text-muted-foreground">
                                {items.length} playlist{items.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </h3>
                          {items.length === 0 ? (
                            <div className="glass rounded-2xl border border-border p-5 flex items-start gap-3">
                              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                <MonitorPlay className="w-5 h-5 text-primary" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">Lectures for this subject are coming soon.</p>
                                <p className="text-xs text-muted-foreground mt-0.5">New playlists are added regularly — please check back soon.</p>
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {items.map((lec, i) => renderPlaylistCard(lec, i))}
                            </div>
                          )}
                        </section>
                      ))}
                    </div>
                  ))}
                </div>
              )
            ) : (
            <>
            {/* Subject filter */}
            <div className="flex flex-wrap gap-2">
              {["All", ...subjects].map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setActiveSubject(s);
                    setPlayingId(null);
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-sm border transition-colors ${
                    activeSubject === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border bg-muted/30 hover:bg-muted/60"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {!loading && (
              <p className="text-xs text-muted-foreground">
                Showing {visible.length} playlist{visible.length !== 1 ? "s" : ""}
                {semester !== "all" ? ` for Semester ${semester}` : " for all semesters"}
                {activeSubject !== "All" ? ` in ${activeSubject}` : ""}.
              </p>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading lectures…
              </div>
            ) : visible.length === 0 ? (
              <div className="glass rounded-2xl border border-border p-6 flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <MonitorPlay className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Lectures for this selection are coming soon.</p>
                  <p className="text-xs text-muted-foreground mt-0.5">New playlists are added regularly — please check back soon.</p>
                </div>
              </div>
            ) : (
              grouped.map(([subject, items]) => (
                <section key={subject} className="space-y-3">
                  <h2 className="text-base font-semibold flex items-center gap-2">
                    {subject}
                    <span className="text-xs font-medium text-muted-foreground">
                      {items.length} playlist{items.length > 1 ? "s" : ""}
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {items.map((lec, i) =>
                      renderPlaylistCard(lec, i, semester !== "all" ? semester : undefined),
                    )}
                  </div>
                </section>
              ))
            )}
            </>
            )}
          </>
        )}

        <p className="text-xs text-muted-foreground text-center pb-4">
          All lectures are embedded from their original creators' YouTube channels — the rights belong to them. If you need lectures for a subject that is not here, let support know.
        </p>
      </div>
    </PageShell>
  );
};

export default LecturesPage;
