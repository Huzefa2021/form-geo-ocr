import re

# Patterns tailored for your GPS Map Camera overlay
_LATLON = re.compile(
    r'Lat(?:itude)?\s*[:=]?\s*([+-]?\d{1,2}\.\d+)[^\d\-+]+Long(?:itude)?\s*[:=]?\s*([+-]?\d{1,3}\.\d+)',
    re.IGNORECASE
)
_DT = re.compile(r'(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)', re.IGNORECASE)
_ADDR = re.compile(r'([A-Za-z0-9 .,\-()]+,\s*[A-Za-z .]+,\s*India)', re.IGNORECASE)

def extract_all(ocr_text: str):
    out = {"date":"", "time":"", "lat":"", "lon":"", "address":""}

    m = _LATLON.search(ocr_text)
    if m:
        out["lat"], out["lon"] = m.group(1), m.group(2)

    m = _DT.search(ocr_text)
    if m:
        out["date"], out["time"] = m.group(1), m.group(2).upper().replace("  ", " ")

    # take the last address-like match to avoid small captions
    addrs = _ADDR.findall(ocr_text)
    if addrs:
        out["address"] = addrs[-1].strip()

    # fallback decimal pair anywhere
    if not (out["lat"] and out["lon"]):
        m2 = re.findall(r'([+-]?\d{1,2}\.\d+)[,\s]+([+-]?\d{1,3}\.\d+)', ocr_text)
        if m2:
            out["lat"], out["lon"] = m2[0]

    return out
