# Hotel Chat Widget — Architecture v2 (Sayaji-style, real APIs)

## Why this doc exists

The old `ARCHITECTURE.md` describes what we *thought* we were building (a
generic decision-tree lead-gen widget hitting a placeholder `base_url`).
That plan is still directionally correct, but v1 was actually implemented
in Python by mistake, and the client has since supplied the real reference
UI (The Sayaji Hotels' live site widget) and real backend APIs. This
document replaces the widget-shape parts of the old doc; the old doc's
*intent* (config-driven, base-url-swappable, no unnecessary persistence)
still holds.

## Reference UI

Modeled on The Sayaji Hotels' live chat widget (screenshot supplied), not
a pixel clone:

- Dark header bar: small avatar icon, hotel name, close (×) button
- Scrollable message thread — bot messages left-aligned, user's own prior
  answers shown back as compact "sent" bubbles (so it reads as a running
  conversation, not a form that resets each step)
- Quick-reply options rendered as pill/chip buttons, not raw `<select>`
  or bordered boxes
- "The Sayaji Hotels is typing…" indicator between steps
- End-of-flow state: "Thank you for getting in touch... one of our
  executives will get back to you shortly" + `Main Menu` / `Exit` chips
- Idle/expired state: "Session timed out. Click to start chat." +
  "Start a new conversation" button

## Flow

**First-time visitor** (no stored contact info):

```
1. Ask name  (optional — user can skip)
2. Ask phone (optional — user can skip)
   → store { name, phone } in localStorage, scoped per hotel/baseUrl
3. getCities            → render city chips
4. user picks city       → have city_id
5. getPropertyByCity(city_id) → render property chips
6. user picks property    → have property_id
7. department_list        → render department chips
8. user picks department  → have department_id
9. [OPEN — see below] if department implies a restaurant/booking flow,
   we don't yet have an API for restaurant_id / time_slot_id / date /
   pax. For now: skip these fields entirely, send save_lead without
   them. Flagged for the founder.
10. Optional free-text comments/query
11. POST /API/save_lead with everything collected
12. Show end-of-flow "thank you" state
```

**Returning visitor** (localStorage already has name/phone):

```
1. Skip straight to step 3 above (getCities)
   → payload at save_lead time still includes the stored name/phone
```

localStorage is device-local only — this does **not** create any
server-side leads database, consistent with the original "don't persist
customer data beyond forwarding it" requirement. It's just a UX shortcut
so a repeat visitor isn't re-asked their own name.

## API layer

All four endpoints live on a per-hotel host; only the domain changes,
paths and payload shape are identical across every hotel:

```
{baseUrl}/API/getCities            POST
{baseUrl}/API/getPropertyByCity    POST   { city_id }
{baseUrl}/API/department_list      POST
{baseUrl}/API/save_lead            POST   { see payload below }
```

### Confirmed response shapes (from client, Indore example)

```jsonc
// getCities
{ "status": true, "message": "...", "data": [
  { "city_id": "8", "city_name": "Indore" }, ...
]}

// getPropertyByCity  — request body: { "city_id": 8 }  (int in the request,
// even though city_id comes back as a string everywhere else — the API is
// loose about this, so the widget should send whichever value it received
// from getCities as-is rather than coercing type)
{ "status": true, "message": "...", "data": [
  {
    "hotel_id": "27",
    "hotel_name": "Pride Hotel and Convention Centre, Indore - Hotel in Indore",
    "hotel_code": "h-1",
    "city_id": "8",
    "hotel_image": "",
    "hotel_image_url": ""
  }, ...
]}

// department_list
{ "status": true, "message": "...", "data": [
  { "department_id": "15", "department_name": "Rooms" },
  { "department_id": "16", "department_name": "Restaurant" },
  { "department_id": "17", "department_name": "Banquets" }
]}
```

Chip-rendering logic reads `*_name` for the label and holds the paired
`*_id` for the next call / final payload. `hotel_image` /
`hotel_image_url` came back empty for both Indore properties in the
sample — property chips should render fine with no image (name/text
only), not assume an image will usually be present.

`property` in `save_lead` maps to `hotel_id` from `getPropertyByCity`
(assumption — see open questions).

```js
window.HotelAIConfig = {
  baseUrl: "https://pridehotel.thexoombox.in"
};
```

Swapping `baseUrl` for another hotel is the entire integration change —
same as the original plan, this just replaces the placeholder
`/API/saveLEAD` guess with the real, confirmed endpoint set.

### save_lead payload (confirmed shape)

```json
{
  "name": "",
  "email": "",
  "phone": "",
  "property": 28,
  "department": 15,
  "comments": "",
  "query": "",
  "user_channel": "TODO — confirm exact expected value",
  "pax": null,
  "booking_date": null,
  "restaurant_id": null,
  "time_slot_id": null
}
```

- `name` / `email` / `phone` — all optional on our side; send whatever
  was collected (possibly empty strings), don't block submission on
  missing contact info.
- `property`, `department` — the IDs picked up from `getPropertyByCity`
  and `department_list` respectively.
- `pax`, `booking_date`, `restaurant_id`, `time_slot_id` — **not
  currently populated**, no source API exists yet (see Open Questions).
  Send as `null` until that's resolved, not fabricated values.
- `user_channel` — placeholder value for now (e.g. `"Website Chatbot"`),
  **not confirmed** with the client yet.

### Auth

The curl examples the client sent carry `ci_session` cookies, but those
are Postman-session artifacts, not a real auth mechanism to replicate —
confirmed by the client. Treat all four endpoints as unauthenticated for
now. Same as the old architecture's `auth` seam: leave a config field
for it (`auth: { type: "none" }`) so adding a real key/token later is a
config change, not a rewrite.

## State & persistence

- `{ name, phone }` → `localStorage`, keyed per hotel (so multiple hotel
  embeds on the same browser don't collide), client-side only.
- Everything else (city/property/department selections, comments) →
  in-memory for the duration of the conversation, POSTed once at
  `save_lead`, never stored by our own backend.

## Input validation (client-side)

- `phone` — strip non-digits as typed, reject on submit if the field has
  content but isn't a plausible phone number length. Field itself stays
  optional.
- `email` — basic format check if non-empty, optional otherwise.
- `name` — trim, cap length, no special format required.
- All three fields skippable — the flow must not dead-end a user who
  doesn't want to give contact info.

## Widget delivery model

Unchanged from the earlier embeddable-widget plan: a small loader script
(`widget.js`) the hotel drops in via two `<script>` tags, which injects a
floating button and (for cross-domain isolation from arbitrary hotel
sites) renders the actual chat UI in an iframe pointed at our hosted
app. `baseUrl` is passed from the hotel's page → loader → iframe via
`postMessage` or a query param, same as previously scoped. No npm
packages, no build step, nothing else added to the hotel's page.

## Open questions — flagged, not solved here

1. **`restaurant_id` / `time_slot_id` source** — no API provided for
   listing restaurants or their time slots. Need either a new endpoint
   from the client or confirmation these fields stay null indefinitely
   for non-dining departments.
2. **`user_channel` exact expected value(s)** — is this a fixed string
   per widget instance, or does it vary by department/flow? Currently
   placeholder-only.
3. **Rooms flow depth** — `Rooms` will also need date fields
   (check-in/check-out) eventually, same situation as `Restaurant` —
   no API for this yet either. Both stay null-field stubs for now.

## Testing

See `test-apis.js` — a standalone script to hit all four endpoints
against a given `baseUrl` and dump raw responses, so the tree-render
logic gets built against real field names/shapes instead of guesses.
Run it (or hand it to someone with network access to the client's host)
before wiring `getCities`/`getPropertyByCity`/`department_list` into the
widget's chip-rendering logic.
