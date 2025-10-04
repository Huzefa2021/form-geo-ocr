/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.09.25.M1-ocrspace
   - Uses OCR.Space as primary OCR with compression + fallbacks
   - Keeps your existing flow & UI/UX intact
   ========================================================== */

/* ===================== Configuration ===================== */

const USE_OCR_SPACE = true;

// Your OCR.Space API key (from your message)
const OCR_SPACE_API_KEY = 'K86010114388957';

// languages: eng, hin, mar (OCR.Space supports multiple but best to keep lean)
const OCR_SPACE_LANGUAGE = 'eng';

// Google Form (same mapping you already use)
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

/* ======================= Shortcuts ======================= */

const $ = (id) => document.getElementById(id);

/* ------------------- UI element refs -------------------- */
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

/* ========================= Badges ======================== */

function updateCdnBadge(){
  const b = $('cdnBadge'); if(!b) return;
  const ok = !!(window.fetch && window.URLSearchParams);
  b.textContent = ok ? 'CDN: v5 (Loaded)' : 'CDN: v5 (Not Loaded)';
  b.className = `badge ${ok ? 'badge-ok glow' : 'badge-err glow'}`;
}
document.addEventListener('DOMContentLoaded', updateCdnBadge);
window.addEventListener('load', updateCdnBadge);

/* ========================= Utils ========================= */

function setPill(name, state){
  const p = pills[name]; if(!p) return;
  p.className = p.className.replace(/\b(ok|run|err|pulse)\b/g,'').trim();
  if(state) p.classList.add(state);
}
function banner(msg, kind='info'){
  const b = $('banner'); if(!b) return;
  if(!msg){ b.hidden = true; return; }
  b.hidden = false;
  b.textContent = msg;
  b.className = `banner ${kind}`;
}
function resetOutputs(){
  ['upload','ocr','parse','geo','review','redirect'].forEach(k=> setPill(k,null));
  [outDate,outTime,outLat,outLon,outAddr,outWard,outBeat,outPS].forEach(o => o && (o.textContent='—'));
  if(imgOriginal) imgOriginal.src = '';
  if(imgCrop) imgCrop.src = '';
  banner('');
  logToConsole('','', '[Reset]');
  lastRedirectUrl = '';
}
function fileToDataURL(f){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(f); }); }
function loadImage(url){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=url; }); }

/* ======================= Console ========================= */

function logToConsole(rawText, parsed, note=''){
  const pre = $('console-pre'); if (!pre) return;
  const stamp = new Date().toLocaleTimeString();
  const safe = (v)=> (v==null?'':String(v));
  const lines = [
    `⏱ ${stamp} ${note}`,
    rawText!=='' ? '--- RAW OCR TEXT ---' : '',
    rawText!=='' ? safe(rawText) : '',
    parsed!=='' ? '--- PARSED FIELDS ---' : '',
    (parsed && typeof parsed==='object') ? JSON.stringify(parsed,null,2) : (parsed!==''?safe(parsed):''),
    '────────────────────────────────────────'
  ].filter(Boolean).join('\n');
  pre.textContent = `${lines}\n${pre.textContent || 'Logs will appear here…'}`;
}

/* ===================== Image handling ==================== */

/** Static crop focused on HUD band (bottom overlay).
 *  Tuned to your previous “relaxed-left” setting.
 */
async function cropHud(dataURL){
  const img = await loadImage(dataURL);
  const W = img.naturalWidth, H = img.naturalHeight;

  // HUD overlay approx fractions (safe cushion)
  const topFrac = 0.64;   // slightly higher than mid
  const hFrac   = 0.33;   // ~bottom third
  const leftFrac= 0.08;   // relaxed left crop
  const rightFrac=0.04;

  const sx = Math.floor(W * leftFrac);
  const sy = Math.floor(H * topFrac);
  const sw = Math.floor(W * (1 - leftFrac - rightFrac));
  const sh = Math.floor(H * hFrac);

  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/png');
}

/** Simple binary (white-on-black) to help OCR; still optional. */
async function preprocessForOCR(cropURL){
  const img = await loadImage(cropURL);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img,0,0);

  const d = ctx.getImageData(0,0,c.width,c.height);
  const px = d.data;
  for (let i=0;i<px.length;i+=4){
    const r=px[i], g=px[i+1], b=px[i+2];
    const avg=(r+g+b)/3;
    const v = avg > 128 ? 255 : 0; // softened threshold
    px[i]=px[i+1]=px[i+2]=v; px[i+3]=255;
  }
  ctx.putImageData(d,0,0);
  return c.toDataURL('image/png');
}

/* ---------- Compression for OCR.Space (size limits!) ------- */

async function compressDataURL(dataUrl, { maxWidth = 1400, maxBytes = 900_000, jpegQualityStart = 0.82 } = {}) {
  const img = await loadImage(dataUrl);
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > maxWidth) {
    const s = maxWidth / w;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  let q = jpegQualityStart;
  let out = c.toDataURL('image/jpeg', q);
  const bytes = (s) => Math.ceil((s.length - 'data:image/jpeg;base64,'.length) * 3 / 4);

  while (bytes(out) > maxBytes && q > 0.35) {
    q -= 0.12;
    out = c.toDataURL('image/jpeg', q);
  }
  return out;
}

async function ocrSpaceRequest(base64Image, { engine = 3, language = OCR_SPACE_LANGUAGE } = {}) {
  const resp = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { 'apikey': OCR_SPACE_API_KEY },
    body: new URLSearchParams({
      base64Image,                  // include full data URL
      language,
      isOverlayRequired: 'false',
      detectOrientation: 'true',
      scale: 'true',
      OCREngine: String(engine)
    })
  });

  const json = await resp.json().catch(() => ({}));
  return {
    exit: json?.OCRExitCode,
    errored: json?.IsErroredOnProcessing,
    errorMessage: json?.ErrorMessage || json?.ErrorDetails || '',
    text: json?.ParsedResults?.[0]?.ParsedText?.trim() || '',
    raw: json
  };
}

/* ===================== Parsing helpers ==================== */

function cleanLines(raw){
  const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean);

  // remove brand/noise lines we’ve seen often
  return lines.filter(l =>
    !/GPS\s*Map\s*Camera/i.test(l) &&
    !/^Google$/i.test(l) &&
    !/^\.*$/.test(l) &&
    !/Map\s*Camera/i.test(l)
  );
}

function parseHudText(raw) {
  const lines = cleanLines(raw);
  if (lines.length < 3) return {};

  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];

  // address = everything between (skip the city/country top line)
  const addrLines = lines.slice(1, lines.length - 2);
  const address = addrLines.join(', ');

  // Lat / Long
  const latM = prev.match(/Lat[^0-9-]*([+-]?\d{1,2}\.\d+)/i);
  const lonM = prev.match(/Long[^0-9-]*([+-]?\d{1,3}\.\d+)/i);
  let lat = latM ? parseFloat(latM[1]) : NaN;
  let lon = lonM ? parseFloat(lonM[1]) : NaN;

  // Date / Time (handle DD/MM/YYYY and variants, strip 'GMT +05:30')
  let date = '', time = '';
  const dtLine = last.replace(/GMT.*$/,'').trim();

  // cases like "19/08/2025 11:00 AM" or "19/08/2025 11:00"
  const m1 = dtLine.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/);
  if (m1) { date = m1[1]; time = m1[2]; }

  // fallback if ISO-like
  const m2 = dtLine.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/);
  if (!date && m2) { date = m2[1]; time = m2[2]; }

  return { address, lat, lon, date, time };
}

// Normalize to Google Form prefill: YYYY-MM-DD and HH:mm (24h)
function normalizeForPrefill(dateStr, timeStr) {
  let outDate = '', outTime = '';

  // date
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
    const [d,m,y] = dateStr.split('/').map(Number);
    outDate = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    outDate = dateStr;
  }

  // time
  if (!timeStr) outTime = '';
  else {
    let ts = timeStr.trim();
    // "11:00 AM" → 11:00, "03:09 PM" → 15:09
    const ampm = ts.match(/([AP]M)$/i)?.[1]?.toUpperCase();
    ts = ts.replace(/\s*[AP]M$/i,'').trim();
    const [hh,mm] = ts.split(':').map(s=>s.trim());
    let H = parseInt(hh || '0', 10);
    const M = String(parseInt(mm || '0',10)).padStart(2,'0');

    if (ampm === 'AM') {
      if (H === 12) H = 0;
    } else if (ampm === 'PM') {
      if (H !== 12) H = H + 12;
    }
    outTime = `${String(H).padStart(2,'0')}:${M}`;
  }

  return { outDate, outTime };
}

/* =================== GeoJSON lookup (as-is) =============== */

let gjW=null, gjB=null, gjP=null;

async function ensureGeo(){
  if (gjW && gjB && gjP) return;
  const [w,b,p] = await Promise.all([
    fetch('data/wards.geojson').then(r=>r.json()),
    fetch('data/beats.geojson').then(r=>r.json()),
    fetch('data/police_jurisdiction.geojson').then(r=>r.json()),
  ]);
  gjW=w; gjB=b; gjP=p;
  const geoBadge = $('geoBadge');
  if (geoBadge) {
    geoBadge.textContent = 'Geo: Loaded';
    geoBadge.className = 'badge badge-ok glow';
  }
}

function pointInRing(ring, pt){
  const [x,y] = pt;
  let inside=false;
  for (let i=0,j=ring.length-1; i<ring.length; j=i++){
    const xi=ring[i][0], yi=ring[i][1];
    const xj=ring[j][0], yj=ring[j][1];
    const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function inGeom(g, pt){
  if (!g) return false;
  if (g.type==='Polygon') return pointInRing(g.coordinates[0], pt);
  if (g.type==='MultiPolygon') return g.coordinates.some(poly => pointInRing(poly[0], pt));
  return false;
}
function geoLookup(lat, lon){
  const out={ ward:'', beat:'', ps:'' };
  if (!gjW || !gjB || !gjP || isNaN(lat) || isNaN(lon)) return out;
  const pt=[lon, lat];

  for (const f of gjW.features){ if (inGeom(f.geometry, pt)) { out.ward=f.properties?.WARD || ''; break; } }
  for (const f of gjB.features){ if (inGeom(f.geometry, pt)) { out.beat=f.properties?.BEAT_NO || f.properties?.BEAT || ''; break; } }
  for (const f of gjP.features){ if (inGeom(f.geometry, pt)) { out.ps  =f.properties?.PS_NAME || f.properties?.PS || ''; break; } }
  return out;
}

/* ========================= Flow ========================== */

dropArea?.addEventListener('click', ()=> fileInput?.click());
dropArea?.addEventListener('keydown', (e)=> { if (e.key==='Enter'||e.key===' ') fileInput?.click(); });
fileInput?.addEventListener('click', (e)=> { e.target.value=''; });
fileInput?.addEventListener('change', (e)=> { const f=e.target.files?.[0]; if (f) handleFile(f); });

['dragenter','dragover'].forEach(t => dropArea?.addEventListener(t, e => { e.preventDefault(); dropArea.classList.add('dragover'); }));
['dragleave','drop'].forEach(t => dropArea?.addEventListener(t, e => { e.preventDefault(); dropArea.classList.remove('dragover'); }));
dropArea?.addEventListener('drop', (e) => {
  const f=[...(e.dataTransfer?.files||[])].find(f => /^image\//i.test(f.type));
  if (f) handleFile(f);
});

$('btnReset')?.addEventListener('click', () => location.reload());

async function handleFile(file){
  if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
    banner('Please choose a JPG or PNG.', 'error');
    return;
  }
  resetOutputs();

  try {
    setPill('upload', 'run');
    const dataURL = await fileToDataURL(file);
    imgOriginal.src = dataURL;
    setPill('upload', 'ok');

    // Crop HUD + preprocessing
    const cropURL = await cropHud(dataURL);
    imgCrop.src = cropURL;

    const processed = await preprocessForOCR(cropURL);

    /* ----------------- OCR (OCR.Space + fallbacks) ----------------- */
    setPill('ocr', 'run');
    let rawText = '';
    if (USE_OCR_SPACE) {
      // 1) try processed (binarized) + compressed
      let img1 = await compressDataURL(processed, { maxWidth: 1400, maxBytes: 900_000 });
      let r = await ocrSpaceRequest(img1, { engine: 3, language: OCR_SPACE_LANGUAGE });
      logToConsole('', { engine: 3, exit: r.exit, errored: r.errored, msg: r.errorMessage }, '[OCR.Space meta (processed, e3)]');

      // 2) try raw crop if empty
      if (!r.text) {
        let img2 = await compressDataURL(cropURL, { maxWidth: 1400, maxBytes: 900_000 });
        r = await ocrSpaceRequest(img2, { engine: 3, language: OCR_SPACE_LANGUAGE });
        logToConsole('', { engine: 3, exit: r.exit, errored: r.errored, msg: r.errorMessage }, '[OCR.Space meta (raw, e3)]');
      }

      // 3) engine 2
      if (!r.text) {
        let img3 = await compressDataURL(cropURL, { maxWidth: 1400, maxBytes: 900_000 });
        r = await ocrSpaceRequest(img3, { engine: 2, language: OCR_SPACE_LANGUAGE });
        logToConsole('', { engine: 2, exit: r.exit, errored: r.errored, msg: r.errorMessage }, '[OCR.Space meta (raw, e2)]');
      }

      rawText = r.text || '';
      if (!rawText) throw new Error('OCR.Space returned empty text after retries');
      logToConsole(rawText, null, '[OCR.Space complete]');
      setPill('ocr', 'ok');
    } else {
      // (fallback to Tesseract if you ever disable OCR.Space)
      const res = await Tesseract.recognize(processed, 'eng', { logger: ()=>{}, tessedit_pageseg_mode: 6 });
      rawText = (res?.data?.text || '').trim();
      if (!rawText) throw new Error('Tesseract returned empty text');
      logToConsole(rawText, null, '[Tesseract complete]');
      setPill('ocr', 'ok');
    }

    /* ----------------- Parse ----------------- */
    setPill('parse', 'run');
    const parsed = parseHudText(rawText);
    if (!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon) || !parsed.address) {
      setPill('parse', 'err');
      banner('Could not parse all fields from HUD.', 'error');
      logToConsole('', parsed, '[Parse incomplete]');
      return;
    }
    setPill('parse', 'ok');
    logToConsole('', parsed, '[Parse complete]');

    outDate.textContent = parsed.date;
    outTime.textContent = parsed.time;
    outLat.textContent  = parsed.lat.toFixed(6);
    outLon.textContent  = parsed.lon.toFixed(6);
    outAddr.textContent = parsed.address;

    /* ----------------- GeoJSON ----------------- */
    setPill('geo', 'run');
    await ensureGeo();
    const gj = geoLookup(parsed.lat, parsed.lon);
    outWard.textContent = gj.ward || '—';
    outBeat.textContent = gj.beat || '—';
    outPS.textContent   = gj.ps   || '—';

    if (!gj.ward || !gj.beat || !gj.ps) {
      setPill('geo', 'err');
      banner('GeoJSON lookup failed.', 'error');
      logToConsole('', gj, '[Geo match]');
      return;
    }
    setPill('geo', 'ok');
    logToConsole('', { matched: gj }, '[Geo match]');

    /* ----------------- Review OK ----------------- */
    setPill('review', 'ok');

    // Normalize for Google Form prefill
    const { outDate, outTime } = normalizeForPrefill(parsed.date, parsed.time);
    logToConsole('', { date: outDate, time: outTime }, '[Prefill normalized → YYYY-MM-DD + HH:mm]');

    const url = new URL(FORM_BASE);
    url.searchParams.set(ENTRY.date, outDate || '');
    url.searchParams.set(ENTRY.time, outTime || '');
    url.searchParams.set(ENTRY.lat, parsed.lat.toFixed(6));
    url.searchParams.set(ENTRY.lon, parsed.lon.toFixed(6));
    url.searchParams.set(ENTRY.ward, gj.ward);
    url.searchParams.set(ENTRY.beat, gj.beat);
    url.searchParams.set(ENTRY.addr, parsed.address);
    url.searchParams.set(ENTRY.ps,   gj.ps);

    lastRedirectUrl = url.toString();
    logToConsole('', { redirect: lastRedirectUrl }, '[Redirect URL]');

    try {
      setPill('redirect','run');
      const win = window.open(lastRedirectUrl, '_blank', 'noopener');
      if (!win) throw new Error('Popup blocked');
      setPill('redirect','ok');
      pills.redirect?.classList.add('pulse');
      setTimeout(()=> pills.redirect?.classList.remove('pulse'), 1800);
    } catch {
      setPill('redirect', 'err');
      banner('Auto-redirect blocked. Tap the Redirect pill to open manually.', 'error');
      pills.redirect?.addEventListener('click', ()=> { if (lastRedirectUrl) window.open(lastRedirectUrl,'_blank','noopener'); }, { once:true });
    }

  } catch (e){
    setPill('ocr','err');
    banner('OCR failed. Check network/key or try a clearer photo.', 'error');
    logToConsole('', { error: String(e) }, '[OCR error]');
  }
}

/* ==================== Init on load ======================= */
ensureGeo().catch(()=>{ const g=$('geoBadge'); if(g){ g.textContent='Geo: Loading…'; g.className='badge badge-warn glow'; }});
updateCdnBadge();
