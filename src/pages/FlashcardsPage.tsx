import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Sparkles, RotateCcw, ChevronLeft, ChevronRight, Trash2, Upload, PenLine, Plus, X, Save, Clock, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartment } from "@/contexts/DepartmentContext";
import { getSubjects } from "@/data/subjects";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Flashcard {
  front: string;
  back: string;
}

interface FlashcardSet {
  id: string;
  subject: string;
  title: string;
  cards: Flashcard[];
  created_at: string;
}

interface FlashcardReview {
  set_id: string;
  card_index: number;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review: string; // YYYY-MM-DD
  last_grade: string | null;
}

// Local-date helpers (YYYY-MM-DD strings compare correctly lexicographically)
const toDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayStr = () => toDateStr(new Date());
const addDaysStr = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateStr(d);
};

const FlashcardsPage = () => {
  const { user } = useAuth();
  const { department } = useDepartment();
  const [semester, setSemester] = useState(1);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("current_semester").eq("user_id", user.id).single()
      .then(({ data }) => { if (data?.current_semester) setSemester(data.current_semester); });
  }, [user]);

  const subjects = getSubjects(department, semester);

  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [activeSet, setActiveSet] = useState<FlashcardSet | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // SRS (spaced repetition) state
  const [reviews, setReviews] = useState<FlashcardReview[]>([]);
  const [sessionOrder, setSessionOrder] = useState<number[]>([]);
  const [grading, setGrading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [uploadedContent, setUploadedContent] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  // Binary uploads (PDF / images) are sent to the edge function as a data
  // URL and read by Gemini directly — the file's real content is the source.
  const [uploadFileData, setUploadFileData] = useState<{ dataUrl: string; type: string; name: string } | null>(null);

  // Manual deck creation
  const [manualTitle, setManualTitle] = useState("");
  const [manualCards, setManualCards] = useState<Flashcard[]>([{ front: "", back: "" }]);
  const [savingManual, setSavingManual] = useState(false);

  const fetchSets = async () => {
    if (!user) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("flashcard_sets")
      .select("*")
      .eq("user_id", user.id)
      .eq("semester", semester)
      .order("created_at", { ascending: false });
    if (!error && data) {
      setSets(data.map(d => ({ ...d, cards: (d.cards as any) || [] })) as FlashcardSet[]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchSets(); }, [user, semester]);

  const fetchReviews = async () => {
    if (!user) return;
    const { data, error } = await (supabase.from("flashcard_reviews" as any) as any)
      .select("*")
      .eq("user_id", user.id);
    if (!error && data) setReviews(data as FlashcardReview[]);
  };

  useEffect(() => { fetchReviews(); }, [user]);

  // ---- SRS helpers ----
  const reviewFor = (setId: string, idx: number) =>
    reviews.find(r => r.set_id === setId && r.card_index === idx);

  // A card is due if it has never been reviewed, or its next_review is today/past.
  const isDue = (setId: string, idx: number) => {
    const r = reviewFor(setId, idx);
    return !r || r.next_review <= todayStr();
  };

  const dueCountFor = (set: FlashcardSet) =>
    set.cards.reduce((n, _, i) => n + (isDue(set.id, i) ? 1 : 0), 0);

  const totalDue = sets.reduce((n, s) => n + dueCountFor(s), 0);

  // Next scheduled review, derived from the real review rows: the
  // earliest next_review still in the future. Null = nothing scheduled.
  const nextScheduledReview = reviews
    .filter((r) => r.next_review > todayStr())
    .sort((a, b) => a.next_review.localeCompare(b.next_review))[0]?.next_review ?? null;

  // Open a study session. With dueFirst, due cards come first in the order.
  const openSet = (set: FlashcardSet, dueFirst = false) => {
    const indices = set.cards.map((_, i) => i);
    if (dueFirst) {
      const due = indices.filter(i => isDue(set.id, i));
      const rest = indices.filter(i => !isDue(set.id, i));
      setSessionOrder([...due, ...rest]);
    } else {
      setSessionOrder(indices);
    }
    setActiveSet(set);
    setCardIndex(0);
    setFlipped(false);
  };

  // SM-2-lite grading: writes/updates the card's flashcard_reviews row.
  const gradeCard = async (grade: "again" | "good" | "easy") => {
    if (!user || !activeSet || grading) return;
    const actualIndex = sessionOrder.length ? (sessionOrder[cardIndex] ?? cardIndex) : cardIndex;
    const existing = reviewFor(activeSet.id, actualIndex);
    const ease = existing ? Number(existing.ease_factor) : 2.5;
    const interval = existing ? existing.interval_days : 0;
    const reps = existing ? existing.repetitions : 0;

    let newEase = ease;
    let newInterval = 0;
    let newReps = reps;
    if (grade === "again") {
      newReps = 0;
      newInterval = 0; // due again today — relearn now, not tomorrow
      newEase = Math.max(1.3, ease - 0.2);
    } else if (grade === "good") {
      newInterval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease);
      newReps = reps + 1;
    } else {
      // easy
      newInterval = reps === 0 ? 4 : Math.round(interval * ease * 1.3);
      newEase = ease + 0.15;
      newReps = reps + 1;
    }
    const nextReview = addDaysStr(newInterval);

    setGrading(true);
    const { error } = await (supabase.from("flashcard_reviews" as any) as any).upsert(
      {
        user_id: user.id,
        set_id: activeSet.id,
        card_index: actualIndex,
        ease_factor: newEase,
        interval_days: newInterval,
        repetitions: newReps,
        next_review: nextReview,
        last_grade: grade,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,set_id,card_index" }
    );
    setGrading(false);
    if (error) {
      toast.error("Could not save your review progress");
      return;
    }
    setReviews(prev => [
      ...prev.filter(r => !(r.set_id === activeSet.id && r.card_index === actualIndex)),
      {
        set_id: activeSet.id,
        card_index: actualIndex,
        ease_factor: newEase,
        interval_days: newInterval,
        repetitions: newReps,
        next_review: nextReview,
        last_grade: grade,
      },
    ]);
    // Advance to the next card in the session
    setFlipped(false);
    setCardIndex(prev => (prev + 1) % activeSet.cards.length);
  };

  const handleFileRead = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large! Max 10MB.");
      return;
    }
    setUploadFile(file);
    if (file.type === "text/plain" || file.name.endsWith(".md") || file.name.endsWith(".txt")) {
      // Plain text: extract the content client-side and send it as text.
      const text = await file.text();
      setUploadedContent(text);
      setUploadFileData(null);
    } else {
      // PDF / image: keep the file itself (base64) — the generate-flashcards
      // function passes it to Gemini, which reads the actual document.
      const reader = new FileReader();
      reader.onload = () => {
        setUploadFileData({ dataUrl: reader.result as string, type: file.type, name: file.name });
        setUploadedContent("");
      };
      reader.onerror = () => toast.error("Could not read that file");
      reader.readAsDataURL(file);
    }
  };

  const generateFlashcards = async () => {
    if (!selectedSubject || !user) { toast.error("Select a subject first"); return; }
    setGenerating(true);
    try {
      const body: any = { subject: selectedSubject, count: 12 };
      if (uploadFileData) {
        body.fileData = uploadFileData.dataUrl;
        body.fileType = uploadFileData.type;
        body.fileName = uploadFileData.name;
      } else if (uploadedContent) {
        body.content = uploadedContent;
      }
      const { data, error } = await supabase.functions.invoke("generate-flashcards", { body });

      if (error) throw error;
      const cards: Flashcard[] = data?.cards || [];
      if (cards.length === 0) { toast.error("No flashcards generated"); return; }

      const { data: saved, error: saveErr } = await supabase.from("flashcard_sets").insert({
        user_id: user.id,
        subject: selectedSubject,
        semester,
        title: `${selectedSubject} — ${uploadFile ? "From " + uploadFile.name : "AI Generated"}`,
        cards: cards as any,
        source_type: (uploadedContent || uploadFileData) ? "uploaded_material" : "ai_generated",
      }).select().single();

      if (saveErr) throw saveErr;
      const newSet = { ...saved, cards } as FlashcardSet;
      setSets(prev => [newSet, ...prev]);
      openSet(newSet);
      toast.success(`${cards.length} flashcards generated!`);
    } catch (e: any) {
      toast.error(e.message || "Generation failed");
    } finally {
      setGenerating(false);
      setUploadedContent("");
      setUploadFile(null);
      setUploadFileData(null);
    }
  };

  const saveManualDeck = async () => {
    if (!user) { toast.error("Login to save a deck"); return; }
    if (!selectedSubject) { toast.error("Select a subject first"); return; }
    const cards = manualCards
      .map(c => ({ front: c.front.trim(), back: c.back.trim() }))
      .filter(c => c.front && c.back);
    if (cards.length === 0) { toast.error("Add at least one card with both sides filled"); return; }
    setSavingManual(true);
    try {
      const { data: saved, error } = await supabase.from("flashcard_sets").insert({
        user_id: user.id,
        subject: selectedSubject,
        semester,
        title: manualTitle.trim() || `${selectedSubject} — My Deck`,
        cards: cards as any,
        source_type: "manual",
      }).select().single();
      if (error) throw error;
      const newSet = { ...saved, cards } as FlashcardSet;
      setSets(prev => [newSet, ...prev]);
      setManualTitle("");
      setManualCards([{ front: "", back: "" }]);
      toast.success(`Deck saved with ${cards.length} card${cards.length > 1 ? "s" : ""}!`);
    } catch (e: any) {
      toast.error(e.message || "Could not save deck");
    } finally {
      setSavingManual(false);
    }
  };

  const deleteSet = async (id: string) => {
    await supabase.from("flashcard_sets").delete().eq("id", id);
    setSets(prev => prev.filter(s => s.id !== id));
    setReviews(prev => prev.filter(r => r.set_id !== id));
    if (activeSet?.id === id) { setActiveSet(null); setSessionOrder([]); }
    toast.success("Set deleted");
  };

  const nextCard = () => {
    if (!activeSet) return;
    setFlipped(false);
    setCardIndex(prev => (prev + 1) % activeSet.cards.length);
  };

  const prevCard = () => {
    if (!activeSet) return;
    setFlipped(false);
    setCardIndex(prev => (prev - 1 + activeSet.cards.length) % activeSet.cards.length);
  };

  if (activeSet) {
    const actualIndex = sessionOrder.length ? (sessionOrder[cardIndex] ?? cardIndex) : cardIndex;
    const card = activeSet.cards[actualIndex];
    const currentReview = reviewFor(activeSet.id, actualIndex);
    const dueInSet = dueCountFor(activeSet);
    return (
      <PageShell
        title="Flashcards"
        subtitle={activeSet.subject}
        icon={<div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center"><BookOpen className="w-5 h-5 text-primary" /></div>}
      >
        <div className="max-w-lg mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => { setActiveSet(null); setCardIndex(0); setSessionOrder([]); fetchReviews(); }}>
              ← Back to sets
            </Button>
            <span className="text-sm text-muted-foreground">{cardIndex + 1} / {activeSet.cards.length}</span>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            {dueInSet > 0 && (
              <span className="rounded-full bg-primary/15 text-primary px-2.5 py-1 font-medium">
                {dueInSet} due in this set
              </span>
            )}
            <span>
              {!currentReview
                ? "New card"
                : currentReview.next_review <= todayStr()
                  ? "Due for review"
                  : `Next review ${new Date(currentReview.next_review + "T00:00:00").toLocaleDateString()}`}
            </span>
          </div>

          <div className="cursor-pointer" onClick={() => setFlipped(!flipped)} style={{ perspective: "1000px" }}>
            <motion.div
              animate={{ rotateY: flipped ? 180 : 0 }}
              transition={{ duration: 0.5 }}
              style={{ transformStyle: "preserve-3d" }}
              className="relative w-full h-64"
            >
              <div className="absolute inset-0 glass rounded-2xl border border-border/30 p-8 flex items-center justify-center" style={{ backfaceVisibility: "hidden" }}>
                <div className="text-center space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Question</p>
                  <p className="font-display font-semibold text-lg text-foreground">{card?.front}</p>
                  <p className="text-xs text-muted-foreground mt-4">Tap to reveal</p>
                </div>
              </div>
              <div className="absolute inset-0 glass rounded-2xl border border-primary/30 bg-primary/5 p-8 flex items-center justify-center" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                <div className="text-center space-y-2">
                  <p className="text-xs text-primary uppercase tracking-wider">Answer</p>
                  <p className="text-sm text-foreground leading-relaxed">{card?.back}</p>
                </div>
              </div>
            </motion.div>
          </div>

          <AnimatePresence>
            {flipped && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="space-y-2"
              >
                <p className="text-center text-xs text-muted-foreground">How well did you know this?</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 rounded-xl border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                    onClick={() => gradeCard("again")}
                    disabled={grading}
                  >
                    Again
                  </Button>
                  <Button
                    className="flex-1 rounded-xl"
                    onClick={() => gradeCard("good")}
                    disabled={grading}
                  >
                    Good
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 rounded-xl border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-500"
                    onClick={() => gradeCard("easy")}
                    disabled={grading}
                  >
                    Easy
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-center gap-4">
            <Button variant="outline" size="icon" className="rounded-xl" onClick={prevCard}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="rounded-xl" onClick={() => setFlipped(false)}>
              <RotateCcw className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" className="rounded-xl" onClick={nextCard}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Quick Revision"
      subtitle="AI Flashcards from your materials"
      icon={<div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center"><BookOpen className="w-5 h-5 text-primary" /></div>}
    >
      <div className="space-y-6 pb-24">
        {/* Due for Review is ALWAYS rendered — even with no sets and no
            reviews yet — so the spaced-repetition feature stays visible
            and discoverable. Previously it only appeared when
            totalDue > 0, which hid it completely from new users. */}
        <div className="glass rounded-2xl p-6 border border-primary/30 space-y-3">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> Due for Review
          </h3>
          {/* Stat-led: the real due count up front. */}
          <div className="flex items-end gap-2">
            <span className="font-display font-bold text-4xl leading-none text-foreground">{totalDue}</span>
            <span className="text-sm text-muted-foreground pb-0.5">card{totalDue !== 1 ? "s" : ""} due today</span>
          </div>
          {totalDue > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{totalDue}</span> card{totalDue !== 1 ? "s" : ""} due for review
                across {sets.filter(s => dueCountFor(s) > 0).length} set{sets.filter(s => dueCountFor(s) > 0).length !== 1 ? "s" : ""}.
                Spaced repetition brings cards back right before you forget them — tap a set to review its due cards first.
              </p>
              <div className="flex flex-wrap gap-2">
                {sets.filter(s => dueCountFor(s) > 0).map(s => (
                  <Button
                    key={s.id}
                    variant="outline"
                    className="rounded-xl gap-2"
                    onClick={() => openSet(s, true)}
                  >
                    <span className="max-w-[180px] truncate">{s.title}</span>
                    <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 text-xs font-medium">
                      {dueCountFor(s)} due
                    </span>
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No cards are due yet. Review a set and your schedule will appear here.
              </p>
              {!nextScheduledReview && (
                <div className="flex items-center gap-2 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>Next review — nothing scheduled</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="glass rounded-2xl p-6 border border-border/30 space-y-4">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Generate Flashcards
          </h3>
          <p className="text-sm text-muted-foreground">Upload your lab manual, notes, or any study material. AI will extract key concepts into flashcards.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <Select value={selectedSubject} onValueChange={setSelectedSubject}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select subject" /></SelectTrigger>
              <SelectContent>
                {subjects.map(s => <SelectItem key={s.id} value={s.name}>{s.icon} {s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 min-w-0">
              <label className="flex-1 cursor-pointer min-w-0">
                <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3 text-center hover:border-primary/70 transition-colors">
                  <Upload className="w-4 h-4 mx-auto mb-1 text-primary" />
                  <p className="text-xs text-muted-foreground break-words">{uploadFile ? uploadFile.name : "Upload material (optional)"}</p>
                </div>
                <input type="file" className="hidden" accept=".txt,.md,.pdf,.jpg,.jpeg,.png,.webp" onChange={e => e.target.files?.[0] && handleFileRead(e.target.files[0])} />
              </label>
            </div>
          </div>
          <div className="space-y-1.5">
            <Button onClick={generateFlashcards} disabled={!selectedSubject || !user || generating} className="rounded-xl gap-2 disabled:opacity-50">
              <Sparkles className="w-4 h-4" /> {generating ? "Generating..." : "Generate Flashcards"}
            </Button>
            {!selectedSubject && (
              <p className="text-xs text-muted-foreground">Select a subject first</p>
            )}
          </div>
        </div>

        {/* Manual deck creation */}
        <div className="glass rounded-2xl p-6 border border-border/30 space-y-4">
          <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
            <PenLine className="w-4 h-4 text-primary" /> Create a Deck Yourself
          </h3>
          <p className="text-sm text-muted-foreground">Name a deck, write your own cards, and study them right alongside your AI decks. Uses the subject selected above.</p>
          <Input
            placeholder="Deck title (e.g., OOP — Exam Revision)"
            value={manualTitle}
            onChange={e => setManualTitle(e.target.value)}
            className="rounded-xl"
          />
          <div className="space-y-3">
            {manualCards.map((card, i) => (
              <div key={i} className="flex flex-col sm:flex-row gap-2 sm:items-start">
                <span className="text-xs text-muted-foreground font-medium sm:w-6 sm:pt-3 sm:text-center flex-shrink-0">Card {i + 1}</span>
                <Input
                  placeholder="Front — question or term"
                  value={card.front}
                  onChange={e => {
                    const next = [...manualCards];
                    next[i] = { ...next[i], front: e.target.value };
                    setManualCards(next);
                  }}
                  className="rounded-xl flex-1 w-full min-w-0"
                />
                <Textarea
                  placeholder="Back — answer or definition"
                  value={card.back}
                  onChange={e => {
                    const next = [...manualCards];
                    next[i] = { ...next[i], back: e.target.value };
                    setManualCards(next);
                  }}
                  rows={1}
                  className="rounded-xl flex-1 w-full min-w-0 resize-y"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg flex-shrink-0 self-end sm:self-auto"
                  disabled={manualCards.length === 1}
                  onClick={() => setManualCards(prev => prev.filter((_, idx) => idx !== i))}
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              className="rounded-xl gap-2"
              onClick={() => setManualCards(prev => [...prev, { front: "", back: "" }])}
            >
              <Plus className="w-4 h-4" /> Add Card
            </Button>
            <Button onClick={saveManualDeck} disabled={!user || savingManual} className="rounded-xl gap-2">
              <Save className="w-4 h-4" /> {savingManual ? "Saving..." : "Save Deck"}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
        ) : sets.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
              <Layers className="w-7 h-7 text-primary" />
            </div>
            <p className="text-muted-foreground">No flashcard sets yet. Generate your first set above!</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sets.map(set => (
              <motion.div
                key={set.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass rounded-2xl p-5 border border-border/30 space-y-3 cursor-pointer hover:border-primary/30 transition-colors group"
                onClick={() => openSet(set, dueCountFor(set) > 0)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium text-sm text-foreground">{set.subject}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{set.title}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100"
                    onClick={e => { e.stopPropagation(); deleteSet(set.id); }}
                  >
                    <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> {set.cards.length} cards</span>
                  <span>•</span>
                  <span>{new Date(set.created_at).toLocaleDateString()}</span>
                  {dueCountFor(set) > 0 && (
                    <>
                      <span>•</span>
                      <span className="rounded-full bg-primary/15 text-primary px-2 py-0.5 font-medium">
                        {dueCountFor(set)} due
                      </span>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
};

export default FlashcardsPage;
