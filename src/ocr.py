from PIL import Image
import pytesseract, io, requests

def image_to_text(source: str) -> str:
    """
    source can be a local repo path ('assets/pic.jpg') or http(s) URL.
    Returns raw OCR text.
    """
    if source.startswith("http"):
        r = requests.get(source, timeout=60)
        r.raise_for_status()
        img = Image.open(io.BytesIO(r.content)).convert("RGB")
    else:
        img = Image.open(source).convert("RGB")
    return pytesseract.image_to_string(img, config="--psm 6")
