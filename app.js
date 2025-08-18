/* ==========================================================
   Abandoned Vehicles – Marshal Upload (MCGM)
   Version: v2025.08.19.P.2.4
   Hotfixes:
   - Robust hook-up for file picker & drop area (auto-create input if missing)
   - Tesseract CDN badge re-checks (DOMContentLoaded + load + retries)
   - Guarded console writes (no hard crash if pane missing)
   - Clear logging when Geo/CDN fail
   ========================================================== */

const el = (id) => document.getElementById(id);

/* -------------------- Result Elements -------------------- */
const imgOriginal = el('imgOriginal');
const imgCrop     = el('imgCrop');

const outDate  = el('resDate');
const outTime  = el('resTime');
const outLat   = el('resLat');
const outLon   = el('resLon');
const outAddr  = el('resAddr');
const outWard  = el('resWard');
const outBeat  = el('resBeat');
const outPS    = el('resPS');

const pills = {
  upload  : el('pill-upload'),
  ocr     : el('pill-ocr'),
  parse   : el('pill-parse'),
  geo     : el('pill-geo'),
  review  : el('pill-review'),
  redirect: el('pill-redirect'),
};

const resetBtn = el('btnReset');
if (resetBtn) resetBtn.addEventListener('click', () => location.reload());

/* -------------------- Console Pane (guarded) -------------------- */
const logBox = el('consoleLog');
function logToConsole(raw, parsed, label = '') {
  const t = new Date().toTimeString().split(' ')[0];
  const msg = [
    `⏱ ${t} ${label ? `[${label}]` : ''}`,
    raw ? `--- RAW OCR TEXT ---\n${raw}` : '',
    parsed ? `--- PARSED FIELDS ---\n${JSON.stringify(parsed, null, 2)}` : '',
    '────────────────────────────────────────'
  ].filter(Boolean).join('\n');

  if (logBox) {
    logBox.textContent = msg + '\n' + logBox.textContent;
  } else {
    console.log(msg);
  }
}

/* -------------------- Banner & Pills -------------------- */
function setPill(which, state) {
  const p = pills[which];
  if (!p) return;
  p.classList.remove('ok', 'run', 'err');
  if (state) p.classList.add(state);
}

function setBanner(msg, kind = 'info') {
  const b = el('banner');
  if (!b) return;
  if (!msg) { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = msg;
  b.className = `banner ${kind}`;
}

/* -------------------- Badges -------------------- */
const cdnBadge = el('cdnBadge');
const geoBadge = el('geoBadge');

function setBadge(elm, cls, text) {
  if (!elm) return;
  elm.className = `badge ${cls}`; // needs .badge.ok/.badge.warn/.badge.info in CSS
  elm.textContent = text;
}

function checkCDNReady() {
  if (window.Tesseract) {
    setBadge(cdnBadge, 'ok', 'CDN: v5 (Loaded)');
    logToConsole('', { tesseract: 'ready' }, 'CDN ready');
    return true;
  }
  return false;
}

function waitForCDNReady() {
  setBadge(cdnBadge, 'info', 'CDN: v5 (Loading…)');
  let attempts = 0;
  const h = setInterval(() => {
    if (checkCDNReady()) { clearInterval(h); return; }
    if (++attempts > 40) { // ~10s
      clearInterval(h);
      setBadge(cdnBadge, 'warn', 'CDN: Failed');
      setBanner('Could not load Tesseract from CDN. Check network/CSP.', 'error');
      logToConsole('window.Tesseract undefined', null, 'CDN error');
    }
  }, 250);
}

/* -------------------- Google Form Mapping -------------------- */
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

/* -------------------- File Picker & Drop (robust) -------------------- */
function getDropArea() {
  return el('dropArea') ||
         document.querySelector('[data-role="drop-area"]') ||
         document.querySelector('.drop-area') ||
         // fallback to the big dashed box:
         document.querySelector('[data-box="uploader"]') ||
         document.querySelector('[aria-label*="choose image"]') ||
         document.querySelector('[role="button"][data-upload]');
}

function getOrCreateFileInput() {
  // first try known ids/selectors
  let input =
    el('fileInput') ||
    document.querySelector('input[type="file"]#fileInput') ||
    document.querySelector('input[type="file"].file-input') ||
    document.querySelector('input[type="file"]');

  // if still not present, create hidden input and append to drop area
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png';
    input.style.display = 'none';
    (getDropArea() || document.body).appendChild(input);
  }
  return input;
}

function wireUpload() {
  const drop = getDropArea();
  const input = getOrCreateFileInput();
  if (!drop || !input) {
    logToConsole('Could not bind uploader (drop/input missing)', null, 'Init warning');
    return;
  }

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });

  input.addEventListener('click', (e) => { e.target.value = ''; });
  input.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) handleFile(f); });

  // Drag-n-drop
  ['dragenter','dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('dragover'); }));
  ['dragleave','drop'   ].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', (e) => {
    const f = [...(e.dataTransfer?.files || [])].find(f => /^image\//i.test(f.type));
    if (f) handleFile(f);
  });

  logToConsole('', { wired: true }, 'Uploader');
}

/* -------------------- Flow -------------------- */
async function handleFile(file) {
  try {
    if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
      setBanner('Please choose a JPG or PNG.', 'error'); return;
    }

    resetOutputs();

    setPill('upload','run');
    const dataURL = await fileToDataURL(file);
    if (imgOriginal) imgOriginal.src = dataURL;
    setPill('upload','ok');

    setPill('ocr','run');
    const cropURL = await cropHud(dataURL);
    if (imgCrop) imgCrop.src = cropURL;

    let text = '';
    try {
      if (!window.Tesseract) { // last guard
        setPill('ocr','err');
        setBanner('CDN not loaded: Tesseract is unavailable.','error');
        logToConsole('Tesseract missing', null, 'CDN error');
        return;
      }
      const res = await Tesseract.recognize(
        cropURL,
        'eng+hin+mar',
        { logger: _ => {}, tessedit_pageseg_mode: 6 }
      );
      text = (res?.data?.text || '').trim();
      logToConsole(text, null, 'OCR complete');
      setPill('ocr','ok');
    } catch (e) {
      setPill('ocr','err'); setBanner('OCR failed.','error');
      logToConsole(String(e), null, 'OCR error'); return;
    }

    setPill('parse','run');
    const parsed = parseHudText(text);
    logToConsole(text, parsed, 'Parse complete');
    if (!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon) || !parsed.address) {
      setPill('parse','err'); setBanner('Could not parse all fields.','error'); return;
    }
    setPill('parse','ok');

    if (outDate) outDate.textContent = parsed.date;
    if (outTime) outTime.textContent = parsed.time;
    if (outLat)  outLat.textContent  = parsed.lat.toFixed(6);
    if (outLon)  outLon.textContent  = parsed.lon.toFixed(6);
    if (outAddr) outAddr.textContent = parsed.address;

    setPill('geo','run');
    try {
      await ensureGeo();
      const gj = geoLookup(parsed.lat, parsed.lon);
      if (outWard) outWard.textContent = gj.ward || '—';
      if (outBeat) outBeat.textContent = gj.beat || '—';
      if (outPS)   outPS.textContent   = gj.ps   || '—';
      logToConsole('', { matched: gj }, 'Geo match');
      if (!gj.ward || !gj.beat || !gj.ps) {
        setPill('geo','err'); setBanner('GeoJSON lookup failed.','error'); return;
      }
      setPill('geo','ok');
    } catch (gerr) {
      setPill('geo','err');
      setBanner('Failed to load/parse GeoJSON (see console).','error');
      logToConsole(String(gerr), null, 'Geo error');
      return;
    }

    setPill('review','ok');

    const url = new URL(FORM_BASE);
    url.searchParams.set(ENTRY.date, parsed.date);
    url.searchParams.set(ENTRY.time, parsed.time);
    url.searchParams.set(ENTRY.lat , parsed.lat.toFixed(6));
    url.searchParams.set(ENTRY.lon , parsed.lon.toFixed(6));
    url.searchParams.set(ENTRY.ward, el('resWard')?.textContent || '');
    url.searchParams.set(ENTRY.beat, el('resBeat')?.textContent || '');
    url.searchParams.set(ENTRY.addr, parsed.address);
    url.searchParams.set(ENTRY.ps  , el('resPS')?.textContent || '');

    try {
      setPill('redirect','run');
      window.open(url.toString(), '_blank', 'noopener');
      setPill('redirect','ok');
    } catch {
      setPill('redirect','err');
      setBanner('Auto-redirect failed. Use the button below.','error');
      addManualRedirect(url.toString());
    }
  } catch (fatal) {
    setBanner('Unexpected error (see console).','error');
    logToConsole(String(fatal), null, 'Fatal');
  }
}

function resetOutputs() {
  ['upload','ocr','parse','geo','review','redirect'].forEach(k => setPill(k, null));
  [outDate,outTime,outLat,outLon,outAddr,outWard,outBeat,outPS].forEach(o => { if (o) o.textContent = '—'; });
  if (imgOriginal) imgOriginal.src = '';
  if (imgCrop)     imgCrop.src = '';
  setBanner('', 'info');
  if (logBox) logBox.textContent = '';
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

/* -------------------- Static HUD Crop (relaxed bottom) -------------------- */
async function cropHud(dataURL) {
  const img = await loadImage(dataURL);
  const W = img.naturalWidth, H = img.naturalHeight;

  const sy = Math.floor(H * 0.60);
  const sh = Math.floor(H * 0.36);
  const sx = Math.floor(W * 0.22);
  const sw = Math.floor(W * 0.76);

  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/png');
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}

/* -------------------- Normalizers & Parser -------------------- */
function normalizeDate(dstr){
  const m = dstr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(!m) return dstr;
  const [ , dd, mm, yyyy ] = m;
  return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
}
function normalizeTime(tstr){
  const m = tstr.match(/(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
  if(!m) return tstr;
  let [ , hh, mm, ap] = m;
  hh = parseInt(hh,10);
  if(ap){
    if(ap.toUpperCase()==='PM' && hh<12) hh+=12;
    if(ap.toUpperCase()==='AM' && hh===12) hh=0;
  }
  return `${hh.toString().padStart(2,'0')}:${mm}`;
}

function parseHudText(raw){
  const lines = raw.split(/\n/).map(l=>l.trim()).filter(Boolean);
  if(lines.length<3) return {};

  const last = lines[lines.length-1];
  const prev = lines[lines.length-2];
  const addrLines = lines.slice(1, lines.length-2); // ignore first line (branding/city)
  const address = addrLines.join(', ');

  const latM = prev.match(/Lat[^0-9]*([+-]?[0-9]+\.?[0-9]*)/i);
  const lonM = prev.match(/Long[^0-9]*([+-]?[0-9]+\.?[0-9]*)/i);
  const lat = latM ? parseFloat(latM[1]) : NaN;
  const lon = lonM ? parseFloat(lonM[1]) : NaN;

  let date='', time='';
  const dt = last.replace(/GMT.*$/,'').trim();
  const m = dt.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/)
         || dt.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)/);
  if (m) { date=m[1]; time=m[2]; }

  return { address, lat, lon, date: normalizeDate(date), time: normalizeTime(time) };
}

/* -------------------- GeoJSON -------------------- */
let gjW=null, gjB=null, gjP=null;

async function ensureGeo() {
  if (gjW && gjB && gjP) return;

  const fetchJson = async (path) => {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Fetch ${path} -> ${r.status} ${r.statusText}`);
    return r.json();
  };

  const [w,b,p] = await Promise.all([
    fetchJson('data/wards.geojson'),
    fetchJson('data/beats.geojson'),
    fetchJson('data/police_jurisdiction.geojson'),
  ]);

  gjW=w; gjB=b; gjP=p;

  const cts = {
    wards: gjW?.features?.length || 0,
    beats: gjB?.features?.length || 0,
    police: gjP?.features?.length || 0
  };
  setBadge(geoBadge, (cts.wards&&cts.beats&&cts.police)?'ok':'warn',
           (cts.wards&&cts.beats&&cts.police)?'Geo: Loaded':'Geo: Error');
  logToConsole('', cts, 'GeoJSON loaded');
}

function geoLookup(lat, lon) {
  const out = { ward:'', beat:'', ps:'' };
  if (!gjW || !gjB || !gjP) return out;
  const pt = [lon, lat];
  const inG=(g)=>g?.type==='Polygon'?pointInPoly(g.coordinates,pt):
                g?.type==='MultiPolygon'?g.coordinates.some(r=>pointInPoly(r,pt)):false;

  for (const f of gjW.features) if (inG(f.geometry)) { out.ward = f.properties.WARD ?? f.properties.NAME ?? f.properties.name ?? ''; break; }
  for (const f of gjB.features) if (inG(f.geometry)) { out.beat  = f.properties.BEAT_NO ?? f.properties.NAME ?? f.properties.name ?? ''; break; }
  for (const f of gjP.features) if (inG(f.geometry)) { out.ps    = f.properties.PS_NAME ?? f.properties.NAME ?? f.properties.name ?? ''; break; }

  return out;
}

function pointInPoly(poly, pt) {
  const [x, y] = pt;
  let inside = false;
  for (const ring of poly) {
    for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
      const xi=ring[i][0], yi=ring[i][1];
      const xj=ring[j][0], yj=ring[j][1];
      const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi) + xi);
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

function addManualRedirect(url){
  let btn = el('manualRedirect');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'manualRedirect';
    btn.className = 'btn btn-primary';
    btn.textContent = 'Open Google Form';
    btn.onclick = () => window.open(url,'_blank','noopener');
    document.body.appendChild(btn);
  }
}

/* -------------------- Boot -------------------- */
document.addEventListener('DOMContentLoaded', () => {
  wireUpload();
  waitForCDNReady();
  // kick geo (badge will update inside)
  ensureGeo().catch(err=>{
    setBadge(geoBadge, 'warn', 'Geo: Error');
    setBanner('Failed to load GeoJSON (see console).','error');
    logToConsole(String(err), null, 'Geo error');
  });
});

window.addEventListener('load', () => {
  // In case CDN finished after DOMContentLoaded
  if (!checkCDNReady()) {
    // small extra retry burst
    let n=0, h=setInterval(()=>{ if(checkCDNReady()||++n>8) clearInterval(h); },250);
  }
});
