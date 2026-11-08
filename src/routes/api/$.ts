import { createFileRoute } from "@tanstack/react-router";
import { satelliteProxy } from '@/lib/satellite-proxy';

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

const CLOUDULTRA_UPSTREAM = "https://nowcasting.cptec.inpe.br";

async function passthrough(request: Request, upstreamUrl: string, ttl: number, contentType: string, errMsg: string) {
  const headers = new Headers(corsHeaders(request));
  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: { Accept: contentType === "image/png" ? "image/png" : "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    headers.set("Content-Type", upstream.headers.get("Content-Type") || contentType);
    headers.set("Cache-Control", upstream.ok ? `public, max-age=${ttl}` : "no-store");
    return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return json({ error: errMsg, details: String((error as Error)?.message || error) }, 502, { ...corsHeaders(request), "Cache-Control": "no-store" });
  }
}

async function cloudultra(request: Request, url: URL) {
  const h = corsHeaders(request);
  const okPath = (p: string) => /^[a-z0-9_~.-]{4,180}$/i.test(p);
  const err = "CloudUltra Res temporariamente indisponível.";
  if (url.pathname === "/api/cloudultra/catalog") {
    return passthrough(request, `${CLOUDULTRA_UPSTREAM}/api/v1/paths/catalog`, 60, "application/json; charset=utf-8", err);
  }
  if (url.pathname === "/api/cloudultra/times") {
    const path = url.searchParams.get("path") || "";
    if (!okPath(path)) return json({ error: "Caminho de produto inválido." }, 400, h);
    return passthrough(request, `${CLOUDULTRA_UPSTREAM}/api/v1/paths/radar/layers/${encodeURIComponent(path)}/times`, 45, "application/json; charset=utf-8", err);
  }
  if (url.pathname === "/api/cloudultra/frame") {
    const path = url.searchParams.get("path") || "";
    const time = url.searchParams.get("time") || "";
    const version = url.searchParams.get("version") || "";
    if (!okPath(path) || !/^\d{12}$/.test(time) || !/^\d{6,16}$/.test(version)) {
      return json({ error: "Parâmetros de quadro inválidos." }, 400, h);
    }
    return passthrough(request, `${CLOUDULTRA_UPSTREAM}/api/v1/paths/frames/radar/${encodeURIComponent(path)}/${time}/full?v=${encodeURIComponent(version)}`, 600, "image/png", err);
  }
  return json({ error: "Rota CloudUltra Res não encontrada." }, 404, h);
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
  if (url.pathname.startsWith('/api/cptec/')) {
    const response = await satelliteProxy(request);
    if (response) return response;
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    return json({ error: "Método não permitido." }, 405, corsHeaders(request));
  }
  if (url.pathname === "/api/cptec-nowcast/frame") return nowcast(request, url);
  if (url.pathname.startsWith("/api/cloudultra/")) return cloudultra(request, url);
  if (url.pathname === "/api/inmet/avisos") {
    return passthrough(request, "https://apiprevmet3.inmet.gov.br/avisos/ativos", 60, "application/json; charset=utf-8", "API oficial de avisos do INMET indisponível.");
  }
  if (BACKEND_PREFIXES.some((p) => url.pathname.startsWith(p))) return proxyToBackend(request, url);
  return json({ error: "Not found" }, 404, corsHeaders(request));
}

export const Route = createFileRoute("/api/$")({
  server: { handlers: { GET: handle, HEAD: handle, OPTIONS: handle, POST: handle } },
});
