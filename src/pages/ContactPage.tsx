import { useState } from "react";
import { motion } from "framer-motion";
import { Mail, Send, MessageCircle, User, PenLine } from "lucide-react";
import { z } from "zod";
import PageShell from "@/components/PageShell";
import SeoIntro from "@/components/SeoIntro";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Invalid email").max(255),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  message: z.string().trim().min(1, "Message is required").max(2000),
});

const ContactPage = () => {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from("contact_messages" as any).insert([parsed.data]);
      if (error) {
        console.error("[Contact] insert failed:", error);
        toast.error("Could not send message. Please try again.");
        return;
      }
      toast.success("Message sent! We'll get back to you soon.");
      setForm({ name: "", email: "", subject: "", message: "" });
    } catch (err) {
      console.error("[Contact] unexpected error:", err);
      toast.error("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell title="Contact Us" seoTitle="Contact UniGenius AI — Support & Feedback" seoDescription="Get in touch with the UniGenius AI team — questions, feedback, bug reports and suggestions for the AI study platform for CS, SE & AI students." seoPath="/contact" subtitle="We'd love to hear from you" icon={<MessageCircle className="w-5 h-5 text-primary" />}>
      <div className="max-w-2xl mx-auto space-y-6 pb-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <div className="inline-flex w-14 h-14 rounded-2xl gradient-primary items-center justify-center mb-3">
            <Mail className="w-6 h-6 text-primary-foreground" />
          </div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            We would love to hear your feedback, suggestions, and ideas for improving UniGenius AI.
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card className="glass p-6 md:p-8 border-primary/20 shadow-elevated">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-xs">Full Name</Label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Uzair Ahmad"
                      maxLength={100}
                      required
                      className="h-11 rounded-xl border-border/70 bg-background/50 pl-10 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/60"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="you@example.com"
                      maxLength={255}
                      required
                      className="h-11 rounded-xl border-border/70 bg-background/50 pl-10 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/60"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subject" className="text-xs">Subject</Label>
                <div className="relative">
                  <MessageCircle className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                  <Input
                    id="subject"
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    placeholder="How can we help?"
                    maxLength={200}
                    required
                    className="h-11 rounded-xl border-border/70 bg-background/50 pl-10 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/60"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="message" className="text-xs">Message</Label>
                <div className="relative">
                  <PenLine className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-primary/70" />
                  <Textarea
                    id="message"
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    placeholder="Your message..."
                    rows={6}
                    maxLength={2000}
                    required
                    className="rounded-xl border-border/70 bg-background/50 pl-10 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/60"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-right">{form.message.length} / 2000</p>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full gradient-button text-white rounded-xl shadow-[0_12px_32px_-10px_rgba(124,92,255,0.65)] hover:brightness-110"
              >
                <Send className="w-4 h-4 mr-2" />
                {loading ? "Sending..." : "Send Message"}
              </Button>
            </form>
          </Card>
        </motion.div>
        <SeoIntro
          heading="How can we help?"
          paragraphs={[
            "UniGenius AI is built by a small student team, and feedback from students genuinely shapes what gets built next. Use this page for anything: a bug you spotted, a subject or topic page you want added, a lecture playlist you think belongs here, or an idea that would make studying easier for you. Questions about your account, Pro plans and payments are welcome too.",
            "We read every message. If your note is about a specific page or question, mentioning the subject and topic name helps us find it quickly and fix it faster.",
          ]}
        />
      </div>
    </PageShell>
  );
};

export default ContactPage;
