/**
 * /admin/pages — the visual page editor.
 *
 * The editor opens directly onto the public homepage document — there
 * is no separate "pages list" or "create page" step. The `home` landing
 * page is fetched (and seeded from the built-in template on first use)
 * and handed straight to <PageEditor>.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOrCreateHomePage } from "@/admin/modules/builder/builder.functions";
import { PageEditor } from "@/admin/modules/builder/editor";
import type { LandingPageRow } from "@/admin/modules/builder/types";

export const Route = createFileRoute("/admin/pages")({
  component: EditorRoute,
});

function EditorRoute() {
  const getFn = useServerFn(getOrCreateHomePage);

  const { data, isLoading, error } = useQuery({
    queryKey: ["home-editor-page"],
    queryFn: () => getFn(),
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Memuat editor…
      </div>
    );
  }

  if (error || !data?.page) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium">Editor tidak bisa dimuat</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {(error as Error)?.message ?? "Pastikan tabel landing_pages sudah dibuat di database."}
        </p>
      </div>
    );
  }

  return <PageEditor page={data.page as LandingPageRow} />;
}
