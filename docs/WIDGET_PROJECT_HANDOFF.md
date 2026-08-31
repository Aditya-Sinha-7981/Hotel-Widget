# Context Handoff — Hotel Lead-Gen Chat Widget (Task 1)

Paste this into a new conversation to get full context before we start building. Read it fully before asking me anything or writing code.

---

## Who I am and what this is

I'm a first-year-in AI/ML student who just landed my first task from a founder at a hotel-focused startup, after being referred in and meeting him directly. This is task 1 — a practical test of whether I can actually build, not just talk. His stated working style: **"just make something, we'll figure out later."** That means: ship a working vertical slice fast, don't front-load requirements gathering. I have a list of clarifying questions already prepared (below) — those are held for *after* I show a working demo, not before.

## What I'm actually building

**This is not an AI chatbot.** It looks like one — a floating chat-bubble widget, bottom-right corner of a website, that pops open and asks questions one at a time in a chat-style UI (reference: The Sayaji Hotels' website has one that looks almost exactly like what we're copying the *feel* of). But underneath, it's a **scripted decision-tree form**. No LLM, no NLU, no free text understanding needed. Each step is a fixed question with fixed options; the user's answer picks the next question; at the end, the collected answers become a **lead**, which gets POSTed to a configurable backend endpoint.

The goal: a small embeddable widget that can be dropped onto any hotel's website and, with zero code changes, be reconfigured (which questions, what options, where the lead gets sent) per hotel.

## Confirmed requirements (do not relitigate these — they came directly from the founder)

1. **The widget itself is generic** — it does not need to know or detect which hotel it's on. (Deployment/embed mechanism is still open — see deferred questions.)
2. **The question tree is static today, but must become dynamic later.** Concrete example given: a hotel has multiple locations → each location has multiple buildings → each building has its own availability options. Build the static version *as data*, not as hardcoded logic, so going dynamic later is a swap of what feeds the data, not a rewrite. See "Tree structure" below for the exact pattern to use.
3. **Styling/branding is explicitly deferred.** Don't spend time on visual polish right now — functional first.
4. **On submit:** failure → show a plain error message. Success → show something like *"Our representative will contact you shortly."*
5. **Payload/destination must be configurable per hotel** — this was the founder's specific, repeated requirement: change a `base_url`-type variable, and the exact same widget now sends leads somewhere else. He confirmed the payload *shape* is identical across all his properties (he owns all of them), so this does not currently need per-hotel field-mapping — just a swappable destination.
6. **No auth today.** The founder's own API is open/unauthenticated. For now, leads may be sent to a temporary destination (e.g. Supabase) instead of his real endpoint while building — but the config should have an auth "seam" (a field that exists and does nothing yet) so wiring in real auth later, for Supabase or anything else, is a config change, not a rewrite.
7. **Avoid persisting customer data** beyond what's needed to forward it. Hold in-progress answers in memory for the duration of the conversation, POST once at the end, don't build a leads database as part of this widget's own scope.

## Architecture patterns already decided — build against these, don't redesign them

### Tree structure (data-driven, N levels deep)
```json
{
  "location": {
    "question": "Which location?",
    "options": ["Location A", "Location B"]
  },
  "building": {
    "question": "Which building?",
    "options_by_parent": {
      "Location A": ["Building 1", "Building 2"],
      "Location B": ["Building 3"]
    }
  },
  "availability": {
    "question": "What are you looking for?",
    "options_by_parent": {
      "Building 1": ["Room", "Banquet Hall"],
      "Building 2": ["Room"]
    }
  }
}
```
The widget should walk this via a single function — something like `getOptionsForNode(nodeId, parentAnswer)` — reading from this static file today. When this goes dynamic later (file-based per-hotel config, or a DB), only what's *behind* that one function changes. The tree-walking/rendering logic in the widget itself should never need to change for that transition. Do not hardcode question flow as if/else branches anywhere.

### Destination config (base + per-hotel override, merge on top)
```json
{
  "base_url": "https://default-endpoint.example.com/leads",
  "auth": { "type": "none" },
  "payload_map": {
    "name": "full_name",
    "location": "location",
    "building": "building",
    "availability": "requested_availability"
  }
}
```
A hotel-specific override file only needs to specify what actually differs from this base — not duplicate the whole shape. This whole object is what gets swapped when the founder "changes the URL from hotelX to hotelY."

### On submit
1. Collect answers → build the lead object.
2. Apply `payload_map` to shape the outgoing JSON.
3. POST to `base_url` with whatever `auth` config specifies (currently: none).
4. On success → success message. On failure → error message. No retry/persistence logic needed yet (see deferred questions).

## What NOT to over-build right now

- No database/persistence layer for leads — this widget forwards, it doesn't store.
- No real auth implementation — just leave the seam (the `auth` field) in place.
- No hotel-identification logic in the widget (per-site config is a deferred/open question, not something to solve preemptively).
- No styling/theming system — a plain, functional chat UI is enough for the demo.
- No admin UI for editing the tree — a hand-edited JSON file is sufficient for now.

## Deferred questions — do NOT ask these yet, they're queued for after the founder sees a working demo

**Tree / data structure**
- Who edits the tree once dynamic — me via file + redeploy, or does he need a self-serve UI?
- Does question *text* itself ever vary per location/building, or always same questions, different option values?
- Is 3 levels (location → building → availability) the real ceiling, or could some flows need more/fewer steps?

**Payload / backend**
- Confirm payload shape is truly identical across every property, not just "hasn't differed yet."
- Where do leads need to actually end up long-term — CRM, email, dashboard, more than one?
- Does he want visibility into submitted leads on his end at all?

**Embed / deployment**
- Single embed snippet dropped on every hotel's site as-is, or does it eventually need per-site config passed via the script tag?
- Who ends up hosting the widget JS/backend long-term — me, or does it move to his infra?

**Auth / security**
- When this moves off Supabase to wherever he really wants leads: will that destination ever have auth, or should I assume "sometimes yes, sometimes no" per destination permanently?
- Is an unauthenticated public submit endpoint acceptable indefinitely, or does he want basic abuse protection (rate limiting, honeypot) before this touches a real site with real traffic?

**Failure handling / UX**
- Is a plain error + "try again" enough on failure, or does he want any retry/backup path so a real lead isn't silently lost?
- Any real SLA behind "our representative will contact you shortly," or is it just copy?

**Scale / ops**
- Roughly how many hotels/properties will this run across in year one? Changes whether "one config file per hotel" stays sane.

---

## What I need from you (the AI reading this)

Help me actually build this: a small widget (frontend chat-bubble UI) + a lightweight backend (or serverless function) that walks the static tree, collects answers, applies the base+override payload config, and POSTs to the configured destination. Prioritize a working end-to-end demo over completeness — this needs to visibly work soon, matching the founder's "build first" style. Ask me before making any architecture decision not already locked in above; don't ask about anything in the deferred-questions list, since those aren't mine to answer yet.
