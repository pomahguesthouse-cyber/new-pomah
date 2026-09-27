import { createIsomorphicFn } from "@tanstack/react-start";
import { staffHintFromCookie } from "@/lib/auth-return";

/**
 * SSR cannot see the Supabase localStorage session. The login page sets a
 * non-secret `pomah_staff=1` cookie before the full-page hop to /admin.
 * Client navigations ignore this and call getUser() instead.
 */
export const requestHasStaffSessionHint = createIsomorphicFn()
  .server(async () => {
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      return staffHintFromCookie(getRequest().headers.get("cookie"));
    } catch (error) {
      console.error("[admin] staff session hint check failed:", error);
      return false;
    }
  })
  .client(() => false);
