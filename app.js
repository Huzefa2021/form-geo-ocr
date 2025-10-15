/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.10.15.MODAL
   - Smart HUD v3 (footer anchor) + static fallback
   - Tunables via HUDCFG
   - Manual crop editor as a <dialog> modal (drag/resize)
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

/* ---------- Form mapping ---------- */
const FORM_BASE='https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url';
const ENTRY={date:'entry.1911996449',time:'entry.1421115881',lat:'entry.419288992',lon:'entry.113122688',ward:'entry.1625337207',beat:'entry.1058310891',addr:'entry.1188611077',ps:'entry.1555105834'};

/* ==========================================================
   CROP PIPELINE — tunables + smart + fallback
   ========================================================== */

/* ===== HUD CROP TUNABLES ===== */
const HUDCFG = {
  scanStartFrac: 0.72,     // start scanning for footer from 72% height
  minTopFrac:    0.56,     // crop won't start above 56% → more room below
  footerGapFrac: 0.006,    // keep at least 0.6% gap above footer

  hudFracPortrait:  0.31,  // target HUD band height
  hudFracLandscape: 0.29,

  mapCutPortrait:   0.185, // left minimap trims
  mapCutLandscape:  0.158,
  padLPortrait:     0.024,
  padLLandscape:    0.018,
  padRPortrait:     0.028,
  padRLandScape:    0.024,
  leftRelax:        0.050  // pull more from left (include first letters)
};

/* ---------- Static crop (backward compatibility) ---------- */
const STATIC_CROP={
  portrait:{ top:0.755,height:0.235,mapCut:0.205,pad:{top:0.020,bottom:0.018,left:0.028,right:0.024} },
  landscape:{ top:0.775,height:0.190,mapCut:0.185,pad:{top:0.016,bottom:0.014,left:0.022,right:0.020} }
};

/* Downscale huge images for consistent OCR performance */
async function resampleImage(dataURL, maxSide = 1600){
  const img = await loadImage(dataURL);
  const W = img.naturalWidth, H = img.naturalHeight;
  const side = Math.max(W, H);
  if (side <= maxSide) return dataURL;
  const k = maxSide / side;
  const w = Math.round(W * k), h = Math.round(H * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.92);
}

/* Old static crop */
async function cropHudStatic(dataURL){
  const img=await loadImage(dataURL);
  const W=img.naturalWidth, H=img.naturalHeight;
  const isPortrait=H>=W;
  const P=isPortrait?STATIC_CROP.portrait:STATIC_CROP.landscape;

  let sy=Math.floor(H*P.top);
  let sh=Math.floor(H*P.height);
  sy = Math.max(0, sy - Math.floor(H*P.pad.top));
  sh = Math.min(H - sy, sh + Math.floor(H*(P.pad.top + P.pad.bottom)));

  let sx=Math.floor(W*(P.mapCut + P.pad.left - HUDCFG.leftRelax));
  let sw=W - sx - Math.floor(W*P.pad.right);
  if (sx<0) sx=0;
  if (sy<0) sy=0;
  if (sx+sw>W) sw=W-sx;
  if (sy+sh>H) sh=H-sy;

  const c=document.createElement('canvas');
  c.width=sw; c.height=sh;
  c.getContext('2d').drawImage(img, sx,sy,sw,sh, 0,0,sw,sh);
  return c.toDataURL('image/png');
}

/* Smart HUD finder v3 — footer anchor + top-edge detection */
async function cropHudSmart(dataURL){
  const img = await loadImage(dataURL);
  const W = img.naturalWidth, H = img.naturalHeight;
  const isPortrait = H >= W;

  // 1) Locate the solid black footer in the bottom window
  const fromY = Math.floor(H * HUDCFG.scanStartFrac);
  const ch = H - fromY;

  const c = document.createElement('canvas');
  c.width = W; c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, -fromY);

  const means = new Float32Array(ch);
  for (let y = 0; y < ch; y++) {
    const row = ctx.getImageData(0, y, W, 1).data;
    let s = 0;
    for (let i = 0; i < row.length; i += 4) s += (row[i] + row[i+1] + row[i+2]) / 3;
    means[y] = s / (row.length / 4);
  }
  let gSum = 0; for (let i = 0; i < ch; i++) gSum += means[i];
  const gMean = gSum / Math.max(1, ch);
  const Tdark = Math.min(85, gMean - 45);

  let bestTop = -1, bestLen = 0, curTop = -1, curLen = 0;
  for (let y = 0; y < ch; y++){
    if (means[y] < Tdark){
      if (curTop < 0) curTop = y;
      curLen++;
    } else if (curLen){
      if (curLen >= 6 && (curTop + curLen) > ch * 0.70 && curLen >= bestLen){
        bestTop = curTop; bestLen = curLen;
      }
      curTop = -1; curLen = 0;
    }
  }
  if (curLen && curLen >= 6 && (curTop + curLen) > ch * 0.70 && curLen >= bestLen){
    bestTop = curTop; bestLen = curLen;
  }
  if (bestTop < 0) throw new Error('Footer not found');

  const footerTopY = fromY + bestTop;

  // 2) Find strong bright→dark edge above footer (HUD top)
  const deriv = new Float32Array(ch);
  for (let y = 1; y < ch; y++) deriv[y] = means[y] - means[y-1];
  const searchStart = Math.max(0, bestTop - Math.floor(H * 0.18));

  let localMin = {y: bestTop, v: 0};
  for (let y = bestTop; y >= searchStart; y--){
    if (deriv[y] < localMin.v) localMin = {y, v: deriv[y]};
  }
  const TOP_EDGE_BOOST = Math.floor(H * 0.015);
  let hudTopY = fromY + Math.max(0, localMin.y - TOP_EDGE_BOOST);

  // Safety: don’t go above minTopFrac
  if (hudTopY < Math.floor(H * HUDCFG.minTopFrac)) hudTopY = Math.floor(H * HUDCFG.minTopFrac);

  // 3) Build crop band just above footer with a fixed gap
  const footGap = Math.floor(H * HUDCFG.footerGapFrac);
  const hudBottomY = Math.max(footerTopY - footGap, hudTopY + 1);

  const HUD_FRAC = isPortrait ? HUDCFG.hudFracPortrait : HUDCFG.hudFracLandscape;
  let sh = Math.floor(H * HUD_FRAC);
  const MIN_EXTRA = Math.floor(H * 0.01);
  sh = Math.min(sh, Math.max(8, (hudBottomY - hudTopY) + MIN_EXTRA));

  let sy = hudTopY;

  // 4) Horizontal trims (skip minimap & add padding)
  const mapCut = isPortrait ? HUDCFG.mapCutPortrait : HUDCFG.mapCutLandscape;
  const padL   = isPortrait ? HUDCFG.padLPortrait   : HUDCFG.padLLandscape;
  const padR   = isPortrait ? HUDCFG.padRPortrait   : HUDCFG.padRLandScape;

  let sx = Math.floor(W * (mapCut + padL - HUDCFG.leftRelax));
  let sw = W - sx - Math.floor(W * padR);

  // 5) Clamp & draw
  sx = Math.max(0, Math.min(sx, W - 1));
  sy = Math.max(0, Math.min(sy, H - 1));
  sw = Math.max(1, Math.min(sw, W - sx));
  sh = Math.max(1, Math.min(sh, H - sy));

  // Save rect for Manual Editor (natural px)
  mc.imgW = W; mc.imgH = H; mc.autoRect = { x: sx, y: sy, w: sw, h: sh };

  const out = document.createElement('canvas');
  out.width = sw; out.height = sh;
  out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL('image/png');
}

/* Unified crop: smart first → static fallback */
async function cropHud(dataURL){
  try { return await cropHudSmart(dataURL); }
  catch { return await cropHudStatic(dataURL); }
}

/* ---------- Preprocess (light, adaptive) ---------- */
async function preprocessForOCR(cropDataURL){
  const src=await loadImage(cropDataURL);
  const w=src.naturalWidth, h=src.naturalHeight;

  const cutTop    = Math.floor(h*0.12); // preserve more top
  const cutBottom = Math.floor(h*0.01); // preserve bottom/date line
  const h2=h - cutTop - cutBottom;

  const c=document.createElement('canvas');
  c.width=w; c.height=h2;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(src, 0, -cutTop, w, h);

  // ×3 upsample
  const up=document.createElement('canvas');
  up.width=c.width*3; up.height=c.height*3;
  const uctx=up.getContext('2d');
  uctx.imageSmoothingEnabled=true;
  uctx.drawImage(c,0,0,up.width,up.height);

  // Adaptive binarization around mean
  let im = uctx.getImageData(0,0,up.width,up.height);
  const d=im.data;
  let sum = 0, npx = (d.length/4)|0;
  for (let i=0;i<d.length;i+=4){ sum += (d[i]+d[i+1]+d[i+2])/3; }
  const mean = sum / Math.max(1, npx);
  const T = Math.min(200, Math.max(120, mean + 5));

  for(let i=0;i<d.length;i+=4){
    const v = (d[i]+d[i+1]+d[i+2])/3 < T ? 0 : 255;
    d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  uctx.putImageData(im,0,0);

  return up.toDataURL('image/png');
}

/* ---------- Drag & drop (macOS/Safari-safe) ---------- */

// Stop navigation on drop anywhere
['dragover','drop'].forEach(ev =>
  window.addEventListener(ev, e => { e.preventDefault(); }, { passive:false })
);

// Extract a File from DataTransfer
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

// Visual affordances
['dragenter','dragover'].forEach(t => dropArea?.addEventListener(t, e=>{
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  dropArea.classList.add('dragover');
}));
['dragleave','drop'].forEach(t => dropArea?.addEventListener(t, e=>{
  e.preventDefault();
  dropArea.classList.remove('dragover');
}));

// File picker
dropArea?.addEventListener('click', ()=> fileInput?.click());
dropArea?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') fileInput?.click();
});
fileInput?.addEventListener('click', e => { e.target.value = ''; });

// Handle chooser
fileInput?.addEventListener('change', e => {
  const f = e.target.files?.[0];
  if (f) acceptAndHandleFile(f);
});

// Handle drop
dropArea?.addEventListener('drop', e => {
  const f = pickFileFromDataTransfer(e.dataTransfer);
  if (f) acceptAndHandleFile(f);
});

// HEIC guard + proceed
async function acceptAndHandleFile(file){
  const isHeic = /image\/hei[cf]|\.heic$/i.test(file.type) || /\.heic$/i.test(file.name || '');
  if (isHeic){
    banner('HEIC detected. Please export as JPG/PNG from Photos or change camera format (Most Compatible).', 'error');
    setPill('upload', 'err');
    return;
  }
  if (!/^image\/(jpe?g|png|gif|bmp|webp)$/i.test(file.type)){
    banner('Please choose an image (JPG/PNG).', 'error');
    setPill('upload', 'err');
    return;
  }
  handleFile(file);
}

/* ---------- Main flow ---------- */
async function handleFile(file){
  if(!/^image\/(jpe?g|png)$/i.test(file.type)){ banner('Please choose a JPG or PNG.','error'); return; }

  resetOutputs();

  // Upload
  setPill('upload','run');
  let dataURL = await fileToDataURL(file);
  dataURL = await resampleImage(dataURL, 1600);   // downscale huge images safely
  imgOriginal && (imgOriginal.src = dataURL);
  setPill('upload','ok');
  mc.imgURL = dataURL; // for manual editor

  // Crop + Preprocess
  setPill('ocr','run');
  let cropURL=''; let processed='';
  try{
    cropURL = await cropHud(dataURL);             // smart → fallback to static
    processed = await preprocessForOCR(cropURL);
    imgCrop && (imgCrop.src = processed);
    const btn = document.getElementById('openManual');
    if (btn) btn.style.display = 'inline-flex';
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

/* ---------- Parsing ---------- */
function parseHudText(raw){
  let lines = raw.split(/\n/).map(s=>s.trim()).filter(Boolean);

  const locIdx = lines.findIndex(l => /(India|Maharashtra|Mumbai|Navi Mumbai)/i.test(l));
  if (locIdx > 0) lines = lines.slice(locIdx);
  if (lines.length < 3) return {};

  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];

  let addr  = lines.slice(0, lines.length - 2).join(', ');
  addr = addr
    .replace(/GPS\s*Map\s*Camera/gi,' ')
    .replace(/\s*,\s*,+/g,', ')
    .replace(/\s{2,}/g,' ')
    .replace(/^[,\s]+|[,\s]+$/g,'')
    .trim();

  let lat = NaN, lon = NaN;
  const scrubPrev = prev.replace(/[|]/g,' ').replace(/°/g,' ').replace(/,\s*/g,' ');
  const m = scrubPrev.match(/(-?\d{1,2}\.\d+).+?(-?\d{1,3}\.\d+)/);
  if (m){ lat = parseFloat(m[1]); lon = parseFloat(m[2]); }

  if (isNaN(lat) || isNaN(lon)) {
    const allNums = (raw.match(/-?\d{1,3}\.\d+/g) || []).map(parseFloat);
    for (let i=0;i<allNums.length-1;i++){
      const a = allNums[i], b = allNums[i+1];
      const latLike = (a>=17 && a<=21), lonLike = (b>=72 && b<=75);
      if (latLike && lonLike){ lat=a; lon=b; break; }
    }
  }

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

/* ---------- Geo (Beats+Ward merged, Police separate) ---------- */
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

/* Point-in-polygon (ray casting) */
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

/* ---------- Manual Crop Editor (modal) ---------- */
let mc = {
  enabled: false,
  imgURL: '',
  imgW: 0, imgH: 0,          // natural image size
  viewW: 0, viewH: 0,        // displayed image size in modal
  scale: 1,                  // uniform scale
  rect: { x:0, y:0, w:100, h:100 },   // in natural px
  autoRect: null
};

const openManualBtn = document.getElementById('openManual'); // styled like console buttons (toolbtn)
const dialogEl  = document.getElementById('manualDialog');
const stageEl   = document.getElementById('mcStage');
const canvasEl  = document.getElementById('mcCanvas'); // wrapper sized to rendered image
const imgEl     = document.getElementById('mcImg');
const boxEl     = document.getElementById('mcBox');
const mcApply   = document.getElementById('mcApply');
const mcCancel  = document.getElementById('mcCancel');
const mcReset   = document.getElementById('mcReset');

function openManualEditor(){
  if (!mc.imgURL || !mc.autoRect) { banner('No crop available to adjust yet.', 'error'); return; }

  dialogEl.showModal();

  imgEl.onload = () => {
    const rW = imgEl.naturalWidth, rH = imgEl.naturalHeight;

    const maxW = Math.min(stageEl.clientWidth - 24, 1600);
    const maxH = Math.min(stageEl.clientHeight - 24, 900);

    let scale = maxW / rW;
    if (rH * scale > maxH) scale = maxH / rH;

    const vw = Math.max(1, Math.round(rW * scale));
    const vh = Math.max(1, Math.round(rH * scale));

    canvasEl.style.width  = vw + 'px';
    canvasEl.style.height = vh + 'px';
    imgEl.style.width     = vw + 'px';
    imgEl.style.height    = vh + 'px';

    mc.imgW = rW; mc.imgH = rH; mc.viewW = vw; mc.viewH = vh; mc.scale = scale;

    mc.rect = clampRect({ ...mc.autoRect });
    requestAnimationFrame(drawMcBox);
  };

  imgEl.src = mc.imgURL;
  mc.enabled = true;
  attachMcEvents();
}

function closeManualEditor(){
  mc.enabled = false;
  detachMcEvents();
  dialogEl.close();
}

function drawMcBox(){
  const vx = mc.rect.x * mc.scale;
  const vy = mc.rect.y * mc.scale;
  const vw = mc.rect.w * mc.scale;
  const vh = mc.rect.h * mc.scale;
  boxEl.style.left   = `${vx}px`;
  boxEl.style.top    = `${vy}px`;
  boxEl.style.width  = `${vw}px`;
  boxEl.style.height = `${vh}px`;
}

function clampRect(r){
  r.x = Math.max(0, Math.min(r.x, mc.imgW - 1));
  r.y = Math.max(0, Math.min(r.y, mc.imgH - 1));
  r.w = Math.max(8, Math.min(r.w, mc.imgW - r.x));
  r.h = Math.max(8, Math.min(r.h, mc.imgH - r.y));
  return r;
}

async function applyManualSelection(){
  const c = document.createElement('canvas');
  c.width = mc.rect.w; c.height = mc.rect.h;
  const ctx = c.getContext('2d');
  const img = new Image();
  img.onload = async () => {
    ctx.drawImage(img, mc.rect.x, mc.rect.y, mc.rect.w, mc.rect.h, 0, 0, mc.rect.w, mc.rect.h);
    const manualCropURL = c.toDataURL('image/png');

    try{
      const processed = await preprocessForOCR(manualCropURL);
      imgCrop && (imgCrop.src = processed);

      const res = await Tesseract.recognize(
        processed,
        'eng',
        { logger:()=>{}, tessedit_pageseg_mode:6, tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:+.,/°- ' }
      );
      const rawText = (res?.data?.text || '').trim();
      logToConsole(rawText, null, '[OCR complete (manual)]');

      setPill('ocr','ok');
      setPill('parse','run');
      const parsed = parseHudText(rawText);
      logToConsole(rawText, parsed, '[Parse complete (manual)]');

      if(!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon) || !parsed.address){
        setPill('parse','err'); banner('Could not parse all fields from adjusted crop.', 'error'); return;
      }
      setPill('parse','ok');

      outDate && (outDate.textContent = parsed.date);
      outTime && (outTime.textContent = parsed.time);
      outLat  && (outLat.textContent  = parsed.lat.toFixed(6));
      outLon  && (outLon.textContent  = parsed.lon.toFixed(6));
      outAddr && (outAddr.textContent = parsed.address);

      setPill('geo','run');
      try{ await ensureGeo(); }catch{ setPill('geo','err'); banner('Failed to load GeoJSON.','error'); return; }
      const gj = geoLookup(parsed.lat, parsed.lon);
      if(!gj.ward || !gj.beat || !gj.ps){ setPill('geo','err'); banner('GeoJSON lookup failed.', 'error'); return; }
      outWard && (outWard.textContent = gj.ward);
      outBeat && (outBeat.textContent = gj.beat);
      outPS   && (outPS.textContent   = gj.ps);
      setPill('geo','ok'); setPill('review','ok');

      const { date: formDate, time: formTime } = normalizeFormRedirect(parsed.date, parsed.time);
      outDate && (outDate.textContent = formDate);
      outTime && (outTime.textContent = formTime);

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
    }catch(e){
      banner('Manual crop failed.', 'error');
      console.error(e);
    } finally {
      closeManualEditor();
    }
  };
  img.src = mc.imgURL;
}

/* Drag / Resize controls */
let drag = null; // {mode, startX, startY, rect0}
function attachMcEvents(){
  boxEl.addEventListener('mousedown', onBoxMouseDown);
  canvasEl.addEventListener('mousedown', onHandleDown, true);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  boxEl.addEventListener('keydown', onBoxKey);
  mcApply.addEventListener('click', applyManualSelection);
  mcCancel.addEventListener('click', closeManualEditor);
  mcReset.addEventListener('click', ()=>{ mc.rect = clampRect({ ...mc.autoRect }); drawMcBox(); });
}
function detachMcEvents(){
  boxEl.removeEventListener('mousedown', onBoxMouseDown);
  canvasEl.removeEventListener('mousedown', onHandleDown, true);
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  boxEl.removeEventListener('keydown', onBoxKey);
  mcApply.removeEventListener('click', applyManualSelection);
  mcCancel.removeEventListener('click', closeManualEditor);
  mcReset.removeEventListener('click', ()=>{});
}
function toCanvasCoords(evt){
  const r = canvasEl.getBoundingClientRect();
  return { x: (evt.clientX - r.left) / mc.scale, y: (evt.clientY - r.top) / mc.scale };
}
function onBoxMouseDown(e){
  if ((e.target).classList.contains('mc-h')) return;
  e.preventDefault();
  const p = toCanvasCoords(e);
  drag = { mode:'move', startX:p.x, startY:p.y, rect0:{...mc.rect} };
}
function onHandleDown(e){
  const t = e.target;
  if (!t.classList.contains('mc-h')) return;
  e.preventDefault();
  const p = toCanvasCoords(e);
  drag = { mode:t.dataset.dir, startX:p.x, startY:p.y, rect0:{...mc.rect} };
}
function onMouseMove(e){
  if (!drag) return;
  const p = toCanvasCoords(e);
  const dx = p.x - drag.startX;
  const dy = p.y - drag.startY;
  let r = { ...drag.rect0 };

  if (drag.mode === 'move'){
    r.x += dx; r.y += dy;
  } else {
    if (drag.mode.includes('w')) { r.x += dx; r.w -= dx; }
    if (drag.mode.includes('n')) { r.y += dy; r.h -= dy; }
    if (drag.mode.includes('e')) { r.w += dx; }
    if (drag.mode.includes('s')) { r.h += dy; }
  }
  mc.rect = clampRect(r);
  drawMcBox();
}
function onMouseUp(){ drag = null; }
function onBoxKey(e){
  const step = (e.shiftKey ? 10 : 1);
  let r = { ...mc.rect };
  if (e.key === 'ArrowLeft')  r.x -= step;
  if (e.key === 'ArrowRight') r.x += step;
  if (e.key === 'ArrowUp')    r.y -= step;
  if (e.key === 'ArrowDown')  r.y += step;
  mc.rect = clampRect(r);
  drawMcBox();
}

/* ---------- Console buttons & manual open ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const copyBtn = document.getElementById('consoleCopy');
  const toggleBtn = document.getElementById('consoleToggle');
  const pre = document.getElementById('console-pre');

  copyBtn?.addEventListener('click', () => {
    if (!pre) return;
    navigator.clipboard.writeText(pre.textContent || '').then(() => {
      banner('Console copied.', 'success');
      setTimeout(()=>banner('', ''), 1200);
    });
  });

  toggleBtn?.addEventListener('click', () => {
    if (!pre) return;
    const hidden = pre.style.display === 'none';
    pre.style.display = hidden ? '' : 'none';
    toggleBtn.setAttribute('aria-expanded', String(hidden));
    toggleBtn.textContent = hidden ? 'Hide' : 'Show';
  });

  document.getElementById('openManual')?.addEventListener('click', openManualEditor);
});
