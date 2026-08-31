# Deployment & Client Handoff

How to put the widget online and what to hand the client. Pairs with the
root `README.md` (run/flow details) and `NEW_ARCHITECTURE.md` (design).

## What gets deployed

One small Node service — `server.js` — that does two things:

1. Serves `widget.js` (and the demo `index.html`).
2. Proxies `POST /API/*` → `https://pridehotel.thexoombox.in/API/*` for the
   four real endpoints (`getCities`, `getPropertyByCity`, `department_list`,
   `save_lead`).

The proxy is **required**: the hotel API sends no CORS headers, so a browser
on the client's domain cannot call it directly. Routing through our service
also means the client's page — and anyone inspecting it — only ever sees
calls to *our* host, never `pridehotel.thexoombox.in`.

No build step, no dependencies. Node ≥ 18 (for global `fetch`).

## Deploy to Railway (via GitHub)

1. Push this folder to a GitHub repo (`.gitignore` is already set).
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
3. Railway auto-detects Node and runs `npm start` (`node server.js`).
   Nothing to configure for the build.
4. **Settings → Networking → Generate Domain** → you get
   `https://<app>.up.railway.app`.
5. Set the environment variables below (**Variables** tab), then redeploy.
6. Open `https://<app>.up.railway.app/` — the demo page should load and the
   widget should complete a full flow with real cities/properties.

Redeploy on every push automatically.

### Environment variables

| Variable | Set it to | Effect |
|----------|-----------|--------|
| `ALLOWED_ORIGINS` | the client's test URL, e.g. `https://clientsite.com` (comma-separate for multiple) | `/API/*` returns `403` to any other origin. **Leave unset only until you know their domain** — it's still rate-limited, but any site could use the proxy. |
| `RATE_MAX` | `40` (default if unset) | max requests per IP per 60 s before `429` |
| `UPSTREAM` | leave unset | defaults to `https://pridehotel.thexoombox.in`; only set to repoint at a different hotel host |
| `PORT` | leave unset | Railway injects it |

## What to send the client

Two `<script>` tags, pasted just before `</body>`:

```html
<script>
  window.HotelAIConfig = {
    baseUrl: "https://<app>.up.railway.app",
    hotelName: "Pride Hotel"
  };
</script>
<script src="https://<app>.up.railway.app/widget.js"></script>
```

- `baseUrl` — our service URL. `widget.js` calls `` `${baseUrl}/API/<endpoint>` ``.
  Changing this one string repoints the whole widget.
- `hotelName` — shown in the chat header and the greeting line.

Nothing else to install. The widget injects its own floating button and
chat panel; it does not touch the rest of the page.

### Copy-paste message for the client

> Add these two script tags right before the closing `</body>` tag on any
> page you want the chat widget on. You can change `hotelName` and, if we
> move the service, `baseUrl` — nothing else. It adds a floating button in
> the bottom-right; open it to test the full flow (name → number → city →
> property → department). It will **not** submit a real enquiry yet — that's
> switched on from our side when we're ready.

## Verifying a deploy

- `GET https://<app>.up.railway.app/healthz` → `{"ok":true}`
- `GET https://<app>.up.railway.app/server.js` → `404` (source is not served)
- Widget flow on `/` completes and shows the thank-you screen
- On the client's page: open DevTools → Network, run the flow, confirm calls
  go to `<app>.up.railway.app/API/...` and return `200`
- Completed flow: the demo page's **Demo Console** (bottom-left) shows the
  captured lead payload

## Security model

**What is not hideable:** that the widget makes API calls. Anyone can open
DevTools → Network and see `POST .../API/getCities` and its JSON response.
This is true of every embedded web widget. The endpoints return public
reference data (city / hotel / department lists); there is no client-side
secret involved.

**What the service enforces (`server.js`):**

| Risk | Mitigation |
|------|------------|
| Discovering and directly hitting the hotel's real API | Real host is only in `server.js`, server-side. The browser only ever sees our proxy URL. |
| Pivoting to other endpoints on that API | Endpoint allowlist — only the 4 known paths forward; anything else → `404`. No path is built from user input. |
| Flooding the endpoints | Per-IP fixed-window rate limit → `429` over `RATE_MAX`/60 s. In-memory; resets on redeploy. |
| Other websites embedding the snippet / using the proxy | `ALLOWED_ORIGINS` allowlist → `403` for any other origin. |
| Making the server fetch arbitrary URLs (SSRF) | Upstream is a hard-coded constant; the endpoint name is `[A-Za-z_]+` and allowlisted. No client-controlled URL anywhere. |
| Reading source / config off the host | Static serving is a hard-coded 2-file map. `server.js`, `package.json`, `docs/`, `.git` are never served (`404`). |
| Oversized / garbage request bodies | Body capped at 100 KB; 10 s upstream timeout; upstream `Set-Cookie` and other headers are stripped, only the JSON body is relayed. |
| `save_lead` spam | Covered by rate limit + origin allowlist for now. Next step if abuse appears: Cloudflare Turnstile (invisible challenge) or a per-hotel signed token required before `save_lead` forwards. |

**One-line summary for the founder:** the widget talks only to our service;
our service is the only thing that knows the hotel API, forwards just four
specific calls, rate-limits per IP, and only accepts calls from the hotel's
own page. Someone can watch the traffic — they can't do anything with it
they couldn't do by filling in the form by hand.

**If the proxy is abused:** lower `RATE_MAX`, tighten `ALLOWED_ORIGINS`, or
delete the Railway domain (kills all widget traffic instantly). Because the
real API host is server-side only, it is not exposed by doing so.

## Turning on real lead submission

`save_lead` is **not called** in the current build. When ready:

1. In `widget.js`, inside `submitLead()`, uncomment the single marked line:
   ```js
   // postLead(payload);   →   postLead(payload);
   ```
2. Commit, push — Railway redeploys.

`postLead` posts to `` `${baseUrl}/API/save_lead` ``, which the proxy already
allowlists and forwards. No other change. Until then, the completed payload
is shown in the demo page's Demo Console and logged to the browser console,
but never sent.
