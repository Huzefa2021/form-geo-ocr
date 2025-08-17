# 📌 Abandoned Vehicles OCR + GeoJSON → Google Form

This repository hosts a **browser-based helper portal** for MCGM field marshals.
It allows uploading a **GPS Map Camera photo**, automatically extracting details using OCR, matching location against GeoJSON boundaries, and redirecting to a prefilled **Google Form**.

---

## 🚀 Features

* 📤 **Drag & Drop Upload** or choose file from device
* 🔎 **Live OCR** (date, time, latitude, longitude, address from image text)
* 🌍 **GeoJSON Lookup**:

  * WARD → from `wards.geojson`
  * BEAT_NO → from `beats.geojson`
  * PS_NAME → from `police_jurisdiction.geojson`
* 📊 **Progress Milestones** with animated scanner effect for visual appeal
* 📝 **Review Panel**: all OCR + GeoJSON data displayed before redirect
* 🔗 **One-click redirect** to Google Form with fields prefilled

---

## 📂 Repository Structure

```
.
├─ index.html                      # Main helper page (UI + OCR + GeoJSON + prefill)
├─ README.md                       # Documentation (this file)
├─ /data/
│  ├─ wards.geojson                # Polygon layer with WARD property
│  ├─ beats.geojson                # Polygon layer with BEAT_NO property
│  └─ police_jurisdiction.geojson  # Polygon layer with PS_NAME property
```

---

## ⚙️ Setup Instructions

1. **Clone this repo**

   ```bash
   git clone https://github.com/<your-username>/<your-repo>.git
   cd <your-repo>
   ```

2. **Prepare GeoJSON files**

   * Place your spatial boundary files in `/data/`
   * Ensure properties exist:

     * `WARD` in `wards.geojson`
     * `BEAT_NO` in `beats.geojson`
     * `PS_NAME` in `police_jurisdiction.geojson`

3. **Configure Google Form**

   * Open your Google Form
   * Copy entry IDs (`entry.xxxxx`) for each field
   * Update the mapping in `index.html` (already set for: Date, Time, Lat, Lon, Ward, Beat, Address, Police)

4. **Host the page**

   * Easiest: enable **GitHub Pages** in repo settings (or use the included workflow under `.github/workflows/pages.yml`)
   * Your app will be accessible at:

     ```
     https://<your-username>.github.io/<your-repo>/
     ```

---

## 🧑‍💻 Usage (For Marshals)

1. Open the **helper portal link** on your mobile.
2. **Upload the photo** (drag & drop or choose file).
3. Wait for the **progress bar** to complete.
4. Review extracted details:

   * Date & Time
   * Latitude & Longitude
   * Address
   * Ward, Beat, Police Station
5. Click **Continue to Form** → auto-redirects to the Google Form with fields prefilled.
6. Submit form as usual.

---

## 🖼️ Preview

* **Header & Footer** styled like the official MCGM website
* **Scanner overlay** animation on uploaded image
* **Step chips**: Upload → OCR → Parse → GeoJSON → Review → Redirect

---

## 🛠️ Tech Stack

* **HTML + CSS + JavaScript** (pure browser app, no backend)
* [Tesseract.js](https://tesseract.projectnaptha.com/) → OCR
* [Turf.js](https://turfjs.org/) → GeoJSON point-in-polygon
* **Google Forms Prefill API** → auto-redirect

---

## ⚠️ Notes

* Works best with **GPS Map Camera** format photos (date/time/coords printed clearly).
* All processing is done in the **browser**. No server storage, no external backend.
* Ensure good image clarity for best OCR accuracy.
* GeoJSON must be in **EPSG:4326 (lon/lat)**.

---

## 📞 Support

* **Maintainer**: Huzefa Fakhruddin
* **Organization**: Multifaceted Company
* For issues: open a GitHub Issue or contact [ptradingmumbai@gmail.com](mailto:ptradingmumbai@gmail.com)
