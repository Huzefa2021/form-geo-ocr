/* app.js — stable DnD + single-open picker + guaranteed cropped overlay preview */

/* ======================== CONFIG ======================== */
const CFG = {
  paths: {
    wards: './data/wards.geojson',
    beats: './data/beats.geojson',
    police: './data/police_jurisdiction.geojson',
  },
  crop: {
    // search band for the dark ribbon
    bottomStartFrac: 0.72,
    ribbonMinHeightFrac: 0.16,
    ribbonMaxHeightFrac: 0.26,
    // trim the small map and badge on the left
    leftCutPx: 80,
    // a little right breathing room
    rightPadPx: 16,
    // absolute fallback rectangle (if the detector can’t find the ribbon)
    fallbackRect: { xFrac: 0.35, yFrac: 0.74, wFrac: 0.60, hFrac: 0.22 }
  },
  cityWindow: { latMin: 18.0, latMax: 20.8, lngMin: 72.0, lngMax: 73.3 },
  dom: {
    input: '#file,#fileInput,input[type=file]',
    origImg:  '#orig-preview',
    cropImg:  '#crop-preview',
    date: '#res-date', time: '#res-time',
    lat:  '#res-lat',  lng:  '#res-lng',
    addr: '#res-address',
    ward: '#res-ward', beat: '#res-beat', ps: '#res-ps',
    perf: '#perf-line'
  }
};

/* ===================== DOM HELPERS ====================== */
const $ = s => document.querySelector(s);
const setText = (sel, v) => { const el = $(sel); if (el) el.textContent = v ?? '—'; };
const setImg  = (sel, src) => { const el = $(sel); if (el && src) { el.src = src; el.style.display='block'; el.style.maxWidth='100%'; el.style.height='auto'; } };

function findHeading(regex) {
  const nodes = document.querySelectorAll('h1,h2,h3,h4,h5,h6,.card-title,.panel-title,legend');
  for (const n of nodes) if (regex.test(n.textContent || '')) return n;
  return null;
}
function findCardBody(headingNode) {
  if (!headingNode) return null;
  let p = headingNode.parentElement;
  let candidates = [headingNode.nextElementSibling, p && p.nextElementSibling, p];
  for (const c of candidates) {
    if (!c) continue;
    if (c.querySelector('img') || c.clientHeight >= 60) return c;
  }
  return p || headingNode;
}
function findCropHost() {
  // Preferred: explicit hook
  return document.querySelector('[data-crop-host]')
      // Next: by heading text
      || (()=>{
          const h = findHeading(/cropped overlay|gps text|overlay/i);
          return h ? findCardBody(h) : null;
         })()
      // Known class/id fallbacks
      || document.querySelector('#crop-panel, .crop-panel, .results-right, .card:has(#res-address)')
      // As a last resort: the results card parent
      || document.querySelector('#res-address')?.closest('.card, .panel, .box')
      // Absolute fallback
      || document.body;
}

/* create preview <img> if missing */
function ensurePreviewImages() {
  // Original
  if (!$(CFG.dom.origImg)) {
    const dz = findDropZone();
    if (dz) {
      const img = document.createElement('img');
      img.id = CFG.dom.origImg.slice(1);
      img.alt = 'Original Photo';
      img.style.display = 'block';
      img.style.maxWidth = '90%';
      img.style.margin = '16px auto';
      img.style.height = 'auto';
      dz.appendChild(img);
    }
  }
  // Cropped
  if (!$(CFG.dom.cropImg)) {
    const host = findCropHost();
    const img = document.createElement('img');
    img.id = CFG.dom.cropImg.slice(1);
    img.alt = 'Cropped Overlay (GPS text)';
    img.style.display = 'block';
    img.style.maxWidth = '90%';
    img.style.margin = '12px auto';
    img.style.height = 'auto';
    host.appendChild(img);
  }
}

/* =================== DROP ZONE DETECTION =================== */
function findDropZone() {
  let dz = document.querySelector('[data-dropzone]') ||
           document.querySelector('.dropzone, .upload-drop, .dashed, .uploader, .upload-box');
  if (dz) return dz;

  const all = Array.from(document.querySelectorAll('div,section,article'));
  const txt = all.find(el => /tap to choose image|drag & drop/i.test(el.textContent || ''));
  if (txt) return txt;

  return all.find(el => {
    const cs = getComputedStyle(el);
    return (parseInt(cs.borderWidth,10) >= 1 && cs.borderStyle.includes('dashed') && el.clientHeight > 80);
  }) || document.body;
}

/* =================== BITMAP / CANVAS UTILS =================== */
async function fileToBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch {}
  }
  // Fallback: FileReader -> Image -> draw to canvas -> pseudo-bitmap
  const dataURL = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const imgEl = await new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = dataURL;
  });
  const c = document.createElement('canvas');
  c.width = imgEl.naturalWidth; c.height = imgEl.naturalHeight;
  c.getContext('2d').drawImage(imgEl, 0, 0);
  return { width: c.width, height: c.height, _canvas: c };
}
function canvasFromBitmap(bmp) {
  if (bmp._canvas) return bmp._canvas;
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return c;
}
function dataURLFromCanvas(cv) { return cv.toDataURL('image/jpeg', 0.92); }

/* bottom-ribbon auto crop */
function computeRibbonRect(bmp) {
  const { width:w, height:h } = bmp;
  const ctx = canvasFromBitmap(bmp).getContext('2d', { willReadFrequently: true });
  const startY = Math.floor(h * CFG.crop.bottomStartFrac);
  const scanH  = Math.max(1, h - startY);
  const imgData = ctx.getImageData(0, startY, w, scanH);
  const px = imgData.data;

  const rowLuma = new Float32Array(scanH);
  for (let y = 0; y < scanH; y++) {
    let sum = 0; let off = y * w * 4;
    for (let x = 0; x < w; x++, off += 4) {
      const r = px[off], g = px[off+1], b = px[off+2];
      sum += 0.2126*r + 0.7152*g + 0.0722*b;
    }
    rowLuma[y] = sum / w;
  }
  const minH = Math.max(10, Math.floor(h * CFG.crop.ribbonMinHeightFrac));
  const maxH = Math.max(minH+4, Math.floor(h * CFG.crop.ribbonMaxHeightFrac));
  let best = null;
  for (let hh = minH; hh <= maxH; hh += Math.max(4, Math.floor(h*0.01))) {
    for (let y = 0; y + hh <= scanH; y += 4) {
      let acc = 0;
      for (let t = 0; t < hh; t++) acc += rowLuma[y+t];
      const avg = acc / hh;
      if (!best || avg < best.avg) best = { y, hh, avg };
    }
  }
  if (!best) return null;
  const x = Math.max(CFG.crop.leftCutPx, 0);
  const y = startY + best.y;
  const rectW = Math.max(10, w - x - CFG.crop.rightPadPx);
  const rectH = Math.max(10, best.hh);
  return { x, y, w: rectW, h: rectH };
}
function validRect(r, w, h) {
  return !!r && r.w > 10 && r.h > 10 && r.x >= 0 && r.y >= 0 && (r.x + r.w) <= w && (r.y + r.h) <= h;
}
function cropCanvas(bmp, rect) {
  const src = canvasFromBitmap(bmp);
  const c = document.createElement('canvas');
  c.width = rect.w; c.height = rect.h;
  c.getContext('2d').drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return c;
}

/* =================== OCR & PARSING =================== */
function norm(s){
  return s.replace(/[|]/g,'1').replace(/O/g,'0').replace(/°/g,'')
          .replace(/\u00A0/g,' ').replace(/—/g,'-').replace(/,\s*(\d)/g,'.$1');
}
const LAT_PATTS=[/(?:\bLat(?:itude)?\b)[:\s]*([+-]?\d{1,2}[.,]?\d{3,8})/i,/\b([12]\d\.\d{4,8})\b(?=[^\d]{0,6}\b(?:Long|Lon|Lng)\b)/i];
const LNG_PATTS=[/(?:\bLon(?:g|gitude)?\b)[:\s]*([+-]?\d{1,3}[.,]?\d{3,8})/i,/\b(7[02]\.\d{4,8})\b/];
function pickLatLng(text){
  const t=norm(text);
  const tryP=ps=>{for(const p of ps){const m=t.match(p);if(m) return parseFloat(m[1].replace(',', '.'));}return null;};
  let lat=tryP(LAT_PATTS), lng=tryP(LNG_PATTS);
  const inLat=v=>v!=null&&v>=CFG.cityWindow.latMin&&v<=CFG.cityWindow.latMax;
  const inLng=v=>v!=null&&v>=CFG.cityWindow.lngMin&&v<=CFG.cityWindow.lngMax;
  if(!inLat(lat)||!inLng(lng)){
    const nums=Array.from(t.matchAll(/\b-?\d{1,3}[.,]\d{3,8}\b/g)).map(m=>parseFloat(m[0].replace(',', '.')));
    if(!inLat(lat)) lat=nums.find(inLat)??lat;
    if(!inLng(lng)) lng=nums.find(inLng)??lng;
  }
  return { lat: (lat!=null&&lat>=-90&&lat<=90)?lat:null, lng:(lng!=null&&lng>=-180&&lng<=180)?lng:null };
}
function pickDateTime(text){
  const t=norm(text);
  const dm=t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  const dateStr=dm?`${dm[3]}-${String(dm[2]).padStart(2,'0')}-${String(dm[1]).padStart(2,'0')}`:'—';
  const tm=t.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  let timeStr='—'; if(tm){let hh=parseInt(tm[1],10), mm=tm[2], ap=(tm[3]||'').toUpperCase(); if(ap==='PM'&&hh<12)hh+=12; if(ap==='AM'&&hh===12)hh=0; timeStr=`${String(hh).padStart(2,'0')}:${mm}`;}
  return {dateStr,timeStr};
}
function pickAddress(text){
  const clean=norm(text).replace(/[^\w\s,+\-./()#]/g,' ').replace(/\s{2,}/g,' ').trim();
  const lines=clean.split(/\n/).map(s=>s.trim()).filter(Boolean);
  const cue=/(mumbai|maharashtra|india|road|rd|nagar|colony|society|west|east|andheri|goregaon)/i;
  let picked=lines.filter(l=>cue.test(l)); if(!picked.length) picked=lines;
  let addr=picked.join(', ').replace(/\bGMT.*$/i,'').replace(/\b(?:AM|PM)\b.*$/i,'').trim();
  return addr || '—';
}
async function ocrCanvas(canvas, lang='eng'){
  const res=await Tesseract.recognize(canvas, lang, { logger:()=>{} });
  return (res&&res.data&&res.data.text)?res.data.text:'';
}

/* =================== GEOJSON GRID =================== */
const geoIndex={wards:null,beats:null,police:null,grid:{wards:new Map(),beats:new Map(),police:new Map()},bbox:{wards:null,beats:null,police:null},loaded:false};
async function loadGeo(){
  if(geoIndex.loaded) return;
  const [wards,beats,police]=await Promise.all([
    fetch(CFG.paths.wards).then(r=>r.json()),
    fetch(CFG.paths.beats).then(r=>r.json()),
    fetch(CFG.paths.police).then(r=>r.json()),
  ]);
  geoIndex.wards=wards; geoIndex.beats=beats; geoIndex.police=police;
  buildGrid('wards',wards); buildGrid('beats',beats); buildGrid('police',police);
  geoIndex.loaded=true;
}
function buildGrid(kind, gj, cells=50){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  gj.features.forEach(f=>{const b=bboxOfFeature(f);minX=Math.min(minX,b[0]);minY=Math.min(minY,b[1]);maxX=Math.max(maxX,b[2]);maxY=Math.max(maxY,b[3]);});
  geoIndex.bbox[kind]=[minX,minY,maxX,maxY];
  const grid=geoIndex.grid[kind], dx=(maxX-minX)/cells, dy=(maxY-minY)/cells;
  gj.features.forEach((f,idx)=>{const b=bboxOfFeature(f);
    const x0=Math.floor((b[0]-minX)/dx),x1=Math.floor((b[2]-minX)/dx),
          y0=Math.floor((b[1]-minY)/dy),y1=Math.floor((b[3]-minY)/dy);
    for(let x=Math.max(0,x0);x<=Math.min(cells-1,x1);x++)
      for(let y=Math.max(0,y0);y<=Math.min(cells-1,y1);y++){
        const key=`${x}:${y}`; if(!grid.has(key)) grid.set(key,[]); grid.get(key).push(idx);
      }
  });
}
function bboxOfFeature(f){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const each=a=>a.forEach(([x,y])=>{minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);});
  const g=f.geometry; if(g.type==='Polygon') g.coordinates.forEach(r=>each(r));
  else if(g.type==='MultiPolygon') g.coordinates.forEach(poly=>poly.forEach(r=>each(r)));
  return [minX,minY,maxX,maxY];
}
function pointInPoly([x,y], geom){
  const edge=(ring)=>{let ins=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    const hit=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi); if(hit) ins=!ins;
  } return ins;};
  if(geom.type==='Polygon') return edge(geom.coordinates[0]);
  if(geom.type==='MultiPolygon') return geom.coordinates.some(poly=>edge(poly[0]));
  return false;
}
function hitsFor(kind, lon, lat){
  const gj=geoIndex[kind]; if(!gj) return null; const [minX,minY,maxX,maxY]=geoIndex.bbox[kind];
  if(lon<minX||lon>maxX||lat<minY||lat>maxY) return null;
  const cells=50, dx=(maxX-minX)/cells, dy=(maxY-minY)/cells;
  const cx=Math.max(0,Math.min(cells-1,Math.floor((lon-minX)/dx)));
  const cy=Math.max(0,Math.min(cells-1,Math.floor((lat-minY)/dy)));
  const bucket=geoIndex.grid[kind].get(`${cx}:${cy}`)||[];
  for(const idx of bucket){
    const f=gj.features[idx], bb=bboxOfFeature(f);
    if(!(lon>=bb[0]&&lon<=bb[2]&&lat>=bb[1]&&lat<=bb[3])) continue;
    if(pointInPoly([lon,lat],f.geometry)) return f;
  }
  return null;
}
const propsOf = f => f ? (f.properties || f.attrs || {}) : {};

/* =================== PIPELINE =================== */
async function processFile(file){
  if(!file || !/^image\/(jpeg|png)$/i.test(file.type)) { alert('Please upload a JPG or PNG image.'); return; }

  ensurePreviewImages();

  const t0=performance.now();
  const bmp=await fileToBitmap(file);
  const originalUrl=dataURLFromCanvas(canvasFromBitmap(bmp));
  setImg(CFG.dom.origImg, originalUrl);

  let rect=computeRibbonRect(bmp);
  // Make sure we always have a valid rectangle
  if(!validRect(rect, bmp.width, bmp.height)) {
    const f=CFG.crop.fallbackRect;
    rect = { x: Math.floor(bmp.width*f.xFrac), y: Math.floor(bmp.height*f.yFrac),
             w: Math.floor(bmp.width*f.wFrac), h: Math.floor(bmp.height*f.hFrac) };
  }

  const cropCv=cropCanvas(bmp, rect);
  setImg(CFG.dom.cropImg, dataURLFromCanvas(cropCv));

  const t1=performance.now();

  // OCR with Marathi fallback when Devanagari is detected
  let txtEng=await ocrCanvas(cropCv,'eng');
  let text=txtEng;
  if(/[क़-ॿ]/.test(txtEng)) {
    try {
      const txtMar=await ocrCanvas(cropCv,'mar');
      text = (txtMar.length > txtEng.length) ? `${txtEng}\n${txtMar}` : `${txtMar}\n${txtEng}`;
    } catch {}
  }
  const t2=performance.now();

  const {dateStr,timeStr}=pickDateTime(text);
  const {lat,lng}=pickLatLng(text);
  const addr=pickAddress(text);

  setText(CFG.dom.date, dateStr);
  setText(CFG.dom.time, timeStr);
  setText(CFG.dom.lat,  lat!=null ? lat.toFixed(6) : '—');
  setText(CFG.dom.lng,  lng!=null ? lng.toFixed(6) : '—');
  setText(CFG.dom.addr, addr || '—');

  let ward='—', beat='—', ps='—';
  if(lat!=null && lng!=null){
    await loadGeo();
    const fW=hitsFor('wards',lng,lat);
    const fB=hitsFor('beats',lng,lat);
    const fP=hitsFor('police',lng,lat);
    const pW=propsOf(fW), pB=propsOf(fB), pP=propsOf(fP);
    ward=pW.WARD||pW.ward||pW.name||'—';
    beat=pB.BEAT_NO||pB.beat||pB.name||'—';
    ps  =pP.PS_NAME||pP.name ||pP.station||'—';
  }
  setText(CFG.dom.ward, ward);
  setText(CFG.dom.beat, beat);
  setText(CFG.dom.ps, ps);

  const t3=performance.now();
  setText(CFG.dom.perf, `Upload — ${((t1-t0)/1000).toFixed(1)}s • OCR — ${((t2-t1)/1000).toFixed(1)}s • Parse — 0.0s • GeoJSON — ${((t3-t2)/1000).toFixed(1)}s`);
}

/* =================== WIRING (single-open & once) =================== */
let WIRED = false;
let openingPicker = false;

function wireInputAndDrop(){
  if (WIRED) return; WIRED = true;

  const input = document.querySelector(CFG.dom.input);
  const drop  = findDropZone();
  ensurePreviewImages();

  // Avoid double-open if input is inside label
  const hasInnerLabel = drop && drop.querySelector('label[for]');

  if (drop && input && !hasInnerLabel) {
    drop.style.cursor = 'pointer';
    drop.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (openingPicker) return;
      openingPicker = true;
      input.click();
      setTimeout(() => openingPicker = false, 600);
    }, { passive:false });
  }

  if (input) {
    input.setAttribute('accept', 'image/jpeg,image/png');
    input.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) { processFile(f); try { e.target.value = ''; } catch {} }
    }, { passive:true });
  }

  // Drag & drop
  const addHL = () => drop && drop.classList.add('is-dragover');
  const rmHL  = () => drop && drop.classList.remove('is-dragover');

  const over = (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect='copy'; addHL(); };
  const leave= (e) => { e.preventDefault(); e.stopPropagation(); rmHL(); };
  const dropH= (e) => {
    e.preventDefault(); e.stopPropagation(); rmHL();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  if (drop) {
    drop.addEventListener('dragenter', over, { passive:false });
    drop.addEventListener('dragover',  over, { passive:false });
    drop.addEventListener('dragleave', leave, { passive:false });
    drop.addEventListener('dragend',  leave, { passive:false });
    drop.addEventListener('drop',     dropH, { passive:false });
  } else {
    document.addEventListener('dragover', (e)=>{ e.preventDefault(); }, { passive:false });
    document.addEventListener('drop', (e)=>{ e.preventDefault(); const f=e.dataTransfer?.files?.[0]; if(f) processFile(f); }, { passive:false });
  }
}

document.addEventListener('DOMContentLoaded', wireInputAndDrop);
