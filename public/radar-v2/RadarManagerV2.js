import {RadarManager} from '../radar/RadarManager.js?v=20260831-all-no-rainviewer1';
import {proxyBase, preference, savePreference} from '../radar/config.js?v=20260826-smooth2';
import {RadarHistory} from './RadarHistory.js';

// Ver comentario em radar/providers/RedemetProvider.js: imagens da REDEMET vao direto ao Render.
const IMAGE_PROXY = String((typeof window !== 'undefined' && window.SIDERAL_RADAR_IMAGE_PROXY) || 'https://sideral-backend.onrender.com').replace(/\/$/, '');

const EXTERNAL_IMAGE_HOSTS = new Set([
  'estatico-redemet.decea.mil.br',
  'raw.githubusercontent.com'
]);

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function appendScanVersion(url, timestamp) {
  if (!url || /^(?:blob:|data:)/i.test(url)) return url;
  try {
    const parsed = new URL(url, location.href);
    if (/\/api\/(?:cemaden\/radar\/imagem|inea\/image|simepar\/image|regional\/radar\/image|ipmet\/wms)$/.test(parsed.pathname)) {
      parsed.searchParams.set('bsScan', String(timestamp));
    }
    return parsed.href;
  } catch { return url; }
}

function corsImageUrl(url) {
  if (!url || /^(?:blob:|data:)/i.test(url)) return url;
  try {
    const parsed = new URL(url, location.href);
    const backend = new URL(proxyBase(), location.href);
    if (parsed.origin === location.origin || parsed.origin === backend.origin) return parsed.href;
    if (!EXTERNAL_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) return parsed.href;
    return `${IMAGE_PROXY}/api/radar-v2/image?url=${encodeURIComponent(parsed.href)}`;
  } catch { return url; }
}

function scopePart(value) {
  return String(value ?? '').replace(/[^a-z0-9_.:-]+/gi, '_').slice(0, 160);
}

export class RadarManagerV2 extends RadarManager {
  constructor() {
    super();
    this.history = new RadarHistory();
    this.liveFrames = [];
    this.resolvedLayers = new Map();
    this.archiveToken = 0;
    this.historyReady = false;
    this.layers.track = false;
    this.renderMode = preference('sideralBrazilScopeRenderMode', 'brazil_scope');
    this.quality = preference('sideralBrazilScopeQuality', 'extreme');
    if (!['standard', 'pixel', 'mirror', 'usa_radial', 'brazil_scope'].includes(this.renderMode)) this.renderMode = 'brazil_scope';
    if (!['balanced', 'high', 'ultra', 'extreme', 'supreme4k'].includes(this.quality)) this.quality = 'extreme';
  }

  async init() {
    try { this.historyReady = await this.history.init(); } catch (error) { console.warn('BrazilScope: histórico local indisponível.', error); }
    await super.init();
    this.layers.track = false;
    this.map.setStormTrackPicker(false, null);
    this.map.clearStormTrack();
    this.updateHistoryStatus();
  }

  historyScope() {
    const product = this.source === 'redemet' ? this.cappiProducts.join('+') : this.product;
    return [this.source, product, this.selected || 'all'].map(scopePart).join(':');
  }

  frameKey(frame) {
    const date = validDate(frame?.date);
    return date ? date.getTime() : null;
  }

  prepareLayers(layers, date) {
    const timestamp = validDate(date)?.getTime() || Date.now();
    return (layers || []).filter(Boolean).map(layer => {
      if (layer.kind !== 'image') return layer;
      const versioned = appendScanVersion(layer.url, timestamp);
      const url = corsImageUrl(versioned);
      return {
        ...layer,
        url,
        cacheKey: `${layer.cacheKey || layer.url || layer.id}:${timestamp}:brazilscope-v2`,
        smoothing: false,
        interpolation: 'nearest',
        resampling: 'nearest',
        rasterResampling: 'nearest'
      };
    });
  }

  async liveLayersForFrame(frame, fallbackIndex = 0, selected = this.selected) {
    if (this.isCombinedSource()) return this.combinedLiveLayers(frame);
    const providerIndex = Number.isInteger(frame?.__providerIndex) ? frame.__providerIndex : fallbackIndex;
    if (this.source !== 'redemet' || !this.redemetCatalogs.length) {
      const provider = this.providers[this.source];
      const providerFrame = provider?.frames?.[providerIndex] || frame;
      const layers = provider?.imageLayers
        ? await provider.imageLayers(providerIndex, selected, this.quality)
        : [provider?.frameLayer(providerFrame, this.quality)];
      return this.prepareLayers(layers, frame?.date);
    }

    const target = validDate(frame?.date);
    const batches = await Promise.all(this.redemetCatalogs.map(async catalog => {
      let frameIndex = Math.min(providerIndex, catalog.data.frames.length - 1);
      if (target) {
        let difference = Infinity;
        catalog.data.frames.forEach((candidate, index) => {
          const date = validDate(candidate.date);
          const delta = date ? Math.abs(date.getTime() - target.getTime()) : Infinity;
          if (delta < difference) { difference = delta; frameIndex = index; }
        });
      }
      const layers = await catalog.provider.imageLayers(Math.max(0, frameIndex), selected, this.quality);
      return layers.map(layer => ({...layer, id: `${layer.id}-${catalog.product}`, product: catalog.product}));
    }));
    return this.prepareLayers(batches.flat(), frame?.date);
  }

  async currentImageLayers(index, selected = this.selected) {
    const frame = this.frames[index];
    if (!frame) return [];
    let layers;
    if (frame.__historyRecord) layers = await this.history.restoreLayers(frame.__historyRecord);
    else layers = await this.liveLayersForFrame(frame, index, selected);
    const key = this.frameKey(frame);
    if (key != null) this.resolvedLayers.set(key, layers);
    return layers;
  }

  async combinedLiveLayers(frame = this.frames.at(-1)) {
    const layers = [];
    for (const item of this.allSources || []) {
      try {
        const frameIndex = Math.max(0, item.data.frames.length - 1);
        const sourceFrame = item.data.frames[frameIndex];
        const produced = item.provider.imageLayers
          ? await item.provider.imageLayers(frameIndex, 'all', this.quality)
          : [item.provider.frameLayer(sourceFrame, this.quality)];
        this.prepareLayers(produced, sourceFrame?.date || frame?.date).forEach(layer => layers.push({...layer, __source: item.id, keepView: true}));
      } catch (error) {
        console.warn(`BrazilScope: fonte ${item.id} não pôde ser preparada.`, error);
      }
    }
    return layers;
  }

  async render(index, fromStyleReload = false) {
    if (this.isCombinedSource()) return this.renderAll(index, fromStyleReload);
    const frame = this.frames[index];
    const rendered = await super.render(index, fromStyleReload);
    if (!rendered || !frame) return rendered;
    if (!frame.__historyRecord && this.historyReady) {
      const key = this.frameKey(frame);
      const layers = this.resolvedLayers.get(key) || [];
      void this.history.storeFrame(this.historyScope(), frame.date, layers).then(() => this.updateHistoryStatus()).catch(error => console.warn('BrazilScope: falha ao salvar o quadro.', error));
    }
    return rendered;
  }

  async renderAll(index, fromStyleReload = false) {
    const frame = this.frames[index];
    if (!frame) return false;
    const token = ++this.renderToken;
    try {
      this.map.setRadarStyle(this.style, this.opacity);
      const layers = await this.currentImageLayers(index, 'all');
      const processed = layers.filter(Boolean).map(layer => ({...this.processedLayer(layer, layer.__source || this.source, frame.date?.getTime() || index), keepView: true}));
      if (token !== this.renderToken) return false;
      await this.map.replaceRadar(processed, this.exporting ? 0 : 160, this.exporting ? {timeout: 12000, requireLoaded: true} : undefined);
      if (token !== this.renderToken) return false;
      this.map.setRadarStyle(this.style, this.opacity);
      this.ui.frame(index, frame.date);
      this.animation.index = index;
      if (!frame.__historyRecord && this.historyReady) {
        void this.history.storeFrame(this.historyScope(), frame.date, layers).then(() => this.updateHistoryStatus()).catch(error => console.warn('BrazilScope: falha ao salvar o mosaico.', error));
      }
      if (!processed.length && !fromStyleReload) this.ui.status({title: 'Sem imagens disponíveis', detail: 'Nenhuma rede publicou um quadro utilizável neste horário.', origin: 'BrazilScope', error: true});
      return true;
    } catch (error) {
      if (!fromStyleReload) this.ui.status({title: 'Não foi possível exibir este horário', detail: this.errorMessage(error), origin: 'BrazilScope', error: true});
      if (this.exporting) throw error;
      return false;
    }
  }

  async switchSource(source, refresh = false) {
    const token = ++this.archiveToken;
    await super.switchSource(source, refresh);
    if (token !== this.archiveToken || !this.frames.length) {
      this.liveFrames = this.frames.map((frame, index) => ({...frame, __providerIndex: index, __live: true}));
      return;
    }
    this.liveFrames = this.frames.map((frame, index) => ({...frame, __providerIndex: index, __live: true}));
    try { await this.mergeHistory({latest: true}); } catch (error) { console.warn('BrazilScope: histórico não pôde ser combinado.', error); }
    void this.archiveLiveFrames(token).catch(error => console.warn('BrazilScope: arquivamento interrompido.', error));
  }

  async mergeHistory({latest = false} = {}) {
    if (!this.historyReady) return;
    const currentTimestamp = this.frameKey(this.frames[this.animation.index]);
    const records = await this.history.loadFrames(this.historyScope());
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const live = this.liveFrames.filter(frame => this.frameKey(frame) >= cutoff);
    const occupied = live.map(frame => this.frameKey(frame));
    const archived = records
      .filter(record => !occupied.some(timestamp => Math.abs(timestamp - record.timestamp) < 30000))
      .map(record => ({date: new Date(record.timestamp), __historyRecord: record, __live: false}));
    this.frames = [...archived, ...live].sort((a, b) => this.frameKey(a) - this.frameKey(b));
    let index = Math.max(0, this.frames.length - 1);
    if (!latest && currentTimestamp != null && this.frames.length) {
      let difference = Infinity;
      this.frames.forEach((frame, candidate) => {
        const delta = Math.abs(this.frameKey(frame) - currentTimestamp);
        if (delta < difference) { difference = delta; index = candidate; }
      });
    }
    this.animation.count = this.frames.length;
    this.animation.index = index;
    this.ui.timeline(this.frames, index);
    this.updateHistoryStatus();
  }

  async archiveLiveFrames(token) {
    if (!this.historyReady || !this.liveFrames.length) return;
    const scope = this.historyScope();
    const frames = this.liveFrames.slice().sort((a, b) => this.frameKey(b) - this.frameKey(a));
    for (const frame of frames) {
      if (token !== this.archiveToken || scope !== this.historyScope()) return;
      try {
        const layers = await this.liveLayersForFrame(frame, frame.__providerIndex, this.selected);
        await this.history.storeFrame(scope, frame.date, layers);
      } catch (error) {
        console.warn('BrazilScope: um quadro recente não pôde ser arquivado.', error);
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (token !== this.archiveToken) return;
    await this.mergeHistory();
    this.updateHistoryStatus();
  }

  async selectRadar(id) {
    this.archiveToken++;
    this.selected = id;
    if (this.liveFrames.length) {
      try { await this.mergeHistory(); } catch (error) { console.warn('BrazilScope: histórico deste radar indisponível.', error); }
    }
    await super.selectRadar(id);
    const token = this.archiveToken;
    void this.archiveLiveFrames(token).catch(error => console.warn('BrazilScope: arquivamento deste radar interrompido.', error));
  }

  setRenderMode(value) {
    savePreference('sideralBrazilScopeRenderMode', value);
    super.setRenderMode(value);
  }

  setQuality(value) {
    savePreference('sideralBrazilScopeQuality', value);
    super.setQuality(value);
  }

  updateHistoryStatus() {
    const element = document.getElementById('historyStatus');
    if (!element) return;
    if (!this.historyReady) {
      element.textContent = 'Histórico local indisponível neste navegador';
      return;
    }
    void this.history.stats(this.historyScope()).then(stats => {
      const persistence = stats.persistent ? 'armazenamento protegido' : 'armazenamento do navegador';
      element.textContent = `${stats.frames} ${stats.frames === 1 ? 'quadro salvo' : 'quadros salvos'} · até 48 h · ${persistence}`;
    }).catch(() => { element.textContent = 'Histórico local em preparação'; });
  }

  async refreshAutomaticTracks() {
    this.layers.track = false;
    this.map.setStormTrackPicker(false, null);
    this.map.clearStormTrack();
  }

  toggleLayer(name, visible) {
    if (name === 'track') {
      this.layers.track = false;
      this.map.setStormTrackPicker(false, null);
      this.map.clearStormTrack();
      return;
    }
    super.toggleLayer(name, visible);
  }

  destroy() {
    this.archiveToken++;
    this.history.destroy();
    super.destroy();
  }
}
