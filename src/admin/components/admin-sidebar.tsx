import { useEffect, useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  LayoutDashboard,
  CalendarDays,
  BedDouble,
  DollarSign,
  BarChart3,
  Search,
  Settings,
  LayoutTemplate,
  FlaskConical,
  MessageCircle,
  Images,
  Compass,
  AlertTriangle,
  Bell,
  Send,
  Newspaper,
  TrendingUp,
  LifeBuoy,
  Brain,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { getBrandingSettings } from "@/admin/modules/settings/settings.functions";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

// ─── Default nav structure (source of truth for icons + paths) ────────────────

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

type NavGroup = { label: string; items: NavItem[] };

const DEFAULT_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
      { to: "/admin/calendar", label: "Calendar", icon: CalendarDays },
      { to: "/admin/bookings", label: "Bookings", icon: CalendarDays },
      { to: "/admin/rooms", label: "Rooms", icon: BedDouble },
      { to: "/admin/media", label: "Media Library", icon: Images },
      { to: "/admin/pages", label: "Page Builder", icon: LayoutTemplate },
      { to: "/admin/explore", label: "City Guide", icon: Compass },
      { to: "/admin/content-manager", label: "Content Manager", icon: Newspaper },
      { to: "/admin/pricing-calendar", label: "Calendar Pricing", icon: DollarSign },
      { to: "/admin/competitor-prices", label: "PriceS Analyst", icon: TrendingUp },
    ],
  },
  {
    label: "Guests & Comms",
    items: [
      { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { to: "/admin/webchat", label: "Web Chat", icon: MessageCircle },
      { to: "/admin/telegram", label: "Telegram", icon: Send },
      { to: "/admin/complaints", label: "Komplain", icon: AlertTriangle },
      { to: "/admin/handoff", label: "Human Handoff", icon: LifeBuoy },
      { to: "/admin/notifications", label: "Log Notifikasi", icon: Bell },
      { to: "/admin/ai-lab", label: "AI Lab", icon: FlaskConical },
      { to: "/admin/training", label: "Chatbot Training", icon: Brain },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/admin/seo", label: "SEO", icon: Search },
    ],
  },
  {
    label: "System",
    items: [{ to: "/admin/settings", label: "Settings", icon: Settings }],
  },
];

// Bumped if the persisted format changes incompatibly.
const STORAGE_KEY = "admin-sidebar:order:v1";

// ─── Persistence ──────────────────────────────────────────────────────────────

/** Persisted shape: just the path list per group label. Tiny, forward-compatible. */
type PersistedOrder = { groups: Array<{ label: string; paths: string[] }> };

function readStored(): PersistedOrder | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedOrder;
    if (!parsed || !Array.isArray(parsed.groups)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(order: PersistedOrder): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* localStorage may be unavailable (private mode quota) — ignore. */
  }
}

/**
 * Merge stored order with the default nav so:
 *  • Items removed from the code are pruned from saved state.
 *  • Items NEW in the code (added in a deploy) appear in their default
 *    section at the end, instead of vanishing because they weren't in
 *    the user's saved order.
 *  • Group labels and order follow the code (sections are not user-reorderable).
 */
function mergeWithDefaults(
  stored: PersistedOrder | null,
  defaults: NavGroup[],
): NavGroup[] {
  const itemByPath = new Map<string, NavItem>();
  for (const g of defaults) {
    for (const it of g.items) itemByPath.set(it.to, it);
  }

  // Track which paths the stored order has already placed somewhere.
  const placed = new Set<string>();
  const storedByLabel = new Map<string, string[]>(
    (stored?.groups ?? []).map((g) => [g.label, g.paths]),
  );

  // First pass: honour stored order for each group, filtering out paths
  // that no longer exist in the code.
  const result: NavGroup[] = defaults.map((g) => {
    const storedPaths = storedByLabel.get(g.label) ?? [];
    const orderedItems: NavItem[] = [];
    for (const p of storedPaths) {
      const item = itemByPath.get(p);
      if (item && !placed.has(p)) {
        orderedItems.push(item);
        placed.add(p);
      }
    }
    return { label: g.label, items: orderedItems };
  });

  // Second pass: drop any default items that weren't placed by the stored
  // order at the end of their default group. New code-introduced items
  // appear here.
  for (let i = 0; i < defaults.length; i++) {
    for (const item of defaults[i].items) {
      if (!placed.has(item.to)) {
        result[i].items.push(item);
        placed.add(item.to);
      }
    }
  }

  return result;
}

function toPersisted(groups: NavGroup[]): PersistedOrder {
  return {
    groups: groups.map((g) => ({ label: g.label, paths: g.items.map((it) => it.to) })),
  };
}

// ─── Sortable row ─────────────────────────────────────────────────────────────

function SortableNavRow({
  item, active, collapsed,
}: { item: NavItem; active: boolean; collapsed: boolean }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: item.to });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <SidebarMenuItem ref={setNodeRef} style={style}>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={item.label}
        className="group/item relative"
      >
        <Link to={item.to}>
          {active && (
            <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
          )}
          <item.icon className="h-4 w-4" />
          <span className="flex-1 truncate">{item.label}</span>
          {/* Drag handle: only visible on hover when sidebar is expanded.
              Sensor activation distance (5px) keeps single clicks navigating. */}
          {!collapsed && (
            <span
              {...attributes}
              {...listeners}
              role="button"
              tabIndex={-1}
              aria-label={`Pindahkan ${item.label}`}
              onClick={(e) => e.preventDefault()}
              className="ml-auto inline-flex h-5 w-5 cursor-grab items-center justify-center text-sidebar-foreground/40 opacity-0 transition-opacity hover:text-sidebar-foreground/80 group-hover/item:opacity-100 active:cursor-grabbing"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

// ─── Top-level component ──────────────────────────────────────────────────────

export function AdminSidebar({ propertyName }: { propertyName?: string | null }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const brandingFn = useServerFn(getBrandingSettings);
  const { data: branding } = useQuery({
    queryKey: ["branding-settings"],
    queryFn: () => brandingFn(),
  });
  const logoUrl = branding?.logo_url ?? null;

  // Hydrate nav arrangement from localStorage synchronously.
  const [groups, setGroups] = useState<NavGroup[]>(() =>
    mergeWithDefaults(readStored(), DEFAULT_GROUPS),
  );

  // Re-merge when DEFAULT_GROUPS changes between deploys (handled by
  // mergeWithDefaults's "new items go to default group end" rule). Cheap
  // to run on every mount; nothing happens unless something differs.
  useEffect(() => {
    setGroups((prev) => {
      const merged = mergeWithDefaults(toPersisted(prev), DEFAULT_GROUPS);
      // Persist only if the merge actually changed anything so we don't
      // write on every mount.
      const before = JSON.stringify(prev);
      const after  = JSON.stringify(merged);
      if (before !== after) writeStored(toPersisted(merged));
      return merged;
    });
  }, []);

  // Lookup: which group does a given path live in right now?
  const findItemLocation = (id: string): { groupIdx: number; itemIdx: number } | null => {
    for (let gi = 0; gi < groups.length; gi++) {
      const ii = groups[gi].items.findIndex((it) => it.to === id);
      if (ii !== -1) return { groupIdx: gi, itemIdx: ii };
    }
    return null;
  };

  const sensors = useSensors(
    // 5px activation distance so plain clicks on the Link still navigate.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const from = findItemLocation(String(active.id));
    if (!from) return;

    // `over.id` is either another item path (drop on a row) or a group
    // sentinel "group:<label>" (drop on an empty section's drop zone).
    let targetGroupIdx: number;
    let targetItemIdx: number;
    const overId = String(over.id);

    if (overId.startsWith("group:")) {
      const label = overId.slice(6);
      targetGroupIdx = groups.findIndex((g) => g.label === label);
      if (targetGroupIdx === -1) return;
      targetItemIdx = groups[targetGroupIdx].items.length; // append
    } else {
      const to = findItemLocation(overId);
      if (!to) return;
      targetGroupIdx = to.groupIdx;
      targetItemIdx  = to.itemIdx;
    }

    setGroups((prev) => {
      // Clone arrays we touch; leave the rest by reference.
      const next = prev.map((g) => ({ ...g, items: [...g.items] }));
      const [moved] = next[from.groupIdx].items.splice(from.itemIdx, 1);
      // Same-group reorder uses arrayMove semantics so dragging down past
      // the original spot lands correctly.
      if (from.groupIdx === targetGroupIdx) {
        const restored = next[from.groupIdx].items;
        restored.splice(from.itemIdx, 0, moved); // undo splice for arrayMove
        next[from.groupIdx].items = arrayMove(restored, from.itemIdx, targetItemIdx);
      } else {
        next[targetGroupIdx].items.splice(targetItemIdx, 0, moved);
      }
      writeStored(toPersisted(next));
      return next;
    });
  };

  const isActive = (item: NavItem) =>
    item.exact ? path === item.to : path === item.to || path.startsWith(item.to + "/");

  // All sortable IDs across the sidebar, plus per-group sentinels so empty
  // sections still accept drops.
  const allIds = useMemo(() => {
    const ids: string[] = [];
    for (const g of groups) {
      for (const it of g.items) ids.push(it.to);
      ids.push(`group:${g.label}`);
    }
    return ids;
  }, [groups]);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader>
        <Link
          to="/admin"
          className="flex items-center justify-center px-2 py-1.5"
          title={propertyName ?? "Dashboard"}
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={propertyName ?? "Logo"}
              className={
                collapsed ? "h-8 w-8 object-contain" : "h-10 w-auto max-w-[170px] object-contain"
              }
            />
          ) : (
            <span className="truncate font-mono text-[13px] font-semibold tracking-tight">
              {collapsed ? "P" : (propertyName ?? "POMAH")}
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
            {groups.map((g) => (
              <SidebarGroup key={g.label}>
                <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-[0.18em]">
                  {g.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {g.items.map((item) => (
                      <SortableNavRow
                        key={item.to}
                        item={item}
                        active={isActive(item)}
                        collapsed={collapsed}
                      />
                    ))}
                    {/* Hidden drop sentinel so an empty section is still a valid
                        drop target (height 0 — invisible but pickable by closestCenter). */}
                    <GroupDropZone label={g.label} empty={g.items.length === 0} />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SortableContext>
        </DndContext>
      </SidebarContent>

      <SidebarFooter>
        {!collapsed && (
          <div className="rounded-md border border-sidebar-border/60 bg-sidebar-accent/40 px-3 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
              AI Concierge
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-sidebar-foreground">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              All systems nominal
            </p>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * Invisible drop zone at the bottom of each group. When the group is non-empty
 * it occupies 0 height (just a sortable hook for cross-group drops at end).
 * When empty it gives the user a tangible "drop here" affordance.
 */
function GroupDropZone({ label, empty }: { label: string; empty: boolean }) {
  const { setNodeRef, isOver } = useSortable({ id: `group:${label}` });
  return (
    <li
      ref={setNodeRef}
      aria-hidden={!empty}
      className={
        empty
          ? `mt-1 rounded-md border border-dashed px-2 py-2 text-center text-[11px] text-sidebar-foreground/40 ${
              isOver ? "border-primary bg-primary/5" : "border-sidebar-border/60"
            }`
          : `h-1 ${isOver ? "rounded bg-primary/40" : ""}`
      }
    >
      {empty ? "Drop di sini" : null}
    </li>
  );
}
