import sys, json
from urllib.parse import urlencode, quote_plus
from ocr import image_to_text
from parse import extract_all
from geo import GeoIndex

# --- Google Form constants (FINAL) ---
FORM_ID = "1FAIpQLSeo-xlOSxvG0IwtO5MkKaTJZNJkgTsmgZUw-FBsntFlNdRnCw"

# Your fields by entry ID, following your 0..5 mapping
ENTRY = {
    "date":    "entry.1911996449",   # Date
    "time":    "entry.1421115881",   # Time

    # 0..5 mapping you gave:
    # 0 = Long  -> goes to 113122688
    # 1 = Lat   -> goes to 419288992
    # 2 = Ward  -> goes to 1625337207
    # 3 = Beat  -> goes to 1058310891
    # 4 = Addr  -> goes to 1188611077
    # 5 = PS    -> goes to 1555105834
    "lon":     "entry.113122688",
    "lat":     "entry.419288992",
    "ward":    "entry.1625337207",
    "beat":    "entry.1058310891",
    "address": "entry.1188611077",
    "police":  "entry.1555105834",
}

WARDS_GJ  = "data/wards.geojson"
BEATS_GJ  = "data/beats.geojson"
POLICE_GJ = "data/police_jurisdiction.geojson"
# --------------------------------------

def build_prefill(data: dict) -> str:
    """
    data expects keys: date, time, lon, lat, address, WARD, BEAT_NO, PS_NAME
    (the last three come from GeoJSON lookups)
    """
    params = {
        ENTRY["date"]:    data.get("date", ""),
        ENTRY["time"]:    data.get("time", ""),
        ENTRY["lon"]:     data.get("lon", ""),           # 0
        ENTRY["lat"]:     data.get("lat", ""),           # 1
        ENTRY["ward"]:    data.get("WARD", ""),          # 2
        ENTRY["beat"]:    data.get("BEAT_NO", ""),       # 3
        ENTRY["address"]: data.get("address", ""),       # 4
        ENTRY["police"]:  data.get("PS_NAME", ""),       # 5
        "usp": "pp_url",
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
