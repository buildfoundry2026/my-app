# QuoteCanvas — PRD & Build Log

## Original problem statement
Mobile app (iOS/Android, Expo) that turns photos of physical book pages into aesthetic, shareable quote graphics via a "Snap, Crop, Extract, Style" workflow. Camera-first entry, crop before OCR, text editor + attribution (book title, author), 4–5 templates, aspect ratio toggle (9:16, 4:5, 1:1), export via view-shot to native share sheet. History of saved quotes, settings, permission fallback, offline queue, 500-char limit, "text unclear" toast.

## User choices
- OCR: AI vision via Emergent LLM key (GPT-5.4, emergentintegrations) — no Google Vision key.
- Backend: FastAPI + MongoDB (Supabase from original PRD replaced). Quotes scoped per `device_id`.
- No user accounts for MVP.
- UI: designer-chosen warm bookish editorial look (Cormorant Garamond + DM Sans, paper/terracotta palette).

## Architecture
- `backend/server.py`: `POST /api/ocr` (base64 → GPT-5.4 vision; returns ok/text/word_count, ok=false if <3 words or NO_TEXT), `POST/GET/PATCH/DELETE /api/quotes` (soft delete via `deleted_at`). `BaseDocument` with `PyObjectId`, `id` serialized (never `_id`).
- `frontend/app/(tabs)/`: `index.tsx` Camera (expo-camera, torch, gallery picker, permission fallback), `history.tsx` (2-col grid, offline queue, delete), `settings.tsx` (permissions, device id).
- `frontend/app/crop.tsx`: gesture crop box (reanimated + gesture-handler) → expo-image-manipulator crop → NetInfo check → OCR or offline enqueue → editor.
- `frontend/app/editor.tsx`: split canvas preview / controls, 5 templates, ratios, 500-char editor, save to history, view-shot export → expo-sharing, save to Photos (expo-media-library, native only).
- `frontend/src/`: `templates.ts` (5 palettes), `store.ts` (zustand draft + toast), `api.ts` (fetch client, device id, offline queue in storage util), `components/CanvasRenderer.tsx`, `components/ui.tsx`, `components/PermissionFallback.tsx`, `navigation.ts` (NativeTabs gate), `theme.ts` (filled from design_guidelines).
- Fonts bundled in `assets/fonts` and loaded with expo-font.

## Implemented (2026-06)
- Full flow: camera → crop → OCR → editor → export/share; history CRUD; settings; permission fallback with Open Settings; offline queue with "Extract" later; text-unclear toast; 500-char limit; haptics.
- Tested: backend pytest 14/14 (`backend/tests/test_api.py`), frontend editor↔history flow verified by testing agent (iteration 2).
- Account Sync (2026-06): Emergent-managed Google sign-in. `POST /api/auth/session` (exchanges session_id, upserts user by email, mints 7-day session, merges device quotes into account), `GET /api/auth/me`, `POST /api/auth/logout`. All `/api/quotes*` require Bearer token and are scoped by `user_id`. Frontend: `src/auth.tsx` AuthProvider (web hash parsing + mobile openAuthSessionAsync + deep-link fallbacks), `app/login.tsx`, root gate via `Stack.Protected` in `_layout.tsx` (sign-in required), account card + sign out in Settings. Tested: pytest 21/21, UI gate/settings/sign-out verified (iteration 3).

## Backlog
- P0: none open.
- P1: Google Books auto-fill of title/author from extracted text; share directly to specific apps; edit saved quote text inline from history.
- P2: custom fonts/colors per template; multiple quotes per page (multi-crop); dark mode UI.

## Notes
- Camera/crop/share/save-to-photos are device-only features; web preview shows permission fallback.
- Test credentials: none (see `/app/memory/test_credentials.md`).

## Update — On-device scanning + AI fallback (June 2026)
- Default scan is now on-device via Google ML Kit (`@infinitered/react-native-mlkit-text-recognition`, `src/ocr.ts`). Instant, offline, private, no network/key. Native-only: works only in a real dev/prod build, NOT Expo Go / web preview.
- AI vision is now an opt-in "Improve with AI" action in the editor (shows on-device vs AI text side-by-side; user picks one). Requires the cropped image (`draft.imageUri`).
- `POST /api/ocr` is now gated: requires sign-in, daily limit 50/user/UTC-day (`ai_usage` collection), ~2MB size cap (HTTP 413), over-limit HTTP 429, image processed in-memory only (never stored). `GET /api/ai/usage` returns remaining.
- App is now usable signed-out: anonymous users can scan on-device + edit/export, but cannot save to history or use Improve with AI (prompted to sign in). History/Settings show sign-in prompts when signed out.
- Retired the offline "unprocessed queue" (recognition is local now).
- Backend verified: 28/28 pytest pass.
