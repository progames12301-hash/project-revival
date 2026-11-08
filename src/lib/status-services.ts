export const STATUS_INTERVAL_MS = 60_000;
export type Service = { id: string; name: string; group: string; url: string; kind: string; body?: string };
export const SERVICES: Service[] = [
  {
    "id": "redemet",
    "name": "REDEMET / DECEA",
    "group": "Radar e tempo",
    "url": "https://sideral-backend.onrender.com/api/redemet/radar?product=03km&anima=15",
    "kind": "json"
  },
  {
    "id": "cemaden",
    "name": "CEMADEN",
    "group": "Radar e tempo",
    "url": "https://sideral-backend.onrender.com/api/cemaden/radar?product=reflectivity",
    "kind": "json"
  },
  {
    "id": "regional",
    "name": "Radares regionais",
    "group": "Radar e tempo",
    "url": "https://sideral-backend.onrender.com/api/regional/radar?product=reflectivity",
    "kind": "json"
  },
  {
    "id": "inea",
    "name": "INEA",
    "group": "Radar e tempo",
    "url": "https://sideral-backend.onrender.com/api/inea/frames?radar=mendanha&product=reflectivity",
    "kind": "json"
  },
  {
    "id": "simepar",
    "name": "SIMEPAR",
    "group": "Radar e tempo",
    "url": "https://sideral-backend.onrender.com/api/simepar/meta",
    "kind": "json"
  },
  {
    "id": "ipmet",
    "name": "IPMet / UNESP",
    "group": "Radar e tempo",
    "url": "https://sideral-backend.onrender.com/api/ipmet/meta",
    "kind": "json"
  },
  {
    "id": "glm",
    "name": "Raios GLM",
    "group": "Radar e tempo",
    "url": "https://sideral-backend.onrender.com/api/glm/latest",
    "kind": "json"
  },
  {
    "id": "rainviewer",
    "name": "RainViewer",
    "group": "Radar e tempo",
    "url": "https://api.rainviewer.com/public/weather-maps.json",
    "kind": "json"
  },
  {
    "id": "cloudultra",
    "name": "CloudUltra Res / CPTEC",
    "group": "Radar e tempo",
    "url": "https://nowcasting.cptec.inpe.br/api/v1/paths/catalog",
    "kind": "json"
  },
  {
    "id": "satellite",
    "name": "Satélite GOES-19 / CPTEC",
    "group": "Satélite",
    "url": "https://nowcasting.cptec.inpe.br/api/v1/products/times",
    "kind": "json",
    "body": "{\"items\": [{\"type\": \"layer\", \"workspace\": \"path-satelite\", \"layer\": \"path-satelite:goes19_web~ams_rgb_natcolor\"}]}"
  },
  {
    "id": "lightningcast",
    "name": "LightningCast",
    "group": "Satélite",
    "url": "https://nowcasting.cptec.inpe.br/api/v1/geojson-products/static/path--satelite-2--last_forecast/latest",
    "kind": "json"
  },
  {
    "id": "tathu",
    "name": "TATHU",
    "group": "Satélite",
    "url": "https://nowcasting.cptec.inpe.br/api/v1/geojson-products/catalog?include_times=true",
    "kind": "json"
  },
  {
    "id": "inmet",
    "name": "Avisos INMET",
    "group": "Observações",
    "url": "https://apiprevmet3.inmet.gov.br/avisos/ativos",
    "kind": "json"
  },
  {
    "id": "gibs",
    "name": "NASA GIBS · AIRS, MODIS, oceano e superfície",
    "group": "Sensoriamento remoto",
    "url": "https://gibs-a.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetCapabilities",
    "kind": "xml"
  },
  {
    "id": "noaa",
    "name": "Análise sinótica NOAA / WPC",
    "group": "Análise e oscilações",
    "url": "https://www.wpc.ncep.noaa.gov/international/sampssfc00.gif",
    "kind": "image"
  },
  {
    "id": "aao",
    "name": "Oscilação Antártica NOAA / CPC",
    "group": "Análise e oscilações",
    "url": "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_ao_index/aao/aao.gefs.fcst.png",
    "kind": "image"
  },
  {
    "id": "smn",
    "name": "Análise sinótica SMN Argentina",
    "group": "Análise e oscilações",
    "url": "https://ssl.smn.gob.ar/dpd/tiepre/cpi/v1_anasup00.gif",
    "kind": "image"
  },
  {
    "id": "nefo",
    "name": "Nefoanálise Argentina",
    "group": "Análise e oscilações",
    "url": "https://estaticos.smn.gob.ar/vmsr/satelite/nefo_00_24.jpg",
    "kind": "image"
  },
  {
    "id": "astorp",
    "name": "ASTORP",
    "group": "Previsões",
    "url": "https://rawinsonde.com/ASTORP_SAM/Results/SPC_hour_F000.jpg",
    "kind": "image"
  },
  {
    "id": "wrf-brasil",
    "name": "SIDERAL WRF Brasil 21 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/wrf-brasil-12km-data/metadata.json",
    "kind": "json"
  },
  {
    "id": "cbr-json-data",
    "name": "WRF CBR 4 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/cbr-json-data/metadata.json",
    "kind": "json"
  },
  {
    "id": "cbr-wrf2-json-data",
    "name": "WRF2 CBR 4 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/cbr-wrf2-json-data/metadata.json",
    "kind": "json"
  },
  {
    "id": "metbr-json-data",
    "name": "METBR WRF 4 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/metbr-json-data/metadata.json",
    "kind": "json"
  },
  {
    "id": "metbr-wrf2-json-data",
    "name": "METBR WRF2 4 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/metbr-wrf2-json-data/metadata.json",
    "kind": "json"
  },
  {
    "id": "sideral-wrf-4km-sudeste-data",
    "name": "WRF Sudeste 4 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/sideral-wrf-4km-sudeste-data/metadata.json",
    "kind": "json"
  },
  {
    "id": "sideral-wrf-4km-2-sudeste-data",
    "name": "WRF2 Sudeste 4 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/sideral-wrf-4km-2-sudeste-data/metadata.json",
    "kind": "json"
  },
  {
    "id": "sideral-wrf-5km-sudeste-data",
    "name": "WRF Sudeste 5 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/sideral-wrf-5km-sudeste-data/metadata.json",
    "kind": "json"
  },
  {
    "id": "sideral-wrf-5km-2-sudeste-data",
    "name": "WRF2 Sudeste 5 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/sideral-wrf-5km-2-sudeste-data/metadata.json",
    "kind": "json"
  },
  {
    "id": "tarc-json-data",
    "name": "WRF TARC 3 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/tarc-json-data/metadata.json",
    "kind": "json"
  },
  {
    "id": "tarc-wrf2-json-data",
    "name": "WRF2 TARC 3 km",
    "group": "Modelos regionais",
    "url": "https://raw.githubusercontent.com/progames12301-hash/sideral-backend/tarc-wrf2-json-data/metadata.json",
    "kind": "json"
  }
];
