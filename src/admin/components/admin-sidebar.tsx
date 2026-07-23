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
  View,
  AlertTriangle,
  Bell,
  Send,
  Newspaper,
  TrendingUp,
  LifeBuoy,
  Brain,
  BrainCircuit,
  Link2,
  Route as RouteIcon,
  Activity,
  GripVertical,
  Users,
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
      { to: "/admin/walkthrough", label: "360 Virtual Tour", icon: View },
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
      { to: "/admin/contacts", label: "Contacts", icon: Users },
      { to: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { to: "/admin/webchat", label: "Web Chat", icon: MessageCircle },
      { to: "/admin/telegram", label: "Telegram", icon: Send },
      { to: "/admin/complaints", label: "Komplain", icon: AlertTriangle },
      { to: "/admin/handoff", label: "Human Handoff", icon: LifeBuoy },
      { to: "/admin/booking-form-logs", label: "Log Form Booking", icon: Link2 },
      { to: "/admin/notifications", label: "Log Notifikasi", icon: Bell },
      { to: "/admin/ai-lab", label: "AI Lab", icon: FlaskConical },
      { to: "/admin/whatsapp-corrections", label: "WhatsApp Corrections", icon: BrainCircuit },
      { to: "/admin/training", label: "Chatbot Training", icon: Brain },
      { to: "/admin/routing-debug", label: "Routing Debug", icon: RouteIcon },
      { to: "/admin/health", label: "Health Chatbot", icon: Activity },
      { to: "/admin/wpp-diagnostics", label: "WPP Diagnostics", icon: Activity },
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

const SIDEBAR_STORAGE_KEY = "admin-sidebar:order:v3";
const LEGACY_STORAGE_KEYS = ["admin-sidebar:order:v1", "admin-sidebar:order:v2"];

type PersistedOrder = { groups: Array<{ label: string; paths: string[] }> };

function isPersistedOrder(value: unknown): value is PersistedOrder {
  if (!value || typeof value !== "object") return false;
  const groups = (value as { groups?: unknown }).groups;
  return (
    Array.isArray(groups) &&
    groups.every(
      (group) =>
        group &&
        typeof group === "object" &&
        typeof (group as { label?: unknown }).label === "string" &&
        Array.isArray((group as { paths?: unknown }).paths) &&
        (group as { paths: unknown[] }).paths.every((path) => typeof path === "string"),
    )
  );
}

function readStored(): PersistedOrder | null {
  if (typeof window === "undefined") return null;

  try {
    const keys = [SIDEBAR_STORAGE_KEY, ...LEGACY_STORAGE_KEYS];

    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      const parsed: unknown = JSON.parse(raw);
      if (!isPersistedOrder(parsed)) {
        window.localStorage.removeItem(key);
        continue;
      }

      if (key !== SIDEBAR_STORAGE_KEY) {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(parsed));
        window.localStorage.removeItem(key);
      }

      return parsed;
    }
  } catch {
    // localStorage can be blocked or contain malformed JSON.
  }

  return null;
}

function writeStored(order: PersistedOrder): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(order));
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Reordering still works for the current session when storage is unavailable.
  }
}

function getDefaultGroupByPath(defaults: NavGroup[]): Map<string, string> {
  const groupByPath = new Map<string, string>();
  for (const group of defaults) {
    for (const item of group.items) groupByPath.set(item.to, group.label);
  }
  return groupByPath;
}

function mergeWithDefaults(stored: PersistedOrder | null, defaults: NavGroup[]): NavGroup[] {
  const itemByPath = new Map<string, NavItem>();
  for (const group of defaults) {
    for (const item of group.items) itemByPath.set(item.to, item);
  }

  const defaultGroupByPath = getDefaultGroupByPath(defaults);
  const placed = new Set<string>();
  const storedByLabel = new Map<string, string[]>(
    (stored?.groups ?? []).map((group) => [group.label, group.paths]),
  );

  const result: NavGroup[] = defaults.map((group) => {
    const orderedItems: NavItem[] = [];
    for (const path of storedByLabel.get(group.label) ?? []) {
      const item = itemByPath.get(path);
      if (item && !placed.has(path) && defaultGroupByPath.get(path) === group.label) {
        orderedItems.push(item);
        placed.add(path);
      }
    }
    return { label: group.label, items: orderedItems };
  });

  for (let index = 0; index < defaults.length; index++) {
    for (const item of defaults[index].items) {
      if (!placed.has(item.to)) {
        result[index].items.push(item);
        placed.add(item.to);
      }
    }
  }

  return result;
}

function toPersisted(groups: NavGroup[]): PersistedOrder {
  return {
    groups: groups.map((group) => ({
      label: group.label,
      paths: group.items.map((item) => item.to),
    })),
  };
}

function SortableNavRow({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.to,
  });

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
          {!collapsed && (
            <span
              {...attributes}
              {...listeners}
              role="button"
              tabIndex={0}
              aria-label={`Pindahkan ${item.label}`}
              onClick={(event) => event.preventDefault()}
              className="ml-auto inline-flex h-5 w-5 cursor-grab items-center justify-center text-sidebar-foreground/40 opacity-0 transition-opacity hover:text-sidebar-foreground/80 focus:opacity-100 group-hover/item:opacity-100 active:cursor-grabbing"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AdminSidebar({ propertyName }: { propertyName?: string | null }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const brandingFn = useServerFn(getBrandingSettings);
  const { data: branding } = useQuery({
    queryKey: ["branding-settings"],
    queryFn: () => brandingFn(),
  });
  const logoUrl = branding?.logo_url ?? null;

  const [groups, setGroups] = useState<NavGroup[]>(() =>
    mergeWithDefaults(readStored(), DEFAULT_GROUPS),
  );

  useEffect(() => {
    setGroups((previous) => {
      const merged = mergeWithDefaults(toPersisted(previous), DEFAULT_GROUPS);
      writeStored(toPersisted(merged));
      return merged;
    });
  }, []);

  const findItemLocation = (id: string): { groupIdx: number; itemIdx: number } | null => {
    for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
      const itemIdx = groups[groupIdx].items.findIndex((item) => item.to === id);
      if (itemIdx !== -1) return { groupIdx, itemIdx };
    }
    return null;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const from = findItemLocation(String(active.id));
    if (!from) return;

    const overId = String(over.id);
    let targetGroupIdx: number;
    let targetItemIdx: number;

    if (overId.startsWith("group:")) {
      const label = overId.slice(6);
      targetGroupIdx = groups.findIndex((group) => group.label === label);
      if (targetGroupIdx === -1) return;
      targetItemIdx = groups[targetGroupIdx].items.length - 1;
    } else {
      const target = findItemLocation(overId);
      if (!target) return;
      targetGroupIdx = target.groupIdx;
      targetItemIdx = target.itemIdx;
    }

    // Menu can be reordered inside its existing section only.
    if (from.groupIdx !== targetGroupIdx) return;

    setGroups((previous) => {
      const next = previous.map((group) => ({ ...group, items: [...group.items] }));
      next[from.groupIdx].items = arrayMove(
        next[from.groupIdx].items,
        from.itemIdx,
        Math.max(0, targetItemIdx),
      );
      writeStored(toPersisted(next));
      return next;
    });
  };

  const isActive = (item: NavItem) =>
    item.exact ? path === item.to : path === item.to || path.startsWith(`${item.to}/`);

  const allIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of groups) {
      for (const item of group.items) ids.push(item.to);
      ids.push(`group:${group.label}`);
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
                collapsed
                  ? "h-8 w-8 object-contain"
                  : "h-10 w-auto max-w-[170px] object-contain"
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
            {groups.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-[0.18em]">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SortableNavRow
                        key={item.to}
                        item={item}
                        active={isActive(item)}
                        collapsed={collapsed}
                      />
                    ))}
                    <GroupDropZone label={group.label} empty={group.items.length === 0} />
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
