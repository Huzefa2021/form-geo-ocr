/* -----------------------------
   MCGM Marshal Upload – App JS
   v2025.08.18.Prod
------------------------------*/

(() => {
  // ---------- DOM ----------
  const els = {
    // pills
    pillUpload: document.getElementById('pill-upload'),
    pillOcr: document.getElementById('pill-ocr'),
    pillParse: document.getElementById('pill-parse'),
    pillGeo: document.getElementById('pill-geo'),
    pillReview: document.getElementById('pill-review'),
    pillRedirect: document.getElementById('pill-redirect'),

    // status row under header
    bar: document.getElementById('stage-bar'),

    // file
    drop: document.getElementById('dropzone'),
    file: document.getElementById('fileInput'),
    originalPreview: document.getElementById('originalPreview'),
    cropPreview: document.getElementById('cropPreview'),

    // results
    rDate: document.getElementById('result-date'),
    rTime: document.getElementById('result-time'),
    rLat: document.getElementById('result-lat'),
    rLon: document.getElementById('result-lon'),
    rAddr: document.getElementById('result-address'),
    rWard: document.getElementById('result-ward'),
    rBeat: document.getElementById('result-beat'),
    rPS: document.getElementById('result-ps'),

    // controls
    reset: document.getElementById('btnReset'),
    cdnBadge: document.getElementById('cdnBadge'),
  };

  // ---------- Config ----------
  const OCR_LANG = 'eng+hin';          // robust + no marathi 404
  const OCR_WORKER_PATH =
    'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.3/dist/tesseract.min.js';

  const GEO_PATHS = {
    wards: 'wards.geojson',
    beats: 'beats.geojson',
    police: 'police_jurisdiction.geojson',
  };

  const GOOGLE_FORM = {
    base:
      'https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform?usp=pp_url',
    keys: {
      date: 'entry.1911996449',
      time: 'entry.1421115881',
      lon: 'entry.113122688',
      lat: 'entry.419288992',
      ward: 'entry.1625337207',
      beat: 'entry.1058310891',
      address: 'entry.1188611077',
      ps: 'entry.1555105834',
    },
  };

  // ---------- State ----------
  let geo = { wards: null, beats: null, police: null };
  let result = {
    date: null,
    time: null,
    lat: null,
    lon: null,
    address: '',
    ward: '',
    beat: '',
    ps: '',
  };

  const t0 = {}; // stage timers

  // ---------- Utils: Pills/Timers ----------
  function ms(d) {
    return `${(d ?? 0).toFixed(1)}s`;
  }
  function startStage(key, pill) {
    t0[key] = performance.now();
    setPill(pill, 'run', '');
  }
  function endStage(key, pill) {
    const elapsed = (performance.now() - (t0[key] || performance.now())) / 1000;
    setPill(pill, 'ok', `(${ms(elapsed)})`);
    return elapsed;
  }
  function failStage(key, pill, msg) {
    setPill(pill, 'err', msg ? `— ${msg}` : '');
  }
  function setPill(el, state, suffix = '') {
    if (!el) return;
    el.classList.remove('pill-ok', 'pill-warn', 'pill-err', 'pill-run', 'pill-idle');
    switch (state) {
      case 'ok':
        el.classList.add('pill-ok'); break;
      case 'warn':
        el.classList.add('pill-warn'); break;
      case 'err':
        el.classList.add('pill-err'); break;
      case 'run':
        el.classList.add('pill-run'); break;
      default:
        el.classList.add('pill-idle');
    }
    const base = el.dataset.label || el.textContent.split('(')[0].trim();
    el.dataset.label = base;
    el.textContent = `${base} ${suffix}`.trim();
  }

  // ---------- File UX (single, no double prompt) ----------
  function bindFileUX() {
    // click to open
    els.drop.addEventListener('click', () => els.file.click(), { passive: true });

    // prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evt) => {
      els.drop.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
      });
      document.body.addEventListener(evt, (e) => {
        if (evt !== 'drop') { e.preventDefault(); e.stopPropagation(); }
      });
    });

    els.drop.addEventListener('dragover', () => els.drop.classList.add('hover'));
    els.drop.addEventListener('dragleave', () => els.drop.classList.remove('hover'));
    els.drop.addEventListener('drop', (e) => {
      els.drop.classList.remove('hover');
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    });

    els.file.addEventListener('change', () => {
      const f = els.file.files?.[0];
      if (f) handleFile(f);
      // clear value so selecting same file again still triggers change
      els.file.value = '';
    });

    els.reset.addEventListener('click', hardReset);
  }

  function hardReset() {
    result = { date: null, time: null, lat: null, lon: null, address: '', ward: '', beat: '', ps: '' };
    // clear fields
    setText(els.rDate, '—'); setText(els.rTime, '—');
    setText(els.rLat, '—');  setText(els.rLon, '—');
    setText(els.rAddr, '—'); setText(els.rWard, '—');
    setText(els.rBeat, '—'); setText(els.rPS, '—');
    els.originalPreview.src = '';
    els.cropPreview.src = '';

    // reset pills
    ['pillUpload','pillOcr','pillParse','pillGeo','pillReview','pillRedirect'].forEach(id=>{
      const el = els[id]; if (el) setPill(el,'idle','');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- Helpers ----------
  function setText(el, v) { if (el) el.textContent = v ?? '—'; }

  function loadImageToPreview(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        els.originalPreview.src = url; // 25% via CSS container
        resolve({ img, url });
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // Crop: bottom HUD with multiple left trims; returns dataURL candidates
  function makeHudCrops(img) {
    const H = img.naturalHeight || img.height;
    const W = img.naturalWidth || img.width;

    // bottom band heights to try
    const heights = [0.42, 0.36, 0.48]; // fraction from bottom
    const leftTrims = [0.00, 0.08, 0.12, 0.18, 0.24];

    const candidates = [];
    heights.forEach((hFrac) => {
      const y = Math.max(0, Math.floor(H * (1 - hFrac)));
      const h = Math.floor(H * hFrac);
      leftTrims.forEach((lFrac) => {
        const x = Math.floor(W * lFrac);
        const w = Math.max(64, W - x); // ensure non-empty
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        candidates.push(c.toDataURL('image/jpeg', 0.92));
      });
    });
    return candidates;
  }

  // ---------- OCR ----------
  async function ensureTesseract() {
    if (window.Tesseract) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = OCR_WORKER_PATH;
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  async function ocrDataURL(dataUrl, lang = OCR_LANG) {
    await ensureTesseract();
    const { Tesseract } = window;
    const worker = await Tesseract.createWorker(lang);
    const { data } = await worker.recognize(dataUrl);
    await worker.terminate();
    return data.text || '';
  }

  // ---------- Parser (from previous message, integrated) ----------
  function normalizeOcr(raw) {
    let t = raw || '';
    t = t.replace(/\r/g, '').replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ');
    t = t.replace(/[º°•◦]/g, '°');
    t = t
      .replace(/\bO(?=\d)/g, '0')
      .replace(/(?<=\d)O\b/g, '0')
      .replace(/\bI(?=\d)/g, '1')
      .replace(/\bl(?=\d)/g, '1')
      .replace(/S(?=\d)/g, '5');

    t = t
      .replace(/GPS Map Camera/gi, '')
      .replace(/\bGoogle\b/gi, '')
      .replace(/\bAM\b|\bPM\b/gi, (m) => m.toUpperCase());

    return t
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');
  }
  function coerceNumber(n) {
    if (n == null || n === '') return null;
    const x = Number(String(n).replace(/[^\d.\-+eE]/g, ''));
    return Number.isFinite(x) ? x : null;
  }
  function plausibleLatLon(lat, lon) {
    if (lat == null || lon == null) return false;
    return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }
  function fallbackLatLonSearch(text) {
    const re = /(-?\d{1,2}\.\d{4,8}).{0,25}?(-?\d{2,3}\.\d{4,8})/is;
    const m = text.match(re);
    if (m) {
      let lat = coerceNumber(m[1]);
      let lon = coerceNumber(m[2]);
      if (!plausibleLatLon(lat, lon) && plausibleLatLon(lon, lat)) [lat, lon] = [lon, lat];
      if (plausibleLatLon(lat, lon)) return { lat, lon };
    }
    return { lat: null, lon: null };
  }
  function extractLatLonFromLine(line) {
    const labeled = line.match(
      /(?:la[tf]\s*[:\- ]*\s*)(-?\d{1,2}\.\d{4,8}).*?(?:lo?(?:ng|n|g)\s*[:\- ]*)(-?\d{2,3}\.\d{4,8})/i
    );
    if (labeled) {
      return { lat: coerceNumber(labeled[1]), lon: coerceNumber(labeled[2]) };
    }
    const anyTwo = line.match(/(-?\d{1,2}\.\d{4,8}).*?(-?\d{2,3}\.\d{4,8})/);
    if (anyTwo) {
      let lat = coerceNumber(anyTwo[1]);
      let lon = coerceNumber(anyTwo[2]);
      if (!plausibleLatLon(lat, lon) && plausibleLatLon(lon, lat)) [lat, lon] = [lon, lat];
      if (plausibleLatLon(lat, lon)) return { lat, lon };
    }
    return { lat: null, lon: null };
  }
  function extractDateTimeFromLine(line) {
    let date = null, time = null;
    const dmy = line.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    const ymd = line.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
    if (dmy) {
      const [_, d, m, y] = dmy; const yyyy = y.length === 2 ? `20${y}` : y;
      date = `${yyyy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    } else if (ymd) {
      const [_, y, m, d] = ymd; date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const tm = line.match(/\b(\d{1,2}):(\d{2})\b(?:\s*(AM|PM))?/i);
    if (tm) {
      let [__, hh, mm, ap] = tm; let H = parseInt(hh, 10);
      if (ap) { ap = ap.toUpperCase(); if (ap === 'PM' && H < 12) H += 12; if (ap === 'AM' && H === 12) H = 0; }
      time = `${String(H).padStart(2, '0')}:${mm}`;
    }
    return { date, time };
  }
  function parseOcrText(rawText) {
    const text = normalizeOcr(rawText);
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) return { date: null, time: null, lat: null, lon: null, address: '' };

    // date/time from last relevant line
    let dtIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/\b(20\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/.test(lines[i])) { dtIdx = i; break; }
    }
    let date = null, time = null;
    if (dtIdx !== -1) ({ date, time } = extractDateTimeFromLine(lines[dtIdx]));

    // lat/lon from second-last area
    let llIdx = -1;
    for (let i = (dtIdx !== -1 ? dtIdx - 1 : lines.length - 1); i >= 0; i--) {
      if (/(?:la[tf]|lo(?:ng|n|g)|lng)/i.test(lines[i]) || /\d{1,2}\.\d{4,8}/.test(lines[i])) { llIdx = i; break; }
    }
    let { lat, lon } = { lat: null, lon: null };
    if (llIdx !== -1) ({ lat, lon } = extractLatLonFromLine(lines[llIdx]));
    if (!plausibleLatLon(lat, lon)) ({ lat, lon } = fallbackLatLonSearch(text));

    // Address: ignore first line; use line 2 (+3) up to llIdx/dtIdx
    let stopAt = Math.min(llIdx !== -1 ? llIdx : lines.length, dtIdx !== -1 ? dtIdx : lines.length);
    let addrStart = 1; if (addrStart >= stopAt) addrStart = 0;
    let addrCandidates = lines.slice(addrStart, stopAt);
    let address = addrCandidates
      .filter((s) => s && s.length > 3)
      .map((s) => s.replace(/\s{2,}/g, ' ').replace(/[,;]\s*$/g, ''))
      .join(', ');
    if (!address && lines[1]) address = lines[1];
    address = address.replace(/\s+,/g, ',').replace(/,\s*,/g, ', ').replace(/\s{2,}/g, ' ').trim();

    return { date, time, lat, lon, address };
  }

  // ---------- GeoJSON + PIP ----------
  async function loadGeo() {
    const [wards, beats, police] = await Promise.all([
      fetch(GEO_PATHS.wards).then(r => r.ok ? r.json() : null),
      fetch(GEO_PATHS.beats).then(r => r.ok ? r.json() : null),
      fetch(GEO_PATHS.police).then(r => r.ok ? r.json() : null),
    ]);
    geo = { wards, beats, police };
  }

  function getProp(props, keys) {
    if (!props) return '';
    for (const k of keys) {
      if (props[k] != null && props[k] !== '') return props[k];
    }
    return '';
  }

  function pointInPolygon([x, y], poly) {
    // Ray casting for one ring
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 0.0) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function featureContainsPoint(feature, lon, lat) {
    const g = feature.geometry;
    if (!g) return false;
    if (g.type === 'Polygon') {
      return g.coordinates.some(ring => pointInPolygon([lon, lat], ring));
    }
    if (g.type === 'MultiPolygon') {
      return g.coordinates.some(poly => poly.some(ring => pointInPolygon([lon, lat], ring)));
    }
    return false;
  }

  function lookupGeo(lon, lat) {
    const out = { ward: '', beat: '', ps: '' };
    if (!plausibleLatLon(lat, lon)) return out;

    if (geo.wards?.features) {
      const f = geo.wards.features.find(ft => featureContainsPoint(ft, lon, lat));
      if (f) out.ward = getProp(f.properties, ['WARD','WARD_NO','Ward','ward','WARDNAME','WARD_NAME']);
    }
    if (geo.beats?.features) {
      const f = geo.beats.features.find(ft => featureContainsPoint(ft, lon, lat));
      if (f) out.beat = getProp(f.properties, ['BEAT','BEAT_NO','Beat','beat','BEATNO']);
    }
    if (geo.police?.features) {
      const f = geo.police.features.find(ft => featureContainsPoint(ft, lon, lat));
      if (f) out.ps = getProp(f.properties, ['PS','PS_NAME','Police_St','POLICE_ST','STATION','Name']);
    }
    return out;
  }

  // ---------- Redirect ----------
  function canRedirect(r) {
    return Boolean(
      r.date && r.time &&
      plausibleLatLon(r.lat, r.lon) &&
      r.address && r.ward && r.beat && r.ps
    );
  }

  function redirectToGoogleForm(r) {
    const q = new URLSearchParams();
    q.set(GOOGLE_FORM.keys.date, r.date);
    q.set(GOOGLE_FORM.keys.time, r.time);
    q.set(GOOGLE_FORM.keys.lon, String(r.lon));
    q.set(GOOGLE_FORM.keys.lat, String(r.lat));
    q.set(GOOGLE_FORM.keys.ward, r.ward);
    q.set(GOOGLE_FORM.keys.beat, r.beat);
    q.set(GOOGLE_FORM.keys.address, r.address);
    q.set(GOOGLE_FORM.keys.ps, r.ps);

    const url = `${GOOGLE_FORM.base}&${q.toString()}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ---------- Pipeline ----------
  async function handleFile(file) {
    try {
      hardReset();
      startStage('upload', els.pillUpload);

      // show original
      const { img } = await loadImageToPreview(file);
      const up = endStage('upload', els.pillUpload);

      // crops
      const candidates = makeHudCrops(img);
      // make first crop visible while we OCR
      els.cropPreview.src = candidates[0];

      // OCR tries
      startStage('ocr', els.pillOcr);
      let ocrText = '';
      for (let i = 0; i < candidates.length; i++) {
        try {
          const txt = await ocrDataURL(candidates[i], OCR_LANG);
          const parsed = parseOcrText(txt);
          // choose this crop if it produced a plausible lat/lon OR clearly has “Lat/Long/India”
          if (plausibleLatLon(parsed.lat, parsed.lon) || /lat|long|india/i.test(txt)) {
            ocrText = txt;
            els.cropPreview.src = candidates[i]; // keep that crop
            break;
          }
          // Otherwise keep searching; still remember last OCR result as fallback
          if (!ocrText) ocrText = txt;
        } catch {
          // continue next candidate
        }
      }
      if (!ocrText) throw new Error('OCR returned empty text');

      endStage('ocr', els.pillOcr);

      // Parse
      startStage('parse', els.pillParse);
      const parsed = parseOcrText(ocrText);

      result.date = parsed.date;
      result.time = parsed.time;
      result.lat = parsed.lat;
      result.lon = parsed.lon;
      result.address = parsed.address;

      // UI
      setText(els.rDate, result.date || '—');
      setText(els.rTime, result.time || '—');
      setText(els.rLat, result.lat != null ? result.lat.toFixed(6) : '—');
      setText(els.rLon, result.lon != null ? result.lon.toFixed(6) : '—');
      setText(els.rAddr, result.address || '—');

      const parseOK = Boolean(result.date && result.time && plausibleLatLon(result.lat, result.lon) && result.address);
      setPill(els.pillParse, parseOK ? 'ok' : 'warn', parseOK ? '' : ' (partial)');
      endStage('parse', els.pillParse);

      // GeoJSON lookup
      startStage('geo', els.pillGeo);
      if (!geo.wards && !geo.beats && !geo.police) await loadGeo();
      const g = lookupGeo(result.lon, result.lat);
      result.ward = g.ward || '';
      result.beat = g.beat || '';
      result.ps = g.ps || '';
      setText(els.rWard, result.ward || '—');
      setText(els.rBeat, result.beat || '—');
      setText(els.rPS, result.ps || '—');
      endStage('geo', els.pillGeo);

      // Review & Redirect gating
      startStage('review', els.pillReview);
      const okForRedirect = canRedirect(result);
      setPill(els.pillReview, okForRedirect ? 'ok' : 'warn', okForRedirect ? '' : ' (incomplete)');
      endStage('review', els.pillReview);

      if (okForRedirect) {
        setPill(els.pillRedirect, 'ok', '');
        redirectToGoogleForm(result);
      } else {
        setPill(els.pillRedirect, 'warn', ' (blocked)');
      }
    } catch (err) {
      console.error(err);
      failStage('upload', els.pillUpload, '');
      failStage('ocr', els.pillOcr, '');
      failStage('parse', els.pillParse, '');
      failStage('geo', els.pillGeo, '');
      failStage('review', els.pillReview, '');
      failStage('redirect', els.pillRedirect, '');
      alert('Sorry — failed to process this image. Try another one or retake with the GPS HUD clearly visible.');
    }
  }

  // ---------- Boot ----------
  function boot() {
    bindFileUX();
    // initial pill labels cache
    [els.pillUpload, els.pillOcr, els.pillParse, els.pillGeo, els.pillReview, els.pillRedirect]
      .forEach((p) => p && setPill(p, 'idle', ''));
    if (els.cdnBadge) els.cdnBadge.textContent = 'CDN: v5 (jsDelivr)';
  }

  boot();
})();
