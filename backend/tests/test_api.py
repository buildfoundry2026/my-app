"""QuoteCanvas backend tests (pytest). Covers auth gating, quotes CRUD with Bearer sessions, and OCR."""
import base64
import io
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFont
from pymongo import MongoClient

# Load backend env for Mongo seeding + frontend env for the public backend URL
load_dotenv(Path("/app/backend/.env"))
load_dotenv(Path("/app/frontend/.env"))

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set in /app/frontend/.env"
API = f"{BASE_URL}/api"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

# --- Mongo seeded fixtures ---
USER_A = {"user_id": "TEST_user_a", "email": "TEST_a@example.com", "name": "Alice", "picture": None,
          "created_at": datetime.now(timezone.utc).isoformat()}
USER_B = {"user_id": "TEST_user_b", "email": "TEST_b@example.com", "name": "Bob", "picture": None,
          "created_at": datetime.now(timezone.utc).isoformat()}
TOKEN_A = "TEST_token_alice_" + uuid.uuid4().hex[:8]
TOKEN_B = "TEST_token_bob_" + uuid.uuid4().hex[:8]
TOKEN_EXPIRED = "TEST_token_expired_" + uuid.uuid4().hex[:8]


@pytest.fixture(scope="module")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="module", autouse=True)
def seed(mongo):
    # Clean any stale TEST_ data
    mongo.users.delete_many({"user_id": {"$in": [USER_A["user_id"], USER_B["user_id"]]}})
    mongo.user_sessions.delete_many({"session_token": {"$in": [TOKEN_A, TOKEN_B, TOKEN_EXPIRED]}})
    mongo.quotes.delete_many({"user_id": {"$in": [USER_A["user_id"], USER_B["user_id"]]}})

    mongo.users.insert_many([dict(USER_A), dict(USER_B)])
    now = datetime.now(timezone.utc)
    mongo.user_sessions.insert_many([
        {"session_token": TOKEN_A, "user_id": USER_A["user_id"], "created_at": now, "expires_at": now + timedelta(days=7)},
        {"session_token": TOKEN_B, "user_id": USER_B["user_id"], "created_at": now, "expires_at": now + timedelta(days=7)},
        {"session_token": TOKEN_EXPIRED, "user_id": USER_A["user_id"], "created_at": now - timedelta(days=10),
         "expires_at": now - timedelta(days=1)},
    ])
    yield
    # Teardown
    mongo.quotes.delete_many({"user_id": {"$in": [USER_A["user_id"], USER_B["user_id"]]}})
    mongo.user_sessions.delete_many({"session_token": {"$in": [TOKEN_A, TOKEN_B, TOKEN_EXPIRED]}})
    mongo.users.delete_many({"user_id": {"$in": [USER_A["user_id"], USER_B["user_id"]]}})


@pytest.fixture
def s_anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def s_a():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN_A}"})
    return s


@pytest.fixture
def s_b():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN_B}"})
    return s


# --- Health ---
class TestHealth:
    def test_root(self, s_anon):
        r = s_anon.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("message") == "QuoteCanvas API"


# --- Auth gating ---
class TestAuthGating:
    def test_session_with_bogus_id_returns_401(self, s_anon):
        r = s_anon.post(f"{API}/auth/session", json={"session_id": "TEST_bogus_session_" + uuid.uuid4().hex})
        assert r.status_code == 401, r.text

    def test_me_without_token_returns_401(self, s_anon):
        r = s_anon.get(f"{API}/auth/me")
        assert r.status_code == 401
        assert r.status_code != 403

    def test_quotes_list_without_token_returns_401(self, s_anon):
        r = s_anon.get(f"{API}/quotes")
        assert r.status_code == 401

    def test_quotes_create_without_token_returns_401(self, s_anon):
        r = s_anon.post(f"{API}/quotes", json={"raw_text": "x", "template_used": "minimalist-dark"})
        assert r.status_code == 401

    def test_me_with_invalid_token_returns_401(self, s_anon):
        r = s_anon.get(f"{API}/auth/me", headers={"Authorization": "Bearer TEST_notreal"})
        assert r.status_code == 401

    def test_expired_session_returns_401(self, s_anon):
        r = s_anon.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {TOKEN_EXPIRED}"})
        assert r.status_code == 401


# --- Authenticated flows ---
class TestAuthenticated:
    created = {}

    def test_me_returns_user(self, s_a):
        r = s_a.get(f"{API}/auth/me")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_id"] == USER_A["user_id"]
        assert body["email"] == USER_A["email"]
        assert body["name"] == USER_A["name"]

    def test_create_quote_sets_user_id(self, s_a, mongo):
        payload = {
            "raw_text": "TEST_Alice first quote.",
            "book_title": "TEST_Book A",
            "author": "TEST_Alice",
            "template_used": "minimalist-dark",
            "aspect_ratio": "4:5",
            "device_id": "TEST_dev_alice",
        }
        r = s_a.post(f"{API}/quotes", json=payload)
        assert r.status_code == 200, r.text
        q = r.json()
        assert q["id"]
        assert q["user_id"] == USER_A["user_id"]
        assert q.get("deleted_at") is None
        TestAuthenticated.created["a1"] = q["id"]
        # Confirm persisted in Mongo tied to user_a
        from bson import ObjectId
        doc = mongo.quotes.find_one({"_id": ObjectId(q["id"])})
        assert doc and doc["user_id"] == USER_A["user_id"]

    def test_second_quote_for_b(self, s_b):
        r = s_b.post(f"{API}/quotes", json={
            "raw_text": "TEST_Bob quote.", "template_used": "warm-serif", "aspect_ratio": "1:1",
        })
        assert r.status_code == 200
        TestAuthenticated.created["b1"] = r.json()["id"]

    def test_list_scoped_to_user(self, s_a, s_b):
        la = s_a.get(f"{API}/quotes").json()
        lb = s_b.get(f"{API}/quotes").json()
        a_ids = {q["id"] for q in la}
        b_ids = {q["id"] for q in lb}
        assert TestAuthenticated.created["a1"] in a_ids
        assert TestAuthenticated.created["a1"] not in b_ids
        assert TestAuthenticated.created["b1"] in b_ids
        assert TestAuthenticated.created["b1"] not in a_ids
        assert all(q["user_id"] == USER_A["user_id"] for q in la)
        assert all(q["user_id"] == USER_B["user_id"] for q in lb)

    def test_cross_user_get_returns_404(self, s_b):
        qid = TestAuthenticated.created["a1"]
        r = s_b.get(f"{API}/quotes/{qid}")
        assert r.status_code == 404

    def test_cross_user_patch_returns_404(self, s_b):
        qid = TestAuthenticated.created["a1"]
        r = s_b.patch(f"{API}/quotes/{qid}", json={"book_title": "TEST_hacked"})
        assert r.status_code == 404

    def test_cross_user_delete_returns_404(self, s_b):
        qid = TestAuthenticated.created["a1"]
        r = s_b.delete(f"{API}/quotes/{qid}")
        assert r.status_code == 404

    def test_patch_own_quote(self, s_a):
        qid = TestAuthenticated.created["a1"]
        r = s_a.patch(f"{API}/quotes/{qid}", json={"book_title": "TEST_Updated"})
        assert r.status_code == 200
        assert r.json()["book_title"] == "TEST_Updated"
        g = s_a.get(f"{API}/quotes/{qid}")
        assert g.status_code == 200 and g.json()["book_title"] == "TEST_Updated"

    def test_soft_delete(self, s_a, mongo):
        from bson import ObjectId
        qid = TestAuthenticated.created["a1"]
        r = s_a.delete(f"{API}/quotes/{qid}")
        assert r.status_code == 200
        # Should not appear in list, GET returns 404, but doc still exists in Mongo with deleted_at set
        lst = s_a.get(f"{API}/quotes").json()
        assert qid not in [q["id"] for q in lst]
        g = s_a.get(f"{API}/quotes/{qid}")
        assert g.status_code == 404
        doc = mongo.quotes.find_one({"_id": ObjectId(qid)})
        assert doc and doc.get("deleted_at") is not None

    def test_raw_text_over_limit_returns_422(self, s_a):
        r = s_a.post(f"{API}/quotes", json={
            "raw_text": "x" * 501, "template_used": "minimalist-dark", "aspect_ratio": "4:5",
        })
        assert r.status_code == 422


class TestLogout:
    def test_logout_invalidates_token(self, s_anon, mongo):
        # seed a fresh throwaway session for user A
        tok = "TEST_logout_token_" + uuid.uuid4().hex[:8]
        now = datetime.now(timezone.utc)
        mongo.user_sessions.insert_one({"session_token": tok, "user_id": USER_A["user_id"],
                                        "created_at": now, "expires_at": now + timedelta(days=1)})
        try:
            # confirm it works first
            r = s_anon.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200
            # logout
            r = s_anon.post(f"{API}/auth/logout", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 200
            assert r.json().get("ok") is True
            # Now token should be invalid
            r = s_anon.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
            assert r.status_code == 401
            # Mongo row removed
            assert mongo.user_sessions.find_one({"session_token": tok}) is None
        finally:
            mongo.user_sessions.delete_one({"session_token": tok})


class TestDeviceMergeStatic:
    """Device merge requires a real Emergent session_id (cannot be automated).
    This test seeds device-scoped quotes, runs the same update_many filter server.py uses,
    and asserts it would correctly claim orphan quotes for that device.
    """

    def test_merge_filter_matches_orphan_quotes(self, mongo):
        device_id = "TEST_merge_dev_" + uuid.uuid4().hex[:6]
        now = datetime.now(timezone.utc).isoformat()
        docs = [
            {"device_id": device_id, "user_id": None, "deleted_at": None,
             "raw_text": "TEST_merge_1", "template_used": "minimalist-dark", "aspect_ratio": "4:5",
             "created_at": now, "updated_at": now},
            {"device_id": device_id, "user_id": None, "deleted_at": None,
             "raw_text": "TEST_merge_2", "template_used": "warm-serif", "aspect_ratio": "1:1",
             "created_at": now, "updated_at": now},
            # already deleted – must NOT be merged
            {"device_id": device_id, "user_id": None, "deleted_at": now,
             "raw_text": "TEST_merge_deleted", "template_used": "minimalist-dark", "aspect_ratio": "4:5",
             "created_at": now, "updated_at": now},
            # already owned – must NOT be re-claimed
            {"device_id": device_id, "user_id": USER_B["user_id"], "deleted_at": None,
             "raw_text": "TEST_merge_owned_by_b", "template_used": "minimalist-dark", "aspect_ratio": "4:5",
             "created_at": now, "updated_at": now},
        ]
        ids = mongo.quotes.insert_many(docs).inserted_ids
        try:
            res = mongo.quotes.update_many(
                {"device_id": device_id, "user_id": None, "deleted_at": None},
                {"$set": {"user_id": USER_A["user_id"], "updated_at": now}},
            )
            assert res.modified_count == 2
            claimed = list(mongo.quotes.find({"device_id": device_id, "user_id": USER_A["user_id"]}))
            assert len(claimed) == 2
            # Deleted one still unowned
            still_orphan = list(mongo.quotes.find({"device_id": device_id, "user_id": None}))
            assert len(still_orphan) == 1
            assert still_orphan[0]["deleted_at"] is not None
        finally:
            mongo.quotes.delete_many({"_id": {"$in": ids}})


# --- OCR / AI usage helpers ---
def _font(size=30):
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", size)
    except Exception:
        return ImageFont.load_default()


def _text_image_b64():
    img = Image.new("RGB", (900, 420), (245, 240, 230))
    d = ImageDraw.Draw(img)
    y = 60
    for line in ["It is a truth universally acknowledged,",
                 "that a single man in possession of a good",
                 "fortune, must be in want of a wife."]:
        d.text((50, y), line, fill=(40, 37, 36), font=_font(30))
        y += 60
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def _utc_date_str():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# Dedicated user+session for OCR/AI-usage tests so we can safely seed/reset ai_usage
# without affecting the quotes CRUD tests.
USER_OCR = {"user_id": "TEST_user_ocr", "email": "TEST_ocr@example.com", "name": "OcrUser",
            "picture": None, "created_at": datetime.now(timezone.utc).isoformat()}
TOKEN_OCR = "TEST_token_ocr_" + uuid.uuid4().hex[:8]


@pytest.fixture(scope="class")
def ocr_setup(mongo):
    """Seed an isolated user + session, and ensure ai_usage is clean for the current UTC day.

    All tests touching /api/ocr or /api/ai/usage share this class-scoped fixture so loadscope
    pins them to a single worker and the daily counter state is deterministic.
    """
    mongo.users.delete_many({"user_id": USER_OCR["user_id"]})
    mongo.user_sessions.delete_many({"session_token": TOKEN_OCR})
    mongo.ai_usage.delete_many({"user_id": USER_OCR["user_id"]})

    mongo.users.insert_one(dict(USER_OCR))
    now = datetime.now(timezone.utc)
    mongo.user_sessions.insert_one({
        "session_token": TOKEN_OCR, "user_id": USER_OCR["user_id"],
        "created_at": now, "expires_at": now + timedelta(days=7),
    })
    yield
    mongo.ai_usage.delete_many({"user_id": USER_OCR["user_id"]})
    mongo.user_sessions.delete_many({"session_token": TOKEN_OCR})
    mongo.users.delete_many({"user_id": USER_OCR["user_id"]})


@pytest.fixture
def s_ocr(ocr_setup):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN_OCR}"})
    return s


def _reset_usage(mongo, user_id=USER_OCR["user_id"]):
    mongo.ai_usage.delete_many({"user_id": user_id})


class TestOcrAndAiUsage:
    """OCR auth gating, size cap, daily limit, usage endpoint, and no-image-storage."""

    # --- Auth gating ---
    def test_ocr_without_token_returns_401(self, s_anon):
        r = s_anon.post(f"{API}/ocr", json={"image_base64": _text_image_b64()})
        assert r.status_code == 401, r.text

    def test_ocr_with_invalid_token_returns_401(self, s_anon):
        r = s_anon.post(f"{API}/ocr",
                        headers={"Authorization": "Bearer TEST_not_a_token"},
                        json={"image_base64": _text_image_b64()})
        assert r.status_code == 401

    def test_ai_usage_without_token_returns_401(self, s_anon):
        r = s_anon.get(f"{API}/ai/usage")
        assert r.status_code == 401

    # --- /api/ai/usage shape ---
    def test_ai_usage_shape_fresh_user(self, s_ocr, mongo):
        _reset_usage(mongo)
        r = s_ocr.get(f"{API}/ai/usage")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body == {"limit": 50, "used": 0, "remaining": 50, "date": _utc_date_str()}

    def test_ai_usage_reflects_seeded_count(self, s_ocr, mongo):
        _reset_usage(mongo)
        mongo.ai_usage.insert_one({"user_id": USER_OCR["user_id"], "date": _utc_date_str(), "count": 37})
        r = s_ocr.get(f"{API}/ai/usage")
        assert r.status_code == 200
        body = r.json()
        assert body["limit"] == 50
        assert body["used"] == 37
        assert body["remaining"] == 13
        assert body["date"] == _utc_date_str()
        _reset_usage(mongo)

    # --- 2MB size cap ---
    def test_ocr_size_cap_returns_413(self, s_ocr, mongo):
        _reset_usage(mongo)
        # Build a payload whose decoded length is > 2MB. Use 2.5MB of zero bytes which base64-encodes
        # to ~3.4M chars; this is checked BEFORE the LLM call so no real OCR traffic is generated.
        oversized = base64.b64encode(b"\x00" * (int(2.5 * 1024 * 1024))).decode()
        assert (len(oversized) * 3) // 4 > 2 * 1024 * 1024
        r = s_ocr.post(f"{API}/ocr", json={"image_base64": oversized})
        assert r.status_code == 413, r.text
        # Still should not increment usage (we rejected pre-LLM)
        used_after = mongo.ai_usage.find_one({"user_id": USER_OCR["user_id"], "date": _utc_date_str()})
        assert used_after is None or int(used_after.get("count", 0)) == 0

    # --- Short/invalid payload ---
    def test_ocr_invalid_short_base64(self, s_ocr):
        r = s_ocr.post(f"{API}/ocr", json={"image_base64": "abc"})
        assert r.status_code == 400

    # --- Daily limit (seeded at 50 → next call must 429 without hitting the LLM) ---
    def test_ocr_daily_limit_returns_429_when_seeded_50(self, s_ocr, mongo):
        _reset_usage(mongo)
        mongo.ai_usage.insert_one({"user_id": USER_OCR["user_id"], "date": _utc_date_str(), "count": 50})
        r = s_ocr.post(f"{API}/ocr", json={"image_base64": _text_image_b64()}, timeout=30)
        assert r.status_code == 429, r.text
        # usage must remain unchanged (not incremented past 50)
        doc = mongo.ai_usage.find_one({"user_id": USER_OCR["user_id"], "date": _utc_date_str()})
        assert doc and int(doc["count"]) == 50
        # /api/ai/usage reports remaining=0
        u = s_ocr.get(f"{API}/ai/usage").json()
        assert u["used"] == 50 and u["remaining"] == 0
        _reset_usage(mongo)

    # --- Successful OCR increments ai_usage, returns remaining, stores no image ---
    def test_ocr_success_increments_usage_and_returns_remaining(self, s_ocr, mongo):
        _reset_usage(mongo)
        # Seed usage at 10 so we can validate the exact remaining=39 after this call.
        mongo.ai_usage.insert_one({"user_id": USER_OCR["user_id"], "date": _utc_date_str(), "count": 10})

        # Snapshot collections BEFORE the call so we can prove no image storage happened.
        collections_before = set(mongo.list_collection_names())

        r = s_ocr.post(f"{API}/ocr", json={"image_base64": _text_image_b64()}, timeout=120)
        if r.status_code == 502:
            pytest.skip(f"Upstream LLM unavailable: {r.text}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "ok" in body and "text" in body and "word_count" in body and "remaining" in body
        assert isinstance(body["remaining"], int)
        # Exactly one increment: 10 -> 11, remaining = 50 - 11 = 39.
        assert body["remaining"] == 39, body
        if body["ok"] is True:
            assert body["word_count"] >= 3
            assert body["text"].strip() != ""

        # ai_usage incremented by exactly 1
        doc = mongo.ai_usage.find_one({"user_id": USER_OCR["user_id"], "date": _utc_date_str()})
        assert doc and int(doc["count"]) == 11

        # /api/ai/usage mirrors the increment
        u = s_ocr.get(f"{API}/ai/usage").json()
        assert u["used"] == 11 and u["remaining"] == 39

        # --- No image storage: no new collection created, and no collection with "image" in the name
        # contains anything linked to our test user. The OCR endpoint also never writes to quotes. ---
        collections_after = set(mongo.list_collection_names())
        new_collections = collections_after - collections_before
        assert new_collections <= {"ai_usage"}, f"Unexpected new collections: {new_collections}"
        for name in collections_after:
            if "image" in name.lower() or "ocr" in name.lower():
                assert mongo[name].count_documents({}) == 0, \
                    f"Found image-like persisted data in '{name}'"
        # Also confirm no quote document was created as a side effect
        assert mongo.quotes.count_documents({"user_id": USER_OCR["user_id"]}) == 0

        _reset_usage(mongo)
