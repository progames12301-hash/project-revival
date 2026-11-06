import { createFileRoute } from "@tanstack/react-router";

// Public proxy for Sideral's weather data sources (ported from the original Cloudflare worker).
// Only GET/HEAD/OPTIONS to whitelisted public-data prefixes; no private data involved.
const RADAR_BACKEND = "https://sideral-backend.onrender.com";
const BACKEND_PREFIXES = [
  "/api/glm/", "/api/redemet/", "/api/cemaden/", "/api/regional/",
  "/api/inea/", "/api/ipmet/", "/api/simepar/", "/api/rainviewer/",
  "/api/radar/", "/api/radar-v2/", "/api/cptec/",
];
const CACHEABLE_PREFIXES = [
  "/api/rainviewer/tile/", "/api/cemaden/radar/imagem", "/api/inea/image",
  "/api/regional/radar/image", "/api/simepar/image", "/api/ipmet/wms",
  "/api/cptec/satelite/tile", "/api/radar-v2/image",
];
const UPSTREAM_ATTEMPTS = 3;
const UPSTREAM_TIMEOUT_MS = 25000;
const RETRY_STATUSES = new Set([502, 503, 504]);

function corsHeaders(request: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range, Accept",
    "Access-Control-Expose-Headers": "Content-Type, Content-Range, Accept-Ranges",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function nowcast(request: Request, url: URL) {
  const path = url.searchParams.get("path");
  const time = url.searchParams.get("time");
  if (!path || !/^\d{12}$/.test(time || "")) {
    return json({ error: 'Parâmetros "path" e "time" (AAAAMMDDHHmm) são obrigatórios.' }, 400, corsHeaders(request));
  }
  const upstreamUrl = `https://nowcasting.cptec.inpe.br/api/v1/paths/frames/radar/${encodeURIComponent(path)}/${time}/full`;
  try {
    const upstream = await fetch(upstreamUrl, { method: request.method });
    const headers = new Headers(corsHeaders(request));
    headers.set("Content-Type", upstream.headers.get("Content-Type") || "image/png");
    headers.set("Cache-Control", upstream.ok ? "public, max-age=120" : "no-store");
    return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return json({ error: "CPTEC Nowcasting indisponível no momento.", details: String((error as Error).message) }, 502, corsHeaders(request));
  }
}

async function proxyToBackend(request: Request, url: URL) {
  const upstreamUrl = new URL(url.pathname + url.search, RADAR_BACKEND);
  const cacheable = CACHEABLE_PREFIXES.some((p) => url.pathname.startsWith(p));
  const upstreamHeaders: Record<string, string> = { Accept: request.headers.get("Accept") || "*/*" };
  for (const name of ["Range", "If-None-Match", "If-Modified-Since"]) {
    const v = request.headers.get(name);
    if (v) upstreamHeaders[name] = v;
  }
  let upstream: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt++) {
    try {
      upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      lastError = null;
      if (!RETRY_STATUSES.has(upstream.status) || attempt === UPSTREAM_ATTEMPTS) break;
      await upstream.body?.cancel();
    } catch (error) {
      lastError = error;
      upstream = null;
    }
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  if (!upstream) {
    return json(
      { error: "Backend temporariamente indisponível.", details: lastError ? String((lastError as Error).message || lastError) : "sem resposta" },
      502,
      { ...corsHeaders(request), "Cache-Control": "no-store" },
    );
  }
  const headers = new Headers(corsHeaders(request));
  for (const name of ["Content-Type", "ETag", "Last-Modified", "Content-Range", "Accept-Ranges"]) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set(
    "Cache-Control",
    upstream.ok ? upstream.headers.get("Cache-Control") || (cacheable ? "public, max-age=120" : "no-store") : "no-store",
  );
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}

async function handle({ request }: { request: Request }) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (!["GET", "HEAD"].includes(request.method)) {
    return json({ error: "Método não permitido." }, 405, corsHeaders(request));
  }
  if (url.pathname === "/api/cptec-nowcast/frame") return nowcast(request, url);
  if (BACKEND_PREFIXES.some((p) => url.pathname.startsWith(p))) return proxyToBackend(request, url);
  return json({ error: "Not found" }, 404, corsHeaders(request));
}

export const Route = createFileRoute("/api/$")({
  server: { handlers: { GET: handle, HEAD: handle, OPTIONS: handle, POST: handle } },
});
