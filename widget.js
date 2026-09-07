(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Pride Hotel chat widget — self-injecting, zero dependencies.
   *
   * Delivery model: two <script> tags at the end of the host page's
   *   <body> — one sets window.HotelAIConfig, this file is the other.
   *   It injects a floating button + chat panel straight into the page
   *   (no iframe yet — that isolation step is deferred).
   *
   * Security posture:
   *  - Every piece of user-entered text is rendered with textContent,
   *    never innerHTML, so markup typed into a name / city / message is
   *    inert. innerHTML is used only for static, developer-authored SVG.
   *  - Inputs are length-capped and stripped of control characters and
   *    angle brackets. The phone field is reduced to digits and format-
   *    checked; the name needs at least two letters.
   *  - The outbound lead only ever carries identifiers issued BY the
   *    hotel API (city_id -> hotel_id, department_id). Raw typed strings
   *    never land in an id slot, so there is no string/query-injection
   *    surface handed downstream.
   *  - Network calls hit fixed, hard-coded paths on the configured
   *    https baseUrl, each with an AbortController timeout. The URL is
   *    never assembled from user input (no SSRF / open-redirect surface).
   *  - localStorage access is wrapped in try/catch and the stored value
   *    is re-validated on read.
   *
   * save_lead is intentionally NOT called in this build. submitLead()
   * surfaces the payload to the host page (Demo Console). To go live,
   * uncomment the single marked line inside submitLead().
   * ------------------------------------------------------------------ */

  var cfg = (window.HotelAIConfig && typeof window.HotelAIConfig === "object") ? window.HotelAIConfig : {};
  var BASE_URL = String(cfg.baseUrl || "").trim().replace(/\/+$/, "");
  var HOTEL_NAME = sanitizeText(cfg.hotelName || "our hotel", 60) || "our hotel";

  // Flip to true to run entirely off the bundled sample data
  // (docs/api_result.md) with no network at all — a safety lever if the
  // live API is unreachable during a demo.
  var SAMPLE_MODE = false;

  var REQUEST_TIMEOUT_MS = 10000;
  var TYPING_MS = 650;
  var IDLE_MS = 5 * 60 * 1000;

  // Empty baseUrl is valid and means "same origin" (the page's own server
  // proxies /API/*). Only warn about a non-empty, non-https value.
  if (BASE_URL && !/^https:\/\//i.test(BASE_URL)) {
    try { console.warn("[HotelWidget] baseUrl is not an https URL:", BASE_URL); } catch (e) {}
  }

  /* ---------- bundled sample data (docs/api_result.md) --------------- */

  function toList(map, idKey, nameKey) {
    return Object.keys(map).map(function (k) {
      var o = {}; o[idKey] = String(k); o[nameKey] = map[k]; return o;
    });
  }

  var SAMPLE = {
    cities: toList({
      28: "Ahmedabad", 31: "Alwar", 33: "Becharaji", 36: "Bengaluru", 39: "Bharuch",
      22: "Bhopal", 47: "Chhatrapati Sambhajinagar", 50: "Daman", 52: "Darjeeling",
      55: "Dehradun", 27: "Delhi", 58: "Deoghar", 60: "Digha", 29: "Dwarka",
      32: "Gandhinagar", 34: "Gir Forest", 37: "Goa", 40: "Greater Noida", 42: "Haldwani",
      45: "Haridwar", 48: "Himmatnagar", 8: "Indore", 53: "Jaipur", 56: "Jodhpur",
      59: "Kolkata", 61: "Mussoorie", 30: "Nagpur", 35: "Phaltan", 38: "Pune", 41: "Puri",
      12: "Raipur", 46: "Rajkot", 49: "Rishikesh", 51: "Rudraprayag", 54: "Surat", 14: "Vadodara"
    }, "city_id", "city_name"),
    departments: [
      { department_id: "15", department_name: "Rooms" },
      { department_id: "16", department_name: "Restaurant" },
      { department_id: "17", department_name: "Banquets" }
    ],
    propsByCity: {
      "8": [
        { hotel_id: "27", hotel_name: "Pride Hotel and Convention Centre, Indore" },
        { hotel_id: "28", hotel_name: "Pride Plaza Indore" }
      ]
    }
  };

  function sampleResponse(path, reqBody) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (path.indexOf("getCities") !== -1) return resolve(SAMPLE.cities.slice());
        if (path.indexOf("department_list") !== -1) return resolve(SAMPLE.departments.slice());
        if (path.indexOf("getPropertyByCity") !== -1) {
          var id = String(reqBody && reqBody.city_id);
          var list = SAMPLE.propsByCity[id];
          if (!list) {
            var match = SAMPLE.cities.filter(function (c) { return c.city_id === id; })[0];
            var cname = (match && match.city_name) || "the city";
            list = [{ hotel_id: "27", hotel_name: "Pride Hotel, " + cname }];
          }
          return resolve(list.slice());
        }
        resolve([]);
      }, 350);
    });
  }

  /* ---------- state ------------------------------------------------- */

  function freshAnswers() {
    return {
      name: "", phone: "",
      city_id: null, city_name: "",
      hotel_id: null, hotel_name: "",
      department_id: null, department_name: "",
      query: "",
      check_in_date: null,
      check_out_date: null,
      dining_date: null,
      guests: "",
      meal_time: "",
      event_type: "",
      min_headcount: "",
      event_timing: ""
    };
  }

  var state = {
    started: false,
    step: null,
    busy: false,
    ended: false,
    idleTimer: null,
    retry: null,
    cities: null,
    lastCityTyped: "",
    answers: freshAnswers()
  };

  /* ---------- DOM refs -------------------------------------------- */

  var btn, panel, body, footer, input, sendBtn, errLine, acWrap, acDrop;

  /* ---------- small helpers ------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // static developer-authored markup only — never called with user text
  function svgSpan(markup, cls) {
    var s = document.createElement("span");
    if (cls) s.className = cls;
    s.innerHTML = markup;
    return s;
  }

  function sanitizeText(v, max) {
    var s = String(v == null ? "" : v);
    s = s.replace(/[\x00-\x1F\x7F]/g, " "); // control chars
    s = s.replace(/[<>]/g, "");                    // defang stray markup
    s = s.replace(/\s{2,}/g, " ").trim();
    if (max && s.length > max) s = s.slice(0, max);
    return s;
  }

  function digitsOnly(v) {
    return String(v == null ? "" : v).replace(/\D+/g, "");
  }

  function validName(v) {
    var s = sanitizeText(v, 60);
    var letters = s.replace(/[^A-Za-z\u00C0-\u014F\u0900-\u097F]/g, "");
    return letters.length >= 2 ? s : null;
  }

  function validPhone(v) {
    var d = digitsOnly(v);
    if (d.length === 12 && d.indexOf("91") === 0) d = d.slice(2);
    else if (d.length === 11 && d.charAt(0) === "0") d = d.slice(1);
    return /^\d{10}$/.test(d) ? d : null;
  }

  function editDistance(a, b) {
    a = a || ""; b = b || "";
    var m = a.length, n = b.length, i, j;
    if (!m) return n;
    if (!n) return m;
    var prev = [], cur = [];
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  function scrollDown() {
    try { body.scrollTop = body.scrollHeight; } catch (e) {}
  }

  /* ---------- storage ------------------------------------------- */

  function storeKey() { return "hotelwidget:contact:" + (BASE_URL || "default"); }

  function loadContact() {
    try {
      var raw = window.localStorage.getItem(storeKey());
      if (!raw) return null;
      var o = JSON.parse(raw);
      var n = validName(o && o.name);
      var p = validPhone(o && o.phone);
      return (n && p) ? { name: n, phone: p } : null;
    } catch (e) { return null; }
  }

  function saveContact(name, phone) {
    try {
      window.localStorage.setItem(storeKey(), JSON.stringify({ name: name, phone: phone }));
    } catch (e) {}
  }

  /* ---------- API layer --------------------------------------- */

  function api(path, reqBody) {
    if (SAMPLE_MODE) return sampleResponse(path, reqBody);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    return fetch(BASE_URL + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody || {}),
      signal: ctrl.signal
    }).then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (j) {
      if (!j || j.status !== true || !Array.isArray(j.data)) {
        throw new Error("unexpected API response");
      }
      return j.data;
    }).finally(function () { clearTimeout(timer); });
  }

  function postLead(payload) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    return fetch(BASE_URL + "/API/save_lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    }).then(function (r) {
      return r.json().catch(function () { return null; });
    }).then(function (res) {
      try { console.log("[HotelWidget] save_lead response:", res); } catch (e) {}
      return res;
    }).catch(function (err) {
      try { console.warn("[HotelWidget] save_lead failed:", err && err.message); } catch (e) {}
    }).finally(function () { clearTimeout(timer); });
  }

  /* ---------- rendering primitives --------------------------- */

  function botDate() {
    var d = new Date();
    var day = d.toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
    var time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    body.appendChild(el("div", "hw-date", day + ", " + time));
    scrollDown();
  }

  function row(kind) {
    var r = el("div", "hw-msg hw-" + kind);
    var b = el("div", "hw-bubble");
    r.appendChild(b);
    body.appendChild(r);
    scrollDown();
    resetIdle();
    return b;
  }

  function botMsg(text) { row("bot").textContent = text; }
  function sentMsg(text) { row("user").textContent = text; }

  function renderChips(items, cb) {
    var wrap = el("div", "hw-chips");
    items.forEach(function (it) {
      var c = el("button", "hw-chip", it.label);
      c.type = "button";
      c.addEventListener("click", function () {
        if (state.busy || wrap.getAttribute("data-done")) return;
        wrap.setAttribute("data-done", "1");
        Array.prototype.forEach.call(wrap.children, function (ch) {
          ch.disabled = true;
          if (ch !== c) ch.classList.add("hw-chip-dim");
        });
        cb(it.value, it.label);
      });
      wrap.appendChild(c);
    });
    body.appendChild(wrap);
    scrollDown();
    resetIdle();
  }

  /* ---------- date helpers + picker ------------------------- */

  function toISODate(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function addDaysISO(iso, n) {
    var parts = String(iso).split("-").map(Number);
    var dt = new Date(parts[0], parts[1] - 1, parts[2]);
    dt.setDate(dt.getDate() + n);
    return toISODate(dt);
  }

  function formatDateLabel(iso) {
    var parts = String(iso).split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2])
      .toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }

  function renderDatePicker(opts, cb) {
    var msg = el("div", "hw-msg hw-bot");
    var card = el("div", "hw-datepicker");
    var inner = el("div", "hw-datepicker-inner");
    var dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.min = opts.min || todayISO();
    dateInput.max = opts.max || "9999-12-31";
    var err = el("div", "hw-datepicker-err");
    var ok = el("button", "hw-chip", "Confirm");
    ok.type = "button";
    ok.addEventListener("click", function () {
      if (state.busy || card.getAttribute("data-done")) return;
      var val = dateInput.value;
      if (!val) {
        err.textContent = "Please choose a date.";
        err.style.display = "block";
        return;
      }
      if (opts.after && val <= opts.after) {
        err.textContent = "Please choose a date after " + formatDateLabel(opts.after) + ".";
        err.style.display = "block";
        return;
      }
      card.setAttribute("data-done", "1");
      ok.disabled = true;
      dateInput.disabled = true;
      cb(val);
    });
    inner.appendChild(dateInput);
    inner.appendChild(ok);
    card.appendChild(inner);
    card.appendChild(err);
    msg.appendChild(card);
    body.appendChild(msg);
    scrollDown();
    resetIdle();
  }

  function setTyping(on) {
    var existing = body.querySelector(".hw-typing");
    if (on) {
      if (existing) return;
      var t = el("div", "hw-msg hw-bot hw-typing");
      var b = el("div", "hw-bubble");
      b.appendChild(el("span", "hw-dot"));
      b.appendChild(el("span", "hw-dot"));
      b.appendChild(el("span", "hw-dot"));
      t.appendChild(b);
      body.appendChild(t);
      scrollDown();
    } else if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function typingThen(fn) {
    state.busy = true;
    setTyping(true);
    setTimeout(function () {
      setTyping(false);
      state.busy = false;
      fn();
    }, TYPING_MS);
  }

  function inlineError(msg) {
    errLine.textContent = msg;
    errLine.style.display = "block";
    resetIdle();
  }
  function hideError() {
    errLine.style.display = "none";
    errLine.textContent = "";
  }

  function expectText(placeholder, maxLen) {
    hideAC();
    input.disabled = false;
    sendBtn.disabled = false;
    input.placeholder = placeholder || "Write a reply…";
    input.maxLength = maxLen || 80;
    input.value = "";
    resetIdle();
    try { input.focus(); } catch (e) {}
  }
  function disableInput(placeholder) {
    hideAC();
    input.disabled = true;
    sendBtn.disabled = true;
    input.value = "";
    input.placeholder = placeholder || "…";
  }

  function apiError() {
    setTyping(false);
    state.busy = false;
    botMsg("Sorry, I'm having trouble reaching our system right now.");
    renderChips([{ label: "Try again", value: "__retry__" }], function () {
      if (typeof state.retry === "function") state.retry();
    });
  }
  function guardedApi(fn) {
    state.retry = fn;
    fn();
  }

  /* ---------- city autocomplete ----------------------------- */

  var acIndex = -1;

  function showAC(query) {
    if (!acDrop || !state.cities || state.step !== "city") { hideAC(); return; }
    var q = (query || "").toLowerCase().trim();
    if (!q) { hideAC(); return; }

    var matches = state.cities.filter(function (c) {
      return String(c.city_name).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) {
      var ad = String(a.city_name).toLowerCase().indexOf(q);
      var bd = String(b.city_name).toLowerCase().indexOf(q);
      return (ad - bd) || String(a.city_name).localeCompare(String(b.city_name));
    }).slice(0, 8);

    if (!matches.length) { hideAC(); return; }

    acDrop.innerHTML = "";
    acIndex = 0;

    matches.forEach(function (c, i) {
      var item = el("div", "hw-ac-item");
      if (i === 0) item.classList.add("hw-ac-active");
      var name = String(c.city_name);
      var lowerName = name.toLowerCase();
      var pos = lowerName.indexOf(q);
      if (pos !== -1) {
        item.appendChild(document.createTextNode(name.slice(0, pos)));
        var mark = el("span", "hw-ac-item-mark", name.slice(pos, pos + q.length));
        item.appendChild(mark);
        item.appendChild(document.createTextNode(name.slice(pos + q.length)));
      } else {
        item.textContent = name;
      }
      item.addEventListener("mousedown", function (e) {
        e.preventDefault();
        selectACCity(c);
      });
      item.setAttribute("data-city-id", String(c.city_id));
      acDrop.appendChild(item);
    });

    acDrop.classList.add("hw-ac-open");
  }

  function hideAC() {
    if (!acDrop) return;
    acDrop.classList.remove("hw-ac-open");
    acDrop.innerHTML = "";
    acIndex = -1;
  }

  function highlightAC(dir) {
    var items = acDrop.querySelectorAll(".hw-ac-item");
    if (!items.length) return;
    if (acIndex >= 0 && items[acIndex]) items[acIndex].classList.remove("hw-ac-active");
    acIndex += dir;
    if (acIndex < 0) acIndex = items.length - 1;
    if (acIndex >= items.length) acIndex = 0;
    items[acIndex].classList.add("hw-ac-active");
    items[acIndex].scrollIntoView({ block: "nearest" });
  }

  function selectACHighlighted() {
    var items = acDrop.querySelectorAll(".hw-ac-item");
    if (acIndex < 0 || acIndex >= items.length) return false;
    var id = items[acIndex].getAttribute("data-city-id");
    var c = (state.cities || []).filter(function (x) { return String(x.city_id) === id; })[0];
    if (c) { selectACCity(c); return true; }
    return false;
  }

  function selectACCity(c) {
    hideAC();
    input.value = "";
    sentMsg(String(c.city_name));
    pickCity(c);
  }

  function onACInput() {
    if (state.step === "city") showAC(input.value);
  }

  function onACKeydown(e) {
    if (state.step !== "city" || !acDrop.classList.contains("hw-ac-open")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlightAC(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlightAC(-1); }
    else if (e.key === "Enter" && acIndex >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectACHighlighted();
    }
    else if (e.key === "Escape") { hideAC(); }
  }

  function prefetchCities() {
    if (state.cities) return;
    api("/API/getCities", {}).then(function (cities) {
      state.cities = cities;
    }).catch(function () {});
  }

  /* ---------- conversation flow ----------------------------- */

  function start() {
    if (state.started) return;
    state.started = true;
    botDate();
    botMsg("Hi, I am Xoomi, your personal AI assistant by TheXoombox");
    var saved = loadContact();
    if (saved) {
      state.answers.name = saved.name;
      state.answers.phone = saved.phone;
      typingThen(function () {
        botMsg("Welcome back, " + saved.name + "! Let's continue.");
        typingThen(askCity);
      });
    } else {
      typingThen(askName);
    }
  }

  function askName() {
    state.step = "name";
    botMsg("Before we proceed, kindly help me with your full name.");
    expectText("Enter your full name", 60);
  }

  function askPhone() {
    state.step = "phone";
    botMsg("Hey " + state.answers.name + ", please enter your 10 digit WhatsApp mobile number.");
    expectText("Enter your 10-digit number", 20);
  }

  function askCity() {
    state.step = "city";
    botMsg("Please enter the destination / city of your choice, e.g. Indore, Pune, Goa.");
    expectText("Type a city name", 50);
    prefetchCities();
  }

  function doCityLookup(typed) {
    state.busy = true;
    setTyping(true);
    var p = state.cities ? Promise.resolve(state.cities) : api("/API/getCities", {});
    p.then(function (cities) {
      setTyping(false);
      state.busy = false;
      state.cities = cities;

      var norm = typed.toLowerCase();
      var scored = cities.map(function (c) {
        var name = String(c.city_name).toLowerCase();
        var d;
        if (name === norm) d = -1;
        else if (name.indexOf(norm) === 0) d = 0.5;
        else if (norm.length >= 3 && name.indexOf(norm) !== -1) d = 1;
        else d = editDistance(name, norm);
        return { c: c, d: d };
      }).sort(function (a, b) { return a.d - b.d; });

      if (scored.length && scored[0].d === -1) { pickCity(scored[0].c); return; }

      var near = scored.filter(function (s) { return s.d <= 2; })
        .slice(0, 4).map(function (s) { return s.c; });

      if (!near.length) {
        botMsg("I couldn't find a city matching “" + typed + "”. Could you check the spelling and try again?");
        state.step = "city";
        expectText("Type a city name", 50);
        return;
      }

      botMsg(near.length === 1
        ? ("Did you mean " + near[0].city_name + "?")
        : "Did you mean one of these?");
      var chips = near.map(function (c) {
        return { label: c.city_name, value: "city:" + c.city_id };
      });
      chips.push({ label: "None of these", value: "__retry_city__" });
      renderChips(chips, onCityChip);
    }).catch(apiError);
  }

  function onCityChip(val) {
    if (val === "__retry_city__") {
      botMsg("No problem — please type the city name again.");
      state.step = "city";
      expectText("Type a city name", 50);
      return;
    }
    var id = val.slice(5);
    var c = (state.cities || []).filter(function (x) { return String(x.city_id) === id; })[0];
    if (!c) {
      botMsg("Something went wrong picking that city. Please type it again.");
      state.step = "city";
      expectText("Type a city name", 50);
      return;
    }
    pickCity(c);
  }

  function pickCity(c) {
    state.answers.city_id = String(c.city_id);
    state.answers.city_name = String(c.city_name);
    typingThen(askProperty);
  }

  function askProperty() {
    state.step = "property";
    disableInput("Choose an option above");
    guardedApi(function () {
      state.busy = true;
      setTyping(true);
      api("/API/getPropertyByCity", { city_id: state.answers.city_id }).then(function (props) {
        setTyping(false);
        state.busy = false;
        if (!props.length) {
          botMsg("Sorry, we don't have a listed property in " + state.answers.city_name + " yet.");
          renderChips([{ label: "Pick another city", value: "__retry_city__" }], function () {
            botMsg("Sure — which city?");
            state.step = "city";
            expectText("Type a city name", 50);
          });
          return;
        }
        botMsg("Which property would you like to enquire about?");
        renderChips(props.map(function (p) {
          return { label: String(p.hotel_name), value: "hotel:" + p.hotel_id };
        }), function (val, label) {
          state.answers.hotel_id = val.slice(6);
          state.answers.hotel_name = label;
          sentMsg(label);
          typingThen(askDepartment);
        });
      }).catch(apiError);
    });
  }

  function askDepartment() {
    state.step = "department";
    disableInput("Choose an option above");
    guardedApi(function () {
      state.busy = true;
      setTyping(true);
      api("/API/department_list", {}).then(function (list) {
        setTyping(false);
        state.busy = false;
        if (!list.length) {
          botMsg("No departments are available to choose from right now.");
          renderChips([{ label: "Try again", value: "__retry__" }], function () {
            if (typeof state.retry === "function") state.retry();
          });
          return;
        }
        botMsg("Which department is your enquiry for?");
        renderChips(list.map(function (d) {
          return { label: String(d.department_name), value: "dep:" + d.department_id };
        }), function (val, label) {
          state.answers.department_id = val.slice(4);
          state.answers.department_name = label;
          sentMsg(label);
          typingThen(function () {
            var d = state.answers.department_name.toLowerCase();
            if (d.indexOf("room") !== -1) askCheckIn();
            else if (d.indexOf("restaurant") !== -1) askDiningDate();
            else if (d.indexOf("banquet") !== -1) askEventType();
            else askQuery();
          });
        });
      }).catch(apiError);
    });
  }

  function askQuery() {
    state.step = "query";
    botMsg("Lastly, anything specific you'd like us to know? You can skip this.");
    expectText("Type your message (optional)", 500);
    renderChips([{ label: "Skip", value: "__skip__" }], function () {
      state.answers.query = "";
      disableInput("…");
      typingThen(submitLead);
    });
  }

  /* ---------- department-specific flows ------------------- */

  function askCheckIn() {
    state.step = "checkin";
    disableInput("Choose an option above");
    botMsg("When would you like to check in?");
    renderDatePicker({ min: todayISO() }, function (iso) {
      state.answers.check_in_date = iso;
      sentMsg(formatDateLabel(iso));
      typingThen(askCheckOut);
    });
  }

  function askCheckOut() {
    state.step = "checkout";
    disableInput("Choose an option above");
    botMsg("And when would you like to check out?");
    renderDatePicker({ min: addDaysISO(state.answers.check_in_date, 1), after: state.answers.check_in_date }, function (iso) {
      state.answers.check_out_date = iso;
      sentMsg(formatDateLabel(iso));
      typingThen(askGuests);
    });
  }

  function askGuests() {
    state.step = "guests";
    disableInput("Choose an option above");
    botMsg("How many guests?");
    renderChips([{ label: "1", value: "1" }, { label: "2", value: "2" }, { label: "3", value: "3" }, { label: "4", value: "4" }, { label: "5+", value: "5+" }], function (val, label) {
      state.answers.guests = val;
      sentMsg(label);
      typingThen(askQuery);
    });
  }

  function askDiningDate() {
    state.step = "diningdate";
    disableInput("Choose an option above");
    botMsg("Which date would you like to dine?");
    renderDatePicker({ min: todayISO() }, function (iso) {
      state.answers.dining_date = iso;
      sentMsg(formatDateLabel(iso));
      typingThen(askMealTime);
    });
  }

  function askMealTime() {
    state.step = "mealtime";
    disableInput("Choose an option above");
    botMsg("Which meal are you planning for?");
    renderChips([{ label: "Breakfast", value: "Breakfast" }, { label: "Lunch", value: "Lunch" }, { label: "Dinner", value: "Dinner" }], function (val, label) {
      state.answers.meal_time = val;
      sentMsg(label);
      typingThen(askGuests);
    });
  }

  function askEventType() {
    state.step = "eventtype";
    disableInput("Choose an option above");
    botMsg("What type of event is it?");
    renderChips([
      { label: "Marriage", value: "Marriage" },
      { label: "Out Door Catering", value: "Out Door Catering" },
      { label: "Cultural Events", value: "Cultural Events" },
      { label: "Corporate Events", value: "Corporate Events" },
      { label: "Anniversary", value: "Anniversary" }
    ], function (val, label) {
      state.answers.event_type = val;
      sentMsg(label);
      typingThen(askMinHeadcount);
    });
  }

  function askMinHeadcount() {
    state.step = "headcount";
    disableInput("Choose an option above");
    botMsg("What's the minimum headcount?");
    renderChips([
      { label: "Up to 100", value: "Up to 100" },
      { label: "100-200", value: "100-200" },
      { label: "200-500", value: "200-500" },
      { label: "500+", value: "500+" }
    ], function (val, label) {
      state.answers.min_headcount = val;
      sentMsg(label);
      typingThen(askEventTiming);
    });
  }

  function askEventTiming() {
    state.step = "eventtiming";
    disableInput("Choose an option above");
    botMsg("Which timing suits you?");
    renderChips([
      { label: "Morning", value: "Morning" },
      { label: "Afternoon", value: "Afternoon" },
      { label: "Evening", value: "Evening" },
      { label: "Night", value: "Night" }
    ], function (val, label) {
      state.answers.event_timing = val;
      sentMsg(label);
      typingThen(askQuery);
    });
  }

  /* ---------- payload + submit ------------------------------ */

  function toIdMaybeNumber(v) {
    if (v == null || v === "") return null;
    return /^\d+$/.test(String(v)) ? Number(v) : String(v);
  }

  function firstNumber(v) {
    if (v == null || v === "") return null;
    var m = String(v).match(/\d+/);
    return m ? Number(m[0]) : null;
  }

  function buildPayload() {
    var a = state.answers;
    var extras = [];
    if (a.check_out_date) extras.push("Check-out: " + a.check_out_date);
    if (a.meal_time) extras.push("Meal: " + a.meal_time);
    if (a.event_type) extras.push("Event: " + a.event_type);
    if (a.min_headcount) extras.push("Minimum headcount: " + a.min_headcount);
    if (a.event_timing) extras.push("Timing: " + a.event_timing);
    return {
      name: a.name || "",
      email: "",
      phone: a.phone || "",
      property: toIdMaybeNumber(a.hotel_id),
      department: toIdMaybeNumber(a.department_id),
      comments: extras.join(", "),
      query: a.query || "",
      user_channel: "Website Chatbot",
      pax: firstNumber(a.guests) || firstNumber(a.min_headcount) || null,
      booking_date: a.check_in_date || a.dining_date || null,
      restaurant_id: null,
      time_slot_id: null
    };
  }

  function submitLead() {
    state.step = null;
    disableInput("…");

    var payload = buildPayload();

    window.HotelWidget = window.HotelWidget || {};
    window.HotelWidget.lastSubmission = {
      payload: payload,
      at: new Date().toISOString(),
      mode: SAMPLE_MODE ? "sample" : "live-api"
    };
    try {
      window.dispatchEvent(new CustomEvent("hotelwidget:lead", {
        detail: window.HotelWidget.lastSubmission
      }));
    } catch (e) {}
    try { console.log("[HotelWidget] lead payload (NOT sent):", payload); } catch (e) {}

    // ─────────────────────────────────────────────────────────────────
    // save_lead is intentionally NOT called during testing.
    // Uncomment the next line to POST the payload to {baseUrl}/API/save_lead.
    postLead(payload);
    // ─────────────────────────────────────────────────────────────────

    finish();
  }

  function finish() {
    typingThen(function () {
      botMsg("Thank you for getting in touch with us. One of our executives will get back to you shortly.");
      state.ended = true;
      if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
      renderChips([
        { label: "Main Menu", value: "__menu__" },
        { label: "Exit", value: "__exit__" }
      ], function (val) {
        if (val === "__menu__") restart();
        else closePanel();
      });
    });
  }

  function restart() {
    body.innerHTML = "";
    hideError();
    hideAC();
    state.step = null;
    state.busy = false;
    state.ended = false;
    state.retry = null;
    state.cities = null;
    state.lastCityTyped = "";
    state.answers = freshAnswers();
    state.started = false;
    start();
  }

  /* ---------- text-input handler --------------------------- */

  function onTextSubmit(raw) {
    if (state.busy || state.ended || input.disabled) return;
    hideError();
    var step = state.step;

    if (step === "name") {
      var n = validName(raw);
      if (!n) { inlineError("Please enter your full name (at least 2 letters)."); return; }
      state.answers.name = n;
      input.value = "";
      sentMsg(n);
      typingThen(askPhone);

    } else if (step === "phone") {
      var p = validPhone(raw);
      if (!p) { inlineError("Please enter a valid 10-digit mobile number."); return; }
      state.answers.phone = p;
      input.value = "";
      sentMsg(p);
      saveContact(state.answers.name, p);
      typingThen(askCity);

    } else if (step === "city") {
      var typed = sanitizeText(raw, 50);
      if (typed.length < 2) { inlineError("Please type a city name."); return; }
      input.value = "";
      sentMsg(typed);
      state.lastCityTyped = typed;
      disableInput("Looking that up…");
      guardedApi(function () { doCityLookup(state.lastCityTyped); });

    } else if (step === "query") {
      var q = sanitizeText(raw, 500);
      state.answers.query = q;
      input.value = "";
      if (q) sentMsg(q);
      disableInput("…");
      typingThen(submitLead);
    }
  }

  /* ---------- idle timeout -------------------------------- */

  function isOpen() { return panel.classList.contains("hw-open"); }

  function resetIdle() {
    if (!isOpen()) return;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    if (state.ended) return;
    state.idleTimer = setTimeout(onIdle, IDLE_MS);
  }

  function onIdle() {
    if (!isOpen() || state.ended) return;
    body.innerHTML = "";
    disableInput("Session timed out");
    row("bot").textContent = "Session timed out due to inactivity.";
    state.ended = true;
    renderChips([{ label: "Start a new conversation", value: "__restart__" }], function () {
      restart();
    });
  }

  /* ---------- shell + wiring ------------------------------ */

  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  // Header avatar image: set window.HotelAIConfig.avatarUrl to your CDN URL,
  // otherwise it falls back to {baseUrl}/xoomi.png.
  var AVATAR_URL = String(cfg.avatarUrl || "https://thexoombox.com/xoomi.png").trim() || "";

  function avatarEl() {
    var img = document.createElement("img");
    img.className = "hw-avatar-img";
    img.src = AVATAR_URL;
    img.alt = HOTEL_NAME;
    img.loading = "lazy";
    return img;
  }

  function injectStyle() {
    var css = [
      '.hw-btn,.hw-panel,.hw-panel *{box-sizing:border-box;}',
      '.hw-btn{position:fixed;right:22px;bottom:22px;width:58px;height:58px;border:0;border-radius:50%;cursor:pointer;z-index:2147483000;background:#3a2e2a;color:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.28);transition:transform .18s ease,box-shadow .18s ease;padding:0;}',
      '.hw-btn:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 12px 30px rgba(0,0,0,.34);}',
      '.hw-btn.hw-hidden{display:none;}',
      '.hw-btn-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;}',
      '.hw-panel{position:fixed;right:22px;bottom:22px;width:372px;height:588px;max-height:calc(100vh - 44px);background:#f1eeec;border-radius:16px;overflow:hidden;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#2b2320;display:flex;flex-direction:column;box-shadow:0 18px 50px rgba(0,0,0,.32);opacity:0;transform:translateY(16px) scale(.98);pointer-events:none;transition:opacity .22s ease,transform .22s ease;}',
      '.hw-panel.hw-open{opacity:1;transform:none;pointer-events:auto;}',
      '.hw-header{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:14px 16px;background:#3a2e2a;color:#fff;}',
      '.hw-avatar-img{width:34px;height:34px;border-radius:50%;object-fit:cover;flex:0 0 auto;background:#c9b7a3;}',
      '.hw-title{flex:1 1 auto;font-weight:600;font-size:15px;}',
      '.hw-x{border:0;background:transparent;color:#fff;font-size:22px;line-height:1;cursor:pointer;opacity:.8;padding:4px;}',
      '.hw-x:hover{opacity:1;}',
      '.hw-body{flex:1 1 auto;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;}',
      '.hw-date{align-self:center;font-size:11px;color:#9a9088;margin:2px 0 4px;}',
      '.hw-msg{display:flex;max-width:84%;}',
      '.hw-msg.hw-bot{align-self:flex-start;}',
      '.hw-msg.hw-user{align-self:flex-end;}',
      '.hw-bubble{padding:10px 13px;border-radius:14px;line-height:1.45;word-wrap:break-word;overflow-wrap:anywhere;white-space:pre-wrap;}',
      '.hw-bot .hw-bubble{background:#fff;border:1px solid #e7e2dd;border-bottom-left-radius:5px;}',
      '.hw-user .hw-bubble{background:#6f574a;color:#fff;border-bottom-right-radius:5px;}',
      '.hw-chips{display:flex;flex-wrap:wrap;gap:8px;align-self:flex-start;max-width:92%;}',
      '.hw-chip{border:1.5px solid #cbbfb4;background:#fff;color:#3a2e2a;padding:8px 14px;border-radius:999px;font-size:13px;cursor:pointer;font-family:inherit;transition:background .15s ease,color .15s ease,transform .1s ease;}',
      '.hw-chip:hover{background:#3a2e2a;color:#fff;}',
      '.hw-chip:disabled{cursor:default;}',
      '.hw-chip.hw-chip-dim{opacity:.45;}',
      '.hw-chip:not(:disabled):active{transform:translateY(1px);}',
      '.hw-typing .hw-bubble{display:flex;gap:4px;align-items:center;}',
      '.hw-dot{width:6px;height:6px;border-radius:50%;background:#b3a89e;animation:hw-bounce 1.3s infinite ease-in-out;}',
      '.hw-dot:nth-child(2){animation-delay:.18s;}',
      '.hw-dot:nth-child(3){animation-delay:.36s;}',
      '@keyframes hw-bounce{0%,80%,100%{transform:translateY(0);opacity:.5;}40%{transform:translateY(-5px);opacity:1;}}',
      '.hw-err{flex:0 0 auto;color:#b3261e;font-size:12px;padding:6px 16px 0;display:none;}',
      '.hw-footer{flex:0 0 auto;display:flex;gap:8px;padding:12px 14px 14px;background:#f1eeec;border-top:1px solid #e4ded8;}',
      '.hw-input{flex:1 1 auto;min-width:0;border:1.5px solid #ecd9c9;background:#fbf3ec;color:#2b2320;border-radius:999px;padding:11px 15px;font-size:14px;font-family:inherit;outline:none;}',
      '.hw-input:focus{border-color:#c79a76;}',
      '.hw-input:disabled{background:#efeae5;border-color:#e4ded8;color:#9a9088;}',
      '.hw-input::placeholder{color:#a99e93;}',
      '.hw-send{flex:0 0 auto;width:42px;height:42px;border:0;border-radius:50%;background:#3a2e2a;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
      '.hw-send:disabled{background:#cabfb4;cursor:default;}',
      '.hw-send svg{width:18px;height:18px;}',
      '.hw-datepicker{background:#fff;border:1px solid #e7e2dd;border-radius:14px;border-bottom-left-radius:5px;padding:10px 12px;max-width:100%;}',
      '.hw-datepicker-inner{display:flex;gap:8px;align-items:center;}',
      '.hw-datepicker input[type=date]{flex:1;min-width:0;border:1.5px solid #ecd9c9;background:#fbf3ec;color:#2b2320;border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;outline:none;}',
      '.hw-datepicker input[type=date]:focus{border-color:#c79a76;}',
      '.hw-datepicker .hw-chip{white-space:nowrap;}',
      '.hw-datepicker-err{color:#b3261e;font-size:12px;margin-top:6px;display:none;}',
      '.hw-powered{flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 14px 10px;background:#f1eeec;font-size:11px;color:#9a9088;text-decoration:none;}',
      '.hw-powered img{height:14px;width:auto;}',
      '.hw-powered:hover{text-decoration:underline;}',
      '.hw-ac-wrap{position:relative;display:flex;gap:8px;flex:1 1 auto;min-width:0;}',
      '.hw-ac{position:absolute;bottom:100%;left:0;right:0;max-height:180px;overflow-y:auto;background:#fff;border:1.5px solid #e7e2dd;border-bottom:0;border-radius:12px 12px 0 0;z-index:10;display:none;box-shadow:0 -4px 12px rgba(0,0,0,.1);}',
      '.hw-ac.hw-ac-open{display:block;}',
      '.hw-ac-item{padding:10px 14px;cursor:pointer;font-size:13px;color:#2b2320;border-bottom:1px solid #f0ebe6;transition:background .1s;}',
      '.hw-ac-item:last-child{border-bottom:0;}',
      '.hw-ac-item:hover,.hw-ac-item.hw-ac-active{background:#f5efe9;}',
      '.hw-ac-item-mark{background:#e8dfd6;border-radius:3px;padding:0 2px;}',
      '@media (max-width:480px){.hw-panel{right:0;bottom:0;width:100vw;height:100vh;height:100dvh;max-height:none;border-radius:0;}.hw-btn{right:16px;bottom:16px;}}'
    ].join("\n");
    var style = document.createElement("style");
    style.setAttribute("data-hotelwidget", "1");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function build() {
    if (document.querySelector(".hw-panel")) return; // guard double-load
    injectStyle();

    var btn = el("button", "hw-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", "Open chat");
    var btnImg = document.createElement("img");
    btnImg.className = "hw-btn-img";
    btnImg.src = AVATAR_URL;
    btnImg.alt = HOTEL_NAME;
    btn.appendChild(btnImg);

    panel = el("div", "hw-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", HOTEL_NAME + " chat");

    var header = el("div", "hw-header");
    header.appendChild(avatarEl());
    header.appendChild(el("div", "hw-title", HOTEL_NAME));
    var x = el("button", "hw-x");
    x.type = "button";
    x.setAttribute("aria-label", "Close chat");
    x.textContent = "×";
    header.appendChild(x);

    body = el("div", "hw-body");

    errLine = el("div", "hw-err");

    footer = el("form", "hw-footer");
    footer.setAttribute("novalidate", "novalidate");

    acWrap = el("div", "hw-ac-wrap");
    acDrop = el("div", "hw-ac");
    acWrap.appendChild(acDrop);

    input = el("input", "hw-input");
    input.type = "text";
    input.autocomplete = "off";
    input.setAttribute("autocapitalize", "off");
    input.disabled = true;
    sendBtn = el("button", "hw-send");
    sendBtn.type = "submit";
    sendBtn.disabled = true;
    sendBtn.setAttribute("aria-label", "Send");
    sendBtn.appendChild(svgSpan(ICON_SEND));
    acWrap.appendChild(input);
    acWrap.appendChild(sendBtn);
    footer.appendChild(acWrap);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(errLine);
    panel.appendChild(footer);

    var powered = document.createElement("a");
    powered.className = "hw-powered";
    powered.href = "https://thexoombox.com";
    powered.target = "_blank";
    powered.rel = "noopener noreferrer";
    powered.textContent = "Powered by ";
    var poweredImg = document.createElement("img");
    poweredImg.src = "https://thexoombox.com/xoombox_logo.png";
    poweredImg.alt = "TheXoombox";
    powered.appendChild(poweredImg);
    panel.appendChild(powered);

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    btn.addEventListener("click", togglePanel);
    x.addEventListener("click", closePanel);
    footer.addEventListener("submit", function (e) {
      e.preventDefault();
      onTextSubmit(input.value);
    });
    input.addEventListener("input", function () {
      if (errLine.style.display === "block") hideError();
      onACInput();
    });
    input.addEventListener("keydown", onACKeydown);
    document.addEventListener("mousedown", function (e) {
      if (acWrap && !acWrap.contains(e.target)) hideAC();
    });
  }

  function togglePanel() { isOpen() ? closePanel() : openPanel(); }

  function openPanel() {
    panel.classList.add("hw-open");
    btn.classList.add("hw-hidden");
    if (!state.started) start();
    resetIdle();
  }

  function closePanel() {
    panel.classList.remove("hw-open");
    btn.classList.remove("hw-hidden");
    if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
