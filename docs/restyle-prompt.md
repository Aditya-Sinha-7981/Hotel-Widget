# Prompt: restyle the hotel lead-gen widget demo

Paste this into Claude Code / opencode from the `hotel-widget/` project root.

---

I have a working hotel lead-gen chat widget (vanilla JS, no framework) in
`public/widget.js`, embedded on a test page at `public/demo.html`. The
logic is done and correct — do not touch `server/`, `data/`, or any
tree-walking / config-merge / submit logic in `widget.js`. This is a
**pure visual pass**: CSS and markup structure only.

## Reference, not replica

I'm loosely inspired by The Sayaji Hotels' website chat widget — dark
header bar with an avatar and hotel name, chip-style quick-reply
buttons, a "typing…" indicator, message-bubble layout. I do **not**
want an exact copy of their widget, their branding, their colors, or
their logo. Treat it as "this general genre of hotel-chat-widget UI,"
not a clone target.

## What's currently wrong

Right now both the demo page and the widget look like an unstyled
HTML prototype — default browser fonts, a bare white panel, plain
bordered buttons, no visual hierarchy, no sense that this belongs on
a hotel's website at all. It needs to look like a legitimate product,
not a wireframe.

## What to change

**1. `public/widget.js` (the chat widget itself)**
- Give the floating bubble and panel a cohesive, polished visual
  identity — pick your own palette (something that reads "hospitality
  / hotel," e.g. warm neutrals, deep charcoal/navy + a gold or brass
  accent — your call, just make it deliberate, not default-gray).
- Header bar: dark background, a placeholder avatar/icon, a title
  (keep it generic — something like "Ask us anything," not a fake
  hotel name), and a close button.
- Messages should read as a conversation, not a bare question + button
  list: previous answers the user already gave should stay visible
  above the current question as compact "sent" bubbles, so it feels
  like a chat thread, not a single-screen form that resets each step.
- Quick-reply options as pill/chip-style buttons (rounded, not square
  bordered boxes), with a hover/active state.
- Add a brief "typing…" or loading state between a user's answer and
  the next question appearing (doesn't need to be a real delay if
  that complicates things — even a 400–600ms artificial pause with a
  dot-typing indicator sells it).
- Smooth open/close transition on the panel (slide/fade), not an
  instant show/hide.
- Success and error states should look intentional (icon + styled
  message box), not plain colored text.

**2. `public/demo.html` (the stand-in hotel homepage)**
- This does not need to be a real hotel site. But it should look like
  a plausible, reasonably polished hero section — a hero image or
  gradient background, a header/nav bar, a heading and short line of
  copy — good enough that a founder looking at it reads it as "this
  widget on a real site" rather than "a test harness." Use a stock
  Unsplash-style image URL or a CSS gradient if no image is available,
  whichever is simpler.
- Keep the hotelId `<select>` dropdown, but style it so it doesn't
  look like leftover dev tooling sitting in the middle of the page —
  maybe tuck it into a small fixed corner panel labeled clearly as a
  demo control.

## Constraints

- Keep everything in the existing two files unless there's a good
  reason to add a separate CSS file — if you do, keep it embeddable
  (widget.js still needs to be a single script a hotel can drop in).
- No new dependencies/build step — this still needs to run with
  `npm start` and nothing else.
- Don't rename any function, endpoint, or JSON key — only touch
  rendering/markup/CSS, not the data flow.
- Keep it fast to review — after you're done, tell me briefly what
  changed and why, not a full diff walkthrough.
