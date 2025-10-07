/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.10.07.SMART-CROP
   - Smart HUD crop (finds the black GPS Map Camera strip)
   - Left mini-map auto trim via vertical-edge scan
   - Keeps your existing UI, parsing, geo lookup & prefill
   ========================================================== */

const $ = (id) => document.getElementById(id);

/* ---------- UI refs ---------- */
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

/* ---------- Badges ---------- */
function updateCdnBadge(){
  const b = $('cdnBadge'); if(!b) return;
  const ok = !!(window.Tesseract && Tesseract.recognize);
  b.textContent = ok ? 'CDN: v5 (Loaded)' : 'CDN: v5 (Not Loaded)';
  b.className = `badge ${ok ? 'badge-ok glow' : 'badge-err glow'}`;
}
document.addEventListener('DOMContentLoaded', updateCdnBadge);
window.addEventListener('load', updateCdnBadge);

/* ---------- Helpers ---------- */
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

/* ---------- Console ---------- */
function logToConsole(rawText, parsed, note=''){
  const pre = $('console-pre'); if (!pre) return;
  const stamp = new Date().toLocaleTimeString();
  const safe = (v)=> (v==null?'':String(v));
  const log = [
    `⏱ ${stamp} ${note}`,
    rawText!=='' ? '--- RAW OCR TEXT ---' : '',
    rawText!=='' ? safe(rawText) : '',
    parsed!=='' ? '--- PARSED FIELDS ---' : '',
    (parsed && typeof parsed==='object') ? JSON.stringify(parsed,null,2) : (parsed!==''?safe(parsed):''),
    '────────────────────────────────────────'
  ].filter(Boolean).join('\n');
  pre.textContent = log + '\n' + pre.textContent;
}

/* ---------- Form mapping ---------- */
const FORM_BASE='https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url';
const ENTRY={date:'entry.1911996449',time:'entry.1421115881',lat:'entry.419288992',lon:'entry.113122688',ward:'entry.1625337207',beat:'entry.1058310891',addr:'entry.1188611077',ps:'entry.1555105834'};

/* ==========================================================
   SMART HUD CROP
   - Detects bottom black strip by luminance scan
   - Finds left mini-map boundary by vertical edge strength
   - Falls back to safe defaults if detection is uncertain
   ========================================================== */

/* tunables */
const SCAN_TARGET_W = 512;          // downsample width for analysis
const DARK_THRESH   = 120;          // row mean ≤ this = “dark”
const MIN_BAND_PC_P = 0.12;         // min HUD height (portrait) as % of H
const MIN_BAND_PC_L = 0.10;         // min HUD height (landscape) as % of H
const LEFT_FALLBACK_P = 0.22;       // fallback left cut (portrait)
const LEFT_FALLBACK_L = 0.18;       // fallback left cut (landscape)
const RIGHT_PAD_PC   = 0.02;        // small right pad
const TOP_EXTRA_PC   = 0.01;        // include a tiny extra above band
const BOT_KEEP_PC    = 0.00;        // keep full to bottom

function luminance(r,g,b){ return 0.2126*r + 0.7152*g + 0.0722*b; }

function movingAvg(arr, win){
  const out = new Array(arr.length).fill(0);
  let sum = 0;
  for (let i=0;i<arr.length;i++){
    sum += arr[i];
    if (i>=win) sum -= arr[i-win];
    out[i] = sum / Math.min(i+1, win);
  }
  return out;
}

function argMax(arr){
  let m = -Infinity, idx = -1;
  for (let i=0;i<arr.length;i++) if (arr[i] > m){ m = arr[i]; idx = i; }
  return idx;
}

async function cropHud(dataURL){
  const img = await loadImage(dataURL);
  const W   = img.naturalWidth  || img.width;
  const H   = img.naturalHeight || img.height;
  const portrait = H >= W;

  /* --- build analysis canvas (downsample) --- */
  const scale = Math.min(1, SCAN_TARGET_W / W);
  const aW = Math.round(W * scale);
  const aH = Math.round(H * scale);

  const a = document.createElement('canvas');
  a.width = aW; a.height = aH;
  const actx = a.getContext('2d', { willReadFrequently: true });
  actx.drawImage(img, 0, 0, aW, aH);

  const imgData = actx.getImageData(0, 0, aW, aH).data;

  /* --- row-wise luminance over bottom 60% --- */
  const startRow = Math.floor(aH * 0.40);
  const means = new Array(aH - startRow);

  for (let y = startRow; y < aH; y++){
    let sum = 0;
    const off = y * aW * 4;
    for (let x = 0; x < aW; x++){
      const i = off + x*4;
      sum += luminance(imgData[i], imgData[i+1], imgData[i+2]);
    }
    means[y - startRow] = sum / aW;
  }

  const sm = movingAvg(means, 5);
  const thr = DARK_THRESH; // constant works well for black strip

  // Find the darkest contiguous block that touches the bottom
  let yBottom = sm.length - 1;
  // walk up until we exit the dark band
  let y = yBottom;
  while (y >= 0 && sm[y] <= thr) y--;
  const yBandTop = y + 1; // first dark row from the top side inside band

  // In case the last rows aren’t fully dark (some watermarks), dilate a bit
  const bandHeight = (sm.length - yBandTop);
  const minBandPx  = Math.round((portrait ? MIN_BAND_PC_P : MIN_BAND_PC_L) * H * scale);

  let finalBandTop = yBandTop;
  if (bandHeight < minBandPx || finalBandTop < 0) {
    // Fallback: assume known ranges for GPS Map Camera HUD
    finalBandTop = Math.round(aH * (portrait ? 0.78 : 0.80));
  }

  // Map band top from analysis coords → original coords, add a little extra
  const cropTop = Math.max(0, Math.round(finalBandTop / scale) - Math.round(H * TOP_EXTRA_PC));
  const cropBottom = H; // keep to bottom
  const cropHeight = Math.max(1, cropBottom - cropTop);

  /* --- find left mini-map boundary within the HUD via vertical edges --- */
  const bandScanTop = Math.round((finalBandTop + 0.15 * (aH - finalBandTop)));
  const bandScanBot = Math.min(aH - 1, Math.round(finalBandTop + 0.85 * (aH - finalBandTop)));
  const scanColsMax = Math.round(aW * 0.5); // only left half is interesting

  // Edge score per column = sum |col(x+1) - col(x)|
  const colMean = (x) => {
    let s = 0;
    for (let yy = bandScanTop; yy <= bandScanBot; yy++){
      const i = (yy * aW + x) * 4;
      s += luminance(imgData[i], imgData[i+1], imgData[i+2]);
    }
    return s / (bandScanBot - bandScanTop + 1);
  };

  const edge = new Array(scanColsMax - 1);
  let prev = colMean(0);
  for (let x = 1; x < scanColsMax; x++){
    const cur = colMean(x);
    edge[x-1] = Math.abs(cur - prev);
    prev = cur;
  }

  let edgeIdx = argMax(edge);                    // location of strongest vertical boundary
  let leftCutFrac;
  if (edgeIdx > 8){                              // robust edge found
    const leftCutX = Math.round((edgeIdx + 8) / scale); // +8px margin (analysis space → original)
    leftCutFrac = leftCutX / W;
  } else {
    leftCutFrac = portrait ? LEFT_FALLBACK_P : LEFT_FALLBACK_L;
  }

  const leftCut = Math.max(0, Math.round(W * leftCutFrac));
  const rightPad = Math.round(W * RIGHT_PAD_PC);

  const sx = leftCut;
  const sy = cropTop;
  const sw = Math.max(1, W - leftCut - rightPad);
  const sh = cropHeight;

  // Draw crop
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  // Debug to console
  logToConsole('', { W, H, sx, sy, sw, sh, leftCutFrac: +leftCutFrac.toFixed(3) }, '[Smart HUD crop box]');

  return c.toDataURL('image/png');
}

/* ---------- Preprocess (light binarize/upscale) ---------- */
async function preprocessForOCR(cropDataURL){
  const src=await loadImage(cropDataURL);
  const w=src.naturalWidth, h=src.naturalHeight;

  // Keep entire cropped band (we already trimmed the map and found the HUD)
  const up=document.createElement('canvas');
  up.width=w*2; up.height=h*2;
  const uctx=up.getContext('2d');
  uctx.imageSmoothingEnabled=true;
  uctx.drawImage(src,0,0,up.width,up.height);

  let im = uctx.getImageData(0,0,up.width,up.height);
  const d=im.data;
  for(let i=0;i<d.length;i+=4){
    const y = (0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]);
    const v = y>135?255:0;             // binary for white text on black
    d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  uctx.putImageData(im,0,0);

  return up.toDataURL('image/png');
}

/* ---------- Drag & drop (macOS/Safari-safe) ---------- */
['dragover','drop'].forEach(ev =>
  window.addEventListener(ev, e => { e.preventDefault(); }, { passive:false })
);
function pickFileFromDataTransfer(dt){
  if (!dt) return null;
  if (dt.items && dt.items.length){
    for (const it of dt.items){
      if (it.kind === 'file'){
        const f = it.getAsFile();
        if (f && /^image\//i.test(f.type)) return f;
      }
    }
    for (const it of dt.items){
      if (it.kind === 'file'){
        const f = it.getAsFile();
        if (f) return f;
      }
    }
  }
  if (dt.files && dt.files.length){
    return [...dt.files].find(x=>/^image\//i.test(x.type)) || dt.files[0];
  }
  return null;
}
['dragenter','dragover'].forEach(t => dropArea?.addEventListener(t, e=>{
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  dropArea.classList.add('dragover');
}));
['dragleave','drop'].forEach(t => dropArea?.addEventListener(t, e=>{
  e.preventDefault();
  dropArea.classList.remove('dragover');
}));
dropArea?.addEventListener('click', ()=> fileInput?.click());
dropArea?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput?.click(); });
fileInput?.addEventListener('click', e => { e.target.value = ''; });
fileInput?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) acceptAndHandleFile(f); });
dropArea?.addEventListener('drop', e => { const f = pickFileFromDataTransfer(e.dataTransfer); if (f) acceptAndHandleFile(f); });

async function acceptAndHandleFile(file){
  const isHeic = /image\/hei[cf]|\.heic$/i.test(file.type) || /\.heic$/i.test(file.name || '');
  if (isHeic){ banner('HEIC detected. Please export as JPG/PNG.', 'error'); setPill('upload','err'); return; }
  if (!/^image\/(jpe?g|png|gif|bmp|webp)$/i.test(file.type)){
    banner('Please choose an image (JPG/PNG).', 'error'); setPill('upload','err'); return;
  }
  handleFile(file);
}

/* ---------- Main flow ---------- */
async function handleFile(file){
  if(!/^image\/(jpe?g|png)$/i.test(file.type)){ banner('Please choose a JPG or PNG.','error'); return; }

  resetOutputs();

  // Upload
  setPill('upload','run');
  const dataURL = await fileToDataURL(file);
  imgOriginal && (imgOriginal.src = dataURL);
  setPill('upload','ok');

  // Crop + Preprocess
  setPill('ocr','run');
  let cropURL=''; let processed='';
  try{
    cropURL = await cropHud(dataURL);          // << smart crop
    processed = await preprocessForOCR(cropURL);
    imgCrop && (imgCrop.src = processed);
  }catch(e){
    setPill('ocr','err'); banner('Crop/Preprocess failed.','error'); logToConsole('',{error:String(e)},'[Preprocess error]'); return;
  }

  // OCR
  if(!(window.Tesseract && Tesseract.recognize)){
    setPill('ocr','err'); banner('OCR engine not loaded (CDN).','error'); return;
  }
  let rawText='';
  try{
    const res = await Tesseract.recognize(
      processed,
      'eng',
      { logger:()=>{}, tessedit_pageseg_mode:6, tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:+.,/°- ' }
    );
    rawText = (res?.data?.text || '').trim();
    logToConsole(rawText, null, '[OCR complete]');
    setPill('ocr','ok');
  }catch(e){
    setPill('ocr','err'); banner('OCR failed. Try clearer photo.','error'); logToConsole('',{error:String(e)},'[OCR error]'); return;
  }

  // Parse
  setPill('parse','run');
  const parsed = parseHudText(rawText);
  logToConsole(rawText, parsed, '[Parse complete]');
  if(!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon) || !parsed.address){
    setPill('parse','err'); banner('Could not parse all fields from HUD.','error'); return;
  }
  setPill('parse','ok');

  // Show parsed values (raw)
  outDate && (outDate.textContent = parsed.date);
  outTime && (outTime.textContent = parsed.time);
  outLat  && (outLat.textContent  = parsed.lat.toFixed(6));
  outLon  && (outLon.textContent  = parsed.lon.toFixed(6));
  outAddr && (outAddr.textContent = parsed.address);

  // Geo
  setPill('geo','run');
  try{ await ensureGeo(); }catch{ setPill('geo','err'); banner('Failed to load GeoJSON.','error'); return; }
  const gj = geoLookup(parsed.lat, parsed.lon);
  if(!gj.ward || !gj.beat || !gj.ps){ setPill('geo','err'); banner('GeoJSON lookup failed.','error'); return; }
  outWard && (outWard.textContent = gj.ward);
  outBeat && (outBeat.textContent = gj.beat);
  outPS   && (outPS.textContent   = gj.ps);
  setPill('geo','ok');

  setPill('review','ok');

  // Normalize for prefill
  const { date: formDate, time: formTime } = normalizeFormRedirect(parsed.date, parsed.time);
  outDate && (outDate.textContent = formDate);
  outTime && (outTime.textContent = formTime);
  logToConsole('', {date: formDate, time: formTime}, '[Prefill normalized → YYYY-MM-DD + HH:mm]');

  // Build URL
  const url = new URL(FORM_BASE);
  url.searchParams.set(ENTRY.date, formDate);
  url.searchParams.set(ENTRY.time, formTime);
  url.searchParams.set(ENTRY.lat,  parsed.lat.toFixed(6));
  url.searchParams.set(ENTRY.lon,  parsed.lon.toFixed(6));
  url.searchParams.set(ENTRY.ward, gj.ward);
  url.searchParams.set(ENTRY.beat, gj.beat);
  url.searchParams.set(ENTRY.addr, parsed.address);
  url.searchParams.set(ENTRY.ps,   gj.ps);

  lastRedirectUrl = url.toString();

  try{
    setPill('redirect','run');
    window.open(lastRedirectUrl, '_blank', 'noopener');
    setPill('redirect','ok');
  }catch{
    setPill('redirect','err');
    banner('Auto-redirect blocked. Tap the Redirect pill to open.', 'error');
  }

  if (pills.redirect){
    pills.redirect.classList.add('pulse','ok');
    pills.redirect.onclick = () => { if (lastRedirectUrl) window.open(lastRedirectUrl, '_blank', 'noopener'); };
    pills.redirect.title = 'Open Google Form';
  }
}

/* ---------- Parsing (unchanged) ---------- */
function parseHudText(raw){
  let lines = raw.split(/\n/).map(s=>s.trim()).filter(Boolean);
  const locIdx = lines.findIndex(l => /(India|Maharashtra|Mumbai|Navi Mumbai)/i.test(l));
  if (locIdx > 0) lines = lines.slice(locIdx);
  if (lines.length < 3) return {};

  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];

  // Address above the last 2 lines
  let addr  = lines.slice(0, lines.length - 2).join(', ');
  addr = addr
    .replace(/GPS\s*Map\s*Camera/gi,' ')
    .replace(/\s*,\s*,+/g,', ')
    .replace(/\s{2,}/g,' ')
    .replace(/^[,\s]+|[,\s]+$/g,'')
    .trim();

  // Lat/Lon from prev line (primary)
  let lat = NaN, lon = NaN;
  const scrubPrev = prev.replace(/[|]/g,' ').replace(/°/g,' ').replace(/,\s*/g,' ');
  const m = scrubPrev.match(/(-?\d{1,2}\.\d+).+?(-?\d{1,3}\.\d+)/);
  if (m){ lat = parseFloat(m[1]); lon = parseFloat(m[2]); }

  // Fallback: scan whole raw
  if (isNaN(lat) || isNaN(lon)) {
    const allNums = (raw.match(/-?\d{1,3}\.\d+/g) || []).map(parseFloat);
    for (let i=0;i<allNums.length-1;i++){
      const a = allNums[i], b = allNums[i+1];
      const latLike = (a>=17 && a<=21), lonLike = (b>=72 && b<=75);
      if (latLike && lonLike){ lat=a; lon=b; break; }
    }
  }

  // Date & Time
  const pool = [last, `${prev} ${last}`];
  let date = '', time = '';
  for (const s of pool){
    if (!date){
      const m1 = s.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/);
      const m2 = s.match(/(\d{4}[\/-]\d{1,2}[\/-]\d{1,2})/);
      if (m1) date = m1[1]; else if (m2) date = m2[1];
    }
    if (!time){
      const t1 = s.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
      const t2 = s.match(/(\d{1,2}):(\d{2})(?!\s*[AP]M)/i);
      if (t1) time = `${t1[1]}:${t1[2]} ${t1[3].toUpperCase()}`;
      else if (t2) time = `${t2[1]}:${t2[2]}`;
    }
  }

  return { address: addr, lat, lon, date, time };
}

/* ---------- Prefill: YYYY-MM-DD & HH:mm (24h) ---------- */
function pad2(n){ return n<10 ? '0'+n : String(n); }
function normalizeFormRedirect(dateStr, timeStr){
  let yyyy, mm, dd;
  let m1 = (dateStr||'').match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  let m2 = (dateStr||'').match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (m1){ dd=+m1[1]; mm=+m1[2]; yyyy=+m1[3]; }
  else if (m2){ yyyy=+m2[1]; mm=+m2[2]; dd=+m2[3]; }
  const formDate = (yyyy && mm && dd) ? `${yyyy}-${pad2(mm)}-${pad2(dd)}` : (dateStr||'');

  let HH, Min;
  const t12 = (timeStr||'').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const t24 = (timeStr||'').match(/^(\d{1,2}):(\d{2})$/);
  if (t12){
    let h = +t12[1]; Min = t12[2]; const ap = t12[3].toUpperCase();
    if (ap === 'AM'){ HH = (h===12) ? 0 : h; }
    else { HH = (h===12) ? 12 : h+12; }
  } else if (t24){
    HH = +t24[1]; Min = t24[2];
  }
  const formTime = (HH!=null && Min!=null) ? `${pad2(HH)}:${Min}` : (timeStr||'');
  return { date: formDate, time: formTime };
}

/* ---------- Geo (same behavior) ---------- */
let gjB=null, gjP=null;
async function ensureGeo(){
  if(gjB && gjP) return;
  const [beats, police] = await Promise.all([
    fetch('data/beats.geojson').then(r=>{ if(!r.ok) throw new Error('beats.geojson'); return r.json(); }),
    fetch('data/police_jurisdiction.geojson').then(r=>{ if(!r.ok) throw new Error('police_jurisdiction.geojson'); return r.json(); })
  ]);
  gjB = beats; gjP = police;

  const geoBadge = $('geoBadge');
  if (geoBadge) {
    const ok = (gjB?.features?.length>0) && (gjP?.features?.length>0);
    geoBadge.className = `badge ${ ok ? 'badge-ok glow' : 'badge-err glow' }`;
    geoBadge.textContent = ok ? 'Geo: Ready' : 'Geo: Error';
  }
}
function inPoly(poly,[x,y]){
  let inside=false;
  for(const ring of poly){
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const xi=ring[i][0], yi=ring[i][1];
      const xj=ring[j][0], yj=ring[j][1];
      const intersect=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
      if(intersect) inside=!inside;
    }
  }
  return inside;
}
function geoLookup(lat, lon){
  const out = { ward:'', beat:'', ps:'' };
  if (!gjB || !gjP) return out;
  const pt = [lon, lat];
  const inG = (g) =>
    g?.type === 'Polygon' ? inPoly(g.coordinates, pt)
    : g?.type === 'MultiPolygon' ? g.coordinates.some(r => inPoly(r, pt))
    : false;

  for (const f of gjB.features) {
    if (inG(f.geometry)) {
      const p = f.properties || {};
      const wardRaw = p.WARD ?? p.WARD_NAME ?? p.ward ?? p.description ?? p.DESCRIPTION ?? p.NAME ?? p.name ?? '';
      let beatRaw = p.BEAT_NO ?? p.BEAT ?? p.beat ?? p.NAME ?? p.Name ?? p.name ?? '';
      if (!p.BEAT_NO && !p.BEAT && typeof beatRaw === 'string') {
        const m = beatRaw.match(/BEAT\s*\w+/i);
        if (m) beatRaw = m[0];
      }
      out.ward = String(wardRaw).trim();
      out.beat = String(beatRaw).trim();
      break;
    }
  }

  for (const f of gjP.features) {
    if (inG(f.geometry)) {
      const p = f.properties || {};
      out.ps = String(p.PS_NAME ?? p.NAME ?? p.name ?? p.police ?? '').trim();
      break;
    }
  }
  return out;
}

/* ---------- Console buttons ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const copyBtn = document.getElementById('consoleCopy');
  const toggleBtn = document.getElementById('consoleToggle');
  const pre = document.getElementById('console-pre');

  copyBtn?.addEventListener('click', () => {
    if (!pre) return;
    navigator.clipboard.writeText(pre.textContent || '').then(() => {
      banner('Console copied.', 'success'); setTimeout(()=>banner('', ''), 1200);
    });
  });

  toggleBtn?.addEventListener('click', () => {
    if (!pre) return;
    const hidden = pre.style.display === 'none';
    pre.style.display = hidden ? '' : 'none';
    toggleBtn.setAttribute('aria-expanded', String(hidden));
    toggleBtn.textContent = hidden ? 'Hide' : 'Show';
  });
});
