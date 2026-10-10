/** Below this viewport width the booking calendar hides the admin sidebar in a drawer. */
export const CALENDAR_DRAWER_BREAKPOINT = 1100;

export type CalendarGridMetrics = {
  labelWidth: number;
  cellWidth: number;
  rowHeight: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Approximate content width before the scrollport is measured.
 * Under the drawer breakpoint the sidebar is off-canvas, so the grid gets the viewport.
 */
export function guessCalendarContentWidth(viewportWidth: number): number {
  if (viewportWidth < CALENDAR_DRAWER_BREAKPOINT) return viewportWidth;
  return Math.max(320, viewportWidth - 256);
}

/**
 * Room column and day cell sizes from the grid scrollport width (CSS px).
 *
 * Cover (~344) shows about 4 days. Fold inner (~780–920) shows 12–14.
 * Wide content keeps the historical 72px day and 160px room column so a
 * desktop window shows at least as many days as before.
 */
export function calendarGridMetrics(containerWidth: number): CalendarGridMetrics {
  const width = Math.max(280, Math.floor(containerWidth || 0));

  if (width < 420) {
    const labelWidth = 88;
    const cellWidth = clamp(Math.floor((width - labelWidth) / 4), 48, 68);
    return { labelWidth, cellWidth, rowHeight: 44 };
  }

  if (width < 700) {
    const labelWidth = 104;
    const cellWidth = clamp(Math.floor((width - labelWidth) / 6), 48, 72);
    return { labelWidth, cellWidth, rowHeight: 46 };
  }

  if (width < 1200) {
    const labelWidth = width < 900 ? 112 : 140;
    const days = width >= 1000 ? 14 : width >= 860 ? 13 : 12;
    const cellWidth = clamp(Math.floor((width - labelWidth) / days), 52, 76);
    return { labelWidth, cellWidth, rowHeight: 48 };
  }

  return { labelWidth: 160, cellWidth: 72, rowHeight: 60 };
}
