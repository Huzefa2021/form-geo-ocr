/* ==========================================================
   Abandoned Vehicles – Marshal Upload (MCGM)
   Version: v2025.08.19.P.2.2
   ----------------------------------------------------------
   - Drag & drop + single picker
   - Static crop of HUD section (bottom portion of photo)
   - OCR with Tesseract.js v5 (eng+hin+mar)
   - Garbage removal (ignore line1 branding)
   - Parse rules:
       line1 ignored (branding/city)
       address = middle lines
       second-last = Lat/Lon
       last = Date/Time
   - Date normalized to YYYY-MM-DD
   - Time normalized to HH:mm (24h)
   - GeoJSON lookup (wards, beats, police)
   - Auto redirect to Google Form; fallback manual button
   - On-page console for debugging (raw OCR + parsed)
   ========================================================== */

const el = (id) => document.getElementById(id);

// -------------------- UI Elements --------------------
const fileInput   = el('fileInput');
const dropArea    = el('dropArea');
const imgOriginal = el('imgOriginal');
const imgCrop     = el('imgCrop');

// Result display fields
const outDate  = el('resDate');
const outTime  = el('resTime');
const outLat   = el('resLat');
const outLon   = el('resLon');
const outAddr  = el('resAddr');
const outWard  = el('resWard');
const outBeat  = el('resBeat');
const outPS    = el('resPS');

// Pills (status indicators)
const pills = {
  upload: el('pill-upload'),
  ocr: el('pill-ocr'),
  parse: el('pill-parse'),
  geo: el('pill-geo'),
  review: el('pill-review'),
  redirect: el('pill-redirect'),
};

// Reset
el('btnReset').addEventListener('click', () => location.reload());

// Console log section
const logBox = el('consoleLog');
function logToConsole(raw, parsed, label = '') {
  const now = new Date();
  const t = now.toTimeString().split(' ')[0];
  const msg = [
    `⏱ ${t} ${label ? '['+label+']' : ''}`,
    raw ? `--- RAW OCR TEXT ---\n${raw}` : '',
    parsed ? `--- PARSED FIELDS ---\n${JSON.stringify(parsed, null, 2)}` : '',
    '────────────────────────────────────────'
  ].filter(Boolean).join('\n');
  logBox.textContent = msg + '\n' + logBox.textContent;
}

// Utility: set pill state
function setPill(which, state) {
  const p = pills[which];
  if (!p) return;
  p.classList.remove('ok','run','err');
  if (state) p.classList.add(state);
}

// Utility: set banner message
function setBanner(msg, kind='info') {
  const b = el('banner');
  if (!msg) { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = msg;
  b.className = `banner ${kind}`;
}

// -------------------- Google Form Mapping --------------------
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

// -------------------- Drag & Drop --------------------
dropArea.addEventListener('click', () => fileInput.click());
dropArea.addEventListener('keydown', (e) => { if(e.key==='Enter'||e.key===' ') fileInput.click(); });
fileInput.addEventListener('click', (e) => { e.target.value=''; });
fileInput.addEventListener('change', (e) => { const f=e.target.files?.[0]; if(f) handleFile(f); });

['dragenter','dragover'].forEach(t => dropArea.addEventListener(t,e=>{e.preventDefault();dropArea.classList.add('dragover');}));
['dragleave','drop'].forEach(t => dropArea.addEventListener(t,e=>{e.preventDefault();dropArea.classList.remove('dragover');}));
dropArea.addEventListener('drop',(e)=>{
  const f=[...(e.dataTransfer?.files||[])].find(f=>/^image\//i.test(f.type));
  if(f) handleFile(f);
});

// -------------------- Core Flow --------------------
async function handleFile(file){
  if(!/^image\/(jpe?g|png)$/i.test(file.type)){
    setBanner('Please choose a JPG or PNG.','error');
    return;
  }

  resetOutputs();

  setPill('upload','run');
  const dataURL=await fileToDataURL(file);
  imgOriginal.src=dataURL;
  setPill('upload','ok');

  setPill('ocr','run');
  const cropURL=await cropHud(dataURL);
  imgCrop.src=cropURL;

  let text='';
  try {
    const res=await Tesseract.recognize(
      cropURL,
      'eng+hin+mar',
      { logger:_=>{}, tessedit_pageseg_mode:6 }
    );
    text=(res?.data?.text||'').trim();
    logToConsole(text,null,'[OCR complete]');
    setPill('ocr','ok');
  }catch(e){
    console.error('Tesseract error:',e);
    setPill('ocr','err');
    setBanner('OCR failed.','error');
    return;
  }

  setPill('parse','run');
  const parsed=parseHudText(text);
  logToConsole(text,parsed,'[Parse complete]');
  if(!parsed.date||!parsed.time||isNaN(parsed.lat)||isNaN(parsed.lon)||!parsed.address){
    setPill('parse','err');
    setBanner('Could not parse all fields.','error');
    return;
  }
  setPill('parse','ok');

  outDate.textContent=parsed.date;
  outTime.textContent=parsed.time;
  outLat.textContent=parsed.lat.toFixed(6);
  outLon.textContent=parsed.lon.toFixed(6);
  outAddr.textContent=parsed.address;

  setPill('geo','run');
  await ensureGeo();
  const gj=geoLookup(parsed.lat,parsed.lon);
  outWard.textContent=gj.ward||'—';
  outBeat.textContent=gj.beat||'—';
  outPS.textContent=gj.ps||'—';
  logToConsole('',{matched:gj},'[Geo match]');
  if(!gj.ward||!gj.beat||!gj.ps){
    setPill('geo','err');
    setBanner('GeoJSON lookup failed.','error');
    return;
  }
  setPill('geo','ok');

  setPill('review','ok');

  const url=new URL(FORM_BASE);
  url.searchParams.set(ENTRY.date,parsed.date);
  url.searchParams.set(ENTRY.time,parsed.time);
  url.searchParams.set(ENTRY.lat,parsed.lat.toFixed(6));
  url.searchParams.set(ENTRY.lon,parsed.lon.toFixed(6));
  url.searchParams.set(ENTRY.ward,gj.ward);
  url.searchParams.set(ENTRY.beat,gj.beat);
  url.searchParams.set(ENTRY.addr,parsed.address);
  url.searchParams.set(ENTRY.ps,gj.ps);

  try{
    setPill('redirect','run');
    window.open(url.toString(),'_blank','noopener');
    setPill('redirect','ok');
  }catch{
    setPill('redirect','err');
    setBanner('Auto-redirect failed.','error');
    addManualRedirect(url.toString());
  }
}

function resetOutputs(){
  ['upload','ocr','parse','geo','review','redirect'].forEach(k=>setPill(k,null));
  [outDate,outTime,outLat,outLon,outAddr,outWard,outBeat,outPS].forEach(o=>o.textContent='—');
  imgOriginal.src=''; imgCrop.src='';
  setBanner('','info');
  logBox.textContent='';
}

function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>resolve(fr.result);
    fr.onerror=reject;
    fr.readAsDataURL(file);
  });
}

// -------------------- HUD Crop --------------------
async function cropHud(dataURL){
  const img=await loadImage(dataURL);
  const W=img.naturalWidth,H=img.naturalHeight;

  const sy=Math.floor(H*0.62);
  const sh=Math.floor(H*0.34);
  const sx=Math.floor(W*0.22);
  const sw=Math.floor(W*0.76);

  const c=document.createElement('canvas');
  c.width=sw; c.height=sh;
  const ctx=c.getContext('2d');
  ctx.drawImage(img,sx,sy,sw,sh,0,0,sw,sh);
  return c.toDataURL('image/png');
}

function loadImage(url){
  return new Promise((res,rej)=>{
    const im=new Image();
    im.onload=()=>res(im);
    im.onerror=rej;
    im.src=url;
  });
}

// -------------------- Date/Time Normalizers --------------------
function normalizeDate(dstr){
  const m=dstr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(!m) return dstr;
  const [ , dd, mm, yyyy]=m;
  return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
}
function normalizeTime(tstr){
  const m=tstr.match(/(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
  if(!m) return tstr;
  let [ , hh, mm, ap]=m;
  hh=parseInt(hh,10);
  if(ap){
    if(ap.toUpperCase()==="PM"&&hh<12) hh+=12;
    if(ap.toUpperCase()==="AM"&&hh===12) hh=0;
  }
  return `${hh.toString().padStart(2,'0')}:${mm}`;
}

// -------------------- HUD Text Parser --------------------
function parseHudText(raw){
  const lines=raw.split(/\n/).map(l=>l.trim()).filter(Boolean);
  if(lines.length<3) return {};

  const last=lines[lines.length-1];
  const prev=lines[lines.length-2];
  const addrLines=lines.slice(1,lines.length-2);
  const address=addrLines.join(', ');

  const latM=prev.match(/Lat[^0-9]*([+-]?[0-9]+\.?[0-9]*)/i);
  const lonM=prev.match(/Long[^0-9]*([+-]?[0-9]+\.?[0-9]*)/i);
  let lat=latM?parseFloat(latM[1]):NaN;
  let lon=lonM?parseFloat(lonM[1]):NaN;

  let date='',time='';
  const dt=last.replace(/GMT.*$/,'').trim();
  const m=dt.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/)
         ||dt.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/);
  if(m){ date=m[1]; time=m[2]; }

  date=normalizeDate(date);
  time=normalizeTime(time);

  return { address,lat,lon,date,time };
}

// -------------------- GeoJSON Lookup --------------------
let gjW=null,gjB=null,gjP=null;
async function ensureGeo(){
  if(gjW&&gjB&&gjP) return;
  const [w,b,p]=await Promise.all([
    fetch('data/wards.geojson').then(r=>r.json()),
    fetch('data/beats.geojson').then(r=>r.json()),
    fetch('data/police_jurisdiction.geojson').then(r=>r.json())
  ]);
  gjW=w; gjB=b; gjP=p;
  logToConsole('',{wards:w.features.length,beats:b.features.length,police:p.features.length},'[GeoJSON loaded]');
}

function geoLookup(lat,lon){
  const out={ward:'',beat:'',ps:''};
  if(!gjW||!gjB||!gjP) return out;
  const pt=[lon,lat];
  const inG=(g)=>g?.type==='Polygon'?pointInPoly(g.coordinates,pt):g?.type==='MultiPolygon'?g.coordinates.some(r=>pointInPoly(r,pt)):false;

  for(const f of gjW.features){ if(inG(f.geometry)){ out.ward=f.properties.WARD??f.properties.NAME??f.properties.name??''; break; } }
  for(const f of gjB.features){ if(inG(f.geometry)){ out.beat=f.properties.BEAT_NO??f.properties.NAME??f.properties.name??''; break; } }
  for(const f of gjP.features){ if(inG(f.geometry)){ out.ps=f.properties.PS_NAME??f.properties.NAME??f.properties.name??''; break; } }

  return out;
}

function pointInPoly(poly,pt){
  const [x,y]=pt; let inside=false;
  for(const ring of poly){
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const xi=ring[i][0],yi=ring[i][1];
      const xj=ring[j][0],yj=ring[j][1];
      const intersect=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi);
      if(intersect) inside=!inside;
    }
  }
  return inside;
}

function addManualRedirect(url){
  let btn=el('manualRedirect');
  if(!btn){
    btn=document.createElement('button');
    btn.id='manualRedirect';
    btn.className='btn btn-primary';
    btn.textContent='Open Google Form';
    btn.onclick=()=>window.open(url,'_blank','noopener');
    document.body.appendChild(btn);
  }
}
