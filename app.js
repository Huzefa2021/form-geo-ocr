/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.10.05.M2
   OCR flow:
     1) OCR.Space (single request)
     2) Fallback: Tesseract.js (eng + hin)
   Crop:
     - Static portrait/landscape with cushions
     - Landscape = “less aggressive” bottom
   Parsing:
     - Branding removal, robust lat/lon, date/time
     - Prefill date YYYY-MM-DD, time HH:mm (24h)
   GeoJSON:
     - wards.geojson, beats.geojson, police_jurisdiction.geojson
   ========================================================== */

const OCR_SPACE_KEY = 'K86010114388957'; // <-- Put your OCR.Space key here

/* -------------------- DOM -------------------- */
const $ = (id) => document.getElementById(id);

const fileInput   = $('fileInput');
const dropArea    = $('dropArea');
const imgOriginal = $('imgOriginal');
const imgCrop     = $('imgCrop');
const workCanvas  = $('workCanvas');

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

$('btnReset').addEventListener('click', () => location.reload());
$('consoleCopy').addEventListener('click', copyConsole);
$('consoleToggle').addEventListener('click', toggleConsole);

/* -------------------- Badges -------------------- */
function updateCdnBadge(){
  const ok = !!(window.Tesseract && Tesseract.recognize);
  const cdn = $('cdnBadge');
  if(!cdn) return;
  cdn.textContent = ok ? 'CDN: v5 (Loaded)' : 'CDN: v5 (Not Loaded)';
  cdn.className = `badge ${ok ? 'badge-ok' : 'badge-err'} glow`;
}
document.addEventListener('DOMContentLoaded', updateCdnBadge);
window.addEventListener('load', updateCdnBadge);

const geoBadge = $('geoBadge');

/* -------------------- Console -------------------- */
function logToConsole(rawText, parsed, note=''){
  const pre = $('console-pre'); if(!pre) return;
  const t = new Date().toLocaleTimeString('en-IN', {hour12:false});
  const clean = (v)=> v==null?'':(typeof v==='string'?v:String(v));
  pre.textContent += `\n\u23F1 ${t} ${note}\n`;
  if(rawText!=='' && rawText!=null){
    pre.textContent += `--- RAW OCR TEXT ---\n${clean(rawText)}\n`;
  }
  if(parsed!=='' && parsed!=null){
    pre.textContent += `--- PARSED FIELDS ---\n${typeof parsed==='object'?JSON.stringify(parsed,null,2):clean(parsed)}\n`;
  }
  pre.textContent += '────────────────────────────────────────\n';
  pre.scrollTop = pre.scrollHeight;
}
function copyConsole(){
  const pre = $('console-pre'); if(!pre) return;
  navigator.clipboard.writeText(pre.textContent || '').catch(()=>{});
}
function toggleConsole(){
  const pre = $('console-pre');
  if(!pre) return;
  const btn = $('consoleToggle');
  const hidden = pre.style.display === 'none';
  pre.style.display = hidden ? 'block' : 'none';
  btn.textContent = hidden ? 'Hide' : 'Show';
}

/* -------------------- Helpers -------------------- */
function setPill(name, state){
  const p = pills[name]; if(!p) return;
  p.className = 'pill';
  if(state) p.classList.add(state);
  if(name==='redirect' && state==='ok'){ // make redirect pill actionable
    p.classList.add('pulse');
    p.onclick = ()=> { if(lastRedirectUrl) window.open(lastRedirectUrl, '_blank', 'noopener'); };
  }else if(name==='redirect'){
    p.onclick = null;
    p.classList.remove('pulse');
  }
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
  [outDate,outTime,outLat,outLon,outAddr,outWard,outBeat,outPS].forEach(o=> o.textContent='—');
  imgOriginal.src = ''; imgCrop.src = '';
  lastRedirectUrl = '';
  logToConsole('', '', '[Reset]');
}
function fileToDataURL(file){
  return new Promise((res,rej)=>{
    const fr = new FileReader();
    fr.onload = ()=> res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}
function loadImage(url){
  return new Promise((res,rej)=>{
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}

/* -------------------- Drag/drop -------------------- */
dropArea.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('click', e => e.target.value = '');
fileInput.addEventListener('change', e => {
  const f = e.target.files?.[0]; if(f) handleFile(f);
});
['dragenter', 'dragover'].forEach(ev => dropArea.addEventListener(ev, e => {
  e.preventDefault(); dropArea.classList.add('drag');
}));
['dragleave', 'drop'].forEach(ev => dropArea.addEventListener(ev, e => {
  e.preventDefault(); dropArea.classList.remove('drag');
}));
dropArea.addEventListener('drop', e => {
  const f = [...(e.dataTransfer?.files||[])].find(f => /^image\//.test(f.type));
  if(f) handleFile(f);
});

/* -------------------- Pipeline -------------------- */
let lastRedirectUrl = '';
let gjW=null, gjB=null, gjP=null;  // geojson

async function handleFile(file){
  if(!/^image\/(jpe?g|png)$/i.test(file.type)){
    banner('Please choose a JPG or PNG.', 'error'); return;
  }
  resetOutputs();
  setPill('upload','run');

  const dataURL = await fileToDataURL(file);
  imgOriginal.src = dataURL;
  setPill('upload', 'ok');

  // Crop HUD
  setPill('ocr','run');
  const cropDataUrl = await cropHud(dataURL);
  imgCrop.src = cropDataUrl;

  // OCR primary: OCR.Space (one request)
  const {text: ocrText, meta} = await ocrSpaceOnce(cropDataUrl, 'eng');
  if(meta) logToConsole(meta.raw || '', meta.processed || {}, '[OCR.Space meta (processed)]');

  let text = (ocrText || '').trim();

  // If OCR.Space failed: fallback Tesseract
  if(!text){
    const res = await ocrTesseract(cropDataUrl);
    text = res.text;
    logToConsole(text, '', '[OCR complete via Tesseract]');
  }else{
    logToConsole(text, '', '[OCR.Space result]');
  }

  // Parse
  setPill('parse','run');
  const parsed = parseHudText(text);
  logToConsole('', parsed, '[Parse complete]');

  if(!(parsed.date && parsed.time && isFinite(parsed.lat) && isFinite(parsed.lon) && parsed.address)){
    setPill('parse','err');
    banner('Could not parse all fields from HUD.', 'error');
    return;
  }
  setPill('parse','ok');

  outDate.textContent = parsed.date;
  outTime.textContent = parsed.time;
  outLat.textContent  = parsed.lat.toFixed(6);
  outLon.textContent  = parsed.lon.toFixed(6);
  outAddr.textContent = parsed.address;

  // GeoJSON
  setPill('geo','run');
  await ensureGeo();
  const gj = geoLookup(parsed.lat, parsed.lon);
  outWard.textContent = gj.ward || '—';
  outBeat.textContent = gj.beat || '—';
  outPS.textContent   = gj.ps   || '—';

  if(!gj.ward || !gj.beat || !gj.ps){
    setPill('geo','err');
    banner('GeoJSON lookup failed.', 'error');
    return;
  }
  setPill('geo','ok');

  // Review done
  setPill('review','ok');

  // Prefill URL
  const redirect = buildPrefillURL({
    date: parsed.date,
    time: parsed.time,
    lat: parsed.lat,
    lon: parsed.lon,
    ward: gj.ward,
    beat: gj.beat,
    address: parsed.address,
    ps: gj.ps,
  });
  lastRedirectUrl = redirect;
  logToConsole('', {redirect}, '[Redirect URL]');
  setPill('redirect', 'ok'); // click the pill to open
}

/* -------------------- Crop -------------------- */
async function cropHud(dataURL){
  const img = await loadImage(dataURL);
  const W = img.naturalWidth, H = img.naturalHeight;

  // Portrait vs landscape tuning:
  const portrait = H >= W;

  // Static, predictable crop:
  const leftPad   = Math.floor(W * (portrait ? 0.02 : 0.03)); // relax in landscape
  const rightPad  = Math.floor(W * 0.02);
  const topPad    = Math.floor(H * (portrait ? 0.62 : 0.70)); // less aggressive in landscape
  const heightHUD = Math.floor(H * (portrait ? 0.35 : 0.27));

  const sx = leftPad;
  const sy = Math.min(H - 4, topPad);
  const sw = Math.max(10, W - leftPad - rightPad);
  const sh = Math.min(heightHUD, H - sy);

  const c = workCanvas;
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  // Keep as JPEG ~0.85 to stay below 1MB for OCR.Space.
  return c.toDataURL('image/jpeg', 0.85);
}

/* -------------------- OCR -------------------- */
async function ocrSpaceOnce(dataUrl, lang='eng'){
  // Guard: limit payload size (OCR.Space max ~1MB)
  let base64 = dataUrl;
  // If too big, re-encode smaller
  if((base64.length * 3/4) > 900 * 1024){
    const downsized = await reencode(dataUrl, 0.78);
    base64 = downsized;
  }

  try{
    const body = new URLSearchParams({
      apikey: OCR_SPACE_KEY,
      language: lang,    // 'eng' only; keep quota low
      isOverlayRequired: 'false',
      scale: 'true',
      OCREngine: '2',    // Engine 2 (stable)
      base64Image: base64
    });
    const r = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body,
    });

    const j = await r.json();
    const parsedResults = (j?.ParsedResults && j.ParsedResults[0]) || null;
    const exitCode = j?.OCRExitCode;

    const processedMeta = {
      engine: 2,
      lang,
      exit: exitCode ?? 'n/a',
      errored: !(exitCode === 1 && parsedResults && parsedResults.ParsedText),
      msg: j?.ErrorMessage || j?.ErrorDetails || ''
    };
    logToConsole('', processedMeta, '[OCR payload compressed]');

    // Success
    if(exitCode === 1 && parsedResults){
      return {
        text: (parsedResults.ParsedText || '').trim(),
        meta: { processed: processedMeta }
      };
    }
    // Else fail (we'll fallback)
    logToConsole('', processedMeta, '[OCR.Space meta (processed)]');
    return { text: '', meta: { processed: processedMeta} };
  }catch(e){
    logToConsole('', {error: String(e)}, '[OCR error]');
    return { text: '', meta: { error: String(e) } };
  }
}

async function reencode(dataUrl, q){
  const img = await loadImage(dataUrl);
  const c = workCanvas;
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/jpeg', q);
}

async function ocrTesseract(dataUrl){
  try{
    const res = await Tesseract.recognize(dataUrl, 'eng+hin', {
      logger: _ => {},
      tessedit_pageseg_mode: 6
    });
    return { text: (res?.data?.text || '').trim() };
  }catch(e){
    return { text: '' };
  }
}

/* -------------------- Parsing -------------------- */
function normalizeText(raw){
  let t = (raw || '').replace(/\r/g,'\n');

  // Remove branding / noise
  t = t.replace(/GPS\s*Map\s*Camera/gi, '')
       .replace(/Google/gi, '')
       .replace(/[|“”"`]+/g,' ')
       .replace(/\s{2,}/g,' ')
       .trim();
  return t;
}

// Insert decimal if missing (assume dd.dddddd style) e.g. "19191141" -> "19.191141"
function coerceDecimal(numStr){
  if(!numStr) return NaN;
  if(numStr.includes('.')) return parseFloat(numStr);
  const digits = numStr.replace(/[^\d-]/g,'');
  if(!digits) return NaN;
  // If too short, bail
  if(digits.length < 4) return NaN;
  // Heuristic: lat/lon from GPS Map Camera have 2 digits before decimal
  const sign = digits.startsWith('-') ? '-' : '';
  const core = digits.replace(/^-/, '');
  const withDot = sign + core.slice(0,2) + '.' + core.slice(2);
  return parseFloat(withDot);
}

function parseHudText(raw){
  const text = normalizeText(raw);
  const lines = text.split(/\n/).map(s=>s.trim()).filter(Boolean);

  // Detect last two lines containing coordinates and date/time
  const joined = lines.join(' \n ');

  // Address lines: drop the first heading line if it looks like "Mumbai, Maharashtra, India"
  let addrLines = lines.slice();
  if(addrLines.length >= 3){
    const first = addrLines[0].toLowerCase();
    if(/maharashtra|india|mumbai/.test(first)) addrLines = addrLines.slice(1);
  }

  // Extract lat/lon (robust)
  let lat = NaN, lon = NaN;
  let mLat = joined.match(/Lat(?:itude)?\s*([+\-]?\d+(?:\.\d+)?)/i);
  let mLon = joined.match(/Long(?:itude)?\s*([+\-]?\d+(?:\.\d+)?)/i);
  if(mLat) lat = coerceDecimal(mLat[1]); // handles no dot
  if(mLon) lon = coerceDecimal(mLon[1]);

  // Fallback: bare two numbers near each other
  if(!isFinite(lat) || !isFinite(lon)){
    const nums = [...joined.matchAll(/([+\-]?\d{2,}(?:\.\d+)?)/g)].map(m=>m[1]);
    const cands = nums.map(n=>coerceDecimal(n)).filter(v=>isFinite(v));
    for(let i=0;i+1<cands.length;i++){
      const a = cands[i], b = cands[i+1];
      if(a>=-90 && a<=90 && b>=-180 && b<=180){ lat=a; lon=b; break; }
      if(b>=-90 && b<=90 && a>=-180 && a<=180){ lat=b; lon=a; break; }
    }
  }

  // Date/time, e.g. 04/10/2025 04:35 PM GMT +05:30
  let date='', time='';
  const dtLine = joined.match(/(\d{1,2}\/\d{1,2}\/\d{4}).{0,6}(\d{1,2}:\d{2})\s*([AP]M)?/i);
  if(dtLine){
    const d = dtLine[1], hhmm = dtLine[2], ap = (dtLine[3]||'').toUpperCase();
    const [dd,mm,yyyy] = d.split('/').map(x=>parseInt(x,10));
    let [H,M] = hhmm.split(':').map(n=>parseInt(n,10));
    if(ap==='PM' && H<12) H+=12;
    if(ap==='AM' && H===12) H=0;
    date = `${yyyy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    time = `${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')}`;
  }

  // Build address (remove lat/long/date tails)
  const addr = addrLines
    .filter(l => !/Lat|Long|GMT|AM|PM|\d{1,2}\/\d{1,2}\/\d{4}/i.test(l))
    .join(', ');

  return {
    address: addr || '',
    lat, lon,
    date, time
  };
}

/* -------------------- Prefill URL -------------------- */
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
function buildPrefillURL(o){
  const u = new URL(FORM_BASE);
  u.searchParams.set(ENTRY.date, o.date);
  u.searchParams.set(ENTRY.time, o.time);
  u.searchParams.set(ENTRY.lat , o.lat.toFixed(6));
  u.searchParams.set(ENTRY.lon , o.lon.toFixed(6));
  if(o.ward) u.searchParams.set(ENTRY.ward, String(o.ward));
  if(o.beat) u.searchParams.set(ENTRY.beat, String(o.beat));
  u.searchParams.set(ENTRY.addr, o.address || '');
  if(o.ps) u.searchParams.set(ENTRY.ps, String(o.ps));
  return u.toString();
}

/* -------------------- GeoJSON lookup -------------------- */
async function ensureGeo(){
  if(gjW && gjB && gjP) return;
  try{
    const [w,b,p] = await Promise.all([
      fetch('data/wards.geojson').then(r=>r.json()),
      fetch('data/beats.geojson').then(r=>r.json()),
      fetch('data/police_jurisdiction.geojson').then(r=>r.json()),
    ]);
    gjW=w; gjB=b; gjP=p;
    if(geoBadge){ geoBadge.textContent = 'Geo: Loaded'; geoBadge.className = 'badge badge-ok'; }
  }catch(e){
    if(geoBadge){ geoBadge.textContent = 'Geo: Error'; geoBadge.className = 'badge badge-err'; }
  }
}
function geoLookup(lat, lon){
  const pt = [lon, lat];
  const inside = (geom) =>{
    if(!geom) return false;
    if(geom.type==='Polygon') return pip(geom.coordinates, pt);
    if(geom.type==='MultiPolygon') return geom.coordinates.some(r => pip(r, pt));
    return false;
  };
  const out = {ward:'', beat:'', ps:''};
  if(gjW?.features){
    for(const f of gjW.features){ if(inside(f.geometry)){ out.ward = f.properties?.WARD || f.properties?.ward || ''; break; } }
  }
  if(gjB?.features){
    for(const f of gjB.features){ if(inside(f.geometry)){ out.beat = f.properties?.BEAT_NO || f.properties?.beat || ''; break; } }
  }
  if(gjP?.features){
    for(const f of gjP.features){ if(inside(f.geometry)){ out.ps = f.properties?.PS_NAME || f.properties?.police || ''; break; } }
  }
  return out;
}
// Point-in-polygon (ray casting)
function pip(poly, point){
  const [x,y]=point; let inside=false;
  for(const ring of poly){
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const xi=ring[i][0], yi=ring[i][1];
      const xj=ring[j][0], yj=ring[j][1];
      const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
      if(intersect) inside = !inside;
    }
  }
  return inside;
}

/* -------------------- Kickoff -------------------- */
updateCdnBadge();
if(geoBadge){ geoBadge.textContent='Geo: Loading…'; geoBadge.className='badge badge-warn'; }
ensureGeo();
document.getElementById('buildTag')?.textContent = 'v2025.10.05.M2';
