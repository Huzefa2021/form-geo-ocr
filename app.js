/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.10.07.GEO-FIX

   - Adaptive HUD crop (portrait/landscape, cushioned)
   - OCR.Space (multipart) with ≤1MB auto-compression
   - Fallback to Tesseract when OCR.Space fails/blocked/empty
   - Robust parsing (lat/lon w/ missing dot, flexible time)
   - Prefill normalization (YYYY-MM-DD, HH:mm 24h)
   - NEW: GeoJSON loader (wards / beats / police) + PIP lookup
   - UI/UX unchanged: same element IDs, pills, console
   ========================================================== */

/* ------------------------ Tweakables ------------------------ */
const CROP = {
  portrait:  { top: 0.62, height: 0.36, left: 0.04, width: 0.92 },
  landscape: { top: 0.70, height: 0.28, left: 0.04, width: 0.92 }
};

// Embed key here or define window.OCRSPACE_API_KEY in index.html before this script
const OCRSPACE_API_KEY = (window.OCRSPACE_API_KEY || 'K86010114388957');
const OCRSPACE_ENGINE  = 2;
const OCRSPACE_LANG    = 'eng';

// Google Form mapping
const FORM_BASE =
  'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url';
const ENTRY = {
  date: 'entry.1911996449',
  time: 'entry.1421115881',
  lat:  'entry.419288992',
  lon:  'entry.113122688',
  ward: 'entry.1625337207',
  beat: 'entry.1058310891',
  addr: 'entry.1188611077',
  ps:   'entry.1555105834'
};

/* ------------------------ DOM refs ------------------------ */
const $ = (id) => document.getElementById(id);

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
  redirect: $('pill-redirect'),
};

const geoBadge = $('geoBadge');
let lastRedirectUrl = '';

/* ------------------------ GeoJSON state ------------------------ */
const GEO = {
  loaded: false,
  wards: null,
  beats: null,
  police: null,
  errors: [],
};

/* ------------------------ Utilities ------------------------ */
function setPill(name, state) {
  const p = pills[name]; if (!p) return;
  p.className = p.className.replace(/\b(ok|run|err|pulse)\b/g, '').trim();
  if (state) p.classList.add(state);
}
function banner(msg, kind = 'info') {
  const b = $('banner'); if (!b) return;
  if (!msg) { b.hidden = true; return; }
  b.hidden = false; b.textContent = msg; b.className = `banner ${kind}`;
}
function resetOutputs() {
  ['upload','ocr','parse','geo','review','redirect'].forEach(k => setPill(k, null));
  [outDate,outTime,outLat,outLon,outAddr,outWard,outBeat,outPS].forEach(o => o && (o.textContent = '—'));
  if (imgOriginal) imgOriginal.src = '';
  if (imgCrop) imgCrop.src = '';
  banner('');
  logToConsole('', '', '[Reset]');
  lastRedirectUrl = '';
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}

/* ------------------------ Console logger ------------------------ */
function logToConsole(rawText, parsed, note = '') {
  const pre = $('console-pre'); if (!pre) return;
  const stamp = new Date().toLocaleTimeString();
  const safe = (v) => (v == null ? '' : String(v));
  const log = [
    `⏱ ${stamp} ${note}`,
    rawText !== '' ? '--- RAW OCR TEXT ---' : '',
    rawText !== '' ? safe(rawText) : '',
    parsed !== '' ? '--- PARSED FIELDS ---' : '',
    (parsed && typeof parsed === 'object') ? JSON.stringify(parsed, null, 2) : (parsed !== '' ? safe(parsed) : ''),
    '────────────────────────────────────────'
  ].filte
