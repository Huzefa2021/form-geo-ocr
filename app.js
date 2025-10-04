/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.10.04.R4

   - Primary OCR: OCR.Space (multipart upload from canvas)
   - Fallback OCR: Tesseract.js with light preprocessing
   - Robust parsing (lat/lon with/without dot, noisy spacing)
   - No UI/UX changes required – uses same element IDs
   ========================================================== */

/* ------------------------ Tweakables ------------------------ */
/** Bottom HUD crop % (portrait) and (landscape). Relax/tighten here. */
const CROP = {
  portrait: { top: 0.62, height: 0.36, left: 0.04, width: 0.92 },   // was .65/.32; left cushion widened
  landscape: { top: 0.70, height: 0.28, left: 0.04, width: 0.92 }  // for wide frames where HUD is short
};

/** OCR.Space API key (set in-index via <script> before this file or inline below) */
const OCRSPACE_API_KEY = window.OCRSPACE_API_KEY || '';   // put your key in index, or here
const OCRSPACE_ENGINE  = 2;                               // 2 = fast/good; 3 = "best" but slower
const OCRSPACE_LANG    = 'eng';                           // use 'eng' primarily (Hindi lines often noisy)

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

let lastRedirectUrl = '';

/* ------------------------ Utilities ------------------------ */
function setPill(name, state) {
  const p = pills[name]; if (!p) return;
  p.className = p.className.replace(/\b(ok|run|err|pulse)\b/g, '').trim();
  if (state) p.classList.add(state);
}

function banner(msg, kind = 'info') {
  const b = $('banner'); if (!b) return;
  if (!msg) { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = msg;
  b.className = `banner ${kind}`;
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

/* --------------- Console logger (unchanged UX) --------------- */
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
  ].filter(Boolean).join('\n');

  pre.textContent = `${pre.textContent ? pre.textContent + '\n' : ''}${log}\n`;
}

/* --------------- Drag & drop / input wiring --------------- */
dropArea?.addEventListener('click', () => fileInput?.click());
dropArea?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fileInput?.click(); });
fileInput?.addEventListener('click', (e) => { e.target.value = ''; });
fileInput?.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) handleFile(f); });

['dragenter','dragover'].forEach(t => dropArea?.addEventListener(t, e => { e.preventDefault(); dropArea.classList.add('dragover'); }));
['dragleave','drop'].forEach(t => dropArea?.addEventListener(t, e => { e.preventDefault(); dropArea.classList.remove('dragover'); }));
dropArea?.addEventListener('drop', (e) => {
  const f = [...(e.dataTransfer?.files || [])].find(f => /^image\//i.test(f.type));
  if (f) handleFile(f);
});

$('btnReset')?.addEventListener('click', resetOutputs);

/* ------------------------ Core Flow ------------------------ */
async function handleFile(file) {
  if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
    banner('Please choose a JPG or PNG.', 'error');
    return;
  }

  resetOutputs();

  setPill('upload', 'run');
  const dataURL = await fileToDataURL(file);
  imgOriginal.src = dataURL;
  setPill('upload', 'ok');

  // crop HUD (static with cushions, portrait vs landscape)
  const cropCanvas = await cropHudToCanvas(dataURL);
  const cropUrl = cropCanvas.toDataURL('image/png');
  imgCrop.src = cropUrl;

  // OCR stage
  setPill('ocr', 'run');

  let rawText = '';
  let usedEngine = 'OCR.Space';

  try {
    // 1) Try OCR.Space once
    const os = await ocrSpaceRecognizeFromCanvas(cropCanvas, {
      apiKey: OCRSPACE_API_KEY,
      lang: OCRSPACE_LANG,
      engine: OCRSPACE_ENGINE,
    });
    rawText = os.rawText || '';
    logToConsole(rawText, { parsed: '(pending parse)' }, '[OCR.Space result]');
  } catch (err) {
    logToConsole('', { error: String(err) }, '[OCR.Space error]');
  }

  // 2) If OCR.Space empty or clearly incomplete → Tesseract fallback
  if (!rawText || rawText.trim().length < 10) {
    try {
      usedEngine = 'Tesseract';
      const t = await tesseractRecognizeFromCanvas(cropCanvas);
      rawText = t.rawText || '';
      logToConsole(rawText, '', '[OCR complete via Tesseract]');
    } catch (err) {
      setPill('ocr', 'err');
      banner('OCR failed. Try clearer photo.', 'error');
      logToConsole('', { error: String(err) }, '[OCR error]');
      return;
    }
  }

  setPill('ocr', 'ok');

  // Parse
  setPill('parse', 'run');
  const parsed = parseHudText(rawText);

  logToConsole('', { engineUsed: usedEngine, parsed }, '[Parse complete]');

  if (!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon)) {
    setPill('parse', 'err');
    banner('Could not parse all fields from HUD.', 'error');
    return;
  }
  setPill('parse', 'ok');

  // Fill on UI
  outDate.textContent = parsed.date;            // already normalized YYYY-MM-DD
  outTime.textContent = parsed.time;            // already normalized 24h HH:mm
  outLat.textContent  = parsed.lat.toFixed(6);
  outLon.textContent  = parsed.lon.toFixed(6);
  outAddr.textContent = parsed.address;

  // (Geo step left to your existing code – we don't touch it here)

  // You can keep your redirect logic – here is a safe builder:
  const url = buildPrefillUrl({
    date: parsed.date,
    time: parsed.time,
    lat: parsed.lat,
    lon: parsed.lon,
    ward: outWard?.textContent && outWard.textContent !== '—' ? outWard.textContent : '',
    beat: outBeat?.textContent && outBeat.textContent !== '—' ? outBeat.textContent : '',
    addr: parsed.address,
    ps:   outPS?.textContent   && outPS.textContent   !== '—' ? outPS.textContent   : ''
  });

  lastRedirectUrl = url;
  logToConsole('', { redirect: url }, '[Redirect URL]');

  // Auto attempt open; if blocked, your pill/button is still available
  try {
    setPill('redirect', 'run');
    window.open(url, '_blank', 'noopener');
    setPill('redirect', 'ok');
  } catch {
    setPill('redirect', 'err');
    banner('Auto-redirect failed. Please use the Redirect pill.', 'error');
  }
}

/* ------------------------ Crop (static + cushions) ------------------------ */
async function cropHudToCanvas(dataURL) {
  const img = await loadImage(dataURL);
  const W = img.naturalWidth  || img.width;
  const H = img.naturalHeight || img.height;

  const isLandscape = W >= H;
  const cfg = isLandscape ? CROP.landscape : CROP.portrait;

  const sx = Math.max(0, Math.floor(W * cfg.left));
  const sy = Math.max(0, Math.floor(H * cfg.top));
  const sw = Math.floor(W * cfg.width);
  const sh = Math.floor(H * cfg.height);

  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');

  // light pre-filter to help both OCR.Space & Tesseract
  ctx.filter = 'grayscale(1) contrast(170%) brightness(110%)'; // gentle; avoids speckle
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.filter = 'none';

  return c;
}

/* ------------------------ OCR.Space (multipart) ------------------------ */
async function ocrSpaceRecognizeFromCanvas(cropCanvas, { apiKey, lang = 'eng', engine = 2 } = {}) {
  if (!apiKey) throw new Error('OCR.Space API key missing');

  const blob = await new Promise(res => cropCanvas.toBlob(res, 'image/png', 1.0));
  const file = new File([blob], 'hud.png', { type: 'image/png' });

  const fd = new FormData();
  fd.append('apikey', apiKey);
  fd.append('file', file);
  fd.append('language', lang);
  fd.append('OCREngine', String(engine));
  fd.append('isOverlayRequired', 'false');
  fd.append('detectOrientation', 'true');
  fd.append('scale', 'true');
  fd.append('isTable', 'false');

  // POST
  const resp = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: fd });
  const json = await resp.json();

  const parsedRes = json?.ParsedResults?.[0] || null;
  const exitCode  = json?.OCRExitCode ?? parsedRes?.FileParseExitCode ?? 0;

  logToConsole('', {
    engine,
    language: lang,
    exitCode,
    errored: exitCode !== 1,
    messages: json?.ErrorMessage || json?.ErrorDetails || ''
  }, '[OCR.Space meta (processed)]');

  if (!parsedRes || exitCode !== 1) {
    const msg = Array.isArray(json?.ErrorMessage) ? json.ErrorMessage.join('; ') : (json?.ErrorMessage || json?.ErrorDetails || 'Unknown OCR error');
    throw new Error(msg);
  }

  const rawText = parsedRes.ParsedText || '';
  return { rawText };
}

/* ------------------------ Tesseract fallback ------------------------ */
async function tesseractRecognizeFromCanvas(c) {
  if (!(window.Tesseract && Tesseract.recognize)) {
    throw new Error('Tesseract not available');
  }

  // Duplicate canvas for a bit more contrast/threshold without harming the preview
  const w = c.width, h = c.height;
  const t = document.createElement('canvas');
  t.width = w; t.height = h;
  const g = t.getContext('2d');

  g.filter = 'grayscale(1) contrast(200%) brightness(115%)';
  g.drawImage(c, 0, 0, w, h);
  g.filter = 'none';

  const dataURL = t.toDataURL('image/png');

  const res = await Tesseract.recognize(
    dataURL,
    'eng',
    { tessedit_pageseg_mode: 6 }
  );

  const rawText = (res?.data?.text || '').trim();
  return { rawText };
}

/* ------------------------ Parsing helpers ------------------------ */
/** Normalize: dd/mm/yyyy → yyyy-mm-dd */
function toIsoDate(dmy) {
  const m = dmy.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (!m) return '';
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

/** Normalize time to HH:mm (supports 12h with AM/PM & 24h) */
function to24h(timeStr) {
  const s = timeStr.replace(/\s+/g, ' ').trim();
  // 12h
  let m = s.match(/(\d{1,2})\s*[:\.](\d{2})\s*([AP]M)/i);
  if (m) {
    let hh = parseInt(m[1], 10);
    const mm = m[2];
    const ap = m[3].toUpperCase();
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
    return `${String(hh).padStart(2,'0')}:${mm}`;
  }
  // 24h HH:mm
  m = s.match(/(\d{1,2})\s*[:\.](\d{2})/);
  if (m) return `${m[1].padStart(2,'0')}:${m[2]}`;
  return '';
}

/** Robust lat/lon extraction (handles missing dot, extra punctuation/spaces) */
function extractLatLon(fullText) {
  const text = fullText.replace(/\s+/g, ' ').replace(/[|]+/g,' ').trim();

  // Find the first occurrence of "Lat ... Long ..."
  const m = text.match(/Lat[^0-9\-+]*([\-+]?\d{1,3}[.,]?\d{0,8})\D+Long[^0-9\-+]*([\-+]?\d{1,3}[.,]?\d{0,8})/i);
  if (!m) return { lat: NaN, lon: NaN };

  const fixNum = (s, isLat) => {
    if (!s) return NaN;
    // replace comma with dot
    s = s.replace(',', '.');
    // Already has decimal
    if (s.includes('.')) return parseFloat(s);

    // If dot missing, insert after 2 digits for lat, after 2 or 3 for lon conservatively
    const neg = s[0] === '-';
    const body = neg ? s.slice(1) : s;
    const pos  = isLat ? 2 : (body.length > 5 ? 2 : 2);
    const fixed = (neg ? '-' : '') + body.slice(0, pos) + '.' + body.slice(pos);
    return parseFloat(fixed);
  };

  const lat = fixNum(m[1], true);
  const lon = fixNum(m[2], false);
  return { lat, lon };
}

/** Extracts last DMY + time anywhere near the bottom line */
function extractDateTime(lines) {
  // prefer scanning from bottom
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
    const line = lines[i];
    const d = line.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
    const t = line.match(/(\d{1,2}\s*[:\.]\s*\d{2}(?:\s*[AP]M)?)/i);
    if (d && t) return { date: toIsoDate(d[1]), time: to24h(t[1]) };
  }
  // fallback: search anywhere
  const joined = lines.join(' ');
  const d = joined.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
  const t = joined.match(/(\d{1,2}\s*[:\.]\s*\d{2}(?:\s*[AP]M)?)/i);
  return { date: d ? toIsoDate(d[1]) : '', time: t ? to24h(t[1]) : '' };
}

/** Cleans address: drops obvious branding, keeps lines between title and Lat/Long */
function extractAddress(lines) {
  const cleaned = lines
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !/^Google$/i.test(s))
    .filter(s => !/GPS\s*Map\s*Camera/i.test(s));

  const latLineIdx = cleaned.findIndex(s => /Lat/i.test(s) && /Long/i.test(s));
  const upto = latLineIdx >= 0 ? cleaned.slice(0, latLineIdx) : cleaned;

  // drop first line if it’s just the “Mumbai, Maharashtra, India” title (often repeated)
  const body = (upto[0] && /^[A-Za-z].*India/.test(upto[0]) && (upto[1] || '').length > 5)
    ? upto.slice(1)
    : upto;

  // join with comma then normalize stray commas
  return body.join(', ').replace(/\s*,\s*,+/g, ', ').replace(/\s{2,}/g, ' ').trim();
}

/** Main parser */
function parseHudText(raw) {
  const lines = raw.split(/\n/).map(s => s.trim()).filter(Boolean);

  const { lat, lon } = extractLatLon(raw);
  const { date, time } = extractDateTime(lines);
  const address = extractAddress(lines);

  return { address, lat, lon, date, time };
}

/* ------------------------ Prefill URL ------------------------ */
function buildPrefillUrl({ date, time, lat, lon, ward, beat, addr, ps }) {
  const base = 'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url';
  const params = new URLSearchParams();
  params.set('entry.1911996449', date);             // Date (YYYY-MM-DD)
  params.set('entry.1421115881', time);             // Time (HH:mm)
  params.set('entry.419288992', Number(lat).toFixed(6));
  params.set('entry.113122688', Number(lon).toFixed(6));
  if (ward) params.set('entry.1625337207', ward);
  if (beat) params.set('entry.1058310891', beat);
  params.set('entry.1188611077', addr || '');
  if (ps)   params.set('entry.1555105834', ps);
  return `${base}&${params.toString()}`;
}

/* ------------------------ CDN badge ------------------------ */
function updateCdnBadge() {
  const b = $('cdnBadge'); if (!b) return;
  const ok = !!(window.Tesseract && Tesseract.recognize);
  b.textContent = ok ? 'CDN: v5 (Loaded)' : 'CDN: v5 (Not Loaded)';
  b.className = `badge ${ok ? 'badge-ok glow' : 'badge-err glow'}`;
}
document.addEventListener('DOMContentLoaded', updateCdnBadge);
window.addEventListener('load', updateCdnBadge);

/* ------------------------ Expose redirect pill click (optional) ------------------------ */
$('pill-redirect')?.addEventListener('click', () => {
  if (!lastRedirectUrl) return;
  window.open(lastRedirectUrl, '_blank', 'noopener');
});
