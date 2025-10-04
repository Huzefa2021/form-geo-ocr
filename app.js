/* ==========================================================
   Abandoned Vehicles — Marshal Upload (MCGM)
   Build: v2025.09.25.M2 (OCR.Space + Tesseract fallback)
   - Stable static HUD crop (bottom band with cushions)
   - OCR.Space smart multi-try (stops after first complete parse)
   - Fallback to Tesseract.js when OCR.Space cannot complete
   - Robust parsing (incl. missing decimal in lat/lon)
   - Google Form prefill normalization (YYYY-MM-DD + HH:mm)
   - Minimal UI/UX changes; reuses existing IDs/pills/badges
   ========================================================== */

(() => {
  /* ---------------- CONFIG ---------------- */
  const OCR_SPACE_API_KEY = 'K86010114388957'; // <-- replace if needed

  // Google Form mapping (unchanged)
  const FORM_BASE =
    'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url';
  const ENTRY = {
    date: 'entry.1911996449',
    time: 'entry.1421115881',
    lat:  'entry.419288992',
    lon:  'entry.113122688',
    ward: 'entry.1625337207',
    beat: 'entry.1058310891',
    addr: 'entry.1188611077',
    ps:   'entry.1555105834',
  };

  // OCR.Space fallback order — STOP on first successful complete parse
  const TRY_CHAIN = [
    { lang: 'eng', engine: 3, label: 'ENG e3' }, // fast, usually enough
    { lang: 'hin', engine: 3, label: 'HIN e3' }, // Hindi overlay fallback
    { lang: 'eng', engine: 2, label: 'ENG e2' }, // permissive
  ];

  // Optional: retest only if mean confidence below this
  const CONFIDENCE_MIN = 60;

  // Tesseract fallback settings (used only if OCR.Space chain fails)
  const TESS_LANG = 'eng+hin';
  const TESS_PSM = 6; // Assume single uniform text block (HUD box)

  // Static crop (percentages) — tuned to GPS Map Camera HUD
  const CROP = {
    top: 0.62,      // start a bit higher to include full HUD box
    height: 0.33,   // bottom band
    left: 0.06,     // cushion to avoid aggressive left cut
    width: 0.88     // keep right edge inside rounded card
  };

  /* ---------------- DOM HELPERS ---------------- */
  const $ = (id) => document.getElementById(id);

  const el = {
    fileInput: $('fileInput'),
    dropArea: $('dropArea'),
    imgOriginal: $('imgOriginal'),
    imgCrop: $('imgCrop'),

    outDate: $('resDate'),
    outTime: $('resTime'),
    outLat: $('resLat'),
    outLon: $('resLon'),
    outAddr: $('resAddr'),
    outWard: $('resWard'),
    outBeat: $('resBeat'),
    outPS: $('resPS'),

    cdnBadge: $('cdnBadge'),
    geoBadge: $('geoBadge'),
    banner: $('banner'),
    console: $('console-pre'),

    pills: {
      upload: $('pill-upload'),
      ocr: $('pill-ocr'),
      parse: $('pill-parse'),
      geo: $('pill-geo'),
      review: $('pill-review'),
      redirect: $('pill-redirect'),
    },
  };

  function setPill(name, state) {
    const p = el.pills[name]; if (!p) return;
    p.className = p.className.replace(/\b(ok|run|err|pulse)\b/g, '').trim();
    if (state) p.classList.add(state);
  }
  function banner(msg, kind = 'info') {
    if (!el.banner) return;
    if (!msg) { el.banner.hidden = true; return; }
    el.banner.hidden = false;
    el.banner.textContent = msg;
    el.banner.className = `banner ${kind}`;
  }
  function log(rawText, parsed, note = '') {
    if (!el.console) return;
    const stamp = new Date().toLocaleTimeString();
    const safe = (v) => (v == null ? '' : String(v));
    const body =
      (rawText ? `--- RAW OCR TEXT ---\n${safe(rawText)}\n` : '') +
      (parsed
        ? `--- PARSED FIELDS ---\n${
            typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : safe(parsed)
          }\n`
        : '');
    el.console.textContent = `⏱ ${stamp} ${note}\n${body}────────────────────────────────────────\n` + el.console.textContent;
  }

  function updateCdnBadge() {
    if (!el.cdnBadge) return;
    const ok = true; // we rely on browser fetch; no external CDN script dependency here
    el.cdnBadge.textContent = ok ? 'CDN: v5 (Loaded)' : 'CDN: v5 (Not Loaded)';
    el.cdnBadge.className = `badge ${ok ? 'badge-ok glow' : 'badge-err glow'}`;
  }
  document.addEventListener('DOMContentLoaded', updateCdnBadge);
  window.addEventListener('load', updateCdnBadge);

  /* ---------------- FILE / IMAGE UTILS ---------------- */
  function fileToDataURL(f) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(f);
    });
  }
  function loadImage(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
  }

  // Stable static crop for GPS HUD (with gentle left cushion)
  async function cropHud(dataURL) {
    const img = await loadImage(dataURL);
    const W = img.naturalWidth, H = img.naturalHeight;
    const sx = Math.floor(W * CROP.left);
    const sy = Math.floor(H * CROP.top);
    const sw = Math.floor(W * CROP.width);
    const sh = Math.floor(H * CROP.height);

    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    // Downscale to reduce payload; OCR engines handle crisp text well
    const scale = Math.min(1200 / sw, 1);
    if (scale < 1) {
      const d = document.createElement('canvas');
      d.width = Math.round(sw * scale);
      d.height = Math.round(sh * scale);
      d.getContext('2d').drawImage(c, 0, 0, d.width, d.height);
      return d.toDataURL('image/jpeg', 0.85);
    }
    return c.toDataURL('image/jpeg', 0.85);
  }

  /* ---------------- OCR.Space (quota-aware) ---------------- */
  async function ocrSpaceOnce(base64Image, language, engine) {
    try {
      const form = new URLSearchParams({
        base64Image, language,
        OCREngine: String(engine),
        isTable: 'false', scale: 'true',
        detectOrientation: 'true',
        isOverlayRequired: 'false'
      });

      const resp = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: { apikey: OCR_SPACE_API_KEY },
        body: form
      });

      const json = await resp.json();
      const ok = Number(json?.OCRExitCode) === 1 && Array.isArray(json?.ParsedResults);
      const parsedResults = ok ? (json.ParsedResults || []) : [];
      const text = ok ? parsedResults.map(r => r?.ParsedText || '').join('\n').trim() : '';

      let meanConf = null;
      if (ok && parsedResults.length) {
        const vals = parsedResults.map(r => Number(r?.MeanConfidence)).filter(v => !isNaN(v));
        if (vals.length) meanConf = Math.round(vals.reduce((a,b)=>a+b,0) / vals.length);
      }

      const meta = {
        engine, lang: language,
        exit: Number(json?.OCRExitCode) || 0,
        errored: !ok,
        meanConf,
        msg: json?.ErrorMessage || json?.ErrorDetails || ''
      };
      return { text, meta };
    } catch (e) {
      return { text: '', meta: { engine, lang: language, exit: 0, errored: true, meanConf: null, msg: String(e) } };
    }
  }

  async function ocrSpaceSmart(base64Image, parseFn, confidenceMin = CONFIDENCE_MIN) {
    const trace = [];
    for (const t of TRY_CHAIN) {
      const one = await ocrSpaceOnce(base64Image, t.lang, t.engine);
      trace.push(one.meta);

      if (one.text) {
        const parsed = parseFn(one.text);
        const complete =
          parsed &&
          parsed.address && parsed.address.length > 5 &&
          isFinite(parsed.lat) && isFinite(parsed.lon) &&
          parsed.date && parsed.time;

        const confOK = (one.meta.meanConf == null) || (one.meta.meanConf >= confidenceMin);

        log(one.text, { parsed, complete, confidence: one.meta.meanConf ?? 'n/a', try: t.label }, '[OCR.Space result]');
        if (complete && confOK) return { text: one.text, parsed, trace };
      }
    }
    return { text: '', parsed: null, trace };
  }

  /* ---------------- TESSERACT FALLBACK ---------------- */
  async function tesseractOnce(dataURL) {
    if (!(window.Tesseract && Tesseract.recognize)) {
      log('', { info: 'Tesseract not loaded on page — skipping fallback.' }, '[Tesseract skipped]');
      return { text: '' };
    }
    try {
      const res = await Tesseract.recognize(
        dataURL,
        TESS_LANG,
        { logger: () => {}, tessedit_pageseg_mode: TESS_PSM }
      );
      const text = (res?.data?.text || '').trim();
      log(text, { conf: res?.data?.confidence }, '[Tesseract result]');
      return { text };
    } catch (e) {
      log('', { error: String(e) }, '[Tesseract error]');
      return { text: '' };
    }
  }

  /* ---------------- PARSERS ---------------- */

  // If dot missing in "19083428"→ "19.083428" etc.
  function ensureDecimal(numStr, expectedPrefix) {
    const s = (numStr || '').trim().replace(/[^\d]/g, '');
    if (!s) return NaN;
    if (numStr.includes('.')) return parseFloat(numStr);
    if (expectedPrefix && !s.startsWith(expectedPrefix)) return NaN;
    if (s.length >= 4) {
      const withDot = s.slice(0,2) + '.' + s.slice(2);
      const n = parseFloat(withDot);
      return isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  function parseHudText(raw) {
    const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    let lat = NaN, lon = NaN, date = '', time = '';
    let addressLines = [];

    // scan bottom-up for date/time and lat/long
    for (let i = lines.length - 1; i >= 0; i--) {
      const L = lines[i];

      // Date & time
      const dt =
        L.match(/(\d{1,2}\/\d{1,2}\/\d{4}).*?(\d{1,2}:\d{2}\s*[AP]M)/i) ||
        L.match(/(\d{4}-\d{2}-\d{2}).*?(\d{1,2}:\d{2})/);

      if (!date && dt) {
        date = dt[1];
        time = dt[2].replace(/\s+/g,' ').trim();
        continue;
      }

      // Lat / Lon variants
      if (isNaN(lat) || isNaN(lon)) {
        const m = L.match(/Lat[^0-9\-]*([0-9\.]+)[^0-9\-]*Long[^0-9\-]*([0-9\.]+)/i);
        if (m) { lat = parseFloat(m[1]); lon = parseFloat(m[2]); continue; }
        const m2 = L.match(/Lat[^0-9\-]*([0-9]{6,})[^0-9\-]*Long[^0-9\-]*([0-9]{6,})/i);
        if (m2) { lat = ensureDecimal(m2[1], '19'); lon = ensureDecimal(m2[2], '72'); continue; }
      }
    }

    // Address lines between line #1 and lat line
    const latIdx = lines.findIndex(l => /Lat/i.test(l));
    const addrStart = 1;
    const addrEnd = latIdx > 0 ? latIdx : lines.length;
    addressLines = lines.slice(addrStart, addrEnd);

    // Clean out camera brand & noise
    addressLines = addressLines
      .filter(l => !/GPS\s*Map\s*Camera/i.test(l))
      .map(l => l.replace(/[‘’“”]/g,'"').replace(/[^\S\r\n]+/g,' ').trim())
      .filter(Boolean);

    const address = addressLines.join(', ');

    // Normalize date -> YYYY-MM-DD
    let outDate = '';
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
      const [d,m,y] = date.split('/').map(Number);
      outDate = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      outDate = date;
    }

    // Normalize time -> 24h HH:mm
    let outTime = '';
    if (/^\d{1,2}:\d{2}\s*[AP]M$/i.test(time)) {
      const t = time.toUpperCase().replace(/\s+/g,'');
      let [hh, mm] = t.replace(/AM|PM/,'').split(':').map(Number);
      const isPM = /PM/i.test(t);
      if (isPM && hh < 12) hh += 12;
      if (!isPM && hh === 12) hh = 0;
      outTime = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    } else if (/^\d{1,2}:\d{2}$/.test(time)) {
      const [hh, mm] = time.split(':').map(Number);
      outTime = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    }

    return {
      address: address || '',
      lat, lon,
      date: outDate,
      time: outTime
    };
  }

  /* ---------------- GEOJSON (unchanged) ---------------- */
  let gjW=null, gjB=null, gjP=null;
  async function ensureGeo() {
    try {
      const [w,b,p] = await Promise.all([
        fetch('data/wards.geojson').then(r=>r.json()).catch(()=>null),
        fetch('data/beats.geojson').then(r=>r.json()).catch(()=>null),
        fetch('data/police_jurisdiction.geojson').then(r=>r.json()).catch(()=>null),
      ]);
      gjW=w; gjB=b; gjP=p;
      if (el.geoBadge) {
        el.geoBadge.textContent = (gjW&&gjB&&gjP) ? 'Geo: Loaded' : 'Geo: Failed';
        el.geoBadge.className = `badge ${(gjW&&gjB&&gjP)?'badge-ok':'badge-err'} glow`;
      }
    } catch {
      if (el.geoBadge) {
        el.geoBadge.textContent = 'Geo: Failed'; el.geoBadge.className = 'badge badge-err glow';
      }
    }
  }
  function pointInPoly(poly, pt) {
    const [x, y] = pt;
    let inside = false;
    for (const ring of poly) {
      for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi>y)!=(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi) + xi);
        if (intersect) inside = !inside;
      }
    }
    return inside;
  }
  function geoLookup(lat, lon) {
    const out = { ward:'', beat:'', ps:'' };
    if (!(gjW&&gjB&&gjP)) return out;
    const pt = [lon, lat];
    const inPoly = (g) => {
      if (!g) return false;
      if (g.type==='Polygon') return pointInPoly(g.coordinates, pt);
      if (g.type==='MultiPolygon') return g.coordinates.some(r=>pointInPoly(r, pt));
      return false;
    };
    for (const f of gjW.features||[]) if (inPoly(f.geometry)) { out.ward = f.properties?.WARD || ''; break; }
    for (const f of gjB.features||[]) if (inPoly(f.geometry)) { out.beat  = f.properties?.BEAT_NO || f.properties?.BEAT || ''; break; }
    for (const f of gjP.features||[]) if (inPoly(f.geometry)) { out.ps    = f.properties?.PS_NAME || ''; break; }
    return out;
  }
  ensureGeo();

  /* ---------------- RESET ---------------- */
  function resetAll() {
    ['upload','ocr','parse','geo','review','redirect'].forEach(k=> setPill(k,null));
    [el.outDate,el.outTime,el.outLat,el.outLon,el.outAddr,el.outWard,el.outBeat,el.outPS]
      .forEach(o => o && (o.textContent='—'));
    if (el.imgOriginal) el.imgOriginal.src = '';
    if (el.imgCrop) el.imgCrop.src = '';
    banner('');
    log('', '', '[Reset]');
  }
  $('btnReset')?.addEventListener('click', resetAll);

  /* ---------------- CORE FLOW ---------------- */
  async function handleFile(file) {
    if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
      banner('Please choose a JPG or PNG.', 'error');
      return;
    }
    resetAll();

    setPill('upload','run');
    const dataURL = await fileToDataURL(file);
    if (el.imgOriginal) el.imgOriginal.src = dataURL;
    setPill('upload','ok');

    setPill('ocr','run');
    const cropURL = await cropHud(dataURL);
    if (el.imgCrop) el.imgCrop.src = cropURL;

    // 1) OCR.Space smart (quota-aware)
    const smart = await ocrSpaceSmart(cropURL, parseHudText);
    log('', smart.trace, '[OCR.Space tries trace]');

    let parsed = smart.parsed;
    let usedEngine = 'OCR.Space';

    // 2) Fallback to Tesseract if OCR.Space failed to complete
    if (!parsed) {
      const tess = await tesseractOnce(cropURL);
      if (tess.text) {
        const p2 = parseHudText(tess.text);
        const complete = p2 &&
          p2.address && isFinite(p2.lat) && isFinite(p2.lon) && p2.date && p2.time;
        if (complete) {
          parsed = p2; usedEngine = 'Tesseract';
        }
      }
    }

    if (!parsed) {
      setPill('ocr','err');
      banner('OCR failed or incomplete. Try clearer photo.', 'error');
      return;
    }
    setPill('ocr','ok');

    setPill('parse','run');
    if (!parsed.date || !parsed.time || isNaN(parsed.lat) || isNaN(parsed.lon) || !parsed.address) {
      setPill('parse','err');
      banner('Could not parse all fields from HUD.', 'error');
      return;
    }
    setPill('parse','ok');
    log('', { engineUsed: usedEngine, parsed }, '[Parse complete]');

    // Fill UI
    el.outDate.textContent = parsed.date;
    el.outTime.textContent = parsed.time;
    el.outLat.textContent  = parsed.lat.toFixed(6);
    el.outLon.textContent  = parsed.lon.toFixed(6);
    el.outAddr.textContent = parsed.address;

    setPill('geo','run');
    const g = geoLookup(parsed.lat, parsed.lon);
    el.outWard.textContent = g.ward || '—';
    el.outBeat.textContent = g.beat || '—';
    el.outPS.textContent   = g.ps   || '—';
    if (!g.ward || !g.beat || !g.ps) {
      setPill('geo','err');
      banner('GeoJSON lookup failed.', 'error');
    } else {
      setPill('geo','ok');
    }

    // Prefill redirect
    const url = new URL(FORM_BASE);
    url.searchParams.set(ENTRY.date, parsed.date);
    url.searchParams.set(ENTRY.time, parsed.time);
    url.searchParams.set(ENTRY.lat, parsed.lat.toFixed(6));
    url.searchParams.set(ENTRY.lon, parsed.lon.toFixed(6));
    if (g.ward) url.searchParams.set(ENTRY.ward, g.ward);
    if (g.beat) url.searchParams.set(ENTRY.beat, g.beat);
    url.searchParams.set(ENTRY.addr, parsed.address);
    if (g.ps)   url.searchParams.set(ENTRY.ps, g.ps);

    log('', { redirect: url.toString() }, '[Redirect URL]');
    setPill('review','ok');

    try {
      setPill('redirect','run');
      window.open(url.toString(), '_blank', 'noopener');
      setPill('redirect','ok');
    } catch {
      setPill('redirect','err');
      banner('Auto-redirect blocked. Use the Redirect pill.', 'error');
    }
  }

  /* ---------------- DRAG & DROP / INPUT ---------------- */
  el.dropArea?.addEventListener('click', () => el.fileInput?.click());
  el.dropArea?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') el.fileInput?.click();
  });
  el.fileInput?.addEventListener('click', (e) => { e.target.value = ''; });
  el.fileInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (f) handleFile(f);
  });
  ['dragenter','dragover'].forEach(t => el.dropArea?.addEventListener(t, (e)=>{ e.preventDefault(); el.dropArea.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(t => el.dropArea?.addEventListener(t, (e)=>{ e.preventDefault(); el.dropArea.classList.remove('dragover'); }));
  el.dropArea?.addEventListener('drop', (e) => {
    const f = [...(e.dataTransfer?.files || [])].find(f => /^image\//i.test(f.type));
    if (f) handleFile(f);
  });

})();
