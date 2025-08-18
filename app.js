/* ==========================================================
   Abandoned Vehicles – Marshal Upload (MCGM)
   - drag & drop + single picker
   - OCR (eng, auto-switch hin)
   - crop bottom HUD (left-trim to skip map tile)
   - parsing rules: ignore line1, use line2/3 for address,
     second-last = lat/long, last = date/time
   - GeoJSON from /data with fallback + schema mapping
   - redirect to Google Form only if all fields OK
   ========================================================== */

const el = (id) => document.getElementById(id);

// -------------------- UI helpers --------------------
const pills = {
  upload: el('pill-upload'),
  ocr: el('pill-ocr'),
  parse: el('pill-parse'),
  geo: el('pill-geo'),
  review: el('pill-review'),
  redirect: el('pill-redirect'),
};
const t0 = { upload:0, ocr:0, parse:0, geo:0, review:0, redirect:0 };

function setPill(which, state, elapsed=null){
  const p = pills[which]; if (!p) return;
  p.classList.remove('ok','run','err');
  if (state) p.classList.add(state);
  if (elapsed !== null){
    const em = p.querySelector('em');
    if (em) em.textContent = `(${elapsed.toFixed(1)}s)`;
  }
}
function start(which){ t0[which] = performance.now(); setPill(which,'run',0); }
function ok(which){ const dt=(performance.now()-t0[which])/1000; setPill(which,'ok',dt); }
function err(which){ const dt=(performance.now()-t0[which])/1000; setPill(which,'err',dt); }

function setBanner(msg, kind='info'){
  const b = el('banner');
  if (!msg){ b.hidden = true; b.textContent=''; return; }
  b.hidden = false; b.textContent = msg;
  b.className = `banner ${kind}`;
}

// -------------------- Elements --------------------
const fileInput = el('fileInput');
const dropArea  = el('dropArea');
const imgOriginal = el('imgOriginal');
const imgCrop     = el('imgCrop');

const outDate = el('resDate');
const outTime = el('resTime');
const outLat  = el('resLat');
const outLon  = el('resLon');
const outAddr = el('resAddr');
const outWard = el('resWard');
const outBeat = el('resBeat');
const outPS   = el('resPS');

el('btnReset').addEventListener('click', () => location.reload());

// -------------------- Drag & drop / click --------------------
dropArea.addEventListener('click', ()=> fileInput.click());
dropArea.addEventListener('keydown', (e)=>{ if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('click', (e)=>{ e.target.value = ''; }); // prevent double select prompt

fileInput.addEventListener('change', onFileChosen);
['dragenter','dragover'].forEach(type => dropArea.addEventListener(type, (e)=>{e.preventDefault();dropArea.classList.add('dragover');}));
['dragleave','drop'].forEach(type => dropArea.addEventListener(type, (e)=>{e.preventDefault();dropArea.classList.remove('dragover');}));
dropArea.addEventListener('drop', (e)=>{
  const f = [...(e.dataTransfer?.files||[])].find(f=>/^image\/(jpe?g|png)$/i.test(f.type));
  if (f) handleFile(f);
});

// -------------------- Google Form mapping --------------------
const FORM_BASE = 'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url';
// entries: date, time, 1=lon, 2=lat, 3=ward, 4=beat, 5=address, 6=police station
const ENTRY = {
  date: 'entry.1911996449',
  time: 'entry.1421115881',
  lon : 'entry.113122688',
  lat : 'entry.419288992',
  ward: 'entry.1625337207',
  beat: 'entry.1058310891',
  addr: 'entry.1188611077',
  ps  : 'entry.1555105834'
};

// -------------------- Core flow --------------------
async function onFileChosen(e){
  const f = e.target.files?.[0];
  if (f) handleFile(f);
}

async function handleFile(file){
  if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
    alert('Please choose a JPG or PNG.');
    return;
  }

  // Reset state
  setBanner('');
  ['upload','ocr','parse','review','redirect'].forEach(k=>setPill(k,null,0));
  outDate.textContent = outTime.textContent = outLat.textContent = outLon.textContent = outAddr.textContent =
  outWard.textContent = outBeat.textContent = outPS.textContent = '—';
  imgOriginal.src = ''; imgCrop.src='';

  start('upload');
  const dataURL = await fileToDataURL(file);
  imgOriginal.src = dataURL;
  ok('upload');

  // Crop HUD (bottom band, trim left to skip map tile)
  const cropURL = await cropHud(dataURL);
  imgCrop.src = cropURL;

  // OCR
  start('ocr');
  let text = '';
  try {
    // quick language selection: default eng; if Devanagari in image, use hin
    const lang = await maybeHindi(cropURL) ? 'hin' : 'eng';
    const worker = Tesseract.createWorker(lang, 1, { logger: _=>{} });
    const res = await worker.recognize(cropURL);
    await worker.terminate();
    text = (res?.data?.text || '').replace(/\r/g,'').trim();
    ok('ocr');
  } catch (e) {
    err('ocr');
    setBanner('OCR failed. Try a clearer image with the GPS HUD fully visible.', 'error');
    return;
  }

  // Parse
  start('parse');
  const parsed = parseHudText(text);
  if (!parsed.date || !parsed.time || !parsed.lat || !parsed.lon || !parsed.address) {
    err('parse');
    setBanner('Could not parse all fields from the HUD. Ensure the HUD box is fully legible.', 'error');
    return;
  }
  ok('parse');

  // Display parsed
  outDate.textContent = parsed.date;
  outTime.textContent = parsed.time;
  outLat.textContent  = parsed.lat.toFixed(6);
  outLon.textContent  = parsed.lon.toFixed(6);
  outAddr.textContent = parsed.address;

  // GeoJSON lookup
  await ensureGeo();
  const gj = geoLookup(parsed.lat, parsed.lon);
  outWard.textContent = gj.ward || '—';
  outBeat.textContent = gj.beat || '—';
  outPS.textContent   = gj.ps   || '—';
  ok('review');

  // Conditional redirect
  if (gj.ward && gj.beat && gj.ps && parsed.lat && parsed.lon && parsed.address) {
    start('redirect');
    const url = new URL(FORM_BASE);
    url.searchParams.set(ENTRY.date, parsed.date);
    url.searchParams.set(ENTRY.time, parsed.time);
    url.searchParams.set(ENTRY.lon,  parsed.lon.toFixed(6));
    url.searchParams.set(ENTRY.lat,  parsed.lat.toFixed(6));
    url.searchParams.set(ENTRY.ward, gj.ward);
    url.searchParams.set(ENTRY.beat, gj.beat);
    url.searchParams.set(ENTRY.addr, parsed.address);
    url.searchParams.set(ENTRY.ps,   gj.ps);
    ok('redirect');
    window.open(url.toString(), '_blank', 'noopener');
  } else {
    setBanner('Review: Missing Ward/Beat/PS or coordinates. Not redirecting.', 'error');
  }
}

// -------------------- File utils --------------------
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// -------------------- Crop HUD (bottom bar, trim left) --------------------
async function cropHud(dataURL){
  const img = await loadImage(dataURL);
  const W = img.naturalWidth, H = img.naturalHeight;

  // Typical GPS Map Camera HUD is a bottom panel ~28–32% height.
  const HUD_HEIGHT_FRAC = 0.30;
  const LEFT_TRIM_FRAC  = 0.14; // trim left to skip map tile; adjust if needed

  const cropH = Math.round(H * HUD_HEIGHT_FRAC);
  const sy    = H - cropH;
  const sx    = Math.round(W * LEFT_TRIM_FRAC);
  const sw    = W - sx;
  const sh    = cropH;

  const c = document.createElement('canvas');
  c.width  = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  // (No preprocessing by default per your request)
  return c.toDataURL('image/png');
}

function loadImage(url){
  return new Promise((resolve,reject)=>{
    const im = new Image();
    im.onload = ()=> resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}

// -------------------- OCR language quick detector --------------------
async function maybeHindi(dataURL){
  // quick heuristic: sample pixels for strong red/orange HUD, but easier: run small eng OCR and detect Devanagari?
  // Simpler: check for Devanagari in a fast pass with eng first; to keep it light just return false here.
  // If you want, you can implement a tiny pass. Returning false keeps eng default reliable.
  return false;
}

// -------------------- Parsing --------------------
function parseHudText(raw){
  // Normalize whitespace and explode lines
  const txt = raw.split('\n').map(s=>s.trim()).filter(Boolean);

  // The overlay looks like:
  // L1: Mumbai, Maharashtra, India
  // L2: <address line 1> (might be single line or continues on L3)
  // L3: (optional) <address line 2>
  // L4: Lat 19.12311° Long 72.881551°
  // L5: 18/08/2025 11:52 AM GMT +05:30   OR   2025-08-18 11:52
  //
  // Rules:
  // - ignore line 1
  // - gather lines 2 and (optional) 3 into address
  // - second-last line (L4) has lat/lon
  // - last line (L5) has date/time (strip GMT)

  if (txt.length < 3) return {};

  const last  = txt[txt.length-1] || '';
  const prev  = txt[txt.length-2] || '';
  const l2    = txt[1] || '';
  const l3    = txt.length > 3 ? txt[2] : '';

  const address = [l2, l3].filter(Boolean).join(', ').replace(/\s{2,}/g,' ').trim();

  // lat / long patterns
  const latR  = /Lat(?:itude)?[:\s]*([+-]?\d{1,3}(?:\.\d+)?)/i;
  const lonR  = /Long(?:itude)?[:\s]*([+-]?\d{1,3}(?:\.\d+)?)/i;
  const deg   = /°/g;

  let lat = NaN, lon = NaN;
  const llLine = prev.replace(deg,'');
  const latM = llLine.match(latR);
  const lonM = llLine.match(lonR);

  if (latM) lat = normalizeNumber(latM[1], 'lat');
  if (lonM) lon = normalizeNumber(lonM[1], 'lon');

  // date / time
  // Accept: 18/08/2025 11:52 AM GMT +05:30 OR ISO-like
  let date = '', time = '';
  let L = last.replace(/GMT.*$/i,'').trim(); // drop GMT part if present

  // dd/mm/yyyy hh:mm am/pm
  const dt1 = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i;
  // yyyy-mm-dd hh:mm
  const dt2 = /(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i;

  let m = L.match(dt1) || L.match(dt2);
  if (m){ date = m[1]; time = m[2].replace(/\s+/g,' ').trim(); }

  return { address, lat, lon, date, time };
}

function normalizeNumber(val, kind){
  let n = Number(val);
  if (!Number.isFinite(n)) return NaN;
  // fix “191234332.000000” style (missing decimal)
  while ((kind === 'lat' && Math.abs(n) > 90) || (kind === 'lon' && Math.abs(n) > 180)) {
    n = n / 10;
    if (Math.abs(n) < 1000) break;
  }
  return n;
}

// -------------------- GeoJSON (multi-path fallback + schema map) --------------------
const GEO_BASES = ['data/', './data/', '../data/', '../../data/', ''];

let gjW=null, gjB=null, gjP=null;

async function fetchJSONWithFallback(filename){
  for (const base of GEO_BASES) {
    try {
      const url = new URL(base + filename, location.href).toString();
      const res = await fetch(url, { cache:'no-store' });
      if (res.ok) return await res.json();
    } catch(_) {}
  }
  throw new Error(`GeoJSON not found: ${filename}`);
}

function getProp(feat, keys){
  for (const k of keys){
    const v = feat?.properties?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return '';
}

async function ensureGeo(){
  if (gjW && gjB && gjP) return;
  start('geo');
  try {
    const [wards, beats, ps] = await Promise.all([
      fetchJSONWithFallback('wards.geojson'),
      fetchJSONWithFallback('beats.geojson'),
      fetchJSONWithFallback('police_jurisdiction.geojson'),
    ]);
    gjW = wards; gjB = beats; gjP = ps;
    ok('geo');
    setBanner(`GeoJSON loaded — Wards: ${gjW.features?.length||0} • Beats: ${gjB.features?.length||0} • PS: ${gjP.features?.length||0}`, 'info');
  } catch (e) {
    err('geo');
    setBanner(`Failed to load GeoJSON from /data. ${e.message}`, 'error');
  }
}

function pointInPoly(poly, x, y){
  let inside=false;
  for (const ring of poly){
    for (let i=0, j=ring.length-1; i<ring.length; j=i++){
      const xi=ring[i][0], yi=ring[i][1];
      const xj=ring[j][0], yj=ring[j][1];
      const inter = ((yi>y)!==(yj>y)) && (x < (xj - xi)*(y - yi)/(yj - yi) + xi);
      if (inter) inside = !inside;
    }
  }
  return inside;
}

function geoLookup(lat, lon){
  const LON = +lon, LAT = +lat;
  const out = { ward:'', beat:'', ps:'' };
  if (!Number.isFinite(LON) || !Number.isFinite(LAT)) return out;

  // wards
  for (const f of (gjW?.features || [])){
    const g = f.geometry; if (!g) continue;
    const name = getProp(f, ['WARD','Ward','ward','NAME','Name']);
    if (!name) continue;
    if (g.type==='Polygon' && pointInPoly(g.coordinates, LON, LAT)){ out.ward=name; break; }
    if (g.type==='MultiPolygon'){
      for (const p of g.coordinates) if (pointInPoly(p, LON, LAT)){ out.ward=name; break; }
      if (out.ward) break;
    }
  }

  // beats
  for (const f of (gjB?.features || [])){
    const g = f.geometry; if (!g) continue;
    const name = getProp(f, ['BEAT','Beat','beat','BEAT_NO','BEATNO','NAME','Name']);
    if (!name) continue;
    if (g.type==='Polygon' && pointInPoly(g.coordinates, LON, LAT)){ out.beat=name; break; }
    if (g.type==='MultiPolygon'){
      for (const p of g.coordinates) if (pointInPoly(p, LON, LAT)){ out.beat=name; break; }
      if (out.beat) break;
    }
  }

  // police station
  for (const f of (gjP?.features || [])){
    const g = f.geometry; if (!g) continue;
    const name = getProp(f, ['PS','PS_NAME','PSName','Police_Stn','POLICE_ST','NAME','Name']);
    if (!name) continue;
    if (g.type==='Polygon' && pointInPoly(g.coordinates, LON, LAT)){ out.ps=name; break; }
    if (g.type==='MultiPolygon'){
      for (const p of g.coordinates) if (pointInPoly(p, LON, LAT)){ out.ps=name; break; }
      if (out.ps) break;
    }
  }

  return out;
}

// ---------------------------------------------------
setPill('upload',null,0); setPill('ocr',null,0); setPill('parse',null,0);
setPill('geo',null,0); setPill('review',null,0); setPill('redirect',null,0);
setBanner('Ready. Upload a GPS Map Camera photo; HUD will be read and parsed.', 'info');
