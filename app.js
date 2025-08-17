/* app.js — OCR + Parser + GeoJSON lookup
   - Robust crop of bottom ribbon (keeps "Lat ... Long ...")
   - Tolerant parsing (degree symbols, colons, NBSP, mixed punctuation)
   - Fast bbox grid + point-in-polygon to fetch Ward / Beat / Police Station
   - UI: does not change layout; only fills values if elements exist
   - Requires Tesseract.js v5 CDN already loaded on the page
*/

// ---------------------- Config ----------------------
const CFG = {
  // Where your GeoJSONs live
  paths: {
    wards: './data/wards.geojson',
    beats: './data/beats.geojson',
    police: './data/police_jurisdiction.geojson',
  },
  // Crop heuristics for the dark GPS ribbon at the bottom of the image
  crop: {
    bottomStartFrac: 0.72,     // start scanning from 72% height
    ribbonMinHeightFrac: 0.16, // expected ribbon height ~16–22%
    ribbonMaxHeightFrac: 0.26,
    leftCutPx: 80,             // cut this many pixels from left to hide mini-map
    rightPadPx: 16,            // keep a small right pad
    fallbackRect: {            // used if auto-detect stumbles
      xFrac: 0.33, yFrac: 0.74, wFrac: 0.65, hFrac: 0.22
    }
  },
  // Mumbai sanity window to re-label raw numbers when labels are missing
  cityWindow: { latMin: 18.0, latMax: 20.8, lngMin: 72.0, lngMax: 73.3 },
  // DOM ids (optional—script checks existence)
  dom: {
    input: '#file,#fileInput,input[type=file]',
    drop:  '#dropZone,[data-dropzone]',
    origImg:  '#orig-preview,#origThumb',
    cropImg:  '#crop-preview,#cropThumb',
    date: '#res-date', time: '#res-time',
    lat:  '#res-lat',  lng:  '#res-lng',
    addr: '#res-address',
    ward: '#res-ward', beat: '#res-beat', ps: '#res-ps',
    perf: '#perf-line' // optional "Upload — 0.0s • OCR — 0.0s ..." line
  }
};

// ---------------------- Small DOM helpers ----------------------
const $ = (sel) => document.querySelector(sel);
const setText = (sel, v) => { const el = $(sel); if (el) el.textContent = v ?? '—'; };
const setImg  = (sel, src) => { const el = $(sel); if (el && src) el.src = src; };

// ---------------------- Image utilities ----------------------
async function fileToImageBitmap(file) {
  const url = URL.createObjectURL(file);
  const img = await createImageBitmap(await (await fetch(url)).blob());
  URL.revokeObjectURL(url);
  return img;
}
function canvasFromBitmap(bmp) {
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return c;
}
function dataURLFromCanvas(cv) { return cv.toDataURL('image/jpeg', 0.92); }

// Auto-detect dark ribbon near bottom; fall back to fixed fractions
function computeRibbonRect(bmp) {
  const { width: w, height: h } = bmp;
  const ctx = canvasFromBitmap(bmp).getContext('2d', { willReadFrequently: true });
  const startY = Math.floor(h * CFG.crop.bottomStartFrac);
  const scanH  = h - startY;
  const imgData = ctx.getImageData(0, startY, w, scanH);
  const px = imgData.data;

  // Build per-row average luma to find darkest band
  const rowLuma = new Float32Array(scanH);
  for (let y = 0; y < scanH; y++) {
    let sum = 0; let off = y * w * 4;
    for (let x = 0; x < w; x++, off += 4) {
      const r = px[off], g = px[off+1], b = px[off+2];
      sum += 0.2126*r + 0.7152*g + 0.0722*b;
    }
    rowLuma[y] = sum / w;
  }
  // Find contiguous darkest window whose height matches expected ribbon height
  const minH = Math.floor(h * CFG.crop.ribbonMinHeightFrac);
  const maxH = Math.floor(h * CFG.crop.ribbonMaxHeightFrac);
  let best = null;
  for (let hh = minH; hh <= maxH; hh += Math.max(4, Math.floor(h*0.01))) {
    for (let y = 0; y + hh <= scanH; y += 4) {
      let acc = 0;
      for (let t = 0; t < hh; t++) acc += rowLuma[y+t];
      const avg = acc / hh;
      if (!best || avg < best.avg) best = { y, hh, avg };
    }
  }
  // If we couldn't decide, fall back to fixed fraction
  if (!best) {
    const r = CFG.crop.fallbackRect;
    return {
      x: Math.floor(w * r.xFrac),
      y: Math.floor(h * r.yFrac),
      w: Math.floor(w * r.wFrac),
      h: Math.floor(h * r.hFrac)
    };
  }
  // Build final rectangle, trimming the left to remove Google mini-map
  const x = Math.max(CFG.crop.leftCutPx, 0);
  const y = startY + best.y;
  const rectW = w - x - CFG.crop.rightPadPx;
  const rectH = best.hh;
  return { x, y, w: rectW, h: rectH };
}
function cropCanvas(bmp, rect) {
  const c = document.createElement('canvas');
  c.width = rect.w; c.height = rect.h;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return c;
}

// ---------------------- OCR & parsing ----------------------
function norm(s) {
  return s
    .replace(/[|]/g, '1')
    .replace(/O/g, '0')
    .replace(/°/g, '')               // remove degree symbol
    .replace(/\u00A0/g, ' ')         // NBSP -> space
    .replace(/—/g, '-')              // em-dash to hyphen
    .replace(/,\s*(\d)/g, '.$1');    // comma decimal -> dot
}

const LAT_PATTS = [
  /(?:\bLat(?:itude)?\b)[:\s]*([+-]?\d{1,2}[.,]?\d{3,8})/i,
  /\b([12]\d\.\d{4,8})\b(?=[^\d]{0,6}\b(?:Long|Lon|Lng)\b)/i
];
const LNG_PATTS = [
  /(?:\bLon(?:g|gitude)?\b)[:\s]*([+-]?\d{1,3}[.,]?\d{3,8})/i,
  /\b(7[02]\.\d{4,8})\b/
];

function pickLatLng(text) {
  const t = norm(text);
  const tryP = (ps) => {
    for (const p of ps) {
      const m = t.match(p);
      if (m) return parseFloat(m[1].replace(',', '.'));
    }
    return null;
  };
  let lat = tryP(LAT_PATTS);
  let lng = tryP(LNG_PATTS);

  const inLat = v => v != null && v >= CFG.cityWindow.latMin && v <= CFG.cityWindow.latMax;
  const inLng = v => v != null && v >= CFG.cityWindow.lngMin && v <= CFG.cityWindow.lngMax;

  // If labels were missed, try to classify raw numbers by range
  if (!inLat(lat) || !inLng(lng)) {
    const nums = Array.from(t.matchAll(/\b-?\d{1,3}[.,]\d{3,8}\b/g))
      .map(m => parseFloat(m[0].replace(',', '.')));
    if (!inLat(lat))  lat = nums.find(inLat) ?? lat;
    if (!inLng(lng))  lng = nums.find(inLng) ?? lng;
  }
  return { lat: inLat(lat) ? lat : null, lng: inLng(lng) ? lng : null };
}

function pickDateTime(text) {
  const t = norm(text);
  // date like 26-07-2025 or 26/07/2025
  let d = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  let dateStr = d ? `${d[3]}-${String(d[2]).padStart(2,'0')}-${String(d[1]).padStart(2,'0')}` : '—';

  // time like 02:30 PM (drop GMT)
  let tm = t.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  let timeStr = '—';
  if (tm) {
    let hh = parseInt(tm[1],10), mm = tm[2];
    const ap = (tm[3]||'').toUpperCase();
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
    timeStr = `${String(hh).padStart(2,'0')}:${mm}`;
  }
  return { dateStr, timeStr };
}

function pickAddress(text) {
  // Grab lines between the map tile/labels and the lat/long/time cluster.
  const clean = norm(text)
    .replace(/[^\w\s,+\-./()#]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // split into lines; keep the densest line(s) that contain a city/state/India cue
  const lines = clean.split(/\n/).map(s => s.trim()).filter(Boolean);
  const cue = /(mumbai|maharashtra|india|road|rd|nagar|colony|society|west|east|andheri|goregaon)/i;
  let picked = lines.filter(l => cue.test(l));
  if (!picked.length) picked = lines; // fallback
  // collapse to one readable sentence
  let addr = picked.join(', ');
  // Trim trailing time/GMT shards if they slipped in
  addr = addr.replace(/\bGMT.*$/i, '').replace(/\b(?:AM|PM)\b.*$/i, '').trim();
  return addr || '—';
}

async function ocrCanvas(canvas, lang = 'eng') {
  // Tesseract v5: window.Tesseract must be present (already on your page)
  const res = await Tesseract.recognize(canvas, lang, { logger: () => {} });
  return (res && res.data && res.data.text) ? res.data.text : '';
}

// ---------------------- GeoJSON index & lookup ----------------------
const geoIndex = {
  wards: null, beats: null, police: null,
  grid: { wards: new Map(), beats: new Map(), police: new Map() },
  bbox: { wards: null, beats: null, police: null },
  loaded: false
};

async function loadGeo() {
  if (geoIndex.loaded) return;
  const [wards, beats, police] = await Promise.all([
    fetch(CFG.paths.wards).then(r=>r.json()),
    fetch(CFG.paths.beats).then(r=>r.json()),
    fetch(CFG.paths.police).then(r=>r.json()),
  ]);
  geoIndex.wards = wards;
  geoIndex.beats  = beats;
  geoIndex.police = police;
  buildGrid('wards', wards);
  buildGrid('beats', beats);
  buildGrid('police', police);
  geoIndex.loaded = true;
}

function buildGrid(kind, gj, cells = 50) {
  // compute bbox of collection
  let minX= Infinity, minY= Infinity, maxX= -Infinity, maxY= -Infinity;
  gj.features.forEach(f => {
    const b = bboxOfFeature(f);
    minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1]);
    maxX = Math.max(maxX, b[2]); maxY = Math.max(maxY, b[3]);
  });
  geoIndex.bbox[kind] = [minX, minY, maxX, maxY];
  const grid = geoIndex.grid[kind];
  const dx = (maxX-minX)/cells, dy=(maxY-minY)/cells;
  function cellFor(x,y) {
    const cx = Math.max(0, Math.min(cells-1, Math.floor((x-minX)/dx)));
    const cy = Math.max(0, Math.min(cells-1, Math.floor((y-minY)/dy)));
    return `${cx}:${cy}`;
  }
  gj.features.forEach((f, idx) => {
    const b = bboxOfFeature(f);
    const x0 = Math.floor((b[0]-minX)/dx), x1 = Math.floor((b[2]-minX)/dx);
    const y0 = Math.floor((b[1]-minY)/dy), y1 = Math.floor((b[3]-minY)/dy);
    for (let x = Math.max(0,x0); x <= Math.min(cells-1,x1); x++) {
      for (let y = Math.max(0,y0); y <= Math.min(cells-1,y1); y++) {
        const key = `${x}:${y}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(idx);
      }
    }
  });
  // store source
  geoIndex[kind] = gj;
}
function bboxOfFeature(f) {
  let minX= Infinity, minY= Infinity, maxX= -Infinity, maxY= -Infinity;
  const each = (coords) => coords.forEach((xy) => {
    const [x,y] = xy; minX=Math.min(minX,x); minY=Math.min(minY,y);
    maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
  });
  const geom = f.geometry;
  if (geom.type === 'Polygon') geom.coordinates.forEach(ring => each(ring));
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly => poly.forEach(ring => each(ring)));
  return [minX,minY,maxX,maxY];
}
function pointInPoly(point, geom) {
  const [x,y] = point;
  const pnpoly = (ring)=> {
    let inside = false;
    for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
      const xi=ring[i][0], yi=ring[i][1];
      const xj=ring[j][0], yj=ring[j][1];
      const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };
  if (geom.type === 'Polygon') {
    if (!pnpoly(geom.coordinates[0])) return false;
    // holes ignored for our use-case
    return true;
  } else if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some(poly => pnpoly(poly[0]));
  }
  return false;
}
function hitsFor(kind, lon, lat) {
  const gj = geoIndex[kind];
  if (!gj) return null;
  const [minX,minY,maxX,maxY] = geoIndex.bbox[kind];
  if (lon<minX || lon>maxX || lat<minY || lat>maxY) return null;
  const cells = 50;
  const dx = (maxX-minX)/cells, dy=(maxY-minY)/cells;
  const cx = Math.max(0, Math.min(cells-1, Math.floor((lon-minX)/dx)));
  const cy = Math.max(0, Math.min(cells-1, Math.floor((lat-minY)/dy)));
  const bucket = geoIndex.grid[kind].get(`${cx}:${cy}`) || [];
  for (const idx of bucket) {
    const f = gj.features[idx];
    const bb = bboxOfFeature(f);
    if (!(lon>=bb[0] && lon<=bb[2] && lat>=bb[1] && lat<=bb[3])) continue;
    if (pointInPoly([lon,lat], f.geometry)) return f;
  }
  return null;
}
function propsOf(f) { return f ? (f.properties || f.attrs || {}) : {}; }

// ---------------------- Pipeline ----------------------
async function processFile(file) {
  const t0 = performance.now();
  const bmp = await fileToImageBitmap(file);
  const originalUrl = dataURLFromCanvas(canvasFromBitmap(bmp));
  setImg(CFG.dom.origImg, originalUrl);

  // crop detection
  const rect = computeRibbonRect(bmp);
  const cropCanvasEl = cropCanvas(bmp, rect);
  setImg(CFG.dom.cropImg, dataURLFromCanvas(cropCanvasEl));

  const t1 = performance.now();
  // OCR: try eng; if we see many Devanagari chars, try 'mar' and append
  let txtEng = await ocrCanvas(cropCanvasEl, 'eng');
  let text = txtEng;
  if (/[क़-ॿ]/.test(txtEng)) {
    try {
      const txtMar = await ocrCanvas(cropCanvasEl, 'mar');
      // merge: whichever is longer wins for address; keep numbers from eng
      text = (txtMar.length > txtEng.length) ? `${txtEng}\n${txtMar}` : `${txtMar}\n${txtEng}`;
    } catch { /* mar may not be available; ignore */ }
  }
  const t2 = performance.now();

  // Parse
  const { dateStr, timeStr } = pickDateTime(text);
  const { lat, lng } = pickLatLng(text);
  const addr = pickAddress(text);

  setText(CFG.dom.date, dateStr);
  setText(CFG.dom.time, timeStr);
  setText(CFG.dom.lat,  lat != null ? lat.toFixed(6) : '—');
  setText(CFG.dom.lng,  lng != null ? lng.toFixed(6) : '—');
  setText(CFG.dom.addr, addr || '—');

  // GeoJSON stage
  let ward = '—', beat = '—', ps = '—';
  if (lat != null && lng != null) {
    await loadGeo();
    const fW = hitsFor('wards',  lng, lat);
    const fB = hitsFor('beats',  lng, lat);
    const fP = hitsFor('police', lng, lat);
    const pW = propsOf(fW), pB = propsOf(fB), pP = propsOf(fP);
    ward = pW.WARD || pW.ward || pW.name || '—';
    beat = pB.BEAT_NO || pB.beat || pB.name || '—';
    ps   = pP.PS_NAME || pP.name  || pP.station || '—';
  }
  setText(CFG.dom.ward, ward);
  setText(CFG.dom.beat, beat);
  setText(CFG.dom.ps,   ps);

  // perf line
  const t3 = performance.now();
  const up = 0, ocr = (t2 - t1)/1000, parse = 0, geo = (t3 - t2)/1000;
  const perf = `Upload — ${up.toFixed(1)}s • OCR — ${ocr.toFixed(1)}s • Parse — ${parse.toFixed(1)}s • GeoJSON — ${geo.toFixed(1)}s`;
  setText(CFG.dom.perf, perf);
}

// ---------------------- Wiring (keeps your UI) ----------------------
function wireInput() {
  const input = document.querySelector(CFG.dom.input);
  if (input) {
    input.addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) processFile(f);
    });
  }
  const drop = document.querySelector(CFG.dom.drop);
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); });
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) processFile(f);
    });
  }
  // Also handle clicks on the drop zone by forwarding to the file input
  if (drop && input) drop.addEventListener('click', () => input.click());
}

// Init on DOM ready
document.addEventListener('DOMContentLoaded', wireInput);
