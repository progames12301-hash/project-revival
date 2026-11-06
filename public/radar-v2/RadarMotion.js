const SIZE = 224;
const SEARCH_RADIUS = 16;

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

function haversine(a, b) {
  const toRadians = value => value * Math.PI / 180;
  const latitude1 = toRadians(a[1]);
  const latitude2 = toRadians(b[1]);
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = toRadians(b[0] - a[0]);
  const value = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function bearing(a, b) {
  const toRadians = value => value * Math.PI / 180;
  const toDegrees = value => value * 180 / Math.PI;
  const latitude1 = toRadians(a[1]);
  const latitude2 = toRadians(b[1]);
  const deltaLongitude = toRadians(b[0] - a[0]);
  const y = Math.sin(deltaLongitude) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2) - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function layerKey(layer) {
  const radar = layer.radar || {};
  if (Number.isFinite(Number(radar.longitude)) && Number.isFinite(Number(radar.latitude))) {
    return `${Number(radar.longitude).toFixed(3)}:${Number(radar.latitude).toFixed(3)}:${layer.product || ''}`;
  }
  return `${JSON.stringify(layer.coordinates || [])}:${layer.product || ''}`;
}

function pixelToCoordinate(layer, x, y) {
  const coordinates = layer.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length !== 4) return null;
  const horizontal = x / (SIZE - 1);
  const vertical = y / (SIZE - 1);
  const topLongitude = coordinates[0][0] + (coordinates[1][0] - coordinates[0][0]) * horizontal;
  const bottomLongitude = coordinates[3][0] + (coordinates[2][0] - coordinates[3][0]) * horizontal;
  const leftLatitude = coordinates[0][1] + (coordinates[3][1] - coordinates[0][1]) * vertical;
  const rightLatitude = coordinates[1][1] + (coordinates[2][1] - coordinates[1][1]) * vertical;
  return [topLongitude + (bottomLongitude - topLongitude) * vertical, leftLatitude + (rightLatitude - leftLatitude) * horizontal];
}

async function readMask(layer) {
  const response = await fetch(layer.url, {mode: 'cors', credentials: 'omit', cache: 'force-cache', signal: AbortSignal.timeout(25000)});
  if (!response.ok || response.type === 'opaque') throw new Error('A imagem do radar não está disponível para análise CORS.');
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, SIZE, SIZE);
  context.drawImage(bitmap, 0, 0, SIZE, SIZE);
  bitmap.close();
  const pixels = context.getImageData(0, 0, SIZE, SIZE).data;
  const mask = new Uint8Array(SIZE * SIZE);
  for (let index = 0, offset = 0; index < mask.length; index++, offset += 4) {
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const alpha = pixels[offset + 3];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const chroma = maximum - minimum;
    if (alpha > 36 && maximum > 48 && chroma > 15) mask[index] = 1;
  }
  return mask;
}

function components(mask) {
  const visited = new Uint8Array(mask.length);
  const found = [];
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    const pixels = [];
    while (head < tail) {
      const index = queue[head++];
      const x = index % SIZE;
      const y = Math.floor(index / SIZE);
      area++;
      sumX += x;
      sumY += y;
      pixels.push(index);
      const neighbours = [index - 1, index + 1, index - SIZE, index + SIZE];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || neighbour >= mask.length || visited[neighbour] || !mask[neighbour]) continue;
        const neighbourX = neighbour % SIZE;
        if (Math.abs(neighbourX - x) > 1) continue;
        visited[neighbour] = 1;
        queue[tail++] = neighbour;
      }
    }
    if (area >= 14) found.push({area, x: sumX / area, y: sumY / area, pixels});
  }
  return found.sort((a, b) => b.area - a.area).slice(0, 10);
}

function correlate(component, previousMask) {
  let best = null;
  for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      let hits = 0;
      let samples = 0;
      for (let sample = 0; sample < component.pixels.length; sample += 2) {
        const index = component.pixels[sample];
        const x = index % SIZE;
        const y = Math.floor(index / SIZE);
        const previousX = x - dx;
        const previousY = y - dy;
        if (previousX < 0 || previousX >= SIZE || previousY < 0 || previousY >= SIZE) continue;
        hits += previousMask[previousY * SIZE + previousX];
        samples++;
      }
      if (!samples) continue;
      const overlap = hits / samples;
      const distancePenalty = Math.hypot(dx, dy) * 0.0025;
      const score = overlap - distancePenalty;
      if (!best || score > best.score) best = {dx, dy, score, overlap};
    }
  }
  return best;
}

function nearestTrack(tracks, focus) {
  if (!focus || !tracks.length) return tracks;
  return tracks.slice().sort((a, b) => haversine(a.origin, [focus.lng, focus.lat]) - haversine(b.origin, [focus.lng, focus.lat])).slice(0, 1);
}

export class RadarMotion {
  async estimate(previousLayers, currentLayers, previousDate, currentDate, {focus = null, limit = 6} = {}) {
    const elapsedHours = (currentDate.getTime() - previousDate.getTime()) / 3600000;
    if (!(elapsedHours > 0.02 && elapsedHours <= 1.5)) return [];
    const previousByRadar = new Map((previousLayers || []).filter(layer => layer?.kind === 'image').map(layer => [layerKey(layer), layer]));
    const candidates = (currentLayers || []).filter(layer => layer?.kind === 'image' && previousByRadar.has(layerKey(layer))).slice(0, 4);
    const tracks = [];

    for (const current of candidates) {
      const previous = previousByRadar.get(layerKey(current));
      try {
        const [previousMask, currentMask] = await Promise.all([readMask(previous), readMask(current)]);
        for (const component of components(currentMask)) {
          const motion = correlate(component, previousMask);
          if (!motion || motion.overlap < 0.34 || Math.hypot(motion.dx, motion.dy) < 0.75) continue;
          const origin = pixelToCoordinate(current, component.x, component.y);
          const prior = pixelToCoordinate(current, component.x - motion.dx, component.y - motion.dy);
          if (!origin || !prior) continue;
          const distanceKm = haversine(prior, origin);
          const speedKt = distanceKm / elapsedHours / 1.852;
          if (!Number.isFinite(speedKt) || speedKt < 2 || speedKt > 125) continue;
          tracks.push({
            origin,
            bearingDeg: bearing(prior, origin),
            speedKt: clamp(speedKt, 2, 125),
            details: {
              method: 'Correlação entre quadros do radar',
              confidence: motion.overlap,
              activity: component.area
            }
          });
        }
      } catch (error) {
        console.warn('BrazilScope: correlação indisponível para uma camada.', error);
      }
    }

    const separated = [];
    for (const track of tracks.sort((a, b) => (b.details.activity * b.details.confidence) - (a.details.activity * a.details.confidence))) {
      if (separated.some(item => haversine(item.origin, track.origin) < 22)) continue;
      separated.push(track);
      if (separated.length >= limit) break;
    }
    return nearestTrack(separated, focus);
  }
}
