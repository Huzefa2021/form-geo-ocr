/* =========================================================
   MCGM – Marshal Upload Portal : Application Script (app.js)
   ========================================================= */

/* ---------------------------
   OCR CDN options
   --------------------------- */
const OCR_CDNS = [
  { label: "v5 (jsDelivr)", url: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" },
  { label: "v5 (unpkg)",    url: "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js" },
  { label: "v4 (fallback)", url: "https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js" }
];

function addScript(src){
  return new Promise((res,rej)=>{
    const s=document.createElement("script");
    s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s);
  });
}

async function loadOCR(){
  const pill=document.getElementById("cdnPill");
  for(const cdn of OCR_CDNS){
    try{
      await addScript(cdn.url);
      window.__OCR_VERSION__=cdn.label;
      if(pill){ pill.textContent="CDN: "+cdn.label; pill.classList.add("ok"); }
      return;
    }catch{ /* try next */ }
  }
  if(pill){ pill.textContent="CDN: unavailable"; pill.classList.add("err"); }
}

/* -------------
   Configuration
   ------------- */
const FORM_ID = "1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw";
const ENTRY = {
  date:"entry.1911996449", time:"entry.1421115881",
  lon:"entry.113122688", lat:"entry.419288992",
  ward:"entry.1625337207", beat:"entry.1058310891",
  address:"entry.1188611077", police:"entry.1555105834"
};
const STAGE_LIMITS = [20000,90000,12000,15000,45000,20000]; // Upload, OCR, Parse, GeoJSON, Review, Redirect
const DEBUG = false;
const BUILD = "v2025.08.17.Prod.v2";
const MUMBAI_BBOX = [72.60,18.80,73.20,19.50];

/* --------------------
   Elements & State
   -------------------- */
const els = {
  dropCard:document.getElementById("dropCard"),
  drop:document.getElementById("drop"),
  file:document.getElementById("file"),
  originalCard:document.getElementById("originalCard"),
  originalImg:document.getElementById("originalImg"),
  overlayCard:document.getElementById("overlayCard"),
  overlayWrap:document.getElementById("overlayWrap"),
  overlayImg:document.getElementById("overlayImg"),
  overlayScanner:document.getElementById("overlayScanner"),
  status:document.getElementById("status"),
  bar:document.getElementById("bar"),
  results:document.getElementById("results"),
  redirectNote:document.getElementById("redirectNote"),
  stageTimes:document.getElementById("stageTimes"),
  ms:[...document.querySelectorAll(".milestones .chip")],
  modalBackdrop:document.getElementById("modalBackdrop"),
  modalCancel:document.getElementById("modalCancel"),
  modalReset:document.getElementById("modalReset"),
  timeoutBackdrop:document.getElementById("timeoutBackdrop"),
  timeoutRetry:document.getElementById("timeoutRetry"),
  timeoutClose:document.getElementById("timeoutClose"),
  timeoutTitle:document.getElementById("timeoutTitle"),
  btnReset:document.getElementById("btnReset"),
  cdnPill:document.getElementById("cdnPill"),
  appVersion:document.getElementById("appVersion")
};

const state = {
  activeRun:0, croppedUrl:"", outside:false, timedOut:false,
  data:{ date:"", time:"", lat:"", lon:"", address:"", WARD:"", BEAT_NO:"", PS_NAME:"" },
  gjIndex:{ wards:null, beats:null, police:null },
  counts:{ wards:0, beats:0, police:0 },
  stageStart:Array(6).fill(null),
  stageElapsed:Array(6).fill(0),
  stageTimeouts:Array(6).fill(null),
  stageTicker:null, countdownTimer:null
};

/* -----------
   UI helpers
   ----------- */
function setStatus(msg, cls){
  els.status.className="status "+(cls||"");
  els.status.textContent=msg;
}
function kvRow(id,label,value){
  let row=document.getElementById(id);
  if(!row){
    row=document.createElement("div");
    row.className="kv"; row.id=id;
    row.innerHTML=`<div class="k">${label}</div><div class="v"></div>`;
    els.results.appendChild(row);
  }
  if(value!==undefined && value!==null){
    row.querySelector(".v").textContent=String(value||"");
  }
}
function initResultSkeleton(){
  kvRow("row-date","Date","");
  kvRow("row-time","Time","");
  kvRow("row-lat","Latitude","");
  kvRow("row-lon","Longitude","");
  kvRow("row-addr","Address","");
  kvRow("row-ward","Ward","");
  kvRow("row-beat","Beat No.","");
  kvRow("row-ps","Police Station","");
}
function render(){
  const d=state.data;
  kvRow("row-date","Date",d.date);
  kvRow("row-time","Time",d.time);
  kvRow("row-lat","Latitude",d.lat);
  kvRow("row-lon","Longitude",d.lon);
  kvRow("row-addr","Address",d.address);
  kvRow("row-ward","Ward",d.WARD);
  kvRow("row-beat","Beat No.",d.BEAT_NO);
  kvRow("row-ps","Police Station",d.PS_NAME);
}
function buildPrefillURL(){
  const p=new URLSearchParams({
    [ENTRY.date]:state.data.date||"",
    [ENTRY.time]:state.data.time||"",
    [ENTRY.lon]:state.data.lon||"",
    [ENTRY.lat]:state.data.lat||"",
    [ENTRY.ward]:state.data.WARD||"",
    [ENTRY.beat]:state.data.BEAT_NO||"",
    [ENTRY.address]:state.data.address||"",
    [ENTRY.police]:state.data.PS_NAME||"",
    usp:"pp_url"
  });
  return `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?${p.toString()}`;
}
function applyChips(i){
  els.ms.forEach((chip,idx)=>{
    chip.classList.remove("pending","active","done");
    if(idx<i) chip.classList.add("done");
    else if(idx===i) chip.classList.add("active");
    else chip.classList.add("pending");
  });
  els.bar.style.width=Math.max(0,Math.min(100,(i/5)*100))+"%";
}
function fmt(ms){return ms>0&&isFinite(ms)?(ms/1000).toFixed(1)+"s":"0.0s";}
function currentStageIndex(){
  for(let i=0;i<6;i++) if(state.stageStart[i]!==null && state.stageElapsed[i]===0) return i;
  for(let i=5;i>=0;i--) if(state.stageElapsed[i]>0) return Math.min(i+1,5);
  return 0;
}
function updateTimes(){
  const names=["Upload","OCR","Parse","GeoJSON","Review","Redirect"];
  els.stageTimes.textContent=names.map((n,i)=>{
    const running=state.stageStart[i]!==null && i===currentStageIndex();
    const val=running?Date.now()-state.stageStart[i]:state.stageElapsed[i];
    return `${n} — ${fmt(val)}`;
  }).join(" • ");
}
function startStage(i){
  if(state.timedOut) return;
  for(let k=0;k<i;k++) if(state.stageStart[k]!==null && state.stageElapsed[k]===0) endStage(k);
  state.stageStart[i]=Date.now();
  applyChips(i);
  if(!state.stageTicker) state.stageTicker=setInterval(updateTimes,200);
  clearTimeout(state.stageTimeouts[i]);
  state.stageTimeouts[i]=setTimeout(()=>onStageTimeout(i),STAGE_LIMITS[i]);
}
function endStage(i){
  if(state.stageStart[i]!==null && state.stageElapsed[i]===0)
    state.stageElapsed[i]=Date.now()-state.stageStart[i];
  clearTimeout(state.stageTimeouts[i]); updateTimes();
}
function onStageTimeout(i){
  if(state.stageElapsed[i]>0 || state.timedOut) return;
  state.timedOut=true;
  els.timeoutBackdrop.style.display="flex";
  els.timeoutTitle.textContent=`Stage Timed Out — ${["Upload","OCR","Parse","GeoJSON","Review","Redirect"][i]}`;
}

/* ------------------------------------
   GeoJSON loading & lookup
   ------------------------------------ */
function indexFC(fc){ const items=(fc.features||[]).map(f=>({f,b:turf.bbox(f)})); return {items,n:(fc.features||[]).length}; }
function inMumbaiBBox(pt){ return pt[0]>=MUMBAI_BBOX[0]&&pt[0]<=MUMBAI_BBOX[2]&&pt[1]>=MUMBAI_BBOX[1]&&pt[1]<=MUMBAI_BBOX[3]; }
function firstProp(props,keys){ for(const k of keys){ const v=props?.[k]; if(v!==undefined&&v!==null&&String(v).trim()!=="") return String(v).trim(); } return ""; }
function getBeat(props){
  const v=firstProp(props,["BEAT_NO","Beat_No","BEAT","Beat","BEATNO","BeatNo","beat_no","Beat_Number","BeatNumber"]);
  if(v) return v; const n=props?.name||props?.NAME||""; const m=String(n).match(/Beat\s*([A-Za-z0-9]+)/i); return m?m[1]:(n||"");
}
function pipIndexed(idx,pt,propsToValueFn){
  if(!idx?.items) return "";
  const point=turf.point(pt);
  for(const {f,b} of idx.items){
    if(pt[0]<b[0]||pt[0]>b[2]||pt[1]<b[1]||pt[1]>b[3]) continue;
    try{ if(turf.booleanPointInPolygon(point,f)) return propsToValueFn(f.properties); }catch{}
  }
  for(const {f} of idx.items){ try{ if(turf.booleanPointInPolygon(point,f)) return propsToValueFn(f.properties); }catch{} }
  return "";
}
function nearestIndexed(idx,pt,keys,meters){
  if(!idx?.items) return {value:"",meters:Infinity};
  const point=turf.point(pt); let best=Infinity,val="";
  for(const {f} of idx.items){
    try{ const c=turf.center(f); const d=turf.distance(point,c,{units:"meters"});
      if(d<best){ best=d; val=firstProp(f.properties,keys)||f.properties?.name||f.properties?.NAME||""; }
    }catch{}
  }
  return (best<=meters)?{value:val,meters:best}:{value:"",meters:best};
}
async function loadGeo(){
  const [w,b,p]=await Promise.all([
    fetch("./data/wards.geojson").then(r=>r.json()),
    fetch("./data/beats.geojson").then(r=>r.json()),
    fetch("./data/police_jurisdiction.geojson").then(r=>r.json())
  ]);
  state.gjIndex.wards=indexFC(w);
  state.gjIndex.beats=indexFC(b);
  state.gjIndex.police=indexFC(p);
  state.counts={wards:state.gjIndex.wards.n,beats:state.gjIndex.beats.n,police:state.gjIndex.police.n};
  if(DEBUG) console.log("GeoJSON loaded:",state.counts);
}
function lookup(lat,lon){
  const pt=[parseFloat(lon),parseFloat(lat)];
  const ward=pipIndexed(state.gjIndex.wards,pt,p=>firstProp(p,["WARD","Ward","ward","WARD_NO","Ward_No","WARDNAME","WardName","NAME","name"]));
  let beat=pipIndexed(state.gjIndex.beats,pt,p=>getBeat(p));
  let ps=pipIndexed(state.gjIndex.police,pt,p=>firstProp(p,["PS_NAME","PS","Police_Station","PoliceStation","ps_name","PSName","PS_Name","name","NAME"]));
  if(!beat){
    const n=nearestIndexed(state.gjIndex.beats,pt,["BEAT_NO","Beat_No","BEAT","Beat","BEATNO","BeatNo","beat_no","Beat_Number","BeatNumber","name","NAME"],300);
    if(n.value){ const m=String(n.value).match(/Beat\s*([A-Za-z0-9]+)/i); beat=m?m[1]:n.value; }
  }
  if(!ps){
    const n=nearestIndexed(state.gjIndex.police,pt,["PS_NAME","PS","Police_Station","PoliceStation","ps_name","PSName","PS_Name","name","NAME"],500);
    if(n.value) ps=n.value;
  }
  const hasAny=!!(ward||beat||ps);
  const outside=!hasAny && !inMumbaiBBox(pt);
  if(DEBUG) console.log("Lookup:",{lat,lon,ward,beat,ps,hasAny,outside});
  return {WARD:ward,BEAT_NO:beat,PS_NAME:ps,outside};
}

/* -----------------------------
   Image crop (extract overlay)
   ----------------------------- */
async function cropOverlay(dataURL){
  const blob=await (await fetch(dataURL)).blob();
  const bmp=await createImageBitmap(blob);
  const W=bmp.width,H=bmp.height;
  const cropY=Math.round(H*0.62);
  const cropH=Math.max(120,Math.round(H*0.38));
  const targetW=1200, scale=Math.min(1,targetW/W);
  const outW=Math.round(W*scale), outH=Math.round(cropH*scale);
  const c=document.createElement("canvas"); c.width=outW; c.height=outH;
  const ctx=c.getContext("2d");
  ctx.drawImage(bmp,0,cropY,W,cropH,0,0,outW,outH);
  // grayscale + contrast
  const img=ctx.getImageData(0,0,outW,outH), d=img.data;
  for(let i=0;i<d.length;i+=4){
    const y=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];
    const v=y>175?255:y<55?0:y; d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(img,0,0);
  return c.toDataURL("image/png");
}

/* -------------------------
   Address parsing & cleanup
   ------------------------- */
function cleanAddress(addr){
  let a=String(addr||"");
  a=a.replace(/\b[\w]{3,}\+[\w]{2,}\b/gi," "); // plus-codes
  a=a.replace(/[^0-9A-Za-z\u0900-\u097F ,./\-]/g," ");
  a=a.replace(/\b(?:GPS|Map|Camera|Wind|Humidity|Pressure|Temperature|Google)\b.*$/i," ");
  a=a.replace(/,\s*[A-Za-z\u0900-\u097F]\s*(?=,|$)/g," ");
  a=a.replace(/\s{2,}/g," ").replace(/\s*,\s*/g,", ").replace(/,\s*,/g,", ").replace(/^\s*,\s*|\s*,\s*$/g,"");
  a=a.replace(/,?\s*India\s*,\s*India/i,", India").trim();
  return a;
}
function extractCoords(rawText){
  const norm=String(rawText||"").replace(/\u00A0|\u2009|\u2002|\u2003/g," ").replace(/[°]/g,"").replace(/O/g,"0");
  const cleanNum=s=>s.replace(/[,:\s]/g,".");
  let lat="",lon="",m=norm.match(/Lat(?:itude)?[^0-9+-]*([+-]?\d{1,2}[.,:]\d{2,})[^0-9+-]{0,30}Lon(?:g(?:itude)?)?[^0-9+-]*([+-]?\d{1,3}[.,:]\d{2,})/i);
  if(m){ lat=cleanNum(m[1]); lon=cleanNum(m[2]); }
  if(!(lat&&lon)){ m=norm.match(/Lon(?:g(?:itude)?)?[^0-9+-]*([+-]?\d{1,3}[.,:]\d{2,})[^0-9+-]{0,30}Lat(?:itude)?[^0-9+-]*([+-]?\d{1,2}[.,:]\d{2,})/i); if(m){ lon=cleanNum(m[1]); lat=cleanNum(m[2]); } }
  if(!lat){ m=norm.match(/Lat(?:itude)?[^0-9+-]*([+-]?\d{1,2}[.,:]\d{2,})/i); if(m) lat=cleanNum(m[1]); }
  if(!lon){ m=norm.match(/Lon(?:g(?:itude)?)?[^0-9+-]*([+-]?\d{1,3}[.,:]\d{2,})/i); if(m) lon=cleanNum(m[1]); }
  if(!(lat&&lon)){ const nums=[...norm.matchAll(/[+-]?\d{1,3}[.,:]\d{2,}/g)].map(x=>cleanNum(x[0])); if(nums.length>=2){ lat=lat||nums[0]; lon=lon||nums[1]; } }
  let la=parseFloat(lat), lo=parseFloat(lon);
  const okLat=v=>isFinite(v)&&v>=-90&&v<=90, okLon=v=>isFinite(v)&&v>=-180&&v<=180;
  if(!okLat(la)) la=NaN; if(!okLon(lo)) lo=NaN;
  const looksLikeMumbaiLat=v=>v>18&&v<21, looksLikeMumbaiLon=v=>v>72&&v<73;
  if(okLat(la)&&okLon(lo)&&Math.abs(la-lo)<1e-6){ if(looksLikeMumbaiLon(la)) la=NaN; }
  if(okLat(la)&&okLon(lo)){ if(looksLikeMumbaiLon(la)&&looksLikeMumbaiLat(lo)){ const t=la; la=lo; lo=t; } }
  return { lat: okLat(la)?String(la):"", lon: okLon(lo)?String(lo):"" };
}
function parseAll(text){
  const raw=String(text||"").replace(/\u00A0|\u2009|\u2002|\u2003/g," ").replace(/[|·•]+/g," ").replace(/\s{2,}/g," ").trim();
  const linesAll=raw.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const isNoise=s=>/(?:gps\s*map\s*camera|google|wind|humidity|pressure|temperature|km\/h|hpa|°c|\bjoey\b)/i.test(s);
  const looksTime=s=>/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/i.test(s);
  const looksDate=s=>/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/.test(s);
  const isLatLonLine=s=>/\bLat|Lon(?:g|gitude)\b/i.test(s);

  const {lat,lon}=extractCoords(raw);

  let date="",time="";
  const toIsoDate=s=>{ const m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/); if(!m) return ""; let [_,d,mo,y]=m; if(y.length===2) y=+y<50?"20"+y:"19"+y; return `${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`; };
  const to24h=s=>{ s=s.trim().toUpperCase(); const m=s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/); if(!m) return ""; let h=+m[1],mi=m[2],ap=m[3]||""; if(ap==="PM"&&h<12) h+=12; if(ap==="AM"&&h===12) h=0; return `${String(h).padStart(2,"0")}:${mi}`; };
  const dt=raw.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}).{0,6}(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
  if(dt){ date=toIsoDate(dt[1]); time=to24h(dt[2]); }

  const looksAddressy=s=>/\p{L}/u.test(s)&&!isNoise(s)&&!looksDate(s)&&!looksTime(s)&&!isLatLonLine(s)&&( /,/.test(s) || s.split(/\s+/).filter(x=>x.length>=3).length>=3 );
  let idxLat=linesAll.findIndex(isLatLonLine); if(idxLat<0) idxLat=linesAll.length;
  const cand=[]; for(let i=idxLat-1;i>=0 && cand.length<3;i--){ const s=linesAll[i]; if(looksAddressy(s)) cand.unshift(s); else if(cand.length) break; }
  let address=cand.length?cand.join(", "):(linesAll.filter(looksAddressy).sort((a,b)=>b.length-a.length)[0]||"");
  const pin=raw.match(/\b[1-9]\d{5}\b/);
  address=cleanAddress(address);
  if(pin && !address.includes(pin[0])) address=address.replace(/(?:,\s*)?(India)\s*$/i,(m,$1)=>`, ${pin[0]}, ${$1}`);
  return { lat, lon, address, date, time };
}

/* ---------
   Redirect
   --------- */
function startRedirectCountdown(sec){
  clearInterval(state.countdownTimer);
  els.redirectNote.style.display="block";
  let left=sec;
  els.redirectNote.innerHTML=`All set. Redirecting to Google Form in <span class="countdown">${left}s</span>… <a href="#" id="cancelRedirect">Cancel</a>`;
  state.countdownTimer=setInterval(()=>{
    left-=1; const span=document.querySelector(".countdown"); if(span) span.textContent=left+"s";
    if(left<=0){ clearInterval(state.countdownTimer); window.location.href=buildPrefillURL(); }
  },1000);
  els.redirectNote.onclick=(e)=>{
    if(e.target && e.target.id==="cancelRedirect"){
      e.preventDefault(); clearInterval(state.countdownTimer);
      els.redirectNote.innerHTML=`<button id="openFormNow" class="btn">Open Google Form now</button>`;
      document.getElementById("openFormNow").onclick=()=>window.location.href=buildPrefillURL();
    }
  };
}

/* ---------------
   Events (robust upload UX)
   --------------- */
function bindDropzone(){
  if(!els.drop || !els.file) return;

  // Click anywhere in the zone
  els.drop.addEventListener("click", ()=> els.file.click());
  // Keyboard accessibility
  els.drop.addEventListener("keydown", (e)=>{ if(e.key==="Enter" || e.key===" "){ e.preventDefault(); els.file.click(); } });

  // Document-level drag guards (avoid browser opening the image)
  ["dragenter","dragover","dragleave","drop"].forEach(ev=>{
    document.addEventListener(ev,(e)=>{ e.preventDefault(); e.stopPropagation(); }, false);
  });

  // Visual cue on zone
  els.drop.addEventListener("dragover",(e)=>{ e.preventDefault(); els.drop.style.borderColor="#9ec5ff"; });
  els.drop.addEventListener("dragleave",()=>{ els.drop.style.borderColor="#cfe0f3"; });

  // Handle dropped file
  els.drop.addEventListener("drop",(e)=>{
    e.preventDefault(); els.drop.style.borderColor="#cfe0f3";
    const f=e.dataTransfer?.files?.[0]; if(f) runPipeline(f);
  });

  // Traditional chooser
  els.file.addEventListener("change",(e)=>{ const f=e.target.files?.[0]; if(f) runPipeline(f); });
}

/* ----------
   Pipeline
   ---------- */
async function runPipeline(file){
  const myRun=++state.activeRun;

  // Hide drop, show preview cards
  els.dropCard.style.display="none";
  els.originalCard.style.display="block";
  els.overlayCard.style.display="block";
  els.overlayWrap.style.display="flex";

  // Stage 0: Upload
  startStage(0); setStatus("Image loading…","ok");

  const reader=new FileReader();
  reader.onload=async ()=>{
    if(myRun!==state.activeRun) return;
    const dataUrl=reader.result;
    els.originalImg.src=dataUrl;

    setStatus("Optimising image…","warn");
    const cropped=await cropOverlay(dataUrl);
    if(myRun!==state.activeRun) return;
    endStage(0);

    // Stage 1: OCR
    startStage(1); setStatus("Running OCR…","warn");
    state.croppedUrl=cropped;
    els.overlayImg.src=state.croppedUrl;
    els.overlayScanner.style.display="block";

    async function ocrV5(){ const {data:{text}}=await Tesseract.recognize(state.croppedUrl,"eng+hin"); return text; }
    async function ocrV4(){ if(!window.Tesseract?.recognize) await addScript("https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js"); const {data:{text}}=await Tesseract.recognize(state.croppedUrl,"eng+hin"); return text; }

    let text=""; try{ text=await ocrV5(); }catch(e){ try{ text=await ocrV4(); }catch{ els.overlayScanner.style.display="none"; setStatus("OCR failed. Please Retry.","err"); onStageTimeout(1); return; } }

    els.overlayScanner.style.display="none"; endStage(1);

    // Stage 2: Parse
    startStage(2); setStatus("Parsing extracted text…","warn");
    // hide gray note now
    const note=document.getElementById("resultsNote"); if(note) note.remove();
    Object.assign(state.data, parseAll(text));
    render(); endStage(2);

    // Stage 3: GeoJSON
    startStage(3); setStatus("GeoJSON lookup…","warn");
    state.outside=false;
    if(state.data.lat && state.data.lon){
      const g=lookup(state.data.lat,state.data.lon);
      const {outside,...vals}=g; Object.assign(state.data,vals);
      render(); state.outside=outside;
    }else{ state.outside=true; }
    endStage(3);

    if(state.outside){
      setStatus("Outside MCGM Boundaries — Not allowed.","err");
      els.modalBackdrop.style.display="flex";
      return;
    }

    // Stage 4: Review
    startStage(4);
    setStatus(`Ready. GeoJSON loaded (W:${state.counts.wards} B:${state.counts.beats} PS:${state.counts.police}). Review the results.`,"ok");
    endStage(4);

    // Stage 5: Redirect
    startStage(5); startRedirectCountdown(5);
  };
  reader.readAsDataURL(file);
}

/* ----
   Boot
   ---- */
(async ()=>{
  initResultSkeleton();                           // show rows on load
  bindDropzone();                                 // robust upload UX
  els.modalBackdrop.style.display="none";
  els.timeoutBackdrop.style.display="none";
  if(els.appVersion) els.appVersion.textContent=BUILD;

  await loadOCR();
  try{
    await loadGeo();
    setStatus(`Maps loaded. W:${state.counts.wards} • B:${state.counts.beats} • PS:${state.counts.police}. Upload an image to begin.`,"ok");
  }catch(e){
    setStatus("Could not load GeoJSON (check /data paths & filenames).","err");
  }

  updateTimes();
})();
