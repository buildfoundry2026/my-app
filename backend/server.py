from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict, AliasChoices
from typing import List, Optional, Annotated, Any
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent, TextDelta, StreamDone  # noqa: E402

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

# "Improve with AI" guardrails
DAILY_AI_LIMIT = 50                       # AI transcriptions per user per UTC day
MAX_IMAGE_BYTES = 2 * 1024 * 1024         # ~2 MB cap on the (decoded) image sent for AI

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---------- Mongo helpers ----------
def _coerce_object_id(v: Any) -> str:
    if isinstance(v, ObjectId):
        return str(v)
    return v


PyObjectId = Annotated[str, BeforeValidator(_coerce_object_id)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Optional[PyObjectId] = Field(default=None, validation_alias=AliasChoices("_id", "id"), serialization_alias="id")

    def to_mongo(self) -> dict:
        data = self.model_dump(exclude_none=True)
        data.pop("id", None)
        return data

    @classmethod
    def from_mongo(cls, doc: dict):
        return cls.model_validate(doc)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Models ----------
class Quote(BaseDocument):
    device_id: Optional[str] = None
    user_id: Optional[str] = None
    raw_text: str
    book_title: Optional[str] = None
    author: Optional[str] = None
    template_used: str
    aspect_ratio: str = "4:5"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    deleted_at: Optional[str] = None


class QuoteCreate(BaseModel):
    device_id: Optional[str] = None
    raw_text: str = Field(min_length=1, max_length=500)
    book_title: Optional[str] = None
    author: Optional[str] = None
    template_used: str
    aspect_ratio: str = "4:5"


class User(BaseModel):
    user_id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    created_at: str


class SessionRequest(BaseModel):
    session_id: str
    device_id: Optional[str] = None


class SessionResponse(BaseModel):
    session_token: str
    user: User
    merged_quotes: int = 0


# ---------- Auth ----------
EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


async def get_current_user(request: Request) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth[7:].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires = session["expires_at"]
    if isinstance(expires, str):
        expires = datetime.fromisoformat(expires)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**user)


@app.on_event("startup")
async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.quotes.create_index([("user_id", 1), ("created_at", -1)])
    await db.ai_usage.create_index([("user_id", 1), ("date", 1)], unique=True)


@api_router.post("/auth/session", response_model=SessionResponse)
async def create_session(body: SessionRequest):
    async with httpx.AsyncClient(timeout=15) as http:
        try:
            res = await http.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": body.session_id})
        except httpx.HTTPError:
            raise HTTPException(status_code=401, detail="Could not verify sign-in")
    if res.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired sign-in")
    data = res.json()
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=401, detail="No email returned")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name"), "picture": data.get("picture")}},
        )
        user_doc = {**existing, "name": data.get("name"), "picture": data.get("picture")}
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name"),
            "picture": data.get("picture"),
            "created_at": now_iso(),
        }
        await db.users.insert_one(dict(user_doc))

    session_token = data.get("session_token") or uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    await db.user_sessions.insert_one(
        {"session_token": session_token, "user_id": user_id, "created_at": now, "expires_at": now + timedelta(days=7)}
    )

    merged = 0
    if body.device_id:
        res_merge = await db.quotes.update_many(
            {"device_id": body.device_id, "user_id": None, "deleted_at": None},
            {"$set": {"user_id": user_id, "updated_at": now_iso()}},
        )
        merged = res_merge.modified_count

    return SessionResponse(session_token=session_token, user=User(**user_doc), merged_quotes=merged)


@api_router.get("/auth/me", response_model=User)
async def me(user: User = Depends(get_current_user)):
    return user


@api_router.post("/auth/logout")
async def logout(request: Request):
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        await db.user_sessions.delete_one({"session_token": auth[7:].strip()})
    return {"ok": True}


class QuoteUpdate(BaseModel):
    raw_text: Optional[str] = Field(default=None, min_length=1, max_length=500)
    book_title: Optional[str] = None
    author: Optional[str] = None
    template_used: Optional[str] = None
    aspect_ratio: Optional[str] = None


class OcrRequest(BaseModel):
    image_base64: str


class OcrResponse(BaseModel):
    ok: bool
    text: str
    word_count: int
    message: Optional[str] = None
    remaining: Optional[int] = None


def _utc_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _ai_used_today(user_id: str) -> int:
    doc = await db.ai_usage.find_one({"user_id": user_id, "date": _utc_date()})
    return int(doc["count"]) if doc else 0


OCR_SYSTEM = (
    "You are a precise OCR engine for photographs of printed book pages. "
    "Transcribe the legible text exactly as printed, preserving paragraph breaks, punctuation and capitalization. "
    "Join words that are hyphenated across line breaks. Do not add commentary, quotes, labels or markdown. "
    "Ignore page numbers and running headers. If the image contains no readable text or it is too blurry, "
    "reply with exactly: NO_TEXT"
)


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "QuoteCanvas API"}


@api_router.get("/ai/usage")
async def ai_usage(user: User = Depends(get_current_user)):
    used = await _ai_used_today(user.user_id)
    return {"limit": DAILY_AI_LIMIT, "used": used, "remaining": max(0, DAILY_AI_LIMIT - used), "date": _utc_date()}


@api_router.post("/ocr", response_model=OcrResponse)
async def ocr(req: OcrRequest, user: User = Depends(get_current_user)):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="OCR service not configured")
    b64 = req.image_base64
    if "," in b64[:64] and b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    if len(b64) < 100:
        raise HTTPException(status_code=400, detail="Invalid image")
    # Size cap: never accept an oversized payload (keeps it fast, bounded, no storage).
    if (len(b64) * 3) // 4 > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large. Crop a tighter area and try again.")

    # Daily limit (resets at midnight UTC).
    used = await _ai_used_today(user.user_id)
    if used >= DAILY_AI_LIMIT:
        raise HTTPException(status_code=429, detail="Daily AI limit reached. Try again tomorrow.")

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"ocr-{uuid.uuid4()}",
        system_message=OCR_SYSTEM,
    ).with_model("openai", "gpt-5.4")

    msg = UserMessage(
        text="Transcribe the text in this photo of a book page.",
        file_contents=[ImageContent(image_base64=b64)],
    )
    chunks: List[str] = []
    try:
        async for ev in chat.stream_message(msg):
            if isinstance(ev, TextDelta):
                chunks.append(ev.content)
            elif isinstance(ev, StreamDone):
                break
    except Exception as e:
        logger.exception("OCR failed")
        raise HTTPException(status_code=502, detail=f"OCR failed: {e}")

    # Count the call against the daily limit (the LLM was invoked). Image is never stored.
    await db.ai_usage.update_one(
        {"user_id": user.user_id, "date": _utc_date()}, {"$inc": {"count": 1}}, upsert=True
    )
    remaining = max(0, DAILY_AI_LIMIT - (used + 1))

    text = "".join(chunks).strip()
    if text.upper().startswith("NO_TEXT"):
        return OcrResponse(ok=False, text="", word_count=0, remaining=remaining,
                           message="Text unclear. Please try capturing again in better light.")
    words = [w for w in text.split() if w.strip()]
    if len(words) < 3:
        return OcrResponse(ok=False, text=text, word_count=len(words), remaining=remaining,
                           message="Text unclear. Please try capturing again in better light.")
    return OcrResponse(ok=True, text=text, word_count=len(words), remaining=remaining)


@api_router.post("/quotes", response_model=Quote)
async def create_quote(body: QuoteCreate, user: User = Depends(get_current_user)):
    quote = Quote(**body.model_dump(), user_id=user.user_id)
    res = await db.quotes.insert_one(quote.to_mongo())
    quote.id = str(res.inserted_id)
    return quote


@api_router.get("/quotes", response_model=List[Quote])
async def list_quotes(user: User = Depends(get_current_user)):
    cursor = db.quotes.find({"user_id": user.user_id, "deleted_at": None}).sort("created_at", -1)
    docs = await cursor.to_list(500)
    return [Quote.from_mongo(d) for d in docs]


@api_router.get("/quotes/{quote_id}", response_model=Quote)
async def get_quote(quote_id: str, user: User = Depends(get_current_user)):
    if not ObjectId.is_valid(quote_id):
        raise HTTPException(status_code=404, detail="Quote not found")
    doc = await db.quotes.find_one({"_id": ObjectId(quote_id), "user_id": user.user_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Quote not found")
    return Quote.from_mongo(doc)


@api_router.patch("/quotes/{quote_id}", response_model=Quote)
async def update_quote(quote_id: str, body: QuoteUpdate, user: User = Depends(get_current_user)):
    if not ObjectId.is_valid(quote_id):
        raise HTTPException(status_code=404, detail="Quote not found")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    update["updated_at"] = now_iso()
    res = await db.quotes.find_one_and_update(
        {"_id": ObjectId(quote_id), "user_id": user.user_id, "deleted_at": None}, {"$set": update}, return_document=True
    )
    if not res:
        raise HTTPException(status_code=404, detail="Quote not found")
    return Quote.from_mongo(res)


@api_router.delete("/quotes/{quote_id}")
async def delete_quote(quote_id: str, user: User = Depends(get_current_user)):
    if not ObjectId.is_valid(quote_id):
        raise HTTPException(status_code=404, detail="Quote not found")
    res = await db.quotes.update_one(
        {"_id": ObjectId(quote_id), "user_id": user.user_id, "deleted_at": None}, {"$set": {"deleted_at": now_iso()}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Quote not found")
    return {"ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
