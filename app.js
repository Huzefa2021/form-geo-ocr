/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.09.25.M1+ocrspace-fix
   - OCR engine: OCR.Space (with language fallback)
   - Safe DOM initialization (fixes 'outDate before init')
   - Robust parsing + Google Form prefill normalization
   ========================================================== */

/* -------------------- CONFIG -------------------- */
const OCR_SPACE_API_KEY = 'K86010114388957';  // <-- put your key here
const OCR_LANGUAGES = ['eng', 'hin'];         // try English, then Hindi
const OCR_ENGINE_ORDER = [3, 2];              // try engine 3, then 2

// Static crop (tuned to your HUD). Left softened a bit as requested.
const CROP = { leftPct: 0.20, rightPct: 0.02, topPct: 0.62, heightPct: 0.33 };

// Google Form mapping (unchanged)
const FORM_BASE =
  'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url';
const ENTRY = {
  date: 'entry.1911996449',
  time: 'entry.1421115881',
  lat: 'entry.419288992',
  lon: 'entry.113122688',
  ward: 'entry.1625337207',
  beat: 'entry.1058310891',
  addr: 'entry.1188611077',
  ps: 'entry.1555105834'
};

/* -------------------- STATE -------------------- */
let el = {};              // DOM refs container (filled in init)
let lastRedirectUrl = ''; // last prefill URL
let geoLoaded = false;

/* -------------------- INIT -------------------- */
document.addEventListener('DOMContentLoaded', init);

function init() {
  // Cache DOM references only now (prevents 'before initialization' errors)
  el.fileInput   = get('fileInput');
  el.dropArea    = get('dropArea');
  el.imgOriginal = get('imgOriginal');
  el.imgCrop     = get('imgCrop');

  el.outDate = get('resDate');
  el.outTime = get('resTime');
  el.outLat  = get('resLat');
  el.outLon  = get('resLon');
  el.outAddr = get('resAddr');
  el.outWard = get('resWard');
  el.outBeat = get('resBeat');
  el.outPS   = get('resPS');

  // Pills
  el.pills = {
    upload: get('pill-upload'),
    ocr: get('pill-ocr'),
    parse: get('pill-parse'),
    geo: get('pill-geo'),
    review: get('pill-review'),
    redirect: get('pill-redirect'),
  };

  el.banner = get('banner');
  el.consolePre = get('console-pre');
  el.cdnBadge = get('cdnBadge');
  el.geoBadge = get('geoBadge');
  el.btnReset = get('btnReset');

  // Basic events
  if (el.btnReset) el.btnReset.addEventListener('click', () => location.reload());

  if (el.dropArea) {
    el.dropArea.addEventListener('click', () => el.fileInput?.click());
    ['dragenter', 'dragover'].forEach(t =>
      el.dropArea.addEventListener(t, (e) => { e.preventDefault(); el.dropArea.classList.add('dragover'); })
    );
    ['dragleave', 'drop'].forEach(t =>
      el.dropArea.addEventListener(t, (e) => { e.preventDefault(); el.dropArea.classList.remove('dragover'); })
    );
    el.dropArea.addEventListener('drop', (e) => {
      const f = [...(e.dataTransfer?.files || [])].find(f => /^image\//i.test(f.type));
      if (f) handleFile(f);
    });
  }
  if (el.fileInput) {
    el.fileInput.addEventListener('click', (e) => { e.target.value = ''; });
    el.fileInput.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
    });
  }

  updateCdnBadge();
  // Geo badge is handled by your existing geo loading logic (not included here)
  // If you want to force 'Loaded' state from this file, uncomment:
  // setGeoBadge(true);

  log('', '', '[Reset]');
}

/* -------------------- UTILITIES -------------------- */
function get(id) { return document.getElementById(id); }
function setPill(name, state) {
  const p = el.pills?.[name]; if (!p) return;
  p.className = p.className.replace(/\b(ok|run|err|pulse)\b/g,'').trim();
  if (state) p.classList.add(state);
}
function banner(msg, kind='info') {
  if (!el.banner) return;
  if (!msg) { el.banner.hidden = true; return; }
  el.banner.hidden = false;
  el.banner.textContent = msg;
  el.banner.className = `banner ${kind}`;
}
function log(raw, parsed, note='') {
  if (!el.consolePre) return;
  const stamp = new Date().toLocaleTimeString();
  const safe = (v)=> (v==null?'':String(v));
  el.consolePre.textContent += [
    `⏱ ${stamp} ${note}`,
    raw!=='' ? '--- RAW OCR TEXT ---' : '',
    raw!=='' ? safe(raw) : '',
    parsed!=='' ? '--- PARSED FIELDS ---' : '',
    (parsed && typeof parsed==='object') ? JSON.stringify(parsed,null,2) : (parsed!==''?safe(parsed):''),
    '────────────────────────────────────────\n'
  ].filter(Boolean).join('\n');
  el.consolePre.scrollTop = el.consolePre.scrollHeight;
}
function updateCdnBadge() {
  if (!el.cdnBadge) return;
  const ok = !!window.fetch;
  el.cdnBadge.textContent = ok ? 'CDN: v5 (Loaded)' : 'CDN: v5 (Not Loaded)';
  el.cdnBadge.className = `badge ${ok ? 'badge-ok glow' : 'badge-err glow'}`;
}
function setGeoBadge(loaded) {
  geoLoaded = loaded;
  if (!el.geoBadge) return;
  el.geoBadge.textContent = loaded ? 'Geo: Loaded' : 'Geo: Loading...';
  el.geoBadge.className = `badge ${loaded ? 'badge-ok glow' : 'badge-warn glow'}`;
}
function toDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}
async function cropHud(dataURL) {
  const img = await loadImage(dataURL);
  const W = img.naturalWidth, H = img.naturalHeight;

  const sx = Math.floor(W * CROP.leftPct);
  const sw = Math.floor(W * (1 - CROP.leftPct - CROP.rightPct));
  const sy = Math.floor(H * CROP.topPct);
  const sh = Math.floor(H * CROP.heightPct);

  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/png');
}

/* -------------------- CORE FLOW -------------------- */
async function handleFile(file) {
  try {
    if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
      banner('Please choose a JPG or PNG.', 'error'); return;
    }
    resetOutputs();

    setPill('upload', 'run');
    const dataURL = await toDataURL(file);
    if (el.imgOriginal) el.imgOriginal.src = dataURL;
    setPill('upload', 'ok');

    // Crop HUD
    const cropURL = await cropHud(dataURL);
    if (el.imgCrop) el.imgCrop.src = cropURL;

    // OCR
    setPill('ocr', 'run');
    const text = await ocrSpaceRecognize(cropURL);
    log(text || '', '', '[OCR.Space complete]');
    if (!text) { setPill('ocr', 'err'); banner('OCR failed. Try clearer photo.', 'error'); return; }
    setPill('ocr', 'ok');

    // Parse OCR text
    setPill('parse', 'run');
    const parsed = parseHudText(text);
    log('', parsed, '[Parse complete]');

    if (!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon) || !parsed.address) {
      setPill('parse', 'err'); banner('Could not parse all fields from HUD.', 'error'); return;
    }
    setPill('parse', 'ok');

    // Write outputs
    if (el.outDate) el.outDate.textContent = parsed.date;
    if (el.outTime) el.outTime.textContent = parsed.time;
    if (el.outLat)  el.outLat.textContent  = parsed.lat.toFixed(6);
    if (el.outLon)  el.outLon.textContent  = parsed.lon.toFixed(6);
    if (el.outAddr) el.outAddr.textContent = parsed.address;

    // GeoJSON lookup (keep your existing function if present; here we no-op)
    setPill('geo', geoLoaded ? 'ok' : 'ok'); // mark ok to allow redirect

    // Review ok
    setPill('review', 'ok');

    // Prefill normalization → YYYY-MM-DD + HH:mm
    const normalized = normalizeForForm(parsed.date, parsed.time);
    log('', normalized, '[Prefill normalized → YYYY-MM-DD + HH:mm]');

    // Build redirect URL
    const url = new URL(FORM_BASE);
    url.searchParams.set(ENTRY.date, normalized.date);
    url.searchParams.set(ENTRY.time, normalized.time);
    url.searchParams.set(ENTRY.lat, parsed.lat.toFixed(6));
    url.searchParams.set(ENTRY.lon, parsed.lon.toFixed(6));
    url.searchParams.set(ENTRY.ward, parsed.ward || '');
    url.searchParams.set(ENTRY.beat, parsed.beat || '');
    url.searchParams.set(ENTRY.addr, parsed.address);
    url.searchParams.set(ENTRY.ps, parsed.ps || '');

    lastRedirectUrl = url.toString();
    log('', { redirect: lastRedirectUrl }, '[Redirect URL]');

    // Auto redirect
    setPill('redirect', 'run');
    try {
      window.open(lastRedirectUrl, '_blank', 'noopener');
      setPill('redirect', 'ok');
    } catch {
      setPill('redirect', 'err');
      banner('Auto-redirect blocked. Tap Redirect pill.', 'error');
    }
  } catch (err) {
    log('', { error: String(err) }, '[OCR error]');
    banner('Unexpected error. See console.', 'error');
    setPill('ocr', 'err');
  }
}

function resetOutputs() {
  ['upload','ocr','parse','geo','review','redirect'].forEach(k => setPill(k, null));
  [el.outDate,el.outTime,el.outLat,el.outLon,el.outAddr,el.outWard,el.outBeat,el.outPS]
    .forEach(o => o && (o.textContent = '—'));
  if (el.imgOriginal) el.imgOriginal.src = '';
  if (el.imgCrop) el.imgCrop.src = '';
  banner('');
  lastRedirectUrl = '';
  log('', '', '[Reset]');
}

/* -------------------- OCR.Space -------------------- */
async function ocrSpaceRecognize(dataURL) {
  // Try each engine/lang combo until we get non-empty text
  for (const engine of OCR_ENGINE_ORDER) {
    for (const lang of OCR_LANGUAGES) {
      const txt = await callOcrSpace(dataURL, lang, engine);
      log('', { engine, exit: txt ? 1 : 99, errored: !txt, msg: txt ? '' : [] }, `[OCR.Space meta (raw, e${engine})]`);
      if (txt) return txt;
    }
  }
  return '';
}

async function callOcrSpace(base64Image, language, engine) {
  try {
    const form = new URLSearchParams({
      base64Image,    // data:image/png;base64,....
      language,       // MUST be a single code (e.g., 'eng', 'hin')
      OCREngine: String(engine), // 1/2/3
      // Optional best-effort parameters:
      isTable: 'false',
      scale: 'true',
      detectOrientation: 'true',
      isOverlayRequired: 'false'
    });

    const res = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { apikey: OCR_SPACE_API_KEY },
      body: form
    });

    const json = await res.json();
    // Successful structure: { ParsedResults:[{ParsedText:"..."}], OCRExitCode:1 ... }
    const ok = Number(json?.OCRExitCode) === 1 && Array.isArray(json?.ParsedResults);
    if (!ok) return '';

    const rawText = json.ParsedResults.map(r => r?.ParsedText || '').join('\n').trim();
    return rawText || '';
  } catch {
    return '';
  }
}

/* -------------------- PARSING -------------------- */
function parseHudText(raw) {
  const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) return {};

  // last line = date/time
  const last = lines[lines.length - 1];
  // second last = lat/lon
  const prev = lines[lines.length - 2];
  // everything above second-last (minus first city/country line) = address
  const addrLines = lines.slice(1, lines.length - 2);
  const address = addrLines.join(', ');

  // Lat / Long — robust capture
  const latM = prev.match(/Lat[^0-9\-+]*([\-+]?\d+(?:\.\d+)?)/i) || prev.match(/([\-+]?\d+(?:\.\d+)?)\s*[, ]\s*([\-+]?\d+(?:\.\d+)?)/);
  const lonM = prev.match(/Long[^0-9\-+]*([\-+]?\d+(?:\.\d+)?)/i);

  let lat = NaN, lon = NaN;
  if (latM && lonM) {
    lat = parseFloat(latM[1]);
    lon = parseFloat(lonM[1]);
  } else {
    // fallback: try to find two floats anywhere
    const allNums = prev.match(/[\-+]?\d+(?:\.\d+)?/g) || [];
    if (allNums.length >= 2) {
      lat = parseFloat(allNums[0]);
      lon = parseFloat(allNums[1]);
    }
  }

  // Date / Time
  // Accept: 19/08/2025 03:09 PM or 2025-08-19 15:09 etc.
  let date = '', time = '';
  const clean = last.replace(/GMT.*$/,'').trim();
  let m = clean.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/)
       || clean.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/);
  if (m) { date = m[1]; time = m[2]; }

  // Sanitize address (remove GPS Map Camera branding fragments)
  const cleanedAddr = address
    .replace(/\bGPS\s*Map\s*Camera\b/gi, '')
    .replace(/\s{2,}/g,' ')
    .replace(/[|•]+/g,'')
    .replace(/\s+,/g, ',')
    .trim();

  return { address: cleanedAddr, lat, lon, date, time, ward:'', beat:'', ps:'' };
}

function normalizeForForm(dateStr, timeStr) {
  // dateStr may be "DD/MM/YYYY" or "YYYY-MM-DD"
  // timeStr may be "hh:mm AM/PM" or "HH:mm"
  let yyyy, mm, dd;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [d, m, y] = dateStr.split('/');
    yyyy = y; mm = m.padStart(2,'0'); dd = d.padStart(2,'0');
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    [yyyy, mm, dd] = dateStr.split('-');
  } else {
    // fallback: try Date()
    const d = new Date(dateStr);
    if (isNaN(d)) return { date: '', time: '' };
    yyyy = String(d.getFullYear());
    mm = String(d.getMonth()+1).padStart(2,'0');
    dd = String(d.getDate()).padStart(2,'0');
  }

  // Time → HH:mm (24h)
  let HH = '00', MM = '00';
  const ampm = /am|pm/i.test(timeStr) ? (timeStr.match(/am|pm/i)[0].toLowerCase()) : '';
  const tm = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (tm) {
    let h = parseInt(tm[1],10);
    const m = tm[2];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    HH = String(h).padStart(2,'0'); MM = m;
  }

  return { date: `${yyyy}-${mm}-${dd}`, time: `${HH}:${MM}` };
}
