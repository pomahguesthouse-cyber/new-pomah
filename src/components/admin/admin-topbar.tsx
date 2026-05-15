import { useState, useEffect } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Search,
  Bell,
  Sun,
  Moon,
  LogOut,
  User as UserIcon,
  Settings as SettingsIcon,
  Sparkles,
  Command as CommandIcon,
} from "lucide-react";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/integrations/supabase/client";

const SECTION_TITLES: Record<string, string> = {
  "/": "Overview",
  "/bookings": "Bookings",
  "/rooms": "Rooms",
  "/pricing": "Pricing",
  "/whatsapp": "WhatsApp",
  "/ai": "AI Suggestions",
  "/training": "Training",
  "/analytics": "Analytics",
  "/seo": "SEO",
  "/settings": "Settings",
};

const COMMANDS = [
  { to: "/", label: "Overview" },
  { to: "/bookings", label: "Bookings" },
  { to: "/rooms", label: "Rooms" },
  { to: "/pricing", label: "Pricing" },
  { to: "/whatsapp", label: "WhatsApp" },
  { to: "/ai", label: "AI Suggestions" },
  { to: "/training", label: "Training" },
  { to: "/analytics", label: "Analytics" },
  { to: "/seo", label: "SEO" },
  { to: "/settings", label: "Settings" },
];

function initials(name?: string | null) {
  if (!name) return "P";
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AdminTopbar({
  fullName,
  email,
}: {
  fullName?: string | null;
  email?: string | null;
}) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  const title =
    SECTION_TITLES[path] ??
    (path !== "/" ? path.replace(/^\//, "").replace(/\b\w/g, (m) => m.toUpperCase()) : "Overview");

  // Cmd/Ctrl + K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/75 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 md:px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-1 h-5" />

        <div className="flex min-w-0 flex-col">
          <p className="truncate text-sm font-semibold leading-none tracking-tight">{title}</p>
          <p className="mt-0.5 hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
            Pomah Guesthouse · Single property
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Search trigger */}
          <button
            onClick={() => setOpen(true)}
            className="hidden h-9 w-64 items-center gap-2 rounded-md border border-input bg-card/40 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground md:flex"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 truncate">Search…</span>
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border border-border bg-muted/60 px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <CommandIcon className="h-3 w-3" />K
            </kbd>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </Button>

          {/* AI status */}
          <div className="hidden items-center gap-1.5 rounded-full border border-border bg-card/40 px-2.5 py-1 lg:flex">
            <Sparkles className="h-3 w-3 text-accent" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              AI
            </span>
            <span className="relative ml-0.5 flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
          </div>

          {/* Notifications */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
                <Bell className="h-4 w-4" />
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="border-b border-border p-3">
                <p className="text-sm font-semibold">Notifications</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Latest activity across your property</p>
              </div>
              <div className="max-h-72 overflow-auto">
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                  No notifications yet.
                </div>
              </div>
              <div className="border-t border-border p-2">
                <Button variant="ghost" size="sm" className="w-full justify-center text-xs" disabled>
                  View all
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Separator orientation="vertical" className="mx-1 h-5" />

          {/* Profile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 px-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                    {initials(fullName ?? email)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-[120px] truncate text-sm font-medium md:inline">
                  {fullName ?? email ?? "Staff"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm">{fullName ?? "Staff"}</span>
                  {email && (
                    <span className="text-xs font-normal text-muted-foreground">{email}</span>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
                <UserIcon className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
                <SettingsIcon className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Jump to a section…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Navigation">
            {COMMANDS.map((c) => (
              <CommandItem
                key={c.to}
                value={c.label}
                onSelect={() => {
                  setOpen(false);
                  navigate({ to: c.to });
                }}
              >
                {c.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
