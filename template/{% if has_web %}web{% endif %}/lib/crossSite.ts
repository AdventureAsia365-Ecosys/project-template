// Cross-site write guard: a state-changing request (POST, PUT, PATCH, DELETE) must come from this site. Browsers send
// Origin on such requests, and Sec-Fetch-Site on modern ones; either one naming another site refuses the request
// before it reaches a route handler (the BFF's CSRF defence, on top of SameSite cookies).

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type WriteCheck = { allowed: true } | { allowed: false; reason: string };

export function checkCrossSiteWrite(method: string, url: string, headers: Headers): WriteCheck {
  if (SAFE_METHODS.has(method.toUpperCase())) return { allowed: true };
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { allowed: false, reason: `sec-fetch-site ${fetchSite}` };
  }
  const origin = headers.get("origin");
  if (!origin) return fetchSite ? { allowed: true } : { allowed: false, reason: "no origin" };
  return origin === new URL(url).origin ? { allowed: true } : { allowed: false, reason: "foreign origin" };
}
