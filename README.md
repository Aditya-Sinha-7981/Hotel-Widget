# Pride Hotel — Chat Widget (demo build)

A scripted lead-capture chat widget for hotel websites. Reference look/feel:
The Sayaji Hotels' live site widget. Backend: the real Pride Hotel API set
(`getCities` / `getPropertyByCity` / `department_list` / `save_lead`) on a
per-hotel `baseUrl`. See `docs/NEW_ARCHITECTURE.md` and `docs/api_result.md`.

## Files

| File | What it is |
|------|------------|
| `index.html` | Plain demo homepage + the on-page **Demo Console**. Ends with the two `<script>` tags. |
| `widget.js`  | The embeddable widget. Self-injects a floating button + chat panel. All flow logic, validation, API calls, payload build. No dependencies, no build step. |
| `server.js`  | Zero-dependency local dev server: serves the two files **and proxies `POST /API/*`** to the hotel host. Needed because the live API sends no CORS headers (a browser can't call it cross-origin). Dev shim only. |

## Run it

```
cd "Hotel Widget"
node server.js
```

Open <http://localhost:8000/> and click the button in the bottom-right.
(Use `PORT=8080 node server.js` to change the port. Don't use
`python3 -m http.server` — the API calls will fail CORS without the proxy.)

### Why a server at all?

The live API (`https://pridehotel.thexoombox.in/API/*`) returns **no
`Access-Control-Allow-Origin` header**, so a browser blocks a direct
cross-origin `fetch` from `localhost`. `server.js` makes the call
server-side and the widget talks to it same-origin (`baseUrl: ""`).

The two-`<script>` embed model is unchanged for a real deployment where the
widget is served from the same origin as the API, or where the API adds
CORS. If neither is true, this proxy is the pattern to ship (it's the same
role the old project's `server/server.js` played).

## Hosting (send-a-snippet model)

Deploy `server.js` as one small Node service (Railway / Render / Fly / any
Node host). It serves `widget.js` **and** proxies `/API/*`. The hotel's real
API host lives only in `server.js` — a browser using the widget only ever
sees calls to your service.

Railway (reuses the old project's workflow):

```
cd "Hotel Widget"
npm i -g @railway/cli && railway login
railway init && railway up
# dashboard -> Settings -> Networking -> Generate Domain
```

Render: New -> Web Service -> repo -> Start command `node server.js`.

`package.json` already has `start`; `PORT` is read from env; no build step.

### Set these env vars on the host

| var | value | why |
|-----|-------|-----|
| `ALLOWED_ORIGINS` | `https://his-test-site.com` (comma-sep for more) | `/API/*` returns 403 to any other origin. Leave unset only if you don't know his domain yet (still rate-limited). |
| `RATE_MAX` | `40` (default) | per-IP requests / 60s before `429` |
| `UPSTREAM` | (defaults to the Pride host) | override to repoint at another hotel |

### The snippet you send

```html
<script>
  window.HotelAIConfig = {
    baseUrl: "https://YOUR-APP.up.railway.app",
    hotelName: "Pride Hotel"
  };
</script>
<script src="https://YOUR-APP.up.railway.app/widget.js"></script>
```

He pastes it before `</body>` and edits `baseUrl` / `hotelName` in his HTML.
`widget.js` calls `` `${baseUrl}/API/<endpoint>` ``; swapping `baseUrl` is
the entire integration change.

## Embedding on a real page

Drop these two tags at the end of `<body>`:

```html
<script>
  window.HotelAIConfig = {
    baseUrl: "https://pridehotel.thexoombox.in", // hotel API origin, or "" for same-origin
    hotelName: "Pride Hotel"
  };
</script>
<script src="widget.js"></script>
```

Swapping `baseUrl` (and `hotelName`) is the entire per-hotel change.
`widget.js` calls `` `${baseUrl}/API/<endpoint>` ``; an empty `baseUrl`
means same-origin (what the demo uses, via `server.js`).

## Conversation flow

1. Greeting
2. **Full name** — required (min 2 letters)
3. **10-digit WhatsApp number** — required; `+91` / leading-`0` are trimmed, then it must be exactly 10 digits
4. `{name, phone}` saved to `localStorage`, keyed by `baseUrl`. A returning
   visitor skips steps 2–3 (the payload still carries the stored values).
5. **City** — free text → `POST /API/getCities`, then fuzzy match:
   exact match proceeds; a near match asks *"Did you mean Indore?"* with a
   chip; no match re-prompts.
6. **Property** → `POST /API/getPropertyByCity { city_id }` → name-only chips
7. **Department** → `POST /API/department_list` → `Rooms` / `Restaurant` / `Banquets` chips
8. **Optional query** — free text, or `Skip`
9. Build the `save_lead` payload → hand it to the Demo Console (see below)
10. Thank-you screen + `Main Menu` / `Exit`. Idle >5 min → timeout + restart.

`restaurant_id` / `time_slot_id` / `pax` / `booking_date` have no source API
yet, so they go out as `null` (per the architecture doc). `email` has no step
in this flow and is sent as `""`. `user_channel` is `"Website Chatbot"`.

## save_lead is NOT called in this build

`submitLead()` in `widget.js` builds the exact payload and:

- sets `window.HotelWidget.lastSubmission`
- dispatches a `hotelwidget:lead` window event (the Demo Console listens)
- `console.log`s the payload

...but **does not POST it**. To do the real push, uncomment the one marked
line inside `submitLead()`:

```js
// postLead(payload);   <-- uncomment this
```

`postLead` hits `` `${baseUrl}/API/save_lead` `` — which, in the demo, is
same-origin and `server.js` forwards it to the hotel host (`save_lead` is
already in the proxy's allowlist). So uncommenting that one line does a
real, live lead push with no other change.

### Demo Console

Bottom-left panel on `index.html`. After a completed flow it shows a
timestamp; **View last lead payload** opens a modal with the pretty-printed
JSON and a copy button. This is the "what would we have submitted" view.

### Offline fallback

`widget.js` has `var SAMPLE_MODE = false;` near the top. Set it to `true` to
run the whole flow off the bundled sample data from `docs/api_result.md`
with no network at all — a safety lever if the live API is unreachable
during a demo. `getPropertyByCity` for cities other than Indore is
synthesised in this mode.

## Security notes

There is no database and no SQL in this widget — it is static client code
that forwards a payload to one API. The hardening that matters here:

- **XSS:** all user-entered text is rendered with `textContent`, never
  `innerHTML`. `innerHTML` is used only for static, in-file SVG markup.
- **Input validation:** every field is length-capped and stripped of
  control characters and `<` `>`. Phone is reduced to digits and
  length-checked. Name requires ≥2 letters (Latin or Devanagari).
- **No injection surface downstream:** the outbound lead only carries IDs
  the hotel API itself returned (`city_id` → `hotel_id`, `department_id`).
  Raw typed strings never occupy an ID field.
- **No SSRF / open redirect:** all requests go to fixed, hard-coded paths
  on the configured `https` `baseUrl`; the URL is never built from user
  input. Each request has a 10s `AbortController` timeout.
- **Storage:** `localStorage` reads/writes are wrapped in `try/catch` and
  the stored `{name, phone}` is re-validated on read.
- **Double-load guard:** a second inclusion of `widget.js` is a no-op.
