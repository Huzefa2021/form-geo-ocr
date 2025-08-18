/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.08.19.P.2.2
   Notes:
   - Keeps existing stable flow & UI
   - Normalizes date & time for Google Form prefill:
     • Date -> dd/MM/yyyy
     • Time -> hh:mm AM/PM (12‑hour)
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

/* ---------- Badges ---------- */
function updateCdnBadge(){
  const b = $('cdnBadge'); if(!b) return;
  const ok = !!(window.Tesseract && Tesseract.recognize);
  b.textContent = ok ? 'CDN: v5 (Loaded)' : 'CDN: v5 (Not Loaded)';
  b.classList.remove('badge-info','badge-err','badge-ok','badge-warn');
  b.classList.add(ok ? 'badge-ok' : 'badge-err');
}
document.addEventListener('DOMContentLoaded', updateCdnBadge);
window.addEventListener('load', updateCdnBadge);

/* ---------- Helpers ---------- */
function setPill(name, state){
  const p = pills[name]; if(!p) return;
  p.classList.remove('ok','run','err');
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
}
function fileToDataURL(f){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(f); }); }
function loadImage(url){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=url; }); }

/* ---------- Console ---------- */
function ensureConsoleBox(){ return $('console-box'); }
function logToConsole(rawText, parsed, note=''){
  const box = ensureConsoleBox();
  const pre = $('console-pre');
  if (!box || !pre) return;
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

/* ---------- Static crop presets (unchanged) ---------- */
const STATIC_CROP={
  portrait:{ top:0.755,height:0.235,mapCut:0.205,pad:{top:0.020,bottom:0.018,left:0.028,right:0.024} },
  landscape:{ top:0.775,height:0.190,mapCut:0.185,pad:{top:0.016,bottom:0.014,left:0.022,right:0.020} }
};
async function cropHud(dataURL){
  const img=await loadImage(dataURL);
  const W=img.naturalWidth, H=img.naturalHeight;
  const isPortrait=H>=W;
  const P=isPortrait?STATIC_CROP.portrait:STATIC_CROP.landscape;

  let sy=Math.floor(H*P.top);
  let sh=Math.floor(H*P.height);
  sy = Math.max(0, sy - Math.floor(H*P.pad.top));
  sh = Math.min(H - sy, sh + Math.floor(H*(P.pad.top + P.pad.bottom)));

  let sx=Math.floor(W*(P.mapCut+P.pad.left));
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

/* ---------- OCR preprocess (relaxed) ---------- */
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

  const up=document.createElement('canvas');
  up.width=c.width*3; up.height=c.height*3;
  const uctx=up.getContext('2d');
  uctx.imageSmoothingEnabled=true;
  uctx.drawImage(c,0,0,up.width,up.height);

  let im = uctx.getImageData(0,0,up.width,up.height);
  const d=im.data;
  for(let i=0;i<d.length;i+=4){
    const avg=(d[i]+d[i+1]+d[i+2])/3;
    const v = avg>140?255:0;
    d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  uctx.putImageData(im,0,0);

  // light morphology
  const W=up.width, H=up.height;
  im = uctx.getImageData(0,0,W,H);
  const pix=im.data;
  const get=(x,y)=> pix[(y*W + x)*4];
  const set=(x,y,v)=>{ const k=(y*W + x)*4; pix[k]=pix[k+1]=pix[k+2]=v; pix[k+3]=255; };
  const copy1=new Uint8ClampedArray(pix.length); copy1.set(pix);
  const get1=(x,y)=> copy1[(y*W + x)*4];
  // dilate
  for(let y=1;y<H-1;y++){
    for(let x=1;x<W-1;x++){
      let any=0;
      for(let yy=-1;yy<=1 && !any;yy++)
        for(let xx=-1;xx<=1;xx++)
          if (get(x+xx,y+yy)===255){ any=1; break; }
      const k=(y*W+x)*4;
      copy1[k]=copy1[k+1]=copy1[k+2]= any?255:0; copy1[k+3]=255;
    }
  }
  // erode
  for(let y=1;y<H-1;y++){
    for(let x=1;x<W-1;x++){
      let all=1;
      for(let yy=-1;yy<=1 && all;yy++)
        for(let xx=-1;xx<=1;xx++)
          if (get1(x+xx,y+yy)!==255){ all=0; break; }
      const v=all?255:0; set(x,y,v);
    }
  }
  uctx.putImageData(im,0,0);

  return up.toDataURL('image/png');
}

/* ---------- Drag & drop ---------- */
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
    cropURL = await cropHud(dataURL);
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
      {
        logger:()=>{},
        tessedit_pageseg_mode: 6,
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:+.,/°- '
      }
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

  // Normalize for Form prefill (the key change)
  const { date: formDate, time: formTime } = normalizeForForm(parsed.date, parsed.time);

  outDate && (outDate.textContent = formDate);
  outTime && (outTime.textContent = formTime);
  outLat  && (outLat.textContent  = parsed.lat.toFixed(6));
  outLon  && (outLon.textContent  = parsed.lon.toFixed(6));
  outAddr && (outAddr.textContent = parsed.address);

  // GeoJSON lookup (kept as in stable build)
  setPill('geo','run');
  try{ await ensureGeo(); }catch{ setPill('geo','err'); banner('Failed to load GeoJSON.','error'); return; }
  const gj = geoLookup(parsed.lat, parsed.lon);
  if(!gj.ward || !gj.beat || !gj.ps){ setPill('geo','err'); banner('GeoJSON lookup failed.','error'); return; }
  outWard && (outWard.textContent = gj.ward);
  outBeat && (outBeat.textContent = gj.beat);
  outPS   && (outPS.textContent   = gj.ps);
  setPill('geo','ok');

  setPill('review','ok');

  // Redirect (uses normalized date/time)
  const url = new URL(FORM_BASE);
  url.searchParams.set(ENTRY.date, formDate);
  url.searchParams.set(ENTRY.time, formTime);
  url.searchParams.set(ENTRY.lat, parsed.lat.toFixed(6));
  url.searchParams.set(ENTRY.lon, parsed.lon.toFixed(6));
  url.searchParams.set(ENTRY.ward, gj.ward);
  url.searchParams.set(ENTRY.beat, gj.beat);
  url.searchParams.set(ENTRY.addr, parsed.address);
  url.searchParams.set(ENTRY.ps,   gj.ps);

  try{
    setPill('redirect','run');
    window.open(url.toString(), '_blank', 'noopener');
    setPill('redirect','ok');
  }catch{
    setPill('redirect','err');
    banner('Auto-redirect blocked. Use the button below.','error');
    addManualRedirect(url.toString());
  }
}

/* ---------- Parsing (garbage-filter + fuzzy dt) ---------- */
function parseHudText(raw){
  let lines = raw.split(/\n/).map(s=>s.trim()).filter(Boolean);

  // Trim junk that appears before the location line
  const locIdx = lines.findIndex(l => /(India|Maharashtra|Mumbai)/i.test(l));
  if (locIdx > 0) lines = lines.slice(locIdx);
  if (lines.length < 3) return {};

  const lastTwo = lines.slice(-2).join(' ');
  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];

  // Address is everything above the last 2 lines
  let addr  = lines.slice(0, lines.length - 2).join(', ');

  // Lat/Lon extraction (robust)
  const a = prev.replace(/[|]/g,' ').replace(/°/g,' ').replace(/,\s*/g,' ');
  const m = a.match(/(-?\d{1,2}\.\d+).+?(-?\d{1,3}\.\d+)/);
  let lat = NaN, lon = NaN;
  if (m){ lat = parseFloat(m[1]); lon = parseFloat(m[2]); }

  // Fuzzy date/time cleanup & parsing
  let date = '', time = '';
  let dt = lastTwo
            .replace(/CMT/gi,'GMT')
            .replace(/OV/gi,'08')
            .replace(/O(?=\d)/g,'0');
  let md =
    dt.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{4}).*?(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i) ||
    dt.match(/(\d{4}[\/-]\d{2}[\/-]\d{2}).*?(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
  if (md) { date = md[1]; time = md[2].replace(/\s+/g,' ').trim(); }

  // Address cleanup
  addr = addr
    .replace(/GPS\s*Map\s*Camera/gi,' ')
    .replace(/[\[\(][^\]\)]*[\]\)]/g,' ')
    .replace(/^[^\p{L}\p{N}]+/u,'')
    .replace(/(?:^|,)\s*[^\p{L}\p{N}]+(?=,|$)/gu,'')
    .replace(/\s*,\s*,+/g,', ')
    .replace(/\s{2,}/g,' ')
    .replace(/^[,\s]+|[,\s]+$/g,'')
    .trim();

  return { address: addr, lat, lon, date, time };
}

/* ---------- Date/Time normalization for Google Forms ---------- */
function pad2(n){ return n<10 ? '0'+n : String(n); }
function toFormDate(dStr){
  // Accepts dd/MM/yyyy, d/M/yyyy, yyyy-MM-dd, yyyy/MM/dd
  let d,m,y;
  let m1 = dStr.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); // dd/MM/yyyy
  let m2 = dStr.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/); // yyyy-MM-dd
  if (m1){ d=+m1[1]; m=+m1[2]; y=+m1[3]; }
  else if (m2){ y=+m2[1]; m=+m2[2]; d=+m2[3]; }
  else { return dStr; } // fallback untouched
  return `${pad2(d)}/${pad2(m)}/${y}`;
}
function toFormTime(tStr){
  // Accepts "HH:mm" or "hh:mm AM/PM"
  const m12 = tStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const m24 = tStr.match(/^(\d{1,2}):(\d{2})$/);
  if (m12){
    const hh = +m12[1], mm = m12[2];
    const ap = m12[3].toUpperCase();
    return `${pad2(hh)}:${mm} ${ap}`;
  }
  if (m24){
    let hh = +m24[1], mm = m24[2];
    let ap = 'AM';
    if (hh === 0){ hh = 12; ap = 'AM'; }
    else if (hh === 12){ ap = 'PM'; }
    else if (hh > 12){ hh -= 12; ap = 'PM'; }
    return `${pad2(hh)}:${mm} ${ap}`;
  }
  // if string already contains AM/PM but spacing is weird, normalize spacing/case
  if (/am|pm/i.test(tStr)){
    return tStr.replace(/\s+/g,' ').trim().toUpperCase();
  }
  return tStr; // fallback untouched
}
function normalizeForForm(dateStr, timeStr){
  return {
    date: toFormDate(dateStr),
    time: toFormTime(timeStr)
  };
}

/* ---------- Geo (kept minimal like stable build) ---------- */
let gjW=null, gjB=null, gjP=null;
async function ensureGeo(){
  if(gjW && gjB && gjP) return;
  await Promise.all([
    fetch('data/wards.geojson').then(r=>r.json()).then(j=> gjW=j),
    fetch('data/beats.geojson').then(r=>r.json()).then(j=> gjB=j),
    fetch('data/police_jurisdiction.geojson').then(r=>r.json()).then(j=> gjP=j)
  ]);
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
  if (!gjW || !gjB || !gjP) return out;
  const pt = [lon, lat];
  const inG = (g) =>
    g?.type === 'Polygon' ? inPoly(g.coordinates, pt)
    : g?.type === 'MultiPolygon' ? g.coordinates.some(r => inPoly(r, pt))
    : false;

  for (const f of gjW.features) {
    if (inG(f.geometry)) {
      out.ward = f.properties.WARD
              ?? f.properties.NAME
              ?? f.properties.ward_no
              ?? f.properties.ward
              ?? f.properties.name
              ?? '';
      break;
    }
  }
  for (const f of gjB.features) {
    if (inG(f.geometry)) {
      out.beat = f.properties.BEAT_NO
              ?? f.properties.NAME
              ?? f.properties.beat_no
              ?? f.properties.beat
              ?? f.properties.name
              ?? '';
      break;
    }
  }
  for (const f of gjP.features) {
    if (inG(f.geometry)) {
      out.ps = f.properties.PS_NAME
            ?? f.properties.NAME
            ?? f.properties.ps_name
            ?? f.properties.PSNAME
            ?? f.properties.name
            ?? '';
      break;
    }
  }
  return out;
}

/* ---------- Manual redirect button ---------- */
function addManualRedirect(url){
  let btn=document.getElementById('manualRedirect');
  if(btn) return;
  btn=document.createElement('button');
  btn.id='manualRedirect';
  btn.className='btn btn-primary';
  btn.style.marginTop='10px';
  btn.textContent='Open Google Form';
  btn.onclick=()=> window.open(url,'_blank','noopener');
  const box = ensureConsoleBox();
  if (box) box.parentNode.insertBefore(btn, box.nextSibling);
}

/* ---------- Console controls ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const box = document.getElementById('console-box');
  const toggle = document.getElementById('consoleToggle');
  const copyBtn = document.getElementById('consoleCopy');
  const pre = document.getElementById('console-pre');

  if (toggle && box) {
    toggle.addEventListener('click', () => {
      box.classList.toggle('console-collapsed');
      const expanded = !box.classList.contains('console-collapsed');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Hide' : 'Show';
    });
  }
  if (copyBtn && pre) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent || '');
        const b = document.getElementById('banner');
        if (b) { b.className = 'banner success'; b.hidden = false; b.textContent = 'Console copied to clipboard.'; setTimeout(() => (b.hidden = true), 1600); }
      } catch (_) {}
    });
  }
});
