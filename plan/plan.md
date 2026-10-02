# QuoteCanvas — On-Device Scanning + AI Fallback

Move text scanning off the server and onto the phone using Google ML Kit, so a scan works instantly with no network.
Keep the AI vision model only as an optional, protected "Improve with AI" upgrade.

## Who it's for
Readers scanning passages from physical books who want fast, private, offline-capable text capture, with an optional AI boost when a page is hard to read.

## What changes
- **Default scan is on-device.** After cropping, text is recognized on the phone with Google ML Kit. No image or text leaves the device for a normal scan. Works offline.
- **AI becomes an opt-in "Improve with AI" action** inside the editor. If the on-device result is messy or incomplete, the user can tap it to re-run the cropped page through the server vision model for a cleaner transcription.
- **"Improve with AI" shows both versions** — the on-device text and the AI text — side by side, and the user picks which one to keep.

## AI fallback rules (server endpoint)
- **Sign-in required.** Only authenticated users can call it (anonymous scans stay fully on-device).
- **Daily limit: 50 per user per day.** Once reached, the button is disabled with a clear "daily AI limit reached, try again tomorrow" message; on-device text still works.
- **Image size cap: ~2 MB.** The app downscales the crop before sending; oversized images are rejected with a friendly message.
- **No image storage.** The server processes the image in memory and never writes it to disk or the database. Only the resulting text is returned.

## User flow
1. Snap a book page → crop the passage.
2. Text is recognized **on the device** (instant, offline).
3. Text lands in the editor; user adds title/author and picks a template.
4. If the text looks off, tap **Improve with AI** (requires sign-in) → see on-device vs AI text → pick one.
5. Export the styled image / save to history (saving still requires sign-in).

## Offline behavior
- Normal scans work offline (on-device recognition needs no network).
- "Improve with AI" needs a connection; when offline it's disabled with a short hint.
- The existing "unprocessed queue" is no longer needed for basic scanning, since recognition is local — it will be retired from the default flow.

## Dev build vs Expo Go (what you asked)
- **Needs a real dev/production build (NOT Expo Go, NOT web preview):** the on-device ML Kit scanning. ML Kit is a native module and is not included in Expo Go, so the scan flow can only be tested after generating a build via the Publish/build flow.
- **Works in Expo Go / preview:** everything else — cropping UI, the editor, templates, canvas export, sign-in, save/history, and the server "Improve with AI" endpoint itself (the backend call can be exercised independently).
- Because ML Kit is the default scan (your choice), the end-to-end scan path is only verifiable on a build. Backend and the rest of the UI are verified in preview as usual.

## Every place an API key or LLM call is used (after this change)
- **On-device ML Kit scan:** no API key, no LLM, no network, no cost. Runs entirely on the phone.
- **"Improve with AI" server endpoint:** the only LLM call left. Uses the OpenAI vision model via the Emergent LLM Key, stored server-side in `backend/.env` as `EMERGENT_LLM_KEY`. Never shipped to the app. Now gated by sign-in + 50/day + ~2 MB cap + no image storage.
- **Google sign-in:** Emergent-managed; no key you manage.
- **No other keys or LLM calls exist in the app.**

## UI/UX feel
Warm, bookish "Editorial Mobile LIGHT" theme, carried into the new editor controls and the two-version comparison screen.

## Implementation phases
- **Phase 1 (build now):** On-device ML Kit scanning as the default; retire the forced server scan; add the gated, size-capped, no-storage "Improve with AI" endpoint and the two-version pick UI in the editor; wire the daily-limit and sign-in states.
- **Phase 2 (later):** Multi-language recognition options and auto-rotation / glare handling for tougher pages.
- **Phase 3 (later):** Batch scanning multiple pages in one session before editing.

## Assumptions
- Google ML Kit's Latin-script (default) recognizer is used first; other scripts are a Phase 2 add-on.
- The crop is downscaled client-side to stay under ~2 MB before any AI call.
- The daily AI counter resets at midnight UTC and is tracked per user on the server.
- "Improve with AI" lives in the editor (after a scan), not on the crop screen, so the user always has an on-device result to compare against.
- The existing templates, theme, auth, and save/merge behavior are unchanged.
- Anonymous (signed-out) users can scan on-device freely but cannot use "Improve with AI" or save.
