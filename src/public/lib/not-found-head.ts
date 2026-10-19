/** Root head helpers for 404 renders (exactly one <title> + noindex). */
export const NOT_FOUND_TITLE = "404 – Halaman Tidak Ditemukan | Pomah Guesthouse";

/** True when the router is rendering a not-found (unmatched path or thrown notFound()). */
export function isNotFoundRender(
  matches: ReadonlyArray<unknown> | undefined,
): boolean {
  // router-core marks the boundary: root gets `_notFound`, others `status: "notFound"`.
  return (matches ?? []).some((raw) => {
    const m = raw as { status?: string; _notFound?: boolean; globalNotFound?: boolean };
    return m.status === "notFound" || m._notFound === true || m.globalNotFound === true;
  });
}
