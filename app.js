/* =========================
   OCR CDN (no path overrides)
   ========================= */
const OCR_CDNS = [
  { label: "v5 (jsDelivr)", url: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" },
  { label: "v5 (unpkg)",    url: "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js" },
  { label: "v4 (fallback)", url: "https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js" }
];

function addScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function loadOCR() {
  const pill = document.getElementById("cdnPill");
  for (const cdn of OCR_CDNS) {
    try {
      await addScript(cdn.url);
      window.__OCR_VERSION__ = cdn.label;
      if (pill) {
        pill.textContent = "CDN: " + cdn.label;
        pill.classList.add("ok");
      }
      return;
    } catch {
      /* try next */
    }
  }
  if (pill) {
    pill.textContent = "CDN: unavailable";
    pill.classList.add("err");
  }
}

/* =========================
   Config
   ========================= */
const FORM_ID = "1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw";
const ENTRY = {
  date: "entry.1911996449",
  time: "entry.1421115881",
  lon: "entry.113122688",
  lat: "entry.419288992",
  ward: "entry.1625337207",
  beat: "entry.1058310891",
  address: "entry.1188611077",
  police: "entry.1555105834"
};
const STAGE_LIMITS = [20000, 90000, 12000, 15000, 45000, 20000];

const els = {
  dropCard: document.getElementById("dropCard"),
  drop: document.getElementById("drop"),
  file: document.getElementById("file"),
  originalCard: document.getElementById("originalCard"),
  originalImg: document.getElementById("originalImg"),
  overlayCard: document.getElementById("overlayCard"),
  overlayWrap: document.getElementById("overlayWrap"),
  overlayImg: document.getElementById("overlayImg"),
  overlayScanner: document.getElementById("overlayScanner"),
  status: document.getElementById("status"),
  bar: document.getElementById("bar"),
  results: document.getElementById("results"),
  redirectNote: document.getElementById("redirectNote"),
  stageTimes: document.getElementById("stageTimes"),
  ms: [...document.querySelectorAll(".milestones .chip")],
  modalBackdrop: document.getElementById("modalBackdrop"),
  modalCancel: document.getElementById("modalCancel"),
  modalReset: document.getElementById("modalReset"),
  timeoutBackdrop: document.getElementById("timeoutBackdrop"),
  timeoutRetry: document.getElementById("timeoutRetry"),
  timeoutClose: document.getElementById("timeoutClose"),
  timeoutTitle: document.getElementById("timeoutTitle"),
  btnReset: document.getElementById("btnReset"),
  cdnPill: document.getElementById("cdnPill")
};

const state = {
  activeRun: 0,
  croppedUrl: "",
  outside: false,
  timedOut: false,
  data: { date: "", time: "", lat: "", lon: "", address: "", WARD: "", BEAT_NO: "", PS_NAME: "" },
  gjIndex: { wards: null, beats: null, police: null },
  stageStart: Array(6).fill(null),
  stageElapsed: Array(6).fill(0),
  stageTimeouts: Array(6).fill(null),
  stageTicker: null,
  countdownTimer: null
};

/* =========================
   UI helpers
   ========================= */
function setStatus(m, c) {
  els.status.className = "status " + (c || "");
  els.status.textContent = m;
}

function kvRow(id, label, value) {
  let row = document.getElementById(id);
  if (!row) {
    row = document.createElement("div");
    row.className = "kv";
    row.id = id;
    row.innerHTML = `<div class="k">${label}</div><div class="v">—</div>`;
    els.results.appendChild(row);
  }
  if (value !== undefined && value !== null) {
    row.querySelector(".v").textContent = String(value || "—");
  }
}

function render() {
  const d = state.data;
  kvRow("row-date", "Date", d.date);
  kvRow("row-time", "Time", d.time);
  kvRow("row-lat", "Latitude", d.lat);
  kvRow("row-lon", "Longitude", d.lon);
  kvRow("row-addr", "Address", d.address);
  kvRow("row-ward", "Ward", d.WARD);
  kvRow("row-beat", "Beat No.", d.BEAT_NO);
  kvRow("row-ps", "Police Station", d.PS_NAME);
}

function buildPrefillURL() {
  const p = new URLSearchParams({
    [ENTRY.date]: state.data.date || "",
    [ENTRY.time]: state.data.time || "",
    [ENTRY.lon]: state.data.lon || "",
    [ENTRY.lat]: state.data.lat || "",
    [ENTRY.ward]: state.data.WARD || "",
    [ENTRY.beat]: state.data.BEAT_NO || "",
    [ENTRY.address]: state.data.address || "",
    [ENTRY.police]: state.data.PS_NAME || "",
    usp: "pp_url"
  });
  return `https://docs.google.com/forms/d/e/${FORM_ID}/viewform?${p.toString()}`;
}

function applyChips(i) {
  els.ms.forEach((chip, idx) => {
    chip.classList.remove("pending", "active", "done");
    if (idx < i) chip.classList.add("done");
    else if (idx === i) chip.classList.add("active");
    else chip.classList.add("pending");
  });
  els.bar.style.width = Math.max(0, Math.min(100, (i / 5) * 100)) + "%";
}

function fmt(ms) {
  return ms > 0 && isFinite(ms) ? (ms / 1000).toFixed(1) + "s" : "0.0s";
}

function currentStageIndex() {
  for (let i = 0; i < 6; i++) {
    if (state.stageStart[i] !== null && state.stageElapsed[i] === 0) return i;
  }
  for (let i = 5; i >= 0; i--) if (state.stageElapsed[i] > 0) return Math.min(i + 1, 5);
  return 0;
}

function updateTimes() {
  const names = ["Upload", "OCR", "Parse", "GeoJSON", "Review", "Redirect"];
  els.stageTimes.textContent = names
    .map((n, i) => {
      const run = state.stageStart[i] !== null && i === currentStageIndex();
      const v = run ? Date.now() - state.stageStart[i] : state.stageElapsed[i];
      return `${n} — ${fmt(v)}`;
    })
    .join(" • ");
}

function startStage(i) {
  if (state.timedOut) return;
  for (let k = 0; k < i; k++) {
    if (state.stageStart[k] !== null && state.stageElapsed[k] === 0) endStage(k);
  }
  state.stageStart[i] = Date.now();
  applyChips(i);
  if (!state.stageTicker) state.stageTicker = setInterval(updateTimes, 200);
  clearTimeout(state.stageTimeouts[i]);
  state.stageTimeouts[i] = setTimeout(() => onStageTimeout(i), STAGE_LIMITS[i]);
}

function endStage(i) {
  if (state.stageStart[i] !== null && state.stageElapsed[i] === 0) {
    state.stageElapsed[i] = Date.now() - state.stageStart[i];
  }
  clearTimeout(state.stageTimeouts[i]);
  updateTimes();
}

function onStageTimeout(i) {
  if (state.stageElapsed[i] > 0 || state.timedOut) return;
  state.timedOut = true;
  els.timeoutBackdrop.style.display = "flex";
  els.timeoutTitle.textContent = `Stage Timed Out — ${["Upload", "OCR", "Parse", "GeoJSON", "Review", "Redirect"][i]}`;
}

/* =========================
   GeoJSON (bbox-indexed + nearest fallback)
   ========================= */
function indexFC(fc) {
  const items = (fc.features || []).map((f) => ({ f, b: turf.bbox(f) }));
  return { items };
}

function inBBox(pt, bb) {
  return pt[0] >= bb[0] && pt[0] <= bb[2] && pt[1] >= bb[1] && pt[1] <= bb[3];
}

function firstProp(props, keys) {
  for (const k of keys) {
    const v = props?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function pipIndexed(idx, pt, keys) {
  if (!idx?.items) return "";
  const point = turf.point(pt);
  for (const { f, b } of idx.items) {
    if (!inBBox(pt, b)) continue;
    if (turf.booleanPointInPolygon(point, f)) return firstProp(f.properties, keys);
  }
  return "";
}

function nearestIndexed(idx, pt, keys) {
  if (!idx?.items) return { value: "", meters: Infinity };
  const point = turf.point(pt);
  let best = Infinity;
  let val = "";
  for (const { f } of idx.items) {
    const c = turf.center(f);
    const d = turf.distance(point, c, { units: "meters" });
    if (d < best) {
      best = d;
      val = firstProp(f.properties, keys);
    }
  }
  return { value: val, meters: best };
}

async function loadGeo() {
  const [w, b, p] = await Promise.all([
    fetch("./data/wards.geojson").then((r) => r.json()),
    fetch("./data/beats.geojson").then((r) => r.json()),
    fetch("./data/police_jurisdiction.geojson").then((r) => r.json())
  ]);
  state.gjIndex.wards = indexFC(w);
  state.gjIndex.beats = indexFC(b);
  state.gjIndex.police = indexFC(p);
}

function lookup(lat, lon) {
  const pt = [parseFloat(lon), parseFloat(lat)];
  const WARD_KEYS = ["WARD", "Ward", "ward", "WARD_NO", "Ward_No", "WARDNAME", "WardName"];
  const BEAT_KEYS = ["BEAT_NO", "Beat_No", "BEAT", "Beat", "BEATNO", "BeatNo", "beat_no", "Beat_Number", "BeatNumber"];
  const PS_KEYS = ["PS_NAME", "PS", "Police_Station", "PoliceStation", "ps_name", "PSName", "PS_Name"];

  const ward = pipIndexed(state.gjIndex.wards, pt, WARD_KEYS);
  let beat = pipIndexed(state.gjIndex.beats, pt, BEAT_KEYS);
  let ps = pipIndexed(state.gjIndex.police, pt, PS_KEYS);

  if (!beat) {
    const near = nearestIndexed(state.gjIndex.beats, pt, BEAT_KEYS);
    if (near.value && near.meters <= 250) beat = near.value;
  }
  if (!ps) {
    const nps = nearestIndexed(state.gjIndex.police, pt, PS_KEYS);
    if (nps.value && nps.meters <= 400) ps = nps.value;
  }

  return { WARD: ward, BEAT_NO: beat, PS_NAME: ps };
}

/* =========================
   Image crop for OCR
   ========================= */
async function cropOverlay(dataURL) {
  const blob = await (await fetch(dataURL)).blob();
  const bmp = await createImageBitmap(blob);

  const W = bmp.width;
  const H = bmp.height;

  const cropY = Math.round(H * 0.62);
  const cropH = Math.max(120, Math.round(H * 0.38));

  const targetW = 1200;
  const scale = Math.min(1, targetW / W);
  const outW = Math.round(W * scale);
  const outH = Math.round(cropH * scale);

  const c = document.createElement("canvas");
  c.width = outW;
  c.height = outH;

  const ctx = c.getContext("2d");
  ctx.drawImage(bmp, 0, cropY, W, cropH, 0, 0, outW, outH);

  const img = ctx.getImageData(0, 0, outW, outH);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const v = y > 175 ? 255 : y < 55 ? 0 : y;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);

  return c.toDataURL("image/png");
}

/* =========================
   Parsing
   ========================= */
function normalizeDigits(s) {
  return String(s || "")
    .replace(/(\d)\s*[:·•]\s*(\d)/g, "$1.$2")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[°]/g, "")
    .replace(/O/g, "0");
}

function extractCoords(rawText) {
  const t = normalizeDigits(rawText);
  let lat = "";
  let lon = "";

  let m = t.match(/Lat(?:itude)?\s*[:=]?\s*([+-]?\d{1,2}[.:,]\d{2,})/i);
  if (m) lat = m[1].replace(/[:,]/g, ".");

  m = t.match(/Lon(?:g|gitude)?\s*[:=]?\s*([+-]?\d{1,3}[.:,]\d{2,})/i);
  if (m) lon = m[1].replace(/[:,]/g, ".");

  if (!(lat && lon)) {
    m = t.match(/([+-]?\d{1,2}[.:,]\d{2,})[^\d+-]{0,30}([+-]?\d{1,3}[.:,]\d{2,})/);
    if (m) {
      lat = lat || m[1].replace(/[:,]/g, ".");
      lon = lon || m[2].replace(/[:,]/g, ".");
    }
  }

  if (!(lat && lon)) {
    const nums = [...t.matchAll(/[+-]?\d{1,3}[.:,]\d{2,}/g)].map((x) => x[0].replace(/[:,]/g, "."));
    if (nums.length >= 2) {
      lat = lat || nums[0];
      lon = lon || nums[1];
    }
  }

  const f = (s) => {
    const v = parseFloat(s);
    return isFinite(v) ? v : null;
  };
  const la = f(lat);
  const lo = f(lon);

  return {
    lat: la != null && la >= -90 && la <= 90 ? String(la) : "",
    lon: lo != null && lo >= -180 && lo <= 180 ? String(lo) : ""
  };
}

function parseAll(text) {
  const raw = String(text || "")
    .replace(/\u00A0|\u2009|\u2002|\u2003/g, " ")
    .replace(/[|·•]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const linesAll = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);

  const isNoise = (s) =>
    /(?:gps\s*map\s*camera|google|wind|humidity|pressure|temperature|km\/h|hpa|°c|\bjoey\b)/i.test(s);
  const looksTime = (s) => /\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/i.test(s);
  const looksDate = (s) => /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/.test(s);
  const isLatLonLine = (s) => /\bLat|Lon(?:g|gitude)\b/i.test(s);

  const { lat, lon } = extractCoords(raw);

  let date = "";
  let time = "";
  const toIsoDate = (s) => {
    const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (!m) return "";
    let [_, d, mo, y] = m;
    if (y.length === 2) y = +y < 50 ? "20" + y : "19" + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  };
  const to24h = (s) => {
    s = s.trim().toUpperCase();
    const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
    if (!m) return "";
    let h = +m[1];
    const mi = m[2];
    const ap = m[3] || "";
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${mi}`;
  };
  const dt = raw.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}).{0,6}(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
  if (dt) {
    date = toIsoDate(dt[1]);
    time = to24h(dt[2]);
  }

  const looksAddressy = (s) =>
    /\p{L}/u.test(s) &&
    !isNoise(s) &&
    !looksDate(s) &&
    !looksTime(s) &&
    !isLatLonLine(s) &&
    (/,/.test(s) || s.split(/\s+/).filter((x) => x.length >= 3).length >= 3);

  let idxLat = linesAll.findIndex(isLatLonLine);
  if (idxLat < 0) idxLat = linesAll.length;

  const cand = [];
  for (let i = idxLat - 1; i >= 0 && cand.length < 3; i--) {
    const s = linesAll[i];
    if (looksAddressy(s)) cand.unshift(s);
    else if (cand.length) break;
  }

  let address = cand.length
    ? cand.join(", ")
    : linesAll.filter(looksAddressy).sort((a, b) => b.length - a.length)[0] || "";

  const pin = raw.match(/\b[1-9]\d{5}\b/);
  address = String(address)
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ", ")
    .replace(/,\s*,/g, ", ")
    .replace(/\s+i\b$/, "")
    .trim();
  if (pin && !address.includes(pin[0])) {
    address = address.replace(/(?:,\s*)?(India)\s*$/i, (m, $1) => `, ${pin[0]}, ${$1}`);
  }

  return { lat, lon, address, date, time };
}

/* =========================
   Redirect
   ========================= */
function startRedirectCountdown(sec) {
  clearInterval(state.countdownTimer);
  els.redirectNote.style.display = "block";

  let left = sec;
  els.redirectNote.innerHTML =
    `All set. Redirecting to Google Form in <span class="countdown">${left}s</span>… ` +
    `<a href="#" id="cancelRedirect">Cancel</a>`;

  state.countdownTimer = setInterval(() => {
    left -= 1;
    const span = document.querySelector(".countdown");
    if (span) span.textContent = left + "s";
    if (left <= 0) {
      clearInterval(state.countdownTimer);
      window.location.href = buildPrefillURL();
    }
  }, 1000);

  els.redirectNote.onclick = (e) => {
    if (e.target && e.target.id === "cancelRedirect") {
      e.preventDefault();
      clearInterval(state.countdownTimer);
      els.redirectNote.innerHTML = `<button id="openFormNow" class="btn">Open Google Form now</button>`;
      document.getElementById("openFormNow").onclick = () => (window.location.href = buildPrefillURL());
    }
  };
}

/* =========================
   Events
   ========================= */
els.btnReset.addEventListener("click", () => location.reload());
els.modalCancel.addEventListener("click", () => (els.modalBackdrop.style.display = "none"));
els.modalReset.addEventListener("click", () => location.reload());
els.timeoutRetry.addEventListener("click", () => location.reload());
els.timeoutClose.addEventListener("click", () => (els.timeoutBackdrop.style.display = "none"));

els.drop.addEventListener("click", () => els.file.click());
els.drop.addEventListener("dragover", (e) => { e.preventDefault(); els.drop.style.borderColor = "#9ec5ff"; });
els.drop.addEventListener("dragleave", () => { els.drop.style.borderColor = "#cfe0f3"; });
els.drop.addEventListener("drop", (e) => {
  e.preventDefault();
  els.drop.style.borderColor = "#cfe0f3";
  const f = e.dataTransfer.files?.[0];
  if (f) runPipeline(f);
});
els.file.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f) runPipeline(f);
});

/* =========================
   Pipeline
   ========================= */
async function runPipeline(file) {
  const myRun = ++state.activeRun;

  els.dropCard.style.display = "none";
  els.originalCard.style.display = "block";
  els.overlayCard.style.display = "block";
  els.overlayWrap.style.display = "block";

  // Stage 0: Upload
  startStage(0);
  setStatus("Image loading…", "ok");

  const reader = new FileReader();
  reader.onload = async () => {
    if (myRun !== state.activeRun) return;

    const dataUrl = reader.result;
    els.originalImg.src = dataUrl;

    setStatus("Optimising image…", "warn");
    const cropped = await cropOverlay(dataUrl);
    if (myRun !== state.activeRun) return;
    endStage(0);

    // Stage 1: OCR (v5 preferred; fallback to v4)
    startStage(1);
    setStatus("Running OCR…", "warn");
    state.croppedUrl = cropped;
    els.overlayImg.src = state.croppedUrl;
    els.overlayScanner.style.display = "block";

    async function ocrV5() {
      const { data: { text } } = await Tesseract.recognize(state.croppedUrl, "eng+hin");
      return text;
    }
    async function ocrV4() {
      if (!window.Tesseract?.recognize) {
        await addScript("https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js");
      }
      const { data: { text } } = await Tesseract.recognize(state.croppedUrl, "eng+hin");
      return text;
    }

    let text = "";
    try {
      text = await ocrV5();
    } catch (e) {
      console.warn("v5 OCR failed, fallback to v4", e);
      try {
        text = await ocrV4();
      } catch (e2) {
        els.overlayScanner.style.display = "none";
        setStatus("OCR failed in both engines. Please Retry.", "err");
        onStageTimeout(1);
        return;
      }
    }

    els.overlayScanner.style.display = "none";
    endStage(1);

    // Stage 2: Parse
    startStage(2);
    setStatus("Parsing extracted text…", "warn");
    Object.assign(state.data, parseAll(text));
    render();
    endStage(2);

    // Stage 3: GeoJSON
    startStage(3);
    setStatus("GeoJSON lookup…", "warn");
    state.outside = false;

    if (state.data.lat && state.data.lon) {
      const g = lookup(state.data.lat, state.data.lon);
      Object.assign(state.data, g);
      render();
      if (!g.WARD) state.outside = true;
    } else {
      state.outside = true;
    }
    endStage(3);

    if (state.outside) {
      setStatus("Outside MCGM Boundaries — Not allowed.", "err");
      els.modalBackdrop.style.display = "flex";
      return;
    }

    // Stage 4: Review
    startStage(4);
    setStatus("Ready. Review the results.", "ok");
    endStage(4);

    // Stage 5: Redirect
    startStage(5);
    startRedirectCountdown(5);
  };

  reader.readAsDataURL(file);
}

/* =========================
   Boot
   ========================= */
(async () => {
  // Hide modals on boot
  els.modalBackdrop.style.display = "none";
  els.timeoutBackdrop.style.display = "none";

  await loadOCR();

  try {
    await loadGeo();
    setStatus("Maps loaded. Upload an image to begin.", "ok");
  } catch (e) {
    console.error(e);
    setStatus("Could not load GeoJSON (check /data paths).", "err");
  }

  updateTimes();
  const vEl = document.getElementById("appVersion");
  if (vEl) vEl.textContent = "v2025.08.17";
})();
