/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Production app.js (light + accurate, no UI changes)
   Flow: Upload → Crop HUD → OCR (v5) → Parse → GeoJSON → Redirect
   ========================================================== */

const $ = (id) => document.getElementById(id);

// -------- UI elements (must match index.html)
const fileInput   = $('fileInput');
const dropArea    = $('dropArea');
const imgOriginal = $('imgOriginal');
const imgCrop     = $('imgCrop');

const outDate = $('resDate');
const outTime = $('resTime');
const outLat  = $('resLat');
const outLon  = $('resLon');
const outAddr = $('resAddr');
const outWard = $('resWard');
const outBeat = $('resBeat');
const outPS   = $('resPS');

const pills = {
  upload: $('pill-upload'),
  ocr: $('pill-ocr'),
  parse: $('pill-parse'),
  geo: $('pill-geo'),
  review: $('pill-review'),
  redirect: $('pill-redirect')
};

$('btnReset')?.addEventListener('click', () => location.reload());

// -------- Small UX helpers
function setPill(name, state) {
  const p = pills[name]; if (!p) return;
  p.classList.remove('ok','run','err');
  if (state) p.classList.add(state);
}
function banner(msg, kind = 'info') {
  const b = $('banner'); if (!b) return;
  if (!msg) { b.hidden = true; return; }
  b.hidden = false; b.textContent = msg; b.className = `banner ${kind}`;
}
const stepStart = {};
function startStep(name){ stepStart[name] = performance.now(); }
function endStep(name){
  const pill = $('pill-'+name);
  if (!pill || !stepStart[name]) return;
  const em = pill.querySelector('em');
  if (!em) return;
  em.textContent = `(${((performance.now()-stepStart[name])/1000).toFixed(1)}s)`;
}
function resetOutputs() {
  ['upload','ocr','parse','geo','review','redirect'].forEach(k => { setPill(k,null); startStep(k); endStep(k); });
  [outDate,outTime,outLat,outLon,outAddr,outWard,outBeat,outPS].forEach(o => o && (o.textContent = '—'));
  if (imgOriginal) imgOriginal.src = '';
  if (imgCrop) imgCrop.src = '';
  banner('');
}
function fileToDataURL(file){
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
}
function loadImage(url){
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
}

// -------- CDN badge: GREEN if loaded, RED if not
function updateCdnBadge() {
  const b = $('cdnBadge'); if (!b) return;
  const ok = !!(window.Tesseract && Tesseract.recognize);
  b.textContent = ok ? 'CDN: v5 (Loaded)' : 'CDN: v5 (Not Loaded)';
  b.style.background = ok ? 'var(--ok)' : 'var(--err)';
  b.style.color = '#fff';
}
document.addEventListener('DOMContentLoaded', updateCdnBadge);
window.addEventListener('load', updateCdnBadge);

// -------- Google Form mapping (unchanged)
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

// -------- Drag & Drop / Select
dropArea?.addEventListener('click', () => fileInput?.click());
dropArea?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput?.click(); });
fileInput?.addEventListener('click', (e) => { e.target.value = ''; });
fileInput?.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) handleFile(f); });

['dragenter','dragover'].forEach(t => dropArea?.addEventListener(t, (e) => { e.preventDefault(); dropArea.classList.add('dragover'); }));
['dragleave','drop'].forEach(t => dropArea?.addEventListener(t, (e) => { e.preventDefault(); dropArea.classList.remove('dragover'); }));
dropArea?.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = [...(e.dataTransfer?.files || [])].find(x => /^image\//i.test(x.type));
  if (f) handleFile(f);
});

// -------- Core flow
async function handleFile(file) {
  if (!/^image\/(jpe?g|png)$/i.test(file.type)) { banner('Please choose a JPG or PNG.','error'); return; }

  resetOutputs();

  // Upload
  startStep('upload');
  setPill('upload','run');
  const dataURL = await fileToDataURL(file);
  imgOriginal && (imgOriginal.src = dataURL);
  setPill('upload','ok'); endStep('upload');

  // Crop HUD
  startStep('ocr');
  setPill('ocr','run');
  let cropURL = '';
  try { cropURL = await cropHud(dataURL); imgCrop && (imgCrop.src = cropURL); }
  catch (err){ setPill('ocr','err'); endStep('ocr'); banner('Crop failed. Please retry with a clearer photo.','error'); return; }

  // OCR (Tesseract v5)
  if (!(window.Tesseract && Tesseract.recognize)) { setPill('ocr','err'); endStep('ocr'); banner('OCR engine not loaded. Check CDN.','error'); return; }
  let rawText = '';
  try {
    const res = await Tesseract.recognize(cropURL, 'eng+hin+mar', { logger: () => {}, tessedit_pageseg_mode: 6 });
    rawText = (res?.data?.text || '').trim();
    setPill('ocr','ok'); endStep('ocr');
  } catch (e) {
    setPill('ocr','err'); endStep('ocr'); banner('OCR failed. Try clearer photo.','error'); return;
  }

  // Parse
  startStep('parse');
  setPill('parse','run');
  const parsed = parseHudText(rawText);
  if (!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon) || !parsed.address) {
    setPill('parse','err'); endStep('parse'); banner('Could not parse all fields from HUD.','error'); return;
  }
  setPill('parse','ok'); endStep('parse');

  outDate && (outDate.textContent = parsed.date);
  outTime && (outTime.textContent = parsed.time);
  outLat  && (outLat.textContent  = parsed.lat.toFixed(6));
  outLon  && (outLon.textContent  = parsed.lon.toFixed(6));
  outAddr && (outAddr.textContent = parsed.address);

  // GeoJSON
  startStep('geo');
  setPill('geo','run');
  await ensureGeo();
  const gj = geoLookup(parsed.lat, parsed.lon);
  if (!gj.ward || !gj.beat || !gj.ps) { setPill('geo','err'); endStep('geo'); banner('GeoJSON lookup failed.','error'); return; }
  outWard && (outWard.textContent = gj.ward);
  outBeat && (outBeat.textContent = gj.beat);
  outPS   && (outPS.textContent   = gj.ps);
  setPill('geo','ok'); endStep('geo');

  // Review
  setPill('review','ok'); startStep('review'); endStep('review');

  // Redirect
  startStep('redirect');
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
    setPill('redirect','run');
    window.open(url.toString(), '_blank', 'noopener');
    setPill('redirect','ok'); endStep('redirect');
  } catch {
    setPill('redirect','err'); endStep('redirect');
    banner('Auto-redirect failed. Please use the button below.','error');
    addManualRedirect(url.toString());
  }
}

// -------- Dynamic crop of bottom GPS HUD (no preprocessing)
async function cropHud(dataURL) {
  const img = await loadImage(dataURL);
  const W = img.naturalWidth, H = img.naturalHeight;

  // Downscale for quick analysis
  const hw = Math.max(200, Math.floor(W * 0.2));
  const hh = Math.max(200, Math.floor(H * 0.2));
  const helper = document.createElement('canvas');
  helper.width = hw; helper.height = hh;
  const hctx = helper.getContext('2d');
  hctx.drawImage(img, 0, 0, hw, hh);

  const data = hctx.getImageData(0, 0, hw, hh).data;
  const rows = hh, cols = hw;

  // Average luminance per row
  const L = new Array(rows).fill(0);
  for (let y = 0; y < rows; y++) {
    let s = 0;
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      s += 0.2126*r + 0.7152*g + 0.0722*b;
    }
    L[y] = s / cols;
  }

  // Locate darkest band near bottom (HUD)
  const searchFrom = Math.floor(rows * 0.60);
  let hudTopRow = rows - Math.floor(rows * 0.25); // fallback
  let minAvg = 255;
  for (let y = rows - 1; y >= searchFrom; y--) {
    if (L[y] < minAvg) { minAvg = L[y]; hudTopRow = y; }
  }

  // Map to full image; safety margin
  let sy = Math.max(0, Math.floor(hudTopRow / rows * H) - Math.floor(H * 0.02));
  sy = Math.min(Math.max(sy, Math.floor(H * 0.62)), Math.floor(H * 0.80)); // clamp
  let sh = Math.floor(H * 0.34);
  if (sy + sh > H) sh = H - sy;

  // Detect bottom-left mini map via luminance variance; trim left more if busy
  let sx = Math.floor(W * 0.24);
  const probeW = Math.floor(cols * 0.18), probeY0 = Math.floor(rows * 0.82);
  let s=0, s2=0, n=0;
  for (let y = probeY0; y < rows; y++) {
    for (let x = 0; x < probeW; x++) {
      const i = (y*cols + x)*4;
      const ll = 0.2126*data[i] + 0.7152*data[i+1] + 0.0722*data[i+2];
      s += ll; s2 += ll*ll; n++;
    }
  }
  const mean = s/Math.max(1,n);
  const variance = s2/Math.max(1,n) - mean*mean;
  if (variance > 1500) sx = Math.floor(W * 0.30);

  const rightPad = Math.floor(W * 0.02);
  let sw = W - sx - rightPad;
  if (sw < Math.floor(W * 0.40)) sw = Math.floor(W * 0.40);

  // Final crop
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/png');
}

// -------- Parsing based on agreed rules
function parseHudText(raw) {
  const lines = raw.split(/\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 3) return {};
  const last = lines[lines.length - 1];   // date/time
  const prev = lines[lines.length - 2];   // lat/long
  const address = lines.slice(1, lines.length - 2).join(', ');

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

// -------- GeoJSON
let gjW=null, gjB=null, gjP=null;
async function ensureGeo() {
  if (gjW && gjB && gjP) return;
  const [w,b,p] = await Promise.all([
    fetch('data/wards.geojson').then(r=>r.json()),
    fetch('data/beats.geojson').then(r=>r.json()),
    fetch('data/police_jurisdiction.geojson').then(r=>r.json())
  ]);
  gjW=w; gjB=b; gjP=p;
}
function geoLookup(lat, lon) {
  const out = { ward:'', beat:'', ps:'' };
  if (!gjW || !gjB || !gjP) return out;
  const pt = [lon, lat];
  const inGeom = (g) =>
    g.type === 'Polygon'      ? pointInPoly(g.coordinates, pt) :
    g.type === 'MultiPolygon' ? g.coordinates.some(r => pointInPoly(r, pt)) : false;

  for (const f of gjW.features) if (inGeom(f.geometry)) { out.ward = f.properties.WARD || ''; break; }
  for (const f of gjB.features) if (inGeom(f.geometry)) { out.beat = f.properties.BEAT_NO || ''; break; }
  for (const f of gjP.features) if (inGeom(f.geometry)) { out.ps   = f.properties.PS_NAME || ''; break; }
  return out;
}
function pointInPoly(poly, [x,y]) {
  let inside = false;
  for (const ring of poly) {
    for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
      const xi=ring[i][0], yi=ring[i][1];
      const xj=ring[j][0], yj=ring[j][1];
      const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

// -------- Fallback redirect
function addManualRedirect(url) {
  let wrap = document.getElementById('manualRedirectWrap');
  if (!wrap) wrap = document.body;
  let btn = document.getElementById('manualRedirect');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'manualRedirect';
    btn.className = 'btn';
    btn.textContent = 'Open Google Form';
    btn.onclick = () => window.open(url, '_blank', 'noopener');
    wrap.appendChild(btn);
  }
}
