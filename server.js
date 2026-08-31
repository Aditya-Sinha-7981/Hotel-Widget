// Hosting server for the Pride Hotel widget — serve + proxy, nothing else.
//
// Jobs:
//   1. Serve exactly two files: index.html (demo page) and widget.js.
//   2. Proxy  POST /API/<name>  ->  https://pridehotel.thexoombox.in/API/<name>
//      for the 4 known endpoints only, with permissive CORS so the widget
//      works when embedded on another origin.
//
// The real hotel API host lives ONLY in this file (server-side). A browser
// using the widget sees calls to THIS server's /API/*, never the upstream.
//
// Hardening:
//   - static serving is a fixed 2-entry map — no fs path built from the URL,
//     so no traversal and server.js / docs / package.json are never exposed
//   - endpoint allowlist: only getCities / getPropertyByCity /
//     department_list / save_lead forward; anything else 404s
//   - per-IP rate limit (default 40 req / 60 s), in-memory
//   - optional Origin allowlist via ALLOWED_ORIGINS env (comma-separated);
//     unset = allow any origin (still rate-limited)
//   - request body capped at 100 KB
//   - fixed upstream constant — no client-supplied URL anywhere (no SSRF)
//   - upstream Set-Cookie / headers are dropped; only the JSON body is relayed
//
// No dependencies. Node >= 18 (needs global fetch). Run: node server.js

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8000;
const UPSTREAM = process.env.UPSTREAM || "https://pridehotel.thexoombox.in";
const MAX_BODY = 100_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = Number(process.env.RATE_MAX || 40);

const ALLOWED_API = new Set(["getCities", "getPropertyByCity", "department_list", "save_lead"]);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/widget.js": ["widget.js", "text/javascript; charset=utf-8"]
};

/* ---------- rate limiter (fixed window, per IP, in-memory) ---------- */

const hits = new Map();
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, e] of hits) if (e.start < cutoff) hits.delete(ip);
}, 5 * RATE_WINDOW_MS).unref();

function clientIp(req) {
  const xff = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.socket.remoteAddress || "unknown";
}

function rateLimited(ip) {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now - e.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  e.count += 1;
  return e.count > RATE_MAX;
}

/* ---------- CORS ---------- */

function corsHeaders(origin) {
  let allow = "*";
  if (ALLOWED_ORIGINS.length) {
    allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : "null";
  }
  const h = {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600"
  };
  if (allow !== "*") h["Vary"] = "Origin";
  return h;
}

function originAllowed(origin) {
  if (!ALLOWED_ORIGINS.length) return true; // unset = allow all
  if (!origin) return true;                 // non-browser / same-origin caller
  return ALLOWED_ORIGINS.includes(origin);
}

function send(res, status, body, headers) {
  res.writeHead(status, headers || {});
  res.end(body);
}

/* ---------- handlers ---------- */

function serveStatic(res, entry, origin) {
  const [file, type] = entry;
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) return send(res, 500, "read error", corsHeaders(origin));
    send(res, 200, data, Object.assign({ "Content-Type": type }, corsHeaders(origin)));
  });
}

function proxyApi(req, res, name, origin) {
  let body = "";
  let aborted = false;
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY) { aborted = true; req.destroy(); }
  });
  req.on("end", async () => {
    if (aborted) {
      return send(res, 413, JSON.stringify({ status: false, message: "payload too large" }),
        Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin)));
    }
    try {
      const upstream = await fetch(UPSTREAM + "/API/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body || "{}",
        signal: AbortSignal.timeout(10_000)
      });
      const text = await upstream.text();
      console.log(`[proxy] ${name} -> ${upstream.status} (${text.length}b)`);
      send(res, upstream.status, text,
        Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(origin)));
    } catch (e) {
      console.warn(`[proxy] ${name} FAILED: ${e.message}`);
      send(res, 502, JSON.stringify({ status: false, message: "upstream unreachable" }),
        Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin)));
    }
  });
}

/* ---------- router ---------- */

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0] || "/";
  const origin = req.headers.origin;

  if (req.method === "OPTIONS") {
    return send(res, 204, "", corsHeaders(origin));
  }

  if (urlPath === "/healthz") {
    return send(res, 200, JSON.stringify({ ok: true }),
      { "Content-Type": "application/json" });
  }

  const apiMatch = urlPath.match(/^\/API\/([A-Za-z_]+)\/?$/);
  if (apiMatch) {
    if (req.method !== "POST") {
      return send(res, 405, JSON.stringify({ status: false, message: "use POST" }),
        Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin)));
    }
    if (!ALLOWED_API.has(apiMatch[1])) {
      return send(res, 404, JSON.stringify({ status: false, message: "unknown endpoint" }),
        Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin)));
    }
    if (!originAllowed(origin)) {
      return send(res, 403, JSON.stringify({ status: false, message: "origin not allowed" }),
        Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin)));
    }
    if (rateLimited(clientIp(req))) {
      return send(res, 429, JSON.stringify({ status: false, message: "slow down" }),
        Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin)));
    }
    return proxyApi(req, res, apiMatch[1], origin);
  }

  if (req.method === "GET" && STATIC[urlPath]) {
    return serveStatic(res, STATIC[urlPath], origin);
  }

  send(res, 404, "not found", corsHeaders(origin));
});

server.listen(PORT, () => {
  console.log(`widget server  -> http://localhost:${PORT}`);
  console.log(`proxy /API/*   -> ${UPSTREAM}/API/*`);
  console.log(`rate limit     -> ${RATE_MAX} req / ${RATE_WINDOW_MS / 1000}s per IP`);
  console.log(`origin allow   -> ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(", ") : "(any)"}`);
});
