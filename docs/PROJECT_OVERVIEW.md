# Hotel Widget — Project Overview (Plain English)

This doc is a plain-English summary of the entire project, written so
you can explain it to someone else without needing to read code.

---

## What This Project Is

An **embeddable chat widget** for hotel websites. It sits in the
bottom-right corner as a floating bubble, opens into a chat panel, asks
questions one at a time, and collects a **lead** (potential customer
enquiry) that gets sent to the hotel's backend API.

It looks like a chatbot but it's **not AI** — it's a scripted
conversation flow, like a multi-step form dressed up as a chat.

---

## The Two Main Pieces

### 1. `widget.js` — Frontend (runs in the browser)

A single vanilla JS file (zero dependencies, no framework). A hotel
drops it into their website with two `<script>` tags and it injects
itself — floating button, chat panel, the whole thing. It:
- Walks through a fixed conversation flow
- Renders quick-reply chip buttons for options (city, property, dept)
- Shows a "typing..." animation between steps
- Collects answers in memory, then POSTs them as a lead at the end

### 2. `server.js` — Backend (runs on Railway)

A tiny Node.js server. It does two things:
- **Serves** `widget.js` and `index.html` (the demo page)
- **Proxies** API calls to the real hotel API (`pridehotel.thexoombox.in`)

The proxy exists because the hotel's API sends no CORS headers — a
browser can't call it directly. The browser only ever talks to your
Railway URL; the real hotel API URL is hidden server-side.

---

## The Conversation Flow (what the user experiences)

```
1.  "Namaste 🙏 I'm your virtual assistant, here to help you with
     PRIDE HOTEL."
2.  Ask name → user types name (can skip)
3.  Ask phone → user types 10-digit number (can skip)
    → name + phone saved in localStorage (returning visitors skip
      steps 2-3)
4.  Ask city → user types city name (e.g., "Indore")
    → calls getCities API, fuzzy-matches what they typed
    → shows chip buttons for closest matches
5.  User picks city → calls getPropertyByCity(city_id)
    → shows chip buttons for properties in that city
6.  User picks property → calls department_list
    → shows chip buttons: Rooms / Restaurant / Banquets
7.  User picks department → asks for optional free-text query
8.  Builds a lead payload and POSTs to save_lead API
9.  Shows "Thank you... our executive will contact you shortly"
    → offers Main Menu / Exit chips
```

---

## The Real APIs (pridehotel.thexoombox.in)

| Endpoint | What it does | Request body |
|----------|-------------|-------------|
| `getCities` | Returns all 36 cities | `{}` |
| `getPropertyByCity` | Returns hotels in a city | `{ "city_id": 8 }` |
| `department_list` | Returns departments (Rooms, Restaurant, Banquets) | `{}` |
| `save_lead` | Receives the collected lead | See payload below |

---

## The Lead Payload (what save_lead receives)

```json
{
  "name": "Aditya",
  "email": "",
  "phone": "9876543210",
  "property": 27,
  "department": 15,
  "comments": "",
  "query": "Need a banquet hall for 200 people",
  "user_channel": "Website Chatbot",
  "pax": null,
  "booking_date": null,
  "restaurant_id": null,
  "time_slot_id": null
}
```

- `property` = `hotel_id` from `getPropertyByCity`
- `department` = `department_id` from `department_list`
- `pax`, `booking_date`, `restaurant_id`, `time_slot_id` = sent as
  `null` for now (no API exists yet for these)

**Note:** `save_lead` IS live — the `postLead(payload)` call is active
in `widget.js:589`. The surrounding comment is stale (says "intentionally
NOT called") but the code does call it.

---

## How Deployment Works (Multi-Hotel)

Each hotel gets its **own Railway instance** from the same repo:

```
Hotel A website  →  Railway service A  →  hotel-a.api (upstream)
Hotel B website  →  Railway service B  →  hotel-b.api (upstream)
Hotel C website  →  Railway service C  →  hotel-c.api (upstream)
```

Why separate instances (not one service for all hotels):
- **CORS isolation** — each hotel's widget only hits its own proxy
- **Origin allowlist** — each proxy only accepts calls from that
  hotel's website domain
- **Rate-limit isolation** — a flood on Hotel A doesn't affect Hotel B
- **Failure isolation** — Hotel A's API going down doesn't break Hotel B
- **Independent config** — `UPSTREAM`, `ALLOWED_ORIGINS`, etc. are
  separate per Railway service

Adding a new hotel = duplicate the Railway service, change `UPSTREAM`
and `ALLOWED_ORIGINS`, done. No code changes.

### Client Integration (the two lines)

```html
<script>
  window.HotelAIConfig = {
    baseUrl: "https://your-railway-app.up.railway.app",
    hotelName: "Pride Hotel"
  };
</script>
<script src="https://your-railway-app.up.railway.app/widget.js"></script>
```

Paste before `</body>` on any page. That's it.

---

## Security Model

| Risk | Mitigation |
|------|-----------|
| Hotel API URL exposed to browser | Only lives in server.js (server-side) |
| Hitting unexpected endpoints | Allowlist: only 4 known API paths |
| Flooding | Per-IP rate limit (40 req/60s) |
| Other sites using the proxy | Origin allowlist (403 for unauthorized origins) |
| XSS via user input | `textContent` only, no `innerHTML` for user text |
| SSRF | Upstream is a hard-coded constant, never built from user input |
| Oversized payloads | Body capped at 100KB |

---

## What's Not Done Yet (Open Items)

- **`pax`, `booking_date`, `restaurant_id`, `time_slot_id`** — no API
  exists yet to populate these; sent as `null`
- **`user_channel`** — hardcoded as `"Website Chatbot"`, not confirmed
  with client
- **Auth** — all endpoints unauthenticated; placeholder `auth: {
  type: "none" }` exists for future use
- **Rooms booking dates** — no check-in/check-out API yet
- **Restaurant booking flow** — no restaurant listing or time slot API
- **Styling** — functional but could be more polished
- **iframe isolation** — widget renders directly in the page; iframe
  isolation is deferred

---

## Key Technical Details

- **Zero dependencies** — vanilla JS, no npm packages for the widget
- **Node ≥ 18** — server uses global `fetch` for proxying
- **localStorage** — stores name/phone per hotel (keyed by `baseUrl`)
  so returning visitors skip contact info
- **Fuzzy city matching** — edit distance so typos like "Indor" still
  match "Indore"
- **Idle timeout** — 5 minutes of inactivity → "Session timed out"
- **Sample mode** — `SAMPLE_MODE = true` in widget.js runs the whole
  flow with hardcoded data, no network needed (good for demos)
- **No build step** — `npm start` and nothing else
