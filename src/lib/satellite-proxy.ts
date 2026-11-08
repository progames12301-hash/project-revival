import { z } from 'zod';

const product = z.object({ type: z.literal('layer'), workspace: z.literal('path-satelite'), layer: z.string().regex(/^path-satelite:(goes19_web|rgb|vento)~[a-z0-9_]+$/) });
const timesBody = z.object({ items: z.array(product).min(1).max(10) }).strict();

export function allowedSatellitePath(path: string, method: string) {
  if (path.includes('..') || path.includes('\\')) return false;
  if (path === 'products/times') return method === 'POST';
  if (method !== 'GET' && method !== 'HEAD') return false;
  return ['paths/catalog', 'geojson-products/catalog', 'geojson-products/payloads', 'geojson-products/static/path--satelite-2--last_forecast/latest'].includes(path)
    || /^paths\/frames\/satelite\/(goes19_web|rgb|vento)~[a-z0-9_]+\/\d{12}\/full$/.test(path)
    || /^paths\/satelite\/layers\/goes19_web~tathu_web~diag\/legend$/.test(path)
    || path === 'paths/satelite-2/layers/last_forecast/legend';
}

export async function satelliteProxy(request: Request) {
  const url = new URL(request.url);
  let path: string;
  try { path = decodeURIComponent(url.pathname.slice('/api/cptec/'.length)); }
  catch { return Response.json({ error: 'Caminho inválido.' }, { status: 400 }); }
  if (!allowedSatellitePath(path, request.method)) return null;
  let body: string | undefined;
  if (request.method === 'POST') {
    if (Number(request.headers.get('content-length')) > 8192) return new Response(null, { status: 413 });
    const raw = await request.text();
    if (raw.length > 8192) return new Response(null, { status: 413 });
    try { body = JSON.stringify(timesBody.parse(JSON.parse(raw))); }
    catch { return Response.json({ error: 'Produto de satélite inválido.' }, { status: 400 }); }
  }
  try {
    const upstream = await fetch(new URL(`/api/v1/${path}${url.search}`, 'https://nowcasting.cptec.inpe.br'), {
      method: request.method, body, signal: AbortSignal.timeout(20000),
      headers: { Accept: request.headers.get('Accept') || '*/*', 'Content-Type': 'application/json', Origin: 'https://nowcasting.cptec.inpe.br', Referer: 'https://nowcasting.cptec.inpe.br/' },
    });
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': upstream.ok && request.method === 'GET' && path.startsWith('paths/frames/') ? 'public, max-age=60' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return Response.json({ error: 'CPTEC/INPE temporariamente indisponível.' }, { status: 502 }); }
}