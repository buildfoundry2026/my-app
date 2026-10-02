from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import logging
import uuid
from pathlib import Path
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict, AliasChoices
from typing import List, Optional, Annotated, Any
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent, TextDelta, StreamDone  # noqa: E402

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

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
    device_id: str
    raw_text: str
    book_title: Optional[str] = None
    author: Optional[str] = None
    template_used: str
    aspect_ratio: str = "4:5"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    deleted_at: Optional[str] = None


class QuoteCreate(BaseModel):
    device_id: str
    raw_text: str = Field(min_length=1, max_length=500)
    book_title: Optional[str] = None
    author: Optional[str] = None
    template_used: str
    aspect_ratio: str = "4:5"


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


@api_router.post("/ocr", response_model=OcrResponse)
async def ocr(req: OcrRequest):
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="OCR service not configured")
    b64 = req.image_base64
    if "," in b64[:64] and b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    if len(b64) < 100:
        raise HTTPException(status_code=400, detail="Invalid image")

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

    text = "".join(chunks).strip()
    if text.upper().startswith("NO_TEXT"):
        return OcrResponse(ok=False, text="", word_count=0,
                           message="Text unclear. Please try capturing again in better light.")
    words = [w for w in text.split() if w.strip()]
    if len(words) < 3:
        return OcrResponse(ok=False, text=text, word_count=len(words),
                           message="Text unclear. Please try capturing again in better light.")
    return OcrResponse(ok=True, text=text, word_count=len(words))


@api_router.post("/quotes", response_model=Quote)
async def create_quote(body: QuoteCreate):
    quote = Quote(**body.model_dump())
    res = await db.quotes.insert_one(quote.to_mongo())
    quote.id = str(res.inserted_id)
    return quote


@api_router.get("/quotes", response_model=List[Quote])
async def list_quotes(device_id: str):
    cursor = db.quotes.find({"device_id": device_id, "deleted_at": None}).sort("created_at", -1)
    docs = await cursor.to_list(500)
    return [Quote.from_mongo(d) for d in docs]


@api_router.get("/quotes/{quote_id}", response_model=Quote)
async def get_quote(quote_id: str):
    if not ObjectId.is_valid(quote_id):
        raise HTTPException(status_code=404, detail="Quote not found")
    doc = await db.quotes.find_one({"_id": ObjectId(quote_id), "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Quote not found")
    return Quote.from_mongo(doc)


@api_router.patch("/quotes/{quote_id}", response_model=Quote)
async def update_quote(quote_id: str, body: QuoteUpdate):
    if not ObjectId.is_valid(quote_id):
        raise HTTPException(status_code=404, detail="Quote not found")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    update["updated_at"] = now_iso()
    res = await db.quotes.find_one_and_update(
        {"_id": ObjectId(quote_id), "deleted_at": None}, {"$set": update}, return_document=True
    )
    if not res:
        raise HTTPException(status_code=404, detail="Quote not found")
    return Quote.from_mongo(res)


@api_router.delete("/quotes/{quote_id}")
async def delete_quote(quote_id: str):
    if not ObjectId.is_valid(quote_id):
        raise HTTPException(status_code=404, detail="Quote not found")
    res = await db.quotes.update_one(
        {"_id": ObjectId(quote_id), "deleted_at": None}, {"$set": {"deleted_at": now_iso()}}
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
