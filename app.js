/* ==========================================================
   Abandoned Vehicles – Marshal Upload (MCGM)
   Version: v2025.08.19.P.2.3
   - Safe normalization for Google Form (only at redirect)
   - Sticky header/pills supported via CSS (no JS needed)
   - Flow & UI IDs preserved
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

$('btnReset')?.addEventListener('click', () => location.reload());

/* ---------- Badges ---------- */
function setBadge(el, cls, text){
  if(!el) return;
  el.className = `badge ${cls}`;
  el.textContent = text;
}
function updateCdnBadge(){
  const ok = !!(window.Tesseract && Tesseract.recognize);
  setBadge($('cdnBadge'), ok ? 'badge-ok' : 'badge-err', ok ? 'CDN: v5 (Loaded)' : 'CDN: v5 (Not Loaded)');
}
document.addEventListener('DOMContentLoaded', updateCdnBadge);
window.addEventListener('load', updateCdnBadge);

/* ---------- Banner & Pills ---------- */
function setPill(name, state){
  const p = pills[name]; if(!p) return;
  p.classList.remove('ok','run','err');
  if(state) p.classList.add(state);
}
function setBanner(msg, kind='info'){
  const b = $('banner'); if(!b) return;
  if(!msg){ b.hidden = true; return; }
  b.hidden = false;
  b.textContent = msg;
  b.className = `banner ${kind}`;
}

/* ---------- Console ---------- */
function logToConsole(rawText, parsed, note=''){
  const pre = $('console-pre'); if(!pre) return;
  const stamp = new Date().toTimeString().split(' ')[0];
  const lines = [];
  lines.push(`⏱ ${stamp} ${note}`);
  if (rawText) { lines.push('--- RAW OCR TEXT ---'); lines.push(rawText); }
  if (parsed)  { lines.push('--- PARSED FIELDS ---'); lines.push(typeof parsed==='string'?parsed:JSON.stringify(parsed,null,2)); }
  lines.push('────────────────────────────────────────');
  pre.textContent = lines.join('\n') + '\n' + pre.textContent;
}

/* ---------- Form mapping ---------- */
const FORM_BASE = 'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url';
const ENTRY = {
  date:'entry.1911996449',
  time:'entry.1421115881',
  lat :'entry.419288992',
  lon :'entry.113122688',
  ward:'entry.1625337207',
  beat:'entry.1058310891',
  addr:'entry.1188611077',
  ps  :'entry.1555105834'
};

/* ---------- Upload wiring ---------- */
dropArea?.addEventListener('click',()=> fileInput?.click());
dropArea?.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' ') fileInput?.click(); });
fileInput?.addEventListener('click',e=>{ e.target.value=''; });
fileInput?.addEventListener('change',e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); });
['dragenter','dragover'].forEach(t=> dropArea?.addEventListener(t, e=>{ e.preventDefault(); dropArea.classList.add('dragover'); }));
['dragleave','drop'].forEach(t=> dropArea?.addEventListener(t, e=>{ e.preventDefault(); dropArea.classList.remove('dragover'); }));
dropArea?.addEventListener('drop', e=>{
  const f=[...(e.dataTransfer?.files||[])].find(x=>/^image\//i.test(x.type));
  if (f) handleFile(f);
});

/* ---------- Core flow ---------- */
async function handleFile(file){
  if(!/^image\/(jpe?g|png)$/i.test(file.type)){ setBanner('Please choose a JPG or PNG.','error'); return; }

  resetOutputs();

  // Upload
  setPill('upload','run');
  const dataURL = await fileToDataURL(file);
  imgOriginal && (imgOriginal.src = dataURL);
  setPill('upload','ok');

  // Crop
  setPill('ocr','run');
  let cropURL='';
  try{
    cropURL = await cropHud(dataURL);
    imgCrop && (imgCrop.src = cropURL);
  }catch(e){
    setPill('ocr','err'); setBanner('Crop failed.','error'); logToConsole('',String(e),'[Crop error]'); return;
  }

  // OCR
  if(!(window.Tesseract && Tesseract.recognize)){
    setPill('ocr','err'); setBanner('CDN not loaded (Tesseract).','error'); return;
  }
  let rawText='';
  try{
    const res = await Tesseract.recognize(
      cropURL,
      'eng+hin+mar',
      { logger:()=>{}, tessedit_pageseg_mode:6 }
    );
    rawText = (res?.data?.text || '').trim();
    logToConsole(rawText,null,'[OCR complete]');
    setPill('ocr','ok');
  }catch(e){
    setPill('ocr','err'); setBanner('OCR failed.','error'); logToConsole('',String(e),'[OCR error]'); return;
  }

  // Parse
  setPill('parse','run');
  const parsed = parseHudText(rawText);
  logToConsole('',parsed,'[Parse complete]');
  if(!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon) || !parsed.address){
    setPill('parse','err'); setBanner('Could not parse all fields from HUD.','error'); return;
  }
  setPill('parse','ok');

  // Show raw parsed values on screen (UI)
  outDate && (outDate.textContent = parsed.date);
  outTime && (outTime.textContent = parsed.time);
  outLat  && (outLat.textContent  = parsed.lat.toFixed(6));
  outLon  && (outLon.textContent  = parsed.lon.toFixed(6));
  outAddr && (outAddr.textContent = parsed.address);

  // Geo
  setPill('geo','run');
  try{ await ensureGeo(); }catch(e){ setPill('geo','err'); setBanner('Failed to load GeoJSON.','error'); logToConsole('',String(e),'[Geo error]'); return; }
  const gj = geoLookup(parsed.lat, parsed.lon);
  if(!gj.ward || !gj.beat || !gj.ps){ setPill('geo','err'); setBanner('GeoJSON lookup failed.','error'); return; }
  outWard && (outWard.textContent = gj.ward);
  outBeat && (outBeat.textContent = gj.beat);
  outPS   && (outPS.textContent   = gj.ps);
  setPill('geo','ok');

  setPill('review','ok');

  // ------- SAFE NORMALIZATION (ONLY FOR REDIRECT) -------
  const { date: formDate, time: formTime } = normalizeForForm(parsed.date, parsed.time);
  // reflect normalized values back to UI so users see what will be sent
  outDate && (outDate.textContent = formDate);
  outTime && (outTime.textContent = formTime);
  logToConsole('', {date: formDate, time: formTime}, '[Prefill normalized]');

  // Redirect to Google Form
  const url = new URL(FORM_BASE);
  url.searchParams.set(ENTRY.date, formDate);
  url.searchParams.set(ENTRY.time, formTime);
  url.searchParams.set(ENTRY.lat,  parsed.lat.toFixed(6));
  url.searchParams.set(ENTRY.lon,  parsed.lon.toFixed(6));
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
    setBanner('Auto-redirect blocked. Use the button below.','error');
    addManualRedirect(url.toString());
  }
}

function resetOutputs(){
  ['upload','ocr','parse','geo','review','redirect'].forEach(k=> setPill(k,null));
  [outDate,outTime,outLat,outLon,outAddr,outWard,outBeat,outPS].forEach(o => o && (o.textContent='—'));
  if(imgOriginal) imgOriginal.src = '';
  if(imgCrop)     imgCrop.src = '';
  setBanner('');
  const pre=$('console-pre'); if(pre) pre.textContent='Logs will appear here…';
}

/* ---------- Utilities ---------- */
function fileToDataURL(f){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(f); }); }
function loadImage(url){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=url; }); }

/* ---------- Static Crop (kept) ---------- */
async function cropHud(dataURL){
  const img=await loadImage(dataURL);
  const W=img.naturalWidth, H=img.naturalHeight;
  const sy=Math.floor(H*0.60);
  const sh=Math.floor(H*0.36);
  const sx=Math.floor(W*0.22);
  const sw=Math.floor(W*0.76);
  const c=document.createElement('canvas');
  c.width=sw; c.height=sh;
  c.getContext('2d').drawImage(img, sx,sy,sw,sh, 0,0,sw,sh);
  return c.toDataURL('image/png');
}

/* ---------- Parser (unchanged; no normalization here) ---------- */
function parseHudText(raw){
  const lines = raw.split(/\n/).map(s=>s.trim()).filter(Boolean);
  if (lines.length < 3) return {};

  const last = lines[lines.length - 1];
  const prev = lines[lines.length - 2];
  const addrLines = lines.slice(1, lines.length - 2);
  const address = addrLines.join(', ');

  const latM = prev.match(/Lat[^0-9]*([+-]?[0-9]+\.?[0-9]*)/i);
  const lonM = prev.match(/Long[^0-9]*([+-]?[0-9]+\.?[0-9]*)/i);
  const lat  = latM ? parseFloat(latM[1]) : NaN;
  const lon  = lonM ? parseFloat(lonM[1]) : NaN;

  let date='', time='';
  const dt = (prev + ' ' + last).replace(/GMT.*$/,'').trim();
  const m = dt.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i)
          || dt.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
  if (m) { date = m[1]; time = m[2].replace(/\s+/g,' ').trim(); }

  return { address, lat, lon, date, time };
}

/* ---------- Safe Google Form normalizer (end only) ---------- */
function normalizeForForm(dateStr, timeStr) {
  try {
    let d = (dateStr || '').trim();
    let t = (timeStr || '').trim();
    // DATE
    let dd, mm, yyyy;
    let m = d.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); // dd/mm/yyyy
    if (m){ dd=m[1]; mm=m[2]; yyyy=m[3]; }
    else {
      m = d.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/); // yyyy-mm-dd
      if (!m) return { date: dateStr, time: normalizeTimeOnly(t, timeStr) };
      yyyy=m[1]; mm=m[2]; dd=m[3];
    }
    dd = String(dd).padStart(2,'0');
    mm = String(mm).padStart(2,'0');
    const normDate = `${dd}/${mm}/${yyyy}`;

    // TIME
    const normTime = normalizeTimeOnly(t, timeStr);
    return { date: normDate, time: normTime };
  } catch { return { date: dateStr, time: timeStr }; }
}
function normalizeTimeOnly(tStr, fallback){
  try{
    let t = (tStr || '').replace(/GMT.*$/i,'').trim();
    let m12 = t.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    let m24 = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m12){
      const hh = String(parseInt(m12[1],10)).padStart(2,'0');
      const mm = m12[2];
      const ap = m12[3].toUpperCase();
      return `${hh}:${mm} ${ap}`;
    }
    if (m24){
      let H = parseInt(m24[1],10), mm = m24[2], ap = 'AM';
      if (H === 0){ H = 12; ap = 'AM'; }
      else if (H === 12){ ap = 'PM'; }
      else if (H > 12){ H -= 12; ap = 'PM'; }
      const hh = String(H).padStart(2,'0');
      return `${hh}:${mm} ${ap}`;
    }
    if (/am|pm/i.test(t)) return t.replace(/\s+/g,' ').toUpperCase();
    return fallback || tStr || '';
  }catch{ return fallback || tStr || ''; }
}

/* ---------- Geo ---------- */
let gjW=null, gjB=null, gjP=null;
async function ensureGeo(){
  if(gjW && gjB && gjP) return;
  const fetchJson = async (path) => {
    const r = await fetch(path, { cache:'no-store' });
    if(!r.ok) throw new Error(`Fetch ${path} -> ${r.status}`);
    return r.json();
  };
  const [w,b,p] = await Promise.all([
    fetchJson('data/wards.geojson'),
    fetchJson('data/beats.geojson'),
    fetchJson('data/police_jurisdiction.geojson'),
  ]);
  gjW=w; gjB=b; gjP=p;
  const ok = (w?.features?.length && b?.features?.length && p?.features?.length);
  setBadge($('geoBadge'), ok? 'badge-ok':'badge-err', ok? 'Geo: Loaded':'Geo: Error');
}
function pointInPoly(poly,[x,y]){
  let inside=false;
  for(const ring of poly){
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const xi=ring[i][0], yi=ring[i][1];
      const xj=ring[j][0], yj=ring[j][1];
      const intersect=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi);
      if(intersect) inside=!inside;
    }
  }
  return inside;
}
function geoLookup(lat, lon){
  const out={ward:'',beat:'',ps:''};
  if(!gjW||!gjB||!gjP) return out;
  const pt=[lon,lat];
  const inG=(g)=>g?.type==='Polygon'?pointInPoly(g.coordinates,pt):
                g?.type==='MultiPolygon'?g.coordinates.some(r=>pointInPoly(r,pt)):false;
  for(const f of gjW.features){ if(inG(f.geometry)){ out.ward=f.properties.WARD??f.properties.NAME??f.properties.name??''; break; } }
  for(const f of gjB.features){ if(inG(f.geometry)){ out.beat=f.properties.BEAT_NO??f.properties.NAME??f.properties.name??''; break; } }
  for(const f of gjP.features){ if(inG(f.geometry)){ out.ps  =f.properties.PS_NAME ??f.properties.NAME??f.properties.name??''; break; } }
  return out;
}

/* ---------- Manual Redirect Fallback ---------- */
function addManualRedirect(url){
  let btn=document.getElementById('manualRedirect');
  if(btn) return;
  btn=document.createElement('button');
  btn.id='manualRedirect';
  btn.className='btn btn-primary';
  btn.style.marginTop='10px';
  btn.textContent='Open Google Form';
  btn.onclick=()=> window.open(url,'_blank','noopener');
  const host = document.querySelector('#resultsCard') || document.body;
  host.appendChild(btn);
}
