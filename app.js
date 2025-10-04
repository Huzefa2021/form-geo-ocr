/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.09.25.M1
   - Single GeoJSON for Beats that also contains Ward info
   - Police jurisdiction GeoJSON kept separate
   - Robust OCR + parsing + prefill normalization
   - new ocr engine
   ========================================================== */

const $ = (id) => document.getElementById(id);

/* ---------- OCR Engine Toggle ---------- */
// If you want OCR.Space, set true and put your key below
const USE_OCR_SPACE = true;
// ← (Optional) drop your key here; or keep empty and read from env/secret manager
const OCR_SPACE_API_KEY = 'K86010114388957'; // provided earlier; replace if needed

/* ---------- Google Form Mapping ---------- */
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

const geoBadge = $('geoBadge');
function setGeoBadge(state){
  if (!geoBadge) return;
  if (state === 'ok') { geoBadge.textContent = 'Geo: Loaded'; geoBadge.className = 'badge badge-ok glow'; }
  else if (state === 'err') { geoBadge.textContent = 'Geo: Error'; geoBadge.className = 'badge badge-err glow'; }
  else { geoBadge.textContent = 'Geo: Loading…'; geoBadge.className = 'badge badge-warn glow'; }
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

/* ---------- Static HUD Crop (relaxed left) ---------- */
const STATIC_CROP={
  portrait:{ top:0.755,height:0.235,mapCut:0.205,pad:{top:0.020,bottom:0.018,left:0.028,right:0.024} },
  landscape:{ top:0.775,height:0.190,mapCut:0.185,pad:{top:0.016,bottom:0.014,left:0.022,right:0.020} }
};
const LEFT_RELAX = 0.030;

async function cropHud(dataURL){
  const img=await loadImage(dataURL);
  const W=img.naturalWidth, H=img.naturalHeight;
  const isPortrait=H>=W;
  const P=isPortrait?STATIC_CROP.portrait:STATIC_CROP.landscape;

  let sy=Math.floor(H*P.top);
  let sh=Math.floor(H*P.height);
  sy = Math.max(0, sy - Math.floor(H*P.pad.top));
  sh = Math.min(H - sy, sh + Math.floor(H*(P.pad.top + P.pad.bottom)));

  let sx=Math.floor(W*(P.mapCut + P.pad.left - LEFT_RELAX));
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

/* ---------- Light Preprocess for OCR ---------- */
async function preprocessForOCR(cropDataURL){
  const src=await loadImage(cropDataURL);
  const w=src.naturalWidth, h=src.naturalHeight;

  const cutTop=Math.floor(h*0.18);
  const cutBottom=Math.floor(h*0.04);
  const h2=h - cutTop - cutBottom;

  const c=document.createElement('canvas');
  c.width=w; c.height=h2;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(src, 0, -cutTop, w, h);

  // Upscale x3 then hard threshold to emphasize HUD glyphs
  const up=document.createElement('canvas');
  up.width=c.width*3; up.height=c.height*3;
  const uctx=up.getContext('2d');
  uctx.imageSmoothingEnabled=true;
  uctx.drawImage(c,0,0,up.width,up.height);

  let im = uctx.getImageData(0,0,up.width,up.height);
  const d=im.data;
  for(let i=0;i<d.length;i+=4){
    const avg=(d[i]+d[i+1]+d[i+2])/3;
    const v = avg>140?255:0;   // white text on black bg
    d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  uctx.putImageData(im,0,0);

  return up.toDataURL('image/png');
}

/* ---------- Drag & Drop ---------- */
dropArea?.addEventListener('click',()=>fileInput?.click());
dropArea?.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' ') fileInput?.click(); });
fileInput?.addEventListener('click',e=>{ e.target.value=''; });
fileInput?.addEventListener('change',e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); });
['dragenter','dragover'].forEach(t=> dropArea?.addEventListener(t, e=>{ e.preventDefault(); dropArea.classList.add('dragover'); }));
['dragleave','drop'].forEach(t=> dropArea?.addEventListener(t, e=>{ e.preventDefault(); dropArea.classList.remove('dragover'); }));
dropArea?.addEventListener('drop', e=>{
  const f=[...(e.dataTransfer?.files||[])].find(x=>/^image\//i.test(x.type));
  if (f) handleFile(f);
});
$('btnReset')?.addEventListener('click',()=> location.reload());

/* ---------- Main Flow ---------- */
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
    cropURL = await cropHud(dataURL);
    processed = await preprocessForOCR(cropURL);
    imgCrop && (imgCrop.src = processed);
  }catch(e){
    setPill('ocr','err'); banner('Crop/Preprocess failed.','error'); logToConsole('',{error:String(e)},'[Preprocess error]'); return;
  }

  // OCR (OCR.Space preferred; fallback Tesseract if toggled)
  let rawText='';
  try{
    if (USE_OCR_SPACE) {
      const resp = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: { 'apikey': OCR_SPACE_API_KEY },
        body: new URLSearchParams({
          base64Image: processed,
          language: 'eng+hin+mar',
          isOverlayRequired: 'false',
          scale: 'true',
          OCREngine: '3'
        })
      });
      const data = await resp.json();
      rawText = data?.ParsedResults?.[0]?.ParsedText?.trim() || '';
      if (!rawText) throw new Error('OCR.Space returned empty text');
      logToConsole(rawText, null, '[OCR.Space complete]');
    } else {
      if(!(window.Tesseract && Tesseract.recognize)) throw new Error('Tesseract not loaded');
      const res = await Tesseract.recognize(processed,'eng+hin+mar',{ logger:()=>{}, tessedit_pageseg_mode:6 });
      rawText = (res?.data?.text || '').trim();
      logToConsole(rawText, null, '[Tesseract complete]');
    }
    setPill('ocr','ok');
  }catch(e){
    setPill('ocr','err'); banner('OCR failed. Check API key/network or try again.','error'); logToConsole('',{error:String(e)},'[OCR error]'); return;
  }

  // Parse
  setPill('parse','run');
  const parsed = parseHudText(rawText);
  logToConsole(rawText, parsed, '[Parse complete]');
  if(!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon) || !parsed.address){
    setPill('parse','err'); banner('Could not parse all fields from HUD.','error'); return;
  }
  setPill('parse','ok');

  // Show raw parsed
  outDate && (outDate.textContent = parsed.date);
  outTime && (outTime.textContent = parsed.time);
  outLat  && (outLat.textContent  = parsed.lat.toFixed(6));
  outLon  && (outLon.textContent  = parsed.lon.toFixed(6));
  outAddr && (outAddr.textContent = parsed.address);

  // Geo (Beats with Ward inside + Police)
  setPill('geo','run');
  try{ await ensureGeo(); }catch{ setPill('geo','err'); banner('Failed to load GeoJSON.','error'); setGeoBadge('err'); return; }
  const gj = geoLookup(parsed.lat, parsed.lon);
  if(!gj.ward || !gj.beat || !gj.ps){ setPill('geo','err'); banner('GeoJSON lookup failed.','error'); return; }
  outWard && (outWard.textContent = gj.ward);
  outBeat && (outBeat.textContent = gj.beat);
  outPS   && (outPS.textContent   = gj.ps);
  setPill('geo','ok');

  setPill('review','ok');

  // Normalize to Google Form formats
  const { date: formDate, time: formTime } = normalizeFormRedirect(parsed.date, parsed.time);
  outDate && (outDate.textContent = formDate);
  outTime && (outTime.textContent = formTime);
  logToConsole('', {date: formDate, time: formTime}, '[Prefill normalized → YYYY-MM-DD + HH:mm]');

  // Build redirect URL
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

  // Make Redirect pill clickable + pulse
  if (pills.redirect){
    pills.redirect.classList.add('pulse','ok');
    pills.redirect.onclick = () => { if (lastRedirectUrl) window.open(lastRedirectUrl, '_blank', 'noopener'); };
    pills.redirect.title = 'Open Google Form';
  }
}

/* ---------- Parsing ---------- */
function parseHudText(raw){
  let lines = raw.split(/\n/).map(s=>s.trim()).filter(Boolean);

  // Start near a likely location line to drop app branding noise
  const locIdx = lines.findIndex(l => /(India|Maharashtra|Mumbai|Navi Mumbai)/i.test(l));
  if (locIdx > 0) lines = lines.slice(locIdx);
  if (lines.length < 3) return {};

  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];

  // Address is everything above the last 2 lines
  let addr  = lines.slice(0, lines.length - 2).join(', ');
  addr = addr
    .replace(/GPS\s*Map\s*Camera/gi,' ')
    .replace(/\s*,\s*,+/g,', ')
    .replace(/\s{2,}/g,' ')
    .replace(/^[,\s]+|[,\s]+$/g,'')
    .trim();

  // Lat/Lon primary attempt from the second-last line
  let lat = NaN, lon = NaN;
  const scrubPrev = prev.replace(/[|]/g,' ').replace(/°/g,' ').replace(/,\s*/g,' ');
  const m = scrubPrev.match(/(-?\d{1,2}\.\d+).+?(-?\d{1,3}\.\d+)/);
  if (m){ lat = parseFloat(m[1]); lon = parseFloat(m[2]); }

  // Fallback: scan entire raw for two decimals in Mumbai-ish bounds
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
      const m1 = s.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/); // dd/mm/yyyy
      const m2 = s.match(/(\d{4}[\/-]\d{1,2}[\/-]\d{1,2})/); // yyyy-mm-dd
      if (m1) date = m1[1]; else if (m2) date = m2[1];
    }
    if (!time){
      const t1 = s.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);   // 12h
      const t2 = s.match(/(\d{1,2}):(\d{2})(?!\s*[AP]M)/i); // 24h
      if (t1) time = `${t1[1]}:${t1[2]} ${t1[3].toUpperCase()}`;
      else if (t2) time = `${t2[1]}:${t2[2]}`;
    }
  }

  return { address: addr, lat, lon, date, time };
}

/* ---------- Prefill Normalization ---------- */
function pad2(n){ return n<10 ? '0'+n : String(n); }
function normalizeFormRedirect(dateStr, timeStr){
  // DATE
  let yyyy, mm, dd;
  let m1 = (dateStr||'').match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); // dd/mm/yyyy
  let m2 = (dateStr||'').match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/); // yyyy-mm-dd
  if (m1){ dd=+m1[1]; mm=+m1[2]; yyyy=+m1[3]; }
  else if (m2){ yyyy=+m2[1]; mm=+m2[2]; dd=+m2[3]; }
  const formDate = (yyyy && mm && dd) ? `${yyyy}-${pad2(mm)}-${pad2(dd)}` : (dateStr||'');

  // TIME
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

/* ---------- Geo (Beats with Ward inside + Police) ---------- */
let gjB=null, gjP=null;

async function ensureGeo(){
  if (gjB && gjP) return;
  try{
    setGeoBadge('load');
    // Beats with Ward properties (e.g., BEAT_NO & WARD inside one file)
    // Keep the filename the same as your deployed dataset:
    // - beats.geojson  (must include Ward attribute)
    // - police_jurisdiction.geojson
    const [b, p] = await Promise.all([
      fetch('data/beats.geojson').then(r=>r.json()),
      fetch('data/police_jurisdiction.geojson').then(r=>r.json()),
    ]);
    gjB = b; gjP = p;
    if (gjB?.features && gjP?.features) setGeoBadge('ok'); else setGeoBadge('err');
  }catch(e){
    console.error('Geo load error:', e);
    setGeoBadge('err');
    throw e;
  }
}

// Haversine distance (m)
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// point to segment distance in meters (approx)
function pointToSegmentDistMeters(px, py, ax, ay, bx, by) {
  const m = 111320;
  const APx = (px - ax) * m, APy = (py - ay) * m;
  const ABx = (bx - ax) * m, ABy = (by - ay) * m;
  const ab2 = ABx*ABx + ABy*ABy || 1e-9;
  let t = (APx*ABx + APy*ABy) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + (ABx/m) * t, cy = ay + (ABy/m) * t;
  return haversineMeters(py, px, cy, cx);
}

// edge-aware point-in-polygon
function pointInPolyEdgeAware(rings, ptLonLat, epsMeters = 2) {
  const [x, y] = ptLonLat; // lon, lat
  let inside = false;
  for (const ring of rings) {
    // Edge tolerance
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      if (pointToSegmentDistMeters(x, y, x1, y1, x2, y2) <= epsMeters) return true;
    }
    // Ray cast
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
                        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

function propOr(obj, keys, fallback=''){
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  return fallback;
}

function geoLookup(lat, lon){
  const out = { ward:'', beat:'', ps:'' };
  if (!gjB || !gjP) return out;

  const pt = [lon, lat];
  const inG = (g) =>
    g?.type === 'Polygon' ? pointInPolyEdgeAware(g.coordinates, pt)
    : g?.type === 'MultiPolygon' ? g.coordinates.some(r => pointInPolyEdgeAware(r, pt))
    : false;

  // Beats (with Ward info within properties)
  let beatFeat = gjB.features.find(f => inG(f.geometry));
  // Police
  let psFeat = gjP.features.find(f => inG(f.geometry));

  // Fallback to nearest within 100 m if needed (handles slivers/edge cases)
  function nearestFeature(feats) {
    let best=null, bestD=Infinity;
    for (const f of feats) {
      const g=f.geometry; if(!g) continue;
      let cx=0, cy=0, n=0;
      if (g.type==='Polygon') {
        for (const p of g.coordinates[0]) { cx+=p[0]; cy+=p[1]; n++; }
      } else if (g.type==='MultiPolygon') {
        for (const ring of g.coordinates[0]) {
          for (const p of ring) { cx+=p[0]; cy+=p[1]; n++; }
        }
      }
      if (!n) continue; cx/=n; cy/=n;
      const d = haversineMeters(lat, lon, cy, cx);
      if (d<bestD) { best=f; bestD=d; }
    }
    return (bestD<=100)?best:null;
  }

  if (!beatFeat) beatFeat = nearestFeature(gjB.features);
  if (!psFeat)   psFeat   = nearestFeature(gjP.features);

  const beatProps = beatFeat?.properties || {};
  out.beat = propOr(beatProps, ['BEAT_NO','BEAT','Beat','Beat_No','BeatNo','BEATNUMBER']);
  // Ward comes from the same beat feature’s properties
  out.ward = propOr(beatProps, ['WARD','WARD_NO','Ward','Ward_No','Ward_Name','WARDNAME']);

  const psProps = psFeat?.properties || {};
  out.ps   = propOr(psProps, ['PS_NAME','PS','Police_Station','PSName','NAME','name']);

  return out;
}

/* ---------- Manual Redirect (fallback) ---------- */
function addManualRedirect(url){
  let btn=document.getElementById('manualRedirect');
  if(btn) return;
  btn=document.createElement('button');
  btn.id='manualRedirect';
  btn.className='btn btn-primary';
  btn.style.marginTop='10px';
  btn.textContent='Open Google Form';
  btn.onclick=()=> window.open(url,'_blank','noopener');
  const box = document.getElementById('console-box');
  if (box) box.parentNode.insertBefore(btn, box.nextSibling);
}

/* ==========================================================
   END: all wiring is compatible with existing index/styles
   ========================================================== */
