import {calibrateRadarProfile,resolveRadarProfile} from './RadarProfiles.js?v=20260914-v5-clean25';

// ─────────────────────────────────────────────────────────────────────────────
// Super Res · malha polar nativa
//
// Reproduz o aspecto das varreduras de referência: malha polar fina
// (arcos concêntricos + raios) com a paleta NWS do SuperRes Sideral.
// Não inventa ecos, não altera a geometria e não borra bordas.
//
//   1. A geometria do gate usa METADADOS NATIVOS quando existem; senão é
//      derivada do próprio raster (metros/pixel no centro do radar), o que
//      torna o modo universal em qualquer provedor.
//   2. Cada célula da malha amostra o pixel correspondente da imagem original
//      e desenha exatamente a cor nativa daquele pixel, via textura.
//   3. Células sem eco não são emitidas: a cobertura é a cobertura publicada.
//
// Não cria anéis artificiais, não preenche falhas e não suaviza a paleta.
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;
const RAD_OVER_RE = 1 / 1000 / EARTH_RADIUS_KM;

// 720 raios de 0,5°: mesma densidade das varreduras operacionais brasileiras.
export const SUPER_RES_AZIMUTH_COUNT = 720;

// Teto de células da GRADE (azimutes × gates). Só limita a quantidade de
// células; nunca altera o tamanho físico da célula, que permanece a resolução
// nativa do raster. Mantém a montagem dentro do tempo que o mapa espera por
// uma varredura pronta (~3,5 s).
const SUPER_RES_MAX_CELLS = 400_000;
const SUPER_RES_V2_MAX_CELLS = 1_500_000;
const SUPER_RES_V2_MAX_PARTS = 4;

// Sobreposição deliberada nas costuras: os gates encostam/solapam levemente
// para que a rasterização WebGL nunca revele uma fresta entre células.
const RADIAL_SEAM_METERS = .75;
const AZIMUTH_SEAM_DEGREES = .0002;

// Zero absoluto: não recua a borda externa de nenhum gate.
const EDGE_FEATHER_PIXELS = 0;

export function superResDestinationPoint(radarLat, radarLon, distanceMeters, bearingDegrees) {
  const distance = distanceMeters / 1000 / EARTH_RADIUS_KM;
  const bearing = bearingDegrees * RAD;
  const lat1 = radarLat * RAD, lon1 = radarLon * RAD;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance) + Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1), Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2));
  return [((lon2 * DEG_PER_RAD + 540) % 360) - 180, lat2 * DEG_PER_RAD];
}

function mercatorY(latitude) {
  const sin = Math.sin(Math.max(-85.0511, Math.min(85.0511, latitude)) * RAD);
  return .5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

function haversineKm(a, b) {
  const lat1 = a[1] * RAD, lat2 = b[1] * RAD, dLat = lat2 - lat1, dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Raio do maior círculo contido no recorte geográfico, medido a partir do
// radar. É o limite que garante que a malha fica dentro dos dados publicados:
// o retângulo pode conter ecos de OUTRO radar nos cantos, e varrê-los seria
// apresentá-los como se fossem deste radar.
function containedRangeKm(sourceLayer, origin) {
  const c = sourceLayer.coordinates;
  if (!Array.isArray(c) || c.length < 4) return 250;
  const west = Number(c[0][0]), east = Number(c[1][0]);
  const north = Number(c[0][1]), south = Number(c[2][1]);
  const sides = [
    haversineKm(origin, [west, origin[1]]), haversineKm(origin, [east, origin[1]]),
    haversineKm(origin, [origin[0], north]), haversineKm(origin, [origin[0], south])
  ].filter(value => Number.isFinite(value) && value > 0);
  if (sides.length) return Math.min(...sides);
  const corners = [[west, north], [east, north], [east, south], [west, south]];
  const distances = corners.map(corner => haversineKm(origin, corner)).filter(value => Number.isFinite(value) && value > 0);
  return distances.length ? Math.max(...distances) : 250;
}

// Metros por pixel no centro do radar, para provedores que só publicam PNG+PGW.
function metersPerPixel(coordinates, width, height, radarLat) {
  if (!Array.isArray(coordinates) || coordinates.length < 4) return null;
  const west = Number(coordinates[0][0]), east = Number(coordinates[1][0]);
  const north = Number(coordinates[0][1]), south = Number(coordinates[2][1]);
  if (![west, east, north, south].every(Number.isFinite) || !(east > west) || !(north > south)) return null;
  const longitudeMeters = (east - west) * 111320 * Math.cos(radarLat * RAD);
  const latitudeMeters = (north - south) * 110574;
  const value = (longitudeMeters / Math.max(1, width) + latitudeMeters / Math.max(1, height)) / 2;
  return Number.isFinite(value) && value > 1 ? value : null;
}

async function decodeImage(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Super Res: imagem do radar HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { pixels: image.data, width: canvas.width, height: canvas.height };
}

// Só é eco o pixel colorido e opaco. Cinzas de mapa e transparência nunca
// viram gate.
function isEcho(pixels, offset) {
  if (pixels[offset + 3] < 12) return false;
  const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  if (max < 18) return false;
  if (max - min < 10 && max < 240) return false;
  return true;
}

export function countNativeColors(pixels) {
  const seen = new Set();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (!isEcho(pixels, offset)) continue;
    seen.add((pixels[offset] >> 2 << 12) | (pixels[offset + 1] >> 2 << 6) | (pixels[offset + 2] >> 2));
    if (seen.size > 4096) break;
  }
  return seen.size;
}

// Classes de refletividade usadas pelas imagens coloridas do radar. A malha
// continua sendo montada a partir do raster original; esta tabela apenas troca
// a apresentação visual de cada classe já existente.
const REFLECTIVITY_SOURCE_COLORS = [
  [4, 233, 231], [1, 159, 244], [3, 0, 244], [2, 253, 2],
  [1, 197, 1], [0, 142, 0], [254, 254, 0], [253, 149, 0],
  [253, 0, 0], [212, 0, 0], [188, 0, 0], [248, 0, 253],
  [152, 84, 198], [255, 255, 255]
];

function recolorEchoTexture(sourcePixels, palette) {
  if (!Array.isArray(palette) || palette.length < 2) return sourcePixels;
  const pixels = new Uint8Array(sourcePixels);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (!isEcho(pixels, offset)) continue;
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
    let closest = 0, closestDistance = Infinity;
    for (let index = 0; index < REFLECTIVITY_SOURCE_COLORS.length; index++) {
      const color = REFLECTIVITY_SOURCE_COLORS[index];
      const distance = (red - color[0]) ** 2 + (green - color[1]) ** 2 + (blue - color[2]) ** 2;
      if (distance < closestDistance) { closestDistance = distance; closest = index; }
    }
    const color = palette[Math.min(palette.length - 1, closest)];
    if (!Array.isArray(color)) continue;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
  }
  return pixels;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Super Res shader: ${log}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    uniform mat4 u_matrix;
    uniform vec2 u_origin;   // origem do radar em mercator
    in vec2 a_pos;           // deslocamento em mercator, relativo à origem
    in vec2 a_uv;
    out vec2 v_uv;
    void main(){
      v_uv = a_uv;
      // Os vértices são guardados relativos à origem do radar para preservar
      // precisão em float32; a origem volta aqui.
      gl_Position = u_matrix * vec4(u_origin + a_pos, 0.0, 1.0);
    }`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;
    uniform sampler2D u_texture;
    uniform float u_opacity;
    in vec2 v_uv;
    out vec4 fragColor;
    void main(){
      vec4 texel = texture(u_texture, v_uv);
      if(texel.a <= 0.004) discard;
      fragColor = vec4(texel.rgb, texel.a * u_opacity);
    }`);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Super Res program: ${log}`);
  }
  return program;
}

/**
 * Camada WebGL "Super Res".
 *
 * Uma célula polar por pixel nativo do radar, com a cor nativa do pixel.
 * A geometria é recalibrada por radar, então o modo funciona em REDEMET/DECEA,
 * CEMADEN, INEA, SIMEPAR, IPMet, redes regionais e mosaicos.
 */
export function createSuperResLayer({ id, sourceLayer, opacity = 1, palette = null, variant = 'super_res' } = {}) {
  let resolveReady;
  const readyPromise = new Promise(resolve => { resolveReady = resolve; });

  const custom = {
    id, type: 'custom', renderingMode: '2d',
    ready: false, failed: false, opacity: opacity * (variant === 'super_res_v2' ? 1 : .875), opacityScale: variant === 'super_res_v2' ? 1 : .875, palette,
    variant,
    readyPromise, stats: null,

    onAdd(map, gl) {
      this.map = map;
      this.gl = gl;
      this.abortController = new AbortController();
      try {
        this.program = createProgram(gl);
        this.aPos = gl.getAttribLocation(this.program, 'a_pos');
        this.aUv = gl.getAttribLocation(this.program, 'a_uv');
        this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix');
        this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');
        this.uTexture = gl.getUniformLocation(this.program, 'u_texture');
        this.uOrigin = gl.getUniformLocation(this.program, 'u_origin');
      } catch (error) {
        this.failed = true;
        resolveReady(false);
        console.error(error);
        return;
      }
      void this.prepare().catch(error => {
        if (error?.name !== 'AbortError') console.error('Super Res:', error);
        this.failed = true;
        resolveReady(false);
      });
    },

    async prepare() {
      const gl = this.gl;
      const isV2 = this.variant === 'super_res_v2';
      const t0 = performance.now();
      const image = await decodeImage(sourceLayer.url, this.abortController.signal);
      const tDecode = performance.now();
      if (this.abortController.signal.aborted) return;

      // ── geometria ───────────────────────────────────────────────────────
      let profile = resolveRadarProfile(sourceLayer);
      const radarLat = Number(profile.latitude ?? sourceLayer.radar?.latitude);
      const radarLon = Number(profile.longitude ?? sourceLayer.radar?.longitude);
      if (!Number.isFinite(radarLat) || !Number.isFinite(radarLon) || !Array.isArray(sourceLayer.coordinates)) {
        throw new Error('Super Res: radar sem origem geográfica exata.');
      }

      // Alcance: o declarado pelo provedor manda; nunca além do maior círculo
      // contido no recorte (ver containedRangeKm).
      const declaredKm = Number(sourceLayer.radar?.rangeKm);
      const declaredRange = Number.isFinite(declaredKm) && declaredKm > 0 ? declaredKm * 1000 : 0;
      const containedRange = containedRangeKm(sourceLayer, [radarLon, radarLat]) * 1000;
      const maxRangeMeters = declaredRange > 0
        ? Math.min(declaredRange, containedRange > 0 ? containedRange : declaredRange)
        : Math.max(containedRange, 1000);
      profile = calibrateRadarProfile(profile, image, maxRangeMeters, sourceLayer);

      const imageMetersPerPixel = metersPerPixel(sourceLayer.coordinates, image.width, image.height, radarLat);
      const profileGateMeters = Number(profile.gateSpacingMeters) > 0 ? Number(profile.gateSpacingMeters) : null;
      const rasterGateMeters = imageMetersPerPixel || Math.max(50, maxRangeMeters / 1000);
      const firstGateMeters = Math.max(0, Number(profile.firstGateMeters) || 0);
      const usableRangeMeters = Math.max(1, maxRangeMeters - firstGateMeters);

      // A célula tem o tamanho do pixel nativo do raster (~665 m nos CAPPI de
      // 750×750 sobre 500 km). Metadados de gate do provedor são aceitos
      // quando mais finos; quando mais grossos (grades de referência de 128
      // gates) eles truncariam a cobertura, então são ignorados.
      const gateDepthMeters = profileGateMeters && profileGateMeters < rasterGateMeters
        ? profileGateMeters
        : rasterGateMeters;
      const gateSource = profileGateMeters && profileGateMeters < rasterGateMeters
        ? 'provider metadata'
        : 'native raster resolution';

      // Azimutes: metadados nativos vencem; senão 720 raios (0,5°).
      const nativeAzimuthCount = Number(sourceLayer.polar?.azimuthCount ?? sourceLayer.radar?.azimuthCount);
      let azimuthCount = Number.isFinite(nativeAzimuthCount) && nativeAzimuthCount >= 90
        ? Math.min(2880, Math.round(nativeAzimuthCount))
        : SUPER_RES_AZIMUTH_COUNT;

      // O teto de células só engrossa a grade (menos gates), preservando o
      // tamanho físico da célula e a forma quadrada.
      let gateCount = Math.max(1, Math.ceil(usableRangeMeters / gateDepthMeters));
      const maxParts = isV2 ? SUPER_RES_V2_MAX_PARTS : 1;
      const maxCells = isV2 ? SUPER_RES_V2_MAX_CELLS : SUPER_RES_MAX_CELLS;
      const cellsForFullGrid = azimuthCount * gateCount * maxParts;
      if (cellsForFullGrid > maxCells) {
        gateCount = Math.max(1, Math.floor(maxCells / (azimuthCount * maxParts)));
      }
      const contentRadiusMeters = Math.min(maxRangeMeters, firstGateMeters + gateCount * gateDepthMeters);

      const azimuthWidth = 360 / azimuthCount;
      const azimuthBase = (Number(profile.sweepStartAngleDeg) || 0) + (Number(profile.azimuthOffsetDeg) || 0);

      // ── malha ───────────────────────────────────────────────────────────
      const pixelData = image.pixels;
      const featherMeters = EDGE_FEATHER_PIXELS * rasterGateMeters;
      const origin = maplibregl.MercatorCoordinate.fromLngLat({ lng: radarLon, lat: radarLat });

      // Constantes da geodésica: sin/cos do radar calculados uma única vez.
      const lat1 = radarLat * RAD, lon1 = radarLon * RAD;
      const sinLat1 = Math.sin(lat1), cosLat1 = Math.cos(lat1);
      // Coordenada mercator relativa à origem do radar. O cosseno do azimute é
      // passado pelo chamador para não repetir Math.cos por canto.
      const pointMercX = (sinB, cosB, sinD, cosD) => {
        const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * cosB);
        const lon2 = lon1 + Math.atan2(sinB * sinD * cosLat1, cosD - sinLat1 * Math.sin(lat2));
        return ((lon2 * DEG_PER_RAD + 180) / 360) - origin.x;
      };
      const pointMercY = (cosB, sinD, cosD) => {
        const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * cosB);
        return mercatorY(lat2 * DEG_PER_RAD) - origin.y;
      };

      // Pré-alocação: 6 vértices × 4 floats por célula, com teto rígido.
      const capacity = Math.min(azimuthCount * gateCount * maxParts, maxCells);
      const vertexData = new Float32Array(capacity * 24);
      let cursor = 0;
      let emitted = 0;

      // Mapeamento linear pixel↔mercator para amostrar a imagem sem alocar.
      const west = Number(sourceLayer.coordinates[0][0]), east = Number(sourceLayer.coordinates[1][0]);
      const north = Number(sourceLayer.coordinates[0][1]), south = Number(sourceLayer.coordinates[2][1]);
      const northY = mercatorY(north), southY = mercatorY(south);
      const westX = (west + 180) / 360;
      const spanX = (east - west) / 360;
      const spanY = southY - northY;

      // Meia texel de expansão: com amostragem NEAREST cada célula lê
      // exatamente o texel do pixel que a originou, e a expansão apenas evita
      // rachaduras de projeção entre células vizinhas.
      const halfU = .5 / image.width, halfV = .5 / image.height;
      const invWidth = 1 / image.width, invHeight = 1 / image.height;
      const drawStartOffset = Math.max(0, RADIAL_SEAM_METERS / 2);
      const drawEndOffset = RADIAL_SEAM_METERS / 2;

      // Tabela de azimutes: 3 senos/cossenos por raio, calculados uma única vez.
      const rayB = new Float64Array(azimuthCount * 6);
      for (let rayIndex = 0; rayIndex < azimuthCount; rayIndex++) {
        const azimuth = (azimuthBase + rayIndex * azimuthWidth + 360) % 360;
        const b0 = (azimuth - azimuthWidth / 2 - AZIMUTH_SEAM_DEGREES) * RAD;
        const b1 = (azimuth + azimuthWidth / 2 + AZIMUTH_SEAM_DEGREES) * RAD;
        const bm = azimuth * RAD;
        const at = rayIndex * 6;
        rayB[at] = Math.sin(b0); rayB[at + 1] = Math.cos(b0);
        rayB[at + 2] = Math.sin(b1); rayB[at + 3] = Math.cos(b1);
        rayB[at + 4] = Math.sin(bm); rayB[at + 5] = Math.cos(bm);
      }

      // Laço externo por gate e interno por raio: o que depende só do alcance
      // (distância, seno/cosseno, amostra da imagem) é calculado uma vez por
      // gate, não uma vez por célula.
      for (let gateIndex = 0; gateIndex < gateCount; gateIndex++) {
        const rangeStart = firstGateMeters + gateIndex * gateDepthMeters;
        const rangeCenter = rangeStart + gateDepthMeters / 2;
      const drawStart = Math.max(0, rangeStart - drawStartOffset);
      const drawEnd = Math.max(drawStart, rangeStart + gateDepthMeters - featherMeters) + drawEndOffset;
        const dCenter = rangeCenter * RAD_OVER_RE;
        const dStart = drawStart * RAD_OVER_RE;
        const dEnd = drawEnd * RAD_OVER_RE;
        const cosDC = Math.cos(dCenter), sinDC = Math.sin(dCenter);
        const cosDS = Math.cos(dStart), sinDS = Math.sin(dStart);
        const cosDE = Math.cos(dEnd), sinDE = Math.sin(dEnd);
        const latBase = sinLat1 * cosDC, latAmp = cosLat1 * sinDC;
        for (let rayIndex = 0; rayIndex < azimuthCount; rayIndex++) {
          const at = rayIndex * 6;
          const sinB0 = rayB[at], cosB0 = rayB[at + 1];
          const sinB1 = rayB[at + 2], cosB1 = rayB[at + 3];
          const sinBm = rayB[at + 4], cosBm = rayB[at + 5];

          // Amostra no centro físico do gate (geodésica exata). A ordem foi
          // escolhida para descartar gates sem eco ANTES de calcular a
          // geometria dos quatro cantos — que é a parte mais cara e só é
          // necessária nas células realmente desenhadas.
          const latC = Math.asin(latBase + latAmp * cosBm);
          const lonC = lon1 + Math.atan2(sinBm * sinDC * cosLat1, cosDC - sinLat1 * Math.sin(latC));
          const sampleX = (((lonC * DEG_PER_RAD + 180) / 360) - westX) / spanX * (image.width - 1);
          const sampleY = (mercatorY(latC * DEG_PER_RAD) - northY) / spanY * (image.height - 1);
          const sx = Math.round(sampleX), sy = Math.round(sampleY);
          if (sx < 0 || sx >= image.width || sy < 0 || sy >= image.height) continue;
          const offset = (sy * image.width + sx) * 4;
          if (!isEcho(pixelData, offset)) continue;

          const u = (sampleX + .5) * invWidth, v = (sampleY + .5) * invHeight;
          const u0 = u - halfU, u1 = u + halfU, v0 = v - halfV, v1 = v + halfV;
          const rangeKm = Math.max(.25, rangeCenter / 1000);
          const tangentialKm = rangeKm * azimuthWidth * RAD;
          const parts = isV2 ? Math.max(1, Math.min(SUPER_RES_V2_MAX_PARTS, Math.ceil(tangentialKm / (gateDepthMeters / 1000 * 1.6)))) : 1;
          const centerAzimuth = (azimuthBase + rayIndex * azimuthWidth + 360) % 360;
          for (let part = 0; part < parts; part++) {
            const partStart = centerAzimuth - azimuthWidth / 2 + azimuthWidth * part / parts;
            const partEnd = centerAzimuth - azimuthWidth / 2 + azimuthWidth * (part + 1) / parts;
            const b0 = (partStart - AZIMUTH_SEAM_DEGREES) * RAD;
            const b1 = (partEnd + AZIMUTH_SEAM_DEGREES) * RAD;
            const partSinB0 = Math.sin(b0), partCosB0 = Math.cos(b0);
            const partSinB1 = Math.sin(b1), partCosB1 = Math.cos(b1);
            const x0 = pointMercX(partSinB0, partCosB0, sinDS, cosDS), y0 = pointMercY(partCosB0, sinDS, cosDS);
            const x1 = pointMercX(partSinB0, partCosB0, sinDE, cosDE), y1 = pointMercY(partCosB0, sinDE, cosDE);
            const x2 = pointMercX(partSinB1, partCosB1, sinDE, cosDE), y2 = pointMercY(partCosB1, sinDE, cosDE);
            const x3 = pointMercX(partSinB1, partCosB1, sinDS, cosDS), y3 = pointMercY(partCosB1, sinDS, cosDS);
            vertexData[cursor++] = x0; vertexData[cursor++] = y0; vertexData[cursor++] = u0; vertexData[cursor++] = v0;
            vertexData[cursor++] = x1; vertexData[cursor++] = y1; vertexData[cursor++] = u0; vertexData[cursor++] = v1;
            vertexData[cursor++] = x2; vertexData[cursor++] = y2; vertexData[cursor++] = u1; vertexData[cursor++] = v1;
            vertexData[cursor++] = x0; vertexData[cursor++] = y0; vertexData[cursor++] = u0; vertexData[cursor++] = v0;
            vertexData[cursor++] = x2; vertexData[cursor++] = y2; vertexData[cursor++] = u1; vertexData[cursor++] = v1;
            vertexData[cursor++] = x3; vertexData[cursor++] = y3; vertexData[cursor++] = u1; vertexData[cursor++] = v0;
            emitted++;
          }
        }
        if ((gateIndex & 7) === 7) {
          if (this.abortController.signal.aborted) return;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      const tMeshDone = performance.now();

      if (this.abortController.signal.aborted) return;
      if (!emitted) throw new Error('Super Res: nenhum gate com eco pôde ser montado.');

      // ── textura nativa ──────────────────────────────────────────────────
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.sourcePixels = pixelData;
      this.textureWidth = image.width;
      this.textureHeight = image.height;
      const displayPixels = recolorEchoTexture(pixelData, this.palette);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, displayPixels);
      this.texture = texture;

      const vertices = vertexData.subarray(0, cursor);
      this.vertexCount = vertices.length / 4;
      this.originX = origin.x;
      this.originY = origin.y;
      this.vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      this.stats = {
        radar: sourceLayer.radar?.id || sourceLayer.id || id,
        azimuths: azimuthCount,
        gates: gateCount,
        cells: emitted,
        gateMeters: gateDepthMeters.toFixed(1) + ' m',
        gateSource,
        imageMetersPerPixel: imageMetersPerPixel ? imageMetersPerPixel.toFixed(1) + ' m' : 'desconhecido',
        nativeColors: countNativeColors(pixelData),
        coverage: (contentRadiusMeters / 1000).toFixed(0) + ' km',
        image: image.width + 'x' + image.height,
        msDecode: Math.round(tDecode - t0),
        msMesh: Math.round(tMeshDone - tDecode),
        msTotal: Math.round(tMeshDone - t0)
      };
      if (globalThis.SIDERAL_SUPER_RES_DEBUG) console.info('Super Res polar mesh', this.stats);

      this.ready = true;
      resolveReady(true);
      this.map.triggerRepaint();
    },

    setOpacity(value) { this.opacity = value * this.opacityScale; this.map?.triggerRepaint(); },
    setPalette(palette) {
      this.palette = palette;
      if (!this.gl || !this.texture || !this.sourcePixels) return;
      const pixels = recolorEchoTexture(this.sourcePixels, palette);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
      this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.textureWidth, this.textureHeight, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);
      this.map?.triggerRepaint();
    },

    render(gl, args) {
      if (!this.ready || !this.program || !this.vertexBuffer) return;
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.uMatrix, false, args.defaultProjectionData.mainMatrix);
      gl.uniform1f(this.uOpacity, this.opacity);
      gl.uniform2f(this.uOrigin, this.originX, this.originY);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(this.uTexture, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // textura premultiplicada
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(this.aUv);
      gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 16, 8);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    },

    onRemove(map, gl) {
      this.abortController?.abort();
      if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.program) gl.deleteProgram(this.program);
      this.vertexBuffer = null;
      this.texture = null;
      this.ready = false;
    }
  };

  return custom;
}
