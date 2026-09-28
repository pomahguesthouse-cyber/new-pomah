import { lazy } from "react";

/**
 * Date pickers and the 360 viewer stay off the public entry chunk.
 * Route modules import these wrappers; the heavy modules load only when
 * a page actually renders them.
 */
export const DateRangePickerID = lazy(() =>
  import("@/components/ui/date-range-picker").then((m) => ({ default: m.DateRangePickerID })),
);

export const DatePickerID = lazy(() =>
  import("@/components/ui/date-picker").then((m) => ({ default: m.DatePickerID })),
);

export const Pannellum360Viewer = lazy(() =>
  import("@/admin/modules/walkthrough/pannellum-viewer").then((m) => ({
    default: m.Pannellum360Viewer,
  })),
);
