/* app.js — MCGM Marshal Upload
   Build: v2025.08.18.Prod (pills sticky, cropped overlay inside Results)
*/
const CFG = {
  previews: { originalScale: 0.25, cropScale: 0.50 },
  cropHUD: { topFromBottomPct: 0.28, leftTrimPct: 0.18, rightTrimPct: 0.02 },
  ocr: { primaryLang: "eng", secondaryLang: "hin", rerunOnDevanagari: true },
  geojson: {
    wards: "data/wards.geojson",
    beats: "data/beats.geojson",
    police: "data/police_jurisdiction.geojson",
    bounds: { lat: [18.0, 20.0], lon: [72.0, 73.5] }
  },
  outsideMsg: "Outside MCGM Boundaries — Not allowed.",
  GOOGLE_FORM: {
    enabled: true,
    mode: "open",
    action: "https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform",
    fields: {
      date:      "entry.1911996449",
      time:      "entry.1421115881",
      longitude: "entry.113122688",
      latitude:  "entry.419288992",
      ward:      "entry.1625337207",
      beat:      "entry.1058310891",
      address:   "entry.1188611077",
      ps:        "entry.1555105834"
    }
  }
};

const state = { img:null, crop:null, text:"", parsed:null, loc:null, polygons:null, timers:{} };
const $ = s => document.querySelector(s);
const setText = (sel,val)=>{ const el=$(sel); if(el) el.textContent = (val ?? "—"); };

const pillIds = ["#stage-upload","#stage-ocr","#stage-parse","#stage-geojson","#stage-review","#stage-redirect"];
function markStage(i,cls){ const el=$(pillIds[i]); if(!el) return; el.classList.remove("ok","active","pending","err"); el.classList.add(cls); }

function startTimer(name){ state.timers[name]=performance.now(); }
function endTimer(name){ const t0=state.timers[name]; if(!t0) return; const dt=(performance.now()-t0)/1000;
  const el=document.querySelector(`.pill-time[data-time="${name}"]`); if(el) el.textContent=`(${dt.toFixed(1)}s)`; }

const fileInput=$("#fileInput"), dropzone=$("#dropzone");
const origImgEl=$("#origPreview"), cropImgEl=$("#cropPreview");

function setupDnD(){
  ["dragenter","dragover"].forEach(ev=>{
    dropzone.addEventListener(ev,e=>{e.preventDefault(); dropzone.classList.add("dragging");});
  });
  ["dragleave","drop"].forEach(ev=>{
    dropzone.addEventListener(ev,e=>{e.preventDefault(); dropzone.classList.remove("dragging");});
  });
  dropzone.addEventListener("drop", e=>{
    const f=e.dataTransfer?.files?.[0]; if(f) handleFile(f);
  });
  dropzone.addEventListener("click", ()=>fileInput?.click());
  fileInput?.addEventListener("change", e=>{
    const f=e.target.files?.[0]; if(f) handleFile(f);
    e.target.value="";
  });
}

function readAsDataURL(file){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); }); }
function drawScaled(img,scale){
  const c=document.createElement("canvas"); c.width=Math.max(1,Math.round(img.naturalWidth*scale)); c.height=Math.max(1,Math.round(img.naturalHeight*scale));
  c.getContext("2d").drawImage(img,0,0,c.width,c.height); return c.toDataURL("image/jpeg",0.9);
}
function cropHUD(img){
  const {topFromBottomPct,leftTrimPct,rightTrimPct}=CFG.cropHUD;
  const W=img.naturalWidth,H=img.naturalHeight;
  const top=Math.max(0,Math.round(H*(1-topFromBottomPct)));
  const height=H-top;
  const left=Math.round(W*leftTrimPct);
  const right=Math.round(W*(1-rightTrimPct));
  const width=Math.max(20,right-left);
  const c=document.createElement("canvas"); c.width=width; c.height=height;
  c.getContext("2d").drawImage(img,left,top,width,height,0,0,width,height);
  return c.toDataURL("image/jpeg",0.95);
}

/* OCR */
async function runOCR(dataURL, lang){
  markStage(1,"active"); startTimer("OCR");
  if(!window.Tesseract||!Tesseract.recognize){ markStage(1,"err"); endTimer("OCR"); throw new Error("Tesseract missing"); }
  const {data}=await Tesseract.recognize(dataURL, lang||CFG.ocr.primaryLang);
  endTimer("OCR"); markStage(1,"ok");
  return data?.text||"";
}

/* Parse */
const RE={
  date:/\b(0?[1-9]|[12][0-9]|3[01])[-\/. ](0?[1-9]|1[0-2])[-\/. ](20\d{2})\b/,
  time:/\b([01]?\d|2[0-3]):([0-5]\d)(?:\s?([AP]M))?\b/i,
  latLine:/lat[^0-9\-]*([\-]?\d{1,2}[.,]\d{3,8})/i,
  lonLine:/lon[^0-9\-]*([\-]?\d{1,3}[.,]\d{3,8})/i,
  dec:/([\-]?\d{1,3}[.,]\d{3,8})/g
};
const normNum = s => (s==null)?null:Number(String(s).replace(/[^\d\.\-]/g,"").replace(",","."));
function clamp(n,lo,hi){return Math.min(hi,Math.max(lo,n));}

function parseDateTime(text){
  let date=null,time=null;
  const dm=RE.date.exec(text); if(dm){ const dd=dm[1].padStart(2,"0"),mm=dm[2].padStart(2,"0"),yyyy=dm[3]; date=`${yyyy}-${mm}-${dd}`; }
  const tm=RE.time.exec(text); if(tm){ let hh=parseInt(tm[1],10), mm=tm[2], ap=(tm[3]||"").toUpperCase(); if(ap==="PM"&&hh<12)hh+=12; if(ap==="AM"&&hh===12)hh=0; time=`${String(hh).padStart(2,"0")}:${mm}`; }
  return {date,time};
}
function extractLatLon(text){
  let lat=null,lon=null;
  const m1=RE.latLine.exec(text); if(m1) lat=normNum(m1[1]);
  const m2=RE.lonLine.exec(text); if(m2) lon=normNum(m2[1]);
  const cand=Array.from(text.matchAll(RE.dec)).map(m=>normNum(m[1]));
  const inLat=cand.filter(x=>x>-90&&x<90), inLon=cand.filter(x=>x>-180&&x<180);
  const within=CFG.geojson.bounds;
  const okLat=x=>x>=within.lat[0]&&x<=within.lat[1], okLon=x=>x>=within.lon[0]&&x<=within.lon[1];
  if((lat==null||!okLat(lat)) && inLat.length){ const pick=inLat.find(okLat); if(pick!=null) lat=pick; }
  if((lon==null||!okLon(lon)) && inLon.length){ const pick=inLon.find(okLon); if(pick!=null) lon=pick; }
  if(lat!=null) lat=clamp(lat,-90,90);
  if(lon!=null) lon=clamp(lon,-180,180);
  return {lat,lon};
}
function parseAddress(text){
  let out=""; const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  for(const s of lines){
    if(/lat|long|wind|humidity|pressure|temperature|gmt/i.test(s)) continue;
    if(/\b(mumbai|maharashtra|india)\b/i.test(s)) out+=(out?" ":"")+s;
  }
  out=out.replace(/[|]/g,"1").replace(/, ,/g,",").replace(/\s{2,}/g," ").trim();
  if(!out) out = lines.sort((a,b)=>b.length-a.length)[0]||"";
  return out;
}
function parseOCR(text){
  markStage(2,"active"); startTimer("Parse");
  const {date,time}=parseDateTime(text);
  const {lat,lon}=extractLatLon(text);
  const addr=parseAddress(text);
  endTimer("Parse"); markStage(2,"ok");
  return {date,time,lat,lon,addr};
}

/* GeoJSON */
async function loadGeoJSON(url){ const r=await fetch(url,{cache:"no-store"}); if(!r.ok) throw new Error("load "+url); return r.json(); }
function bboxScanner(){ let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; return {
  scan(arr){ for(const p of arr){ const [x,y]=p; if(x<minX)minX=x; if(y<minY)minY=y; if(x>maxX)maxX=x; if(y>maxY)maxY=y; } },
  get(){return [minX,minY,maxX,maxY];}
};}
function buildIndex(gj){
  const out=[];
  for(const f of gj.features){ const g=f.geometry, props=f.properties||{}; if(!g) continue;
    if(g.type==="Polygon"){ const bb=bboxScanner(); bb.scan(g.coordinates[0]); out.push({type:"Polygon",coords:g.coordinates,bbox:bb.get(),props}); }
    else if(g.type==="MultiPolygon"){ const bb=bboxScanner(); for(const poly of g.coordinates) bb.scan(poly[0]); out.push({type:"MultiPolygon",coords:g.coordinates,bbox:bb.get(),props}); }
  }
  return out;
}
function bboxHit(pt,b){ const [a,b1,c,d]=b; return pt[0]>=a&&pt[0]<=c&&pt[1]>=b1&&pt[1]<=d; }
function pnpoly(pt,ring){ const x=pt[0],y=pt[1]; let inside=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
  const intersect=((yi>y)!==(yj>y)) && (x < ((xj-xi)*(y-yi))/(yj-yi)+xi); if(intersect) inside=!inside;
} return inside; }
function inPoly(pt,poly){ if(!pnpoly(pt,poly[0])) return false; for(let h=1;h<poly.length;h++) if(pnpoly(pt,poly[h])) return false; return true; }
function inMulti(pt,mp){ for(const poly of mp) if(inPoly(pt,poly)) return true; return false; }

function resolvePoint(lat,lon,idx){
  markStage(3,"active"); startTimer("GeoJSON");
  const pt=[lon,lat]; const res={ward:"—",beat:"—",ps:"—",inside:false};
  for(const it of idx.wards){ if(!bboxHit(pt,it.bbox)) continue; const hit=it.type==="Polygon"?inPoly(pt,it.coords):inMulti(pt,it.coords);
    if(hit){ res.ward=it.props.WARD||it.props.ward||it.props.name||"—"; res.inside=true; break; } }
  for(const it of idx.beats){ if(!bboxHit(pt,it.bbox)) continue; const hit=it.type==="Polygon"?inPoly(pt,it.coords):inMulti(pt,it.coords);
    if(hit){ res.beat=it.props.BEAT_NO||it.props.BEAT||it.props.name||"—"; break; } }
  for(const it of idx.police){ if(!bboxHit(pt,it.bbox)) continue; const hit=it.type==="Polygon"?inPoly(pt,it.coords):inMulti(pt,it.coords);
    if(hit){ res.ps=it.props.PS_NAME||it.props.POLICE_STN||it.props.name||"—"; break; } }
  endTimer("GeoJSON"); markStage(3,"ok");
  return res;
}

/* Google Form */
function tryOpenGoogleForm(parsed,loc){
  const cfg=CFG.GOOGLE_FORM; if(!cfg.enabled) return;
  if(!parsed?.date||!parsed?.time||parsed?.lat==null||parsed?.lon==null||!parsed?.addr||!loc?.ward||!loc?.beat||!loc?.ps||!loc.inside) return;
  const u=new URL(cfg.action); u.searchParams.set("usp","pp_url");
  const put=(k,v)=>{ const id=cfg.fields[k]; if(id&&v!=null) u.searchParams.set(id,String(v)); };
  put("date",parsed.date); put("time",parsed.time);
  put("latitude", parsed.lat); put("longitude", parsed.lon);
  put("ward",loc.ward); put("beat",loc.beat); put("address",parsed.addr); put("ps",loc.ps);
  markStage(5,"active");
  if(cfg.mode==="redirect") window.location.href=u.toString(); else window.open(u.toString(),"_blank","noopener");
  markStage(5,"ok");
}

/* render */
function renderParsed(p){
  setText("#valDate",p?.date||"—");
  setText("#valTime",p?.time||"—");
  setText("#valLat",(p?.lat!=null)?p.lat.toFixed(6):"—");
  setText("#valLon",(p?.lon!=null)?p.lon.toFixed(6):"—");
  setText("#valAddr",p?.addr||"—");
}
function renderLoc(l){
  setText("#valWard",l?.ward||"—");
  setText("#valBeat",l?.beat||"—");
  setText("#valPS",l?.ps||"—");
}

/* pipeline */
async function handleFile(file){
  [0,1,2,3,4,5].forEach(i=>markStage(i,"pending"));
  markStage(0,"active"); startTimer("Upload");
  try{
    const dataUrl=await readAsDataURL(file); endTimer("Upload"); markStage(0,"ok");

    const img=new Image(); await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=dataUrl; });
    state.img=img;

    if(origImgEl) origImgEl.src=drawScaled(img,CFG.previews.originalScale);

    const cropURL=cropHUD(img); state.crop=cropURL; cropImgEl.src=cropURL;

    // OCR (with optional rerun for Hindi/Marathi)
    let text=await runOCR(cropURL,CFG.ocr.primaryLang);
    if(CFG.ocr.rerunOnDevanagari && /[\u0900-\u097F]/.test(text)){
      try{ const hin=await runOCR(cropURL,CFG.ocr.secondaryLang); if(hin && hin.length>text.length*0.7) text+="\n"+hin; }catch(_){}
    }
    state.text=text;

    // Parse
    const parsed=parseOCR(text);
    const within=CFG.geojson.bounds;
    if(parsed.lat!=null && !(parsed.lat>=within.lat[0]&&parsed.lat<=within.lat[1])) parsed.lat=null;
    if(parsed.lon!=null && !(parsed.lon>=within.lon[0]&&parsed.lon<=within.lon[1])) parsed.lon=null;
    state.parsed=parsed; renderParsed(parsed);

    // Polygons (lazy load once)
    if(!state.polygons){
      const [gw,gb,gp]=await Promise.all([
        loadGeoJSON(CFG.geojson.wards),
        loadGeoJSON(CFG.geojson.beats),
        loadGeoJSON(CFG.geojson.police)
      ]);
      state.polygons={ wards:buildIndex(gw), beats:buildIndex(gb), police:buildIndex(gp) };
    }

    let loc={ward:"—",beat:"—",ps:"—",inside:false};
    if(parsed.lat!=null && parsed.lon!=null) loc=resolvePoint(parsed.lat,parsed.lon,state.polygons);
    else markStage(3,"err");
    state.loc=loc; renderLoc(loc); markStage(4,"ok");
    if(!loc.inside){ alert(CFG.outsideMsg); markStage(5,"err"); return; }

    if(parsed.date && parsed.time && parsed.lat!=null && parsed.lon!=null && parsed.addr && loc.ward && loc.beat && loc.ps){
      tryOpenGoogleForm({
        date:parsed.date, time:parsed.time,
        lat:+parsed.lat.toFixed(6), lon:+parsed.lon.toFixed(6),
        addr:parsed.addr
      }, loc);
    }else{
      markStage(5,"pending");
    }
  }catch(err){
    console.error(err);
    alert("Failed to process image. Please try again with a clearer GPS Map Camera photo.");
    [0,1,2,3,4,5].forEach(i=>markStage(i,(i===0)?"err":"pending"));
  }
}

/* boot */
window.addEventListener("DOMContentLoaded",()=>{
  setupDnD();
  [0,1,2,3,4,5].forEach(i=>markStage(i,"pending"));
  ["Upload","OCR","Parse","GeoJSON","Review","Redirect"].forEach(n=>{
    const el=document.querySelector(`.pill-time[data-time="${n}"]`); if(el) el.textContent="(0.0s)";
  });
  const reset=$('[data-action="reset"]'); reset?.addEventListener("click",()=>window.location.reload());
});
