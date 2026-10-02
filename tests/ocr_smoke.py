import base64, io, requests
from PIL import Image, ImageDraw, ImageFont
img = Image.new("RGB", (900, 420), (245, 240, 230))
d = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 30)
except Exception:
    font = ImageFont.load_default()
lines = ["It is a truth universally acknowledged,", "that a single man in possession of a good", "fortune, must be in want of a wife."]
y = 60
for l in lines:
    d.text((50, y), l, fill=(40, 37, 36), font=font)
    y += 60
buf = io.BytesIO(); img.save(buf, "JPEG", quality=90)
b64 = base64.b64encode(buf.getvalue()).decode()
r = requests.post("http://localhost:8001/api/ocr", json={"image_base64": b64}, timeout=90)
print(r.status_code, r.json())
