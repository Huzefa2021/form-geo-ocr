# 🚗 Abandoned Vehicles – OCR + GeoJSON Mapper (MCGM Marshal Upload)

This project provides a **browser-based application** for field marshals to upload GPS-tagged photographs of abandoned vehicles.  
It performs **OCR (Optical Character Recognition)** on the HUD (Heads-Up Display) of photos, parses the address/coordinates/date/time,  
matches the coordinates against **BMC Wards, Beats, and Police Station boundaries (GeoJSON)**, and then **auto-prefills a Google Form**.

---

## ✨ Features & Flow

1. **Upload Image**
   - Drag-and-drop or file picker accepts **JPG/PNG**.
   - Both original and cropped HUD section previewed.

2. **Crop HUD**
   - Static crop box defined (covers GPS HUD overlay).
   - Small buffer added for consistent results across devices.

3. **OCR (Tesseract.js v5)**
   - Multi-language recognition (`eng+hin+mar`).
   - Preprocessing (contrast, threshold) improves recognition.
   - Raw OCR text logged to on-screen console.

4. **Parse HUD Data**
   - **Line 1 ignored** (usually branding from GPS Camera app).
   - Middle lines → address (1–3 lines).
   - Second-last line → Latitude & Longitude.
   - Last line → Date & Time (normalized to `YYYY-MM-DD` and `HH:mm` for Google Form).
   - Garbage entries automatically removed.

5. **GeoJSON Lookup**
   - Coordinates matched against:
     - `wards.geojson`
     - `beats.geojson`
     - `police_jurisdiction.geojson`
   - Returns Ward ID, Beat Number, and Police Station name.
   - Bounding-box check precomputed for performance.
   - Status indicator shows **Loaded / Error**.

6. **Console Section**
   - Shows:
     - Raw OCR Text
     - Parsed Fields (address, lat/lon, date/time)
     - GeoJSON match results
     - Redirect URL preview
   - Timestamped logs for each step.

7. **Status Pills**
   - Each stage (Upload → OCR → Parse → Geo → Review → Redirect) updates live.
   - Flashing pill indicates active stage.
   - Final redirect pill clickable if auto-redirect blocked.

8. **Google Form Prefill**
   - Fields mapped to Google Form entries.
   - Auto-redirects to form with data prefilled.
   - If blocked, manual redirect button provided.

---

## 🛠️ Technical Details

- **Frontend only** (no backend, no cloud storage).
- **Languages:** HTML5, CSS3, JavaScript (ES6+).
- **OCR Engine:** [Tesseract.js v5](https://tesseract.projectnaptha.com/).
- **Mapping:** GeoJSON (wards, beats, police jurisdictions).
- **Deployment:** GitHub Pages / Railway / any static hosting.
- **Browser Support:** Optimized for **mobile devices** (field use).

---

## 📂 Project Structure

```

📦 abandoned-vehicles-ocr
┣ 📂 data
┃ ┣ wards.geojson
┃ ┣ beats.geojson
┃ ┗ police\_jurisdiction.geojson
┣ 📜 index.html
┣ 📜 styles.css
┣ 📜 app.js
┗ 📜 README.md

```

- `index.html` → App layout, header/footer, drag-drop zone, preview, console.
- `styles.css` → Material-style theme, golden MCGM branding, responsive mobile view.
- `app.js` → Core logic (OCR, parsing, GeoJSON lookup, redirect).
- `data/*.geojson` → Ward/Beat/Police boundaries.

---

## 🚀 Deployment

### GitHub Pages
1. Push repo to GitHub.
2. Go to **Repo → Settings → Pages**.
3. Select branch: `main` → `/root`.
4. Add an empty file named `.nojekyll` in root.
   - Prevents GitHub Pages from ignoring `data/` folder.
5. Site will be live at:
```

https\://<username>.github.io/<repository-name>/

````

### Railway (Optional, for backend integrations)
- Already compatible with static hosting.
- Add `static.json` for custom routes if needed.

---

## 🔗 Google Form Integration

- Update **`FORM_BASE`** and **`ENTRY`** constants in `app.js` with your Google Form fields.
- Date format required: `YYYY-MM-DD`.
- Time format required: `HH:mm` (24-hr).

Example:
```js
url.searchParams.set(ENTRY.date, "2025-08-19");
url.searchParams.set(ENTRY.time, "14:35");
````

---

## 🧪 Example Flow

1. Marshal captures photo with **GPS Camera app**.
2. Uploads photo to app (mobile browser).
3. HUD cropped, OCR extracts text:

   ```
   Mumbai, Maharashtra, India
   Lat 19.066379° Long 72.864117°
   18/08/2025 03:09 PM GMT+05:30
   ```
4. Parser normalizes → `2025-08-18` + `15:09`.
5. GeoJSON lookup → Ward H/East, Beat 12, Vakola PS.
6. App redirects to Google Form with all fields filled.

---

## 📱 Mobile-First UI/UX

* Sticky **header + footer** (MCGM + Crescendo logos with golden glow).
* Responsive text sizing (clamp units).
* Material shadows/glows on pillboxes and indicators.
* Console/log section under image previews.
* Optimized for **phone screens** (primary users).

---

## 👨‍💼 Administration

* **Municipal Corporation of Greater Mumbai (MCGM)**
* **Crescendo Innovative Solutions**
* Admin: **Huzefa Kathawala**
  📧 [huzefa.k@crescendoits.com](mailto:huzefa.k@crescendoits.com)

---

## 📌 Versioning

* Build ID format: `vYYYY.MM.DD.P.x`
  Example: `v2025.08.19.P.2.2`

---

## ⚠️ Notes

* Ensure **GeoJSON files** are valid and present in `/data/`.
* OCR quality depends on photo clarity. Blurry/overexposed HUD may fail.
* Works offline after first load (assets cached by browser).
* No data is stored outside Zoho/Google Form — app is stateless.
