# WhatsApp bot · technical notes (research 2026-10-05)

**1. Recommended architecture**
- Meta Cloud API, using the user's own app and WABA (no BSP).
- A standalone Apps Script web app, separate from the domain-only app:
  - executeAs USER_DEPLOYING, access ANYONE_ANONYMOUS ("Execute as: Me", "Who has access: Anyone") [27].
  - Opens the task Sheet with SpreadsheetApp.openById.
  - Writes rows in the main app's exact schema.
  - Visibility defaults: private, but public when a project is set (same rule as quick-create).
- Fallbacks:
  - A relay (Cloud Run / Cloudflare Worker) that verifies the signature and returns 200.
  - A Google Chat app in Apps Script (internal only, no public endpoint) [29].
- Case A, where the old bot runs on the user's own app: do NOT re-register. Repoint the callback, or override for just this number.

**2. Verify handshake** [7]
- Meta sends `GET <callback>?hub.mode=subscribe&hub.verify_token=<T>&hub.challenge=<C>`. Any query string already in the callback (e.g. `?k=`) is appended to.
- Reply HTTP 200 with the raw `<C>` as the body. In Apps Script that must be `ContentService.createTextOutput(e.parameter['hub.challenge'])`, not HtmlService, because HtmlService wraps the output in HTML.
- Check `e.parameter.k`, `hub.mode` and `hub.verify_token` against Script Properties.
- A successful "Verify and save" while `k` is enforced proves Meta keeps the custom query param.
- Requirements: a valid public TLS certificate (self-signed is rejected). Events are POSTed in batches of up to 1000 updates.
- Every POST carries `X-Hub-Signature-256: sha256=<HMAC-SHA256(body, app_secret)>`. **Apps Script cannot read it.** The doPost event exposes only parameter, parameters, queryString, pathInfo, contentLength and postData [22]. Google closed the request for header access as won't-fix [33].

**3. Inbound webhook payload** (field `"messages"`) [19][15]
```json
{"object":"whatsapp_business_account",
 "entry":[{"id":"<WABA_ID>","changes":[{"field":"messages","value":{
   "messaging_product":"whatsapp",
   "metadata":{"display_phone_number":"569XXXXXXXX","phone_number_id":"<PHONE_NUMBER_ID>"},
   "contacts":[{"profile":{"name":"Ana"},"wa_id":"56912345678","user_id":"CL.1349..."}],
   "messages":[{"from":"56912345678","from_user_id":"CL.1349...","id":"wamid.HBgL...","timestamp":"1759676400","type":"text","text":{"body":"Tarea: ..."}}]
 }}]}]}
```
- **Interactive tap** (`type: "interactive"`):
  - `"context":{"from":"<biz number>","id":"<wamid of the bot message>"}`
  - `"interactive":{"type":"button_reply","button_reply":{"id":"due|tomorrow|<draftKey>","title":"Mañana"}}`
  - or `"interactive":{"type":"list_reply","list_reply":{"id":"proj|12|<draftKey>","title":"Presupuesto 2027","description":"..."}}`
- **Status events** come on the same field as `value.statuses[]` (`id`, `status` sent/delivered/read/failed, `timestamp`, `recipient_id`, `errors` on failure). Every outbound message produces 2-3 of them, so return immediately when `value.messages` is absent.
- `from` is E.164 without `+`. `timestamp` is Unix seconds as a string.
- BSUID (`from_user_id` / `contacts[].user_id`) has been present since April 2026. If a user has a username, the phone number may be omitted unless you interacted with them in the last 30 days, so allowlist both phone and BSUID [15].
- Always iterate every entry, change and message, because of batching.
- Check `value.metadata.phone_number_id === PHONE_NUMBER_ID`.

**4. Send API**
- `POST https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages`
- Headers: `Authorization: Bearer <system-user token>`, `Content-Type: application/json`. In UrlFetchApp also set `muteHttpExceptions: true`.
- **Text:**
  `{"messaging_product":"whatsapp","recipient_type":"individual","to":"56912345678","type":"text","text":{"preview_url":false,"body":"Listo, tarea creada..."}}`
- **Reply buttons** [13]:
  `{"messaging_product":"whatsapp","recipient_type":"individual","to":"56912345678","type":"interactive","interactive":{"type":"button","body":{"text":"¿Para cuándo?"},"action":{"buttons":[{"type":"reply","reply":{"id":"due|today|K","title":"Hoy"}},{"type":"reply","reply":{"id":"due|tomorrow|K","title":"Mañana"}},{"type":"reply","reply":{"id":"due|other|K","title":"Otra fecha"}}]}}}`
  - Limits: up to 3 buttons, title ≤20 chars, id ≤256 chars, body ≤1024, footer ≤60.
- **List** [14]:
  `"interactive":{"type":"list","body":{"text":"Elige proyecto"},"action":{"button":"Ver proyectos","sections":[{"title":"Proyectos","rows":[{"id":"proj|12|K","title":"Presupuesto 2027","description":"..."}]}]}}`
  - Limits: ≤10 sections, ≤10 rows in total, button label ≤20, row title ≤24, row description ≤72.
- The BSUID can be addressed with `"recipient":"<BSUID>"` alongside or instead of `to` (supported since July 2026) [15].
- Free-form and interactive messages are allowed only within 24h of the user's last message. Outside it you get error 131047 and need an approved template [12].

**5. Verdict on the Apps Script 302**
- **What is established:**
  - `/exec` runs doGet/doPost on the first request, then answers `302` to `script.googleusercontent.com/macros/echo...`. The body (with a 200) is only returned to clients that follow the redirect with GET [31] (tanaikech; Poehnelt, Google Workspace DevRel).
  - Meta requires a 200 and retries any non-200 "immediately, then a few more times with decreasing frequency over the next 7 days", with possible duplicates. Its docs never mention redirects [7][6].
- **What is reported but not documented by Meta:** 2026 tutorials (DEV, Sep 2026; Purshology, Mar 2026; a GitHub PR using `/exec?key=`) say Meta verification against Apps Script works [32]. Since the challenge only arrives after the redirect, that implies Meta's GET verifier follows 302.
- **What is unknown:** whether Meta's POST delivery treats the 302 as success.
  - Stripe, Telegram, Trello and Zoom treat it as a failure and retry. SMSGate saw duplicates from the same cause [31].
  - Returning `HtmlService.createHtmlOutput('ok')` from doPost reportedly yields a direct 200 (Telegram case, Feb 2026). That blog read the 302 from Telegram's error message rather than capturing the response; Google does not document the behavior [31].
- **Verdict:** acceptable for a 4-user internal pilot, with mandatory idempotency, if IT does not require signature verification.
- **Validation:**
  - `curl -i` (no `-L`) a POST to `/exec?k=...` and expect a 200 with the HtmlService trick, or a 302 without it.
  - Watch the Executions log for repeated runs of the same wamid. If they appear, put a relay in front that returns 200 and checks `X-Hub-Signature-256`.
  - Messenger's "respond in 5s, unsubscribe after 1h of failures" rule is documented for Messenger only, not for WhatsApp.

**6. Receiver design**
- **Fast path:** `if (!value.messages) return ok()`. Always return 200-ish, even on internal errors (catch and `console.error`), to avoid retry storms.
- **Dedupe:**
  - Check CacheService first (fast).
  - Then, under `LockService.getScriptLock().waitLock(10000)`, look the wamid up in a `WA_Log` sheet column with TextFinder. Store it, then process.
  - Cache alone is insufficient: max TTL is 6 hours and at most 1000 items, while Meta retries for 7 days [28]. Prune log rows older than 8 days.
- **Conversation state:**
  - Keep the draft in CacheService under `draft:<sender>`, TTL 3600s.
  - Encode `<draftKey>` in the button and list ids so a stale tap resolves the right draft.
  - Write the task row only at the final step.
  - Resolve "Hoy"/"Mañana" in the `America/Santiago` timezone set in appsscript.json.
- **Auth substitutes:** a `k` URL secret of 40+ chars, the sender allowlist (phone + BSUID), the phone_number_id check, and an append-only design that never echoes Sheet data. Secrets live in Script Properties: WA_TOKEN, PHONE_NUMBER_ID, SHEET_ID, VERIFY_TOKEN, URL_KEY, EQUIPO, GRAPH_VERSION.
- **Quotas** (Workspace): 100k UrlFetch calls/day, 30 concurrent executions per user (every webhook runs as the owner), 6 min per execution [23]. Status webhooks also count as executions.
- **Workspace blockers:**
  - Anonymous deploy can be hidden by admin sharing policy [30].
  - Context-Aware Access denies Sheets access to scripts unless the project is exempted [24].
  - A UrlFetch allowlist must include graph.facebook.com [25].
  - Use the `/macros/s/<ID>/exec` URL, not `/a/macros/copec.cl/...` (low confidence).
  - Redeploy through "Manage deployments" > New version so the URL stays the same.

**7. Meta config calls** [4][8]
- **Register** (only for a new or moved number): `POST /{PHONE_NUMBER_ID}/register {"messaging_product":"whatsapp","pin":"123456"}`. Limit 10 per 72h, error 133016. The status must become CONNECTED.
- **WABA subscription:** `GET /{WABA_ID}/subscribed_apps`; if missing, `POST /{WABA_ID}/subscribed_apps` (empty body). This is the most common cause of "verified but silent" webhooks [34].
- **Overrides** (callback ≤200 chars; the app must already be subscribed to the WABA):
  - per number: `POST /{PHONE_NUMBER_ID} {"webhook_configuration":{"override_callback_uri":"...","verify_token":"..."}}`
  - per WABA: `POST /{WABA_ID}/subscribed_apps {"override_callback_uri":"...","verify_token":"..."}`
  - Precedence: number, then WABA, then the app callback.
- **Token:** a System User token with business_management, whatsapp_business_management and whatsapp_business_messaging, expiry "Never" [2].
- **Errors:** 190 (expired or temporary token), 100 (used the phone number instead of the Phone number ID), 131047 (24h window closed), 131042 (no payment method on the WABA), 133016 (register limit) [20].
- **Live mode:** the app must be Live or some webhooks are not delivered [6].

**8. Pricing** (as of 2026-10-05)
- Effective 2026-10-01, non-template (service/interactive) messages are billed per message at the market's utility/authentication rate, with no volume tiers. In-window utility templates are billed too [9].
- The main pricing page still contains the old "free" text [10].
- Chile is about USD 0.0200 per message (secondary sources, medium confidence).
- A free allowance of 1,000 service messages per number per month is reported by secondary sources but is not visible on the fetched official page [11]. Unconfirmed.
- Inbound messages are free.

**9. API version**
- Pin `v25.0`. Current WhatsApp doc examples use it, and it expires 2028-07-29.
- `v26.0` (released 2026-07-29, expiry TBD) is the latest and also valid [21].
- Keep the version in a Script Property.
