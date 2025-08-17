/* App logic (UI unchanged)
 * - Trims right side of cropped band to reduce noise icons
 * - Stronger lat/lon parsing (handles 19 15927 → 19.15927 etc.)
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

// ---- tunables (you can tweak without touching code) ----
const CROP_FRACTION = (typeof window.CROP_FRACTION === 'number') ? window.CROP_FRACTION : 0.28; // bottom band height
const RIGHT_TRIM_FRACTION = (typeof window.RIGHT_TRIM_FRACTION === 'number') ? window.RIGHT_TRIM_FRACTION : 0.18; // trim right 18%

let geo = { wards:null, beats:null, police:null };
const marks = { _start: performance.now(), upload:0, ocr:0, parse:0, geo:0, review:0 };

function setChip(el){
  [els.stepUpload, els.stepOcr, els.stepParse, els.stepGeo, els.stepReview]
    .forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
}
function setTiming(){
  const s = [
    `Upload — ${((marks.upload - marks._start)/1000).toFixed(1)}s`,
    `OCR — ${((marks.ocr - marks.upload)/1000).toFixed(1)}s`,
    `Parse — ${((marks.parse - marks.ocr)/1000).toFixed(1)}s`,
    `GeoJSON — ${((marks.geo - marks.parse)/1000).toFixed(1)}s`,
    `Review — ${((marks.review - marks.geo)/1000).toFixed(1)}s`,
  ].join(' • ');
  els.timings.textContent = s;
}
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

// ---- CROPPING: trim bottom band, and shave the right side ----
function drawImageToCanvas(img, canvas, cropFractionBottom, rightTrimFraction){
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const bandH = Math.max(120, Math.floor(ih * cropFractionBottom));
  const trimW = Math.max(0, Math.floor(iw * (rightTrimFraction || 0)));
  const sWidth = Math.max(1, iw - trimW);

  canvas.width = sWidth;
  canvas.height = bandH;
  const ctx = canvas.getContext('2d');
  // source: bottom band; exclude rightmost trim
  ctx.drawImage(img, 0, ih - bandH, sWidth, bandH, 0, 0, sWidth, bandH);
}

async function runTesseractOnCanvas(canvas){
  const worker = await Tesseract.createWorker();
  try{
    await worker.loadLanguage('eng+hin');
    await worker.initialize('eng+hin');
    const { data:{ text } } = await worker.recognize(canvas);
    return text || '';
  } finally {
    await worker.terminate();
  }
}

/* ---------------- Parsing helpers ---------------- */

function normalizeCoord(num, isLat){
  if(!Number.isFinite(num)) return null;
  const limit = isLat ? 90 : 180;
  let val = num, tries = 0;
  while(Math.abs(val) > limit && tries < 8){
    val = val / 10;
    tries++;
  }
  return (Math.abs(val) <= limit) ? val : null;
}

// Mumbai specific decimal recovery if OCR lost the dot
function recoverMumbaiDecimal(digits, isLat){
  if(!digits) return null;
  const n = digits.replace(/\D/g,'');
  if(n.length < 6) return null;
  const split = 2; // 19.xx / 72.xx
  const val = parseFloat(n.slice(0,split) + '.' + n.slice(split));
  return normalizeCoord(val, isLat);
}

// Try to read number after label on line, with multiple strategies
function extractCoordFromLines(lines, labelRegex, isLat){
  const idx = lines.findIndex(s => labelRegex.test(s));
  if(idx === -1) return null;

  const candidates = [];
  const consider = [];

  // look on same line and next line
  consider.push(lines[idx]);
  if(lines[idx+1]) consider.push(lines[idx+1]);

  for(const line of consider){
    // 1) plain decimal with optional degree
    const m1 = line.match(/([+-]?\d{1,3}(?:[.,]\d{1,9})?)\s*[°o]?/);
    if(m1){
      const v = parseFloat(m1[1].replace(',', '.'));
      const n = normalizeCoord(v, isLat);
      if(n != null) candidates.push(n);
    }

    // 2) digit groups like "19 15927" → join into 19.15927 (Mumbai heuristic)
    const after = line.replace(/^.*?(Lat(?:itude)?|Lon(?:g(?:itude)?|g\.?)|Lng)\s*[:\-]?\s*/i,'');
    const groups = after.match(/\d+/g);
    if(groups && groups.length >= 2){
      const first = parseInt(groups[0],10);
      const frac  = groups.slice(1).join(''); // keep all following chunks together
      if(isLat && first>=18 && first<=21 && frac.length>=2){
        const nn = parseFloat(`${first}.${frac}`);
        const n  = normalizeCoord(nn, true);
        if(n!=null) candidates.push(n);
      }
      if(!isLat && first>=70 && first<=75 && frac.length>=2){
        const nn = parseFloat(`${first}.${frac}`);
        const n  = normalizeCoord(nn, false);
        if(n!=null) candidates.push(n);
      }
    }

    // 3) digits-only recovery on the line
    const digits = (line.match(/([0-9][0-9 .]*)/) || [,''])[1];
    const rec = recoverMumbaiDecimal(digits, isLat);
    if(rec != null) candidates.push(rec);
  }

  if(!candidates.length) return null;

  // choose the candidate with most precision (max decimals)
  const best = candidates
    .map(v => ({ v, decs: (v.toString().split('.')[1]||'').length }))
    .sort((a,b)=> b.decs - a.decs)[0].v;

  return best;
}

function pickAddress(lines){
  const latIdx = lines.findIndex(s => /Lat(?:itude)?/i.test(s));
  const search = (latIdx > 0) ? lines.slice(0, latIdx) : lines.slice();
  const pin  = /\b\d{6}\b/;
  const plus = /\b[A-Za-z0-9]{4,}\+[A-Za-z0-9]{2,}\b/;
  const cands = search.filter(s =>
    pin.test(s) || plus.test(s) || (s.split(',').length-1)>=2 || /Mumbai|Maharashtra/i.test(s)
  );
  if(cands.length){
    let best = cands.reduce((a,b)=> b.length>a.length?b:a);
    best = best.replace(/[^A-Za-z0-9,+\-&/(). ]+/g,' ').replace(/\s{2,}/g,' ').replace(/\s+,/g,',').trim();
    return best;
  }
  let fallback = lines.reduce((a,b)=> b.length>a.length?b:a, '');
  return fallback.replace(/\s{2,}/g,' ').trim();
}

function parseFields(text){
  const lines = text.replace(/\r/g,'').split('\n').map(s=>s.trim()).filter(Boolean);

  // Date
  let date = null;
  for(const s of lines){
    let m = s.match(/\b(\d{4}[-/]\d{2}[-/]\d{2})\b/);
    if(m){ date = m[1].replace(/\//g,'-'); break; }
    m = s.match(/\b(\d{2}[-/]\d{2}[-/]\d{4})\b/);
    if(m){ date = m[1].replace(/\//g,'-'); break; }
  }

  // Time
  let time = null;
  for(const s of lines){
    const m = s.match(/\b([0-2]?\d:[0-5]\d(?:\s?[AP]M)?)\b/);
    if(m){ time = m[1]; break; }
  }

  // Coordinates
  let lat = extractCoordFromLines(lines, /Lat(?:itude)?/i, true);
  let lon = extractCoordFromLines(lines, /Lon(?:g|gitude|g\.)|Lng/i, false);

  // Address
  const address = pickAddress(lines);

  return { date, time, lat, lon, address, raw: lines };
}

/* ---------------- Point-in-Polygon ---------------- */

function bboxOf(coords){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  coords.forEach(r=>r.forEach(([x,y])=>{
    if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y;
  }));
  return [minX,minY,maxX,maxY];
}
function inRing([x,y], ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi) + xi);
    if(intersect) inside = !inside;
  }
  return inside;
}
function featureContains(feature, x, y){
  const g = feature.geometry;
  if(!g) return false;
  if(g.type==='Polygon'){
    const [outer,...holes]=g.coordinates;
    if(!inRing([x,y], outer)) return false;
    return holes.every(h=>!inRing([x,y],h));
  }
  if(g.type==='MultiPolygon'){
    return g.coordinates.some(poly=>{
      const [outer,...holes]=poly;
      if(!inRing([x,y], outer)) return false;
      return holes.every(h=>!inRing([x,y],h));
    });
  }
  return false;
}
function lookupPoint(geojson, x, y, prop){
  if(!geojson) return null;
  for(const f of geojson.features){
    const g=f.geometry; if(!g) continue;
    let boxes=[];
    if(g.type==='Polygon') boxes.push(bboxOf(g.coordinates));
    else if(g.type==='MultiPolygon') g.coordinates.forEach(poly=> boxes.push(bboxOf(poly)));
    if(!boxes.some(([minX,minY,maxX,maxY])=> x>=minX && x<=maxX && y>=minY && y<=maxY)) continue;
    if(featureContains(f, x, y)) return f.properties?.[prop] ?? f.properties?.name ?? null;
  }
  return null;
}

/* ---------------- Main flow ---------------- */

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

  marks._start = performance.now();
  setChip(els.stepUpload);

  const dataUrl = await readAsDataURL(file);

  // show original at 25%
  els.original.src = dataUrl;
  els.originalWrap.classList.remove('hidden');

  await new Promise(r=> setTimeout(r, 30));
  drawImageToCanvas(els.original, els.cropCanvas, CROP_FRACTION, RIGHT_TRIM_FRACTION);
  marks.upload = performance.now(); setTiming();

  // OCR
  setChip(els.stepOcr);
  const text = await runTesseractOnCanvas(els.cropCanvas);
  marks.ocr = performance.now(); setTiming();

  // Parse
  setChip(els.stepParse);
  const parsed = parseFields(text);

  if(parsed.date) els.outDate.textContent = parsed.date;
  if(parsed.time) els.outTime.textContent = parsed.time.replace(/\s*GMT.*$/i,'').trim();

  if(Number.isFinite(parsed.lat)) els.outLat.textContent = parsed.lat.toFixed(6);
  if(Number.isFinite(parsed.lon)) els.outLon.textContent = parsed.lon.toFixed(6);
  if(parsed.address) els.outAddr.textContent = parsed.address;

  marks.parse = performance.now(); setTiming();

  // GeoJSON
  setChip(els.stepGeo));
  if(!geo.wards) await loadGeo();

  const lon = Number(parsed.lon), lat = Number(parsed.lat);
  if(Number.isFinite(lon) && Number.isFinite(lat)){
    const ward = lookupPoint(geo.wards, lon, lat, 'WARD');
    const beat = lookupPoint(geo.beats, lon, lat, 'BEAT_NO');
    const ps   = lookupPoint(geo.police, lon, lat, 'PS_NAME');
    if(ward) els.outWard.textContent = ward;
    if(beat) els.outBeat.textContent = beat;
    if(ps)   els.outPS.textContent = ps;
    if(!ward){
      showAlert('Outside MCGM Boundaries — Not allowed.');
    }
  } else {
    showAlert('Latitude/Longitude not found in OCR. Cannot run polygon check.');
  }

  marks.geo = performance.now(); setTiming();

  setChip(els.stepReview);
  marks.review = performance.now(); setTiming();
}

/* events */
els.file.addEventListener('change', e=>{
  const f = e.target.files && e.target.files[0];
  if(f) processFile(f);
});
['dragover','dragenter'].forEach(ev=> els.drop.addEventListener(ev, e=>{e.preventDefault();}));
els.drop.addEventListener('drop', e=>{
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if(f) processFile(f);
});
els.reset.addEventListener('click', ()=> window.location.reload() );

/* prefetch geo (non-blocking) */
loadGeo().catch(()=>{});
