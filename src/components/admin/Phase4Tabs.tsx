import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck, CheckCircle2, XCircle, Trash2, Eye, Loader2, TrendingUp,
  HeartPulse, Download, Wrench, ScrollText, Search, FileText, Database,
  HardDrive, Bot, KeyRound, Users, BookOpen, RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  FEATURE_LABELS, formatBytes, toCsv, downloadCsv, type FeatureFlags,
} from "@/lib/app-settings";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PK", { dateStyle: "medium" });

async function logAdminAction(userId: string | undefined, action: string, details: Record<string, unknown>) {
  if (!userId) return;
  await supabase.from("audit_log" as any).insert({ actor_id: userId, action, details } as any);
}

/* ================= MODERATION TAB (B2.7) ================= */

const KIND_LABEL: Record<string, string> = { note: "Note", material: "Study Material", paper: "Past Paper" };

export const ModerationTab = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "all" | "approved" | "rejected">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<any>(null);

  const fetchQueue = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_moderation_queue" as any);
    if (error) toast.error("Failed to load moderation queue: " + error.message);
    setItems((data as any[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const act = async (item: any, decision: "approved" | "rejected" | "removed") => {
    setBusyId(item.id);
    const { error } = await supabase.rpc("admin_moderate_content" as any, {
      _kind: item.kind, _id: item.id, _decision: decision,
    });
    setBusyId(null);
    setRemoveTarget(null);
    if (error) {
      toast.error("Action failed: " + error.message);
    } else {
      toast.success(
        decision === "approved" ? "Content approved — now visible to everyone"
        : decision === "rejected" ? "Content rejected — hidden from students"
        : "Content removed permanently"
      );
      fetchQueue();
    }
  };

  const filtered = items.filter((i) => filter === "all" || i.moderation_status === filter);
  const pendingCount = items.filter((i) => i.moderation_status === "pending").length;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Content Moderation</h2>
          <p className="text-xs text-muted-foreground">
            {pendingCount} waiting for review • new uploads stay hidden until approved
          </p>
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
          <SelectTrigger className="rounded-xl w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="all">All content</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading queue...</div>
      ) : filtered.length === 0 ? (
        <Card className="border-border/30 bg-card">
          <CardContent className="p-8 text-center">
            <ShieldCheck className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              {filter === "pending" ? "Nothing is waiting for review. All uploads are approved." : "No content in this view."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <Card key={`${item.kind}-${item.id}`} data-moderation-item={item.id} className={`border-border/30 bg-card ${item.moderation_status === "pending" ? "border-l-4 border-l-amber-500" : ""}`}>
              <CardContent className="p-3.5">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">{item.title || "Untitled"}</p>
                      <Badge variant="outline" className="text-[9px]">{KIND_LABEL[item.kind] || item.kind}</Badge>
                      <Badge
                        className={`text-[9px] ${item.moderation_status === "pending"
                          ? "bg-amber-500/15 text-amber-600 hover:bg-amber-500/15"
                          : item.moderation_status === "approved"
                          ? "bg-primary/15 text-primary hover:bg-primary/15"
                          : "bg-destructive/15 text-destructive hover:bg-destructive/15"}`}
                      >
                        {item.moderation_status}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {[item.subject, item.semester ? `Semester ${item.semester}` : null, item.uploader ? `by ${item.uploader}` : null, fmtDate(item.created_at)]
                        .filter(Boolean).join(" • ")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  {item.file_url && (
                    <Button variant="ghost" size="icon" className="rounded-lg w-8 h-8" title="Open file"
                      onClick={() => window.open(item.file_url, "_blank", "noopener")}>
                      <Eye className="w-4 h-4" />
                    </Button>
                  )}
                  {item.moderation_status !== "approved" && (
                    <Button size="sm" className="rounded-lg text-[10px] h-7 px-2 gap-1" disabled={busyId === item.id}
                      onClick={() => act(item, "approved")}>
                      {busyId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                      Approve
                    </Button>
                  )}
                  {item.moderation_status !== "rejected" && (
                    <Button variant="outline" size="sm" className="rounded-lg text-[10px] h-7 px-2 gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                      disabled={busyId === item.id} onClick={() => act(item, "rejected")}>
                      <XCircle className="w-3 h-3" /> Reject
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="rounded-lg w-8 h-8 text-destructive hover:bg-destructive/10"
                    title="Remove permanently" onClick={() => setRemoveTarget(item)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">Remove this content?</DialogTitle>
            <DialogDescription className="text-xs">
              "{removeTarget?.title}" will be deleted permanently. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" className="rounded-xl" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="destructive" className="rounded-xl" onClick={() => removeTarget && act(removeTarget, "removed")}>
              Remove
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

/* ================= GROWTH TAB (B3.12) ================= */

export const GrowthTab = () => {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<"signups" | "quiz_attempts" | "ai_calls">("signups");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase.rpc("admin_growth_stats" as any, { _days: days }).then(({ data, error }) => {
      if (error) toast.error("Failed to load growth stats: " + error.message);
      setData(data);
      setLoading(false);
    });
  }, [days]);

  const series = ((data?.[metric] as any[]) || []).map((d) => ({
    day: new Date(d.day).toLocaleDateString("en-PK", { day: "numeric", month: "short" }),
    count: d.count,
  }));
  const total = series.reduce((s, d) => s + d.count, 0);
  const metricLabel = metric === "signups" ? "New signups" : metric === "quiz_attempts" ? "Quiz attempts" : "AI calls";

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" /> Growth
          </h2>
          <p className="text-xs text-muted-foreground">How the platform is growing, day by day</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={metric} onValueChange={(v) => setMetric(v as any)}>
            <SelectTrigger className="rounded-xl w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="signups">Signups</SelectItem>
              <SelectItem value="quiz_attempts">Quiz Attempts</SelectItem>
              <SelectItem value="ai_calls">AI Calls</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="rounded-xl w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-border/30 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display">
            {metricLabel} — {total} in the last {days} days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-10 text-muted-foreground text-sm">Loading...</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={24} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Bar dataKey="count" name={metricLabel} fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-border/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-display">Most Attempted Subjects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.top_subjects || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No quiz attempts yet.</p>
            )}
            {(data?.top_subjects || []).map((s: any) => (
              <div key={s.subject} className="flex items-center justify-between text-xs">
                <span className="text-foreground truncate mr-2">{s.subject}</span>
                <span className="text-muted-foreground shrink-0">{s.attempts} attempts • avg {s.avg_pct}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="border-border/30 bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-display">Most Used AI Features</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data?.top_features || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No AI usage recorded yet.</p>
            )}
            {(data?.top_features || []).map((f: any) => (
              <div key={f.feature} className="flex items-center justify-between text-xs">
                <span className="text-foreground truncate mr-2">{f.feature}</span>
                <span className="text-muted-foreground shrink-0">{f.calls} calls • {f.failures} failed</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
};

/* ================= SYSTEM TAB (B2.8 + B3.10 + B3.11 + B3.15) ================= */

export const SystemTab = () => {
  const { user } = useAuth();
  const [health, setHealth] = useState<any>(null);
  const [features, setFeatures] = useState<FeatureFlags | null>(null);
  const [maintenance, setMaintenance] = useState<{ enabled: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("app_settings" as any).select("key, value");
    (data as any[] || []).forEach((row: any) => {
      if (row.key === "features") setFeatures(row.value as FeatureFlags);
      if (row.key === "maintenance") setMaintenance(row.value as any);
    });
    const { data: h } = await supabase.rpc("admin_system_health" as any);
    setHealth(h);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSetting = async (key: string, value: unknown, action: string, details: Record<string, unknown>) => {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings" as any)
      .update({ value, updated_at: new Date().toISOString(), updated_by: user?.id } as any)
      .eq("key", key);
    setSaving(false);
    if (error) {
      toast.error("Save failed: " + error.message);
      load();
      return;
    }
    await logAdminAction(user?.id, action, details);
    toast.success("Saved — takes effect within a minute, no redeploy needed");
  };

  const toggleFeature = (key: keyof FeatureFlags, on: boolean) => {
    if (!features) return;
    const next = { ...features, [key]: on };
    setFeatures(next);
    saveSetting("features", next, "feature_switch_changed", { feature: key, enabled: on });
  };

  const exportUsers = async () => {
    setExporting("users");
    const { data, error } = await supabase.rpc("admin_list_users_full" as any);
    setExporting(null);
    if (error) { toast.error(error.message); return; }
    const rows = (data as any[]).map((u) => [
      u.display_name || "", u.email, u.roll_number || "", u.plan, (u.roles || []).join(" "),
      u.current_semester || "", u.suspended ? "suspended" : "active",
      new Date(u.joined_at).toISOString().slice(0, 10),
      u.last_active_at ? new Date(u.last_active_at).toISOString().slice(0, 10) : "",
    ]);
    downloadCsv(`unigenius-users-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(["Name", "Email", "Roll Number", "Plan", "Roles", "Semester", "Status", "Joined", "Last Active"], rows));
    toast.success("Users CSV downloaded");
  };

  const exportSales = async () => {
    setExporting("sales");
    const { data, error } = await supabase.rpc("admin_get_payment_requests" as any);
    setExporting(null);
    if (error) { toast.error(error.message); return; }
    const rows = (data as any[]).map((r) => [
      r.user_name || "", r.user_email || "", r.plan || "", r.amount, r.status,
      r.payment_method || "", r.promo_code || "",
      new Date(r.created_at).toISOString().slice(0, 10),
    ]);
    downloadCsv(`unigenius-sales-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(["Name", "Email", "Plan", "Amount (PKR)", "Status", "Method", "Promo", "Date"], rows));
    toast.success("Sales CSV downloaded");
  };

  const exportResults = async () => {
    setExporting("results");
    const { data, error } = await supabase.rpc("admin_export_quiz_results" as any, { _limit: 5000 });
    setExporting(null);
    if (error) { toast.error(error.message); return; }
    const rows = (data as any[]).map((r) => [
      new Date(r.created_at).toISOString().slice(0, 10), r.user_name || "", r.user_email || "",
      r.subject, r.quiz_type, r.score, r.total,
    ]);
    downloadCsv(`unigenius-results-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(["Date", "Name", "Email", "Subject", "Type", "Score", "Total"], rows));
    toast.success("Results CSV downloaded");
  };

  const healthCards = health ? [
    { label: "Database Size", value: formatBytes(health.db_size_bytes), icon: Database },
    { label: "Storage Used", value: `${formatBytes(health.storage_bytes)} • ${health.storage_objects} files`, icon: HardDrive },
    { label: "AI Error Rate (24h)", value: `${health.ai_24h.error_rate}%`, sub: `${health.ai_24h.failures} of ${health.ai_24h.calls} calls failed`, icon: Bot },
    { label: "AI Error Rate (7d)", value: `${health.ai_7d.error_rate}%`, sub: `${health.ai_7d.failures} of ${health.ai_7d.calls} calls failed`, icon: Bot },
    { label: "Key Pool", value: `${health.key_pool.active} active`, sub: `${health.key_pool.cooling} cooling • ${health.key_pool.disabled} disabled • ${health.key_pool.total} total`, icon: KeyRound },
    { label: "Users / Questions", value: `${health.users} / ${health.questions}`, icon: Users },
    { label: "Last Backup", value: health.last_backup_at ? fmtDate(health.last_backup_at) : "Not recorded", sub: "Backups run outside the panel", icon: RefreshCw },
  ] : [];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div>
        <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-primary" /> System
        </h2>
        <p className="text-xs text-muted-foreground">Health, feature switches, maintenance mode and data export</p>
      </div>

      {/* Health */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        {healthCards.map((c) => (
          <Card key={c.label} className="border-border/30 bg-card">
            <CardContent className="p-3.5">
              <div className="flex items-center gap-2 text-muted-foreground">
                <c.icon className="w-3.5 h-3.5" />
                <p className="text-[10px]">{c.label}</p>
              </div>
              <p className="text-base font-bold text-foreground mt-1">{c.value}</p>
              {c.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{c.sub}</p>}
            </CardContent>
          </Card>
        ))}
        {!health && <p className="text-sm text-muted-foreground col-span-full py-4 text-center">Loading health...</p>}
      </div>

      {/* Feature switches */}
      <Card className="border-border/30 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display">Feature Switches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {!features ? (
            <p className="text-xs text-muted-foreground py-2">Loading switches...</p>
          ) : FEATURE_LABELS.map((f) => (
            <div key={f.key} className="flex items-center justify-between py-2 border-b border-border/40 last:border-0">
              <div>
                <p className="text-sm font-medium text-foreground">{f.label}</p>
                <p className="text-[10px] text-muted-foreground">{f.hint}</p>
              </div>
              <Switch checked={!!features[f.key]} disabled={saving}
                onCheckedChange={(on) => toggleFeature(f.key, on)} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Maintenance mode */}
      <Card className={`border-border/30 bg-card ${maintenance?.enabled ? "border-l-4 border-l-amber-500" : ""}`}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <Wrench className="w-4 h-4 text-primary" /> Maintenance Mode
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!maintenance ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Show "back shortly" screen to everyone</p>
                  <p className="text-[10px] text-muted-foreground">Admins can still use the full app. Sign-in stays open so you can get back in.</p>
                </div>
                <Switch checked={maintenance.enabled} disabled={saving}
                  onCheckedChange={(on) => {
                    const next = { ...maintenance, enabled: on };
                    setMaintenance(next);
                    saveSetting("maintenance", next, on ? "maintenance_enabled" : "maintenance_disabled", {});
                  }} />
              </div>
              <div className="flex gap-2">
                <Textarea
                  value={maintenance.message}
                  onChange={(e) => setMaintenance({ ...maintenance, message: e.target.value })}
                  className="rounded-xl text-sm min-h-[64px]"
                  placeholder="Message shown to users during maintenance"
                />
                <Button variant="outline" className="rounded-xl shrink-0" disabled={saving}
                  onClick={() => saveSetting("maintenance", maintenance, "maintenance_message_updated", {})}>
                  Save Message
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Data export */}
      <Card className="border-border/30 bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" /> Data Export (CSV)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-xl gap-2" onClick={exportUsers} disabled={exporting !== null}>
            {exporting === "users" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            Users
          </Button>
          <Button variant="outline" className="rounded-xl gap-2" onClick={exportSales} disabled={exporting !== null}>
            {exporting === "sales" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Sales
          </Button>
          <Button variant="outline" className="rounded-xl gap-2" onClick={exportResults} disabled={exporting !== null}>
            {exporting === "results" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
            Quiz Results
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
};

/* ================= AUDIT LOG TAB (B2.9) ================= */

export const AuditLogTab = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data: logs }, { data: users }] = await Promise.all([
        supabase.from("audit_log" as any).select("*").order("created_at", { ascending: false }).limit(200),
        supabase.rpc("admin_get_all_users"),
      ]);
      const map: Record<string, string> = {};
      (users || []).forEach((u: any) => { map[u.user_id] = u.display_name || u.email; });
      setActors(map);
      setRows((logs as any[]) || []);
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    return !q || r.action.toLowerCase().includes(q) || (actors[r.actor_id] || "").toLowerCase().includes(q);
  });

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div>
        <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-primary" /> Audit Log
        </h2>
        <p className="text-xs text-muted-foreground">Every admin action, recorded — newest first</p>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search by action or person..." className="pl-9 rounded-xl"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading log...</div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">No log entries found.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Card key={r.id} className="border-border/30 bg-card">
              <CardContent className="p-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <ScrollText className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{r.action}</p>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">by {actors[r.actor_id] || "Unknown user"}</p>
                  {r.details && Object.keys(r.details).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.entries(r.details).map(([k, v]) => (
                        <Badge key={k} variant="outline" className="text-[9px] font-normal">
                          {k}: {String(v)}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </motion.div>
  );
};
