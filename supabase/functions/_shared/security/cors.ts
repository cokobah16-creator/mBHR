// Origin-allowlisted CORS for Supabase edge functions.
//
// The ALLOWED_ORIGINS env var is a comma-separated list of exact origins
// (https://app.example.com, https://staging.example.com, etc). If unset,
// the helper falls back to "*" for development convenience but logs a
// warning at cold-start so a missing prod config is visible.
//
// Usage:
//   const cors = corsHeadersFor(req);
//   if (req.method === "OPTIONS") return new Response(null, { headers: cors });
//   return new Response(body, { headers: { ...cors, "Content-Type": "application/json" } });

const COMMON_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

function allowlist(): string[] | null {
  const raw = (
    globalThis as { Deno?: { env: { get(k: string): string | undefined } } }
  ).Deno?.env.get("ALLOWED_ORIGINS");
  if (!raw || raw.trim() === "") return null;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

let warnedMissing = false;

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const list = allowlist();

  if (list === null) {
    if (!warnedMissing) {
      console.warn(
        "[cors] ALLOWED_ORIGINS env var is unset; falling back to '*'. Set it for production.",
      );
      warnedMissing = true;
    }
    return { ...COMMON_HEADERS, "Access-Control-Allow-Origin": "*" };
  }

  if (origin && list.includes(origin)) {
    return { ...COMMON_HEADERS, "Access-Control-Allow-Origin": origin };
  }

  // Origin not in allowlist: still echo CORS headers so the browser
  // surfaces a clear "blocked by CORS" rather than a network error, but
  // pick the first allowed origin so the preflight at least completes.
  return {
    ...COMMON_HEADERS,
    "Access-Control-Allow-Origin": list[0] ?? "null",
  };
}
