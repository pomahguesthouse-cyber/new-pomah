/**
 * /admin/pages — the visual page editor.
 *
 * The editor opens directly onto the public homepage document — there
 * is no separate "pages list" or "create page" step. The `home` landing
 * page is fetched (and seeded from the built-in template on first use)
 * inside the loader, which never throws: any failure is captured and
 * surfaced as a friendly in-app message instead of a crash page.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getOrCreateHomePage } from "@/admin/modules/builder/builder.functions";
import { PageEditor } from "@/admin/modules/builder/editor";
import type { LandingPageRow } from "@/admin/modules/builder/types";

export const Route = createFileRoute("/admin/pages")({
  loader: async () => {
    try {
      const res = await getOrCreateHomePage();
      return {
        page: (res?.page ?? null) as LandingPageRow | null,
        errorMessage: null as string | null,
      };
    } catch (err) {
      return {
        page: null as LandingPageRow | null,
        errorMessage: (err as Error)?.message ?? "Gagal memuat editor.",
      };
    }
  },
  errorComponent: ({ error }) => <EditorError message={(error as Error)?.message} />,
  component: EditorRoute,
});

function EditorError({ message }: { message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium">Editor tidak bisa dimuat</p>
      <p className="max-w-md text-xs text-muted-foreground">
        {message ?? "Pastikan tabel landing_pages sudah dibuat di database."}
      </p>
    </div>
  );
}

function EditorRoute() {
  const { page, errorMessage } = Route.useLoaderData();

  if (!page) return <EditorError message={errorMessage ?? undefined} />;

  return <PageEditor page={page} />;
}
