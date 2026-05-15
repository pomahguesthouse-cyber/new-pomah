/**
 * /admin/pages/$id — the full-screen Visual Page Builder editor.
 *
 * Loads the landing page document, then hands off to <PageEditor>,
 * which owns the canvas, panels, autosave and publish flow.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLandingPage } from "@/admin/modules/builder/builder.functions";
import { PageEditor } from "@/admin/modules/builder/editor";
import type { LandingPageRow } from "@/admin/modules/builder/types";

export const Route = createFileRoute("/admin/pages/$id")({
  component: EditorRoute,
});

function EditorRoute() {
  const { id } = Route.useParams();
  const getFn = useServerFn(getLandingPage);

  const { data, isLoading, error } = useQuery({
    queryKey: ["landing-page", id],
    queryFn: () => getFn({ data: { id } }),
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading editor…
      </div>
    );
  }

  if (error || !data?.page) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium">Page not found</p>
        <p className="text-xs text-muted-foreground">
          {(error as Error)?.message ?? "This page may have been deleted."}
        </p>
      </div>
    );
  }

  return <PageEditor page={data.page as LandingPageRow} />;
}
