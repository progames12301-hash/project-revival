// Super Res V2 independente.
// Pipeline visual do radar.html do V3: imagem real -> classes dBZ -> gates
// polares preenchidos, sem textura nativa, sem bordas e sem interpolação.
//
// Desempenho (reescrita):
//  - A malha polar (vértices em Mercator) depende só da posição do radar e é
//    calculada UMA vez por radar e compartilhada entre todos os quadros/camadas.
//  - Cada quadro guarda só "runs" (azimute, gate inicial, gate final, classe)
//    em arrays tipados; gates vizinhos da mesma classe viram um único quadrilátero.
//    Não há mais subdivisão em partes: com passo de 1° a curvatura é invisível.
//  - O redesenho usa uma transformada afim calibrada com map.project (3 pontos)
//    em vez de projetar cada vértice, descarta o que está fora da tela e desenha
//    um único fill por classe de dBZ.
//  - A opacidade é CSS: mudar opacidade não repinta nada. Camadas com opacidade 0
//    (quadros pré-carregados da animação) não redesenham e ficam com display:none.
//  - Todos os listeners do mapa são removidos em onRemove.

const RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const EARTH_KM = 6371.0088;
const GATE_KM = .5;
const AZ_COUNT = 360;          // 1° por azimute
const MIN_DBZ = 3;
const MAX_DPR = 2;
const GRID_CACHE_LIMIT = 10;
const NWS_STOPS = [
  [-30, [20, 28, 39]], [-20, [31, 79, 130]], [-10, [47, 134, 194]],
  [0, [54, 198, 232]], [10, [25, 199, 154]], [20, [40, 212, 69]],
  [30, [188, 230, 46]], [40, [245, 230, 47]], [50, [255, 154, 30]],
  [60, [255, 68, 32]], [70, [196, 18, 36]], [80, [239, 73, 207]],
  [90, [111, 168, 255]]
];
const CLASS_COUNT = NWS_STOPS.length;
const CLASS_DBZ = NWS_STOPS.map(stop => stop[0]);
const CLASS_VISIBLE = CLASS_DBZ.map(dbz => dbz >= MIN_DBZ);
const DECODE_CACHE = new Map();
const GRID_CACHE = new Map();
// LUT 64x64x64 (RGB quantizado em 6 bits/canal): -2 desconhecido, -1 sem eco, >=0 índice da classe.
const COLOR_LUT = new Int8Array(64 * 64 * 64).fill(-2);

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const mercatorY = latRad => .5 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / TWO_PI;
const mercatorToLngLat = (mx, my) => [mx * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) / RAD];

function colorFor(dbz, palette = null) {
  if (Array.isArray(palette) && palette.length) {
    const index = Math.max(0, Math.min(palette.length - 1, Math.round(((dbz + 30) / 120) * (palette.length - 1))));
    return palette[index];
  }
  if (dbz <= NWS_STOPS[0][0]) return NWS_STOPS[0][1];
  for (let i = 0; i < NWS_STOPS.length - 1; i++) {
    const [d0, c0] = NWS_STOPS[i], [d1, c1] = NWS_STOPS[i + 1];
    if (dbz <= d1) {
      const f = (dbz - d0) / (d1 - d0);
      return c0.map((value, index) => Math.round(value + (c1[index] - value) * f));
    }
  }
  return NWS_STOPS.at(-1)[1];
}

function classifyColor(red, green, blue) {
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  if (max - min < 24 && !(blue > green * 1.15 && blue > red * 1.15)) return -1;
  let best = -1, distance = Infinity;
  for (let i = 0; i < CLASS_COUNT; i++) {
    const color = NWS_STOPS[i][1];
    const current = (red - color[0]) ** 2 + (green - color[1]) ** 2 + (blue - color[2]) ** 2;
    if (current < distance) { distance = current; best = i; }
  }
  return distance > 25000 ? -1 : best;
}

// Índice de classe do pixel, ou -1 (sem eco / abaixo do mínimo).
function classifyPixel(pixels, offset) {
  if (pixels[offset + 3] < 20) return -1;
  const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
  const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  let value = COLOR_LUT[key];
  if (value === -2) {
    value = classifyColor(((r >> 2) << 2) + 2, ((g >> 2) << 2) + 2, ((b >> 2) << 2) + 2);
    COLOR_LUT[key] = value;
  }
  return value >= 0 && CLASS_VISIBLE[value] ? value : -1;
}

async function decode(url, signal) {
  const cached = DECODE_CACHE.get(url);
  if (cached) return cached;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Super Res V2: imagem HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const result = { pixels: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
  DECODE_CACHE.set(url, result);
  while (DECODE_CACHE.size > 3) DECODE_CACHE.delete(DECODE_CACHE.keys().next().value);
  return result;
}

function radarRange(sourceLayer) {
  const value = Number(sourceLayer.radar?.rangeKm);
  if (Number.isFinite(value) && value > 0) return Math.min(value, 300);
  const c = sourceLayer.coordinates;
  const radar = [Number(sourceLayer.radar?.longitude), Number(sourceLayer.radar?.latitude)];
  if (!Array.isArray(c) || c.length < 4 || !radar.every(Number.isFinite)) return 250;
  const distances = [[Number(c[0][0]), radar[1]], [Number(c[1][0]), radar[1]], [radar[0], Number(c[0][1])], [radar[0], Number(c[2][1])]].map(point => {
    const lat1 = radar[1] * RAD, lat2 = point[1] * RAD, dLat = lat2 - lat1, dLon = (point[0] - radar[0]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }).filter(Number.isFinite);
  return distances.length ? Math.min(...distances) : 250;
}

// ---------------------------------------------------------------------------
// Malha polar compartilhada por radar.
// Vértices: (AZ_COUNT + 1) linhas (bordas de azimute em i - 0,5°) x (gates + 1) colunas (bordas de range).
// vx/vy = deslocamento em Mercator normalizado relativo à origem do radar.
// cLon/cLat = deslocamento (graus) do centro de cada gate, usado só para amostrar a imagem.
// ---------------------------------------------------------------------------
let DEST_LAT = 0, DEST_LON = 0;
function destinationRad(lat1, lon1, sinLat1, cosLat1, sinB, cosB, d) {
  const sinD = Math.sin(d), cosD = Math.cos(d);
  const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * cosB);
  DEST_LAT = lat2;
  DEST_LON = lon1 + Math.atan2(sinB * sinD * cosLat1, cosD - sinLat1 * Math.sin(lat2));
}

async function buildGrid(radarLat, radarLon, gates) {
  const rows = AZ_COUNT + 1, cols = gates + 1;
  const vx = new Float32Array(rows * cols), vy = new Float32Array(rows * cols);
  const cLon = new Float32Array(AZ_COUNT * gates), cLat = new Float32Array(AZ_COUNT * gates);
  const lat1 = radarLat * RAD, lon1 = radarLon * RAD, sinLat1 = Math.sin(lat1), cosLat1 = Math.cos(lat1);
  const mx0 = (radarLon + 180) / 360, my0 = mercatorY(lat1);
  let sliceStart = performance.now();
  for (let row = 0; row < rows; row++) {
    const edge = (row - .5) * RAD, sinE = Math.sin(edge), cosE = Math.cos(edge);
    const base = row * cols;
    for (let col = 0; col < cols; col++) {
      destinationRad(lat1, lon1, sinLat1, cosLat1, sinE, cosE, (col * GATE_KM) / EARTH_KM);
      vx[base + col] = DEST_LON / TWO_PI + .5 - mx0;
      vy[base + col] = mercatorY(DEST_LAT) - my0;
    }
    if (row < AZ_COUNT) {
      const bearing = row * RAD, sinB = Math.sin(bearing), cosB = Math.cos(bearing);
      const cBase = row * gates;
      for (let gate = 0; gate < gates; gate++) {
        destinationRad(lat1, lon1, sinLat1, cosLat1, sinB, cosB, ((gate + .5) * GATE_KM) / EARTH_KM);
        cLon[cBase + gate] = DEST_LON / RAD - radarLon;
        cLat[cBase + gate] = DEST_LAT / RAD - radarLat;
      }
    }
    if (performance.now() - sliceStart > 10) { await tick(); sliceStart = performance.now(); }
  }
  return { rows, cols, gates, vx, vy, cLon, cLat, mx0, my0 };
}

function getGrid(radarLat, radarLon, gates) {
  const key = `${radarLat.toFixed(5)},${radarLon.toFixed(5)},${gates}`;
  let promise = GRID_CACHE.get(key);
  if (promise) { GRID_CACHE.delete(key); GRID_CACHE.set(key, promise); return promise; }
  promise = buildGrid(radarLat, radarLon, gates);
  promise.catch(() => GRID_CACHE.delete(key));
  GRID_CACHE.set(key, promise);
  while (GRID_CACHE.size > GRID_CACHE_LIMIT) GRID_CACHE.delete(GRID_CACHE.keys().next().value);
  return promise;
}

export function createSuperResV2Layer({ id, sourceLayer, opacity = .7 } = {}) {
  let resolveReady;
  const readyPromise = new Promise(resolve => { resolveReady = resolve; });
  return {
    id, type: 'custom', renderingMode: '2d', ready: false, failed: false, removed: false,
    opacity: Math.min(.7, Number(opacity) || .7), readyPromise, palette: null,
    onAdd(map) {
      this.map = map;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sideral-superres-v2-canvas';
      Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', border: '0', outline: '0', zIndex: '450', transformOrigin: '0 0', willChange: 'transform', display: 'none', opacity: String(this.opacity) });
      map.getContainer().appendChild(this.canvas);
      this.context = this.canvas.getContext('2d', { alpha: true });
      this.abortController = new AbortController();
      // renderState guarda a câmera do último redesenho PRECISO. Durante arraste/zoom só
      // aplicamos uma transform CSS (O(1)) sobre o canvas pronto; o redesenho roda quando
      // o gesto termina ou após 120 ms sem eventos.
      this.renderState = null;
      this.drawnKey = null;
      this.paletteVersion = 0;
      this.transformFrame = 0;
      this.settleTimer = 0;
      this.scheduleFastTransform = () => {
        if (this.transformFrame || this.removed || this.opacity <= 0) return;
        this.transformFrame = requestAnimationFrame(() => { this.transformFrame = 0; this.applyFastTransform(); });
      };
      this.scheduleRedraw = (immediate = false) => {
        clearTimeout(this.settleTimer);
        this.settleTimer = 0;
        if (this.removed) return;
        if (immediate) { this.redraw(); return; }
        this.settleTimer = setTimeout(() => { this.settleTimer = 0; this.redraw(); }, 120);
      };
      const onMove = () => { if (this.opacity <= 0) return; this.scheduleFastTransform(); this.scheduleRedraw(false); };
      const onSettled = () => { if (this.opacity <= 0) return; this.scheduleRedraw(true); };
      this._listeners = [
        ...['move', 'zoom', 'rotate', 'pitch'].map(event => [event, onMove]),
        ...['moveend', 'zoomend', 'rotateend', 'pitchend', 'resize'].map(event => [event, onSettled])
      ];
      for (const [event, handler] of this._listeners) map.on(event, handler);
      void this.prepare().catch(error => {
        if (error?.name !== 'AbortError') console.error('Super Res V2:', error);
        this.failed = true;
        resolveReady(false);
      });
    },
    async prepare() {
      const signal = this.abortController.signal;
      const image = await decode(sourceLayer.url, signal);
      const radarLat = Number(sourceLayer.radar?.latitude), radarLon = Number(sourceLayer.radar?.longitude);
      const bounds = sourceLayer.coordinates;
      if (!Number.isFinite(radarLat) || !Number.isFinite(radarLon) || !Array.isArray(bounds)) throw new Error('Super Res V2: origem geográfica ausente.');
      const west = Number(bounds[0][0]), east = Number(bounds[1][0]), north = Number(bounds[0][1]), south = Number(bounds[2][1]);
      const gates = Math.floor(radarRange(sourceLayer) / GATE_KM);
      const grid = await getGrid(radarLat, radarLon, gates);
      if (signal.aborted || this.removed) throw Object.assign(new Error('abortado'), { name: 'AbortError' });
      const { pixels, width, height } = image;
      const kx = (width - 1) / (east - west), ky = (height - 1) / (north - south);
      const limit = AZ_COUNT * gates;
      let runAz = new Uint16Array(4096), runG0 = new Uint16Array(4096), runG1 = new Uint16Array(4096), runCls = new Uint8Array(4096);
      let count = 0;
      const push = (az, g0, g1, cls) => {
        if (count === runAz.length) {
          const size = Math.min(limit, count * 2);
          const grow = (array, Type) => { const next = new Type(size); next.set(array); return next; };
          runAz = grow(runAz, Uint16Array); runG0 = grow(runG0, Uint16Array); runG1 = grow(runG1, Uint16Array); runCls = grow(runCls, Uint8Array);
        }
        runAz[count] = az; runG0[count] = g0; runG1[count] = g1; runCls[count] = cls; count++;
      };
      let sliceStart = performance.now();
      for (let az = 0; az < AZ_COUNT; az++) {
        const base = az * gates;
        let current = -1, start = 0;
        for (let gate = 0; gate < gates; gate++) {
          const sx = Math.round((radarLon + grid.cLon[base + gate] - west) * kx);
          const sy = Math.round((north - (radarLat + grid.cLat[base + gate])) * ky);
          const cls = sx < 0 || sy < 0 || sx >= width || sy >= height ? -1 : classifyPixel(pixels, (sy * width + sx) * 4);
          if (cls !== current) {
            if (current >= 0) push(az, start, gate, current);
            current = cls; start = gate;
          }
        }
        if (current >= 0) push(az, start, gates, current);
        if (performance.now() - sliceStart > 10) {
          await tick(); sliceStart = performance.now();
          if (signal.aborted || this.removed) throw Object.assign(new Error('abortado'), { name: 'AbortError' });
        }
      }
      // Agrupa por classe (counting sort) para um único fill por cor.
      const offsets = new Uint32Array(CLASS_COUNT + 1);
      for (let i = 0; i < count; i++) offsets[runCls[i] + 1]++;
      for (let c = 0; c < CLASS_COUNT; c++) offsets[c + 1] += offsets[c];
      const cursor = offsets.slice(0, CLASS_COUNT), order = new Uint32Array(count);
      for (let i = 0; i < count; i++) order[cursor[runCls[i]]++] = i;
      if (this.removed) throw Object.assign(new Error('abortado'), { name: 'AbortError' });
      this.data = { grid, az: runAz.slice(0, count), g0: runG0.slice(0, count), g1: runG1.slice(0, count), order, offsets };
      this.ready = true;
      resolveReady(true);
      if (this.opacity > 0) this.redraw(); else this.drawnKey = null;
    },
    setOpacity(value) {
      this.opacity = Math.min(1, Math.max(0, Number(value) || 0));
      if (!this.canvas) return;
      if (this.opacity <= 0) { this.canvas.style.display = 'none'; return; }
      this.canvas.style.opacity = String(this.opacity);
      if (!this.ready) return;
      // Só redesenha se a câmera/paleta mudou desde o último desenho.
      if (this.drawnKey !== this.cameraKey()) this.scheduleRedraw(true);
      else { this.canvas.style.display = 'block'; this.applyFastTransform(); }
    },
    setPalette(value) {
      this.palette = Array.isArray(value) && value.length ? value : null;
      this.paletteVersion++;
      this.drawnKey = null;
      if (this.opacity > 0) this.scheduleRedraw?.(true);
    },
    cameraKey() {
      const map = this.map, container = map.getContainer(), center = map.getCenter();
      return `${container.clientWidth}x${container.clientHeight}@${map.getZoom().toFixed(5)},${center.lng.toFixed(5)},${center.lat.toFixed(5)},${map.getBearing().toFixed(3)},${map.getPitch().toFixed(3)}:${this.paletteVersion}`;
    },
    // Transform CSS (translate + scale) ancorada no centro do último redesenho preciso.
    // transform-origin = 0 0 => ponto p vira d + scale * p; o centro antigo (w/2, h/2)
    // precisa cair em "anchor", logo d = anchor - scale * (w/2, h/2).
    applyFastTransform() {
      if (!this.canvas || !this.map || !this.renderState || this.removed) return;
      const state = this.renderState;
      if (Math.abs(this.map.getBearing() - state.bearing) > .05 || Math.abs(this.map.getPitch() - state.pitch) > .05) return;
      const anchor = this.map.project(state.center);
      const scale = Math.pow(2, this.map.getZoom() - state.zoom);
      const dx = anchor.x - scale * state.width / 2, dy = anchor.y - scale * state.height / 2;
      this.canvas.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    },
    // Calibra sx = p0.x + a*(mx-cmx) + b*(my-cmy) (idem sy) com 3 chamadas a map.project.
    // Exato em Mercator com pitch 0; validado contra a origem do radar. Senão retorna null.
    affineProjector(grid) {
      const map = this.map;
      if (map.getPitch() > .01) return null;
      const projection = map.getProjection?.();
      if (projection && projection.type && projection.type !== 'mercator') return null;
      const center = map.getCenter(), zoom = map.getZoom();
      const cmx = (center.lng + 180) / 360, cmy = mercatorY(center.lat * RAD);
      const du = Math.min(.25 / Math.pow(2, zoom), .01);
      const p0 = map.project(center), p1 = map.project(mercatorToLngLat(cmx + du, cmy)), p2 = map.project(mercatorToLngLat(cmx, cmy + du));
      const a = (p1.x - p0.x) / du, c = (p1.y - p0.y) / du, b = (p2.x - p0.x) / du, d = (p2.y - p0.y) / du;
      const baseX = p0.x + a * (grid.mx0 - cmx) + b * (grid.my0 - cmy);
      const baseY = p0.y + c * (grid.mx0 - cmx) + d * (grid.my0 - cmy);
      const check = map.project(mercatorToLngLat(grid.mx0, grid.my0));
      if (!Number.isFinite(baseX) || Math.abs(check.x - baseX) > 2 || Math.abs(check.y - baseY) > 2) return null;
      return { a, b, c, d, baseX, baseY };
    },
    // Redesenho preciso. Só roda ao fim de um gesto, após 120 ms de inatividade ou ao exibir a camada.
    redraw() {
      if (!this.context || !this.map || this.removed) return;
      if (this.transformFrame) { cancelAnimationFrame(this.transformFrame); this.transformFrame = 0; }
      if (this.opacity <= 0) { this.canvas.style.display = 'none'; return; }
      const container = this.map.getContainer();
      const width = container.clientWidth, height = container.clientHeight, ratio = Math.min(MAX_DPR, Math.max(1, globalThis.devicePixelRatio || 1));
      if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) { this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio); }
      const ctx = this.context;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      this.canvas.style.transform = 'none';
      this.canvas.style.opacity = String(this.opacity);
      this.canvas.style.display = 'block';
      if (!this.ready || !this.data) return;
      const map = this.map, { grid, az, g0, g1, order, offsets } = this.data;
      const center = map.getCenter(), zoom = map.getZoom(), bearing = map.getBearing(), pitch = map.getPitch();
      const affine = this.affineProjector(grid);
      const { cols, vx, vy } = grid;
      // Fallback (3D/globo): projeta cada vértice no máximo uma vez por redesenho.
      const cacheX = affine ? null : new Float32Array(grid.rows * cols).fill(NaN);
      const cacheY = affine ? null : new Float32Array(grid.rows * cols);
      const project = index => {
        const point = map.project(mercatorToLngLat(grid.mx0 + vx[index], grid.my0 + vy[index]));
        cacheX[index] = point.x; cacheY[index] = point.y;
      };
      const margin = 2;
      for (let cls = 0; cls < CLASS_COUNT; cls++) {
        const from = offsets[cls], to = offsets[cls + 1];
        if (from === to) continue;
        const color = colorFor(CLASS_DBZ[cls], this.palette);
        ctx.beginPath();
        for (let k = from; k < to; k++) {
          const run = order[k], row = az[run], c0 = g0[run], c1 = g1[run];
          const i00 = row * cols + c0, i10 = (row + 1) * cols + c0, i11 = (row + 1) * cols + c1, i01 = row * cols + c1;
          let x00, y00, x10, y10, x11, y11, x01, y01;
          if (affine) {
            const { a, b, c, d, baseX, baseY } = affine;
            x00 = baseX + a * vx[i00] + b * vy[i00]; y00 = baseY + c * vx[i00] + d * vy[i00];
            x10 = baseX + a * vx[i10] + b * vy[i10]; y10 = baseY + c * vx[i10] + d * vy[i10];
            x11 = baseX + a * vx[i11] + b * vy[i11]; y11 = baseY + c * vx[i11] + d * vy[i11];
            x01 = baseX + a * vx[i01] + b * vy[i01]; y01 = baseY + c * vx[i01] + d * vy[i01];
          } else {
            if (cacheX[i00] !== cacheX[i00]) project(i00);
            if (cacheX[i10] !== cacheX[i10]) project(i10);
            if (cacheX[i11] !== cacheX[i11]) project(i11);
            if (cacheX[i01] !== cacheX[i01]) project(i01);
            x00 = cacheX[i00]; y00 = cacheY[i00]; x10 = cacheX[i10]; y10 = cacheY[i10];
            x11 = cacheX[i11]; y11 = cacheY[i11]; x01 = cacheX[i01]; y01 = cacheY[i01];
          }
          const minX = Math.min(x00, x10, x11, x01), maxX = Math.max(x00, x10, x11, x01);
          if (maxX < -margin || minX > width + margin) continue;
          const minY = Math.min(y00, y10, y11, y01), maxY = Math.max(y00, y10, y11, y01);
          if (maxY < -margin || minY > height + margin) continue;
          ctx.moveTo(x00, y00); ctx.lineTo(x10, y10); ctx.lineTo(x11, y11); ctx.lineTo(x01, y01); ctx.closePath();
        }
        ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        ctx.fill();
      }
      this.renderState = { center, zoom, bearing, pitch, width, height };
      this.drawnKey = this.cameraKey();
    },
    render() { if (this.ready && !this.renderState && this.opacity > 0) this.scheduleRedraw?.(true); },
    onRemove() {
      this.removed = true;
      this.abortController?.abort();
      if (this.transformFrame) cancelAnimationFrame(this.transformFrame);
      clearTimeout(this.settleTimer);
      for (const [event, handler] of this._listeners || []) this.map?.off(event, handler);
      this._listeners = [];
      this.data = null;
      this.renderState = null;
      this.canvas?.remove();
      this.canvas = null;
      this.context = null;
    }
  };
}
