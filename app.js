/* app.js — MCGM Marshal Upload
   - robust overlay crop (keeps whole "Lat ... Long ..." line)
   - tolerant OCR parsing for date/time/lat/lng/address
   - GeoJSON lookup for Ward / Beat / Police Station
   - no UI changes required
*/

// ---------- Config ----------
const GJ_URLS = window.GJ_URLS || {
  wards:  'data/wards.geojson',
  beats:  'data/beats.geojson',
  police: 'data/police_jurisdiction.geojson'
};

// If your HTML uses different IDs, map them here.
// We'll try these id variants in order for each key.
const ID_MAP = {
  date:      ['res-date','out-date','date','dateVal'],
  time:      ['res-time','out-time','time','timeVal'],
  latitude:  ['res-lat','out-lat','latitude','latVal'],
  longitude: ['res-lng','out-lng','longitude','lngVal'],
  address:   ['res-address','out-address','address','addrVal'],
  ward:      ['res-ward','out-ward','ward'],
  beat:      ['res-beat','out-beat','beat'],
  ps:        ['res-ps','out-ps','police','policeStation','psVal'],

  // previews (optional)
  thumbOrig: ['thumb-orig','origThumb','origImgThumb'],
  thumbCrop: ['thumb-crop','cropThumb','cropImgThumb'],

  // file input & drop zone (use whatever you already have)
  fileInput: ['file','fileInput','photo'],
  dropZone:  ['drop','dropZone','uploadBox']
};

// Cropping constants for GPS Map Camera ribbon (bottom)
const CROP = {
  // We crop a band at the bottom; adjust with these percentages.
  // The left margin is deliberately widened so the "Lat ..." text is included.
  LEFT_PCT:   0.33,  // was ~0.45 earlier; moved left to keep "Lat" fully
  TOP_PCT:    0.74,
  WIDTH_PCT:  0.65,
  HEIGHT_PCT: 0.22,

  // If your images vary a lot, you can clamp to min width/height in px.
  MIN_H: 160
};

// Mumbai sanity window (used to validate/repair coords)
const MUMBAI = {
  latMin: 18.0, latMax: 20.8,
  lngMin: 72.0, lngMax: 73.3
};

// ---------- Helpers ----------
function qsByList(list) {
  for (const id of list) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}
function setOut(key, value) {
  const ids = ID_MAP[key] || [];
  const el = qsByList(ids);
  if (el) el.textContent = value ?? '—';
}
function setThumb(key, blobUrl) {
  const holder = qsByList(ID_MAP[key] || []);
  if (!holder) return;
  // support <img> or a div where we inject an <img>
  let img = holder.tagName === 'IMG' ? holder : holder.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    img.alt = key;
    img.style.maxWidth = '100%';
    img.style.borderRadius = '6px';
    if (holder.tagName !== 'IMG') holder.innerHTML = '', holder.appendChild(img);
  }
  img.src = blobUrl;
}
function asBlobURL(canvas) {
  return new Promise(res => canvas.toBlob(b => res(URL.createObjectURL(b)), 'image/png'));
}
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({img, url});
    img.onerror = reject;
    img.src = url;
  });
}
function normText(s) {
  return s
    .replace(/[|]/g, '1')
    .replace(/O/g, '0')
    .replace(/\u00A0/g, ' ')  // NBSP
    .replace(/°/g, '')
    .replace(/,\s*(\d)/g, '.$1')
    .trim();
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// ---------- Crop logic ----------
function getOverlayCropRect(w, h) {
  // Basic percentage-based band crop (good enough for GPS Map Camera)
  const x = Math.floor(w * CROP.LEFT_PCT);
  const y = Math.floor(h * CROP.TOP_PCT);
  const cw = Math.floor(w * CROP.WIDTH_PCT);
  const ch = Math.max(Math.floor(h * CROP.HEIGHT_PCT), CROP.MIN_H);
  return { x: clamp(x, 0, w-1), y: clamp(y, 0, h-1), w: clamp(cw, 1, w), h: clamp(ch, 1, h-y) };
}
function cropToCanvas(img, rect) {
  const c = document.createElement('canvas');
  c.width = rect.w;
  c.height = rect.h;
  const g = c.getContext('2d');
  g.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return c;
}

// ---------- OCR (Tesseract.js must be loaded via CDN in HTML) ----------
async function ocrImage(canvas, lang='eng') {
  if (!window.Tesseract) throw new Error('Tesseract.js not loaded');
  const { createWorker } = Tesseract;
  const worker = await createWorker(lang, 1, {
    logger: m => { /* optional: hook to your progress UI */ }
  });
  const { data } = await worker.recognize(canvas);
  await worker.terminate();
  return data.text || '';
}

// ---------- Parsing ----------
function parseDate(text) {
  const t = normText(text);
  // dd/mm/yyyy or dd-mm-yyyy
  const m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (!m) return null;
  let [ , dd, mm, yy ] = m;
  if (yy.length === 2) yy = (parseInt(yy,10) > 50 ? '19' : '20') + yy;
  const d = String(parseInt(dd,10)).padStart(2,'0');
  const m2= String(parseInt(mm,10)).padStart(2,'0');
  return `${yy}-${m2}-${d}`;
}
function parseTime(text) {
  const t = normText(text);
  const m = t.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  if (!m) return null;
  let hh = parseInt(m[1],10), mm = m[2], ap = (m[3]||'').toUpperCase();
  if (ap === 'PM' && hh < 12) hh += 12;
  if (ap === 'AM' && hh === 12) hh = 0;
  return `${String(hh).padStart(2,'0')}:${mm}`;
}
function pickLatLng(text) {
  const t = normText(text);

  const LAT_PATTS = [
    /(?:\bLat(?:itude)?\b)[:\s]*([+-]?\d{1,2}[.,]?\d{3,8})\b/i,
    /\b([12]\d\.\d{4,8})\b(?=[^\d]{0,6}\b(?:Lon|Lng|Long)\b)/i
  ];
  const LNG_PATTS = [
    /(?:\bLon(?:g|gitude)?\b)[:\s]*([+-]?\d{1,3}[.,]?\d{3,8})\b/i,
    /\b(7[02]\.\d{4,8})\b/
  ];

  const tryP = (patts) => {
    for (const p of patts) { const m = t.match(p); if (m) return parseFloat(m[1]); }
    return null;
  };

  let lat = tryP(LAT_PATTS);
  let lng = tryP(LNG_PATTS);

  const inLat = v => typeof v === 'number' && v >= MUMBAI.latMin && v <= MUMBAI.latMax;
  const inLng = v => typeof v === 'number' && v >= MUMBAI.lngMin && v <= MUMBAI.lngMax;

  // If one is missing, try to infer from any decimal found
  if (!inLat(lat) || !inLng(lng)) {
    const nums = Array.from(t.matchAll(/\b-?\d{1,3}[.,]\d{3,8}\b/g))
      .map(m => parseFloat(m[0].replace(',', '.')));
    if (!inLat(lat))  lat = nums.find(inLat) ?? lat;
    if (!inLng(lng))  lng = nums.find(inLng) ?? lng;
  }

  // Auto-fix swapped coords if needed
  if (!inLat(lat) && inLat(lng) && inLng(lat)) {
    const tmp = lat; lat = lng; lng = tmp;
  }

  if (!inLat(lat)) lat = null;
  if (!inLng(lng)) lng = null;
  return { lat, lng };
}
function parseAddress(text) {
  const t = normText(text);
  // Grab lines that look like address but exclude telemetry lines
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const banned = /^(Lat|Lon|Long|Wind|Humidity|Pressure|Temperature|Google|GMT|GPS Map)/i;

  const candid = [];
  for (const line of lines) {
    if (banned.test(line)) continue;
    if (/\b(India|Mumbai|Maharashtra)\b/i.test(line) || /,/.test(line)) {
      candid.push(line);
    }
  }
  const raw = candid.join(', ');
  return raw
    .replace(/[^\w\s,+\-./()#]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------- GeoJSON lookup ----------
let GJ_CACHE = { wards:null, beats:null, police:null };

async function ensureGeoJSON() {
  const keys = Object.keys(GJ_URLS);
  for (const k of keys) {
    if (!GJ_CACHE[k]) {
      const r = await fetch(GJ_URLS[k]);
      if (!r.ok) throw new Error(`Failed to load ${k}`);
      GJ_CACHE[k] = await r.json();
    }
  }
}

function pointInPoly(pt, poly) {
  // Ray casting; pt = [lng, lat]
  let x = pt[0], y = pt[1], inside = false;
  // polygon or multipolygon
  const rings = Array.isArray(poly[0][0]) ? poly : [poly];
  for (const ring of rings) {
    for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

function findPropAt(lat, lng, gj, propNameCandidates) {
  if (!gj) return null;
  const pt = [lng, lat];
  for (const f of gj.features || []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      if (pointInPoly(pt, g.coordinates[0])) {
        for (const p of propNameCandidates) if (f.properties?.[p]) return String(f.properties[p]);
        return null;
      }
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) {
        if (pointInPoly(pt, poly[0])) {
          for (const p of propNameCandidates) if (f.properties?.[p]) return String(f.properties[p]);
          return null;
        }
      }
    }
  }
  return null;
}

async function geoLookup(lat, lng) {
  await ensureGeoJSON();
  const ward = findPropAt(lat, lng, GJ_CACHE.wards,  ['WARD','Ward','ward','WARD_NAME','name']);
  const beat = findPropAt(lat, lng, GJ_CACHE.beats,   ['BEAT_NO','Beat_No','Beat','BEAT','name']);
  const ps   = findPropAt(lat, lng, GJ_CACHE.police,  ['PS_NAME','PS','Police_Stn','name']);
  return { ward, beat, ps };
}

// ---------- Orchestration ----------
async function processFile(file) {
  try {
    // 1) Load and show original thumbnail (browser side — actual size control is CSS)
    const { img, url } = await loadImageFromFile(file);
    // Show tiny preview (we generate a small canvas to avoid large image URLs)
    const oCan = document.createElement('canvas');
    const scale = Math.min(512 / img.width, 512 / img.height, 1);
    oCan.width = Math.floor(img.width * scale);
    oCan.height = Math.floor(img.height * scale);
    oCan.getContext('2d').drawImage(img, 0, 0, oCan.width, oCan.height);
    setThumb('thumbOrig', await asBlobURL(oCan));

    // 2) Crop overlay band (wider left margin to keep "Lat …" fully)
    const rect = getOverlayCropRect(img.width, img.height);
    const crop = cropToCanvas(img, rect);
    setThumb('thumbCrop', await asBlobURL(crop));

    // 3) OCR
    const rawText = await ocrImage(crop, 'eng');  // keep UI light; switch to 'eng+hin' if you really need
    const text = normText(rawText);

    // 4) Parse fields
    const date = parseDate(text);
    const time = parseTime(text);
    const { lat, lng } = pickLatLng(text);
    const addr = parseAddress(text);

    setOut('date', date || '—');
    setOut('time', time || '—');
    setOut('latitude', lat != null ? lat.toFixed(6) : '—');
    setOut('longitude', lng != null ? lng.toFixed(6) : '—');
    setOut('address', addr || '—');

    // 5) GeoJSON lookup (only when coords are valid)
    if (lat != null && lng != null) {
      const gj = await geoLookup(lat, lng);
      setOut('ward', gj.ward || '—');
      setOut('beat', gj.beat || '—');
      setOut('ps',   gj.ps   || '—');
    } else {
      setOut('ward', '—');
      setOut('beat', '—');
      setOut('ps',   '—');
    }
  } catch (err) {
    console.error(err);
    // Keep UI silent; you can wire an alert/toast here if you want
  }
}

// ---------- Wiring ----------
function findFirstExistingId(list) { return qsByList(list || [])?.id || null; }

(function boot() {
  const fi = qsByList(ID_MAP.fileInput) || document.querySelector('input[type=file]');
  const dz = qsByList(ID_MAP.dropZone) || document.body;

  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
    dz.addEventListener('drop', async e => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) processFile(f);
    });
    dz.addEventListener('click', () => fi && fi.click());
  }
  if (fi) {
    fi.addEventListener('change', () => {
      const f = fi.files?.[0];
      if (f) processFile(f);
    });
  }

  // Optional: expose for manual testing
  window.__mcgm = { processFile };
})();
