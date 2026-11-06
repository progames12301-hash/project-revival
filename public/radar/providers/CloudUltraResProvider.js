import {fetchJson, parseDate, proxyBase} from '../config.js';

const PRODUCT_INFO = Object.freeze({
  cappi3km: {label:'Refletividade · CAPPI 3 km', detail:'Composição de refletividade em 3 km', group:'cappi', icon:'ph-radar'},
  ppivr: {label:'Velocidade radial · PPI-V', detail:'Velocidade Doppler radial', group:'ppi', icon:'ph-waveform'},
  ppicz: {label:'Refletividade · PPI-Z', detail:'Refletividade no ângulo de elevação', group:'ppi', icon:'ph-cloud-rain'},
  dvil: {label:'DVIL', detail:'Densidade vertical integrada de líquido', group:'agua_liquida', icon:'ph-cloud'},
  vil: {label:'VIL', detail:'Conteúdo de água líquida integrado', group:'agua_liquida', icon:'ph-cloud'},
  echotop20dbz: {label:'EchoTop · 20 dBZ', detail:'Altura do eco de 20 dBZ', group:'echotop', icon:'ph-arrows-out'},
  echotop35dbz: {label:'EchoTop · 35 dBZ', detail:'Altura do eco de 35 dBZ', group:'echotop', icon:'ph-arrows-out'},
  waldvogel: {label:'Waldvogel', detail:'Nível de congelamento estimado pelo eco', group:'echotop', icon:'ph-snowflake'},
  chuva24h: {label:'Acumulado · 24 horas', detail:'Precipitação acumulada em 24 horas', group:'chuva', icon:'ph-drop'},
  chuva48h: {label:'Acumulado · 48 horas', detail:'Precipitação acumulada em 48 horas', group:'chuva', icon:'ph-drop'},
  chuva72h: {label:'Acumulado · 72 horas', detail:'Precipitação acumulada em 72 horas', group:'chuva', icon:'ph-drop'}
});

const CATALOG_TTL_MS = 90_000;
const TIMES_TTL_MS = 45_000;
const MAX_FRAMES = 24;
const MAX_IMAGE_AGE_MINUTES = 180;
const TIME_TOLERANCE_MINUTES = 50;
const timeCache = new Map();
let catalogCache = null;
let catalogCacheAt = 0;
let catalogPromise = null;

function asDate(value) { return value instanceof Date ? value : parseDate(value); }

function compactPath(value) {
  return String(value || '').trim().replaceAll('/', '~');
}

function parseBounds(bounds) {
  // O catálogo fornece [[latitude_min, longitude_min], [latitude_max, longitude_max]].
  if (!Array.isArray(bounds) || bounds.length < 2 || !Array.isArray(bounds[0]) || !Array.isArray(bounds[1])) return null;
  const south = Number(bounds[0][0]), west = Number(bounds[0][1]);
  const north = Number(bounds[1][0]), east = Number(bounds[1][1]);
  if (![south, west, north, east].every(Number.isFinite) || east <= west || north <= south) return null;
  return {west, south, east, north};
}

function intersects(bounds, view) {
  if (!bounds || !view) return true;
  const width = Math.max(0, Number(view.east) - Number(view.west));
  const height = Math.max(0, Number(view.north) - Number(view.south));
  const padX = width * .12, padY = height * .12;
  return bounds.east >= Number(view.west) - padX && bounds.west <= Number(view.east) + padX &&
    bounds.north >= Number(view.south) - padY && bounds.south <= Number(view.north) + padY;
}

function toStamp(value) {
  const date = asDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:'UTC', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(date).reduce((out, part) => (out[part.type] = part.value, out), {});
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

function nearestTime(times, target) {
  let best = null, difference = Infinity;
  for (const value of times) {
    const date = asDate(value);
    if (!date) continue;
    const delta = Math.abs(date.getTime() - target);
    if (delta < difference) { difference = delta; best = date; }
  }
  return best && difference <= TIME_TOLERANCE_MINUTES * 60_000 ? best : null;
}

async function mapLimit(items, limit, task) {
  const result = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({length:Math.min(limit, items.length)}, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { result[index] = await task(items[index], index); }
      catch (error) { result[index] = {error}; }
    }
  });
  await Promise.all(workers);
  return result;
}

export class CloudUltraResProvider {
  constructor() {
    this.id = 'cloudultra';
    this.name = 'CloudUltra Res';
    this.base = proxyBase();
    this.officialUrl = 'https://www.cptec.inpe.br/';
    this.product = 'cappi3km';
    this.version = null;
    this.entries = [];
    this.frames = [];
    this.radars = [];
  }

  productOptions() {
    return Object.entries(PRODUCT_INFO).map(([value, info]) => ({value, ...info}));
  }

  async catalog() {
    const now = Date.now();
    if (catalogCache && now - catalogCacheAt < CATALOG_TTL_MS) return catalogCache;
    if (catalogPromise) return catalogPromise;
    catalogPromise = fetchJson(`${this.base}/api/cloudultra/catalog`, {}, 25_000)
      .then(payload => {
        const source = (payload?.sources || []).find(item => item.slug === 'radar');
        if (!source || !Array.isArray(source.products)) throw new Error('Catálogo CloudUltra Res sem produtos de radar.');
        catalogCache = source;
        catalogCacheAt = Date.now();
        return source;
      })
      .finally(() => { catalogPromise = null; });
    return catalogPromise;
  }

  async timesFor(layer) {
    const cached = timeCache.get(layer);
    if (cached && Date.now() - cached.savedAt < TIMES_TTL_MS) return cached.times;
    const payload = await fetchJson(`${this.base}/api/cloudultra/times?path=${encodeURIComponent(layer)}`, {}, 15_000);
    const times = (Array.isArray(payload?.times) ? payload.times : [])
      .map(asDate).filter(date => date && !Number.isNaN(date.getTime()))
      .sort((a,b) => a - b);
    if (!times.length) throw new Error('Sem horários disponíveis para este radar.');
    timeCache.set(layer, {times, savedAt:Date.now()});
    if (timeCache.size > 160) timeCache.delete(timeCache.keys().next().value);
    return times;
  }

  async load(product = 'cappi3km') {
    if (!PRODUCT_INFO[product]) throw new Error('Produto CloudUltra Res inválido.');
    this.product = product;
    const catalog = await this.catalog();
    this.version = Number(catalog.version);
    if (!Number.isFinite(this.version)) throw new Error('Versão do catálogo CloudUltra Res inválida.');

    const now = Date.now();
    const candidates = (catalog.products || []).filter(item => {
      const layer = compactPath(item.layer || item.key);
      const parts = layer.split('~');
      const info = PRODUCT_INFO[product];
      if (parts.length < 4 || parts.at(-1) !== product || parts.at(-2) !== info.group) return false;
      if (!parseBounds(item.bounds)) return false;
      const latest = asDate(item.latest_time);
      return latest && now - latest.getTime() <= MAX_IMAGE_AGE_MINUTES * 60_000;
    });
    if (!candidates.length) throw new Error(`CloudUltra Res não publicou ${PRODUCT_INFO[product].label} recente.`);

    const fetched = await mapLimit(candidates, 8, async item => ({item, times:await this.timesFor(compactPath(item.layer || item.key))}));
    this.entries = fetched.filter(value => !value.error).map(({item, times}) => {
      const layer = compactPath(item.layer || item.key), parts = layer.split('~');
      const network = parts[0], station = parts[1], radarId = `${network}-${station}`;
      const bounds = parseBounds(item.bounds);
      const groups = Array.isArray(item.groups) ? item.groups : [];
      return {
        layer, radarId, network, station, bounds, times,
        cadenceMinutes:Number(item.cadence_minutes) || 10,
        radar:{
          id:radarId, code:station, provider:groups[0] || network.toUpperCase(),
          name:`${groups[1] || station} · ${groups[0] || network.toUpperCase()}`,
          latitude:(bounds.south + bounds.north) / 2,
          longitude:(bounds.west + bounds.east) / 2,
          rangeKm:Math.round(Math.max(bounds.east-bounds.west, bounds.north-bounds.south) * 55),
          bounds:[bounds.west,bounds.south,bounds.east,bounds.north],
          available:true, sourceId:'cloudultra'
        }
      };
    });
    if (!this.entries.length) throw new Error('Não foi possível obter horários recentes do CloudUltra Res.');

    const uniqueRadars = new Map();
    for (const entry of this.entries) uniqueRadars.set(entry.radarId, entry.radar);
    this.radars = [...uniqueRadars.values()].sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
    const stamps = new Map();
    this.entries.forEach(entry => entry.times.forEach(date => stamps.set(date.getTime(), date)));
    this.frames = [...stamps.values()].sort((a,b) => a-b).slice(-MAX_FRAMES).map(date => ({date}));
    if (!this.frames.length) throw new Error('CloudUltra Res sem horários para animação.');
    return {frames:this.frames, radars:this.radars, note:`CloudUltra Res · ${this.radars.length} radares · ${PRODUCT_INFO[product].label}.`};
  }

  async imageLayers(frameIndex, selected = 'all', viewBounds = null) {
    const frame = this.frames[frameIndex];
    if (!frame) return [];
    const target = frame.date.getTime(), info = PRODUCT_INFO[this.product];
    const entries = this.entries.filter(entry =>
      (selected === 'all' || entry.radarId === selected) && intersects(entry.bounds, viewBounds)
    );
    const layers = [];
    for (const entry of entries) {
      const observed = nearestTime(entry.times, target);
      if (!observed) continue;
      const stamp = toStamp(observed);
      const query = new URLSearchParams({path:entry.layer, time:stamp, version:String(this.version)});
      const bounds = entry.bounds;
      layers.push({
        kind:'image', id:`cloudultra-${entry.radarId}-${this.product}`,
        cacheKey:`cloudultra:${this.version}:${entry.layer}:${stamp}`,
        url:`${this.base}/api/cloudultra/frame?${query}`,
        coordinates:[[bounds.west,bounds.north],[bounds.east,bounds.north],[bounds.east,bounds.south],[bounds.west,bounds.south]],
        radar:entry.radar, product:this.product, attribution:'CloudUltra Res',
        preserveColors:true, nativePixels:true, observedAt:observed.toISOString(),
        sourcePath:entry.layer, productLabel:info.label
      });
    }
    return layers;
  }
}
