import sys, json
from urllib.parse import urlencode, quote_plus
from ocr import image_to_text
from parse import extract_all
from geo import GeoIndex

# -------- EDIT THESE 4–8 LINES --------
FORM_ID = "1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw"  # your Form ID

ENTRY = {
    "date":    "entry.1911996449",   # ✅ known from your form
    "time":    "entry.1421115881",   # ✅ known
    "lat":     "entry.113122688",    # ✅ known
    "lon":     "entry.419288992",    # ✅ known
    "address": "entry.1625337207",   # ⬅️ REPLACE if your address has a different entry id
    "ward":    "entry.WARD_PLACEHOLDER",   # ⬅️ REPLACE with actual entry id
    "beat":    "entry.BEAT_PLACEHOLDER",   # ⬅️ REPLACE with actual entry id
    "police":  "entry.PS_PLACEHOLDER"      # ⬅️ REPLACE with actual entry id
}

WARDS_GJ  = "data/wards.geojson"
BEATS_GJ  = "data/beats.geojson"
POLICE_GJ = "data/police_jurisdiction.geojson"
# --------------------------------------

def build_prefill(data: dict) -> str:
    params = {
        ENTRY["date"]:    data.get("date",""),
        ENTRY["time"]:    data.get("time",""),
        ENTRY["lat"]:     data.get("lat",""),
        ENTRY["lon"]:     data.get("lon",""),
        ENTRY["address"]: data.get("address",""),
        ENTRY["ward"]:    data.get("WARD",""),
        ENTRY["beat"]:    data.get("BEAT_NO",""),
        ENTRY["police"]:  data.get("PS_NAME",""),
        "usp": "pp_url"
    }
    return f"https://docs.google.com/forms/d/e/{FORM_ID}/viewform?{urlencode(params, quote_via=quote_plus)}"

def run(source_image: str):
    # 1) OCR the image
    ocr_text = image_to_text(source_image)
    fields   = extract_all(ocr_text)

    # 2) Geo lookups (only if coords found)
    geo = {"WARD":"", "BEAT_NO":"", "PS_NAME":""}
    if fields.get("lat") and fields.get("lon"):
        gi = GeoIndex(WARDS_GJ, BEATS_GJ, POLICE_GJ)
        geo = gi.lookup(float(fields["lat"]), float(fields["lon"]))

    # 3) Prefill URL
    payload = {**fields, **geo}
    link = build_prefill(payload)

    print(json.dumps({
        "extracted": fields,
        "geo": geo,
        "prefill_url": link
    }, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python src/main.py <image path or URL>")
    run(sys.argv[1])
