# Hotel Lead-Gen Chat Widget — Architecture

Scope: Task 1 demo. Scripted decision-tree, no LLM. Matches the locked
requirements from the handoff doc — this is the "what goes where and why,"
not a spec re-litigation.

## Pieces

```
hotel-widget/
├── data/
│   ├── tree.json           # the question tree (static today, swappable later)
│   ├── config.base.json    # default destination + payload_map
│   └── config.hotelA.json  # example override — only what differs from base
├── server/
│   ├── server.js           # Express app: tree API + submit/forward endpoint
│   └── package.json
└── public/
    ├── widget.js            # the embeddable widget itself (vanilla JS)
    └── demo.html             # a page that loads widget.js, for testing
```

Two runtime halves, matching the handoff's "frontend chat-bubble UI +
lightweight backend":

1. **`public/widget.js`** — the thing that actually gets embedded on a
   hotel's site. Walks the tree client-side, renders the chat bubble,
   collects answers, then does ONE network call: `POST /api/submit`.
2. **`server/server.js`** — a small Express service that owns config
   merging and does the *actual* forward to whatever `base_url` the
   config says. The widget never talks to the destination directly —
   this is what makes "swap `base_url`, same widget" possible without
   touching the widget bundle at all.

## Data flow

```
widget loads tree.json
   → walks it via getOptionsForNode(nodeId, parentAnswer)
   → renders one question at a time, collects answers in memory
   → on last node: two free-text fields (name, contact) — see note below
   → POST /api/submit  { answers, hotelId }
                              │
                              ▼
server merges config.base.json + config.<hotelId>.json
   → applies payload_map to reshape `answers` into the outbound JSON
   → reads `auth` (currently always {type:"none"} — the seam, unused)
   → POST to merged.base_url
   → 200 back to widget on success / error message on failure
```

Nothing is written to a database anywhere in this path — the server
forwards and returns, it doesn't persist. That satisfies requirement 7
directly; there's no leads table to accidentally build.

### Why the split (tree client-side, submit server-side)

The tree only contains *options a user picks from* — no secrets, no
per-hotel destination info — so there's no reason to round-trip the
server for every question. Rendering it client-side keeps the demo
snappy and keeps `widget.js` a single dumb, portable file.

The `base_url` / `auth` / `payload_map`, on the other hand, must
**never** ship inside the widget bundle — that's exactly the thing
that's supposed to change per hotel without redeploying the widget.
So config merging and the actual outbound POST live entirely on the
server, keyed by a `hotelId` the demo passes explicitly (see note
below — this is a stand-in, not a solution to the deferred
embed/detection question).

## The tree-walk function

Single function, used identically by widget and (conceptually) any
future editor tool:

```js
function getOptionsForNode(tree, nodeId, parentAnswer) {
  const node = tree[nodeId];
  if (!node) return null;
  if (node.options) return { question: node.question, options: node.options };
  return { question: node.question, options: node.options_by_parent[parentAnswer] || [] };
}
```

The widget's render loop only ever calls this — it has no `if/else`
per node id anywhere. Going dynamic later means `tree` stops being a
`require('./tree.json')` and becomes a fetch from a per-hotel
endpoint or DB row; `getOptionsForNode` and everything downstream of
it doesn't change.

## Config merge

```js
function mergeConfig(base, override = {}) {
  return {
    ...base,
    ...override,
    payload_map: { ...base.payload_map, ...(override.payload_map || {}) },
    auth: { ...base.auth, ...(override.auth || {}) },
  };
}
```

Shallow merge, but with `payload_map` and `auth` merged one level
deeper so an override can, say, redefine `base_url` alone without
having to repeat the whole `payload_map`.

## The name/contact fields — one open note

`payload_map` in the handoff maps `"name": "full_name"`, but
`tree.json`'s example only has `location → building → availability`.
There's no decision-tree node that produces a name. I've treated
name + a contact field (phone) as two fixed free-text inputs
appended after the tree walk finishes, not part of the JSON tree —
they're not "pick from options," they're typed input, so they don't
fit `getOptionsForNode`'s shape. Flagging this as an assumption, not
asking you to go confirm it with the founder — it's not on the
deferred list and doesn't block the demo either way.

## What's deliberately stubbed

- `auth: { type: "none" }` — read, merged, sent nowhere. The seam
  exists; nothing consumes it yet.
- `base_url` in `config.base.json` points at a placeholder
  (`https://httpbin.org/post`) so the demo has something real to hit
  and show a genuine success/failure round-trip. Swap it for your
  Supabase endpoint or the founder's real one — that's the whole
  point, it's one line in a JSON file.
- `hotelId` selection in `demo.html` is a `<select>` dropdown, purely
  so the demo can show config-swapping working. That is NOT a
  proposal for how embed/hotel-detection should really work — that's
  still on your deferred list.
