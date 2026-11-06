const RETENTION_MS = 48 * 60 * 60 * 1000;
const CACHE_NAME = 'sideral-brazilscope-images-v2';
const DB_NAME = 'sideral-brazilscope-v2';
const DB_VERSION = 1;
const STORE_NAME = 'frames';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, {keyPath: 'id'});
      if (!store.indexNames.contains('scope')) store.createIndex('scope', 'scope', {unique: false});
      if (!store.indexNames.contains('timestamp')) store.createIndex('timestamp', 'timestamp', {unique: false});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o histórico do radar.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao acessar o histórico do radar.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Falha ao salvar o histórico do radar.'));
    transaction.onabort = () => reject(transaction.error || new Error('A gravação do histórico foi interrompida.'));
  });
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function layerIdentity(layer) {
  const radar = layer.radar || {};
  const origin = `${Number(radar.longitude).toFixed(4)},${Number(radar.latitude).toFixed(4)}`;
  return `${layer.id || 'radar'}|${layer.product || ''}|${origin}|${JSON.stringify(layer.coordinates || [])}`;
}

function safeLayer(layer, cacheRequest) {
  return {
    kind: 'image',
    id: layer.id,
    cacheKey: layer.cacheKey,
    cacheRequest,
    coordinates: layer.coordinates,
    radar: layer.radar || null,
    product: layer.product || null,
    attribution: layer.attribution || '',
    preserveColors: Boolean(layer.preserveColors),
    nativePixels: Boolean(layer.nativePixels),
    precomputed: Boolean(layer.precomputed),
    skipPixelTransform: Boolean(layer.skipPixelTransform),
    pixelated: layer.pixelated !== false,
    smoothing: false,
    interpolation: 'nearest',
    resampling: 'nearest',
    rasterResampling: 'nearest'
  };
}

export class RadarHistory {
  constructor({retentionMs = RETENTION_MS} = {}) {
    this.retentionMs = retentionMs;
    this.database = null;
    this.cache = null;
    this.objectUrls = new Set();
    this.objectUrlByRequest = new Map();
    this.persistent = false;
    this.lastPrune = 0;
  }

  async init() {
    if (!('indexedDB' in window) || !('caches' in window)) return false;
    this.database = await openDatabase();
    this.cache = await caches.open(CACHE_NAME);
    if (navigator.storage?.persist) {
      try { this.persistent = await navigator.storage.persist(); } catch { this.persistent = false; }
    }
    await this.prune();
    this.lastPrune = Date.now();
    return true;
  }

  async get(id) {
    if (!this.database) return null;
    const transaction = this.database.transaction(STORE_NAME, 'readonly');
    return requestResult(transaction.objectStore(STORE_NAME).get(id));
  }

  async put(record) {
    const transaction = this.database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    await transactionDone(transaction);
  }

  async storeFrame(scope, date, layers) {
    if (!this.database || !this.cache || !scope || !(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    if (Date.now() - this.lastPrune > 10 * 60 * 1000) {
      this.lastPrune = Date.now();
      await this.prune();
    }
    const timestamp = date.getTime();
    if (timestamp < Date.now() - this.retentionMs || timestamp > Date.now() + 10 * 60 * 1000) return null;
    const id = `${scope}|${timestamp}`;
    const previous = await this.get(id);
    const stored = new Map((previous?.layers || []).map(layer => [layer.identity, layer]));

    for (const layer of layers || []) {
      if (layer?.kind !== 'image' || !layer.url || !Array.isArray(layer.coordinates)) continue;
      const identity = layerIdentity(layer);
      const cacheRequest = `${location.origin}/__brazilscope_cache__/${hashText(`${id}|${identity}`)}`;
      try {
        let response = await this.cache.match(cacheRequest);
        if (!response) {
          const fetched = await fetch(layer.url, {mode: 'cors', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000)});
          if (!fetched.ok || fetched.type === 'opaque') throw new Error(`Imagem respondeu HTTP ${fetched.status || 0}`);
          const contentType = fetched.headers.get('content-type') || '';
          if (!contentType.startsWith('image/')) throw new Error('A resposta recebida não é uma imagem de radar.');
          response = new Response(await fetched.blob(), {headers: {'Content-Type': contentType, 'Cache-Control': 'public, max-age=172800'}});
          try {
            await this.cache.put(cacheRequest, response.clone());
          } catch (error) {
            if (error?.name !== 'QuotaExceededError') throw error;
            await this.prune({aggressive: true});
            await this.cache.put(cacheRequest, response.clone());
          }
        }
        stored.set(identity, {...safeLayer(layer, cacheRequest), identity});
      } catch (error) {
        console.warn('BrazilScope: quadro não pôde ser guardado.', error);
      }
    }

    if (!stored.size) return previous || null;
    const record = {id, scope, timestamp, savedAt: Date.now(), layers: [...stored.values()]};
    try {
      await this.put(record);
    } catch (error) {
      if (error?.name === 'QuotaExceededError') {
        await this.prune({aggressive: true});
        await this.put(record);
      } else throw error;
    }
    return record;
  }

  async loadFrames(scope) {
    if (!this.database || !scope) return [];
    const transaction = this.database.transaction(STORE_NAME, 'readonly');
    const index = transaction.objectStore(STORE_NAME).index('scope');
    const records = await requestResult(index.getAll(IDBKeyRange.only(scope)));
    const cutoff = Date.now() - this.retentionMs;
    return records.filter(record => record.timestamp >= cutoff && record.layers?.length).sort((a, b) => a.timestamp - b.timestamp);
  }

  async restoreLayers(record) {
    if (!this.cache || !record?.layers?.length) return [];
    const layers = [];
    for (const layer of record.layers) {
      const response = await this.cache.match(layer.cacheRequest);
      if (!response) continue;
      let url = this.objectUrlByRequest.get(layer.cacheRequest);
      if (!url) {
        url = URL.createObjectURL(await response.blob());
        this.objectUrlByRequest.set(layer.cacheRequest, url);
        this.objectUrls.add(url);
      }
      layers.push({...layer, url, cacheKey: `${layer.cacheKey || layer.id}:${record.timestamp}:history`, history: true});
    }
    return layers;
  }

  releaseObjectUrls() {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.objectUrlByRequest.clear();
  }

  async prune({aggressive = false} = {}) {
    if (!this.database || !this.cache) return;
    const transaction = this.database.transaction(STORE_NAME, 'readonly');
    const records = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    const cutoff = Date.now() - this.retentionMs;
    const expired = records.filter(record => record.timestamp < cutoff);
    if (aggressive) {
      const survivors = records.filter(record => record.timestamp >= cutoff).sort((a, b) => a.timestamp - b.timestamp);
      expired.push(...survivors.slice(0, Math.ceil(survivors.length / 4)));
    }
    if (!expired.length) return;
    const write = this.database.transaction(STORE_NAME, 'readwrite');
    const store = write.objectStore(STORE_NAME);
    const cacheRequests = [];
    for (const record of expired) {
      store.delete(record.id);
      for (const layer of record.layers || []) cacheRequests.push(layer.cacheRequest);
    }
    await transactionDone(write);
    await Promise.all(cacheRequests.map(request => this.cache.delete(request)));
  }

  async stats(scope) {
    const records = await this.loadFrames(scope);
    let usage = null;
    let quota = null;
    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        usage = estimate.usage ?? null;
        quota = estimate.quota ?? null;
      } catch {}
    }
    return {frames: records.length, oldest: records[0]?.timestamp || null, newest: records.at(-1)?.timestamp || null, persistent: this.persistent, usage, quota};
  }

  destroy() {
    this.releaseObjectUrls();
    this.database?.close();
  }
}

export {RETENTION_MS};
