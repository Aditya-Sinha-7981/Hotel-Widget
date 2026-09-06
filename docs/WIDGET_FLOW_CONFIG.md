# Configuring the Conversation Flow

How to change questions, options, and order in the chat widget — no code
rewrites needed for the common cases. All of this lives in the
department-specific flow section of `widget.js`.

---

## The flow today

```
Name  →  Phone  →  City  →  Property  →  Department  →  [department-specific]  →  Query  →  Submit

Department-specific:
  Rooms      → Check-in date → Check-out date → Guests
  Restaurant → Dining date  → Meal            → Party size
  Banquets   → Event type   → Min headcount   → Timing
```

Everything the visitor picks is stored in `state.answers`, then shaped
into the `save_lead` payload once, at the end.

---

## Where each part lives in `widget.js`

| Piece | Location |
|---|---|
| Starting steps (name/phone/city/property) | `start()` → `askName()` → `askPhone()` → `askCity()` → `askProperty()` → `askDepartment()` |
| Which flow a department triggers | routing block inside `askDepartment()` (the `typingThen(function () { ... })`) |
| Rooms questions | `askCheckIn()` → `askCheckOut()` → `askGuests()` |
| Restaurant questions | `askDiningDate()` → `askMealTime()` → `askGuests()` |
| Banquet questions | `askEventType()` → `askMinHeadcount()` → `askEventTiming()` |
| Final free-text question | `askQuery()` |
| Lead payload shaping | `buildPayload()` |
| The `save_lead` call | `submitLead()` |

---

## Changing a question's text

Directly edit the `botMsg("...")` string inside the relevant `ask*()`
function. Example — change the Room check-in prompt:

```js
function askCheckIn() {
  state.step = "checkin";
  disableInput("Choose an option above");
  botMsg("When would you like to check in?");   // ← change this line
  renderDatePicker({ min: todayISO() }, function (iso) {
    ...
  });
}
```

---

## Changing option chips

Options are plain arrays inside `renderChips([...], ...)`. Each item is
`{ label: "what the user sees", value: "what gets stored" }`.

**Banquet event types** (`askEventType()`):

```js
renderChips([
  { label: "Marriage", value: "Marriage" },
  { label: "Out Door Catering", value: "Out Door Catering" },  // full form, not "ODC"
  { label: "Cultural Events", value: "Cultural Events" },
  { label: "Corporate Events", value: "Corporate Events" },
  { label: "Anniversary", value: "Anniversary" }
], function (val, label) { ... });
```

Add/remove a row to change the options. `label` is shown on the chip;
`value` is what ends up stored and sent.

Other chip lists to edit the same way:
- `askGuests()` — `1 / 2 / 3 / 4 / 5+`
- `askMealTime()` — `Breakfast / Lunch / Dinner`
- `askMinHeadcount()` — `Up to 100 / 100-200 / 200-500 / 500+`
- `askEventTiming()` — `Morning / Afternoon / Evening / Night`

---

## Reordering questions (Rooms, Restaurant, Banquets)

Change the order of the `typingThen(nextFunction)` calls at the end of
each `ask*()` function.

Example — ask guests before dates in the Rooms flow:

```js
function askCheckIn() { ... typingThen(askGuests); }   // was typingThen(askCheckOut)
function askGuests()  { ... typingThen(askCheckOut); }
function askCheckOut(){ ... typingThen(askQuery); }
```

Every step chain ends in `typingThen(askQuery)`, which always runs last
before submit.

---

## Date-picker constraints

`renderDatePicker(opts, cb)` takes two optional rules:

| Option | Meaning |
|---|---|
| `min` | earliest selectable date. Default: today (`todayISO()`). |
| `after` | date must be strictly after this (used for check-out > check-in). |

Check-out is already locked to the day after check-in:

```js
renderDatePicker({ min: addDaysISO(state.answers.check_in_date, 1), after: state.answers.check_in_date }, ...)
```

To allow same-day check-out, remove the `after` argument and change
`min` to `state.answers.check_in_date`. To cap the booking window, add
`max: addDaysISO(todayISO(), 30)`.

---

## Adding a brand-new department flow

1. In `askDepartment()`'s routing block, add a match:
   ```js
   else if (d.indexOf("pool") !== -1) askPoolFlow();
   ```
2. Define `askPoolFlow()` / its `ask*()` steps in the department-specific
   section, chaining each with `typingThen(...)` and ending in
   `typingThen(askQuery)`.
3. If the department already returns from `department_list`, that's all —
   the widget picks it up automatically.

---

## What gets sent to `save_lead` (`buildPayload()`)

Only confirmed keys are used — nothing is invented for the live API:

| Payload key | Source |
|---|---|
| `name` / `phone` / `email` | contact steps |
| `property` | selected hotel id (numeric) |
| `department` | selected department id (numeric) |
| `pax` | guests, or the numeric part of min headcount (e.g. `100-200` → `100`) |
| `booking_date` | Rooms check-in date or Restaurant dining date (`YYYY-MM-DD`) |
| `query` | the final free-text answer |
| `comments` | room in a summary string for data with no API field yet, e.g. `"Check-out: 2026-09-12, Event: Marriage, Minimum headcount: 100-200, Timing: Evening"` |
| `restaurant_id` / `time_slot_id` | always `null` (no API to source them) |
| `user_channel` | `"Website Chatbot"` |

### ⚠ Flagged for the backend (not silently faked)
- `restaurant_id`, `time_slot_id` — no endpoint exists to populate them.
  They stay `null`.
- No `save_lead` fields for check-out date, event type / min headcount /
  timing, or meal. They ride along in `comments` until the API team adds
  dedicated fields.
- `booking_date` is overloaded (check-in vs. dining date) — confirm the
  intended meaning.

If a field truly doesn't exist, it's **not** added to the payload — it
is appended to `comments` or left `null` and flagged here.

---

## Turning on live lead submission

`save_lead` is **off** during development (by design). To go live:

```js
// in submitLead()
// postLead(payload);      ← change this line
postLead(payload);
```

The demo page's Console (bottom-left) and the browser console always
show the exact payload that *would* be sent, even while off.

---

## Verification

- `node --check widget.js` — syntax check.
- Open the demo page (`npm start`, then `/`), complete a flow for each
  department, and inspect the payload in the Demo Console.
- Tests (throwaway DOM stub, not committed) drive all three department
  flows and assert payload fields.