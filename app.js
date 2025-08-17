/* app.js — MCGM Marshal Upload (OCR + GeoJSON + Google Form)
   Build: v2025.08.18.Prod
*/

/* ==========================
   Config
   ========================== */
const CFG = {
  previews: {
    originalScale: 0.25,     // 25% (UI expects this)
    cropScale: 0.50          // 50% for the cropped HUD strip
  },
  // Heuristic crop for the GPS Map Camera HUD:
  // Start near the bottom, trim more from LEFT to exclude the minimap
  cropHUD: {
    topFromBottomPct: 0.28,  // crop window height ≈ last 28% of image
    leftTrimPct: 0.18,       // trim 18% from left (remove mini-map)
    rightTrimPct: 0.02       // keep a tiny right margin
  },
  ocr: {
    primaryLang: "eng",      // avoid mar/hin traineddata 404s; English HUD text is dominant
    secondaryLang: "hin",    // optional re-run if devanagari is detected
    rerunOnDevanagari: true
  },
  geojson: {
    wards: "data/wards.geojson",
    beats: "data/beats.geojson",
    police: "data/police_jurisdiction.geojson",
    // Mumbai sanity bounds (deg): reject obviously bad OCR numbers
    bounds: { lat: [18.0, 20.0], lon: [72.0, 73.5] }
  },
  outsideMsg: "Outside MCGM Boundaries — Not allowed.",
  GOOGLE_FORM: {
    enabled: true,                 // auto open only when valid
    mode: "open",                  // "open" new tab OR "redirect" same tab
    action:
      "https://docs.google.com/forms/d/e/1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw/viewform",
    fields: {
      date:      "entry.1911996449", // YYYY-MM-DD
      time:      "entry.1421115881", // HH:mm
      longitude: "entry.113122688",  // 1 = Long
      latitude:  "entry.419288992",  // 2 = Lat
      ward:      "entry.1625337207", // 3 = Ward
      beat:      "entry.1058310891", // 4 = Beat
      address:   "entry.1188611077", // 5 = Address
      ps:        "entry.1555105834"  // 6 = Police Station
    }
  }
};

/* ==========================
   Lightweight state
   ========================== */
const state = {
  img: null,
  crop: null,
  text: "",
  parsed: null,
  loc: null,
  polygons: null,
  timers: {}
};

const $ = (sel) => document.querySelector(sel);
const setText = (id, v) => {
  const el = $(id);
  if (el) el.textContent = v ?? "—";
};

const pills = [
  "#stage-upload",
  "#stage-ocr",
  "#stage-parse",
  "#stage-geojson",
  "#stage-review",
  "#stage-redirect"
];

/* ==========================
   Stage / timing helpers
   ========================== */
function markStage(i, status) {
  const id = pills[i];
  const el = id && $(id);
  if (!el) return;
  el.classList.remove("ok", "active", "pending", "err");
  el.classList.add(status); // "active", "ok", "err", "pending"
}
function startTimer(name) {
  state.timers[name] = performance.now();
}
function endTimer(name) {
  const t0 = state.timers[name];
  if (t0) {
    const dt = (performance.now() - t0) / 1000;
    const badge = document.querySelector(`[data-time="${name}"]`);
    if (badge) badge.textContent = `${name} — ${dt.toFixed(1)}s`;
  }
}

/* ==========================
   UI: file input & DnD
   ========================== */
const fileInput = $("#fileInput");
const dropzone  = $("#dropzone");
const origImgEl = $("#origPreview");
const cropImgEl = $("#cropPreview");

function setupDnD() {
  ["dragenter","dragover"].forEach(ev => {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragging"); });
  });
  ["dragleave","drop"].forEach(ev => {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragging"); });
  });
  dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  dropzone.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
    // clear value so selecting the same file again triggers change
    e.target.value = "";
  });
}

/* ==========================
   Imaging helpers
   ========================== */
function readAsDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function drawScaled(img, scale) {
  const c = document.createElement("canvas");
  c.width  = Math.max(1, Math.round(img.naturalWidth  * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

// Crop bottom strip (HUD) and trim LEFT strongly to avoid mini-map.
function cropHUD(img) {
  const { topFromBottomPct, leftTrimPct, rightTrimPct } = CFG.cropHUD;
  const W = img.naturalWidth, H = img.naturalHeight;

  const top = Math.max(0, Math.round(H * (1 - topFromBottomPct)));
  const height = H - top;

  const left  = Math.round(W * leftTrimPct);
  const right = Math.round(W * (1 - rightTrimPct));
  const width = Math.max(20, right - left);

  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  g.drawImage(img, left, top, width, height, 0, 0, width, height);
  return c.toDataURL("image/jpeg", 0.95);
}

/* ==========================
   OCR
   ========================== */
async function runOCR(dataUrl, lang) {
  markStage(1, "active");
  startTimer("OCR");
  if (!window.Tesseract || !Tesseract.recognize) {
    markStage(1, "err");
    endTimer("OCR");
    throw new Error("Tesseract.js not found on page.");
  }
  const { data } = await Tesseract.recognize(dataUrl, lang || CFG.ocr.primaryLang, {
    logger: (m) => {
      const badge = document.querySelector(`[data-progress="ocr"]`);
      if (badge && m.status && typeof m.progress === "number") {
        badge.textContent = `OCR: ${Math.round(m.progress * 100)}%`;
      }
    }
  });
  endTimer("OCR");
  markStage(1, "ok");
  return (data && data.text) ? data.text : "";
}

/* ==========================
   Parsing helpers
   ========================== */
const RE = {
  date: /\b(0?[1-9]|[12][0-9]|3[01])[-\/. ](0?[1-9]|1[0-2])[-\/. ](20\d{2})\b/,
  time: /\b([01]?\d|2[0-3]):([0-5]\d)(?:\s?([AP]M))?\b/i,
  latLine: /lat[^0-9\-]*([\-]?\d{1,2}[.,]\d{3,8})/i,
  lonLine: /lon[^0-9\-]*([\-]?\d{1,3}[.,]\d{3,8})/i,
  dec: /([\-]?\d{1,3}[.,]\d{3,8})/g
};

function normNum(s) {
  if (!s) return null;
  return Number(String(s).replace(/[^\d\.\-]/g, "").replace(",", "."));
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function extractLatLon(text) {
  let lat = null, lon = null;

  const l1 = RE.latLine.exec(text);
  if (l1) lat = normNum(l1[1]);
  const l2 = RE.lonLine.exec(text);
  if (l2) lon = normNum(l2[1]);

  const cand = Array.from(text.matchAll(RE.dec)).map(m => normNum(m[1]));
  const inLat = cand.filter(x => x > -90 && x < 90);
  const inLon = cand.filter(x => x > -180 && x < 180);

  const within = CFG.geojson.bounds;
  function withinLat(x){ return x >= within.lat[0] && x <= within.lat[1]; }
  function withinLon(x){ return x >= within.lon[0] && x <= within.lon[1]; }

  if ((lat == null || !withinLat(lat)) && inLat.length) {
    const pick = inLat.find(withinLat);
    if (pick != null) lat = pick;
  }
  if ((lon == null || !withinLon(lon)) && inLon.length) {
    const pick = inLon.find(withinLon);
    if (pick != null) lon = pick;
  }

  if (lat != null) lat = clamp(lat, -90, 90);
  if (lon != null) lon = clamp(lon, -180, 180);

  return { lat, lon };
}

function parseAddress(text) {
  let best = "";
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  for (const s of lines) {
    if (/lat|long|wind|humidity|pressure|temperature|gmt/i.test(s)) continue;
    if (/\b(mumbai|maharashtra|india)\b/i.test(s)) {
      best += (best ? " " : "") + s;
    }
  }
  best = best
    .replace(/[|]/g, "1")
    .replace(/, ,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!best) {
    best = lines.sort((a,b)=>b.length-a.length)[0] || "";
  }
  return best;
}

function parseDateTime(text) {
  let date = null, time = null;

  const dm = RE.date.exec(text);
  if (dm) {
    const dd = dm[1].padStart(2, "0");
    const mm = dm[2].padStart(2, "0");
    const yyyy = dm[3];
    date = `${yyyy}-${mm}-${dd}`;
  }

  const tm = RE.time.exec(text);
  if (tm) {
    let hh = parseInt(tm[1], 10);
    const mm = tm[2];
    const ap = (tm[3] || "").toUpperCase();
    if (ap === "PM" && hh < 12) hh += 12;
    if (ap === "AM" && hh === 12) hh = 0;
    time = `${String(hh).padStart(2,"0")}:${mm}`;
  }
  return { date, time };
}

function parseOCR(text) {
  markStage(2, "active");
  startTimer("Parse");

  const { date, time } = parseDateTime(text);
  const { lat, lon }  = extractLatLon(text);
  const addr = parseAddress(text);

  endTimer("Parse");
  markStage(2, "ok");
  return { date, time, lat, lon, addr };
}

/* ==========================
   GeoJSON load + lookup
   ========================== */
async function loadGeoJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load ${url}`);
  return r.json();
}

function bboxOfCoords(coords) {
  let minX= Infinity, minY= Infinity, maxX= -Infinity, maxY= -Infinity;
  const scan = (arr) => {
    for (const p of arr) {
      const [x,y] = p;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  };
  return { scan, get: ()=>[minX,minY,maxX,maxY] };
}

function buildIndex(gj, idKeyGuess) {
  const items = [];
  for (const f of gj.features) {
    const g = f.geometry;
    if (!g) continue;
    const props = f.properties || {};
    const collector = bboxOfCoords([]);
    function pushPoly(poly) {
      const outline = poly[0];
      collector.scan(outline);
    }

    if (g.type === "Polygon") {
      pushPoly(g.coordinates);
      items.push({ type:"Polygon", coords: g.coordinates, bbox: collector.get(), props });
    } else if (g.type === "MultiPolygon") {
      const bb = bboxOfCoords([]);
      for (const poly of g.coordinates) bb.scan(poly[0]);
      items.push({ type:"MultiPolygon", coords: g.coordinates, bbox: bb.get(), props });
    }
  }
  return items;
}

function pointInRing(point, ring) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i=0, j=ring.length-1; i<ring.length; j=i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi>y)!==(yj>y)) && (x < ((xj - xi)*(y - yi))/(yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygon(point, poly) {
  if (!pointInRing(point, poly[0])) return false;
  for (let h=1; h<poly.length; h++) if (pointInRing(point, poly[h])) return false;
  return true;
}
function pointInMultiPolygon(point, mpoly) {
  for (const poly of mpoly) if (pointInPolygon(point, poly)) return true;
  return false;
}
function bboxHit(point, bbox) {
  const [minX,minY,maxX,maxY] = bbox;
  return (point[0] >= minX && point[0] <= maxX && point[1] >= minY && point[1] <= maxY);
}
function resolvePoint(lat, lon, indices) {
  markStage(3, "active");
  startTimer("GeoJSON");

  const pt = [lon, lat];
  const res = { ward: "—", beat: "—", ps: "—", inside: false };
  let insideAny = false;

  for (const it of indices.wards) {
    if (!bboxHit(pt, it.bbox)) continue;
    const hit = (it.type === "Polygon")
      ? pointInPolygon(pt, it.coords)
      : pointInMultiPolygon(pt, it.coords);
    if (hit) { res.ward = it.props.WARD || it.props.ward || it.props.name || "—"; insideAny = true; break; }
  }
  for (const it of indices.beats) {
    if (!bboxHit(pt, it.bbox)) continue;
    const hit = (it.type === "Polygon")
      ? pointInPolygon(pt, it.coords)
      : pointInMultiPolygon(pt, it.coords);
    if (hit) { res.beat = it.props.BEAT_NO || it.props.BEAT || it.props.name || "—"; break; }
  }
  for (const it of indices.police) {
    if (!bboxHit(pt, it.bbox)) continue;
    const hit = (it.type === "Polygon")
      ? pointInPolygon(pt, it.coords)
      : pointInMultiPolygon(pt, it.coords);
    if (hit) { res.ps = it.props.PS_NAME || it.props.POLICE_STN || it.props.name || "—"; break; }
  }

  res.inside = insideAny;
  endTimer("GeoJSON");
  markStage(3, "ok");
  return res;
}

/* ==========================
   Google Form prefill
   ========================== */
function tryOpenGoogleForm(parsed, loc) {
  const cfg = CFG.GOOGLE_FORM;
  if (!cfg.enabled) return;

  if (!parsed?.date || !parsed?.time || parsed?.lat==null || parsed?.lon==null ||
      !parsed?.addr || !loc?.ward || !loc?.beat || !loc?.ps || !loc.inside) {
    return;
  }

  const u = new URL(cfg.action);
  u.searchParams.set("usp", "pp_url");

  const put = (k, v) => {
    const id = cfg.fields[k];
    if (id && v!=null) u.searchParams.set(id, String(v));
  };

  put("date", parsed.date);
  put("time", parsed.time);
  put("latitude", parsed.lat);
  put("longitude", parsed.lon);
  put("ward", loc.ward);
  put("beat", loc.beat);
  put("address", parsed.addr);
  put("ps", loc.ps);

  markStage(5, "active");
  if (cfg.mode === "redirect") window.location.href = u.toString();
  else window.open(u.toString(), "_blank", "noopener");
  markStage(5, "ok");
}

/* ==========================
   Render helpers
   ========================== */
function renderParsed(p) {
  setText("#valDate", p?.date || "—");
  setText("#valTime", p?.time || "—");
  setText("#valLat", (p?.lat!=null) ? p.lat.toFixed(6) : "—");
  setText("#valLon", (p?.lon!=null) ? p.lon.toFixed(6) : "—");
  setText("#valAddr", p?.addr || "—");
}
function renderLoc(l) {
  setText("#valWard", l?.ward || "—");
  setText("#valBeat", l?.beat || "—");
  setText("#valPS",   l?.ps   || "—");
}

/* ==========================
   Main pipeline
   ========================== */
async function handleFile(file) {
  [0,1,2,3,4,5].forEach(i => markStage(i, "pending"));
  markStage(0, "active");
  startTimer("Upload");

  try {
    const dataUrl = await readAsDataURL(file);
    endTimer("Upload");
    markStage(0, "ok");

    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    state.img = img;

    if (origImgEl) origImgEl.src = drawScaled(img, CFG.previews.originalScale);

    const cropURL = cropHUD(img);
    state.crop = cropURL;
    cropImgEl.src = cropURL; // 50% size is controlled by CSS/UI scale

    // OCR
    let text = await runOCR(cropURL, CFG.ocr.primaryLang);

    if (CFG.ocr.rerunOnDevanagari && /[\u0900-\u097F]/.test(text)) {
      try {
        const hinText = await runOCR(cropURL, CFG.ocr.secondaryLang);
        if (hinText && hinText.length > text.length * 0.7) {
          text += "\n" + hinText;
        }
      } catch(_) {}
    }

    state.text = text;

    // Parse
    const parsed = parseOCR(text);
    const within = CFG.geojson.bounds;
    if (parsed.lat!=null && !(parsed.lat >= within.lat[0] && parsed.lat <= within.lat[1])) parsed.lat = null;
    if (parsed.lon!=null && !(parsed.lon >= within.lon[0] && parsed.lon <= within.lon[1])) parsed.lon = null;

    state.parsed = parsed;
    renderParsed(parsed);

    // GeoJSON (load once)
    if (!state.polygons) {
      const [gw, gb, gp] = await Promise.all([
        loadGeoJSON(CFG.geojson.wards),
        loadGeoJSON(CFG.geojson.beats),
        loadGeoJSON(CFG.geojson.police)
      ]);
      state.polygons = {
        wards:  buildIndex(gw, "WARD"),
        beats:  buildIndex(gb, "BEAT_NO"),
        police: buildIndex(gp, "PS_NAME")
      };
    }

    // Resolve ward/beat/ps if coords parsed
    let loc = { ward:"—", beat:"—", ps:"—", inside:false };
    if (parsed.lat!=null && parsed.lon!=null) {
      loc = resolvePoint(parsed.lat, parsed.lon, state.polygons);
    } else {
      markStage(3, "err");
    }
    state.loc = loc;
    renderLoc(loc);

    markStage(4, "ok");

    if (!loc.inside) {
      alert(CFG.outsideMsg);
      markStage(5, "err");
      return;
    }

    if (parsed.date && parsed.time && parsed.lat!=null && parsed.lon!=null && parsed.addr && loc.ward && loc.beat && loc.ps) {
      tryOpenGoogleForm({
        date: parsed.date,
        time: parsed.time,
        lat:  +parsed.lat.toFixed(6),
        lon:  +parsed.lon.toFixed(6),
        addr: parsed.addr
      }, loc);
    } else {
      markStage(5, "pending");
    }

  } catch (err) {
    console.error(err);
    alert("Failed to process image. Please try another photo.");
    [0,1,2,3,4,5].forEach(i => markStage(i, (i===0) ? "err" : "pending"));
  }
}

/* ==========================
   Boot
   ========================== */
window.addEventListener("DOMContentLoaded", () => {
  setupDnD();
  [0,1,2,3,4,5].forEach(i => markStage(i, "pending"));
  ["Upload","OCR","Parse","GeoJSON","Review","Redirect"].forEach(n => {
    const badge = document.querySelector(`[data-time="${n}"]`);
    if (badge) badge.textContent = `${n} — 0.0s`;
  });

  const btnReset = document.querySelector('[data-action="reset"]');
  if (btnReset) btnReset.addEventListener("click", () => window.location.reload());
});
