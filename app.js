/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.10.04.R5  (OCR.Space → Tesseract fallback, multipart, robust parse)
   Notes:
   - UI/UX unchanged: uses existing IDs, pills, console, badges.
   - If OCR.Space fetch fails or returns empty, Tesseract runs automatically.
   ========================================================== */

/* ------------------------ Tweakables ------------------------ */
const CROP = {
  portrait:  { top: 0.62, height: 0.36, left: 0.04, width: 0.92 },
  landscape: { top: 0.70, height: 0.28, left: 0.04, width: 0.92 }
};

// Embed key here (or set window.OCRSPACE_API_KEY in index.html before this script)
const OCRSPACE_API_KEY = (window.OCRSPACE_API_KEY || 'K86010114388957');
const OCRSPACE_ENGINE  = 2;
const OCRSPACE_LANG    = 'eng';

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
  ].filter(Boolean).join('\n');
  pre.textContent = `${pre.textContent ? pre.textContent + '\n' : ''}${log}\n`;
}

/* ------------------------ Drag & drop wiring ------------------------ */
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

  // Crop HUD (portrait vs landscape, with cushion)
  setPill('ocr', 'run');
  const cropCanvas = await cropHudToCanvas(dataURL);
  imgCrop.src = cropCanvas.toDataURL('image/png');

  // ---- OCR.Space (multipart). If fetch fails, silently fall back to Tesseract. ----
  let rawText = '';
  let usedEngine = 'OCR.Space';

  try {
    if (OCRSPACE_API_KEY) {
      const os = await ocrSpaceRecognizeFromCanvas(cropCanvas, {
        apiKey: OCRSPACE_API_KEY,
        lang: OCRSPACE_LANG,
        engine: OCRSPACE_ENGINE
      });
      rawText = os.rawText || '';
      logToConsole(rawText, { parsed: '(pending parse)' }, '[OCR.Space result]');
    } else {
      logToConsole('', { info: 'No OCR.Space key; using Tesseract' }, '[OCR.Space skipped]');
    }
  } catch (err) {
    // Network/CORS/Server error — don’t block, just fall back
    logToConsole('', { error: String(err) }, '[OCR.Space error]');
  }

  // Fallback if OCR.Space didn’t produce usable text
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

  // UI fill
  outDate.textContent = parsed.date;            // normalized YYYY-MM-DD
  outTime.textContent = parsed.time;            // normalized 24h HH:mm
  outLat.textContent  = parsed.lat.toFixed(6);
  outLon.textContent  = parsed.lon.toFixed(6);
  outAddr.textContent = parsed.address;

  setPill('review', 'ok');

  // Prefill URL
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

  try {
    setPill('redirect', 'run');
    window.open(url, '_blank', 'noopener');
    setPill('redirect', 'ok');
  } catch {
    setPill('redirect', 'err');
    banner('Auto-redirect blocked. Use the Redirect pill.', 'error');
  }

  // Manual redirect via pill
  if (pills.redirect) {
    pills.redirect.style.cursor = 'pointer';
    pills.redirect.onclick = () => { if (lastRedirectUrl) window.open(lastRedirectUrl, '_blank', 'noopener'); };
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

  // Gentle filter helps both engines without overdoing preprocessing
  ctx.filter = 'grayscale(1) contrast(170%) brightness(110%)';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.filter = 'none';

  return c;
}

/* ------------------------ OCR.Space (multipart) ------------------------ */
async function ocrSpaceRecognizeFromCanvas(cropCanvas, { apiKey, lang = 'eng', engine = 2 } = {}) {
  if (!apiKey) return { rawText: '' }; // caller will fallback to Tesseract

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

  // POST — if the browser/network blocks it, caller will catch and fallback
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
  const w = c.width, h = c.height;
  const t = document.createElement('canvas');
  t.width = w; t.height = h;
  const g = t.getContext('2d');

  // Light, safe preprocessing
  g.filter = 'grayscale(1) contrast(200%) brightness(115%)';
  g.drawImage(c, 0, 0, w, h);
  g.filter = 'none';

  const dataURL = t.toDataURL('image/png');
  const res = await Tesseract.recognize(dataURL, 'eng', { tessedit_pageseg_mode: 6 });
  const rawText = (res?.data?.text || '').trim();
  return { rawText };
}

/* ------------------------ Parsing helpers ------------------------ */
function toIsoDate(dmy) {
  const m = dmy.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (!m) return '';
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}
function to24h(timeStr) {
  const s = timeStr.replace(/\s+/g, ' ').trim();
  let m = s.match(/(\d{1,2})\s*[:\.]\s*(\d{2})\s*([AP]M)/i);
  if (m) {
    let hh = parseInt(m[1], 10);
    const mm = m[2];
    const ap = m[3].toUpperCase();
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
    return `${String(hh).padStart(2,'0')}:${mm}`;
  }
  m = s.match(/(\d{1,2})\s*[:\.]\s*(\d{2})/);
  if (m) return `${m[1].padStart(2,'0')}:${m[2]}`;
  return '';
}

function extractLatLon(fullText) {
  const text = fullText.replace(/\s+/g, ' ').replace(/[|]+/g,' ').trim();
  const m = text.match(/Lat[^0-9\-+]*([\-+]?\d{1,3}[.,]?\d{0,8})\D+Long[^0-9\-+]*([\-+]?\d{1,3}[.,]?\d{0,8})/i);
  if (!m) return { lat: NaN, lon: NaN };

  const fixNum = (s, isLat) => {
    if (!s) return NaN;
    s = s.replace(',', '.');
    if (s.includes('.')) return parseFloat(s);
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
function extractDateTime(lines) {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 5); i--) {
    const line = lines[i];
    const d = line.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
    const t = line.match(/(\d{1,2}\s*[:\.]\s*\d{2}(?:\s*[AP]M)?)/i);
    if (d && t) return { date: toIsoDate(d[1]), time: to24h(t[1]) };
  }
  const joined = lines.join(' ');
  const d = joined.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
  const t = joined.match(/(\d{1,2}\s*[:\.]\s*\d{2}(?:\s*[AP]M)?)/i);
  return { date: d ? toIsoDate(d[1]) : '', time: t ? to24h(t[1]) : '' };
}
function extractAddress(lines) {
  const cleaned = lines
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !/^Google$/i.test(s))
    .filter(s => !/GPS\s*Map\s*Camera/i.test(s));
  const latIdx = cleaned.findIndex(s => /Lat/i.test(s) && /Long/i.test(s));
  const upto = latIdx >= 0 ? cleaned.slice(0, latIdx) : cleaned;
  const body = (upto[0] && /^[A-Za-z].*India/.test(upto[0]) && (upto[1] || '').length > 5)
    ? upto.slice(1)
    : upto;
  return body.join(', ').replace(/\s*,\s*,+/g, ', ').replace(/\s{2,}/g, ' ').trim();
}
function parseHudText(raw) {
  const lines = raw.split(/\n/).map(s => s.trim()).filter(Boolean);
  const { lat, lon } = extractLatLon(raw);
  const { date, time } = extractDateTime(lines);
  const address = extractAddress(lines);
  return { address, lat, lon, date, time };
}

/* ------------------------ Prefill URL ------------------------ */
function buildPrefillUrl({ date, time, lat, lon, ward, beat, addr, ps }) {
  const params = new URLSearchParams();
  params.set(ENTRY.date, date);
  params.set(ENTRY.time, time);
  params.set(ENTRY.lat,  Number(lat).toFixed(6));
  params.set(ENTRY.lon,  Number(lon).toFixed(6));
  if (ward) params.set(ENTRY.ward, ward);
  if (beat) params.set(ENTRY.beat, beat);
  params.set(ENTRY.addr, addr || '');
  if (ps)   params.set(ENTRY.ps, ps);
  return `${FORM_BASE}&${params.toString()}`;
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

/* ------------------------ Redirect pill manual fallback ------------------------ */
$('pill-redirect')?.addEventListener('click', () => {
  if (!lastRedirectUrl) return;
  window.open(lastRedirectUrl, '_blank', 'noopener');
});
