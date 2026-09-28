import { useEffect } from "react";
import { startNativeAdmin } from "@/lib/native-admin";

/** Starts back-button, OAuth return, and push listeners inside the Android shell. */
export function NativeAdminRuntime() {
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    void startNativeAdmin().then((handle) => {
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
