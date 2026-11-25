import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Crown, Upload, Clock, XCircle, Smartphone, Copy, Check,
  Tag, Loader2, Zap, FileText, Mic, HardDrive, Bell, BadgeCheck,
  Layers, File, Timer, User, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import PageShell from "@/components/PageShell";

const FREE_FEATURES = [
  { icon: Layers, label: "2 Slides / day", limited: true },
  { icon: File, label: "PDF Only (2MB)", limited: true },
  { icon: Mic, label: "Standard Voice", limited: true },
  { icon: HardDrive, label: "50MB Storage", limited: true },
  { icon: Timer, label: "Standard Timer", limited: true },
  { icon: User, label: "Normal User Badge", limited: true },
];

const PRO_FEATURES = [
  { icon: Layers, label: "Unlimited Slides" },
  { icon: FileText, label: "All Formats (PPT, Docs, Images)" },
  { icon: Mic, label: "Pro Voices (Aoede & Algieba)" },
  { icon: HardDrive, label: "5GB Storage" },
  { icon: Bell, label: "Priority Exam Alerts" },
  { icon: BadgeCheck, label: "Golden Verified Tick" },
];

const PremiumPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isPro, setIsPro] = useState(false);
  // Which paid plan is actually active for this user (from the latest
  // APPROVED payment). Pro with no payment record = admin/founder grant,
  // which is a Lifetime grant. Used so the plan cards mark the REAL
  // current plan — previously the Free card was hardcoded "Current Plan"
  // for everyone, including Lifetime Pro users.
  const [activePaidPlan, setActivePaidPlan] = useState<"monthly" | "lifetime" | null>(null);
  const [pendingRequest, setPendingRequest] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"jazzcash" | "easypaisa">("jazzcash");
  const [copiedJazz, setCopiedJazz] = useState(false);
  const [copiedEasy, setCopiedEasy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discount_percent: number; remaining?: number } | null>(null);

  const PLANS = {
    monthly:  { id: "monthly",  name: "Premium Pro",  price: 300,  listPrice: 500,  period: "/ mo" },
    lifetime: { id: "lifetime", name: "Lifetime Pro", price: 3600, listPrice: 6000, period: "one-time" },
  } as const;
  const [selectedPlan, setSelectedPlan] = useState<keyof typeof PLANS>("monthly");

  const basePrice = PLANS[selectedPlan].price;
  const finalPrice = appliedPromo ? Math.round(basePrice * (1 - appliedPromo.discount_percent / 100)) : basePrice;

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("is_pro").eq("user_id", user.id).single().then(({ data }) => {
      if ((data as any)?.is_pro) setIsPro(true);
    });
    supabase
      .from("payment_requests" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) setPendingRequest(data[0]);
      });
    supabase
      .from("payment_requests" as any)
      .select("plan, status")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const plan = (data as any)?.[0]?.plan;
        if (plan === "monthly" || plan === "lifetime") setActivePaidPlan(plan);
      });
  }, [user]);

  // Effective current plan: an approved payment wins; a Pro account with
  // no payment record holds a Lifetime grant (founder/admin).
  const currentPlan: "free" | "monthly" | "lifetime" = !isPro
    ? "free"
    : activePaidPlan ?? "lifetime";

  const applyPromoCode = async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    try {
      const { data, error } = await supabase.rpc("validate_promo_code" as any, { _code: promoCode.trim() } as any);
      const row: any = Array.isArray(data) ? data[0] : data;
      if (error || !row) { toast.error("Invalid or expired promo code"); setAppliedPromo(null); return; }
      if ((row.remaining ?? 0) <= 0) { toast.error("Sorry! This promo code has reached its limit."); setAppliedPromo(null); return; }
      setAppliedPromo({ code: row.code, discount_percent: row.discount_percent, remaining: row.remaining });
      toast.success("🎉 Mubarak! " + row.discount_percent + "% discount applied!", { duration: 5000 });
    } catch { toast.error("Failed to validate promo code"); } finally { setPromoLoading(false); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    if (file.size > 5 * 1024 * 1024) { toast.error("File too large (max 5MB)"); return; }
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from("payment-screenshots").upload(path, file);
    if (uploadErr) { toast.error("Upload failed: " + uploadErr.message); setUploading(false); return; }
    const { error: insertErr } = await (supabase.from("payment_requests" as any) as any).insert({
      user_id: user.id, screenshot_url: path, payment_method: paymentMethod,
      amount: finalPrice, promo_code: appliedPromo?.code || null, discount_percent: appliedPromo?.discount_percent || 0,
      plan: selectedPlan,
    });
    if (insertErr) { toast.error("Failed to submit: " + insertErr.message); }
    else { toast.success("🎉 Payment screenshot submitted!"); setPendingRequest({ status: "pending", payment_method: paymentMethod, created_at: new Date().toISOString() }); setModalOpen(false); }
    setUploading(false);
  };

  const copyNumber = (num: string, type: "jazz" | "easy") => {
    navigator.clipboard.writeText(num);
    if (type === "jazz") { setCopiedJazz(true); setTimeout(() => setCopiedJazz(false), 2000); }
    else { setCopiedEasy(true); setTimeout(() => setCopiedEasy(false), 2000); }
    toast.success("Number copied!");
  };

  if (!user) {
    return (
      <PageShell title="Premium" subtitle="Unlock every feature — one simple price." icon={<Crown className="w-5 h-5" />}>
        <div className="text-center py-16">
          <Crown className="w-12 h-12 text-primary mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">Please sign in to upgrade to Premium</p>
          <Button onClick={() => navigate("/auth")} className="rounded-xl">Sign In</Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Premium" subtitle="Unlock every feature — one simple price." icon={<Crown className="w-5 h-5" />}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mx-auto space-y-6 pb-24">
        {/* Pro confirmation — compact banner above the plans (was a
            full-screen takeover). Wording kept verbatim. */}
        {isPro && (
          <div className="glass rounded-2xl p-4 flex items-center gap-3 border border-primary/30">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shrink-0">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">You're a Pro!</p>
              <p className="text-xs text-muted-foreground">All premium features are unlocked.</p>
            </div>
            <Badge className="gradient-button text-white border-0 shrink-0 text-[10px] tracking-wide uppercase">PRO Member</Badge>
          </div>
        )}
        {/* Pending/Rejected Banner */}
        {pendingRequest?.status === "pending" && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="w-5 h-5 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">Payment Under Review</p>
                <p className="text-xs text-muted-foreground">Your payment is being verified. Pro will be activated within 2–4 hours. 🙏</p>
              </div>
              <Badge variant="outline" className="text-amber-500 border-amber-500/30 ml-auto shrink-0 text-xs">Pending</Badge>
            </CardContent>
          </Card>
        )}
        {pendingRequest?.status === "rejected" && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-4 flex items-center gap-3">
              <XCircle className="w-5 h-5 text-destructive shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">Payment Rejected</p>
                <p className="text-xs text-muted-foreground">{pendingRequest.admin_note || "Please try again with a valid screenshot."}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pricing Cards — one violet accent system for both paid tiers,
            compact left-aligned cards in one height rhythm. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
          {/* Free Card */}
          <Card className="glass rounded-2xl border-border/40 flex flex-col">
            <CardHeader className="pb-3 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5 text-muted-foreground" />
                </div>
                <CardTitle className="font-display text-base">Free Plan</CardTitle>
              </div>
              <p className="text-2xl font-bold text-foreground flex items-baseline gap-1.5">
                0 <span className="text-sm font-normal text-muted-foreground">PKR</span>
              </p>
            </CardHeader>
            <CardContent className="space-y-2.5 pb-5 flex flex-col flex-1">
              {FREE_FEATURES.map((f) => (
                <div key={f.label} className="flex items-center gap-2.5 text-sm">
                  <f.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">{f.label}</span>
                </div>
              ))}
              <div className="pt-4 mt-auto">
                {currentPlan === "free" ? (
                  <Button disabled className="w-full rounded-xl gradient-button text-white border-0 disabled:opacity-100">
                    Current Plan — Active
                  </Button>
                ) : (
                  <Button disabled className="w-full rounded-xl" variant="outline">
                    Free Plan
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Premium Card */}
          <Card className="glass rounded-2xl border-primary/40 shadow-elevated flex flex-col">
            <CardHeader className="pb-3 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shrink-0">
                  <Crown className="w-5 h-5 text-white" />
                </div>
                <CardTitle className="font-display text-base flex-1 min-w-0">Premium Pro</CardTitle>
                <Badge className="gradient-button text-white border-0 text-[10px] px-2 py-0.5 shrink-0">
                  Most Popular
                </Badge>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-3xl font-bold text-foreground">
                  300 <span className="text-sm font-normal text-muted-foreground">PKR / mo</span>
                </p>
                <span className="text-sm line-through text-muted-foreground">500 PKR</span>
                <Badge variant="outline" className="text-primary border-primary/30 bg-primary/10 text-[10px]">Save 40%</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5 pb-5 flex flex-col flex-1">
              {PRO_FEATURES.map((f) => (
                <div key={f.label} className="flex items-center gap-2.5 text-sm">
                  <span className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 text-primary" />
                  </span>
                  <span className="text-foreground flex items-center gap-1.5">
                    {f.label}
                    {f.label === "Golden Verified Tick" && <Star className="w-3.5 h-3.5 text-primary fill-primary shrink-0" />}
                  </span>
                </div>
              ))}
              {/* Golden Tick Preview */}
              <div className="flex items-center gap-2 pt-2 pb-1">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/30">
                  <BadgeCheck className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold text-primary">Your Profile Badge</span>
                </div>
              </div>
              <div className="pt-2 mt-auto">
                {currentPlan === "monthly" ? (
                  <Button disabled className="w-full rounded-xl gradient-button text-white border-0 disabled:opacity-100">
                    Current Plan — Active
                  </Button>
                ) : currentPlan === "lifetime" ? (
                  <Button disabled className="w-full rounded-xl" variant="outline">
                    Included in Lifetime
                  </Button>
                ) : (
                  <Button
                    onClick={() => { setSelectedPlan("monthly"); setModalOpen(true); }}
                    className="w-full rounded-xl gap-2 gradient-button text-white border-0"
                  >
                    <Crown className="w-4 h-4" />
                    Upgrade to Pro
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Lifetime Card */}
          <Card className="glass rounded-2xl border-primary/40 shadow-elevated flex flex-col">
            <CardHeader className="pb-3 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shrink-0">
                  <Crown className="w-5 h-5 text-white" />
                </div>
                <CardTitle className="font-display text-base flex-1 min-w-0">Lifetime Pro</CardTitle>
                <Badge variant="outline" className="text-primary border-primary/40 bg-primary/10 text-[10px] px-2 py-0.5 shrink-0">
                  Best Value
                </Badge>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-3xl font-bold text-foreground">
                  3,600 <span className="text-sm font-normal text-muted-foreground">PKR one-time</span>
                </p>
                <span className="text-sm line-through text-muted-foreground">6,000 PKR</span>
                <Badge variant="outline" className="text-primary border-primary/30 bg-primary/10 text-[10px]">Forever — no renewals</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5 pb-5 flex flex-col flex-1">
              {PRO_FEATURES.map((f) => (
                <div key={f.label} className="flex items-center gap-2.5 text-sm">
                  <span className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 text-primary" />
                  </span>
                  <span className="text-foreground flex items-center gap-1.5">
                    {f.label}
                    {f.label === "Golden Verified Tick" && <Star className="w-3.5 h-3.5 text-primary fill-primary shrink-0" />}
                  </span>
                </div>
              ))}
              <div className="pt-2 mt-auto">
                {currentPlan === "lifetime" ? (
                  <Button disabled className="w-full rounded-xl gradient-button text-white border-0 disabled:opacity-100">
                    Current Plan — Active
                  </Button>
                ) : (
                  <Button
                    onClick={() => { setSelectedPlan("lifetime"); setModalOpen(true); }}
                    className="w-full rounded-xl gap-2 gradient-button text-white border-0"
                  >
                    <Crown className="w-4 h-4" />
                    Buy Lifetime
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Payment Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <Crown className="w-5 h-5 text-primary" />
              Upgrade to {PLANS[selectedPlan].name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Promo Code */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Promo Code</span>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. UOL50"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  className="rounded-xl flex-1"
                  disabled={!!appliedPromo}
                />
                {appliedPromo ? (
                  <Button variant="outline" className="rounded-xl text-xs text-destructive border-destructive/30"
                    onClick={() => { setAppliedPromo(null); setPromoCode(""); }}>Remove</Button>
                ) : (
                  <Button onClick={applyPromoCode} disabled={promoLoading || !promoCode.trim()} className="rounded-xl gap-1.5">
                    {promoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Apply
                  </Button>
                )}
              </div>
              {appliedPromo && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-primary font-medium">
                  {appliedPromo.discount_percent}% discount applied! Pay only {finalPrice} PKR
                </motion.p>
              )}
            </div>

            {/* Amount */}
            <div className="text-center py-2 rounded-xl bg-muted/50">
              <p className="text-sm text-muted-foreground">Amount to send</p>
              <p className="text-2xl font-bold text-foreground">{finalPrice} PKR</p>
            </div>

            {/* Payment Methods */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Select Payment Method</span>
              </div>

              <div className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${paymentMethod === "jazzcash" ? "border-primary bg-primary/5" : "border-border/30 hover:border-border"}`}
                onClick={() => setPaymentMethod("jazzcash")}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-foreground">JazzCash</p>
                    <p className="text-xs text-muted-foreground">03064379361 — Uzair Ahmad</p>
                  </div>
                  <Button variant="ghost" size="sm" className="rounded-lg text-xs gap-1"
                    onClick={(e) => { e.stopPropagation(); copyNumber("03064379361", "jazz"); }}>
                    {copiedJazz ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedJazz ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>

              <div className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${paymentMethod === "easypaisa" ? "border-primary bg-primary/5" : "border-border/30 hover:border-border"}`}
                onClick={() => setPaymentMethod("easypaisa")}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm text-foreground">EasyPaisa</p>
                    <p className="text-xs text-muted-foreground">03470326062 — Uzair Ahmad</p>
                  </div>
                  <Button variant="ghost" size="sm" className="rounded-lg text-xs gap-1"
                    onClick={(e) => { e.stopPropagation(); copyNumber("03470326062", "easy"); }}>
                    {copiedEasy ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedEasy ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Upload */}
            <div className="text-center space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">Send {finalPrice} PKR → Upload screenshot below</p>
              <label className="cursor-pointer inline-block">
                <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
                <Button asChild className="rounded-xl gap-2 gradient-button text-white border-0">
                  <span><Upload className="w-4 h-4" />{uploading ? "Uploading..." : "Upload Screenshot"}</span>
                </Button>
              </label>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default PremiumPage;
