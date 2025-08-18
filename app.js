/* ==========================================================
   Abandoned Vehicles – Marshal Upload (MCGM)
   Simplified Flow (2025-08-18)
   - Drag & drop + single picker
   - Dynamic crop of bottom HUD (no preprocessing)
   - OCR with Tesseract.js v5 (eng+hin+mar)
   - Parse rules: ignore line1; address lines 1–3; second-last = lat/long; last = date/time
   - GeoJSON lookup (wards, beats, police_jurisdiction)
   - Auto redirect; show manual button if blocked
   ========================================================== */

const el = (id) => document.getElementById(id);

// -------------------- UI Elements --------------------
const fileInput   = el('fileInput');
const dropArea    = el('dropArea');
const imgOriginal = el('imgOriginal');
const imgCrop     = el('imgCrop');

// Result display fields
const outDate  = el('resDate');
const outTime  = el('resTime');
const outLat   = el('resLat');
const outLon   = el('resLon');
const outAddr  = el('resAddr');
const outWard  = el('resWard');
const outBeat  = el('resBeat');
const outPS    = el('resPS');

// Pills (status indicators for each step)
const pills = {
  upload: el('pill-upload'),
  ocr: el('pill-ocr'),
  parse: el('pill-parse'),
  geo: el('pill-geo'),
  review: el('pill-review'),
  redirect: el('pill-redirect'),
};

// Reset button
el('btnReset').addEventListener('click', () => location.reload());

// Utility: set pill state
function setPill(which, state) {
  const p = pills[which];
  if (!p) return;
  p.classList.remove('ok', 'run', 'err');
  if (state) p.classList.add(state);
}

// Utility: set banner message
function setBanner(msg, kind = 'info') {
  const b = el('banner');
  if (!msg) { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = msg;
  b.className = `banner ${kind}`;
}

// -------------------- Google Form Mapping --------------------
const FORM_BASE = 'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url';
const ENTRY = {
  date: 'entry.1911996449',
  time: 'entry.1421115881',
  lat : 'entry.419288992',
  lon : 'entry.113122688',
  ward: 'entry.1625337207',
  beat: 'entry.1058310891',
  addr: 'entry.1188611077',
  ps  : 'entry.1555105834'
};

// -------------------- Drag & Drop --------------------
dropArea.addEventListener('click', () => fileInput.click());
dropArea.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('click', (e) => { e.target.value = ''; });
fileInput.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) handleFile(f); });

['dragenter','dragover'].forEach(t => dropArea.addEventListener(t, e => { e.preventDefault(); dropArea.classList.add('dragover'); }));
['dragleave','drop'].forEach(t => dropArea.addEventListener(t, e => { e.preventDefault(); dropArea.classList.remove('dragover'); }));
dropArea.addEventListener('drop', (e) => {
  const f = [...(e.dataTransfer?.files || [])].find(f => /^image\//i.test(f.type));
  if (f) handleFile(f);
});

// -------------------- Core Flow --------------------
async function handleFile(file) {
  // Step 1: Validate file
  if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
    setBanner('Please choose a JPG or PNG.', 'error');
    return;
  }

  // Reset UI outputs
  resetOutputs();

  // Step 2: Upload image
  setPill('upload', 'run');
  const dataURL = await fileToDataURL(file);
  imgOriginal.src = dataURL;
  setPill('upload', 'ok');

  // Step 3: Crop HUD (bottom GPS overlay)
  setPill('ocr', 'run');
  const cropURL = await cropHud(dataURL);
  imgCrop.src = cropURL;

  // Step 4: OCR (Tesseract.js v5)
  let text = '';
  try {
    const res = await Tesseract.recognize(
      cropURL,
      'eng+hin+mar',
      {
        logger: _ => {},
        tessedit_pageseg_mode: 6 // single uniform block
      }
    );
    text = (res?.data?.text || '').trim();
    console.log('Raw OCR Text:', text);
    setPill('ocr', 'ok');
  } catch (e) {
    console.error('Tesseract error:', e);
    setPill('ocr', 'err');
    setBanner('OCR failed. Try clearer photo.', 'error');
    return;
  }

  // Step 5: Parse OCR output
  setPill('parse', 'run');
  const parsed = parseHudText(text);
  console.log('Parsed Fields:', parsed);
  if (!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon) || !parsed.address) {
    setPill('parse', 'err');
    setBanner('Could not parse all fields from HUD.', 'error');
    return;
  }
  setPill('parse', 'ok');

  // Display parsed values
  outDate.textContent = parsed.date;
  outTime.textContent = parsed.time;
  outLat.textContent  = parsed.lat.toFixed(6);
  outLon.textContent  = parsed.lon.toFixed(6);
  outAddr.textContent = parsed.address;

  // Step 6: GeoJSON lookup
  setPill('geo', 'run');
  await ensureGeo();
  const gj = geoLookup(parsed.lat, parsed.lon);
  outWard.textContent = gj.ward || '—';
  outBeat.textContent = gj.beat || '—';
  outPS.textContent   = gj.ps   || '—';
  if (!gj.ward || !gj.beat || !gj.ps) {
    setPill('geo', 'err');
    setBanner('GeoJSON lookup failed.', 'error');
    return;
  }
  setPill('geo', 'ok');

  // Step 7: Review complete
  setPill('review', 'ok');

  // Step 8: Redirect / Fallback button
  const url = new URL(FORM_BASE);
  url.searchParams.set(ENTRY.date, parsed.date);
  url.searchParams.set(ENTRY.time, parsed.time);
  url.searchParams.set(ENTRY.lat, parsed.lat.toFixed(6));
  url.searchParams.set(ENTRY.lon, parsed.lon.toFixed(6));
  url.searchParams.set(ENTRY.ward, gj.ward);
  url.searchParams.set(ENTRY.beat, gj.beat);
  url.searchParams.set(ENTRY.addr, parsed.address);
  url.searchParams.set(ENTRY.ps,   gj.ps);

  try {
    setPill('redirect', 'run');
    window.open(url.toString(), '_blank', 'noopener');
    setPill('redirect', 'ok');
  } catch {
    setPill('redirect', 'err');
    setBanner('Auto-redirect failed. Please use the button below.', 'error');
    addManualRedirect(url.toString());
  }
}

// Reset outputs between runs
function resetOutputs() {
  ['upload','ocr','parse','geo','review','redirect'].forEach(k => setPill(k, null));
  [outDate,outTime,outLat,outLon,outAddr,outWard,outBeat,outPS].forEach(o => o.textContent = '—');
  imgOriginal.src = '';
  imgCrop.src = '';
  setBanner('', 'info');
}

// Convert file to base64 data URL
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// -------------------- Dynamic Crop of Bottom HUD --------------------
// - Scans bottom ~40% to find darkest band (HUD background)
// - Adds safety margins; trims left to dodge the mini Google map
async function cropHud(dataURL) {
  const img = await loadImage(dataURL);
  const W = img.naturalWidth, H = img.naturalHeight;

  // Helper canvas for fast luminance scan
  const helper = document.createElement('canvas');
  helper.width = Math.max(200, Math.floor(W * 0.2));
  helper.height = Math.max(200, Math.floor(H * 0.2));
  const hctx = helper.getContext('2d');
  hctx.drawImage(img, 0, 0, helper.width, helper.height);

  const data = hctx.getImageData(0, 0, helper.width, helper.height).data;
  const rows = helper.height, cols = helper.width;
  const luminance = new Array(rows).fill(0);
  for (let y = 0; y < rows; y++) {
    let sum = 0;
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      sum += 0.2126*r + 0.7152*g + 0.0722*b; // Rec.709
    }
    luminance[y] = sum / cols;
  }

  // Search the bottom 40% for the darkest band top
  const startRow = Math.floor(rows * 0.60);
  let hudTopRow = rows - Math.floor(rows * 0.25); // fallback
  let minAvg = 255;
  for (let y = rows - 1; y >= startRow; y--) {
    if (luminance[y] < minAvg) { minAvg = luminance[y]; hudTopRow = y; }
  }

  // Map to original image coordinates with margin
  let sy = Math.max(0, Math.floor(hudTopRow / rows * H) - Math.floor(H * 0.02));
  sy = Math.min(Math.max(sy, Math.floor(H * 0.65)), Math.floor(H * 0.78)); // clamp

  // Height ~32% (clamped to bottom)
  let sh = Math.floor(H * 0.32);
  if (sy + sh > H) sh = H - sy;

  // Left trim detection (mini map)
  let sx = Math.floor(W * 0.24);
  const probeW = Math.floor(cols * 0.18), probeY0 = Math.floor(rows * 0.82);
  let s=0, s2=0, n=0;
  for (let y = probeY0; y < rows; y++) {
    for (let x = 0; x < probeW; x++) {
      const i = (y*cols + x)*4;
      const L = 0.2126*data[i] + 0.7152*data[i+1] + 0.0722*data[i+2];
      s += L; s2 += L*L; n++;
    }
  }
  const mean = s/Math.max(1,n);
  const variance = s2/Math.max(1,n) - mean*mean;
  if (variance > 1500) sx = Math.floor(W * 0.30);

  const rightPad = Math.floor(W * 0.02);
  const sw = W - sx - rightPad;

  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  console.log('Crop metrics:', { sx, sy, sw, sh, W, H, variance: Math.round(variance) });
  return c.toDataURL('image/png');
}

// Helper: load image
function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}

// -------------------- Parsing --------------------
// Parse OCR lines into address, lat/lon, date/time
function parseHudText(raw) {
  const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) return {};

  const last = lines[lines.length - 1]; // date/time
  const prev = lines[lines.length - 2]; // lat/lon
  const addrLines = lines.slice(1, lines.length - 2); // address 1–3 lines
  const address = addrLines.join(', ');

  const latM = prev.match(/Lat[^0-9]*([+-]?[0-9]+\.?[0-9]*)/i);
  const lonM = prev.match(/Long[^0-9]*([+-]?[0-9]+\.?[0-9]*)/i);
  const lat = latM ? parseFloat(latM[1]) : NaN;
  const lon = lonM ? parseFloat(lonM[1]) : NaN;

  let date = '', time = '';
  const dt = last.replace(/GMT.*$/,'').trim();
  const m = dt.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/)
        || dt.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/);
  if (m) { date = m[1]; time = m[2]; }

  return { address, lat, lon, date, time };
}

// -------------------- GeoJSON --------------------
let gjW = null, gjB = null, gjP = null;

async function ensureGeo() {
  if (gjW && gjB && gjP) return;
  const [w, b, p] = await Promise.all([
    fetch('data/wards.geojson').then(r => r.json()),
    fetch('data/beats.geojson').then(r => r.json()),
    fetch('data/police_jurisdiction.geojson').then(r => r.json()),
  ]);
  gjW = w; gjB = b; gjP = p;
}

function geoLookup(lat, lon) {
  const out = { ward: '', beat: '', ps: '' };
  if (!gjW || !gjB || !gjP) return out;

  const pt = [lon, lat];
  const inPoly = (g) => {
    if (g.type === 'Polygon') return pointInPoly(g.coordinates, pt);
    if (g.type === 'MultiPolygon') return g.coordinates.some(r => pointInPoly(r, pt));
    return false;
  };

  for (const f of gjW.features) { if (inPoly(f.geometry)) { out.ward = f.properties.WARD || ''; break; } }
  for (const f of gjB.features) { if (inPoly(f.geometry)) { out.beat = f.properties.BEAT_NO || ''; break; } }
  for (const f of gjP.features) { if (inPoly(f.geometry)) { out.ps   = f.properties.PS_NAME || ''; break; } }

  return out;
}

function pointInPoly(poly, pt) {
  const [x, y] = pt;
  let inside = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

// -------------------- Manual Redirect --------------------
function addManualRedirect(url) {
  let btn = el('manualRedirect');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'manualRedirect';
    btn.className = 'btn btn-primary';
    btn.textContent = 'Open Google Form';
    btn.onclick = () => window.open(url, '_blank', 'noopener');
    document.body.appendChild(btn);
  }
}
