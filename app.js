/* -----------------------------------------------------------
   MCGM | Abandoned Vehicles — Marshal Upload
   Robust client OCR pipeline + stable DnD/click binding
   v2025.08.18.R3
------------------------------------------------------------*/
(() => {
  if (window.__mcgm_bound) return; // prevent double binding in hot reloads
  window.__mcgm_bound = true;

  // ---------- SHORTHANDS ----------
  const $ = s => document.querySelector(s);
  const el = {
    file: $('#file'),
    drop: $('#drop-zone'),
    original: $('#original-preview'),
    hud: $('#hud-preview'),
    rDate: $('#r-date'), rTime: $('#r-time'),
    rLat: $('#r-lat'), rLon: $('#r-lon'),
    rAddr: $('#r-addr'), rWard: $('#r-ward'),
    rBeat: $('#r-beat'), rPS: $('#r-ps'),
    banner: $('#banner'),
    btnReset: $('#btn-reset')
  };
  const pills = {
    upload: $('[data-pill="upload"]'),
    ocr: $('[data-pill="ocr"]'),
    parse: $('[data-pill="parse"]'),
    geo: $('[data-pill="geo"]'),
    review: $('[data-pill="review"]'),
    redirect: $('[data-pill="redirect"]')
  };

  // ---------- PILL HELPERS ----------
  const t0 = {};
  function pill(name, state, t) {
    const p = pills[name]; if (!p) return;
    p.classList.remove('pill--ok','pill--err','pill--pending');
    p.classList.add(`pill--${state}`);
    const tt = p.querySelector('.pill__time'); if (tt) tt.textContent = t ? `(${t})` : '';
  }
  function start(name){ t0[name] = performance.now(); pill(name,'pending'); }
  function ok(name){ pill(name,'ok', fmtTime(name)); }
  function err(name){ pill(name,'err', fmtTime(name)); }
  function fmtTime(name){ const ms = (performance.now() - (t0[name]||performance.now())); return (ms/1000).toFixed(1)+'s';}

  function setBanner(msg, kind='info'){
    el.banner.textContent = msg;
    el.banner.className = `banner banner--${kind}`;
    el.banner.hidden = !msg;
  }

  // ---------- CONFIG ----------
  const CFG = {
    FIXED_BOTTOM_RATIO: 0.26,
    WIDE_BOTTOM_RATIO: 0.34,
    SMART_SEARCH_WINDOW: 0.38,
    LEFT_TRIM_RATIO: 0.18,
    MIN_HUD_HEIGHT_PX: 160,
    OCR_LANG: 'eng+hin',
    LAT_RANGE: [18.0, 20.5],
    LON_RANGE: [72.0, 73.5],
    FORM:
      'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url' +
      '&entry.1911996449={DATE}&entry.1421115881={TIME}&entry.113122688={LON}&entry.419288992={LAT}' +
      '&entry.1625337207={WARD}&entry.1058310891={BEAT}&entry.1188611077={ADDR}&entry.1555105834={PS}',
    AUTO_REDIRECT: true
  };

  // ---------- FILE + DND BINDINGS ----------
  // Allow dropping anywhere on page without browser navigating
  ['dragenter','dragover','dragleave','drop'].forEach(ev => {
    document.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false);
  });

  // Drop zone visuals + behavior
  el.drop.addEventListener('dragenter', () => el.drop.classList.add('dz--over'));
  el.drop.addEventListener('dragover',  () => el.drop.classList.add('dz--over'));
  el.drop.addEventListener('dragleave', () => el.drop.classList.remove('dz--over'));
  el.drop.addEventListener('drop', async (e) => {
    el.drop.classList.remove('dz--over');
    const f = e.dataTransfer?.files?.[0];
    if (f) await process(f);
  });

  // Single click opens chooser (no double chooser)
  el.drop.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    if (f) await process(f);
    el.file.value = ''; // clear to avoid "same file" not firing
  });

  // Reset
  el.btnReset.addEventListener('click', () => {
    resetUI();
    setBanner('Cleared.', 'info');
  });

  // ---------- IMAGE LOADING ----------
  function readAsDataURL(file){
    return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(file);});
  }
  function loadImage(src){
    return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src; });
  }
  function drawCrop(img,x,y,w,h){
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    c.getContext('2d').drawImage(img,x,y,w,h,0,0,w,h); return c;
  }

  // ---------- SMART CROPS ----------
  function smartHudBand(img){
    const H=img.height, W=img.width;
    const full = drawCrop(img,0,0,W,H); const ctx=full.getContext('2d');
    const pix = ctx.getImageData(0,0,W,H).data;
    const startY = Math.floor(H*(1-CFG.SMART_SEARCH_WINDOW));
    const heights = [
      Math.max(Math.floor(H*CFG.FIXED_BOTTOM_RATIO), CFG.MIN_HUD_HEIGHT_PX),
      Math.max(Math.floor(H*CFG.WIDE_BOTTOM_RATIO),  CFG.MIN_HUD_HEIGHT_PX)
    ];
    let best=null;
    for(const bh of heights){
      const steps=14, maxTop=H-bh;
      for(let i=0;i<=steps;i++){
        const y = Math.max(startY, maxTop - Math.floor(i*(maxTop-startY)/steps));
        const s = scoreBand(pix,W,H,y,bh);
        if(!best || s>best.score) best={y,h:bh,score:s};
      }
    }
    return best;
  }
  function scoreBand(pix,W,H,top,bh){
    let dark=0,tot=0;
    for(let y=top;y<top+bh;y+=2){
      const row=y*W*4;
      for(let x=0;x<W;x+=2){
        const i=row+x*4; const r=pix[i],g=pix[i+1],b=pix[i+2];
        const Y=0.2126*r+0.7152*g+0.0722*b;
        if(Y<70) dark++; tot++;
      }
    }
    return dark/Math.max(1,tot);
  }
  function fixedBand(img,ratio){
    const H=img.height, W=img.width;
    const bh=Math.max(Math.floor(H*ratio), CFG.MIN_HUD_HEIGHT_PX);
    return {y:H-bh,h:bh,w:W,x:0};
  }
  function candidates(img){
    const c=[], W=img.width;
    const s=smartHudBand(img); if(s) c.push({x:0,y:s.y,w:W,h:s.h,tag:'smart'});
    const f=fixedBand(img, CFG.FIXED_BOTTOM_RATIO); c.push({...f,tag:'fixed'});
    const w=fixedBand(img, CFG.WIDE_BOTTOM_RATIO);  c.push({...w,tag:'wide'});
    // add left-trim variants
    return c.flatMap(o => [o, {...o, x:Math.floor(W*CFG.LEFT_TRIM_RATIO), w: o.w - Math.floor(W*CFG.LEFT_TRIM_RATIO), tag:o.tag+'+trim'}]);
  }

  // ---------- OCR ----------
  let workerPromise=null;
  function worker(){
    if (workerPromise) return workerPromise;
    start('ocr');
    workerPromise = Tesseract.createWorker({ logger: ()=>{} })
      .then(async w => { await w.loadLanguage(CFG.OCR_LANG); await w.initialize(CFG.OCR_LANG); ok('ocr'); return w; })
      .catch(e => { err('ocr'); setBanner('Failed to initialize OCR. Check CDN/network.', 'error'); throw e; });
    return workerPromise;
  }
  async function ocr(canvas){
    const w = await worker();
    const { data:{ text } } = await w.recognize(canvas);
    return text || '';
  }

  // ---------- PARSE ----------
  const norm = s => s.replace(/\u00B0/g,'°').replace(/\u00A0/g,' ').replace(/[“”]/g,'"').replace(/[’‘]/g,"'").replace(/[—–]/g,'-').trim();
  const plausible = (v,[lo,hi]) => Number.isFinite(+v) && +v>=lo && +v<=hi;

  function parseHUD(raw){
    const lines = norm(raw).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const out = {date:'', time:'', lat:'', lon:'', address:''};
    if (!lines.length) return out;

    let i=1; // skip first line (city/country)
    const addr=[];
    for(; i<lines.length; i++){
      const L=lines[i];
      if (/^lat/i.test(L) || /^lon/i.test(L) || /GMT/i.test(L) || /\d{1,2}\s*:\s*\d{2}/i.test(L)) break;
      addr.push(L); if (addr.length>=2) { i++; break; } // keep at most 2 lines
    }

    const tail = lines.slice(i).join(' • ');
    // lat/lon labeled
    const mLat = tail.match(/lat(?:itude)?[:\s]*([+-]?\d{1,2}\.\d{3,7})/i);
    const mLon = tail.match(/lon(?:g(?:itude)?)?[:\s]*([+-]?\d{1,3}\.\d{3,7})/i);
    let lat = mLat?.[1]||'', lon = mLon?.[1]||'';

    // unlabeled floats fallback
    if (!lat || !lon) {
      const floats = tail.match(/[-+]?\d{1,3}\.\d{3,7}/g) || [];
      for(let a=0;a<floats.length;a++){
        for(let b=a+1;b<floats.length;b++){
          const A=+floats[a], B=+floats[b];
          const c1 = plausible(A,CFG.LAT_RANGE)&&plausible(B,CFG.LON_RANGE);
          const c2 = plausible(B,CFG.LAT_RANGE)&&plausible(A,CFG.LON_RANGE);
          if(c1){ lat=floats[a]; lon=floats[b]; break; }
          if(c2){ lat=floats[b]; lon=floats[a]; break; }
        }
        if(lat&&lon) break;
      }
    }

    // time/date from last line
    const last = lines[lines.length-1];
    let m = last.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
    if(!m){
      m = tail.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}).*?(\d{1,2}:\d{2}\s*[AP]M)/i);
    }
    const date = m?.[1] || '';
    const time = m?.[2] || '';

    out.address = addr.join(', ');
    out.lat = lat; out.lon = lon;
    out.date = toIsoDate(date);
    out.time = toIsoTime(time);
    return out;
  }
  function toIsoDate(d){
    if(!d) return '';
    const m=d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if(!m) return '';
    const [ ,dd,mm,yy]=m; const yyyy=(+yy<100)?('20'+yy):yy;
    return `${String(yyyy).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  }
  function toIsoTime(t){
    if(!t) return '';
    const m=t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i); if(!m) return '';
    let h=+m[1], min=m[2], ap=m[3].toUpperCase();
    if(ap==='PM'&&h<12) h+=12; if(ap==='AM'&&h===12) h=0;
    return `${String(h).padStart(2,'0')}:${min}`;
  }

  // ---------- GEO LOOKUP ----------
  let gjW=null, gjB=null, gjP=null;
  function pointIn(poly,x,y){
    let inside=false;
    for(const ring of poly){
      for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
        const inter = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
        if(inter) inside=!inside;
      }
    }
    return inside;
  }
  async function ensureGeo(){
    if(gjW&&gjB&&gjP) return;
    start('geo');
    try{
      const [a,b,c] = await Promise.all([
        fetch('wards.geojson').then(r=>r.json()),
        fetch('beats.geojson').then(r=>r.json()),
        fetch('police_jurisdiction.geojson').then(r=>r.json()),
      ]);
      gjW=a; gjB=b; gjP=c; ok('geo');
    }catch(e){ err('geo'); setBanner('Failed to load GeoJSON.', 'error'); }
  }
  function geoLookup(lat,lon){
    const LON=+lon, LAT=+lat; const out={ward:'',beat:'',ps:''};
    if(!Number.isFinite(LON)||!Number.isFinite(LAT)) return out;

    // wards
    for(const f of gjW.features||[]){
      const g=f.geometry; if(!g) continue;
      if(g.type==='Polygon'){ if(pointIn(g.coordinates,LON,LAT)){ out.ward=f.properties?.WARD||f.properties?.name||''; break; } }
      else if(g.type==='MultiPolygon'){ for(const poly of g.coordinates){ if(pointIn(poly,LON,LAT)){ out.ward=f.properties?.WARD||f.properties?.name||''; break; } } if(out.ward)break; }
    }
    // beats
    for(const f of gjB.features||[]){
      const g=f.geometry; if(!g) continue;
      if(g.type==='Polygon'){ if(pointIn(g.coordinates,LON,LAT)){ out.beat=f.properties?.BEAT||f.properties?.name||''; break; } }
      else if(g.type==='MultiPolygon'){ for(const poly of g.coordinates){ if(pointIn(poly,LON,LAT)){ out.beat=f.properties?.BEAT||f.properties?.name||''; break; } } if(out.beat)break; }
    }
    // PS
    for(const f of gjP.features||[]){
      const g=f.geometry; if(!g) continue;
      if(g.type==='Polygon'){ if(pointIn(g.coordinates,LON,LAT)){ out.ps=f.properties?.PS||f.properties?.name||''; break; } }
      else if(g.type==='MultiPolygon'){ for(const poly of g.coordinates){ if(pointIn(poly,LON,LAT)){ out.ps=f.properties?.PS||f.properties?.name||''; break; } } if(out.ps)break; }
    }
    return out;
  }

  // ---------- PROCESS ----------
  async function process(file){
    try{
      resetUI();
      start('upload');

      if(!/^image\/(jpe?g|png)$/i.test(file.type)){
        err('upload'); setBanner('Please upload a JPG or PNG.', 'error'); return;
      }
      const url = await readAsDataURL(file);
      const img = await loadImage(url);
      el.original.src = url;
      ok('upload');

      await ensureGeo();

      // OCR on multiple candidate crops
      start('ocr');
      const cands = candidates(img);
      let best=null;
      for(const c of cands){
        const canvas = drawCrop(img, c.x, c.y, c.w, c.h);
        const text = await ocr(canvas);
        const parsed = parseHUD(text);
        const sc = score(parsed);
        if(!best || sc>best.sc){ best={canvas,parsed,sc,raw:text}; }
      }
      ok('ocr');

      if(!best){ err('parse'); setBanner('Could not read HUD text. Try clearer photo.', 'warning'); return; }

      // Show crop
      el.hud.src = best.canvas.toDataURL('image/jpeg', .9);

      // Populate fields
      start('parse');
      const {date,time,lat,lon,address} = best.parsed;
      $('#r-date').textContent = date || '—';
      $('#r-time').textContent = time || '—';
      $('#r-lat').textContent  = lat  || '—';
      $('#r-lon').textContent  = lon  || '—';
      $('#r-addr').textContent = address || '—';

      const llOk = plausible(lat,CFG.LAT_RANGE) && plausible(lon,CFG.LON_RANGE);
      if(!date || !time || !address || !llOk){
        err('parse');
        setBanner('Parsed partially. Verify date/time, address, latitude and longitude.', 'warning');
        return;
      }
      ok('parse');

      // Geo
      const g = geoLookup(lat,lon);
      $('#r-ward').textContent = g.ward || '—';
      $('#r-beat').textContent = g.beat || '—';
      $('#r-ps').textContent   = g.ps   || '—';
      ok('review');

      const allOK = g.ward && g.beat && g.ps;
      if (CFG.AUTO_REDIRECT && allOK){
        start('redirect');
        const url = CFG.FORM
          .replace('{DATE}', encodeURIComponent(date))
          .replace('{TIME}', encodeURIComponent(time))
          .replace('{LAT}',  encodeURIComponent(lat))
          .replace('{LON}',  encodeURIComponent(lon))
          .replace('{WARD}', encodeURIComponent(g.ward))
          .replace('{BEAT}', encodeURIComponent(g.beat))
          .replace('{ADDR}', encodeURIComponent(address))
          .replace('{PS}',   encodeURIComponent(g.ps));
        ok('redirect');
        window.open(url,'_blank','noopener');
      } else {
        err('redirect');
      }

    }catch(e){
      console.error(e);
      setBanner('Unexpected error while processing image.', 'error');
      ['upload','ocr','parse','geo','review','redirect'].forEach(x=>err(x));
    }
  }

  function score(p){
    let s=0; if(p.date)s++; if(p.time)s++; if(plausible(p.lat,CFG.LAT_RANGE))s+=2; if(plausible(p.lon,CFG.LON_RANGE))s+=2; if(p.address)s++; return s;
  }

  function resetUI(){
    setBanner('', 'info'); el.banner.hidden=true;
    [el.original, el.hud].forEach(i=>i && (i.src=''));
    ['r-date','r-time','r-lat','r-lon','r-addr','r-ward','r-beat','r-ps'].forEach(id=>{ const n=$('#'+id); if(n) n.textContent='—'; });
    Object.values(pills).forEach(p=>{ p.classList.remove('pill--ok','pill--err','pill--pending'); p.querySelector('.pill__time').textContent=''; });
  }

})();
