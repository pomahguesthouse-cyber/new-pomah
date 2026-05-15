/**
 * /admin/pages — landing page index.
 *
 * Lists every page built with the Visual Page Builder and provides
 * create / duplicate / delete actions. Editing opens the full-screen
 * editor at /admin/pages/$id.
 */
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Pencil, Copy, Trash2, ExternalLink, LayoutTemplate } from "lucide-react";
import {
  listLandingPages,
  createLandingPage,
  duplicateLandingPage,
  deleteLandingPage,
} from "@/admin/modules/builder/builder.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/pages")({
  component: PagesIndex,
});

interface PageListItem {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published";
  updated_at: string;
  published_at: string | null;
}

function PagesIndex() {
  const listFn = useServerFn(listLandingPages);
  const duplicateFn = useServerFn(duplicateLandingPage);
  const deleteFn = useServerFn(deleteLandingPage);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["landing-pages"],
    queryFn: () => listFn(),
  });
  const pages = (data?.pages ?? []) as PageListItem[];

  const [createOpen, setCreateOpen] = useState(false);

  const duplicate = useMutation({
    mutationFn: (id: string) => duplicateFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landing-pages"] });
      toast.success("Page duplicated");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["landing-pages"] });
      toast.success("Page deleted");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6 p-6 md:p-10">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Visual Builder
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Pages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build and publish landing pages without code.
          </p>
        </div>
        <Button
          className="gap-1.5 bg-amber-700 text-white hover:bg-amber-800"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New page
        </Button>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : pages.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <Th>Page</Th>
                <Th>Status</Th>
                <Th>Last updated</Th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pages.map((page) => (
                <tr key={page.id} className="group hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      to="/admin/pages/$id"
                      params={{ id: page.id }}
                      className="font-medium hover:underline"
                    >
                      {page.title}
                    </Link>
                    <p className="font-mono text-[11px] text-muted-foreground">/p/{page.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        page.status === "published"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-stone-100 text-stone-500",
                      )}
                    >
                      {page.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(page.updated_at).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {page.status === "published" && (
                        <IconLink href={`/p/${page.slug}`} title="View live">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </IconLink>
                      )}
                      <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="Edit">
                        <Link to="/admin/pages/$id" params={{ id: page.id }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Duplicate"
                        disabled={duplicate.isPending}
                        onClick={() => duplicate.mutate(page.id)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        title="Delete"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm(`Delete "${page.title}"? This cannot be undone.`))
                            remove.mutate(page.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreatePageDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
      {children}
    </th>
  );
}

function IconLink({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </a>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <LayoutTemplate className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm font-medium">No pages yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Create your first landing page to get started.
      </p>
      <Button
        className="mt-5 gap-1.5 bg-amber-700 text-white hover:bg-amber-800"
        onClick={onCreate}
      >
        <Plus className="h-4 w-4" />
        New page
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create dialog                                                       */
/* ------------------------------------------------------------------ */

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function CreatePageDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const createFn = useServerFn(createLandingPage);
  const qc = useQueryClient();
  const navigate = Route.useNavigate();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, setPending] = useState(false);

  const reset = () => {
    setTitle("");
    setSlug("");
    setSlugTouched(false);
  };

  const submit = async () => {
    if (!title.trim()) return toast.error("Enter a page title");
    const finalSlug = slug.trim() || slugify(title);
    setPending(true);
    try {
      const res = await createFn({ data: { title: title.trim(), slug: finalSlug } });
      qc.invalidateQueries({ queryKey: ["landing-pages"] });
      toast.success("Page created");
      onOpenChange(false);
      reset();
      navigate({ to: "/admin/pages/$id", params: { id: res.id } });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New landing page</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Page title</Label>
            <Input
              autoFocus
              value={title}
              placeholder="Promo Akhir Tahun"
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Slug</Label>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-muted-foreground">/p/</span>
              <Input
                value={slug}
                placeholder="promo-akhir-tahun"
                className="font-mono"
                onChange={(e) => {
                  setSlug(slugify(e.target.value));
                  setSlugTouched(true);
                }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Lowercase letters, numbers and hyphens only.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-amber-700 text-white hover:bg-amber-800"
            disabled={pending}
            onClick={submit}
          >
            {pending ? "Creating…" : "Create & edit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
