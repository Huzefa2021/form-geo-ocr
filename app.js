/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.10.04.M2

   What changed in this build
   - Adaptive HUD crop (portrait vs landscape, buffered edges)
   - OCR.Space primary (quota-aware)
       * 1st try: engine=2, lang=eng
       * Retry only if CRITICAL fields missing
       * Optional multi-lang retry (hin) is OFF by default
   - Tesseract fallback only if OCR.Space cannot deliver criticals
   - Robust parsing:
       * Trims branding/noise
       * Recovers lat/long even when '.' is dropped
       * Date normalized -> YYYY-MM-DD
       * Time normalized -> HH:mm (24h)
   - No UI/UX changes required (index + styles unchanged)
   ========================================================== */

const $ = (id) => document.getElementById(id);

/* ---------- CONFIG ---------- */
const OCR_SPACE_KEY = 'K86010114388957'; // <-- put your OCR.Space key here
const FORM_BASE =
  'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url';
const ENTRY = {
  date: 'entry.1911996449',
  time: 'entry.1421115881',
  lat:  'entry.419288992',
  lon:  'entry.113122688',
  ward: 'entry.1625337207', // keep mapping intact for future
  beat: 'entry.1058310891', // keep mapping intact for future
  addr: 'entry.1188611077',
  ps:   'entry.1555105834'
};
// Quota-aware retry knobs
const OCRSPACE_RETRY_IF_MISSING = ['address', 'lat', 'lon', 'date', 'time']; // criticals
const ENABLE_OCRSPACE_HINDI_RETRY = false; // set true if you want eng→hin before Tesseract

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
function fileToDataURL(f){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(f); }); }
function loadImage(url){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=url; }); }
function resetOutputs(){
  ['upload','ocr','parse','geo','review','redirect'].forEach(k=> setPill(k,null));
  [outDate,outTime,outLat,outLon,outAddr,outWard,outBeat,outPS].forEach(o => o && (o.textContent='—'));
  if(imgOriginal) imgOriginal.src = '';
  if(imgCrop) imgCrop.src = '';
  banner('');
  logToConsole('','', '[Reset]');
  lastRedirectUrl = '';
}

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
  ].filter(Boolean).join('\n') + '\n';
  pre.textContent = (pre.textContent + log).slice(-15000);
}

/* ---------- Drag & Drop ---------- */
if (dropArea && fileInput){
  dropArea.addEventListener('click', ()=> fileInput.click());
  dropArea.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' ') fileInput.click(); });
  ;['dragenter','dragover'].forEach(t=> dropArea.addEventListener(t,(e)=>{e.preventDefault();dropArea.classList.add('dragover');}));
  ;['dragleave','drop'].forEach(t=> dropArea.addEventListener(t,(e)=>{e.preventDefault();dropArea.classList.remove('dragover');}));
  dropArea.addEventListener('drop', (e)=>{
    const f=[...(e.dataTransfer?.files||[])].find(f=>/^image\//i.test(f.type));
    if(f) handleFile(f);
  });
  fileInput.addEventListener('click', (e)=>{ e.target.value=''; });
  fileInput.addEventListener('change', (e)=>{ const f=e.target.files?.[0]; if(f) handleFile(f); });
}

/* ---------- Core Flow ---------- */
async function handleFile(file){
  if(!/^image\/(jpe?g|png)$/i.test(file.type)){
    banner('Please choose a JPG or PNG.', 'error'); return;
  }

  resetOutputs();
  setPill('upload','run');

  const dataURL = await fileToDataURL(file);
  if(imgOriginal) imgOriginal.src = dataURL;
  setPill('upload','ok');

  // Adaptive HUD crop (portrait vs landscape)
  setPill('ocr','run');
  const cropURL = await cropHud(dataURL);
  if(imgCrop) imgCrop.src = cropURL;

  // OCR.Space (quota-aware)
  let ocrText = '';
  let engineUsed = 'OCR.Space';
  try{
    const primary = await ocrSpaceRecognize(cropURL, { engine:2, language:'eng' });
    logToConsole('', {engine:primary.meta.engine, lang:primary.meta.language, exit:primary.meta.exitCode, errored:primary.meta.errored, msg:primary.meta.messages}, '[OCR.Space meta (processed)]');
    ocrText = primary.text || '';

    // Parse once and check criticals
    let parsed = parseHudText(ocrText);
    const missing = missingCritical(parsed);

    // If criticals missing and we allow minimal retry -> try OCR.Space again (optional Hindi)
    if(missing.length && ENABLE_OCRSPACE_HINDI_RETRY){
      const retry = await ocrSpaceRecognize(cropURL, { engine:2, language:'hin' });
      logToConsole('', {engine:retry.meta.engine, lang:retry.meta.language, exit:retry.meta.exitCode, errored:retry.meta.errored, msg:retry.meta.messages}, '[OCR.Space meta (processed, hin)]');
      if (retry.text) {
        ocrText = chooseBetterText(ocrText, retry.text);
        parsed = parseHudText(ocrText);
      }
    }

    // If still missing criticals -> Tesseract fallback
    if(missingCritical(parseHudText(ocrText)).length){
      engineUsed = 'Tesseract';
      const tesseract = await tesseractRecognize(cropURL);
      if (tesseract) {
        ocrText = chooseBetterText(ocrText, tesseract);
      }
    }

  }catch(e){
    // If OCR.Space errored outright, try Tesseract as fallback
    logToConsole('', {error:String(e)}, '[OCR error]');
    engineUsed = 'Tesseract';
    const tesseract = await tesseractRecognize(cropURL);
    ocrText = tesseract || '';
  }

  // Final parse
  logToConsole(ocrText, '', `[OCR complete via ${engineUsed}]`);
  setPill('ocr','ok');

  setPill('parse','run');
  const finalParsed = parseHudText(ocrText);
  logToConsole('', finalParsed, '[Parse complete]');

  if (!finalParsed.date || !finalParsed.time || isNaN(finalParsed.lat) || isNaN(finalParsed.lon) || !finalParsed.address){
    setPill('parse','err');
    banner('Could not parse all fields from HUD.', 'error');
    return;
  }
  setPill('parse','ok');

  // Fill UI
  outDate.textContent = toFormDate(finalParsed.date); // show normalized date
  outTime.textContent = toFormTime(finalParsed.time);
  outLat.textContent = Number(finalParsed.lat).toFixed(6);
  outLon.textContent = Number(finalParsed.lon).toFixed(6);
  outAddr.textContent = finalParsed.address;
  outWard.textContent = '—';
  outBeat.textContent = '—';
  outPS.textContent   = '—';

  setPill('review', 'ok');

  // Build prefill URL (YYYY-MM-DD & HH:mm)
  const url = new URL(FORM_BASE);
  url.searchParams.set(ENTRY.date, toFormDate(finalParsed.date));
  url.searchParams.set(ENTRY.time, toFormTime(finalParsed.time));
  url.searchParams.set(ENTRY.lat,  Number(finalParsed.lat).toFixed(6));
  url.searchParams.set(ENTRY.lon,  Number(finalParsed.lon).toFixed(6));
  url.searchParams.set(ENTRY.ward, outWard.textContent || '');
  url.searchParams.set(ENTRY.beat, outBeat.textContent || '');
  url.searchParams.set(ENTRY.addr, finalParsed.address);
  url.searchParams.set(ENTRY.ps,   outPS.textContent || '');

  lastRedirectUrl = url.toString();
  logToConsole('', {redirect:lastRedirectUrl}, '[Redirect URL]');

  // Auto open; pill will flash if blocked by popup guard
  try{
    setPill('redirect','run');
    window.open(lastRedirectUrl, '_blank', 'noopener');
    setPill('redirect','ok');
  }catch{
    setPill('redirect','err');
    banner('Auto-redirect blocked. Tap Redirect pill to open.', 'error');
  }

  // Make Redirect pill clickable as manual fallback
  if (pills.redirect){
    pills.redirect.style.cursor = 'pointer';
    pills.redirect.onclick = ()=> { if(lastRedirectUrl) window.open(lastRedirectUrl,'_blank','noopener'); };
  }
}

/* ---------- Adaptive HUD Crop ---------- */
async function cropHud(dataURL){
  const img = await loadImage(dataURL);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const isLandscape = w > h;

  // Adaptive crop: keep a bit more area for portrait;
  // for landscape, HUD sits slightly higher ⇒ reduce aggressiveness.
  let cropHeight = isLandscape ? h * 0.22 : h * 0.30;
  let yStart     = h - cropHeight;

  // small upward tolerance in case HUD is floating higher
  yStart   = Math.max(0, yStart - 10);
  cropHeight = Math.min(h - yStart, cropHeight + 10);

  const xStart   = Math.floor(w * 0.02);
  const cropW    = Math.floor(w * 0.96);
  const cropH    = Math.floor(cropHeight);
  const y        = Math.floor(yStart);

  const c = document.createElement('canvas');
  c.width = cropW; c.height = cropH;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, xStart, y, cropW, cropH, 0, 0, cropW, cropH);
  return c.toDataURL('image/png');
}

/* ---------- OCR.Space (quota-aware) ---------- */
async function ocrSpaceRecognize(dataURL, {engine=2, language='eng'}={}){
  const base64 = dataURL.split(',')[1];
  const form = new FormData();
  form.append('apikey', OCR_SPACE_KEY);
  form.append('base64Image', base64);
  form.append('language', language);  // 'eng', 'hin' etc.
  form.append('OCREngine', String(engine)); // 1/2/3
  form.append('scale', 'true');
  form.append('isTable', 'false');
  form.append('detectOrientation', 'true');
  form.append('isOverlayRequired', 'false');

  const res = await fetch('https://api.ocr.space/parse/image', { method:'POST', body:form });
  const json = await res.json();

  const meta = {
    engine,
    language,
    exitCode: json?.OCRExitCode ?? null,
    errored: !!json?.IsErroredOnProcessing,
    messages: json?.ErrorMessage || json?.ErrorDetails || ''
  };

  const text = Array.isArray(json?.ParsedResults)
    ? (json.ParsedResults.map(p=>p.ParsedText).join('\n').trim())
    : '';

  logToConsole('', meta, `[OCR.Space tries trace]`);

  return { text, meta };
}

// Choose better OCR text if retry produced more useful content
function chooseBetterText(primary, retry){
  if(!primary && retry) return retry;
  if(primary && !retry) return primary;
  // Prefer the one with more digits + commas (heuristic for HUD lines)
  const score = s => (s.match(/[0-9]/g)||[]).length + (s.match(/[,°]/g)||[]).length;
  return score(retry) > score(primary) ? retry : primary;
}

/* ---------- Tesseract fallback ---------- */
async function tesseractRecognize(dataURL){
  if(!(window.Tesseract && Tesseract.recognize)) return '';
  const { data } = await Tesseract.recognize(dataURL, 'eng', { tessedit_pageseg_mode:6 });
  return (data?.text||'').trim();
}

/* ---------- Parse HUD text ---------- */
function missingCritical(parsed){
  const miss=[];
  for(const k of OCRSPACE_RETRY_IF_MISSING){
    if(k==='lat' || k==='lon'){
      if(isNaN(parsed[k])) miss.push(k);
    }else{
      if(!parsed[k]) miss.push(k);
    }
  }
  return miss;
}

function stripGarbageLines(lines){
  const drop = [
    /^gps\s*map\s*camera/i,
    /^google\b/i,
    /^goo+gle/i,
    /^gps\s*map$/i,
    /^map\s*camera/i
  ];
  return lines.filter(l => {
    const s = l.trim();
    if(!s) return false;
    return !drop.some(re=> re.test(s));
  });
}

function parseHudText(raw){
  if(!raw) return {};
  const lines = stripGarbageLines(raw.split(/\n+/).map(x=>x.trim())).slice(0, 12); // cap
  if(lines.length < 2) return {};

  // Heuristic:
  // - Last meaningful line → date/time (or the "GMT +05:30" line)
  // - One above last → lat/long
  // - Address = everything between (skips the first location title like "Mumbai, Maharashtra, India")
  const last = lines[lines.length-1];
  const prev = lines[lines.length-2] || '';

  // Recover date & time (supports 18/08/2025 03:39 PM, also 2025-08-18 15:39)
  const dtLine = last.replace(/GMT.*$/,'').trim();
  let date='', time='';
  let m = dtLine.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i)
       || dtLine.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/);
  if(m){ date=m[1]; time=m[2]; }

  // Lat/Long
  let lat = NaN, lon = NaN;
  const deg = prev || last; // fallback in some photos where lat/long is in last-1 or last
  let latM = deg.match(/Lat[^0-9\-]*([\-]?\d+\.\d+)/i);
  let lonM = deg.match(/Long[^0-9\-]*([\-]?\d+\.\d+)/i);
  if(latM) lat = parseFloat(latM[1]);
  if(lonM) lon = parseFloat(lonM[1]);

  // Recovery if '.' missing (e.g., 19191141 -> 19.191141)
  if(isNaN(lat)){
    const r = deg.match(/Lat[^0-9\-]*([\-]?\d{2})(\d{6})/i);
    if(r) lat = parseFloat(`${r[1]}.${r[2]}`);
  }
  if(isNaN(lon)){
    const r = deg.match(/Long[^0-9\-]*([\-]?\d{2,3})(\d{6})/i);
    if(r) lon = parseFloat(`${r[1]}.${r[2]}`);
  }

  // Address lines: skip line0 (the big "City, State, Country"), and the last two (lat/long + date)
  const addrLines = lines.slice(1, Math.max(1, lines.length-2));
  const address = addrLines.join(', ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim();

  // Normalize
  const norm = {
    address,
    lat,
    lon,
    date,
    time
  };
  // console view for debugging
  return {
    address: norm.address,
    lat: norm.lat,
    lon: norm.lon,
    date: norm.date,
    time: norm.time
  };
}

/* ---------- Date & Time normalization ---------- */
function toFormDate(d){
  // accepts DD/MM/YYYY, or YYYY-MM-DD
  if(!d) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m){
    const dd = m[1].padStart(2,'0');
    const mm = m[2].padStart(2,'0');
    return `${m[3]}-${mm}-${dd}`;
  }
  return d;
}
function toFormTime(t){
  // accepts HH:mm or HH:mm AM/PM
  if(!t) return '';
  const m12 = t.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if(m12){
    let hh = parseInt(m12[1],10);
    const mm = m12[2];
    const ap = m12[3].toUpperCase();
    if(ap==='AM'){ if(hh===12) hh=0; }
    else { if(hh<12) hh+=12; }
    return `${String(hh).padStart(2,'0')}:${mm}`;
  }
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if(m24){
    return `${m24[1].padStart(2,'0')}:${m24[2]}`;
  }
  return t;
}

/* ==========================================================
   END
   ========================================================== */
