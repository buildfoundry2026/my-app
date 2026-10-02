"""QuoteCanvas backend API tests (pytest). Covers health, OCR, and quotes CRUD."""
import base64
import io
import os
import pytest
import requests
from PIL import Image, ImageDraw, ImageFont

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
           "https://quote-canvas-15.preview.emergentagent.com"
API = f"{BASE_URL}/api"

DEVICE_A = "TEST_device_a"
DEVICE_B = "TEST_device_b"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    yield s
    # cleanup: hard-delete via API (soft-delete sets deleted_at) - rely on soft delete only
    s.close()


# --- Image helpers ---
def _font(size=30):
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", size)
    except Exception:
        return ImageFont.load_default()


def _text_image_b64():
    img = Image.new("RGB", (900, 420), (245, 240, 230))
    d = ImageDraw.Draw(img)
    lines = [
        "It is a truth universally acknowledged,",
        "that a single man in possession of a good",
        "fortune, must be in want of a wife.",
    ]
    y = 60
    for line in lines:
        d.text((50, y), line, fill=(40, 37, 36), font=_font(30))
        y += 60
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def _no_text_image_b64():
    """A non-blank image with real visual features (shapes, gradient, noise) but no letters."""
    img = Image.new("RGB", (800, 600), (180, 190, 200))
    d = ImageDraw.Draw(img)
    # gradient-like fill
    for y in range(600):
        shade = 180 + int(60 * (y / 600))
        d.line([(0, y), (800, y)], fill=(shade, 200 - y // 10, 150))
    # geometric shapes
    d.ellipse([120, 120, 420, 420], fill=(80, 120, 200), outline=(20, 30, 60), width=4)
    d.rectangle([450, 200, 720, 480], fill=(220, 100, 90), outline=(60, 20, 20), width=4)
    d.polygon([(400, 60), (600, 60), (500, 180)], fill=(240, 220, 90))
    # add some noise strokes
    import random
    random.seed(7)
    for _ in range(400):
        x1, y1 = random.randint(0, 799), random.randint(0, 599)
        x2, y2 = x1 + random.randint(-15, 15), y1 + random.randint(-15, 15)
        d.line([(x1, y1), (x2, y2)], fill=(random.randint(0, 255),) * 3, width=1)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


# --- Health ---
class TestHealth:
    def test_root(self, session):
        r = session.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("message") == "QuoteCanvas API"


# --- OCR ---
class TestOcr:
    def test_ocr_with_readable_text(self, session):
        r = session.post(f"{API}/ocr", json={"image_base64": _text_image_b64()}, timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True, body
        assert body["word_count"] >= 3
        assert len(body["text"]) > 0

    def test_ocr_with_no_text(self, session):
        r = session.post(f"{API}/ocr", json={"image_base64": _no_text_image_b64()}, timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is False, body
        assert "Text unclear" in (body.get("message") or "")

    def test_ocr_invalid_short_base64(self, session):
        r = session.post(f"{API}/ocr", json={"image_base64": "abc123"}, timeout=30)
        assert r.status_code == 400


# --- Quotes CRUD ---
class TestQuotes:
    created_ids: list = []

    def test_create_quote(self, session):
        payload = {
            "device_id": DEVICE_A,
            "raw_text": "TEST_The quick brown fox jumps over the lazy dog.",
            "book_title": "TEST_Book",
            "author": "TEST_Author",
            "template_used": "minimalist-dark",
            "aspect_ratio": "4:5",
        }
        r = session.post(f"{API}/quotes", json=payload)
        assert r.status_code == 200, r.text
        q = r.json()
        assert q.get("id") and isinstance(q["id"], str)
        assert q["device_id"] == DEVICE_A
        assert q["raw_text"] == payload["raw_text"]
        assert q.get("deleted_at") is None
        TestQuotes.created_ids.append(q["id"])

    def test_create_second_quote_newer(self, session):
        payload = {
            "device_id": DEVICE_A,
            "raw_text": "TEST_Second quote text.",
            "template_used": "warm-serif",
            "aspect_ratio": "9:16",
        }
        r = session.post(f"{API}/quotes", json=payload)
        assert r.status_code == 200
        TestQuotes.created_ids.append(r.json()["id"])

    def test_create_other_device_quote_is_isolated(self, session):
        r = session.post(f"{API}/quotes", json={
            "device_id": DEVICE_B,
            "raw_text": "TEST_other device",
            "template_used": "minimalist-dark",
            "aspect_ratio": "1:1",
        })
        assert r.status_code == 200
        TestQuotes.created_ids.append(r.json()["id"])

    def test_list_quotes_scoped_and_sorted(self, session):
        r = session.get(f"{API}/quotes", params={"device_id": DEVICE_A})
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list)
        assert all(q["device_id"] == DEVICE_A for q in items)
        # newest first
        if len(items) >= 2:
            assert items[0]["created_at"] >= items[1]["created_at"]
        ids = [q["id"] for q in items]
        # at least the two created for DEVICE_A
        for qid in TestQuotes.created_ids[:2]:
            assert qid in ids

    def test_get_quote(self, session):
        qid = TestQuotes.created_ids[0]
        r = session.get(f"{API}/quotes/{qid}")
        assert r.status_code == 200
        assert r.json()["id"] == qid

    def test_patch_quote(self, session):
        qid = TestQuotes.created_ids[0]
        r = session.patch(f"{API}/quotes/{qid}", json={"book_title": "TEST_Updated"})
        assert r.status_code == 200
        assert r.json()["book_title"] == "TEST_Updated"
        # verify via GET
        g = session.get(f"{API}/quotes/{qid}")
        assert g.json()["book_title"] == "TEST_Updated"

    def test_raw_text_over_limit_returns_422(self, session):
        r = session.post(f"{API}/quotes", json={
            "device_id": DEVICE_A,
            "raw_text": "x" * 501,
            "template_used": "minimalist-dark",
            "aspect_ratio": "4:5",
        })
        assert r.status_code == 422

    def test_invalid_id_returns_404(self, session):
        for path in ["/quotes/not-an-id", "/quotes/" + "a" * 24]:
            r = session.get(f"{API}{path}")
            assert r.status_code == 404

    def test_delete_quote_soft_delete(self, session):
        qid = TestQuotes.created_ids[0]
        r = session.delete(f"{API}/quotes/{qid}")
        assert r.status_code == 200
        assert r.json().get("ok") is True
        # should be gone from list
        lst = session.get(f"{API}/quotes", params={"device_id": DEVICE_A}).json()
        assert qid not in [q["id"] for q in lst]
        # and GET returns 404
        g = session.get(f"{API}/quotes/{qid}")
        assert g.status_code == 404

    def test_delete_nonexistent_returns_404(self, session):
        r = session.delete(f"{API}/quotes/{'b' * 24}")
        assert r.status_code == 404

    @classmethod
    def teardown_class(cls):
        # cleanup remaining
        import requests as _r
        for qid in cls.created_ids:
            try:
                _r.delete(f"{API}/quotes/{qid}", timeout=10)
            except Exception:
                pass
