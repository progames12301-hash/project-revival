// Provider para os radares do "nowcasting" do CPTEC/INPE
// (https://nowcasting.cptec.inpe.br). Diferente do antigo modo "cptec"
// (v3/Controller.js), que tentava reconstruir volumes polares do SIGMA,
// este provider apenas pede o PNG já pronto que o próprio CPTEC publica —
// o mesmo que aparece no site oficial.
//
// Como adicionar mais radares/variáveis:
//   1. Abra https://nowcasting.cptec.inpe.br, escolha o radar e a variável.
//   2. Clique com o botão direito na imagem → "Copiar endereço da imagem".
//   3. A URL segue o padrão:
//      .../api/v1/paths/frames/radar/{rede}~{radar}~{tipo}~{codigo}/{AAAAMMDDHHmm}/full
//   4. Copie {rede}~{radar}~{tipo}~{codigo} e adicione uma linha abaixo,
//      com nome, latitude/longitude aproximadas do radar e o alcance (km)
//      da imagem. Se a imagem aparecer deslocada/maior ou menor que a área
//      real do radar no mapa, ajuste "rangeKm" — é só isso que é estimado.
const CATALOG = [
  { id:'lontras_ppicz', network:'sdcsc', radarId:'lontras', radarName:'Lontras/SC', lat:-27.16, lon:-49.54, rangeKm:240, type:'ppi', code:'ppicz', label:'Lontras/SC — Refletividade (PPI)' },
  { id:'chapeco_cappi3km', network:'sdcsc', radarId:'chapeco', radarName:'Chapecó/SC', lat:-27.1, lon:-52.62, rangeKm:240, type:'cappi', code:'cappi3km', label:'Chapecó/SC — CAPPI 3 km' },
  { id:'picocouto_dvil', network:'decea', radarId:'picocouto', radarName:'Pico do Couto/RJ', lat:-22.46, lon:-43.29, rangeKm:250, type:'agua_liquida', code:'dvil', label:'Pico do Couto/RJ — Água líquida integrada (VIL)' },
  { id:'santiago_ppicz', network:'decea', radarId:'santiago', radarName:'Santiago/RS', lat:-29.19, lon:-54.88, rangeKm:250, type:'ppi', code:'ppicz', label:'Santiago/RS — Refletividade (PPI)' },
  { id:'macae_waldvogel', network:'inea', radarId:'macae', radarName:'Macaé/RJ', lat:-22.4047, lon:-41.8597, rangeKm:250, type:'echotop', code:'waldvogel', label:'Macaé/RJ — Echo Top' }
];

// A API do nowcasting não expõe (até onde sabemos) uma lista de horários
// disponíveis por radar — por isso "sondamos" minuto a minuto através do
// proxy do Worker (evita CORS e permite cache de borda).
//
// Antes isso usava HEAD, sequencial em lotes de 6. Muita API que gera a
// imagem sob demanda não implementa HEAD direito (responde 404/405 mesmo
// quando o GET funcionaria), então quase todo probe falhava e sobrava só
// 1 quadro — era por isso que a animação ficava travada numa imagem só.
// Agora: GET com Range (pede só o primeiro byte; se o servidor ignorar o
// Range, baixa a imagem inteira mesmo — ainda funciona, só gasta mais
// banda) e tudo em paralelo, não mais em lotes sequenciais.
const PROXY_PATH = '/api/cptec-nowcast/frame';
const PROBE_STEP_MINUTES = 1;
const PROBE_LOOKBACK_MINUTES = 90;
const MAX_FRAMES = 12;
const PROBE_TIMEOUT_MS = 8000;

function pad(value) { return String(value).padStart(2, '0'); }
function stamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}
function pathKey(entry) { return `${entry.network}~${entry.radarId}~${entry.type}~${entry.code}`; }
function proxyUrl(entry, date) {
  const params = new URLSearchParams({ path: pathKey(entry), time: stamp(date) });
  return `${PROXY_PATH}?${params.toString()}`;
}
// Converte raio em km para uma caixa [oeste,sul,leste,norte] ao redor do radar.
function boundsFor(entry) {
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos((entry.lat * Math.PI) / 180);
  const dLat = entry.rangeKm / kmPerDegLat;
  const dLon = entry.rangeKm / Math.max(1, kmPerDegLon);
  return [entry.lon - dLon, entry.lat - dLat, entry.lon + dLon, entry.lat + dLat];
}
async function frameExists(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    // GET em vez de HEAD: muita API de imagem sob demanda não suporta HEAD.
    // Range pede só o primeiro byte — se o servidor ignorar, baixa tudo,
    // mas ainda responde certo (200/206 existe, 404 não existe).
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    // Cancela o corpo se ainda tiver mais para baixar (servidor ignorou o Range).
    response.body?.cancel?.().catch(() => {});
    return response.ok || response.status === 206;
  } catch { return false; }
}
async function probeFrames(entry) {
  const now = new Date(); now.setUTCSeconds(0, 0);
  const candidates = [];
  for (let offset = 0; offset <= PROBE_LOOKBACK_MINUTES; offset += PROBE_STEP_MINUTES) {
    candidates.push(new Date(now.getTime() - offset * 60000));
  }
  // Todas as sondas em paralelo — o Worker aguenta de boa, e isso é bem
  // mais rápido que lotes sequenciais com HEAD falhando um por um.
  const results = await Promise.all(candidates.map(async date => ({ date, ok: await frameExists(proxyUrl(entry, date)) })));
  const hits = results.filter(result => result.ok).map(result => result.date);
  return hits
    .sort((a, b) => a - b)
    .slice(-MAX_FRAMES)
    .map((date, index) => ({ index, date, url: proxyUrl(entry, date) }));
}

export class CptecNowcastProvider {
  constructor() {
    this.id = 'cptec_nowcast';
    this.name = 'CPTEC Nowcasting';
    this.officialUrl = 'https://nowcasting.cptec.inpe.br/';
    this.catalog = CATALOG;
    this.selectedId = CATALOG[0]?.id || null;
    this.frames = [];
    this.radars = [];
  }
  entryById(id) { return this.catalog.find(item => item.id === id) || null; }
  async load(selectedProductId) {
    if (selectedProductId && this.entryById(selectedProductId)) this.selectedId = selectedProductId;
    const entry = this.entryById(this.selectedId) || this.catalog[0];
    if (!entry) throw new Error('Nenhum radar do nowcasting CPTEC configurado.');
    this.frames = await probeFrames(entry);
    if (!this.frames.length) throw new Error(`Sem imagens recentes publicadas para ${entry.label}.`);
    this.radars = [{ id: entry.id, name: entry.label, provider: 'CPTEC/INPE — Nowcasting', latitude: entry.lat, longitude: entry.lon, lat: entry.lat, lon: entry.lon, available: true }];
    return { frames: this.frames, radars: this.radars, focusBounds: boundsFor(entry), note: `${entry.label} · ${this.frames.length} horários recentes` };
  }
  async imageLayers(frameIndex) {
    const entry = this.entryById(this.selectedId) || this.catalog[0];
    const frame = this.frames[frameIndex];
    if (!entry || !frame) return [];
    const [west, south, east, north] = boundsFor(entry);
    return [{
      kind: 'image',
      id: `cptec-nowcast-${entry.id}`,
      cacheKey: `cptec-nowcast:${entry.id}:${frame.url}`,
      url: frame.url,
      coordinates: [[west, north], [east, north], [east, south], [west, south]],
      radar: this.radars[0],
      attribution: 'CPTEC/INPE — Nowcasting',
      preserveColors: true
    }];
  }
}
