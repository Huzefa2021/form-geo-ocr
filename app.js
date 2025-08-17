/* Huzefa — processing kept simple:
   1) Load image -> show original (25%)
   2) Crop bottom band (CROP_FRACTION)
   3) OCR with Tesseract (eng+Devanagari, no preprocessing)
   4) Parse date, time(without GMT), lat, lon, address
   5) Point-in-polygon on wards, beats, police
   6) Stream results as deduced; show “Outside boundaries” if ward not found
*/

const els = {
  file: document.getElementById('file'),
  drop: document.getElementById('drop'),
  original: document.getElementById('originalImg'),
  originalWrap: document.getElementById('originalWrap'),
  cropCanvas: document.getElementById('cropCanvas'),
  stepUpload: document.getElementById('stepUpload'),
  stepOcr: document.getElementById('stepOcr'),
  stepParse: document.getElementById('stepParse'),
  stepGeo: document.getElementById('stepGeo'),
  stepReview: document.getElementById('stepReview'),
  timings: document.getElementById('timings'),
  alert: document.getElementById('alert'),
  outDate: document.getElementById('outDate'),
  outTime: document.getElementById('outTime'),
  outLat: document.getElementById('outLat'),
  outLon: document.getElementById('outLon'),
  outAddr: document.getElementById('outAddr'),
  outWard: document.getElementById('outWard'),
  outBeat: document.getElementById('outBeat'),
  outPS: document.getElementById('outPS'),
  reset: document.getElementById('btnReset'),
  ocrMode: document.getElementById('ocrMode'),
};

let geo = { wards:null, beats:null, police:null };
let t0 = performance.now();
const marks = { upload:0, ocr:0, parse:0, geo:0, review:0 };

function setChip(el){ [els.stepUpload, els.stepOcr, els.stepParse, els.stepGeo, els.stepReview].forEach(c=>c.classList.remove('active')); el.classList.add('active'); }

function setTiming(label){
  const now = performance.now();
  marks[label]=now;
  const s = [
    `Upload — ${(marks.upload-marks._start||0/0).toFixed(1)}s`,
    `OCR — ${(marks.ocr - marks.upload).toFixed(1)}s`,
    `Parse — ${(marks.parse - marks.ocr).toFixed(1)}s`,
    `GeoJSON — ${(marks.geo - marks.parse).toFixed(1)}s`,
    `Review — ${(marks.review - marks.geo).toFixed(1)}s`
  ].join(' • ');
  els.timings.textContent = s.replace('NaNs','0.0s');
}
marks._start = performance.now(); els.timings.textContent = 'Initializing…';

function showAlert(msg){
  els.alert.textContent = msg;
  els.alert.classList.remove('hidden');
  setTimeout(()=>els.alert.classList.add('hidden'), 5000);
}

async function loadGeo(){
  const [w,b,p] = await Promise.all([
    fetch(window.GEO.wards).then(r=>r.json()),
    fetch(window.GEO.beats).then(r=>r.json()),
    fetch(window.GEO.police).then(r=>r.json())
  ]);
  geo = { wards:w, beats:b, police:p };
}

function readAsDataURL(file){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file); }); }

function drawImageToCanvas(img, canvas, cropFractionBottom){
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const bandH = Math.max(120, Math.floor(ih * cropFractionBottom));
  canvas.width = iw;
  canvas.height = bandH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, ih - bandH, iw, bandH, 0, 0, iw, bandH);
}

async function runTesseractOnCanvas(canvas){
  const worker = await Tesseract.createWorker(/* no logger (avoid clone issues) */);
  try{
    await worker.loadLanguage('eng+hin'); // Devanagari via Hindi covers Marathi
    await worker.initialize('eng+hin');
    const { data:{ text } } = await worker.recognize(canvas);
    return text;
  } finally {
    await worker.terminate();
  }
}

// --- Parsing helpers (minimal & robust) ---
function parseFields(text){
  // Normalize
  let raw = text.replace(/\r/g,'').split('\n').map(s=>s.trim()).filter(Boolean);

  // Date (YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY)
  let date = null;
  for(const s of raw){
    let m = s.match(/\b(\d{4}[-/]\d{2}[-/]\d{2})\b/); // 2025-08-16
    if(m){ date = m[1]; break; }
    m = s.match(/\b(\d{2}[-/]\d{2}[-/]\d{4})\b/);     // 16-08-2025 or 16/08/2025
    if(m){ date = m[1].replace(/\//g,'-'); break; }
  }

  // Time (ignore GMT)
  let time = null;
  for(const s of raw){
    // 10:29 AM GMT +05:30 | 14:48
    let t = s.match(/\b([0-2]?\d:[0-5]\d(?:\s?[AP]M)?)\b/);
    if(t){ time = t[1]; break; }
  }

  // Lat / Lon
  const joined = raw.join(' ');
  let lat = null, lon = null;
  let mLat = joined.match(/Lat(?:itude)?\s*[: ]*\s*([0-9.+-]+)\s*°?/i);
  let mLon = joined.match(/Lon(?:g|gitude)?\s*[: ]*\s*([0-9.+-]+)\s*°?/i);
  if(mLat) lat = parseFloat(mLat[1]);
  if(mLon) lon = parseFloat(mLon[1]);

  // Address: lines between the location header and Lat/Long line
  // Strategy: take all lines that occur before the first line containing 'Lat'
  const latLineIndex = raw.findIndex(s => /Lat(?:itude)?/i.test(s));
  let addrLines = [];
  if(latLineIndex>0){
    addrLines = raw.slice(0, latLineIndex).filter(s =>
      !/Mumbai, Maharashtra, India$/i.test(s) || s.length>20 // keep detailed lines
    );
  }
  // Heuristic: keep the longest line that has commas OR plus code OR pin
  let address = '';
  if(addrLines.length){
    // Remove obvious headers/footer words
    addrLines = addrLines.filter(s => !/^Google$/i.test(s) && !/GPS\s*Map\s*Camera/i.test(s));
    // Prefer the last detailed line (often the best address)
    address = addrLines[addrLines.length-1];
    // If it’s too short, pick the longest
    if(address.length < 12){
      address = addrLines.reduce((a,b)=> (b.length>a.length?b:a), '');
    }
  }

  return { date, time, lat, lon, address, raw };
}

// --- Point in polygon (supports MultiPolygon & holes) ---
function bboxOf(coords){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  coords.forEach(ring=>{
    ring.forEach(([x,y])=>{
      if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y;
    });
  });
  return [minX,minY,maxX,maxY];
}
function inRing([x,y], ring){
  // ray casting
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi) + xi);
    if(intersect) inside = !inside;
  }
  return inside;
}
function featureContains(feature, x, y){
  const g = feature.geometry;
  if(!g) return false;
  if(g.type==='Polygon'){
    const [outer, ...holes] = g.coordinates;
    if(!inRing([x,y], outer)) return false;
    return holes.every(h=>!inRing([x,y], h)); // must not be in a hole
  }
  if(g.type==='MultiPolygon'){
    return g.coordinates.some(poly=>{
      const [outer, ...holes] = poly;
      if(!inRing([x,y], outer)) return false;
      return holes.every(h=>!inRing([x,y], h));
    });
  }
  return false;
}

function lookupPoint(geojson, x, y, propName, label){
  if(!geojson) return null;
  // quick bbox prune
  for(const f of geojson.features){
    const g = f.geometry;
    if(!g) continue;
    let boxes=[];
    if(g.type==='Polygon'){
      boxes.push(bboxOf(g.coordinates));
    }else if(g.type==='MultiPolygon'){
      g.coordinates.forEach(poly=> boxes.push(bboxOf(poly)));
    }
    if(!boxes.some(([minX,minY,maxX,maxY]) => x>=minX && x<=maxX && y>=minY && y<=maxY)) continue;
    if(featureContains(f, x, y)) return f.properties?.[propName] ?? f.properties?.name ?? null;
  }
  return null;
}

async function processFile(file){
  // Reset outputs
  els.outDate.textContent = '—';
  els.outTime.textContent = '—';
  els.outLat.textContent = '—';
  els.outLon.textContent = '—';
  els.outAddr.textContent = '—';
  els.outWard.textContent = '—';
  els.outBeat.textContent = '—';
  els.outPS.textContent = '—';
  els.alert.classList.add('hidden');

  marks._start = performance.now(); setChip(els.stepUpload);
  const dataUrl = await readAsDataURL(file);

  // show original at 25%
  els.original.src = dataUrl;
  els.originalWrap.classList.remove('hidden');

  await new Promise(r=> setTimeout(r, 30)); // allow layout
  drawImageToCanvas(els.original, els.cropCanvas, window.CROP_FRACTION);
  marks.upload = performance.now(); setTiming('upload');

  // OCR - local only (no preprocessing)
  setChip(els.stepOcr);
  const text = await runTesseractOnCanvas(els.cropCanvas);
  marks.ocr = performance.now(); setTiming('ocr');

  // Parse
  setChip(els.stepParse);
  const parsed = parseFields(text);
  if(parsed.date) els.outDate.textContent = parsed.date;
  if(parsed.time) els.outTime.textContent = parsed.time.replace(/\s*GMT.*$/i,'').trim();
  if(Number.isFinite(parsed.lat)) els.outLat.textContent = parsed.lat.toFixed(6);
  if(Number.isFinite(parsed.lon)) els.outLon.textContent = parsed.lon.toFixed(6);
  if(parsed.address) els.outAddr.textContent = parsed.address;
  marks.parse = performance.now(); setTiming('parse');

  // GeoJSON
  setChip(els.stepGeo);
  if(!geo.wards) await loadGeo();
  const lon = Number(parsed.lon), lat = Number(parsed.lat);
  if(Number.isFinite(lon) && Number.isFinite(lat)){
    const ward = lookupPoint(geo.wards, lon, lat, 'WARD', 'Ward');
    const beat = lookupPoint(geo.beats, lon, lat, 'BEAT_NO', 'Beat');
    const ps   = lookupPoint(geo.police, lon, lat, 'PS_NAME', 'PS');
    if(ward) els.outWard.textContent = ward;
    if(beat) els.outBeat.textContent = beat;
    if(ps)   els.outPS.textContent = ps;
    if(!ward){
      showAlert('Outside MCGM Boundaries — Not allowed.');
    }
  }else{
    showAlert('Latitude/Longitude not found in OCR. Cannot run polygon check.');
  }
  marks.geo = performance.now(); setTiming('geo');

  // Review
  setChip(els.stepReview);
  marks.review = performance.now(); setTiming('review');
}

els.file.addEventListener('change', e=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  processFile(f);
});

['dragover','dragenter'].forEach(ev=> els.drop.addEventListener(ev, e=>{e.preventDefault();}));
els.drop.addEventListener('drop', e=>{
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if(f) processFile(f);
});

els.reset.addEventListener('click', ()=>{
  window.location.reload();
});

// preload geo in background
loadGeo().catch(()=>{});
