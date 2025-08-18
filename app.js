/* -----------------------------------------------------------
   MCGM | Abandoned Vehicles — Marshal Upload
   Robust client OCR pipeline (no hard failures)
   v2025.08.18.R2
------------------------------------------------------------*/

(() => {
  // ---------- CONFIG ----------
  const CFG = {
    // Crop passes (fractions of image height)
    FIXED_BOTTOM_RATIO: 0.26,         // default HUD band height
    WIDE_BOTTOM_RATIO: 0.34,          // wider fallback band height
    SMART_SEARCH_WINDOW: 0.38,        // search bottom 38% for darkest bar
    LEFT_TRIM_RATIO: 0.18,            // try trimming left 18% to hide mini map
    MIN_HUD_HEIGHT_PX: 160,           // minimum band height in pixels
    MAX_OCR_SECONDS: 35,              // soft budget
    OCR_LANG: 'eng+hin',              // robust + includes Devanagari; avoids "mar" 404
    REDIRECT_ON_SUCCESS: true,        // flip to false if you want manual only
    FORM_URL_TEMPLATE:
      'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url' +
      '&entry.1911996449={DATE}' +        // date (YYYY-MM-DD)
      '&entry.1421115881={TIME}' +        // time (HH:mm)
      '&entry.113122688={LON}' +          // 1 -> long
      '&entry.419288992={LAT}' +          // 2 -> lat
      '&entry.1625337207={WARD}' +        // 3 -> ward
      '&entry.1058310891={BEAT}' +        // 4 -> beat
      '&entry.1188611077={ADDR}' +        // 5 -> address
      '&entry.1555105834={PS}',           // 6 -> police station

    // Mumbai plausibility for float-only fallback
    LAT_RANGE: [18.0, 20.5],
    LON_RANGE: [72.0, 73.5]
  };

  // ---------- UI ELEMENTS ----------
  const el = {
    file: document.getElementById('file'),
    dropZone: document.getElementById('drop-zone'),
    originalPreview: document.getElementById('original-preview'),
    hudPreview: document.getElementById('hud-preview'),

    // results
    rDate: qs('#r-date'), rTime: qs('#r-time'),
    rLat: qs('#r-lat'), rLon: qs('#r-lon'),
    rAddr: qs('#r-addr'), rWard: qs('#r-ward'),
    rBeat: qs('#r-beat'), rPS: qs('#r-ps'),

    // pills
    pillUpload: qs('[data-pill="upload"]'),
    pillOCR: qs('[data-pill="ocr"]'),
    pillParse: qs('[data-pill="parse"]'),
    pillGeo: qs('[data-pill="geo"]'),
    pillReview: qs('[data-pill="review"]'),
    pillRedirect: qs('[data-pill="redirect"]'),

    banner: document.getElementById('banner'), // inline message area
  };

  function qs(s) { return document.querySelector(s); }

  // ---------- STATUS / TIMER ----------
  const t0 = {};
  const pills = {
    upload: el.pillUpload,
    ocr: el.pillOCR,
    parse: el.pillParse,
    geo: el.pillGeo,
    review: el.pillReview,
    redirect: el.pillRedirect
  };

  function pillPending(name)  { setPill(name, 'pending'); t0[name] = performance.now(); }
  function pillOk(name)       { finalizePill(name, 'ok'); }
  function pillErr(name)      { finalizePill(name, 'err'); }

  function finalizePill(name, state) {
    const ms = (performance.now() - (t0[name] || performance.now())).toFixed(0);
    const s = (ms/1000).toFixed(1) + 's';
    setPill(name, state, s);
  }

  function setPill(name, state, timeLabel) {
    const pill = pills[name];
    if (!pill) return;
    pill.classList.remove('pill--ok','pill--err','pill--pending');
    pill.classList.add('pill--' + state);
    const tag = pill.querySelector('.pill__time');
    if (timeLabel && tag) tag.textContent = `(${timeLabel})`;
  }

  function banner(msg, kind='info') {
    if (!el.banner) return;
    el.banner.textContent = msg;
    el.banner.className = `banner banner--${kind}`;
    el.banner.hidden = false;
    // auto hide informational banners
    if (kind === 'info') {
      clearTimeout(banner._to);
      banner._to = setTimeout(() => { el.banner.hidden = true; }, 3500);
    }
  }

  // ---------- UTIL: IMAGE LOADING ----------
  function readFileAsDataURL(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  function drawCrop(img, x, y, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, x, y, w, h, 0, 0, w, h);
    return c;
  }

  // Smart HUD finder (largest dark band near bottom)
  function smartHudBand(img) {
    const H = img.height, W = img.width;
    const g = drawCrop(img, 0, 0, W, H).getContext('2d');
    const data = g.getImageData(0, 0, W, H).data;

    const startY = Math.floor(H * (1 - CFG.SMART_SEARCH_WINDOW));
    const bandHeights = [
      Math.max(Math.floor(H * CFG.FIXED_BOTTOM_RATIO), CFG.MIN_HUD_HEIGHT_PX),
      Math.max(Math.floor(H * CFG.WIDE_BOTTOM_RATIO), CFG.MIN_HUD_HEIGHT_PX)
    ];

    let best = null;

    for (const bh of bandHeights) {
      const windowH = Math.min(bh, H - startY);
      // slide from bottom upwards inside the search region
      const steps = 14;
      for (let i=0; i<=steps; i++) {
        const yTop = H - windowH - Math.floor((i/steps) * (H - startY - windowH));
        // score darkness & uniformity
        const score = scoreBandDarkness(data, W, H, yTop, windowH);
        if (!best || score > best.score) {
          best = { y: yTop, h: windowH, score };
        }
      }
    }
    return best; // {y,h,score}
  }

  function scoreBandDarkness(pix, W, H, yTop, bh) {
    let dark = 0, total = 0, edges = 0;
    const yEnd = yTop + bh;
    for (let y = yTop; y < yEnd; y+=2) {
      const row = y * W * 4;
      for (let x = 0; x < W; x+=2) {
        const i = row + x*4;
        const r = pix[i], g = pix[i+1], b = pix[i+2];
        // luminance
        const Y = 0.2126*r + 0.7152*g + 0.0722*b;
        if (Y < 70) dark++;
        total++;
      }
    }
    // density of dark pixels
    const density = dark / Math.max(1,total);
    // prefer wider bars with more darkness
    return density;
  }

  function fixedBottomBand(img, ratio) {
    const H = img.height, W = img.width;
    const bh = Math.max(Math.floor(H * ratio), CFG.MIN_HUD_HEIGHT_PX);
    return { y: H - bh, h: bh };
  }

  // Try several crops and return them (full + left-trimmed)
  function buildCandidateCrops(img) {
    const W = img.width, H = img.height;
    const crops = [];
    // 1) Smart band
    const smart = smartHudBand(img);
    if (smart) crops.push({x:0, y:smart.y, w:W, h:smart.h, reason:'smart'});

    // 2) Fixed bottom
    const fixed = fixedBottomBand(img, CFG.FIXED_BOTTOM_RATIO);
    crops.push({x:0, y:fixed.y, w:W, h:fixed.h, reason:'fixed'});

    // 3) Wide fallback
    const wide = fixedBottomBand(img, CFG.WIDE_BOTTOM_RATIO);
    crops.push({x:0, y:wide.y, w:W, h:wide.h, reason:'wide'});

    // Produce left-trim variants for each
    const out = [];
    for (const c of crops) {
      const c1 = {...c, leftTrim: 0};
      const c2 = {...c, leftTrim: Math.floor(W * CFG.LEFT_TRIM_RATIO)};
      out.push(c1, c2);
    }
    return out;
  }

  // ---------- OCR ----------
  let workerPromise = null;
  function getWorker() {
    if (workerPromise) return workerPromise;
    pillOCR && pillPending('ocr');
    workerPromise = Tesseract.createWorker({
      logger: m => { /* could stream progress to UI if needed */ }
    }).then(async w => {
      await w.loadLanguage(CFG.OCR_LANG);
      await w.initialize(CFG.OCR_LANG);
      pillOk('ocr');
      return w;
    }).catch(e => {
      pillErr('ocr');
      banner('OCR engine failed to initialize. Check network / CDN.', 'error');
      throw e;
    });
    return workerPromise;
  }

  async function runOCR(canvas) {
    const w = await getWorker();
    const { data: { text } } = await w.recognize(canvas);
    return text || '';
  }

  // ---------- PARSE ----------
  function normalize(text) {
    return text
      .replace(/\u00B0/g, '°')
      .replace(/[|]+/g, 'I')
      .replace(/[“”]/g, '"')
      .replace(/[’‘]/g, "'")
      .replace(/[—–]/g, '-')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+$/gm, '')
      .trim();
  }

  function plausible(v, [lo, hi]) {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi;
  }

  function parseHud(text) {
    const out = {
      date: '', time: '', lat: '', lon: '', address: ''
    };
    const lines = normalize(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    if (!lines.length) return out;

    // Strip first line (city/country banner)
    let idx = 1;

    // Collect address lines until we see Lat/Long or time/date
    const addrParts = [];
    while (idx < lines.length) {
      const L = lines[idx];
      if (/^lat/i.test(L) || /^long/i.test(L) || /GMT/i.test(L) || /\d{1,2}\s*:\s*\d{2}/i.test(L)) break;
      addrParts.push(L);
      idx++;
      if (addrParts.length >= 2) break; // usually at most two lines
    }

    // Seek lat/lon anywhere in remaining lines
    const rest = lines.slice(idx).join(' • ');

    // Patterns
    const rLat = /lat(?:itude)?[:\s]*([+-]?\d{1,2}\.\d{3,7})/i;
    const rLon = /lon(?:g(?:itude)?)?[:\s]*([+-]?\d{1,3}\.\d{3,7})/i;

    let lat = (rest.match(rLat) || [])[1] || '';
    let lon = (rest.match(rLon) || [])[1] || '';

    // Fallback: find any floats and map by Mumbai ranges
    if (!lat || !lon) {
      const floats = rest.match(/[-+]?\d{1,3}\.\d{3,7}/g) || [];
      // try pairwise
      for (let i=0; i<floats.length; i++) {
        for (let j=i+1; j<floats.length; j++) {
          const a = +floats[i], b = +floats[j];
          const c1 = plausible(a, CFG.LAT_RANGE) && plausible(b, CFG.LON_RANGE);
          const c2 = plausible(b, CFG.LAT_RANGE) && plausible(a, CFG.LON_RANGE);
          if (c1) { lat = floats[i]; lon = floats[j]; break; }
          if (c2) { lat = floats[j]; lon = floats[i]; break; }
        }
        if (lat && lon) break;
      }
    }

    // Time & Date (last line normally)
    const dateTime = lines[lines.length - 1];
    let time = '', date = '';
    // e.g., 18/08/2025 11:52 AM GMT +05:30
    const mdt = dateTime.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (mdt) {
      date = mdt[1];
      time = mdt[2];
    } else {
      // try anywhere
      const any = rest.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}).*?(\d{1,2}:\d{2}\s*[AP]M)/i);
      if (any) { date = any[1]; time = any[2]; }
    }

    out.address = addrParts.join(', ');
    out.lat = lat || '';
    out.lon = lon || '';
    out.date = toIsoDate(date);
    out.time = toIsoTime(time);
    return out;
  }

  function toIsoDate(d) {
    // input: dd/mm/yyyy or dd-mm-yyyy
    if (!d) return '';
    const m = d.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (!m) return '';
    const [ , dd, mm, yy ] = m;
    const yyyy = (+yy < 100) ? ('20' + yy) : yy;
    return `${yyyy.padStart(4,'0')}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
  }
  function toIsoTime(t) {
    if (!t) return '';
    // 11:52 AM -> 11:52, 03:05 PM -> 15:05
    const m = t.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
    if (!m) return '';
    let hh = +m[1], mm = m[2], ap = m[3].toUpperCase();
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
    return `${String(hh).padStart(2,'0')}:${mm}`;
  }

  // ---------- GEO LOOKUP ----------
  let wardsGeo = null, beatsGeo = null, psGeo = null;

  async function loadGeoOnce() {
    if (wardsGeo && beatsGeo && psGeo) return;
    pillPending('geo');
    try {
      const [w,b,p] = await Promise.all([
        fetch('wards.geojson').then(r=>r.json()),
        fetch('beats.geojson').then(r=>r.json()),
        fetch('police_jurisdiction.geojson').then(r=>r.json())
      ]);
      wardsGeo = w; beatsGeo = b; psGeo = p;
      pillOk('geo');
    } catch (e) {
      pillErr('geo'); banner('Failed to load GeoJSON lookups.', 'error');
    }
  }

  function pointIn(poly, x, y) {
    // ray-casting
    let inside = false;
    for (const ring of poly) {
      const coords = ring; // [ [lon,lat], ... ]
      for (let i=0, j=coords.length-1; i<coords.length; j=i++) {
        const xi = coords[i][0], yi = coords[i][1];
        const xj = coords[j][0], yj = coords[j][1];
        const intersect = ((yi > y) !== (yj > y)) &&
                          (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
    }
    return inside;
  }

  function lookupGeo(lat, lon) {
    if (!wardsGeo || !beatsGeo || !psGeo) return {};
    const out = {ward:'', beat:'', ps:''};

    const LON = +lon, LAT = +lat;
    if (!Number.isFinite(LON) || !Number.isFinite(LAT)) return out;

    // Wards
    for (const f of wardsGeo.features || []) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') {
        if (pointIn(g.coordinates, LON, LAT)) { out.ward = f.properties?.WARD || f.properties?.name || ''; break; }
      } else if (g.type === 'MultiPolygon') {
        for (const poly of g.coordinates) {
          if (pointIn(poly, LON, LAT)) { out.ward = f.properties?.WARD || f.properties?.name || ''; break; }
        }
        if (out.ward) break;
      }
    }
    // Beats
    for (const f of beatsGeo.features || []) {
      const g = f.geometry; if (!g) continue;
      if (g.type === 'Polygon') {
        if (pointIn(g.coordinates, LON, LAT)) { out.beat = f.properties?.BEAT || f.properties?.name || ''; break; }
      } else if (g.type === 'MultiPolygon') {
        for (const poly of g.coordinates) {
          if (pointIn(poly, LON, LAT)) { out.beat = f.properties?.BEAT || f.properties?.name || ''; break; }
        }
        if (out.beat) break;
      }
    }
    // Police
    for (const f of psGeo.features || []) {
      const g = f.geometry; if (!g) continue;
      if (g.type === 'Polygon') {
        if (pointIn(g.coordinates, LON, LAT)) { out.ps = f.properties?.PS || f.properties?.name || ''; break; }
      } else if (g.type === 'MultiPolygon') {
        for (const poly of g.coordinates) {
          if (pointIn(poly, LON, LAT)) { out.ps = f.properties?.PS || f.properties?.name || ''; break; }
        }
        if (out.ps) break;
      }
    }
    return out;
  }

  // ---------- MAIN FLOW ----------
  attachDnD(el.dropZone);
  el.file.addEventListener('change', onPicked);

  function attachDnD(zone) {
    ;['dragenter','dragover'].forEach(ev =>
      zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('dz--over'); })
    );
    ;['dragleave','drop'].forEach(ev =>
      zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('dz--over'); })
    );
    zone.addEventListener('drop', async e => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) await processFile(file);
    });
    zone.addEventListener('click', () => el.file.click());
  }

  async function onPicked(e) {
    const file = e.target.files && e.target.files[0];
    if (file) await processFile(file);
  }

  async function processFile(file) {
    resetUI();
    pillPending('upload');

    try {
      if (!/^image\/(jpe?g|png)$/i.test(file.type)) {
        pillErr('upload'); banner('Please upload a JPG or PNG.', 'error'); return;
      }
      const url = await readFileAsDataURL(file);
      const img = await loadImage(url);
      el.originalPreview.src = url;
      pillOk('upload');

      // Build candidates and attempt OCR on each until we get a good parse
      await loadGeoOnce();
      const candidates = buildCandidateCrops(img);

      let best = null;

      pillPending('ocr');
      for (const c of candidates) {
        const x = Math.max(0, c.x + (c.leftTrim || 0));
        const w = c.w - (c.leftTrim || 0);
        const canvas = drawCrop(img, x, c.y, w, c.h);
        // Light enhancement (no heavy preprocessing to keep fidelity)
        const txt = await runOCR(canvas);
        const parsed = parseHud(txt);
        const score = scoreParse(parsed);

        if (!best || score > best.score) {
          best = { canvas, parsed, score, reason: c.reason, leftTrim: c.leftTrim || 0, raw: txt };
        }
      }
      pillOk('ocr');

      if (!best || best.score < 1) {
        // Still show what we got and let the user decide / re-take
        el.hudPreview.src = candidates.length ? drawCrop(img, candidates[0].x, candidates[0].y, candidates[0].w, candidates[0].h).toDataURL('image/jpeg', 0.85) : '';
        pillPending('parse'); pillErr('parse');
        banner('Could not confidently read the HUD. Shown is our best crop. Please try a clearer photo.', 'warning');
        return;
      }

      // Use best
      el.hudPreview.src = best.canvas.toDataURL('image/jpeg', 0.9);

      pillPending('parse');
      const { date, time, lat, lon, address } = best.parsed;
      setText(el.rDate, date || '—');
      setText(el.rTime, time || '—');
      setText(el.rLat, lat || '—');
      setText(el.rLon, lon || '—');
      setText(el.rAddr, address || '—');

      const okNumbers = plausible(lat, CFG.LAT_RANGE) && plausible(lon, CFG.LON_RANGE);
      if (!okNumbers) {
        pillErr('parse');
        banner('Parsed, but latitude/longitude look invalid for Mumbai. Please verify.', 'warning');
        return;
      }
      pillOk('parse');

      // Geo lookup
      const geo = lookupGeo(lat, lon);
      setText(el.rWard, geo.ward || '—');
      setText(el.rBeat, geo.beat || '—');
      setText(el.rPS, geo.ps || '—');

      const allOk = date && time && address && geo.ward && geo.beat && geo.ps;
      pillOk('review');

      // Conditional redirect
      if (CFG.REDIRECT_ON_SUCCESS && allOk) {
        pillPending('redirect');
        const url = CFG.FORM_URL_TEMPLATE
          .replace('{DATE}', encodeURIComponent(date))
          .replace('{TIME}', encodeURIComponent(time))
          .replace('{LON}', encodeURIComponent(lon))
          .replace('{LAT}', encodeURIComponent(lat))
          .replace('{WARD}', encodeURIComponent(geo.ward))
          .replace('{BEAT}', encodeURIComponent(geo.beat))
          .replace('{ADDR}', encodeURIComponent(address))
          .replace('{PS}', encodeURIComponent(geo.ps));
        pillOk('redirect');
        window.open(url, '_blank', 'noopener');
      } else {
        pillErr('redirect');
        if (!allOk) banner('Parsed successfully. Ward/Beat/PS or address/date/time incomplete — no redirect.', 'info');
      }

    } catch (e) {
      console.error(e);
      pillErr('upload'); pillErr('ocr'); pillErr('parse'); pillErr('geo'); pillErr('review'); pillErr('redirect');
      banner('Unexpected error while processing the image.', 'error');
    }
  }

  function scoreParse(p) {
    let s = 0;
    if (p.date) s++;
    if (p.time) s++;
    if (plausible(p.lat, CFG.LAT_RANGE)) s+=2;
    if (plausible(p.lon, CFG.LON_RANGE)) s+=2;
    if (p.address) s++;
    return s;
  }

  function setText(node, txt) { if (node) node.textContent = txt; }

  function resetUI() {
    banner('', 'info'); if (el.banner) el.banner.hidden = true;
    [el.rDate, el.rTime, el.rLat, el.rLon, el.rAddr, el.rWard, el.rBeat, el.rPS]
      .forEach(n => n && (n.textContent = '—'));
    if (el.hudPreview) el.hudPreview.src = '';
    // reset pills (upload will be set to pending immediately)
    Object.keys(pills).forEach(k => {
      pills[k].classList.remove('pill--ok','pill--err','pill--pending');
      const tag = pills[k].querySelector('.pill__time'); if (tag) tag.textContent = '';
    });
  }

  // Expose for debugging if needed
  window.__mcgm_debug = { parseHud, smartHudBand, buildCandidateCrops };

})();
