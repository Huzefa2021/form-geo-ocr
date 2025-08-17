/* =========================================================
   MCGM – Marshal Upload Portal : Application Script (app.js)
   Build: v2025.08.17.Prod.v7
   ========================================================= */

/* ---------- Tiny DOM util ---------- */
function $(id){ if(id && id[0]==='#') id=id.slice(1); return document.getElementById(id); }

/* ---------- OCR CDNs ---------- */
const OCR_CDNS = [
  { label:"v5 (jsDelivr)", url:"https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" },
  { label:"v5 (unpkg)",    url:"https://unpkg.com/tesseract.js@5/dist/tesseract.min.js" },
  { label:"v4 (fallback)", url:"https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js" },
];
function addScript(src){ return new Promise((res,rej)=>{ const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
async function loadOCR(){
  const pill=$("#cdnPill");
  for(const cdn of OCR_CDNS){
    try{ await addScript(cdn.url); pill.textContent="CDN: "+cdn.label; pill.classList.add("ok"); return; }catch{}
  }
  pill.textContent="CDN: unavailable"; pill.classList.add("err");
}

/* ---------- Config ---------- */
const FORM_ID="1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw";
const ENTRY={
  date:"entry.1911996449", time:"entry.1421115881",
  lon:"entry.113122688",  lat:"entry.419288992",
  ward:"entry.1625337207", beat:"entry.1058310891",
  address:"entry.1188611077", police:"entry.1555105834"
};
const STAGE_LIMITS=[20000,90000,12000,15000,45000,20000];
const BUILD="v2025.08.17.Prod.v7";
const MUMBAI_BBOX=[72.60,18.80,73.20,19.50];

/* ---------- Elements ---------- */
const els={
  dropCard:$("#dropCard"), drop:$("#drop"), file:$("#file"),
  originalCard:$("#originalCard"), originalImg:$("#originalImg"),
  overlayCard:$("#overlayCard"), overlayWrap:$("#overlayWrap"),
  overlayImg:$("#overlayImg"), overlayScanner:$("#overlayScanner"),
  status:$("#status"), bar:$("#bar"), results:$("#results"),
  redirectNote:$("#redirectNote"), stageTimes:$("#stageTimes"),
  ms:[...document.querySelectorAll(".milestones .chip")],
  appVersion:$("#appVersion"),
};

/* ---------- State ---------- */
const state={
  activeRun:0,
  data:{ date:"", time:"", lat:"", lon:"", address:"", WARD:"", BEAT_NO:"", PS_NAME:"" },
  gjIndex:{ wards:null, beats:null, police:null },
  counts:{ wards:0, beats:0, police:0 },
  stageStart:Array(6).fill(null),
  stageElapsed:Array(6).fill(0),
  stageTimeouts:Array(6).fill(null),
  stageTicker:null,
  countdownTimer:null,
  lastPickToken:""
};

/* ---------- UI helpers ---------- */
function setStatus(msg,cls){ els.status.className="status "+(cls||""); els.status.textContent=msg; }
function kvRow(id,label,value){
  let row=$(id);
  if(!row){ row=document.createElement("div"); row.className="kv"; row.id=id; row.innerHTML=`<div class="k">${label}</div><div class="v"></div>`; els.results.appendChild(row); }
  if(value!==undefined && value!==null){ row.querySelector(".v").textContent=String(value||""); }
}
function initResultSkeleton(){
  kvRow("row-date","Date",""); kvRow("row-time","Time","");
  kvRow("row-lat","Latitude",""); kvRow("row-lon","Longitude","");
  kvRow("row-addr","Address",""); kvRow("row-ward","Ward","");
  kvRow("row-beat","Beat No.",""); kvRow("row-ps","Police Station","");
}
function render(){
  const d=state.data;
  kvRow("row-date","Date",d.date); kvRow("row-time","Time",d.time);
  kvRow("row-lat","Latitude",d.lat); kvRow("row-lon","Longitude",d.lon);
  kvRow("row-addr","Address",d.address); kvRow("row-ward","Ward",d.WARD);
  kvRow("row-beat","Beat No.",d.BEAT_NO); kvRow("row-ps","Police Station",d.PS_NAME);
}
function buildPrefillURL(){
  const p=new URLSearchParams({
    [ENTRY.date]:state.data.date||"", [ENTRY.time]:state.data.time||"",
    [ENTRY.lon]:state.data.lon||"",   [ENTRY.lat]:state.data.lat||"",
    [ENTRY.ward]:state.data.WARD||"", [ENTRY.beat]:state.data.BEAT_NO||"",
    [ENTRY.address]:state.data.address||"", [ENTRY.police]:state.data.PS_NAME||"", usp:"pp_url"
  });
  return `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?${p.toString()}`;
}
function applyChips(i){
  els.ms.forEach((chip,idx)=>{ chip.classList.remove("pending","active","done"); if(idx<i) chip.classList.add("done"); else if(idx===i) chip.classList.add("active"); else chip.classList.add("pending"); });
  els.bar.style.width=Math.max(0,Math.min(100,(i/5)*100))+"%";
}
function fmt(ms){ return ms>0&&isFinite(ms)?(ms/1000).toFixed(1)+"s":"0.0s"; }
function currentStageIndex(){ for(let i=0;i<6;i++) if(state.stageStart[i]!==null && state.stageElapsed[i]===0) return i; for(let i=5;i>=0;i--) if(state.stageElapsed[i]>0) return Math.min(i+1,5); return 0; }
function updateTimes(){
  const names=["Upload","OCR","Parse","GeoJSON","Review","Redirect"];
  els.stageTimes.textContent=names.map((n,i)=>{ const running=state.stageStart[i]!==null && i===currentStageIndex(); const val=running?Date.now()-state.stageStart[i]:state.stageElapsed[i]; return `${n} — ${fmt(val)}`; }).join(" • ");
}
function startStage(i){ for(let k=0;k<i;k++) if(state.stageStart[k]!==null && state.stageElapsed[k]===0) endStage(k); state.stageStart[i]=Date.now(); applyChips(i); if(!state.stageTicker) state.stageTicker=setInterval(updateTimes,200); clearTimeout(state.stageTimeouts[i]); state.stageTimeouts[i]=setTimeout(()=>onStageTimeout(i),STAGE_LIMITS[i]); }
function endStage(i){ if(state.stageStart[i]!==null && state.stageElapsed[i]===0) state.stageElapsed[i]=Date.now()-state.stageStart[i]; clearTimeout(state.stageTimeouts[i]); updateTimes(); }

/* ---------- Modals ---------- */
function showModal(title,body){ $("#modalTitle").textContent=title; $("#modalBody").innerHTML=body; $("#modalBackdrop").style.display="flex"; }
function hideModal(){ $("#modalBackdrop").style.display="none"; }
function onStageTimeout(i){ $("#timeoutTitle").textContent=`Stage Timed Out — ${["Upload","OCR","Parse","GeoJSON","Review","Redirect"][i]}`; $("#timeoutBackdrop").style.display="flex"; }
document.addEventListener("click",(e)=>{ const id=e.target.id; if(id==="modalCancel") hideModal(); else if(id==="modalReset"||id==="timeoutRetry") location.reload(); else if(id==="timeoutClose") $("#timeoutBackdrop").style.display="none"; });

/* ---------- GeoJSON ---------- */
function indexFC(fc){ const items=(fc.features||[]).map(f=>({f,b:turf.bbox(f)})); return {items,n:(fc.features||[]).length}; }
function firstProp(props,keys){ for(const k of keys){ const v=props?.[k]; if(v!==undefined&&v!==null&&String(v).trim()!=="") return String(v).trim(); } return ""; }
function getBeat(props){ const v=firstProp(props,["BEAT_NO","Beat_No","BEAT","Beat","BEATNO","BeatNo","beat_no","Beat_Number","BeatNumber"]); if(v) return v; const n=props?.name||props?.NAME||""; const m=String(n).match(/Beat\s*([A-Za-z0-9]+)/i); return m?m[1]:(n||""); }
function inMumbaiBBox(pt){ return pt[0]>=MUMBAI_BBOX[0]&&pt[0]<=MUMBAI_BBOX[2]&&pt[1]>=MUMBAI_BBOX[1]&&pt[1]<=MUMBAI_BBOX[3]; }
function pipIndexed(idx,pt,getVal){ if(!idx?.items) return ""; const point=turf.point(pt); for(const {f,b} of idx.items){ if(pt[0]<b[0]||pt[0]>b[2]||pt[1]<b[1]||pt[1]>b[3]) continue; try{ if(turf.booleanPointInPolygon(point,f)) return getVal(f.properties); }catch{} } for(const {f} of idx.items){ try{ if(turf.booleanPointInPolygon(point,f)) return getVal(f.properties); }catch{} } return ""; }
function nearestIndexed(idx,pt,keys,meters){ if(!idx?.items) return {value:"",meters:Infinity}; const point=turf.point(pt); let best=Infinity,val=""; for(const {f} of idx.items){ try{ const c=turf.center(f); const d=turf.distance(point,c,{units:"meters"}); if(d<best){ best=d; val=firstProp(f.properties,keys)||f.properties?.name||f.properties?.NAME||""; } }catch{} } return (best<=meters)?{value:val,meters:best}:{value:"",meters:best}; }
async function loadGeo(){ const [w,b,p]=await Promise.all([ fetch("./data/wards.geojson").then(r=>r.json()), fetch("./data/beats.geojson").then(r=>r.json()), fetch("./data/police_jurisdiction.geojson").then(r=>r.json()) ]); state.gjIndex.wards=indexFC(w); state.gjIndex.beats=indexFC(b); state.gjIndex.police=indexFC(p); state.counts={wards:state.gjIndex.wards.n,beats:state.gjIndex.beats.n,police:state.gjIndex.police.n}; }
function lookup(lat,lon){
  const pt=[parseFloat(lon),parseFloat(lat)];
  const ward=pipIndexed(state.gjIndex.wards,pt,p=>firstProp(p,["WARD","Ward","ward","WARD_NO","Ward_No","WARDNAME","WardName","NAME","name"]));
  let beat=pipIndexed(state.gjIndex.beats,pt,p=>getBeat(p));
  let ps=pipIndexed(state.gjIndex.police,pt,p=>firstProp(p,["PS_NAME","PS","Police_Station","PoliceStation","ps_name","PSName","PS_Name","name","NAME"]));
  if(!beat){ const n=nearestIndexed(state.gjIndex.beats,pt,["BEAT_NO","Beat_No","BEAT","Beat","BEATNO","BeatNo","beat_no","Beat_Number","BeatNumber","name","NAME"],300); if(n.value){ const m=String(n.value).match(/Beat\s*([A-Za-z0-9]+)/i); beat=m?m[1]:n.value; } }
  if(!ps){ const n=nearestIndexed(state.gjIndex.police,pt,["PS_NAME","PS","Police_Station","PoliceStation","ps_name","PSName","PS_Name","name","NAME"],500); if(n.value) ps=n.value; }
  const hasAny=!!(ward||beat||ps); const outside=!hasAny && !inMumbaiBBox(pt);
  return {WARD:ward,BEAT_NO:beat,PS_NAME:ps,outside};
}

/* ---------- Imaging & Preprocessing ---------- */
async function cropToBand(dataURL, frac){
  const blob=await (await fetch(dataURL)).blob();
  const bmp=await createImageBitmap(blob);
  const W=bmp.width, H=bmp.height;
  const cropH=Math.max(120,Math.round(H*frac));
  const cropY=Math.max(0, H - cropH);
  const targetW=1400, scale=Math.min(1,targetW/W);
  const outW=Math.round(W*scale), outH=Math.round(cropH*scale);
  const c=document.createElement("canvas"); c.width=outW; c.height=outH;
  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(bmp,0,cropY,W,cropH,0,0,outW,outH);
  return c;
}
function canvasToDataURL(c){ return c.toDataURL("image/png"); }

function enhanceWithCV(canvas){
  try{
    if(!(window.__cvLoaded && window.cv && cv.Mat)) return null;
    const src  = cv.imread(canvas);
    const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.equalizeHist(gray, gray);
    const blur = new cv.Mat(); cv.GaussianBlur(gray, blur, new cv.Size(3,3), 0, 0, cv.BORDER_DEFAULT);

    const bin1 = new cv.Mat(); // adaptive
    cv.adaptiveThreshold(blur, bin1, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 10);
    const bin2 = new cv.Mat(); // Otsu
    cv.threshold(blur, bin2, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

    // choose whitest
    const m1 = cv.mean(bin1)[0], m2 = cv.mean(bin2)[0];
    let best = m1>=m2 ? bin1 : bin2;

    // Ensure white background using MEDIAN ( steadier than mean )
    const hist = new cv.Mat();
    cv.calcHist([best], [0], new cv.Mat(), hist, [256], [0,256]);
    let cum=0, medianIdx=0, total=cv.countNonZero(best);
    for(let i=0;i<256;i++){ cum+=hist.data32F[i]; if(cum>=total/2){ medianIdx=i; break; } }
    if (medianIdx < 127) { const inv=new cv.Mat(); cv.bitwise_not(best, inv); best.delete(); best=inv; }
    hist.delete();

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2,2));
    cv.morphologyEx(best, best, cv.MORPH_CLOSE, kernel);
    cv.GaussianBlur(best, best, new cv.Size(3,3), 0, 0, cv.BORDER_DEFAULT);

    cv.imshow(canvas, best);
    const url = canvas.toDataURL("image/png");

    src.delete(); gray.delete(); blur.delete(); bin1.delete(); bin2.delete(); best.delete(); kernel.delete();
    return url;
  }catch(e){ return null; }
}
function enhanceWithCanvas(canvas){
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const {width:w,height:h}=canvas;
  const img=ctx.getImageData(0,0,w,h), d=img.data;
  for(let i=0;i<d.length;i+=4){
    const y=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];
    const ys = Math.min(255, Math.max(0, (y-40)*1.6 ));
    const v = ys>150 ? 255 : ys<70 ? 0 : ys;
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(img,0,0);
  const img2=ctx.getImageData(0,0,w,h), d2=img2.data;
  let sum=0; for(let i=0;i<d2.length;i+=4) sum+=d2[i];
  const mean=sum/(d2.length/4);
  if(mean<127){ for(let i=0;i<d2.length;i+=4){ d2[i]=255-d2[i]; d2[i+1]=255-d2[i+1]; d2[i+2]=255-d2[i+2]; } ctx.putImageData(img2,0,0); }
  return canvas.toDataURL("image/png");
}
/* Returns {displayUrl, ocrUrl} */
async function cropOverlay(dataURL){
  // Wider sweep – auto picks clearest
  const bands=[0.45,0.40,0.36,0.32];
  let best=null, bestMean=-1;
  for(const f of bands){
    const c = await cropToBand(dataURL, f);
    let url = enhanceWithCV(c);
    if(!url) url = enhanceWithCanvas(c);
    const ctx=c.getContext("2d");
    const img=ctx.getImageData(0,0,c.width,c.height).data;
    let sum=0; for(let i=0;i<img.length;i+=4) sum+=img[i];
    const mean=sum/(img.length/4);
    if(mean>bestMean){ bestMean=mean; best={displayUrl:canvasToDataURL(c), ocrUrl:url}; }
  }
  return best;
}

/* ---------- Address & Coordinates (hardened) ---------- */
function cleanAddressBasic(a){
  a=String(a||"");
  a=a.replace(/\b[\w]{3,}\+[\w]{2,}\b/gi," ");                 // plus-codes
  a=a.replace(/(?:GPS|Map|Camera|Wind|Humidity|Pressure|Temperature|Google).*/i," ");
  a=a.replace(/[^0-9A-Za-z\u0900-\u097F ,./\-]/g," ");
  a=a.replace(/\s{2,}/g," ").replace(/\s*,\s*/g,", ").replace(/,\s*,/g,", ").replace(/^\s*,\s*|\s*,\s*$/g,"");
  a=a.replace(/,?\s*India\s*,\s*India/i,", India").trim();
  return a;
}
const STREET_KEYS=["road","rd","lane","ln","marg","nagar","society","chawl","bldg","building","sector","plot","opp","opposite","near","behind","east","west","north","south","estate","industrial","midc","central","marol","andheri","santacruz","vakola","khar"];
const CITY_KEYS=["mumbai","thane","navi mumbai","maharashtra","india"];
function latinRatio(s){ const en=(s.match(/[A-Za-z]/g)||[]).length; const dev=(s.match(/[\u0900-\u097F]/g)||[]).length; const tot=en+dev; return tot?en/tot:1; }
function looksUsefulSeg(s){
  const t=s.trim();
  if(!t) return false;
  if(/^(?:joey|wind|humidity|pressure|temperature)\b/i.test(t)) return false;
  if(/^\d{8,}$/.test(t)) return false;                 // NEW: drop long numeric counters
  if(/^(?:[A-Za-z]\s+){3,}$/.test(t)) return false;
  return true;
}
function scoreSegment(s){
  const t=s.toLowerCase(); let score=0;
  if(/\b[1-9]\d{5}\b/.test(t)) score+=50;
  if(CITY_KEYS.some(k=>t.includes(k))) score+=25;
  for(const k of STREET_KEYS) if(new RegExp(`\\b${k}\\b`).test(t)) score+=5;
  if(latinRatio(t)>0.75) score+=10;                   // bias to clean English
  if(t.length>25) score+=6;
  return score;
}

/* Robust lat/lon with timezone guard */
function extractCoords(rawText){
  let norm=String(rawText||"").replace(/\u00A0|\u2009|\u2002|\u2003/g," ").replace(/[°]/g,"").replace(/O/g,"0");
  norm=norm.replace(/(\d)[Il|]([0-9])/g,"$11$2").replace(/(\d)[Il|]([.,:]\d)/g,(m,a,b)=>`${a}1${b}`).replace(/(\d)[Ss]([0-9])/g,"$15$2").replace(/(\d)[Bb]([0-9])/g,"$18$2");
  const cleanNum=s=>s.replace(/[,:\s]/g,"."); const numRe=/[+-]?\d{1,3}(?:[.,:]\d{2,7})/g;

  let lat="",lon="",m=norm.match(/Lat(?:itude)?[^0-9+-]*([+-]?\d{1,2}[.,:]\d{1,7})[^0-9+-]{0,40}Lon(?:g(?:itude)?)?[^0-9+-]*([+-]?\d{1,3}[.,:]\d{1,7})/i);
  if(m){ lat=cleanNum(m[1]); lon=cleanNum(m[2]); }
  if(!(lat&&lon)){ m=norm.match(/Lon(?:g(?:itude)?)?[^0-9+-]*([+-]?\d{1,3}[.,:]\d{1,7})[^0-9+-]{0,40}Lat(?:itude)?[^0-9+-]*([+-]?\d{1,2}[.,:]\d{1,7})/i); if(m){ lon=cleanNum(m[1]); lat=cleanNum(m[2]); } }

  const okLat=v=>isFinite(v)&&v>=-90&&v<=90, okLon=v=>isFinite(v)&&v>=-180&&v<=180;
  if(lat&&lon){
    let la=parseFloat(lat), lo=parseFloat(lon);
    if(okLat(la)&&okLon(lo)&&Math.abs(la-lo)<1e-6) la=NaN;
    if(okLat(la)&&okLon(lo) && (la>72&&la<73) && (lo>18&&lo<21)){ const t=la; la=lo; lo=t; }
    return { lat: okLat(la)?String(la):"", lon: okLon(lo)?String(lo):"" };
  }

  const matches=[...norm.matchAll(numRe)].map(mm=>{
    const raw=mm[0], val=parseFloat(cleanNum(raw)), index=mm.index??0;
    const ctx=norm.slice(Math.max(0,index-8), Math.min(norm.length,index+raw.length+8)).toUpperCase();
    const nearTZ=/GMT|UTC|\+\s*\d|\-\s*\d/.test(ctx);
    const hasColon=/:/.test(raw);
    const looksTime=hasColon && !/Lon|Lat/i.test(ctx) && /\b\d{1,2}:\d{2}\b/.test(raw.replace(/[^\d:]/g,""));
    return {raw,val,index,nearTZ,looksTime};
  });
  const latC=matches.filter(n=>n.val>=-90&&n.val<=90 && !(n.val<=10 && (n.nearTZ||n.looksTime)));
  const lonC=matches.filter(n=>n.val>=-180&&n.val<=180);

  let best=Infinity,pair=null;
  for(const la of latC){
    for(const lo of lonC){
      const mLat=Math.abs(la.val-19.1), mLon=Math.abs(lo.val-72.9);
      const tzPenalty=(la.val<=10 && (la.nearTZ||la.looksTime))?50:0;
      const eqPenalty=(la.val===lo.val)?5:0;
      const score=mLat+mLon+tzPenalty+eqPenalty;
      if(score<best){ best=score; pair={la:la.val,lo:lo.val}; }
    }
  }
  if(pair){
    let la=pair.la, lo=pair.lo;
    if(okLat(la)&&okLon(lo)&&Math.abs(la-lo)<1e-6) la=NaN;
    if(okLat(la)&&okLon(lo) && (la>72&&la<73) && (lo>18&&lo<21)){ const t=la; la=lo; lo=t; }
    return { lat: okLat(la)?String(la):"", lon: okLon(lo)?String(lo):"" };
  }
  return { lat:"", lon:"" };
}

/* Stronger address picker */
function extractAddress(raw){
  const text=String(raw||"").replace(/\u00A0|\u2009|\u2002|\u2003/g," ").replace(/[|·•]+/g," ").replace(/\s{2,}/g," ").trim();
  const lines=text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const latIdx = (()=>{
    for(let i=lines.length-1;i>=0;i--) if(/\bLat/i.test(lines[i])) return i;
    return lines.length;
  })();
  const candidates=lines.slice(Math.max(0,latIdx-4), latIdx).filter(looksUsefulSeg).map(cleanAddressBasic);

  let joined=candidates.join(", ");
  const indiaIdx=joined.toLowerCase().lastIndexOf("india");
  if(indiaIdx>0){ joined = joined.slice(0, indiaIdx + "india".length); }

  const segs = joined.split(/\s*,\s*/).map(s=>s.trim()).filter(looksUsefulSeg);
  segs.sort((a,b)=>scoreSegment(b)-scoreSegment(a));
  const picked = [...new Set(segs.slice(0,6))];

  const orderScore = s=>{
    const t=s.toLowerCase();
    if(/\b(?:plot|flat|bldg|building|road|rd|lane|ln|marg)\b/.test(t)||/^\d+/.test(t)) return 10;
    if(/\b(?:nagar|society|estate|midc|industrial|village|sector|marol|andheri|santacruz|vakola|khar)\b/.test(t)) return 8;
    if(/\bmumbai\b/.test(t)) return 6;
    if(/\bmaharashtra\b/.test(t)) return 4;
    if(/\b[1-9]\d{5}\b/.test(t)) return 2;
    if(/\bindia\b/.test(t)) return 1;
    return 5;
  };
  picked.sort((a,b)=>orderScore(b)-orderScore(a));

  let addr = picked.join(", ");
  addr = addr.replace(/(?:\b[A-Za-z]\b\s*){3,}/g," ");
  addr = addr.replace(/\s{2,}/g," ").replace(/\s*,\s*/g,", ").replace(/,\s*,/g,", ").replace(/^\s*,\s*|\s*,\s*$/g,"");
  const pin = text.match(/\b[1-9]\d{5}\b/);
  if(pin && !addr.includes(pin[0])) addr = addr ? `${addr}, ${pin[0]}` : pin[0];
  if(addr && !/,\s*India$/i.test(addr)) addr = `${addr}, India`;
  return addr;
}

/* ---------- Parsing wrapper ---------- */
function parseAll(text){
  const raw=String(text||"").replace(/\u00A0|\u2009|\u2002|\u2003/g," ").replace(/[|·•]+/g," ").replace(/\s{2,}/g," ").trim();
  const toIsoDate=s=>{ const m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/); if(!m) return ""; let [_,d,mo,y]=m; if(y.length===2) y=+y<50?"20"+y:"19"+y; return `${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`; };
  const to24h=s=>{ s=s.trim().toUpperCase(); const m=s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/); if(!m) return ""; let h=+m[1],mi=m[2],ap=m[3]||""; if(ap==="PM"&&h<12) h+=12; if(ap==="AM"&&h===12) h=0; return `${String(h).padStart(2,"0")}:${mi}`; };
  const dt=raw.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}).{0,6}(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
  const date=dt?toIsoDate(dt[1]):""; const time=dt?to24h(dt[2]):"";
  const { lat, lon } = extractCoords(raw);
  const address = extractAddress(raw);
  return { lat, lon, address, date, time };
}

/* ---------- OCR with dynamic language ---------- */
async function ensureV4(){
  if(!window.Tesseract?.recognize){
    await addScript("https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js");
  }
}
async function ocrRecognize(url){
  // quick prepass on downscaled strip (fast)
  let langHint="eng";
  try{
    const bmp=await createImageBitmap(await (await fetch(url)).blob());
    const c=document.createElement("canvas");
    c.width=Math.max(1,Math.floor(bmp.width*0.3));
    c.height=Math.max(1,Math.floor(bmp.height*0.3));
    c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
    const strip=c.toDataURL("image/png");
    try{
      const probe=await Tesseract.recognize(strip,"eng",{ tessedit_pageseg_mode:6, preserve_interword_spaces:1 });
      if(/[\u0900-\u097F]/.test(probe?.data?.text||"")) langHint="eng+hin+mar";
    }catch{}
  }catch{}
  try{
    const {data:{text}}=await Tesseract.recognize(url,langHint);
    return text;
  }catch{
    await ensureV4();
    const {data:{text}}=await Tesseract.recognize(url,langHint);
    return text;
  }
}

/* ---------- Redirect ---------- */
function startRedirectCountdown(sec){
  clearInterval(state.countdownTimer);
  els.redirectNote.style.display="block";
  let left=sec;
  els.redirectNote.innerHTML=`All set. Redirecting to Google Form in <span class="countdown">${left}s</span>… <a href="#" id="cancelRedirect">Cancel</a>`;
  state.countdownTimer=setInterval(()=>{ left-=1; const span=document.querySelector(".countdown"); if(span) span.textContent=left+"s"; if(left<=0){ clearInterval(state.countdownTimer); window.location.href=buildPrefillURL(); } },1000);
  els.redirectNote.onclick=(e)=>{ if(e.target && e.target.id==="cancelRedirect"){ e.preventDefault(); clearInterval(state.countdownTimer); els.redirectNote.innerHTML=`<button id="openFormNow" class="btn">Open Google Form now</button>`; $("#openFormNow").onclick=()=>window.location.href=buildPrefillURL(); } };
}

/* ---------- Upload UX ---------- */
function isAllowedImage(file){ if(!file) return false; const type=(file.type||"").toLowerCase(); if(type.startsWith("image/")) return true; const ext=file.name?.split(".").pop()?.toLowerCase()||""; return ["jpg","jpeg","png","webp","heic","heif"].includes(ext); }
function tokenOf(file){ return `${file.name}::${file.size}`; }
function bindDropzone(){
  const dz=els.drop, fi=els.file; if(!dz||!fi) return;
  dz.addEventListener("keydown",(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); fi.click(); } });
  ["dragenter","dragover","dragleave","drop"].forEach(ev=>{ document.addEventListener(ev,(e)=>{ e.preventDefault(); e.stopPropagation(); }, false); });
  dz.addEventListener("dragover",(e)=>{ e.preventDefault(); dz.style.borderColor="#9ec5ff"; });
  dz.addEventListener("dragleave",()=>{ dz.style.borderColor="#cfe0f3"; });
  dz.addEventListener("drop",(e)=>{ e.preventDefault(); dz.style.borderColor="#cfe0f3"; const f=e.dataTransfer?.files?.[0]; if(!f) return; if(!isAllowedImage(f)){ showModal("Unsupported file","Only image files (JPG, PNG, WEBP, HEIC/HEIF) are allowed."); return; } runPipeline(f); });
  fi.addEventListener("change",(e)=>{ const f=e.target.files?.[0]; if(!f) return; if(!isAllowedImage(f)){ showModal("Unsupported file","Only image files (JPG, PNG, WEBP, HEIC/HEIF) are allowed."); fi.value=""; return; } const tok=tokenOf(f); if(state.lastPickToken===tok) return; state.lastPickToken=tok; runPipeline(f); });
  $("#btnReset").onclick=()=>location.reload();
}

/* ---------- Pipeline ---------- */
async function runPipeline(file){
  const myRun=++state.activeRun;
  els.dropCard.style.display="none"; els.originalCard.style.display="block"; els.overlayCard.style.display="block"; els.overlayWrap.style.display="flex";

  startStage(0); setStatus("Image loading…","ok");
  const reader=new FileReader();
  reader.onload=async ()=>{
    if(myRun!==state.activeRun) return;
    const dataUrl=reader.result; els.originalImg.src=dataUrl;

    setStatus("Optimising image…","warn");
    const crop = await cropOverlay(dataUrl);   // {displayUrl, ocrUrl}
    if(myRun!==state.activeRun) return;
    endStage(0);

    startStage(1); setStatus("Running OCR…","warn");
    els.overlayImg.src=crop.displayUrl; els.overlayScanner.style.display="block";

    let text="";
    try{ text=await ocrRecognize(crop.ocrUrl); }
    catch{ els.overlayScanner.style.display="none"; setStatus("OCR failed. Please Retry.","err"); onStageTimeout(1); return; }
    els.overlayScanner.style.display="none"; endStage(1);

    startStage(2); setStatus("Parsing extracted text…","warn");
    $("#resultsNote")?.remove();
    Object.assign(state.data, parseAll(text));
    render(); endStage(2);

    startStage(3); setStatus("GeoJSON lookup…","warn");
    let stop=false, msg="";
    if(state.data.lat && state.data.lon){
      const g=lookup(state.data.lat,state.data.lon);
      Object.assign(state.data,{ WARD:g.WARD, BEAT_NO:g.BEAT_NO, PS_NAME:g.PS_NAME });
      render();
      if(g.outside){ stop=true; msg="The detected coordinates are <strong>outside MCGM boundaries</strong>. You cannot submit this entry."; }
    } else { stop=true; msg="Could not detect <strong>Latitude/Longitude</strong> from the image."; }
    if(!stop && (!state.data.WARD || !state.data.BEAT_NO || !state.data.PS_NAME)){ stop=true; msg="GeoJSON mapping is <strong>incomplete</strong> (Ward/Beat/Police Station missing). Please try another photo."; }
    endStage(3);
    if(stop){ setStatus("Submission blocked.","err"); showModal("Submission blocked",msg); return; }

    startStage(4); setStatus(`Ready. GeoJSON loaded (W:${state.counts.wards} B:${state.counts.beats} PS:${state.counts.police}). Review the results.`,"ok"); endStage(4);
    startStage(5); startRedirectCountdown(5);
  };
  reader.readAsDataURL(file);
}

/* ---------- Boot ---------- */
(async ()=>{
  initResultSkeleton(); bindDropzone(); els.appVersion.textContent=BUILD;
  await loadOCR();
  try{ await loadGeo(); setStatus(`Maps loaded. W:${state.counts.wards} • B:${state.counts.beats} • PS:${state.counts.police}. Upload an image to begin.`,"ok"); }
  catch{ setStatus("Could not load GeoJSON (check /data paths & filenames).","err"); }
  updateTimes();
})();
