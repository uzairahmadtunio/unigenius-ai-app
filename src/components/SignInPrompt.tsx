import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { GraduationCap, Mail } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Premium sign-in prompt for guests who try a feature that needs an
 * account (Uzair, 2026-11-27): instead of a silent failure or a dead
 * disabled button, the visitor gets one clear, on-brand message —
 * sign in with Gmail, it is free and takes a few seconds.
 *
 * Usage: wrap the app in <SignInPromptProvider> (App.tsx) and call
 * const { promptSignIn } = useSignInPrompt(); promptSignIn("Viva Prep")
 * at the point where a guest hits the wall.
 */
const SignInPromptContext = createContext<{ promptSignIn: (feature: string) => void }>({
  promptSignIn: () => {},
});

export const useSignInPrompt = () => useContext(SignInPromptContext);

export const SignInPromptProvider = ({ children }: { children: ReactNode }) => {
  const [feature, setFeature] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const promptSignIn = useCallback((f: string) => setFeature(f), []);
  const close = useCallback(() => setFeature(null), []);

  const handleGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${location.pathname}` },
    });
    if (error) toast.error(error.message);
  };

  const handleEmail = () => {
    close();
    navigate("/auth", { state: { from: location.pathname } });
  };

  return (
    <SignInPromptContext.Provider value={{ promptSignIn }}>
      {children}
      <Dialog open={feature !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="sm:max-w-md rounded-3xl p-0 overflow-hidden">
          <div className="p-6 md:p-8 text-center space-y-5">
            <div className="mx-auto w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center shadow-lg">
              <GraduationCap className="w-7 h-7 text-primary-foreground" />
            </div>
            <DialogHeader className="space-y-2">
              <DialogTitle className="font-display text-xl md:text-2xl font-bold text-center">
                Sign in to continue
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground text-center leading-relaxed">
                {feature} needs a free account, so your work stays saved.
                Sign in with your Gmail — it only takes a few seconds.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2.5">
              <Button
                onClick={handleGoogle}
                className="w-full h-11 rounded-xl gradient-button text-primary-foreground font-semibold"
              >
                Continue with Google
              </Button>
              <Button
                onClick={handleEmail}
                variant="outline"
                className="w-full h-11 rounded-xl font-semibold gap-2"
              >
                <Mail className="w-4 h-4" /> Sign in with email
              </Button>
              <button
                onClick={close}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
              >
                Keep exploring first
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </SignInPromptContext.Provider>
  );
};
