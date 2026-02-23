/**
 * UPLINK_CAM — Sync-jump, Black Box Chat, Snapshot, Node Matrix
 * Feeds from cams.json (scraper output).
 */

(function () {
  "use strict";

  const SHIFT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — everyone jumps at same UTC window
  const FEED_REFRESH_MS = 3000;
  const MSG_BURN_MS = 60 * 1000;
  const STORAGE_CALLSIGN = "uplink_callsign";
  const STORAGE_CHAT = "uplink_chat";
  let cams = [];
  let currentIndex = 0;
  let feedRefreshTimer = null;
  let countdownTimer = null;
  let visibleFeedEl = null;
  let preloadFeedEl = null;
  let feedAudioCtx = null;
  let feedAmbientSource = null;
  let feedAmbientGain = null;
  let feedAmbientUserMuted = false;
  let feedMatrixOpen = false;

  // Approximate lat/long for map (city/country or country fallback)
  const LOC_TO_COORDS = {
    "Tokyo, Japan": [35.68, 139.69],
    "TOKYO, Japan": [35.68, 139.69],
    "Meguro-ku, Japan": [35.63, 139.7],
    "Barcelona, Spain": [41.38, 2.17],
    "Delhi, India": [28.61, 77.21],
    "Orlando, United States": [28.54, -81.38],
    "KHARKIV, Ukraine": [49.99, 36.23],
    "Buenos Aires, Argentina": [-34.61, -58.38],
    "Iiyama, Japan": [36.85, 138.35],
    "Minden, Germany": [52.29, 8.92],
    "Porirua, New Zealand": [-41.13, 174.84],
    "Imola, Italy": [44.35, 11.71],
    "San Nicolas de los G, Mexico": [25.76, -100.3],
    "Madrid, Spain": [40.42, -3.7],
    "Bodegraven, Netherlands": [52.08, 4.75],
    "Milan, Italy": [45.46, 9.19],
    "Nagano, Japan": [36.65, 138.19],
    "Novi Pazar, Serbia": [43.14, 20.52],
    "HYDERABAD, India": [17.39, 78.48],
    "Juarez, Mexico": [31.69, -106.42],
    "Mendoza, Argentina": [-32.89, -68.83],
    "Lima, Peru": [-12.05, -77.04],
    "Blairsville, United States": [34.88, -83.96],
    "Sochi, Russian Federation": [43.59, 39.73],
  };

  const COUNTRY_CENTER = {
    Japan: [36.2, 138.25],
    Spain: [40.4, -3.7],
    India: [20.6, 78.96],
    "United States": [37.1, -95.7],
    Ukraine: [48.38, 31.17],
    Argentina: [38.42, -63.62],
    Germany: [51.17, 10.45],
    "New Zealand": [-40.9, 174.89],
    Italy: [41.87, 12.57],
    Mexico: [23.63, -102.55],
    Netherlands: [52.13, 5.29],
    Serbia: [44.02, 20.92],
    Peru: [-9.19, -75.02],
    "Russian Federation": [61.52, 105.32],
    Russia: [61.52, 105.32],
    Brazil: [-14.24, -51.93],
    "United Kingdom": [55.38, -3.44],
    France: [46.23, 2.21],
    China: [35.86, 104.2],
    Turkey: [38.96, 35.24],
    Poland: [51.92, 19.15],
    Canada: [56.13, -106.35],
    Australia: [-25.27, 133.78],
    "South Korea": [35.91, 127.77],
    Indonesia: [-0.79, 113.92],
    Thailand: [15.87, 100.99],
    "South Africa": [-30.56, 22.94],
    Egypt: [26.82, 30.8],
    Colombia: [4.57, -74.3],
    Chile: [-35.68, -71.54],
    Romania: [45.94, 24.97],
    Greece: [39.07, 21.82],
    Portugal: [39.4, -8.22],
    Czechia: [49.82, 15.47],
    Hungary: [47.16, 19.5],
    Austria: [47.52, 14.55],
    Switzerland: [46.82, 8.23],
    Belgium: [50.5, 4.47],
    Sweden: [62.2, 17.64],
    Norway: [60.47, 8.47],
    Finland: [61.92, 25.75],
    Croatia: [45.1, 15.2],
    Slovakia: [48.67, 19.7],
    Bulgaria: [42.73, 25.49],
    Philippines: [12.88, 121.77],
    Vietnam: [14.06, 108.28],
    Malaysia: [4.21, 101.98],
    Israel: [31.05, 34.85],
    "Saudi Arabia": [23.89, 45.08],
    "United Arab Emirates": [23.42, 53.85],
  };

  function normalizeUrl(url) {
    if (!url) return "";
    return url.replace(/&amp;/g, "&");
  }

  /** When page is HTTPS, browser blocks HTTP images (mixed content). Use same-origin proxy so feeds work when server is deployed. */
  function feedDisplayUrl(camUrl) {
    if (!camUrl) return "";
    const withTime = camUrl + (camUrl.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
    if (window.location.protocol === "https:" && camUrl.startsWith("http://"))
      return "/feed-proxy?url=" + encodeURIComponent(withTime);
    return withTime;
  }

  function parseLocation(locationStr) {
    const match = locationStr && locationStr.match(/\s+in\s+(.+)$/);
    return match ? match[1].trim() : "Unknown";
  }

  function extractIP(url) {
    if (!url) return "—";
    const m = url.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    return m ? m[1] : "—";
  }

  const ipInfoCache = {};
  function fetchIpInfo(ip, callback) {
    if (!ip || ip === "—") {
      callback(null);
      return;
    }
    if (ipInfoCache[ip] !== undefined) {
      callback(ipInfoCache[ip]);
      return;
    }
    function use(data) {
      ipInfoCache[ip] = data;
      callback(data);
    }
    function tryDirect() {
      fetch("https://ipinfo.io/" + encodeURIComponent(ip) + "/json")
        .then((r) => r.ok ? r.json() : null)
        .then(use)
        .catch(function () {
          ipInfoCache[ip] = null;
          callback(null);
        });
    }
    fetch("/ipinfo?ip=" + encodeURIComponent(ip))
      .then(function (r) {
        if (r.ok) return r.json();
        throw new Error("proxy failed");
      })
      .then(use)
      .catch(function () {
        tryDirect();
      });
  }

  function formatUptime(ms) {
    if (ms == null || ms < 0) return "—";
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60000) % 60;
    const h = Math.floor(ms / 3600000);
    return h + "h " + String(m).padStart(2, "0") + "m " + String(s).padStart(2, "0") + "s";
  }

  function getUptimeMs(cam) {
    const ts = cam.first_seen_ts != null ? Number(cam.first_seen_ts) : NaN;
    if (Number.isFinite(ts)) return Date.now() - ts;
    const str = cam.first_seen;
    if (!str) return null;
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return Date.now() - d.getTime();
  }

  function getLastSeenMs(cam) {
    const str = cam.last_seen;
    if (!str) return null;
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return Date.now() - d.getTime();
  }

  function updateNodeHUD(cam) {
    const ipLink = document.getElementById("ip-link");
    const mapLink = document.getElementById("map-link");
    const localTimeEl = document.getElementById("local-time");
    const netIspEl = document.getElementById("net-isp");
    const netAsnEl = document.getElementById("net-asn");
    const nodeUptimeEl = document.getElementById("node-uptime");
    const ip = extractIP(cam.url);

    if (ipLink) {
      ipLink.textContent = "SRC_IP: " + ip;
      ipLink.href = ip !== "—" ? "https://ipinfo.io/" + ip : "#";
    }
    if (mapLink) {
      mapLink.href =
        "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(cam.locationShort);
      mapLink.textContent = "LOC: " + cam.locationShort;
    }
    if (localTimeEl)
      localTimeEl.textContent =
        "LOCAL_TIME: " + new Date().toISOString().slice(0, 19).replace("T", " ");

    if (netIspEl) netIspEl.textContent = "NET_ISP: —";
    if (netAsnEl) netAsnEl.textContent = "ASN: —";
    if (netIspEl) netIspEl.textContent = "NET_ISP: …";
    if (netAsnEl) netAsnEl.textContent = "ASN: …";
    fetchIpInfo(ip, (data) => {
      if (!data || data.error) {
        if (netIspEl) netIspEl.textContent = "NET_ISP: —";
        if (netAsnEl) netAsnEl.textContent = "ASN: —";
        return;
      }
      const org = data.org || data.organisation || "";
      const asn = data.asn && data.asn.asn ? String(data.asn.asn) : null;
      if (org || asn) {
        const asMatch = org.match(/^(AS\d+)\s*(.*)$/);
        const asnStr = asn || (asMatch ? asMatch[1] : null);
        const ispStr = asMatch ? asMatch[2].trim() : org;
        if (netAsnEl) netAsnEl.textContent = "ASN: " + (asnStr || org || "—");
        if (netIspEl) netIspEl.textContent = "NET_ISP: " + (ispStr || asnStr || "—");
      } else {
        if (netIspEl) netIspEl.textContent = "NET_ISP: —";
        if (netAsnEl) netAsnEl.textContent = "ASN: —";
      }
    });

    const uptimeMs = getUptimeMs(cam);
    const lastSeenMs = getLastSeenMs(cam);
    const lastSeenRaw = cam.last_seen ? String(cam.last_seen).trim() : null;
    if (nodeUptimeEl) {
      if (uptimeMs != null) {
        nodeUptimeEl.textContent = "NODE_UPTIME: " + formatUptime(uptimeMs);
      } else if (lastSeenMs != null || lastSeenRaw) {
        const ago = lastSeenMs != null ? " (" + formatUptime(lastSeenMs) + " ago)" : "";
        nodeUptimeEl.textContent = "LAST_SEEN: " + (lastSeenRaw || "—") + ago;
      } else {
        nodeUptimeEl.textContent = "NODE_UPTIME: —";
      }
    }

    updateReportLink(ip, cam.id);
    updateWeather(cam.locationShort);
  }

  function updateReportLink(ip, id) {
    const el = document.getElementById("report-link");
    if (!el) return;
    const email = "uplink_cam@proton.me";
    const subject = "SIGNAL_REPORT: " + (id != null ? id : "—");
    const body =
      "REQUESTING OPERATOR REVIEW FOR NODE: " + (id != null ? id : "—") +
      "\nIP_ADDRESS: " + (ip || "—") +
      "\nREASON: [Type here]";
    el.href =
      "mailto:" + email + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  // WMO weather codes → short label (Open-Meteo uses these)
  function weatherCodeToLabel(code) {
    if (code == null) return "—";
    const map = {
      0: "CLEAR", 1: "CLEAR", 2: "PARTLY_CLOUDY", 3: "OVERCAST",
      45: "FOG", 48: "FOG", 51: "DRIZZLE", 53: "DRIZZLE", 55: "DRIZZLE",
      61: "RAIN", 63: "RAIN", 65: "RAIN", 66: "FREEZING_RAIN", 67: "FREEZING_RAIN",
      71: "SNOW", 73: "SNOW", 75: "SNOW", 77: "SNOW",
      80: "SHOWERS", 81: "SHOWERS", 82: "SHOWERS", 85: "SNOW_SHOWERS", 86: "SNOW_SHOWERS",
      95: "THUNDERSTORM", 96: "THUNDERSTORM", 99: "THUNDERSTORM"
    };
    return map[code] || "CODE_" + code;
  }

  async function updateWeather(locationName) {
    const el = document.getElementById("weather-display");
    if (!el) return;
    const loc = (locationName || "").trim();
    if (!loc) {
      el.textContent = "TEMP: — | COND: — | WIND: — | HUM: —";
      return;
    }
    let lat, lon;
    const coords = getCoordsForLocation(loc);
    if (coords[0] !== 0 || coords[1] !== 0) {
      lat = coords[0];
      lon = coords[1];
    } else {
      try {
        const geo = await fetch(
          "https://geocoding-api.open-meteo.com/v1/search?name=" +
            encodeURIComponent(loc) +
            "&count=1"
        );
        const geoData = await geo.json();
        if (!geoData.results || !geoData.results.length) throw new Error("No results");
        lat = geoData.results[0].latitude;
        lon = geoData.results[0].longitude;
      } catch (e) {
        el.textContent = "WEATHER_SIGNAL_LOST";
        return;
      }
    }
    try {
      const url =
        "https://api.open-meteo.com/v1/forecast?latitude=" +
        lat +
        "&longitude=" +
        lon +
        "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph";
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const c = data.current || data.current_weather;
      if (!c) throw new Error("No current data");
      const temp = c.temperature_2m != null ? Math.round(c.temperature_2m) : (c.temperature != null ? Math.round(c.temperature) : "—");
      const cond = weatherCodeToLabel(c.weather_code);
      const windVal = c.wind_speed_10m != null ? c.wind_speed_10m : (c.windspeed != null ? c.windspeed : null);
      const wind = windVal != null ? Math.round(windVal) + "" : "—";
      const hum = c.relative_humidity_2m != null ? c.relative_humidity_2m : "—";
      el.textContent =
        "TEMP: " + temp + "°F | COND: " + cond + " | WIND: " + wind + " mph | HUM: " + hum + "%";
    } catch (e) {
      el.textContent = "WEATHER_SIGNAL_LOST";
    }
  }

  function getCoordsForLocation(locStr) {
    if (LOC_TO_COORDS[locStr]) return LOC_TO_COORDS[locStr];
    const parts = locStr.split(",").map((s) => s.trim());
    const country = parts[parts.length - 1];
    return COUNTRY_CENTER[country] || [0, 0];
  }

  function getCurrentShiftIndex() {
    const shiftNumber = Math.floor(Date.now() / SHIFT_INTERVAL_MS);
    if (!cams.length) return 0;
    return shiftNumber % cams.length;
  }

  function getNextShiftTime() {
    return (Math.floor(Date.now() / SHIFT_INTERVAL_MS) + 1) * SHIFT_INTERVAL_MS;
  }

  function formatCountdown(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function getCallsign() {
    let id = sessionStorage.getItem(STORAGE_CALLSIGN);
    if (!id) {
      id = "USER_" + String(Math.floor(Math.random() * 900) + 100);
      sessionStorage.setItem(STORAGE_CALLSIGN, id);
    }
    return id;
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function loadCams() {
    return fetch("cams.json")
      .then((r) => r.json())
      .then((data) => {
        cams = (data || []).map((c) => ({
          ...c,
          url: normalizeUrl(c.url),
          locationShort: parseLocation(c.location),
        }));
        shuffleArray(cams);
        return cams;
      })
      .catch((e) => {
        console.error("[UPLINK] Failed to load cams.json", e);
        cams = [];
        return cams;
      });
  }

  function setFeedErrorHandlers(img) {
    img.onerror = () => {
      img.classList.add("hidden");
      document.getElementById("feed-placeholder").classList.add("visible");
    };
    img.onload = () => {
      document.getElementById("feed-placeholder").classList.remove("visible");
    };
  }

  function showFeed(index) {
    if (!cams.length) return;
    currentIndex = ((index % cams.length) + cams.length) % cams.length;
    const cam = cams[currentIndex];
    if (!visibleFeedEl) visibleFeedEl = document.getElementById("camera-feed");
    if (!preloadFeedEl) preloadFeedEl = document.getElementById("camera-feed-next");
    const placeholder = document.getElementById("feed-placeholder");

    placeholder.classList.remove("visible");
    visibleFeedEl.classList.remove("hidden");
    preloadFeedEl.classList.add("hidden");
    visibleFeedEl.src = feedDisplayUrl(cam.url);
    setFeedErrorHandlers(visibleFeedEl);

    var nextIdx = (currentIndex + 1) % cams.length;
    preloadFeedEl.src = feedDisplayUrl(cams[nextIdx].url);
    setFeedErrorHandlers(preloadFeedEl);

    updateNodeHUD(cam);
    startFeedRefresh();
    renderChatForCam(cam.id);
  }

  function swapToPreloadedFeed() {
    if (!cams.length || !visibleFeedEl || !preloadFeedEl) return;
    currentIndex = (currentIndex + 1) % cams.length;
    var cam = cams[currentIndex];

    visibleFeedEl.classList.add("hidden");
    preloadFeedEl.classList.remove("hidden");

    var nextIdx = (currentIndex + 1) % cams.length;
    visibleFeedEl.src = feedDisplayUrl(cams[nextIdx].url);
    setFeedErrorHandlers(visibleFeedEl);

    var tmp = visibleFeedEl;
    visibleFeedEl = preloadFeedEl;
    preloadFeedEl = tmp;

    updateNodeHUD(cam);
    renderChatForCam(cam.id);
    startFeedRefresh();
  }

  function startFeedRefresh() {
    if (feedRefreshTimer) clearInterval(feedRefreshTimer);
    feedRefreshTimer = setInterval(() => {
      const cam = cams[currentIndex];
      if (!cam || !visibleFeedEl) return;
      if (visibleFeedEl.src)
        visibleFeedEl.src = feedDisplayUrl(cam.url);
    }, FEED_REFRESH_MS);
  }

  function runCountdown() {
    const el = document.getElementById("timer");
    function tick() {
      const next = getNextShiftTime();
      const left = next - Date.now();
      el.textContent = formatCountdown(left);
      if (left <= 0) {
        triggerShift();
      }
    }
    tick();
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, 1000);
  }

  function doShiftToIndex(index) {
    const flash = document.getElementById("shift-flash");
    flash.classList.remove("hidden");
    flash.classList.add("flash");
    setTimeout(() => {
      flash.classList.remove("flash");
      flash.classList.add("hidden");
    }, 300);
    showFeed(index);
    runCountdown();
  }

  function triggerShift() {
    doShiftToIndex(getCurrentShiftIndex());
  }

  function startFeedAmbientSound() {
    if (feedAudioCtx) return;
    try {
      feedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const sampleRate = feedAudioCtx.sampleRate;
      const duration = 1.5;
      const length = Math.floor(sampleRate * duration);
      const buffer = feedAudioCtx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        last = 0.98 * last + 0.02 * (Math.random() * 2 - 1);
        data[i] = last * 0.12;
      }
      feedAmbientSource = feedAudioCtx.createBufferSource();
      feedAmbientSource.buffer = buffer;
      feedAmbientSource.loop = true;
      feedAmbientGain = feedAudioCtx.createGain();
      feedAmbientGain.gain.value = 0.35;
      feedAmbientSource.connect(feedAmbientGain);
      feedAmbientGain.connect(feedAudioCtx.destination);
      feedAmbientSource.start(0);
    } catch (e) {
      console.warn("[UPLINK] Feed ambient audio not available", e);
    }
  }

  function setFeedAmbientMuted(muted) {
    if (!feedAmbientGain) return;
    feedAmbientGain.gain.setTargetAtTime(muted ? 0 : 0.35, feedAudioCtx.currentTime, 0.05);
  }

  function applyFeedAmbientMute() {
    setFeedAmbientMuted(feedMatrixOpen || feedAmbientUserMuted);
  }

  function updateMuteButtonLabel() {
    const btn = document.getElementById("mute-feed-btn");
    if (btn) btn.textContent = feedAmbientUserMuted ? "[ UNMUTE ]" : "[ MUTE ]";
  }

  function initLanding() {
    const landing = document.getElementById("landing");
    const viewscreen = document.getElementById("viewscreen");
    document.getElementById("callsign").textContent = getCallsign();

    landing.addEventListener("click", () => {
      landing.classList.add("hidden");
      viewscreen.classList.remove("hidden");
      startFeedAmbientSound();
      loadCams().then(() => {
        showFeed(getCurrentShiftIndex());
        runCountdown();
        initChat();
        initMatrix();
        initMuteButton();
      });
    });
  }

  function getChatKey(camId) {
    return STORAGE_CHAT + "_" + camId;
  }

  function getStoredMessages(camId) {
    try {
      const raw = localStorage.getItem(getChatKey(camId));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveMessage(camId, msg) {
    const list = getStoredMessages(camId);
    list.push(msg);
    localStorage.setItem(getChatKey(camId), JSON.stringify(list));
  }

  function renderChatForCam(camId) {
    const history = document.getElementById("chat-history");
    history.innerHTML = "";
    const list = getStoredMessages(camId);
    const now = Date.now();
    list.forEach((m) => {
      const age = now - m.ts;
      const el = document.createElement("div");
      el.className = "msg" + (age >= MSG_BURN_MS ? " burning" : "");
      el.dataset.ts = m.ts;
      el.innerHTML = '<span class="callsign">' + escapeHtml(m.callsign) + "</span> " + escapeHtml(m.text);
      history.appendChild(el);
    });
    history.scrollTop = history.scrollHeight;
    scheduleBurn(history);
  }

  function scheduleBurn(container) {
    setTimeout(() => {
      const now = Date.now();
      container.querySelectorAll(".msg").forEach((el) => {
        const ts = Number(el.dataset.ts);
        if (now - ts >= MSG_BURN_MS) el.classList.add("burning");
      });
    }, 1000);
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  function initChat() {
    const input = document.getElementById("chat-input");
    const callsign = getCallsign();
    document.getElementById("callsign").textContent = callsign;

    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const text = input.value.trim();
      if (!text || !cams[currentIndex]) return;
      const camId = cams[currentIndex].id;
      const msg = { callsign, text, ts: Date.now() };
      saveMessage(camId, msg);
      const history = document.getElementById("chat-history");
      const el = document.createElement("div");
      el.className = "msg";
      el.dataset.ts = msg.ts;
      el.innerHTML = '<span class="callsign">' + escapeHtml(callsign) + "</span> " + escapeHtml(text);
      history.appendChild(el);
      history.scrollTop = history.scrollHeight;
      input.value = "";
      scheduleBurn(history);
    });
  }

  function drawSnapshotToCanvas(canvas, cam, callback) {
    if (!cam) {
      if (callback) callback(new Error("No feed"));
      return;
    }
    const ctx = canvas.getContext("2d");
    const w = 640;
    const h = 480;
    canvas.width = w;
    canvas.height = h;
    // Use current cam URL so we always capture the right feed (no reliance on which img is visible)
    const feedUrl = (cam.url || "").trim();
    if (!feedUrl) {
      if (callback) callback(new Error("No feed"));
      return;
    }
    const proxyUrl =
      "/snapshot-proxy?url=" + encodeURIComponent(feedUrl + (feedUrl.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now());
    const img = new Image();
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, w, h);
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(0, h - 80, w, 80);
        ctx.font = "14px JetBrains Mono, monospace";
        ctx.fillStyle = "#39FF14";
        ctx.fillText("LOC: " + cam.locationShort, 20, h - 50);
        ctx.fillText("CAPTURE: " + new Date().toISOString().slice(0, 19).replace("T", " "), 20, h - 28);
        for (let i = 0; i < 4000; i++) {
          ctx.fillStyle = "rgba(255,255,255," + Math.random() * 0.03 + ")";
          ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
        }
        if (callback) callback(null);
      } catch (e) {
        if (callback) callback(e);
      }
    };
    img.onerror = () => { if (callback) callback(new Error("Image load failed")); };
    img.crossOrigin = "anonymous";
    img.src = proxyUrl;
  }

  function initSnapshot() {
    const btn = document.getElementById("snapshot-btn");
    const canvas = document.getElementById("snapshot-canvas");
    btn.addEventListener("click", () => {
      const cam = cams[currentIndex];
      drawSnapshotToCanvas(canvas, cam, (err) => {
        if (err) {
          const feed = visibleFeedEl || document.getElementById("camera-feed");
          if (cam && feed && feed.src) {
            const a = document.createElement("a");
            a.href = feed.src;
            a.download = "uplink_snapshot_" + Date.now() + ".jpg";
            a.target = "_blank";
            a.rel = "noopener";
            a.click();
          }
          return;
        }
        const link = document.createElement("a");
        link.download = "uplink_snapshot_" + Date.now() + ".png";
        link.href = canvas.toDataURL("image/png");
        link.click();
      });
    });
  }

  const MATRIX_SIZE = 24;

  function getRandomMatrixSlice() {
    if (!cams.length) return [];
    const size = Math.min(MATRIX_SIZE, cams.length);
    const shuffled = cams.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, size);
  }

  function openMatrix() {
    const viewscreen = document.getElementById("viewscreen");
    const panel = document.getElementById("node-matrix");
    const grid = document.getElementById("matrix-grid");
    if (!viewscreen || !panel || !grid) return;

    viewscreen.classList.add("matrix-open");
    panel.classList.remove("hidden");
    feedMatrixOpen = true;
    applyFeedAmbientMute();
    grid.innerHTML = "";

    const slice = getRandomMatrixSlice();
    slice.forEach((cam, idx) => {
      const globalIndex = cams.findIndex((c) => c.id === cam.id);
      const item = document.createElement("div");
      item.className = "matrix-item";
      item.dataset.index = String(globalIndex >= 0 ? globalIndex : idx);

      const img = document.createElement("img");
      img.src = feedDisplayUrl(cam.url);
      img.alt = cam.locationShort || "Feed";
      img.loading = "lazy";

      const tooltip = document.createElement("div");
      tooltip.className = "matrix-tooltip";
      tooltip.innerHTML =
        "LOC: " + escapeHtml(cam.locationShort || "—") + "<br>IP: " + escapeHtml(extractIP(cam.url));

      item.appendChild(img);
      item.appendChild(tooltip);

      item.addEventListener("click", () => {
        const i = parseInt(item.dataset.index, 10);
        showFeed(i);
        viewscreen.classList.remove("matrix-open");
        panel.classList.add("hidden");
        feedMatrixOpen = false;
        applyFeedAmbientMute();
      });

      grid.appendChild(item);
    });
  }

  function initMatrix() {
    const btn = document.getElementById("matrix-btn");
    const closeBtn = document.getElementById("matrix-close");
    const panel = document.getElementById("node-matrix");
    const viewscreen = document.getElementById("viewscreen");

    if (btn) btn.addEventListener("click", openMatrix);
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        if (viewscreen) viewscreen.classList.remove("matrix-open");
        if (panel) panel.classList.add("hidden");
        feedMatrixOpen = false;
        applyFeedAmbientMute();
      });
    }
  }

  function initMuteButton() {
    const btn = document.getElementById("mute-feed-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      feedAmbientUserMuted = !feedAmbientUserMuted;
      applyFeedAmbientMute();
      updateMuteButtonLabel();
    });
  }

  function acceptLegal() {
    localStorage.setItem("uplink_agreed", "true");
    const modal = document.getElementById("legal-modal");
    if (modal) modal.classList.add("hidden");
  }

  function init() {
    if (localStorage.getItem("uplink_agreed") === "true") {
      const modal = document.getElementById("legal-modal");
      if (modal) modal.classList.add("hidden");
    }
    const connectBtn = document.getElementById("connect-btn");
    if (connectBtn) connectBtn.addEventListener("click", acceptLegal);
    initLanding();
    initSnapshot();
  }

  init();
})();
