import { GraduationCap, User, Moon, Sun, LogOut, RefreshCw, Settings, Bell, Shield, Share2, Menu, Info, MessageCircle as MessageCircleIcon, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NavItems } from "@/components/MainNav";
import { useState, useEffect } from "react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { useViewMode } from "@/contexts/ViewModeContext";
import ModeSwitcher from "@/components/ModeSwitcher";
import { useDepartment, departmentInfo } from "@/contexts/DepartmentContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotifications } from "@/hooks/use-notifications";
import { formatDistanceToNow } from "date-fns";
import { Trash2, CheckCheck } from "lucide-react";
import { PushSettingsPanel } from "@/components/PushSettingsPanel";

interface NavbarProps {
  onMenuToggle?: () => void;
  showMenu?: boolean;
}

const Navbar = ({ onMenuToggle, showMenu }: NavbarProps) => {
  const [isDark, setIsDark] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, signOut } = useAuth();
  const { isAdmin } = useAdmin();
  const { mode } = useViewMode();
  const { department, clearDepartment } = useDepartment();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // Use cached profile query — shared across app. Extended for the menu
  // drawer: the profile card needs the real display name and semester,
  // not just the avatar.
  const { data: profile } = useQuery({
    queryKey: ["profile-avatar", user?.id],
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url, display_name, current_semester")
        .eq("user_id", user!.id)
        .single();
      return {
        avatarUrl: data?.avatar_url || "",
        displayName: data?.display_name || null,
        currentSemester: data?.current_semester ?? null,
      };
    },
  });
  const avatarUrl = profile?.avatarUrl ?? "";

  // Use shared notice queries — same cache keys as NoticeBoard
  const { data: allNotices = [] } = useQuery({
    queryKey: ["university-notices"],
    queryFn: async () => {
      const { data } = await supabase
        .from("university_notices" as any)
        .select("*")
        .order("created_at", { ascending: false });
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: readIds = new Set<string>() } = useQuery({
    queryKey: ["notice-reads", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: reads } = await supabase
        .from("user_notice_reads" as any)
        .select("notice_id")
        .eq("user_id", user!.id);
      return new Set((reads || []).map((r: any) => r.notice_id));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const unreadNotices = allNotices.filter(
    (n: any) => !readIds.has(n.id) && (!n.expires_at || new Date(n.expires_at) > new Date())
  );
  const unreadNoticeCount = unreadNotices.length;
  const { notifications, unreadCount: unreadPersonal, markAllRead, remove: removeNotif } = useNotifications();
  const unreadCount = unreadNoticeCount + unreadPersonal;

  const handleBellOpen = (open: boolean) => {
    if (!open || !user) return;
    if (unreadNoticeCount > 0) {
      const toMark = [...unreadNotices];
      queryClient.setQueryData(["notice-reads", user.id], (old: Set<string> | undefined) => {
        const next = new Set(old);
        toMark.forEach((n: any) => next.add(n.id));
        return next;
      });
      const inserts = toMark.map((n: any) => ({ user_id: user.id, notice_id: n.id }));
      if (inserts.length > 0) supabase.from("user_notice_reads").insert(inserts as any);
    }
    if (unreadPersonal > 0) markAllRead();
  };

  // Drawer profile-card sub-line: real semester + real department name.
  // The email never appears in the drawer. Missing fields are simply
  // left out (graceful fallback).
  const profileSubParts: string[] = [];
  if (profile?.currentSemester) profileSubParts.push(`Semester ${profile.currentSemester}`);
  if (department) profileSubParts.push(departmentInfo[department].fullName);
  const profileSubLine = profileSubParts.join(" · ");

  return (
    <nav className="sticky top-0 z-40 bg-background/85 backdrop-blur-md border-b border-border">
      <div className="w-full mx-auto flex items-center justify-between h-16 px-4 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {onMenuToggle && (
            <Button variant="ghost" size="icon" className="rounded-lg md:hidden shrink-0" onClick={onMenuToggle} aria-label="Open navigation menu">
              <Menu className="w-5 h-5" />
            </Button>
          )}
          <div className="flex items-center gap-3 cursor-pointer min-w-0" onClick={() => navigate("/")}>
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center shrink-0">
              <GraduationCap className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base sm:text-lg font-display font-bold text-foreground truncate">
                UniGenius <span className="gradient-text">AI</span>
              </span>
              {department && (
                <span className="text-xs text-muted-foreground hidden lg:inline truncate">
                  — {departmentInfo[department].name}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Desktop / tablet inline actions */}
          <Button variant="ghost" size="sm" className="rounded-lg text-xs hidden sm:flex" onClick={() => navigate("/about")}>
            About
          </Button>
          <Button variant="ghost" size="sm" className="rounded-lg text-xs hidden sm:flex" onClick={() => navigate("/contact")}>
            Contact
          </Button>
          {/* Role switch (Panels Program Part A): only multi-mode
              accounts (teacher/admin) ever see this. In Student Mode
              nothing teacher/admin is visible anywhere. */}
          {user && (
            <div className="hidden md:block">
              <ModeSwitcher />
            </div>
          )}
          {mode === "teacher" && (
            <Button variant="ghost" size="sm" className="rounded-lg text-xs gap-1.5 hidden md:flex text-primary" onClick={() => navigate("/teacher-home")}>
              <GraduationCap className="w-3 h-3" /> Teacher Panel
            </Button>
          )}
          {mode === "admin" && isAdmin && (
            <Button variant="ghost" size="sm" className="rounded-lg text-xs gap-1.5 hidden md:flex text-primary" onClick={() => navigate("/admin")}>
              <Shield className="w-3 h-3" /> Admin
            </Button>
          )}
          {department && (
            <Button variant="ghost" size="sm" className="rounded-lg text-xs gap-1.5 hidden lg:flex" onClick={clearDepartment}>
              <RefreshCw className="w-3 h-3" /> Change Dept
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setIsDark(!isDark)} className="rounded-lg hidden sm:flex" aria-label="Toggle dark mode">
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>

          {user && (
            <Popover onOpenChange={handleBellOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-lg relative" aria-label="Notifications">
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[calc(100vw-2rem)] sm:w-96 p-0 rounded-lg" align="end">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <p className="font-display font-semibold text-sm">Notifications</p>
                  {unreadCount > 0 && (
                    <button onClick={() => handleBellOpen(true)} className="text-[10px] text-primary hover:underline flex items-center gap-1">
                      <CheckCheck className="w-3 h-3" /> Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {unreadNotices.length === 0 && notifications.length === 0 ? (
                    <p className="p-6 text-xs text-muted-foreground text-center">All caught up! 🎉</p>
                  ) : (
                    <>
                      {unreadNotices.slice(0, 5).map((n: any) => (
                        <div key={n.id} className="p-3 border-b border-border/30 hover:bg-muted/50 transition-colors">
                          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">📢 {n.title}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{n.content}</p>
                        </div>
                      ))}
                      {notifications.slice(0, 15).map((n) => (
                        <div
                          key={n.id}
                          onClick={() => { if (n.link) navigate(n.link); }}
                          className={`p-3 border-b border-border/30 hover:bg-muted/50 transition-colors group ${n.link ? "cursor-pointer" : ""} ${!n.read_at ? "bg-primary/5" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                {n.title}
                              </p>
                              {n.body && <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                              <p className="text-[9px] text-muted-foreground/70 mt-1">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); removeNotif(n.id); }}
                              className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive shrink-0"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                <PushSettingsPanel />
              </PopoverContent>
            </Popover>
          )}
          {user ? (
            <div className="flex items-center gap-1.5">
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="rounded-lg hidden md:flex"
                      aria-label="Invite friends via WhatsApp"
                      onClick={() => {
                        const msg = `Check out UniGenius AI – The ultimate assistant for Software Engineering students. Fix C++ code, generate lab manuals, track attendance, and more. Join here: ${window.location.origin} — Built by Uzair Ahmad`;
                        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
                      }}
                    >
                      <Share2 className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p className="text-xs">Invite Friends</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button variant="ghost" size="icon" className="rounded-lg hidden md:flex" onClick={() => navigate("/profile")} aria-label="Profile settings">
                <Settings className="w-4 h-4" />
              </Button>
              <Avatar className="w-8 h-8 cursor-pointer ring-2 ring-primary/40 ring-offset-1 ring-offset-background transition-transform duration-200 hover:scale-105 active:scale-95" onClick={() => navigate("/profile")}>
                <AvatarImage src={avatarUrl} className="object-cover" />
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                  {user.email?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <Button variant="ghost" size="icon" className="rounded-lg hidden md:flex" onClick={signOut} aria-label="Sign out">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="rounded-lg hidden sm:flex" onClick={() => navigate("/auth")}>
              <User className="w-4 h-4 mr-1" /> Sign In
            </Button>
          )}

          {/* Mobile burger menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-lg" aria-label="Open menu">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85vw] max-w-sm p-0 flex flex-col">
              <SheetHeader className="p-5 border-b border-border text-left">
                <SheetTitle className="font-display text-base flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-primary" /> Menu
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {user && (
                  <div className="px-1 pb-2">
                    <ModeSwitcher full />
                  </div>
                )}
                {user && (
                  <button
                    onClick={() => { setMobileOpen(false); navigate("/profile"); }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors text-left"
                  >
                    <Avatar className="w-10 h-10 ring-2 ring-primary/40 ring-offset-1 ring-offset-background shrink-0">
                      <AvatarImage src={avatarUrl} className="object-cover" />
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                        {(profile?.displayName || user.email || "?").charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {profile?.displayName || "My Profile"}
                      </p>
                      {profileSubLine && (
                        <p className="text-[11px] text-muted-foreground truncate">{profileSubLine}</p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                )}

                {user && (
                  <div className="pb-3 mb-1 border-b border-border">
                    <NavItems onNavigate={() => setMobileOpen(false)} />
                  </div>
                )}

                <MobileMenuItem icon={Info} label="About" onClick={() => { setMobileOpen(false); navigate("/about"); }} />
                <MobileMenuItem icon={MessageCircleIcon} label="Contact" onClick={() => { setMobileOpen(false); navigate("/contact"); }} />
                {mode === "teacher" && (
                  <MobileMenuItem icon={GraduationCap} label="Teacher Panel" highlight onClick={() => { setMobileOpen(false); navigate("/teacher-home"); }} />
                )}
                {/* Admin + Settings live only in NavItems above — the old
                    duplicate "Admin Dashboard" and "Settings" rows that
                    used to sit here were removed (Batch 2 dedupe). */}
                {department && (
                  <MobileMenuItem icon={RefreshCw} label="Change Department" onClick={() => { setMobileOpen(false); clearDepartment(); }} />
                )}
                <MobileMenuItem
                  icon={Share2}
                  label="Invite Friends"
                  onClick={() => {
                    setMobileOpen(false);
                    const msg = `Check out UniGenius AI – The ultimate assistant for Software Engineering students. Join here: ${window.location.origin} — Built by Uzair Ahmad`;
                    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
                  }}
                />
                <div className="w-full flex items-center gap-3 p-3 rounded-lg text-left text-foreground">
                  {isDark ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
                  <span className="text-sm font-medium flex-1">Light Mode</span>
                  <Switch
                    checked={!isDark}
                    onCheckedChange={(checked) => setIsDark(!checked)}
                    aria-label="Toggle light mode"
                  />
                </div>
              </div>
              <div className="p-3 border-t border-border">
                {user ? (
                  <button
                    onClick={() => { setMobileOpen(false); signOut(); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-rose-600 dark:text-rose-300/90 hover:bg-rose-500/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium">Sign Out</span>
                  </button>
                ) : (
                  <Button className="w-full rounded-lg text-xs gradient-primary" onClick={() => { setMobileOpen(false); navigate("/auth"); }}>
                    <User className="w-4 h-4 mr-2" /> Sign In
                  </Button>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
};

const MobileMenuItem = ({
  icon: Icon,
  label,
  onClick,
  highlight,
}: {
  icon: any;
  label: string;
  onClick: () => void;
  highlight?: boolean;
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors text-left ${highlight ? "text-primary" : "text-foreground"}`}
  >
    <Icon className="w-4 h-4 shrink-0" />
    <span className="text-sm font-medium">{label}</span>
  </button>
);

export default Navbar;
