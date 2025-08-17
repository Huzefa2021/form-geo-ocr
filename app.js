/* Marshal upload – compact, production
   Build: v2025.08.17.Prod.v11
*/
const VER = "v2025.08.17.Prod.v11";

// --- Google Form mapping (unchanged) ---
const FORM_ID = "1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw";
const ENTRY = {
  date:"entry.1911996449", time:"entry.1421115881",
  lon:"entry.113122688",  lat:"entry.419288992",
  ward:"entry.1625337207", beat:"entry.1058310891",
  address:"entry.1188611077", police:"entry.1555105834"
};

// --- Stage limits (ms) ---
const LIMITS = [20000,70000,12000,15000,12000,20000];

// --- Simple bbox for MCGM guard ---
const MCGM_BBOX = [72.60,18.80,73.20,19.50];

const els = {
  steps: document.getElementById("steps").children,
  bar:   document.getElementById("bar"),
  status:document.getElementById("status"),
  times: document.getElementById("times"),
  cdn:   document.getElementById("cdn"),
  ver:   document.getElementById("ver"),
  cardDrop: document.getElementById("cardDrop"),
  cardOrig: document.getElementById("cardOrig"),
  cardOverlay: document.getElementById("cardOverlay"),
  drop:  document.getElementById("drop"),
  file:  document.getElementById("file"),
  imgOrig: document.getElementById("imgOrig"),
  imgOverlay: document.getElementById("imgOverlay"),
  scanner: document.getElementById("scanner"),
  res: document.getElementById("res"),
  resNote: document.getElementById("resNote"),
  redir: document.getElementById("redirect")
};

const st = {
  run:0,
  start:[null,null,null,null,null,null],
  elapsed:[0,0,0,0,0,0],
  timers:[],
  data:{date:"",time:"",lat:"",lon:"",address:"",WARD:"",BEAT_NO:"",PS_NAME:""},
  gj:{wards:null,beats:null,police:null}, counts:{W:0,B:0,P:0}
};

// ---------- UI helpers ----------
function setStep(i){
  [...els.steps].forEach((li,k)=>{
    li.classList.remove("done","active");
    if(k<i) li.classList.add("done"); else if(k===i) li.classList.add("active");
  });
  els.bar.style.width = (i/5*100) + "%";
}
function setStatus(msg,cls){ els.status.className="status"+(cls?(" "+cls):""); els.status.textContent=msg; }
function fmt(ms){ return (!ms||ms<0)? "0.0s" : (ms/1000).toFixed(1)+"s"; }
function tickTimes(){
  const names=["Upload","OCR","Parse","GeoJSON","Review","Redirect"];
  const out = names.map((n,i)=>{
    const v = st.elapsed[i] || (st.start[i]? Date.now()-st.start[i] : 0);
    return `${n} — ${fmt(v)}`;
  }).join(" • ");
  els.times.textContent = out;
}
function startStage(i){ if(st.start[i]) return; st.start[i]=Date.now(); setStep(i); st.timers[i]=setTimeout(()=>onTimeout(i),LIMITS[i]); tickTimes(); }
function endStage(i){ if(!st.start[i]) return; st.elapsed[i]=Date.now()-st.start[i]; clearTimeout(st.timers[i]); tickTimes(); }
function onTimeout(i){ setStatus(`Stage timed out (${["Upload","OCR","Parse","GeoJSON","Review","Redirect"][i]}).`,"err"); }

function kv(id,label,val){
  let row=document.getElementById(id);
  if(!row){
    row=document.createElement("div"); row.id=id; row.className="kv";
    row.innerHTML=`<div class="k">${label}</div><div class="v"></div>`; els.res.appendChild(row);
  }
  if(val!==undefined) row.querySelector(".v").textContent = String(val||"");
}
function render(){ const d=st.data;
  kv("r-date","Date",d.date); kv("r-time","Time",d.time);
  kv("r-lat","Latitude",d.lat); kv("r-lon","Longitude",d.lon);
  kv("r-addr","Address",d.address); kv("r-ward","Ward",d.WARD);
  kv("r-beat","Beat No.",d.BEAT_NO); kv("r-ps","Police Station",d.PS_NAME);
}

function prefillURL(){
  const p=new URLSearchParams({
    [ENTRY.date]:st.data.date||"", [ENTRY.time]:st.data.time||"",
    [ENTRY.lon]:st.data.lon||"",   [ENTRY.lat]:st.data.lat||"",
    [ENTRY.ward]:st.data.WARD||"", [ENTRY.beat]:st.data.BEAT_NO||"",
    [ENTRY.address]:st.data.address||"", [ENTRY.police]:st.data.PS_NAME||"", usp:"pp_url"
  });
  return `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?${p.toString()}`;
}
function startRedirect(sec=5){
  els.redir.classList.remove("hidden");
  let left=sec;
  els.redir.innerHTML=`All set. Redirecting in <b id="cd">${left}s</b>… <a href="#" id="cancel">Cancel</a>`;
  const it=setInterval(()=>{ left--; const cd=document.getElementById("cd"); if(cd) cd.textContent=left+"s"; if(left<=0){clearInterval(it); location.href=prefillURL();} },1000);
  els.redir.onclick=e=>{ if(e.target.id==="cancel"){ e.preventDefault(); clearInterval(it); els.redir.innerHTML=`<button id="go" class="btn">Open Google Form</button>`; document.getElementById("go").onclick=()=>location.href=prefillURL(); } };
}

// ---------- GeoJSON (bbox indexed) ----------
function indexFC(fc){ const items=(fc.features||[]).map(f=>({f,b:turf.bbox(f)})); return {items}; }
async function loadGeo(){
  const [w,b,p] = await Promise.all([
    fetch("./data/wards.geojson").then(r=>r.json()),
    fetch("./data/beats.geojson").then(r=>r.json()),
    fetch("./data/police_jurisdiction.geojson").then(r=>r.json())
  ]);
  st.gj.wards = indexFC(w); st.gj.beats = indexFC(b); st.gj.police = indexFC(p);
  st.counts = {W:(w.features||[]).length, B:(b.features||[]).length, P:(p.features||[]).length};
}
function firstProp(props,keys){ for(const k of keys){ const v=props?.[k]; if(v!==undefined&&v!==null&&String(v).trim()!=="") return String(v).trim(); } return ""; }
function beatName(props){ const v=firstProp(props,["BEAT_NO","Beat_No","BEAT","Beat","BeatNo","BEATNO","beat_no","Beat_Number"]); if(v) return v; const n=props?.name||props?.NAME||""; const m=String(n).match(/Beat\s*([A-Za-z0-9]+)/i); return m?m[1]:n||""; }
function pip(idx,pt,getVal){ if(!idx?.items) return ""; const P=turf.point(pt);
  for(const {f,b} of idx.items){ if(pt[0]<b[0]||pt[0]>b[2]||pt[1]<b[1]||pt[1]>b[3]) continue;
    try{ if(turf.booleanPointInPolygon(P,f)) return getVal(f.properties); }catch{}
  }
  // loose pass
  for(const {f} of idx.items){ try{ if(turf.booleanPointInPolygon(P,f)) return getVal(f.properties); }catch{} }
  return "";
}
function inBbox(pt){ return pt[0]>=MCGM_BBOX[0]&&pt[0]<=MCGM_BBOX[2]&&pt[1]>=MCGM_BBOX[1]&&pt[1]<=MCGM_BBOX[3]; }
function mapGeo(lat,lon){
  const pt=[+lon,+lat];
  const ward = pip(st.gj.wards, pt, p=>firstProp(p,["WARD","Ward","WARDNAME","WardName","NAME","name"]));
  const beat = pip(st.gj.beats, pt, p=>beatName(p));
  const ps   = pip(st.gj.police, pt, p=>firstProp(p,["PS_NAME","PS","Police_Station","PoliceStation","ps_name","PSName","name","NAME"]));
  const outside = !(ward||beat||ps) && !inBbox(pt);
  return {WARD:ward,BEAT_NO:beat,PS_NAME:ps,outside};
}

// ---------- Imaging helpers ----------
async function cropBottomBand(dataURL, frac=0.34){
  const bmp=await createImageBitmap(await (await fetch(dataURL)).blob());
  const W=bmp.width, H=bmp.height, h=Math.max(120,Math.round(H*frac)), y=H-h;
  const T=1400, s=Math.min(1, T/W); const cw=Math.round(W*s), ch=Math.round(h*s);
  const c=document.createElement("canvas"); c.width=cw; c.height=ch;
  const g=c.getContext("2d",{willReadFrequently:true});
  g.drawImage(bmp, 0,y,W,h, 0,0,cw,ch);
  return c;
}
function enhance(canvas){
  try{
    if(window.__cvLoaded && window.cv && cv.Mat){
      const src=cv.imread(canvas), gray=new cv.Mat(); cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
      cv.equalizeHist(gray,gray);
      const thr=new cv.Mat(); cv.threshold(gray,thr,0,255,cv.THRESH_BINARY+cv.THRESH_OTSU);
      cv.imshow(canvas,thr);
      src.delete(); gray.delete(); thr.delete();
    }else{
      const g=canvas.getContext("2d"), img=g.getImageData(0,0,canvas.width,canvas.height), d=img.data;
      for(let i=0;i<d.length;i+=4){ const y=.299*d[i]+.587*d[i+1]+.114*d[i+2]; const v=y>150?255:0; d[i]=d[i+1]=d[i+2]=v; }
      g.putImageData(img,0,0);
    }
  }catch{}
  return canvas.toDataURL("image/png");
}

// ---------- OCR + parsing ----------
const LANG_BEST = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main";
const LANG_40   = "https://tessdata.projectnaptha.com/4.0.0";

async function ocr(url, lang, langPath, opts={}){
  const opt = { langPath, tessedit_pageseg_mode:6, preserve_interword_spaces:1, ...opts };
  const {data:{text=""}} = await Tesseract.recognize(url, lang, opt);
  return text;
}
function hasDevanagari(s){ return /[\u0900-\u097F]/.test(String(s||"")); }

function pickCoords(text){
  const raw=String(text||"").replace(/\u00A0/g," ").replace(/[°º]/g," ").replace(/O/g,"0");
  const norm=raw.replace(/[,]+/g,".");
  let m = norm.match(/Lat(?:itude)?[^0-9+\-]*([+\-]?\d{1,2}\.\d{3,}\d*)[^]{0,50}?Lo?n(?:g(?:itude)?)?[^0-9+\-]*([+\-]?\d{1,3}\.\d{3,}\d*)/i);
  if(!m) m = norm.match(/Lo?n(?:g(?:itude)?)?[^0-9+\-]*([+\-]?\d{1,3}\.\d{3,}\d*)[^]{0,50}?Lat(?:itude)?[^0-9+\-]*([+\-]?\d{1,2}\.\d{3,}\d*)/i);
  let lat="", lon="";
  if(m && m[1] && m[2]){
    if(m[0].toLowerCase().includes("long") && m[0].toLowerCase().indexOf("long") < m[0].toLowerCase().indexOf("lat")){
      lon = String(parseFloat(m[1])); lat = String(parseFloat(m[2]));
    }else{
      lat = String(parseFloat(m[1])); lon = String(parseFloat(m[2]));
    }
  }
  // swap if reversed (observed in some photos)
  if(lat && lon && +lat>70 && +lat<75 && +lon>18 && +lon<21){ const t=lat; lat=lon; lon=t; }
  if(!(+lat>=-90 && +lat<=90)) lat=""; if(!(+lon>=-180 && +lon<=180)) lon="";
  return {lat,lon};
}
function pickDateTime(text){
  const s=String(text||"");
  const md=s.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}).{0,8}?(\d{1,2}:\d{2}\s*(AM|PM)?)/i);
  let date="",time="";
  if(md){
    let [_,d,tm,ap]=md; const [dd,mm,yy]=d.split(/[-\/]/).map(x=>x.padStart(2,"0"));
    const YYYY = yy.length===2 ? ((+yy<50)?"20"+yy:"19"+yy) : yy;
    date = `${YYYY}-${mm}-${dd}`;
    tm = tm.toUpperCase().trim(); const mmn=tm.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
    if(mmn){ let h=+mmn[1], m=mmn[2], P=mmn[3]||""; if(P==="PM"&&h<12)h+=12; if(P==="AM"&&h===12)h=0; time=`${String(h).padStart(2,"0")}:${m}`; }
  }
  return {date,time};
}
function pickAddress(text){
  const t=String(text||"").replace(/\u00A0/g," ").replace(/[|•·]+/g," ").replace(/\s{2,}/g," ").trim();
  const lines = t.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  let latIdx = lines.findIndex(l=>/\bLat/i.test(l)); if(latIdx<0) latIdx = lines.length-1;
  const chunk = lines.slice(Math.max(0, latIdx-5), latIdx).filter(s=>{
    if(/^(google|wind|humidity|pressure|temperature|gps map camera)/i.test(s)) return false;
    return true;
  }).join(", ");
  const pin = chunk.match(/\b[1-9]\d{5}\b/);
  let addr = chunk;
  if(pin){ const at = chunk.lastIndexOf(pin[0]); addr = chunk.slice(0, at+6); }
  if(!/India$/i.test(addr)) addr = (addr?addr+", ":"") + "India";
  addr = addr.replace(/\s*,\s*/g,", ").replace(/,\s*,/g,", ").replace(/\s{2,}/g," ").trim();
  return addr;
}

async function autoOCR(overlayURL){
  // pass-A: best (eng+hin)
  setStatus("OCR (eng+hin)…","warn");
  let full = await ocr(overlayURL,"eng+hin",LANG_BEST,{user_defined_dpi:300});
  // upgrade if devanagari or weak coordinates
  const needUp = hasDevanagari(full) || !(pickCoords(full).lat && pickCoords(full).lon);
  if(needUp){
    try{
      setStatus("OCR (eng+hin+mar)…","warn");
      const t2 = await ocr(overlayURL,"eng+hin+mar",LANG_BEST,{user_defined_dpi:300});
      if(t2 && (t2.length>full.length*1.02 || hasDevanagari(t2))) full=t2;
    }catch{
      try{
        const t3=await ocr(overlayURL,"eng+hin+mar",LANG_40,{user_defined_dpi:300});
        if(t3 && (t3.length>full.length*1.02 || hasDevanagari(t3))) full=t3;
      }catch{/* keep full */}
    }
  }
  // numeric ROI: crop last 28% again, strict whitelist
  const roiCanvas = await cropBottomBand(overlayURL, 0.28);
  const g = roiCanvas.getContext("2d"), im=g.getImageData(0,0,roiCanvas.width,roiCanvas.height), d=im.data;
  for(let i=0;i<d.length;i+=4){ const y=.299*d[i]+.587*d[i+1]+.114*d[i+2]; const v=y>150?255:0; d[i]=d[i+1]=d[i+2]=v; } g.putImageData(im,0,0);
  const roiURL = roiCanvas.toDataURL("image/png");
  let roi=""; try{
    roi = await ocr(roiURL,"eng",LANG_BEST,{tessedit_char_whitelist:"0123456789:+-. LatLngGMT/PMAM",user_defined_dpi:300});
  }catch{}
  return {full,roi};
}

// ---------- Upload flow ----------
function bindUpload(){
  const f=els.file, d=els.drop;
  d.addEventListener("keydown",(e)=>{ if(e.key==="Enter"||e.key===" ") f.click(); });
  ["dragenter","dragover","dragleave","drop"].forEach(ev=>document.addEventListener(ev,e=>{ e.preventDefault(); e.stopPropagation(); },false));
  d.addEventListener("dragover",()=>d.classList.add("hover"));
  d.addEventListener("dragleave",()=>d.classList.remove("hover"));
  d.addEventListener("drop",(e)=>{ const file=e.dataTransfer?.files?.[0]; if(file) handle(file); });
  f.addEventListener("change",(e)=>{ const file=e.target.files?.[0]; if(file) handle(file); });
  document.getElementById("btnReset").onclick=()=>location.reload();
}
function isImage(file){ const t=(file.type||"").toLowerCase(); if(t.startsWith("image/")) return true; const ext=file.name?.split(".").pop()?.toLowerCase()||""; return ["jpg","jpeg","png","webp","heic","heif"].includes(ext); }

async function handle(file){
  if(!isImage(file)){ alert("Only image files are allowed."); return; }
  st.run++; const my=st.run;
  els.cardDrop.classList.add("hidden"); els.cardOrig.classList.remove("hidden"); els.cardOverlay.classList.remove("hidden"); els.resNote.remove();

  startStage(0); setStatus("Image loading…","ok");
  const reader=new FileReader();
  reader.onload=async ()=>{
    if(my!==st.run) return;
    const dataURL=reader.result; els.imgOrig.src=dataURL;

    // crop & enhance
    setStatus("Preparing overlay…","warn");
    const c = await cropBottomBand(dataURL, .36);
    const enhanceURL = enhance(c);
    els.imgOverlay.src = c.toDataURL("image/png");
    els.scanner.style.display="block";
    endStage(0);

    // OCR
    startStage(1);
    let o = {full:"",roi:""};
    try{ o = await autoOCR(enhanceURL); }catch(e){ setStatus("OCR failed.","err"); return; }
    els.scanner.style.display="none"; endStage(1);

    // Parse
    startStage(2); setStatus("Parsing…","warn");
    const a1 = pickAddress(o.full);
    const c1 = pickCoords(o.full);
    const c2 = pickCoords(o.roi);
    const d1 = pickDateTime(o.full);
    const d2 = pickDateTime(o.roi);

    const good = (lat,lon)=> lat && lon && +lat>18 && +lat<20 && +lon>72 && +lon<73;
    const lat = good(c2.lat,c2.lon) ? c2.lat : c1.lat;
    const lon = good(c2.lat,c2.lon) ? c2.lon : c1.lon;

    Object.assign(st.data,{
      address:a1,
      lat:lat||"", lon:lon||"",
      date: d1.date||d2.date||"", time: d1.time||d2.time||""
    });
    render(); endStage(2);

    // GeoJSON
    startStage(3); setStatus("GeoJSON lookup…","warn");
    let stop=false,msg="";
    if(st.data.lat && st.data.lon){
      const g = mapGeo(st.data.lat, st.data.lon);
      Object.assign(st.data, g); render();
      if(g.outside){ stop=true; msg="Outside MCGM Boundaries — Not allowed."; }
    }else{ stop=true; msg="Latitude/Longitude not detected."; }
    endStage(3);
    if(stop){ setStatus("Submission blocked.","err"); alert(msg); return; }

    // Review & redirect
    startStage(4); setStatus(`Ready · W:${st.counts.W} • B:${st.counts.B} • PS:${st.counts.P}`,"ok"); endStage(4);
    startStage(5); startRedirect(5);
  };
  reader.readAsDataURL(file);
}

// ---------- Boot ----------
(async function init(){
  els.ver.textContent = VER; setStep(0); tickTimes(); bindUpload();
  try{
    await loadGeo();
    els.cdn.textContent = "CDN: v5 (jsDelivr)"; els.cdn.classList.add("ok");
  }catch{ els.cdn.textContent = "CDN: error"; }
})();
