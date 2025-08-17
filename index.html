/* ----------------------------------------------------------------
   MCGM – Marshal Upload (client-only pipeline)
   - No image preprocessing (as requested)
   - Left trim so the mini-map is fully excluded
   - Robust OCR with ENG+Devanagari + graceful fallback
   - Mumbai-safe lat/long repair + address extraction
   - GeoJSON lookup (Ward / Beat / Police Station)
   - Material stage-pills + timings
----------------------------------------------------------------- */

(() => {
  "use strict";

  // -------- Tunables (kept tiny & explicit) --------------------
  const CROP = {
    BOTTOM: 0.24,   // bottom band (GPS overlay)
    LEFT:   0.27    // trim map tile from the LEFT (adjust 0.26–0.28 if needed)
  };

  // Mumbai sanity ranges (used for fixing malformed numbers)
  const RANGE = {
    LAT: { min: 18.5, max: 20.5 },
    LON: { min: 72.5, max: 73.5 }
  };

  // Files (keep your paths as-is)
  const MAPS = {
    WARDS: "data/wards.geojson",
    BEATS: "data/beats.geojson",
    PS:    "data/police_jurisdiction.geojson"
  };

  // -------- Cache DOM ------------------------------------------------
  const $ = (s) => document.querySelector(s);
  const UI = {
    drop:      $("#dropZone") || $(".upload-drop") || $(".upload-box"),
    file:      $("#fileInput") || $("#file") || $("input[type=file]"),
    origImg:   $("#origPreview") || $("#origImg"),
    cropImg:   $("#cropPreview") || $("#cropImg"),
    // results
    date:      $("#res-date") || $("#resDate"),
    time:      $("#res-time") || $("#resTime"),
    lat:       $("#res-lat")  || $("#resLat"),
    lon:       $("#res-lon")  || $("#resLon"),
    addr:      $("#res-addr") || $("#resAddr"),
    ward:      $("#res-ward") || $("#resWard"),
    beat:      $("#res-beat") || $("#resBeat"),
    ps:        $("#res-ps")   || $("#resPS"),
    // stage pills
    pills: {
      upload:  $("#st-upload"),
      ocr:     $("#st-ocr"),
      parse:   $("#st-parse"),
      geo:     $("#st-geo"),
      review:  $("#st-review")
    },
    // timing text (small caption under the bar)
    times: $("#stage-times") || $(".stage-times")
  };

  // Canvas for crop
  const cropCanvas = document.createElement("canvas");

  // Stage timing
  const t = { upload: 0, ocr: 0, parse: 0, geo: 0, review: 0 };
  const now = () => performance.now();

  // GeoJSON in-memory
  let WARDS = null, BEATS = null, PS = null;

  // Guard: make sure elements exist
  function required(...nodes){ nodes.forEach(n => { if(!n) console.warn("Missing UI node:", n); }); }
  required(UI.file, UI.origImg, UI.cropImg, UI.date, UI.time, UI.lat, UI.lon, UI.addr);

  // --------------------- Stage helpers ---------------------------
  function pillState(name, state){
    const el = UI.pills[name];
    if(!el) return;
    el.classList.remove("is-pending","is-active","is-done");
    el.classList.add(state);
  }
  function setStageActive(name){ pillState(name,"is-active"); }
  function setStageDone(name){ pillState(name,"is-done"); }
  function setStagePending(name){ pillState(name,"is-pending"); }

  function showTimes(){
    if(!UI.times) return;
    UI.times.textContent =
      `Upload — ${t.upload.toFixed(1)}s • ` +
      `OCR — ${t.ocr.toFixed(1)}s • ` +
      `Parse — ${t.parse.toFixed(1)}s • ` +
      `GeoJSON — ${t.geo.toFixed(1)}s • ` +
      `Review — ${t.review.toFixed(1)}s`;
  }

  // --------------------- GeoJSON loading -------------------------
  async function loadMapsOnce(){
    if(WARDS && BEATS && PS) return;
    const [w,b,p] = await Promise.all([
      fetch(MAPS.WARDS).then(r=>r.json()),
      fetch(MAPS.BEATS).then(r=>r.json()),
      fetch(MAPS.PS).then(r=>r.json())
    ]);
    WARDS = w; BEATS = b; PS = p;
  }

  // Ray-casting point-in-polygon (WGS84; polygon or multi)
  function pointInPolygon(pt, geom){
    const [x, y] = pt; // [lon, lat]
    const test = (coords) => {
      let inside = false;
      for (let ring of coords){
        for (let i=0, j=ring.length-1; i<ring.length; j=i++){
          const xi = ring[i][0], yi = ring[i][1];
          const xj = ring[j][0], yj = ring[j][1];
          const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
          if (intersect) inside = !inside;
        }
      }
      return inside;
    };
    if (geom.type === "Polygon") return test(geom.coordinates);
    if (geom.type === "MultiPolygon") return geom.coordinates.some(test);
    return false;
  }

  function lookupFeatureCollection(fc, point, keyNames){
    if(!fc) return null;
    const [lon, lat] = point;
    for (const f of fc.features){
      if (pointInPolygon([lon, lat], f.geometry)){
        const props = f.properties || {};
        for (const k of keyNames){
          if (props[k] != null && String(props[k]).trim() !== "") {
            return String(props[k]).trim();
          }
        }
        return "(found)";
      }
    }
    return null;
  }

  async function geoLookup(lat, lon){
    const start = now();
    await loadMapsOnce();
    const ward = lookupFeatureCollection(WARDS, [lon,lat], ["WARD","ward","Ward_No","WARD_NO"]);
    const beat = lookupFeatureCollection(BEATS, [lon,lat], ["BEAT_NO","Beat_No","BEAT","beat"]);
    const ps   = lookupFeatureCollection(PS,    [lon,lat], ["PS_NAME","PoliceStn","PS"]);
    t.geo += (now() - start)/1000;
    return { ward, beat, ps };
  }

  // --------------------- OCR helpers -----------------------------
  // Normalise Devanagari digits to ASCII
  const DEV2ASCII = new Map("०१२३४५६७८९".split("").map((d,i)=>[d,String(i)]));
  function toAsciiDigits(s){ return s.replace(/[०-९]/g, d => DEV2ASCII.get(d) ); }

  // Clean up text a little but keep punctuation/commas
  function cleanText(s){
    s = toAsciiDigits(s);
    // remove repeated zero-width/diacritics that confuse regex, keep commas & slashes
    s = s.replace(/[^\S\r\n]+/g," ").replace(/[^\x20-\x7E\n,\/:\.\-°A-Za-z0-9]/g,"");
    return s;
  }

  // Attempt to repair a Mumbai lat/long when OCR smashes decimals (e.g. "191234332.000000")
  function repairNumber(numStr, kind){
    let v = Number(numStr);
    if (!Number.isFinite(v) || (kind==="lat" && (v<RANGE.LAT.min || v>RANGE.LAT.max)) ||
                               (kind==="lon" && (v<RANGE.LON.min || v>RANGE.LON.max))) {
      // Try to recover: take first 2 digits, then dot, then up to 6 digits
      const digits = (numStr.match(/\d+/g)||[]).join("");
      if (digits.length >= 3){
        const fixed = `${digits.slice(0,2)}.${digits.slice(2,8)}`;
        v = Number(fixed);
      }
    }
    // Final clamp if still off
    if (kind==="lat"){ if (v<RANGE.LAT.min || v>RANGE.LAT.max) return null; }
    if (kind==="lon"){ if (v<RANGE.LON.min || v>RANGE.LON.max) return null; }
    return Number.isFinite(v) ? Number(v.toFixed(6)) : null;
  }

  function parseFields(raw){
    const start = now();
    const text = cleanText(raw);

    // Date (yyyy-mm-dd or dd-mm-yyyy / dd/mm/yyyy)
    let date = null;
    let m = text.match(/\b(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})\b/);
    if (m){
      // assume dd-mm-yyyy
      const [_, dd, mm, yyyy] = m;
      date = `${yyyy}-${mm}-${dd}`;
    }

    // Time (HH:MM with optional AM/PM)
    let time = null;
    m = text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
    if (m){
      let hh = parseInt(m[1],10), mm = m[2], ap = (m[3]||"").toUpperCase();
      if (ap){
        if (ap==="PM" && hh<12) hh+=12;
        if (ap==="AM" && hh===12) hh=0;
      }
      time = `${String(hh).padStart(2,'0')}:${mm}`;
    }

    // Latitude & Longitude from labelled parts
    let lat = null, lon = null;

    const latLab = text.match(/Lat(?:itude)?[^0-9\-]*([0-9\.\-]+)/i);
    const lonLab = text.match(/Lon(?:g|gitude)?[^0-9\-]*([0-9\.\-]+)/i);
    if (latLab) lat = repairNumber(latLab[1], "lat");
    if (lonLab) lon = repairNumber(lonLab[1], "lon");

    // Fallback: pick the two most plausible decimal numbers in Mumbai ranges
    if (lat===null || lon===null){
      const nums = (text.match(/[-+]?\d{2}\.\d{3,7}/g) || []).map(Number);
      // Find candidates by range
      const latC = nums.filter(v => v>=RANGE.LAT.min && v<=RANGE.LAT.max);
      const lonC = nums.filter(v => v>=RANGE.LON.min && v<=RANGE.LON.max);
      if (lat===null && latC.length) lat = Number(latC[0].toFixed(6));
      if (lon===null && lonC.length) lon = Number(lonC[0].toFixed(6));
    }

    // Address: take text between the city line and "Lat" label (if present),
    // else first comma-heavy line before the coordinates
    let addr = "";
    const latIdx = text.search(/Lat(?:itude)?/i);
    if (latIdx>0) addr = text.slice(0, latIdx).trim();
    if (!addr) {
      // Split lines and keep the last long comma-rich line
      const lines = text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
      const scored = lines.map(s=>({s,score:(s.match(/,/g)||[]).length + s.length/80}));
      scored.sort((a,b)=>b.score-a.score);
      if (scored.length) addr = scored[0].s;
    }
    // Tidy trailing junk
    addr = addr.replace(/\s{2,}/g," ").replace(/\s?[,;]\s?$/,"");

    t.parse += (now()-start)/1000;
    return { date, time, lat, lon, addr };
  }

  // --------------------- Cropping (NO preprocessing) --------------
  function cropBottomLeft(img){
    const w = img.naturalWidth, h = img.naturalHeight;
    const bandH = Math.round(h * CROP.BOTTOM);
    const y = h - bandH;
    const x = Math.round(w * CROP.LEFT);
    const cropW = Math.max(10, w - x);
    cropCanvas.width = cropW;
    cropCanvas.height = bandH;
    const ctx = cropCanvas.getContext("2d");
    ctx.drawImage(img, x, y, cropW, bandH, 0, 0, cropW, bandH);
    return dataURLToBlob(cropCanvas.toDataURL("image/png"));
  }

  function dataURLToBlob(dataURL){
    const byteString = atob(dataURL.split(',')[1]);
    const mimeString = dataURL.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new Blob([ab], { type: mimeString });
  }

  // --------------------- OCR (Tesseract direct) -------------------
  async function runOCR(blob){
    // Prefer mar/hin+eng for GPS overlays that mix scripts. If Devanagari
    // packs fail to load, fall back to eng silently.
    const langs = "eng+hin+mar";
    const start = now();
    let text = "";
    try{
      const res = await Tesseract.recognize(blob, langs, {
        logger: m => {
          // keep the UI light; only update % during "recognizing text"
          if (m.status === "recognizing text" && UI.pills.ocr){
            UI.pills.ocr.dataset.pct = Math.round((m.progress||0)*100) + "%";
          }
        }
      });
      text = res?.data?.text || "";
    }catch(e){
      console.warn("OCR failed, retrying ENG only:", e);
      const res2 = await Tesseract.recognize(blob, "eng");
      text = res2?.data?.text || "";
    }
    t.ocr += (now() - start)/1000;
    return text;
  }

  // --------------------- Pipeline --------------------------------
  async function processFile(file){
    // Reset pills
    ["upload","ocr","parse","geo","review"].forEach(setStagePending);
    showTimes();

    // Show original
    const url = URL.createObjectURL(file);
    await new Promise((resolve) => {
      UI.origImg.onload = resolve;
      UI.origImg.src = url;
    });

    // Upload stage done immediately (local)
    setStageActive("upload");
    const u0 = now();

    // Crop preview (no preprocessing)
    const cropBlob = cropBottomLeft(UI.origImg);
    UI.cropImg.src = URL.createObjectURL(cropBlob);

    t.upload += (now()-u0)/1000;
    setStageDone("upload");
    showTimes();

    // OCR
    setStageActive("ocr");
    const txt = await runOCR(cropBlob);
    setStageDone("ocr");
    showTimes();

    // Parse
    setStageActive("parse");
    const {date,time,lat,lon,addr} = parseFields(txt);
    if (UI.date) UI.date.textContent = date || "—";
    if (UI.time) UI.time.textContent = time || "—";
    if (UI.lat)  UI.lat.textContent  = (lat!=null)? lat : "—";
    if (UI.lon)  UI.lon.textContent  = (lon!=null)? lon : "—";
    if (UI.addr) UI.addr.textContent = addr || "—";
    setStageDone("parse");
    showTimes();

    // GeoJSON
    setStageActive("geo");
    if (lat!=null && lon!=null){
      const { ward, beat, ps } = await geoLookup(lat, lon);
      if (UI.ward) UI.ward.textContent = ward || "—";
      if (UI.beat) UI.beat.textContent = beat || "—";
      if (UI.ps)   UI.ps.textContent   = ps   || "—";
    } else {
      if (UI.ward) UI.ward.textContent = "—";
      if (UI.beat) UI.beat.textContent = "—";
      if (UI.ps)   UI.ps.textContent   = "—";
    }
    setStageDone("geo");

    // Review (final)
    setStageActive("review");
    t.review += 0.1; // visual
    setStageDone("review");
    showTimes();
  }

  // --------------------- Drag/Drop & Input -----------------------
  function highlight(on){
    if(!UI.drop) return;
    UI.drop.classList.toggle("is-hover", !!on);
  }
  function preventDefaults(e){ e.preventDefault(); e.stopPropagation(); }

  function handleDrop(e){
    preventDefaults(e);
    highlight(false);
    const dt = e.dataTransfer;
    const file = dt && dt.files && dt.files[0];
    if (file) processFile(file);
  }
  function handlePick(e){
    const file = e.target.files && e.target.files[0];
    if (file) processFile(file);
    // clear once to avoid double-chooser on some Android browsers
    e.target.value = "";
  }

  // Bind once
  if (UI.drop){
    ["dragenter","dragover"].forEach(ev => UI.drop.addEventListener(ev, (e)=>{preventDefaults(e); highlight(true);}, {passive:false}));
    ["dragleave","drop"].forEach(ev => UI.drop.addEventListener(ev, (e)=>{preventDefaults(e); highlight(false);}, {passive:false}));
    UI.drop.addEventListener("drop", handleDrop, {passive:false});
    // Make entire drop area clickable
    UI.drop.addEventListener("click", ()=> UI.file && UI.file.click());
  }
  if (UI.file){
    UI.file.addEventListener("change", handlePick, {once:false});
  }

  // Init pills as pending
  ["upload","ocr","parse","geo","review"].forEach(setStagePending);
  showTimes();
})();
