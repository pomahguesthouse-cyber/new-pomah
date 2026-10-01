import { useEffect } from "react";

/**
 * Viewport untuk layar chat di HP / layar lipat (dipakai hanya di bawah lg).
 *
 * - `<html data-wa-chat>` + `--wa-vh` (= tinggi visualViewport): CSS di
 *   src/styles.css memakainya agar tinggi layar chat selalu setinggi area yang
 *   benar-benar terlihat, sehingga kolom balasan tidak tertutup keyboard walau
 *   WebView tidak melakukan adjustResize.
 * - `<html data-kb-open="true">` selama keyboard terbuka dan kolom ketik fokus:
 *   bottom nav disembunyikan supaya tidak menumpuk di atas kolom balasan.
 *   Deteksi memakai tinggi terbesar yang pernah terlihat pada lebar yang sama
 *   (lebar berubah = layar lipat dibuka/ditutup/rotasi -> reset).
 */
export function useKeyboardOpen(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    let baseWidth = window.innerWidth;
    let baseHeight = Math.max(window.innerHeight, vv?.height ?? 0);

    const isTextField = () => {
      const el = document.activeElement;
      return (
        !!el &&
        (el.tagName === "TEXTAREA" ||
          (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "file"))
      );
    };
    const update = () => {
      const height = Math.min(window.innerHeight, vv?.height ?? window.innerHeight);
      if (window.innerWidth !== baseWidth) {
        baseWidth = window.innerWidth;
        baseHeight = height;
      }
      baseHeight = Math.max(baseHeight, height);
      root.style.setProperty("--wa-vh", `${Math.round(height)}px`);
      const open = isTextField() && baseHeight - height > 120;
      if (open) root.dataset.kbOpen = "true";
      else delete root.dataset.kbOpen;
      // Browser bisa menggeser dokumen saat fokus; layar chat tidak boleh ikut tergeser.
      if (open && window.scrollY !== 0) window.scrollTo(0, 0);
    };

    root.dataset.waChat = "true";
    update();
    window.addEventListener("resize", update);
    vv?.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      window.removeEventListener("resize", update);
      vv?.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      delete root.dataset.kbOpen;
      delete root.dataset.waChat;
      root.style.removeProperty("--wa-vh");
    };
  }, [enabled]);
}
