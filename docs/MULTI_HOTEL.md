# Multi-Hotel Deployment & Client Handoff

This is the doc for the "one widget, four hotels" rollout. Read it once
before scaling past the first hotel — the mental model and the per-hotel
checklist are repeated in shortened form at the bottom so you can hand
each client just the checklist.

Pairs with `README.md` (run/flow), `NEW_ARCHITECTURE.md` (design), and
`DEPLOYMENT.md` (single-hotel deployment walkthrough).

---

## 1. The mental model (one diagram, no jargon)

```
   Hotel A website              Hotel B website              Hotel C / D website
   ───────────────              ───────────────              ────────────────────
   <script>                     <script>                     <script>
     baseUrl:                      baseUrl:                      baseUrl:
     "…railway-A…"                 "…railway-B…"                 "…railway-C / D…"
   </script>                   </script>                   </script>
        │                            │                            │
        │ /API/*                     │ /API/*                     │ /API/*
        ▼                            ▼                            ▼
   ┌────────────────┐          ┌────────────────┐          ┌────────────────┐
   │  Railway       │          │  Railway       │          │  Railway       │
   │  service A     │          │  service B     │          │  service C / D │
   │                │          │                │          │                │
   │ UPSTREAM=      │          │ UPSTREAM=      │          │ UPSTREAM=      │
   │ hotel-a.api    │          │ hotel-b.api    │          │ hotel-c / d.api│
   └───────┬────────┘          └───────┬────────┘          └───────┬────────┘
           │ /API/getCities            │ /API/getCities            │ /API/getCities
           │ /API/getPropertyByCity    │ /API/getPropertyByCity    │ /API/getPropertyByCity
           │ /API/department_list      │ /API/department_list      │ /API/department_list
           │ /API/save_lead            │ /API/save_lead            │ /API/save_lead
           ▼                            ▼                            ▼
   hotel-a.api                  hotel-b.api                  hotel-c / d.api
```

**Why this shape, not "one Railway service, four upstreams in a config?":**

- **CORS / browser-isolation.** A browser can only see the proxy URL it was
  configured with. Each hotel's widget is locked to its own proxy. There
  is no shared surface where one hotel's traffic can hit another hotel's
  data, and there's no way for one client to "see" the other hotels'
  endpoints through the same origin.
- **Origin allowlist.** `ALLOWED_ORIGINS` on Railway A is `hotelA.com`
  only; Railway B is `hotelB.com` only. If hotel A's site tries to call
  hotel B's proxy, it's `403`'d. (And vice versa.)
- **Rate-limit isolation.** A flood on hotel A doesn't 429 hotel B.
- **Failure isolation.** If hotel A's API goes down, only hotel A's
  Railway service flaps. Hotel B keeps working.
- **Independent scaling.** Each hotel's traffic pattern is its own.
- **Independent secrets / config.** `UPSTREAM`, `ALLOWED_ORIGINS`, and
  future per-hotel tokens (e.g. Turnstile) live in that hotel's service
  Variables tab, not in a shared config file someone has to remember to
  update.

The one shared thing is `widget.js` itself, served from each Railway
service — same bytes, since the four hotels have identical API shapes
(per the brief).

---

## 2. The two-line contract

There is **one and only one** thing the client edits on their site:

```html
<script>
  window.HotelAIConfig = {
    baseUrl: "https://YOUR-RAILWAY-APP.up.railway.app", // ← per hotel
    hotelName: "Hotel Name"                              // ← per hotel
  };
</script>
<script src="https://YOUR-RAILWAY-APP.up.railway.app/widget.js"></script>
```

That is the entire integration. Drop the two `<script>` tags just before
`</body>` on any page that should show the widget.

### Why `baseUrl` is the proxy, not the hotel's API

> Do NOT point `baseUrl` at the hotel's API host (`hotel-a.api`, etc.).
> Those endpoints send no CORS headers, and the browser will block
> every request. `baseUrl` must always be the Railway (proxy) URL.

This is the rule clients break most often. If a client emails "the
widget isn't loading", check `baseUrl` first — it's almost always
pointed at the upstream and getting CORS-blocked.

---

## 3. Per-hotel checklist (do this once per hotel)

### A. On Railway — one service per hotel

For each hotel (repeat this whole block):

1. **New service in the same Railway project** (or a new one; one project
   per hotel is also fine and arguably cleaner). Same repo, same
   `server.js`, same `widget.js`. No code changes between services.
2. **Settings → Networking → Generate Domain** → note the URL, e.g.
   `https://hotel-widget-hotel-a-production.up.railway.app`. **This is
   the URL the client pastes into their `baseUrl`.**
3. **Variables** — set these (then redeploy):

   | Variable | Value for Hotel A | Notes |
   |---|---|---|
   | `UPSTREAM` | `https://hotel-a.api.example.com` | The hotel's real API host (no `/API` suffix — `server.js` adds it). |
   | `ALLOWED_ORIGINS` | `https://hotela.com,https://www.hotela.com` | Comma-separated. Include both apex and `www` if the site uses both. Add staging domains during testing. Leave unset **only** until you know the production domain — the proxy still rate-limits, but any site can use it. |
   | `RATE_MAX` | `40` (default) | Lower if abuse appears. |
   | `PORT` | leave unset | Railway injects it. |

4. **Verify** (still on Railway):
   - `GET https://<railway-url>/healthz` → `{"ok":true}`
   - Open `https://<railway-url>/` in a browser → demo page loads → run
     the widget → cities populate, properties populate, department list
     populates, lead payload appears in Demo Console.
   - DevTools → Network: confirm all `/API/*` calls return `200` and
     responses look like the hotel's data, not stale data.

### B. Sending to the client

Send them this — verbatim, no edits:

> Paste these two script tags right before the closing `</body>` tag on
> every page where you want the chat widget to appear:
>
> ```html
> <script>
>   window.HotelAIConfig = {
>     baseUrl: "https://<railway-url-from-step-2>",
>     hotelName: "<Their Hotel Name>"
>   };
> </script>
> <script src="https://<railway-url-from-step-2>/widget.js"></script>
> ```
>
> You can edit `hotelName` freely (it's only the chat header and
> greeting). You should not need to edit `baseUrl` — that's already
> pointed at the right place for your site. If we move the service
> later, we'll send you the new one.
>
> It adds a floating button in the bottom-right corner; click it to
> test the full flow (name → phone → city → property → department).
>
> The widget does **not** submit a real enquiry in this build — we
> switch that on from our side when the integration is finalised.
> Until then, the demo console on the test page shows the payload
> it would have sent.

Then verify on the client's site:

- DevTools → Network → run the flow → confirm all `/API/*` calls go to
  *your* Railway URL and return `200`.
- Try calling your Railway URL from a different origin (a CodePen, a
  curl from your laptop) — `ALLOWED_ORIGINS` should reject it with
  `403`.

---

## 4. Scaling up — copying the service for a new hotel

Adding a 5th, 6th, Nth hotel is mechanical:

1. **Duplicate the Railway service** (Railway → service → Settings →
   "Duplicate Service", or just "New Service → Deploy from GitHub
   repo" pointing at the same repo).
2. **Generate a new domain** (Settings → Networking).
3. **Change `UPSTREAM`** to the new hotel's API host.
4. **Change `ALLOWED_ORIGINS`** to the new hotel's domains.
5. Redeploy, run the same four-step verify from §3.A.4.
6. Send the client §3.B's message with the new Railway URL.

There is no `widget.js` change, no `server.js` change, no DB to
migrate. That's the point of this architecture.

---

## 5. Things that should make you stop and think

- **A client asks "can I just point baseUrl at our own API?"** — No.
  The hotel APIs send no CORS headers. Browser will block. Either they
  use the proxy (recommended), or their API team adds CORS headers
  (then `baseUrl` *can* be their API directly — but they lose the
  rate-limit / origin-allowlist / endpoint-allowlist protections).
  Don't allow direct-from-browser without explicit sign-off.
- **Two hotels want to share a single Railway service** — say no.
  Lose CORS isolation, lose origin-allowlist granularity, lose
  failure isolation. The cost of a second Railway service is tiny
  (free tier covers the workload for this widget); the cost of
  coupling hotels is not.
- **A hotel's API endpoint names differ from the four we expect**
  (`getCities`, `getPropertyByCity`, `department_list`, `save_lead`).
  Per the brief this won't happen — but if it does, `server.js:36`'s
  `ALLOWED_API` set has to be edited, and probably `widget.js`'s call
  sites (search `widget.js` for the endpoint strings). That's a
  code change, not a config change. Don't ship it as a "config-only"
  rollout.
- **Client wants different branding per page within the same site**
  (e.g. wedding page vs. corporate page show different hotel names).
  `hotelName` is a per-config value, so they can drop a different
  `HotelAIConfig` block per page. The widget picks it up on load.
  Mention this only if they ask — don't volunteer.

---

## 6. Cut-and-paste checklist (per new hotel)

```
☐  Duplicated Railway service (or new service from same repo)
☐  Generated Railway domain noted:  ____________________.up.railway.app
☐  Variables set:
     UPSTREAM            = https://____________________
     ALLOWED_ORIGINS     = https://____________________[, https://www.…]
     RATE_MAX            = 40 (or override)
☐  Redeployed
☐  /healthz returns {"ok":true}
☐  Demo page (/) runs full flow end-to-end
☐  /API/* responses look like the right hotel's data
☐  Sent client the snippet in §3.B with this hotel's Railway URL
☐  Verified on client's site: DevTools shows calls to the right Railway URL, all 200
☐  Verified that an unrelated origin (curl / CodePen) gets 403 from this service
☐  Saved the Railway URL + UPSTREAM hotel + ALLOWED_ORIGINS in a handover table
```

Keep the handover table somewhere central (Notion / sheet / your own
wiki). When hotel #5 emails "our widget stopped working", the answer
is on one row.