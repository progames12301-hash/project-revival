import {fetchJson,parseDate,proxyBase} from '../config.js';
// Imagens da REDEMET vao direto ao backend (Render), que ja tem a rota /api/radar-v2/image e CORS aberto.
// O Worker da mesma origem nao encaminha essa rota (404). Pode ser trocado via window.SIDERAL_RADAR_IMAGE_PROXY.
const IMAGE_PROXY=String((typeof window!=='undefined'&&window.SIDERAL_RADAR_IMAGE_PROXY)||'https://sideral-backend.onrender.com').replace(/\/$/,'');
const PIXEL_CACHE_MANIFEST='https://raw.githubusercontent.com/progames12301-hash/sideral-backend/radar-pixels/manifest.json';
const CORS_PROXY_HOSTS=new Set(['estatico-redemet.decea.mil.br','redemet.decea.mil.br']);
function corsImageUrl(url,base){
  if(!url||/^(?:blob:|data:)/i.test(url))return url;
  try{
    const parsed=new URL(url,location.href);
    if(parsed.origin===location.origin||parsed.origin===new URL(base,location.href).origin)return parsed.href;
    if(!CORS_PROXY_HOSTS.has(parsed.hostname.toLowerCase()))return parsed.href;
    return `${IMAGE_PROXY}/api/radar-v2/image?url=${encodeURIComponent(parsed.href)}`;
  }catch{return url}
}
export class RedemetProvider{
  constructor(cache){this.id='redemet';this.name='REDEMET / DECEA';this.cache=cache;this.frames=[];this.product='03km';this.lastPublished=new Map();this.pixelManifest=null;this.pixelManifestAt=0;this.pixelManifestPromise=null;this.loadCache=new Map();this.loadPromises=new Map();this.base=proxyBase();this.officialUrl='https://ajuda.decea.mil.br/base-de-conhecimento/api-redemet-produtos-radar/'}
  async loadPixelManifest(product){
    if(product!=='03km')return null;
    if(this.pixelManifest&&Date.now()-this.pixelManifestAt<300000)return this.pixelManifest;
    if(this.pixelManifestPromise)return this.pixelManifestPromise;
    this.pixelManifestPromise=(async()=>{
      try{
        const manifest=await fetchJson(`${PIXEL_CACHE_MANIFEST}?v=${Math.floor(Date.now()/300000)}`,{},7000);
        if(manifest?.schema!=='sideral-radar-pixel-cache-v1'||!Array.isArray(manifest.frames))return this.pixelManifest;
        const generated=Date.parse(manifest.generated_at||'');
        const ttl=Math.max(300,Number(manifest.ttl_seconds)||900);
        if(Number.isFinite(generated)&&Date.now()-generated>ttl*1000*3)return this.pixelManifest;
        this.pixelManifest=manifest;this.pixelManifestAt=Date.now();return manifest;
      }catch{return this.pixelManifest}
      finally{this.pixelManifestPromise=null}
    })();
    return this.pixelManifestPromise;
  }
  inViewport(item,view){
    if(!view)return true;
    const west=Number(item?.lon_min),east=Number(item?.lon_max),south=Number(item?.lat_min),north=Number(item?.lat_max);
    if(![west,east,south,north].every(Number.isFinite))return true;
    const padX=Math.max(.5,(Number(view.east)-Number(view.west))*.08),padY=Math.max(.5,(Number(view.north)-Number(view.south))*.08);
    return east>=Number(view.west)-padX&&west<=Number(view.east)+padX&&north>=Number(view.south)-padY&&south<=Number(view.north)+padY;
  }
  pixelCacheFor(image,item){
    const entries=(this.pixelManifest?.frames||[]).flatMap(frame=>Array.isArray(frame.items)?frame.items:[]);
    if(!entries.length)return null;
    const source=String(image?.path||'');
    const localidade=String(image?.localidade||item?.localidade||'').toLowerCase();
    const exact=entries.find(entry=>entry?.url&&source&&entry.sourcePath===source);
    if(exact)return exact;
    const candidates=entries.filter(entry=>entry?.url&&String(entry.localidade||'').toLowerCase()===localidade);
    if(!candidates.length)return null;
    const imageDate=parseDate(image?.data)?.getTime();
    if(Number.isFinite(imageDate)){
      const dated=candidates
        .map(entry=>({entry,time:parseDate(entry.date)?.getTime()}))
        .filter(value=>Number.isFinite(value.time))
        .sort((a,b)=>Math.abs(a.time-imageDate)-Math.abs(b.time-imageDate));
      if(dated[0]&&Math.abs(dated[0].time-imageDate)<10*60*1000)return dated[0].entry;
    }
    return candidates[0];
  }
  async load(product='03km'){
    const cached=this.loadCache.get(product);
    if(cached&&Date.now()-cached.savedAt<25000){this.product=product;this.frames=cached.data.frames;return cached.data;}
    if(this.loadPromises.has(product))return this.loadPromises.get(product);
    const pending=this.loadFresh(product).then(data=>{this.loadCache.set(product,{data,savedAt:Date.now()});return data}).finally(()=>this.loadPromises.delete(product));
    this.loadPromises.set(product,pending);return pending;
  }
  async loadFresh(product='03km'){
    this.product=product;
    const url=`${this.base}/api/redemet/radar?product=${encodeURIComponent(product)}&anima=15`;
    const manifestPromise=this.loadPixelManifest(product);
    const payload=await fetchJson(url);
    this.pixelManifest=await manifestPromise;
    if(!payload.status||!Array.isArray(payload.data?.radar))throw new Error('Resposta inválida da REDEMET');
    this.frames=payload.data.radar.map((items,index)=>({items,index,date:this.latestDate(items)}));
    const allItems=this.frames.flatMap(frame=>frame.items||[]);
    const publishedCodes=new Set(allItems.filter(item=>item?.path&&item.path!=='null').map(item=>item.localidade));
    const catalogCodes=new Set(allItems.map(item=>item.localidade).filter(Boolean));
    const records=new Map();allItems.forEach(item=>{
      const code=item?.localidade;if(!code)return;
      if(item.path&&item.path!=='null')this.lastPublished.set(code,item);
      if(!records.has(code))records.set(code,{id:code,code,provider:'REDEMET',name:(item.nome||code).replace('Radar - ',''),latitude:Number(item.lat_center),longitude:Number(item.lon_center),rangeKm:Number(item.raio)||250,projection:'EPSG:4326',imageSize:0,available:false});
      const record=records.get(code);record.imageSize=Math.max(record.imageSize||0,Number(item.tamanho)||0);record.available=publishedCodes.has(code)||this.lastPublished.has(code);
    });
    return {frames:this.frames,radars:[...records.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')),availableRadars:[...records.values()].filter(radar=>radar.available).length,unavailableRadars:Math.max(0,catalogCodes.size-publishedCodes.size)};
  }
  latestDate(items){const dates=(items||[]).map(x=>parseDate(x.data)).filter(Boolean);return dates.length?new Date(Math.max(...dates.map(x=>x.getTime()))):null}
  async imageLayers(frameIndex,selected='all',viewBounds=null){
    const frame=this.frames[frameIndex];if(!frame)return [];
    const wanted=frame.items.filter(x=>(selected==='all'||x.localidade===selected)&&this.inViewport(x,viewBounds));const layers=await Promise.all(wanted.map(async item=>{
      const candidates=[];for(let i=frameIndex;i>=0;i--){const candidate=this.frames[i].items.find(x=>x.localidade===item.localidade);if(candidate?.path&&candidate.path!=='null'&&!candidates.some(x=>x.path===candidate.path))candidates.push(candidate)}
      const imageCandidate=candidates[0]||this.lastPublished.get(item.localidade),cached=this.pixelCacheFor(imageCandidate,item);
      if(imageCandidate&&cached?.url){
        const west=Number(cached.bounds?.[0]??imageCandidate.lon_min),south=Number(cached.bounds?.[1]??imageCandidate.lat_min),east=Number(cached.bounds?.[2]??imageCandidate.lon_max),north=Number(cached.bounds?.[3]??imageCandidate.lat_max);
        const radar=cached.radar||{longitude:Number(imageCandidate.lon_center),latitude:Number(imageCandidate.lat_center)};
        return {kind:'image',id:`redemet-${this.product}-${item.localidade}`,url:cached.url,coordinates:[[west,north],[east,north],[east,south],[west,south]],radar:{longitude:Number(radar.longitude),latitude:Number(radar.latitude)},product:this.product,attribution:'Radar REDEMET/DECEA',stale:imageCandidate.path!==item.path,nativePixels:true,precomputed:true,preserveColors:true,cacheKey:cached.key||cached.url,sourcePath:corsImageUrl(imageCandidate.path,this.base),originalLayer:{url:corsImageUrl(imageCandidate.path,this.base),cacheKey:imageCandidate.path,coordinates:[[Number(imageCandidate.lon_min),Number(imageCandidate.lat_max)],[Number(imageCandidate.lon_max),Number(imageCandidate.lat_max)],[Number(imageCandidate.lon_max),Number(imageCandidate.lat_min)],[Number(imageCandidate.lon_min),Number(imageCandidate.lat_min)]],radar:{longitude:Number(imageCandidate.lon_center),latitude:Number(imageCandidate.lat_center)}}};
      }
      const image=candidates[0]||this.lastPublished.get(item.localidade);if(image)return {kind:'image',id:`redemet-${this.product}-${item.localidade}`,url:corsImageUrl(image.path,this.base),coordinates:[[Number(image.lon_min),Number(image.lat_max)],[Number(image.lon_max),Number(image.lat_max)],[Number(image.lon_max),Number(image.lat_min)],[Number(image.lon_min),Number(image.lat_min)]],radar:{longitude:Number(image.lon_center),latitude:Number(image.lat_center)},product:this.product,attribution:'Radar © REDEMET/DECEA',stale:image.path!==item.path}
      return null;
    }));return layers.filter(Boolean);
  }
  async lightning(){
    const payload=await fetchJson(`${this.base}/api/redemet/stsc?anima=1`);
    const snapshots=Array.isArray(payload?.data?.stsc)?payload.data.stsc:[];
    const latest=Array.isArray(snapshots[0])?snapshots[0]:[];
    const features=latest
      .map(point=>{
        const latitude=Number(point?.la);
        const longitude=Number(point?.lo);
        if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return null;
        return {
          type:'Feature',
          properties:{provider:'REDEMET / DECEA',source:'STSC',kind:'lightning'},
          geometry:{type:'Point',coordinates:[longitude,latitude]}
        };
      })
      .filter(Boolean);
    const observedAt=payload?.data?.info?.ultima_ocorrencia||null;
    features.observedAt=observedAt;
    features.provider='REDEMET / DECEA';
    features.kind='stsc';
    // Preserve the recent STSC frames so the radar can estimate the
    // displacement of the electrical/precipitating core itself.  The
    // forecast line must never fall back to model wind when this history is
    // available.
    features.snapshots=snapshots.filter(Array.isArray).map(snapshot=>snapshot.map(point=>({
      longitude:Number(point?.lo),latitude:Number(point?.la),
      time:point?.dt||point?.data||point?.hora||null
    })).filter(point=>Number.isFinite(point.longitude)&&Number.isFinite(point.latitude)));
    features.snapshotIntervalMinutes=Number(payload?.data?.intervalo_minutos||payload?.data?.intervalMinutes||5)||5;
    return features;
  }
}
