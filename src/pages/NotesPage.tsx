import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { FileUp, Download, ThumbsUp, FileText, Loader2, Trash2, NotebookPen, Plus, Pencil, Save, X, Eye, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartment } from "@/contexts/DepartmentContext";
import { getSubjects } from "@/data/subjects";
import { useMySubjects } from "@/hooks/use-my-subjects";
import { useCurrentSemester } from "@/hooks/use-current-semester";
import { supabase } from "@/integrations/supabase/client";
import PageShell from "@/components/PageShell";
import SeoIntro from "@/components/SeoIntro";
import FileViewerDialog from "@/components/FileViewerDialog";
import { downloadFile, downloadName, sourceFromTitle, fileKind } from "@/lib/file-delivery";
import { useAppSettings } from "@/contexts/AppSettingsContext";
import { toast } from "sonner";

interface Note {
  id: string;
  title: string;
  subject: string;
  semester: number;
  file_url: string;
  file_name: string;
  upvotes: number;
  user_id: string;
  uploader_name: string;
  created_at: string;
}

interface TextNote {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/** Same normalisation the Practice bank matching uses: case/space/
 *  punctuation-insensitive, parenthetical suffixes ("(DLD)") stripped. */
const normSubject = (s: string) =>
  (s || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, "");

const NotesPage = () => {
  const { user } = useAuth();
  const { settings: appSettings } = useAppSettings();
  const downloadsEnabled = appSettings.features.downloads;
  const { department } = useDepartment();
  const { semester: currentSemester, loaded: semesterLoaded } = useCurrentSemester();

  // ── BROWSE state (Feature #7 + separation refinement, 2026-11-25) ──
  // The marketplace filter is its OWN system: it drives only the browsed
  // list and never touches the upload form (and vice versa). It opens on
  // the student's own current semester with their own subjects.
  const [browseSemester, setBrowseSemester] = useState(1);
  const browseSemesterTouched = useRef(false);
  const [browseSubject, setBrowseSubject] = useState<string>("all");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [userVotes, setUserVotes] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<Note | null>(null);

  useEffect(() => {
    if (semesterLoaded && !browseSemesterTouched.current) setBrowseSemester(currentSemester);
  }, [semesterLoaded, currentSemester]);

  const { subjects: mySubjects } = useMySubjects(browseSemester);
  const browseSubjectNames = mySubjects.map((s) => s.name);

  // ── UPLOAD state (fully independent of the browse filter) ──
  const [uploadSemester, setUploadSemester] = useState(1);
  const uploadSemesterInit = useRef(false);
  const [uploadSubject, setUploadSubject] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (semesterLoaded && !uploadSemesterInit.current) {
      uploadSemesterInit.current = true;
      setUploadSemester(currentSemester);
    }
  }, [semesterLoaded, currentSemester]);

  const uploadSubjects = department ? getSubjects(department, uploadSemester) : [];

  // Personal text notes (user_notes, owner-only)
  const [myNotes, setMyNotes] = useState<TextNote[]>([]);
  const [myNotesLoading, setMyNotesLoading] = useState(true);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  const fetchNotes = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("notes" as any)
      .select("*")
      .eq("semester", browseSemester)
      .order("upvotes", { ascending: false });

    if (data) setNotes(data as any);
    setLoading(false);
  };

  const fetchVotes = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("note_votes" as any)
      .select("note_id")
      .eq("user_id", user.id);
    if (data) setUserVotes(new Set((data as any).map((v: any) => v.note_id)));
  };

  useEffect(() => {
    fetchNotes();
    fetchVotes();
  }, [browseSemester, user]);

  const visibleNotes =
    browseSubject === "all"
      ? notes
      : notes.filter((n) => normSubject(n.subject) === normSubject(browseSubject));

  const fetchMyNotes = async () => {
    if (!user) { setMyNotesLoading(false); return; }
    const { data, error } = await supabase
      .from("user_notes" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (!error && data) setMyNotes(data as any);
    setMyNotesLoading(false);
  };

  useEffect(() => { fetchMyNotes(); }, [user]);

  const saveTextNote = async () => {
    if (!user) { toast.error("Login to save notes"); return; }
    if (!noteTitle.trim() && !noteContent.trim()) { toast.error("Write something first"); return; }
    setSavingNote(true);
    try {
      if (editingNoteId) {
        const { error } = await supabase
          .from("user_notes" as any)
          .update({ title: noteTitle.trim() || "Untitled note", content: noteContent, updated_at: new Date().toISOString() } as any)
          .eq("id", editingNoteId)
          .eq("user_id", user.id);
        if (error) throw error;
        toast.success("Note updated!");
      } else {
        const { error } = await supabase
          .from("user_notes" as any)
          .insert({ user_id: user.id, title: noteTitle.trim() || "Untitled note", content: noteContent } as any);
        if (error) throw error;
        toast.success("Note saved!");
      }
      setNoteTitle("");
      setNoteContent("");
      setEditingNoteId(null);
      fetchMyNotes();
    } catch (e: any) {
      toast.error(e.message || "Could not save note");
    } finally {
      setSavingNote(false);
    }
  };

  const editTextNote = (note: TextNote) => {
    setEditingNoteId(note.id);
    setNoteTitle(note.title);
    setNoteContent(note.content);
  };

  const cancelEdit = () => {
    setEditingNoteId(null);
    setNoteTitle("");
    setNoteContent("");
  };

  const deleteTextNote = async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from("user_notes" as any).delete().eq("id", id).eq("user_id", user.id);
    if (error) { toast.error("Could not delete note"); return; }
    setMyNotes((prev) => prev.filter((n) => n.id !== id));
    if (editingNoteId === id) cancelEdit();
    toast.success("Note deleted");
  };

  const uploadNote = async () => {
    if (!user) return;
    // PDF only — stated up front on the form (D-7); validate here too
    // so a non-PDF picked any other way gets a clear reason, not a
    // generic failure at submit time.
    if (file && !/\.pdf$/i.test(file.name)) {
      toast.error("Only PDF files are supported — please choose a PDF");
      return;
    }
    if (!file || !title.trim() || !uploadSubject) {
      toast.error("Add a title, pick a subject and select a PDF file");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("notes").upload(path, file);
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from("notes").getPublicUrl(path);

      const { error: insertErr } = await supabase.from("notes" as any).insert({
        title: title.trim(),
        subject: uploadSubject,
        semester: uploadSemester,
        file_url: urlData.publicUrl,
        file_name: file.name,
        user_id: user.id,
      } as any);

      if (insertErr) throw insertErr;
      toast.success("Notes uploaded!");
      setTitle("");
      setFile(null);
      setUploadSubject("");
      fetchNotes();
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Toggle upvote (Bug #6C): the RPC returns the NEW state — voting and
  // un-voting both work, and the count comes from the server.
  const upvote = async (noteId: string) => {
    if (!user) { toast.error("Login to upvote"); return; }
    const { data, error } = await supabase.rpc("toggle_note_upvote" as any, { _note_id: noteId } as any);
    if (error) { toast.error("Failed to upvote"); return; }
    const row: any = Array.isArray(data) ? data[0] : data;
    const total = row?.total ?? notes.find((n) => n.id === noteId)!.upvotes;
    const nowVoted = row?.upvoted ?? !userVotes.has(noteId);
    setUserVotes((prev) => {
      const next = new Set(prev);
      if (nowVoted) next.add(noteId); else next.delete(noteId);
      return next;
    });
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, upvotes: total } : n)));
  };

  const handleDownload = async (note: Note) => {
    await downloadFile(note.file_url, downloadName(cleanNoteTitle(note.title), note.file_name, note.file_url));
    toast.success("Download started");
  };

  // Display-only cleanup: some stored titles carry a raw
  // "(official source: https://…" fragment — strip it at render so it
  // never shows (or overflows) in the card. DB rows are not rewritten.
  const cleanNoteTitle = (t: string) =>
    t.replace(/\s*\(official source:.*$/i, "").trim() || t;

  // Attribution (Bug #6B): surface the creator/source recorded in the
  // data — the title's source segment when present, plus the uploader
  // when they are a real named user. Nothing is invented.
  const attribution = (note: Note) => {
    const source = sourceFromTitle(cleanNoteTitle(note.title));
    const named = note.uploader_name && note.uploader_name !== "Anonymous" ? note.uploader_name : null;
    if (source && named) return `Source: ${source} • Shared by ${named}`;
    if (source) return `Source: ${source}`;
    return `by ${note.uploader_name || "Anonymous"}`;
  };

  return (
    <PageShell
      title="Notes"
      seoTitle="Study Notes for CS, SE & AI Subjects — UniGenius AI"
      seoDescription="Read and share study notes for Computer Science, Software Engineering and AI subjects — student-shared and curated notes for every semester, in one place."
      seoPath="/notes"
      subtitle="Share notes with everyone — or keep your own private ones"
      icon={
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <FileText className="w-5 h-5 text-primary" />
        </div>
      }
    >
      <Tabs defaultValue="marketplace" className="space-y-4 w-full min-w-0 pb-24">
        <TabsList className="rounded-xl">
          <TabsTrigger value="marketplace" className="rounded-lg gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Marketplace
          </TabsTrigger>
          <TabsTrigger value="my-notes" className="rounded-lg gap-1.5">
            <NotebookPen className="w-3.5 h-3.5" /> My Notes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="marketplace" className="mt-0 min-w-0">
      <div className="grid lg:grid-cols-3 gap-4 min-w-0">
        {/* Upload — its OWN semester/subject state, completely separate
            from the browse filter on the right. */}
        <div className="glass rounded-2xl p-5 sm:p-6 space-y-4 h-fit min-w-0 w-full max-w-full">
          <h3 className="font-display font-semibold text-foreground">Upload Notes</h3>

          <Input placeholder="Title (e.g., DSA Chapter 3 Notes)" value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-xl w-full min-w-0" />

          <Select value={String(uploadSemester)} onValueChange={(v) => { setUploadSemester(Number(v)); setUploadSubject(""); }}>
            <SelectTrigger className="rounded-xl w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={uploadSubject} onValueChange={setUploadSubject}>
            <SelectTrigger className="rounded-xl w-full min-w-0"><SelectValue placeholder="Select subject" /></SelectTrigger>
            <SelectContent>
              {uploadSubjects.map((s) => (
                <SelectItem key={s.id} value={s.name}>{s.icon} {s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="min-w-0 w-full max-w-full overflow-hidden">
            <label className="text-xs font-medium text-foreground mb-1 block">File (PDF only) *</label>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full max-w-full text-xs text-muted-foreground file:mr-2 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Only PDF files are accepted.</p>
          </div>

          <Button onClick={uploadNote} disabled={uploading} className="w-full rounded-xl gradient-primary text-primary-foreground gap-2">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
            {uploading ? "Uploading..." : "Upload Notes"}
          </Button>
        </div>

        {/* Browse — its OWN cascading filter: semester chips rebuild the
            subject chips from the student's own subjects (My Subjects /
            scheme), and the chips filter only this list. */}
        <div className="lg:col-span-2 space-y-3 min-w-0 w-full max-w-full">
          <div className="space-y-2.5">
            <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Browse by semester">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={browseSemester === s ? "default" : "outline"}
                  aria-pressed={browseSemester === s}
                  className={`rounded-full h-8 px-3 text-xs ${browseSemester === s ? "gradient-primary text-primary-foreground" : ""}`}
                  onClick={() => { browseSemesterTouched.current = true; setBrowseSemester(s); setBrowseSubject("all"); }}
                >
                  Sem {s}
                </Button>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Browse by subject">
              <Button
                size="sm"
                variant={browseSubject === "all" ? "default" : "outline"}
                aria-pressed={browseSubject === "all"}
                className={`rounded-full h-8 px-3 text-xs ${browseSubject === "all" ? "gradient-primary text-primary-foreground" : ""}`}
                onClick={() => setBrowseSubject("all")}
              >
                All Subjects
              </Button>
              {browseSubjectNames.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  variant={browseSubject === name ? "default" : "outline"}
                  aria-pressed={browseSubject === name}
                  className={`rounded-full h-8 px-3 text-xs ${browseSubject === name ? "gradient-primary text-primary-foreground" : ""}`}
                  onClick={() => setBrowseSubject(name)}
                >
                  {name}
                </Button>
              ))}
            </div>
          </div>

          <h3 className="font-display font-semibold text-foreground">
            Semester {browseSemester} Notes{browseSubject !== "all" ? ` — ${browseSubject}` : ""} ({visibleNotes.length})
          </h3>

          {loading ? (
            <div className="glass rounded-2xl p-8 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
            </div>
          ) : visibleNotes.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center space-y-2">
              <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">No notes here yet. Be the first to upload!</p>
            </div>
          ) : (
            visibleNotes.map((note, i) => (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass rounded-xl p-4 flex items-start gap-3 w-full min-w-0 max-w-full"
              >
                <button
                  onClick={() => upvote(note.id)}
                  aria-pressed={userVotes.has(note.id)}
                  aria-label={userVotes.has(note.id) ? "Remove upvote" : "Upvote this note"}
                  className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-full border shrink-0 transition-colors ${
                    userVotes.has(note.id)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-primary/10 text-primary border-primary/25 hover:bg-primary/20"
                  }`}
                >
                  <ThumbsUp className="w-4 h-4" />
                  <span className="text-xs font-bold">{note.upvotes}</span>
                </button>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm line-clamp-2 break-words">{cleanNoteTitle(note.title)}</p>
                  <p className="text-xs text-muted-foreground break-words mt-0.5">
                    {note.subject} • {attribution(note)} • {new Date(note.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" className="rounded-lg gap-1.5 text-xs" onClick={() => setViewing(note)}>
                    <Eye className="w-3 h-3" /> View
                  </Button>
                  {fileKind(note.file_url, note.file_name) === "web" ? (
                    // Web-page resources are pages, not files: there is
                    // nothing to download. Open them in the in-app viewer
                    // instead of a "Download" that used to eject the
                    // whole tab to the source site (D-2).
                    <Button size="sm" variant="outline" className="rounded-lg gap-1.5 text-xs" onClick={() => setViewing(note)}>
                      <Globe className="w-3 h-3" /> Open
                    </Button>
                  ) : downloadsEnabled ? (
                    <Button size="sm" variant="outline" className="rounded-lg gap-1.5 text-xs" onClick={() => handleDownload(note)}>
                      <Download className="w-3 h-3" /> Download
                    </Button>
                  ) : null}
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
        </TabsContent>

        <TabsContent value="my-notes" className="mt-0 min-w-0">
          {!user ? (
            <div className="glass rounded-2xl p-8 text-center space-y-2">
              <NotebookPen className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">Sign in to write and keep your own private notes.</p>
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-4 min-w-0">
              {/* Editor */}
              <div className="glass rounded-2xl p-5 sm:p-6 space-y-4 h-fit min-w-0 w-full max-w-full">
                <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
                  {editingNoteId ? <Pencil className="w-4 h-4 text-primary" /> : <Plus className="w-4 h-4 text-primary" />}
                  {editingNoteId ? "Edit Note" : "New Note"}
                </h3>
                <Input
                  placeholder="Title (e.g., OOP — Inheritance cheatsheet)"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  className="rounded-xl w-full min-w-0"
                />
                <Textarea
                  placeholder="Write your note here… definitions, formulas, anything you want to remember."
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  rows={10}
                  className="rounded-xl resize-y w-full min-w-0"
                />
                <div className="flex gap-2">
                  <Button onClick={saveTextNote} disabled={savingNote} className="flex-1 rounded-xl gradient-primary text-primary-foreground gap-2">
                    {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {editingNoteId ? "Update Note" : "Save Note"}
                  </Button>
                  {editingNoteId && (
                    <Button onClick={cancelEdit} variant="outline" className="rounded-xl gap-1.5">
                      <X className="w-4 h-4" /> Cancel
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">Private — only you can see your notes.</p>
              </div>

              {/* My notes list */}
              <div className="lg:col-span-2 space-y-3 min-w-0 w-full max-w-full">
                <h3 className="font-display font-semibold text-foreground">Your Notes ({myNotes.length})</h3>
                {myNotesLoading ? (
                  <div className="glass rounded-2xl p-8 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                  </div>
                ) : myNotes.length === 0 ? (
                  <div className="glass rounded-2xl p-8 text-center space-y-2">
                    <NotebookPen className="w-10 h-10 text-muted-foreground/30 mx-auto" />
                    <p className="text-sm text-muted-foreground">No notes yet. Write your first one!</p>
                  </div>
                ) : (
                  myNotes.map((note, i) => (
                    <motion.div
                      key={note.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className={`glass rounded-xl p-4 space-y-2 w-full min-w-0 max-w-full ${editingNoteId === note.id ? "border border-primary/40" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground text-sm line-clamp-2 break-words">{note.title}</p>
                          <p className="text-[11px] text-muted-foreground break-words">
                            Updated {new Date(note.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} • {note.content.length} characters
                          </p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={() => editTextNote(note)}>
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={() => deleteTextNote(note.id)}>
                            <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-foreground/80 whitespace-pre-wrap line-clamp-4">{note.content}</p>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <FileViewerDialog
        open={!!viewing}
        onOpenChange={(o) => { if (!o) setViewing(null); }}
        title={viewing ? cleanNoteTitle(viewing.title) : ""}
        url={viewing?.file_url ?? null}
        fileName={viewing?.file_name}
      />
      <div className="px-1">
        <SeoIntro
          heading="Notes that match your syllabus"
          paragraphs={[
            "These notes are shared by students and curated for the subjects taught in CS, SE and AI degree programs — the same subjects you will find in the topic pages and question bank. Search by subject, open a note right here in the app, and use it alongside the matching topic page: the topic page gives you the structured summary and key points, the notes give you the classroom detail.",
            "You can also keep your own private notes here, so your handwritten scans, typed summaries and important PDFs live in one place instead of being lost in your phone gallery. Found a note genuinely helpful? Upvote it so other students find the best material first.",
          ]}
        />
      </div>
    </PageShell>
  );
};

export default NotesPage;
