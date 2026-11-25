import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, Trash2, Download, Search, Filter, MoreVertical, Eye, Calendar, GraduationCap, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import PageShell from "@/components/PageShell";
import FileViewerDialog from "@/components/FileViewerDialog";
import { downloadFile, downloadName } from "@/lib/file-delivery";
import { useAuth } from "@/contexts/AuthContext";
import { useDepartment } from "@/contexts/DepartmentContext";
import { getSubjects } from "@/data/subjects";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PastPaper {
  id: string;
  user_id: string;
  subject: string;
  semester: number;
  title: string;
  description: string | null;
  paper_type: string;
  year: number | null;
  file_url: string;
  file_name: string;
  created_at: string;
}

const PastPapersPage = () => {
  const { user } = useAuth();
  const { department } = useDepartment();
  const [semester, setSemester] = useState(1);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("current_semester").eq("user_id", user.id).single()
      .then(({ data }) => { if (data?.current_semester) setSemester(data.current_semester); });
  }, [user]);

  const subjects = getSubjects(department, semester);

  const [papers, setPapers] = useState<PastPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [semesterFilter, setSemesterFilter] = useState<string>("all");
  const [viewing, setViewing] = useState<PastPaper | null>(null);
  const [filterSubject, setFilterSubject] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [search, setSearch] = useState("");

  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadSubject, setUploadSubject] = useState("");
  const [uploadType, setUploadType] = useState("midterm");
  const [uploadYear, setUploadYear] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const fetchPapers = async () => {
    let query = supabase.from("past_papers").select("*").order("created_at", { ascending: false });
    if (semesterFilter !== "all") query = query.eq("semester", Number(semesterFilter));
    const { data, error } = await query;
    if (!error && data) setPapers(data as PastPaper[]);
    setLoading(false);
  };

  useEffect(() => { fetchPapers(); }, [semesterFilter]);

  const handleUpload = async () => {
    if (!user || !uploadFile || !uploadTitle || !uploadSubject) {
      toast.error("Please fill all required fields");
      return;
    }
    setUploading(true);
    try {
      const ext = uploadFile.name.split(".").pop();
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: storageError } = await supabase.storage.from("past-papers").upload(path, uploadFile);
      if (storageError) throw storageError;

      const { data: urlData } = supabase.storage.from("past-papers").getPublicUrl(path);

      const { error: dbError } = await supabase.from("past_papers").insert({
        user_id: user.id,
        subject: uploadSubject,
        semester,
        title: uploadTitle,
        paper_type: uploadType,
        year: uploadYear ? parseInt(uploadYear) : null,
        file_url: urlData.publicUrl,
        file_name: uploadFile.name,
      });
      if (dbError) throw dbError;

      toast.success("Paper uploaded successfully!");
      setShowUpload(false);
      setUploadTitle("");
      setUploadSubject("");
      setUploadFile(null);
      setUploadYear("");
      fetchPapers();
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const deletePaper = async (paper: PastPaper) => {
    const { error } = await supabase.from("past_papers").delete().eq("id", paper.id);
    if (error) { toast.error("Failed to delete"); return; }
    setPapers(prev => prev.filter(p => p.id !== paper.id));
    toast.success("Paper deleted");
  };

  const subjectOptions = [...new Set(papers.map(p => p.subject))].sort();
  const filtered = papers.filter(p => {
    if (filterSubject !== "all" && p.subject !== filterSubject) return false;
    if (filterType !== "all" && p.paper_type !== filterType) return false;
    if (search && !(p.title.toLowerCase().includes(search.toLowerCase()) || p.subject.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  const handleDownload = async (paper: PastPaper) => {
    await downloadFile(paper.file_url, downloadName(paper.title, paper.file_name, paper.file_url));
    toast.success("Download started");
  };

  return (
    <PageShell
      title="Past Paper Vault"
      subtitle="Community Past Papers"
      icon={<div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><FileText className="w-5 h-5 text-primary" /></div>}
    >
      <div className="space-y-4 pb-6">
        {/* Search — full width on its own row */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search papers..." className="pl-9 rounded-xl" />
        </div>

        {/* Filter row: semester (default All — the full vault), subject, type */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Select value={semesterFilter} onValueChange={setSemesterFilter}>
            <SelectTrigger className="w-full rounded-xl" aria-label="Filter by semester">
              <GraduationCap className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              <SelectValue placeholder="Semester" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Semesters</SelectItem>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <SelectItem key={n} value={String(n)}>Semester {n}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterSubject} onValueChange={setFilterSubject}>
            <SelectTrigger className="w-full rounded-xl">
              <Filter className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {subjectOptions.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-full rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="midterm">Midterm</SelectItem>
              <SelectItem value="final">Final</SelectItem>
              <SelectItem value="sessional">Sessional</SelectItem>
              <SelectItem value="quiz">Quiz</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Upload form */}
        <AnimatePresence>
          {showUpload && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="glass rounded-2xl p-6 border border-border/30 space-y-4 overflow-hidden">
              <h3 className="font-display font-semibold text-foreground">Upload Past Paper</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <Input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="Paper title (e.g., Midterm 2024)" className="rounded-xl" />
                <Select value={uploadSubject} onValueChange={setUploadSubject}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="Subject" /></SelectTrigger>
                  <SelectContent>
                    {subjects.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={uploadType} onValueChange={setUploadType}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="midterm">Midterm</SelectItem>
                    <SelectItem value="final">Final</SelectItem>
                    <SelectItem value="sessional">Sessional</SelectItem>
                    <SelectItem value="quiz">Quiz</SelectItem>
                  </SelectContent>
                </Select>
                <Input value={uploadYear} onChange={e => setUploadYear(e.target.value)} placeholder="Year (e.g., 2024)" type="number" className="rounded-xl" />
              </div>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => setUploadFile(e.target.files?.[0] || null)} className="text-sm text-muted-foreground" />
              <div className="flex gap-2">
                <Button onClick={handleUpload} disabled={uploading} className="rounded-xl gradient-button text-primary-foreground">{uploading ? "Uploading..." : "Submit"}</Button>
                <Button variant="ghost" onClick={() => setShowUpload(false)} className="rounded-xl">Cancel</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Papers grid */}
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6 text-primary" />
            </div>
            <p className="text-muted-foreground">No past papers yet. Be the first to contribute!</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {filtered.length} paper{filtered.length === 1 ? "" : "s"}
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(paper => (
                <motion.div key={paper.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 border border-border/30 space-y-3 group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <FileText className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <h4 className="font-medium text-sm text-foreground">{paper.title}</h4>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <BookOpen className="w-3 h-3 shrink-0" /> {paper.subject}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize whitespace-nowrap shrink-0">{paper.paper_type}</span>
                      {/* Delete lives in a quiet overflow menu, and only
                          for the paper's owner (same gate as before). */}
                      {user && paper.user_id === user.id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground" aria-label="Paper options">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive gap-2"
                              onClick={() => deletePaper(paper)}
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete paper
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {paper.year && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {paper.year}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <GraduationCap className="w-3 h-3" /> Semester {paper.semester}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="flex-1 w-full rounded-xl gap-1.5 text-xs border border-border/60" onClick={() => setViewing(paper)}>
                      <Eye className="w-3.5 h-3.5" /> View
                    </Button>
                    <Button size="sm" className="flex-1 w-full rounded-xl gap-1.5 text-xs gradient-button text-primary-foreground" onClick={() => handleDownload(paper)}>
                      <Download className="w-3.5 h-3.5" /> Download
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}

        <FileViewerDialog
          open={!!viewing}
          onOpenChange={(o) => { if (!o) setViewing(null); }}
          title={viewing?.title ?? ""}
          url={viewing?.file_url ?? null}
          fileName={viewing?.file_name}
        />

        {/* Help the vault grow — wired to the existing upload flow */}
        <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center space-y-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <Upload className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-foreground">Help the vault grow</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Sat a paper recently? Share it so the next batch can prepare better.
            </p>
          </div>
          <Button onClick={() => setShowUpload(true)} className="rounded-xl gap-2 gradient-button text-primary-foreground" disabled={!user}>
            <Upload className="w-4 h-4" /> Upload a past paper
          </Button>
          {!user && <p className="text-xs text-muted-foreground">Sign in to upload a paper.</p>}
        </div>
      </div>
    </PageShell>
  );
};

export default PastPapersPage;
