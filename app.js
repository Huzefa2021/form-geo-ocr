/* ------------------ tiny helpers ------------------ */
const qs = (s, el = document) => el.querySelector(s);
const elTimes = qs('#stageTimes');
const setTimes = (t) => {
  const f = (x) => (x ?? 0).toFixed(1);
  elTimes.textContent =
    `Upload — ${f(t.upload)}s • OCR — ${f(t.ocr)}s • Parse — ${f(t.parse)}s • ` +
    `GeoJSON — ${f(t.geo)}s • Review — ${f(t.review)}s • Redirect — ${f(t.redir)}s`;
};

const times = { upload:0, ocr:0, parse:0, geo:0, review:0, redir:0 };

/* ------------------ DOM refs ------------------ */
const fileInput   = qs('#fileInput');
const dropzone    = qs('#dropzone');
const previewOrig = qs('#originalPreview');
const cropCanvas  = qs('#cropCanvas');
const previewCrop = qs('#cropPreview');

const out = {
  date: qs('#outDate'), time: qs('#outTime'),
  lat: qs('#outLat'), lng: qs('#outLng'),
  addr: qs('#outAddr'), ward: qs('#outWard'),
  beat: qs('#outBeat'), ps: qs('#outPS')
};

const ocrModeSel = qs('#ocrMode');
qs('#btnReset').addEventListener('click', resetAll);

/* ------------------ file handling ------------------ */
let currentImg = null;
let busy = false;

function bindDropzone(){
  // Click -> open native picker
  dropzone.addEventListener('click', () => fileInput.click(), {passive:true});

  // Prevent default browser behavior
  ['dragenter','dragover','dragleave','drop'].forEach(evt=>{
    dropzone.addEventListener(evt, e=>{e.preventDefault(); e.stopPropagation();}, false);
  });

  dropzone.addEventListener('dragover', ()=> dropzone.classList.add('hover'));
  dropzone.addEventListener('dragleave', ()=> dropzone.classList.remove('hover'));

  dropzone.addEventListener('drop', (e)=>{
    dropzone.classList.remove('hover');
    const f = e.dataTransfer.files?.[0];
    if(f) handleFile(f);
  });
  fileInput.addEventListener('change', (e)=>{
    const f = e.target.files?.[0];
    if(f) handleFile(f);
    // clear input to allow re-choose same file
    fileInput.value = '';
  });
}
bindDropzone();

async function handleFile(file){
  if(!file.type.startsWith('image/')) return;
  if(busy) return;
  busy = true;
  const t0 = performance.now();

  const img = new Image();
  img.onload = async () => {
    currentImg = img;
    // show original (25%)
    previewOrig.src = img.src;
    previewOrig.style.display = 'block';

    const cropBlob = cropBottomLeft(img);
    if(cropBlob){
      const url = URL.createObjectURL(cropBlob);
      previewCrop.src = url;
      previewCrop.style.display = 'block';
    }

    times.upload = (performance.now()-t0)/1000;
    setTimes(times);

    await runOCR();
    busy = false;
  };
  img.onerror = () => { busy = false; };
  const reader = new FileReader();
  reader.onload = (ev)=> img.src = ev.target.result;
  reader.readAsDataURL(file);
}

/* ------------------ cropping (bottom band, trim left) ------------------ */
function cropBottomLeft(img){
  const w = img.naturalWidth, h = img.naturalHeight;
  const bandH = Math.round(h * 0.22);               // bottom ~22%
  const y = h - bandH;
  const x = Math.round(w * 0.35);                   // trim left 35% (keeps right 65% where text sits)
  const cropW = Math.max(10, w - x);
  const cropH = bandH;

  cropCanvas.width = cropW; cropCanvas.height = cropH;
  const ctx = cropCanvas.getContext('2d');
  ctx.drawImage(img, x, y, cropW, cropH, 0, 0, cropW, cropH);

  // sharpen/contrast a bit for OCR
  const imgData = ctx.getImageData(0,0,cropW,cropH);
  const d = imgData.data;
  for(let i=0;i<d.length;i+=4){
    // simple luma
    let g = (d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114);
    // raise contrast
    g = Math.max(0, Math.min(255, (g-128)*1.25 + 128));
    d[i]=d[i+1]=d[i+2]=g;
  }
  ctx.putImageData(imgData,0,0);

  // return as blob
  try{
    return dataURLToBlob(cropCanvas.toDataURL('image/png'));
  }catch{ return null; }
}
function dataURLToBlob(dataURL){
  const arr = dataURL.split(','), mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]); let n = bstr.length;
  const u8 = new Uint8Array(n); while(n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], {type: mime});
}

/* ------------------ OCR + parse ------------------ */
async function runOCR(){
  if(!previewCrop.src) return;
  const t0 = performance.now();
  let lang = 'eng+hin';
  const sel = (ocrModeSel.value || 'auto').toLowerCase();
  if(sel === 'eng') lang = 'eng';
  if(sel === 'hin') lang = 'hin';

  let text='';
  try{
    const { data } = await Tesseract.recognize(previewCrop.src, lang, {
      logger: m => { /* could place per-progress UI here */ }
    });
    text = (data?.text || '').trim();
  }catch(e){
    // fallback purely eng if something failed
    try{
      const { data } = await Tesseract.recognize(previewCrop.src, 'eng');
      text = (data?.text || '').trim();
    }catch{}
  }
  times.ocr = (performance.now()-t0)/1000;
  setTimes(times);

  const t1 = performance.now();
  const parsed = parseOverlay(text);
  out.date.textContent = parsed.date || '—';
  out.time.textContent = parsed.time || '—';
  out.lat.textContent  = parsed.lat ?? '—';
  out.lng.textContent  = parsed.lng ?? '—';
  out.addr.textContent = parsed.address || '—';
  times.parse = (performance.now()-t1)/1000;
  setTimes(times);

  // GeoJSON lookups
  const t2 = performance.now();
  if(parsed.lat != null && parsed.lng != null){
    const g = await geoLookups(Number(parsed.lat), Number(parsed.lng));
    out.ward.textContent = g.ward || '—';
    out.beat.textContent = g.beat || '—';
    out.ps.textContent   = g.ps || '—';
  }
  times.geo = (performance.now()-t2)/1000;
  setTimes(times);
}

/* Robust parsing from GPS Map Camera overlays */
function parseOverlay(text){
  // Normalize
  let s = text.replace(/[|•]/g,' ').replace(/[^\S\r\n]+/g,' ').trim();

  // DATE (DD-MM-YYYY / DD/MM/YYYY)
  const dateMatch = s.match(/\b(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b/);
  const date = dateMatch ? dateMatch[1].replace(/\//g,'-') : '';

  // TIME (HH:MM [AM/PM] optional)
  const timeMatch = s.match(/\b(\d{1,2}[:.]\d{2})\s?(AM|PM)?\b/i);
  const time = timeMatch ? timeMatch[1].replace('.',':') : '';

  // LAT & LNG (after 'Lat' / 'Long' tokens)
  // accept 19.15927° / 72.840064° etc
  const latMatch = s.match(/Lat[^0-9\-+]*([\-+]?\d{1,2}\.\d{4,})/i) || s.match(/Lat[^0-9\-+]*([\-+]?\d{1,2}\.\d+)/i);
  const lngMatch = s.match(/Lon[g]?[^0-9\-+]*([\-+]?\d{1,3}\.\d{4,})/i) || s.match(/Lon[g]?[^0-9\-+]*([\-+]?\d{1,3}\.\d+)/i);

  let lat = latMatch ? latMatch[1] : null;
  let lng = lngMatch ? lngMatch[1] : null;

  // If text accidentally swapped (rare), correct by bounds
  if(lat && lng){
    const la = Number(lat), lo = Number(lng);
    if(Math.abs(la) > 90 && Math.abs(lo) <= 90){ // swapped
      [lat,lng] = [lng,lat];
    }
  }

  // ADDRESS — take a block near “India”
  let address = '';
  const indiaAt = s.lastIndexOf('India');
  if(indiaAt > -1){
    // capture prior 200 chars until before Lat/Lon
    let block = s.slice(Math.max(0, indiaAt - 240), indiaAt + 5);
    // remove lat/long lines if OCR joined
    block = block.replace(/Lat.*$/mi,'').replace(/Lon[g]?.*$/mi,'');
    // tidy punctuation noise
    address = block.replace(/\s{2,}/g,' ').replace(/[^\w\s,\/\-\(\)]+/g, ' ').replace(/\s{2,}/g,' ').trim();
  }

  return {
    date, time,
    lat: lat ? Number(lat).toFixed(6) : null,
    lng: lng ? Number(lng).toFixed(6) : null,
    address
  };
}

/* ------------------ GeoJSON lookup ------------------ */
async function geoLookups(lat, lng){
  const pt = [lng, lat]; // GeoJSON uses [lng,lat]

  const wards = await loadGeo('data/wards.geojson', '/wards.geojson');
  const beats = await loadGeo('data/beats.geojson', '/beats.geojson');
  const ps    = await loadGeo('data/police_jurisdiction.geojson', '/police_jurisdiction.geojson');

  const ward = findInFeatures(wards, pt, ['WARD','ward','Ward_No','WARD_NO']);
  const beat = findInFeatures(beats, pt, ['BEAT_NO','beat','Beat_No','BEAT']);
  const poli = findInFeatures(ps,    pt, ['PS_NAME','PoliceStat','PS','POLICE_STN']);

  return {
    ward: ward?.val || '',
    beat: beat?.val || '',
    ps:   poli?.val || ''
  };
}
async function loadGeo(primary, fallback){
  for(const url of [primary, fallback]){
    try{
      const r = await fetch(url, {cache:'no-store'});
      if(r.ok) return await r.json();
    }catch{}
  }
  return { type:'FeatureCollection', features:[] };
}
function findInFeatures(geo, pt, keys){
  if(!geo?.features?.length) return null;
  for(const f of geo.features){
    if(pointInFeature(pt, f.geometry)){
      const props = f.properties || {};
      for(const k of keys){
        if(props[k] != null) return { val: String(props[k]) };
      }
      return { val:'' };
    }
  }
  return null;
}
function pointInFeature(pt, geom){
  if(!geom) return false;
  const type = geom.type;
  if(type === 'Polygon') return ringHit(pt, geom.coordinates);
  if(type === 'MultiPolygon') return geom.coordinates.some(r => ringHit(pt, r));
  return false;
}
function ringHit(pt, rings){
  // first ring is outer, rest holes. we only check outer for this use-case
  return pointInPolygon(pt, rings[0]);
}
function pointInPolygon(pt, poly){
  let [x,y]=pt, inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][0], yi=poly[i][1];
    const xj=poly[j][0], yj=poly[j][1];
    const intersect = ((yi>y)!==(yj>y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if(intersect) inside = !inside;
  }
  return inside;
}

/* ------------------ reset ------------------ */
function resetAll(){
  previewOrig.src = ''; previewOrig.style.display='none';
  previewCrop.src = ''; previewCrop.style.display='none';
  cropCanvas.width = cropCanvas.height = 0;

  for(const k of Object.keys(out)){ out[k].textContent='—'; }
  fileInput.value = '';
  Object.keys(times).forEach(k=>times[k]=0);
  setTimes(times);
}

/* init */
setTimes(times);
