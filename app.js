/* --------------------------------------------------------------
   MCGM Marshal Upload – Final
   - Single stage strip (deduped)
   - Drag & drop + single chooser (no double-select)
   - Bottom-left crop (no preprocessing)
   - OCR (eng+hin+mar) with eng fallback
   - Robust parse + Mumbai range repairs
   - Ward/Beat/PS via GeoJSON
   - Redirect to Google Form ONLY if ALL fields valid
---------------------------------------------------------------- */

(() => {
  "use strict";

  // --------------------------- CONFIG ---------------------------
  // Crop band: trim from bottom and from left (to remove mini-map tile)
  const CROP = { BOTTOM: 0.24, LEFT: 0.27 };

  // Acceptable ranges for Mumbai area
  const RANGE = { LAT: {min: 18.5, max: 20.5}, LON: {min: 72.5, max: 73.5} };

  // GeoJSON files
  const MAPS = {
    WARDS: "data/wards.geojson",
    BEATS: "data/beats.geojson",
    PS:    "data/police_jurisdiction.geojson"
  };

  // Google Form prefill/redirect (fill your values, then set enabled: true)
  const GOOGLE_FORM = {
    enabled: false,
    mode: "open", // "open" (new tab) or "redirect" (same tab)
    action: "https://docs.google.com/forms/d/e/XXXX/viewform",
    fields: {
      date:      "entry.111111",
      time:      "entry.222222",
      latitude:  "entry.333333",
      longitude: "entry.444444",
      address:   "entry.555555",
      ward:      "entry.666666",
      beat:      "entry.777777",
      ps:        "entry.888888"
    }
  };

  // ----------------------------- DOM ----------------------------
  const $ = (s) => document.querySelector(s);

  const UI = {
    stageWraps: Array.from(document.querySelectorAll(".stage-wrap")),
    status: $("#stage-status"),
    times: $("#stage-times"),
    pills: {
      upload: $("#st-upload"),
      ocr: $("#st-ocr"),
      parse: $("#st-parse"),
      geo: $("#st-geo"),
      review: $("#st-review"),
    },
    drop: $("#dropZone"),
    file: $("#fileInput"),
    origImg: $("#origPreview"),
    cropImg: $("#cropPreview"),
    date: $("#res-date"),
    time: $("#res-time"),
    lat: $("#res-lat"),
    lon: $("#res-lon"),
    addr: $("#res-addr"),
    ward: $("#res-ward"),
    beat: $("#res-beat"),
    ps: $("#res-ps"),
    reset: $("#btnReset"),
  };

  // If multiple stage strips exist, keep the first
  if (UI.stageWraps.length > 1) {
    UI.stageWraps.slice(1).forEach((w) => w.remove());
  }

  const setStatus = (s) => { if (UI.status) UI.status.textContent = s; };

  // Ensure we have a file input (fixes some templates)
  if (!UI.file) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*"; inp.id = "fileInput"; inp.hidden = true;
    document.body.appendChild(inp);
    UI.file = inp;
  }

  // Reset button
  if (UI.reset) {
    UI.reset.addEventListener("click", () => window.location.reload());
  }

  // Timing
  const t = { upload:0, ocr:0, parse:0, geo:0, review:0 };
  const now = () => performance.now();
  const showTimes = () => {
    if (!UI.times) return;
    UI.times.textContent =
      `Upload — ${t.upload.toFixed(1)}s • OCR — ${t.ocr.toFixed(1)}s • ` +
      `Parse — ${t.parse.toFixed(1)}s • GeoJSON — ${t.geo.toFixed(1)}s • ` +
      `Review — ${t.review.toFixed(1)}s`;
  };

  // Pills helpers
  const setPill = (id, cls) => {
    const el = UI.pills[id]; if (!el) return;
    el.classList.remove("is-pending", "is-active", "is-done");
    el.classList.add(cls);
  };
  const stagePending = (k) => setPill(k, "is-pending");
  const stageActive  = (k) => setPill(k, "is-active");
  const stageDone    = (k) => setPill(k, "is-done");
  ["upload","ocr","parse","geo","review"].forEach(stagePending);

  // DnD single binding (no double select)
  const prevent = (e)=>{ e.preventDefault(); e.stopPropagation(); };
  ["dragenter","dragover","dragleave","drop"].forEach(ev => {
    document.addEventListener(ev, prevent, {passive:false});
  });
  const highlight = (on)=>{ UI.drop?.classList.toggle("is-hover", !!on); };
  if (UI.drop) {
    ["dragenter","dragover"].forEach(ev=>{
      UI.drop.addEventListener(ev, (e)=>{ prevent(e); highlight(true); }, {passive:false});
    });
    ["dragleave","drop"].forEach(ev=>{
      UI.drop.addEventListener(ev, (e)=>{ prevent(e); highlight(false); }, {passive:false});
    });
    UI.drop.addEventListener("drop", (e)=>{
      const f = e.dataTransfer?.files?.[0];
      if (f) processFile(f);
    }, {passive:false});
    UI.drop.addEventListener("click", ()=> UI.file?.click());
  }
  UI.file.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = ""; // important: allow selecting same file again on mobile
  });

  // Crop bottom-left band (no preprocessing)
  const cropCanvas = document.createElement("canvas");
  function cropBottomLeft(img){
    const w=img.naturalWidth, h=img.naturalHeight;
    const bandH=Math.round(h*CROP.BOTTOM);
    const y=h-bandH;
    const x=Math.round(w*CROP.LEFT);
    const cw=Math.max(10, w-x);
    cropCanvas.width=cw; cropCanvas.height=bandH;
    const ctx=cropCanvas.getContext("2d");
    ctx.drawImage(img, x,y,cw,bandH, 0,0,cw,bandH);
    return dataURLToBlob(cropCanvas.toDataURL("image/png"));
  }
  function dataURLToBlob(u){
    const b=atob(u.split(",")[1]); const m=u.split(",")[0].split(":")[1].split(";")[0];
    const ab=new ArrayBuffer(b.length); const ia=new Uint8Array(ab);
    for(let i=0;i<b.length;i++) ia[i]=b.charCodeAt(i);
    return new Blob([ab],{type:m});
  }

  // OCR helpers
  const DEV2ASCII=new Map("०१२३४५६७८९".split("").map((d,i)=>[d,String(i)]));
  const toAsciiDigits = s => s.replace(/[०-९]/g, d=>DEV2ASCII.get(d));
  function cleanText(s){
    s=toAsciiDigits(s);
    s=s.replace(/[^\S\r\n]+/g," ").replace(/[^\x20-\x7E\n,\/:\.\-°A-Za-z0-9]/g,"");
    return s;
  }

  function repairNumber(numStr, kind){
    let v=Number(numStr);
    const outOfRange = (k, val) =>
      (k==="lat" && (val<RANGE.LAT.min||val>RANGE.LAT.max)) ||
      (k==="lon" && (val<RANGE.LON.min||val>RANGE.LON.max));

    const invalid = !Number.isFinite(v) || outOfRange(kind, v);
    if (invalid){
      const d=(numStr.match(/\d+/g)||[]).join("");
      if (d.length>=3){ v=Number(`${d.slice(0,2)}.${d.slice(2,8)}`); }
    }
    if (outOfRange(kind, v)) return null;
    return Number.isFinite(v)? Number(v.toFixed(6)) : null;
  }

  function parseFields(raw){
    const start=now();
    const text=cleanText(raw);

    // Date
    let date=null;
    let m=text.match(/\b(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})\b/);
    if(m){ const [_,dd,mm,yy]=m; date=`${yy}-${mm}-${dd}`; }

    // Time (24h)
    let time=null;
    m=text.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
    if(m){
      let hh=parseInt(m[1],10), mm=m[2], ap=(m[3]||"").toUpperCase();
      if(ap==="PM" && hh<12) hh+=12; if(ap==="AM" && hh===12) hh=0;
      time=`${String(hh).padStart(2,"0")}:${mm}`;
    }

    // Coordinates
    let lat=null, lon=null;
    const latL=text.match(/Lat(?:itude)?[^0-9\-]*([0-9\.\-]+)/i);
    const lonL=text.match(/Lon(?:g|gitude)?[^0-9\-]*([0-9\.\-]+)/i);
    if(latL) lat=repairNumber(latL[1],"lat");
    if(lonL) lon=repairNumber(lonL[1],"lon");

    if(lat===null || lon===null){
      const nums=(text.match(/[-+]?\d{2}\.\d{3,7}/g)||[]).map(Number);
      const latC=nums.filter(v=>v>=RANGE.LAT.min && v<=RANGE.LAT.max);
      const lonC=nums.filter(v=>v>=RANGE.LON.min && v<=RANGE.LON.max);
      if(lat===null && latC.length) lat=Number(latC[0].toFixed(6));
      if(lon===null && lonC.length) lon=Number(lonC[0].toFixed(6));
    }

    // Address
    let addr="";
    const latIdx=text.search(/Lat(?:itude)?/i);
    if(latIdx>0) addr=text.slice(0,latIdx).trim();
    if(!addr){
      const lines=text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
      const scored=lines.map(s=>({s,score:(s.match(/,/g)||[]).length + s.length/80}));
      scored.sort((a,b)=>b.score-a.score);
      if(scored.length) addr=scored[0].s;
    }
    addr=addr.replace(/\s{2,}/g," ").replace(/\s?[,;]\s?$/,"");

    t.parse += (now()-start)/1000;
    return {date,time,lat,lon,addr};
  }

  async function runOCR(blob){
    const o0=now();
    setStatus("Running OCR…");
    let text="";
    try{
      const r=await Tesseract.recognize(blob,"eng+hin+mar",{logger:m=>{
        if(m.status==="recognizing text"){ UI.pills.ocr.dataset.pct = Math.round((m.progress||0)*100)+"%"; }
      }});
      text=r?.data?.text||"";
    }catch(e){
      console.warn("OCR failed; retrying eng only", e);
      const r2=await Tesseract.recognize(blob,"eng");
      text=r2?.data?.text||"";
    }
    t.ocr += (now()-o0)/1000;
    return text;
  }

  // GeoJSON lookup (point in polygon)
  let WARDS=null, BEATS=null, PS=null;
  async function loadMapsOnce(){
    if (WARDS && BEATS && PS) return;
    const [w,b,p] = await Promise.all([
      fetch(MAPS.WARDS).then(r=>r.json()),
      fetch(MAPS.BEATS).then(r=>r.json()),
      fetch(MAPS.PS).then(r=>r.json())
    ]);
    WARDS=w; BEATS=b; PS=p;
  }
  function pip(pt, geom){
    const [x,y]=pt;
    const test=(rings)=>{
      let inside=false;
      for(const ring of rings){
        for(let i=0,j=ring.length-1;i<ring.length;j=i++){
          const [xi,yi]=ring[i],[xj,yj]=ring[j];
          const hit=((yi>y)!==(yj>y)) && (x<(xj-xi)*(y-yi)/(yj-yi)+xi);
          if(hit) inside=!inside;
        }
      }
      return inside;
    };
    if(geom.type==="Polygon") return test(geom.coordinates);
    if(geom.type==="MultiPolygon") return geom.coordinates.some(test);
    return false;
  }
  function fcLookup(fc, lon, lat, keys){
    if (!fc) return null;
    for(const f of fc.features){
      if(pip([lon,lat], f.geometry)){
        const P=f.properties||{};
        for(const k of keys){ if (P[k]!=null && String(P[k]).trim()!=="") return String(P[k]).trim(); }
        return "(found)";
      }
    }
    return null;
  }
  async function geoLookup(lat,lon){
    const g0=now(); await loadMapsOnce();
    const ward = fcLookup(WARDS, lon,lat, ["WARD","ward","Ward_No","WARD_NO"]);
    const beat = fcLookup(BEATS, lon,lat, ["BEAT_NO","Beat_No","BEAT","beat"]);
    const ps   = fcLookup(PS,    lon,lat, ["PS_NAME","PoliceStn","PS","Name"]);
    t.geo += (now()-g0)/1000;
    return {ward,beat,ps};
  }

  // Validation to decide redirect
  function allValid({date,time,lat,lon,addr}, loc){
    const has = v => v!=null && String(v).trim()!=="" && String(v)!=="—";
    const inRange =
      (lat>=RANGE.LAT.min && lat<=RANGE.LAT.max) &&
      (lon>=RANGE.LON.min && lon<=RANGE.LON.max);
    return has(date) && has(time) && lat!=null && lon!=null && inRange &&
           has(addr) && has(loc.ward) && has(loc.beat) && has(loc.ps);
  }

  // Pipeline
  async function processFile(file){
    ["upload","ocr","parse","geo","review"].forEach(stagePending);
    setStatus("Reading image…"); showTimes();

    // Preview original
    const url=URL.createObjectURL(file);
    await new Promise(res=>{ UI.origImg.onload=res; UI.origImg.src=url; });

    // Upload stage
    stageActive("upload");
    const u0=now();

    // Crop
    const cropBlob=cropBottomLeft(UI.origImg);
    UI.cropImg.src=URL.createObjectURL(cropBlob);

    t.upload+=(now()-u0)/1000;
    stageDone("upload"); showTimes();

    // OCR
    stageActive("ocr");
    const rawText=await runOCR(cropBlob);
    stageDone("ocr"); showTimes();

    // Parse
    stageActive("parse");
    setStatus("Parsing fields…");
    const parsed=parseFields(rawText);
    UI.date.textContent = parsed.date || "—";
    UI.time.textContent = parsed.time || "—";
    UI.lat.textContent  = parsed.lat!=null ? parsed.lat : "—";
    UI.lon.textContent  = parsed.lon!=null ? parsed.lon : "—";
    UI.addr.textContent = parsed.addr || "—";
    stageDone("parse"); showTimes();

    // Geo lookup
    stageActive("geo");
    setStatus("Locating Ward / Beat / PS…");
    let loc={ward:"—",beat:"—",ps:"—"};
    if(parsed.lat!=null && parsed.lon!=null){
      loc = await geoLookup(parsed.lat, parsed.lon);
    }
    UI.ward.textContent = loc.ward || "—";
    UI.beat.textContent = loc.beat || "—";
    UI.ps.textContent   = loc.ps   || "—";
    stageDone("geo"); showTimes();

    // Review / optionally redirect
    stageActive("review");
    t.review += 0.1; stageDone("review"); showTimes();

    // Redirect **only** if everything is valid
    const ok = allValid(parsed, loc);
    if (!ok) {
      setStatus("Ready. Submission blocked: missing or invalid fields. Please verify text and try again.");
      return;
    }
    setStatus("All fields valid. Preparing submission…");

    if (GOOGLE_FORM.enabled){
      const u = new URL(GOOGLE_FORM.action);
      const put = (k,v) => {
        const id = GOOGLE_FORM.fields[k];
        if (id) u.searchParams.set(id, String(v));
      };
      put("date", parsed.date);
      put("time", parsed.time);
      put("latitude", parsed.lat);
      put("longitude", parsed.lon);
      put("address", parsed.addr);
      put("ward", loc.ward);
      put("beat", loc.beat);
      put("ps", loc.ps);

      if (GOOGLE_FORM.mode === "redirect") window.location.href = u.toString();
      else window.open(u.toString(), "_blank", "noopener");
    } else {
      setStatus("All fields valid (form submit disabled in config).");
    }
  }

  // Init state
  setStatus("Waiting for image…");
  showTimes();
})();
