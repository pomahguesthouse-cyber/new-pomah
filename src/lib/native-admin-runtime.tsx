import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { startNativeAdmin } from "@/lib/native-admin";

/** Starts back-button, OAuth return, and push listeners inside the Android shell. */
export function NativeAdminRuntime() {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    void startNativeAdmin({
      // Notification taps open /admin/...?thread=<id> inside the running SPA.
      navigate: (href) => {
        const current = `${window.location.pathname}${window.location.search}`;
        if (href === current) return;
        routerRef.current.history.push(href);
      },
    }).then((handle) => {
      if (cancelled) handle.stop();
      else stop = handle.stop;
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return null;
}
