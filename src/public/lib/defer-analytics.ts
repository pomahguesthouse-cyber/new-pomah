/**
 * Google tag / Tag Manager is injected from saved custom head HTML.
 * It stays off the network until the page has loaded or the guest
 * taps, so it does not share bandwidth with the hero image.
 */

const ANALYTICS_SRC = /googletagmanager\.com|google-analytics\.com|\/gtag\/js/i;
const ANALYTICS_INLINE = /\bgtag\s*\(|googletagmanager|google-analytics/i;

export function isAnalyticsSnippet(src: string, code: string): boolean {
  if (ANALYTICS_SRC.test(src)) return true;
  if (!src && ANALYTICS_INLINE.test(code)) return true;
  return false;
}

/** Run after window load, the first tap or key, or 5s — whichever is first. */
export function runAfterLoadOrInteraction(run: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let done = false;
  const cleanups: Array<() => void> = [];
  const fire = () => {
    if (done) return;
    done = true;
    for (const cleanup of cleanups) cleanup();
    run();
  };
  if (document.readyState === "complete") {
    const id = window.setTimeout(fire, 0);
    return () => window.clearTimeout(id);
  }
  window.addEventListener("load", fire, { once: true });
  cleanups.push(() => window.removeEventListener("load", fire));
  for (const eventName of ["pointerdown", "keydown"] as const) {
    window.addEventListener(eventName, fire, { once: true, passive: true });
    cleanups.push(() => window.removeEventListener(eventName, fire));
  }
  const timer = window.setTimeout(fire, 5000);
  cleanups.push(() => window.clearTimeout(timer));
  return () => {
    if (done) return;
    done = true;
    for (const cleanup of cleanups) cleanup();
  };
}

/**
 * Insert saved head markup. Verification meta tags go in immediately.
 * Analytics scripts wait until load or interaction.
 */
export function mountCustomHead(html: string): () => void {
  const added: Node[] = [];
  const deferred: HTMLScriptElement[] = [];
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.childNodes.forEach((node) => {
    if (node.nodeName === "SCRIPT") {
      const orig = node as HTMLScriptElement;
      const sc = document.createElement("script");
      Array.from(orig.attributes).forEach((attr) => sc.setAttribute(attr.name, attr.value));
      sc.textContent = orig.textContent;
      if (isAnalyticsSnippet(sc.getAttribute("src") || "", sc.textContent || "")) {
        deferred.push(sc);
      } else {
        document.head.appendChild(sc);
        added.push(sc);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const clone = node.cloneNode(true);
    document.head.appendChild(clone);
    added.push(clone);
  });
  const cancel = deferred.length
    ? runAfterLoadOrInteraction(() => {
        for (const sc of deferred) {
          document.head.appendChild(sc);
          added.push(sc);
        }
      })
    : () => {};
  return () => {
    cancel();
    added.forEach((node) => node.parentNode?.removeChild(node));
  };
}
