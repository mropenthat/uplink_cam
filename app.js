/**
 * UPLINK_CAM — Sync-jump, Snapshot
 * Feeds from cams.json (scraper output).
 */

(function () {
  "use strict";

  const FEED_REFRESH_MS = 3000;
  let cams = [];
  let feedCams = []; // only cams with thumbnails (signal); no-signal feeds excluded
  let countryFilter = null; // null = All, or country name string
  let thumbnailIds = new Set();
  let currentIndex = 0;
  let currentHudCamId = "";
  let feedRefreshTimer = null;
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
    "San Diego, United States": [32.72, -117.16],
    "Las Vegas, United States": [36.17, -115.14],
    "Boca Raton, United States": [26.35, -80.09],
    "Albany, United States": [42.65, -73.76],
    "Monterey, United States": [36.60, -121.89],
    "Evansville, United States": [37.97, -87.57],
  };

  /** ISO 2-letter country code → full name for filter display (ipinfo returns codes; show full names). */
  const COUNTRY_CODE_TO_NAME = {
    US: "United States", GB: "United Kingdom", FR: "France", DE: "Germany", IT: "Italy", ES: "Spain",
    NL: "Netherlands", BE: "Belgium", AT: "Austria", CH: "Switzerland", PL: "Poland", CZ: "Czech Republic",
    SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", EE: "Estonia", LV: "Latvia", LT: "Lithuania",
    RO: "Romania", HU: "Hungary", BG: "Bulgaria", HR: "Croatia", SK: "Slovakia", SI: "Slovenia",
    RU: "Russian Federation", UA: "Ukraine", BY: "Belarus", JP: "Japan", KR: "South Korea", CN: "China",
    IN: "India", TH: "Thailand", VN: "Vietnam", PH: "Philippines", MY: "Malaysia", ID: "Indonesia",
    AU: "Australia", NZ: "New Zealand", AR: "Argentina", BR: "Brazil", MX: "Mexico", CA: "Canada",
    CO: "Colombia", CL: "Chile", PE: "Peru", HN: "Honduras", BA: "Bosnia and Herzegovina",
    GR: "Greece", PT: "Portugal", TR: "Turkey", IL: "Israel", AE: "United Arab Emirates", SA: "Saudi Arabia",
    EG: "Egypt", ZA: "South Africa", IE: "Ireland", LU: "Luxembourg", MT: "Malta", CY: "Cyprus",
  };
  function countryDisplayName(countryStr) {
    if (!countryStr || !String(countryStr).trim()) return countryStr || "";
    var s = String(countryStr).trim();
    return COUNTRY_CODE_TO_NAME[s] || s;
  }
  /** Full name → code so "United States" and "US" both normalize to "US" (one filter option). */
  var COUNTRY_NAME_TO_CODE = {};
  for (var code in COUNTRY_CODE_TO_NAME) {
    if (COUNTRY_CODE_TO_NAME.hasOwnProperty(code)) {
      COUNTRY_NAME_TO_CODE[COUNTRY_CODE_TO_NAME[code]] = code;
    }
  }
  function canonicalCountry(countryStr) {
    if (!countryStr || !String(countryStr).trim()) return countryStr || "";
    var s = String(countryStr).trim();
    return COUNTRY_NAME_TO_CODE[s] || s;
  }

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

  /** singleFrame=true: always use proxy so we get one still image (no MJPEG stream in <img>). Otherwise use proxy on HTTPS for mixed content. */
  function feedDisplayUrl(camUrl, singleFrame) {
    if (!camUrl) return "";
    const withTime = camUrl + (camUrl.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
    if (singleFrame || (window.location.protocol === "https:" && camUrl.startsWith("http://"))) {
      var proxy = "/feed-proxy?url=" + encodeURIComponent(withTime);
      if (singleFrame) proxy += "&single=1";
      return proxy;
    }
    return withTime;
  }

  /** Static thumbnail cache: pre-generated snippets in /thumbnails/{id}.jpg (or .png). Use these first. */
  function matrixStaticThumbnailUrl(camId) {
    if (camId == null) return "";
    return "/thumbnails/" + camId + ".jpg";
  }

  /** Fallback: try .png if .jpg missing (scraper may save PNG). */
  function matrixStaticThumbnailPngUrl(camId) {
    if (camId == null) return "";
    return "/thumbnails/" + camId + ".png";
  }

  /** On-demand proxy fallback when no cached thumbnail (single frame, not video). */
  function matrixFallbackUrl(camUrl) {
    if (!camUrl) return "";
    const withTime = camUrl + (camUrl.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
    return "/feed-proxy?url=" + encodeURIComponent(withTime) + "&single=1";
  }

  var NO_SIGNAL_DATA_URI =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100" viewBox="0 0 150 100"><rect fill="#0f0f0f" width="150" height="100"/><text x="75" y="52" text-anchor="middle" fill="#2a2a2a" font-size="9" font-family="monospace">NO SIGNAL</text></svg>'
    );

  /** Cyrillic -> Latin for US city names that appear in Cyrillic in source data */
  var CYRILLIC_TO_LATIN = {
    "\u0410": "A", "\u0411": "B", "\u0412": "V", "\u0413": "G", "\u0414": "D", "\u0415": "E", "\u0416": "Zh", "\u0417": "Z",
    "\u0418": "I", "\u0419": "Y", "\u041a": "K", "\u041b": "L", "\u041c": "M", "\u041d": "N", "\u041e": "O", "\u041f": "P",
    "\u0420": "R", "\u0421": "S", "\u0422": "T", "\u0423": "U", "\u0424": "F", "\u0425": "Kh", "\u0426": "Ts", "\u0427": "Ch",
    "\u0428": "Sh", "\u0429": "Shch", "\u042a": "", "\u042b": "Y", "\u042c": "", "\u042d": "E", "\u042e": "Yu", "\u042f": "Ya",
    "\u0430": "a", "\u0431": "b", "\u0432": "v", "\u0433": "g", "\u0434": "d", "\u0435": "e", "\u0436": "zh", "\u0437": "z",
    "\u0438": "i", "\u0439": "y", "\u043a": "k", "\u043b": "l", "\u043c": "m", "\u043d": "n", "\u043e": "o", "\u043f": "p",
    "\u0440": "r", "\u0441": "s", "\u0442": "t", "\u0443": "u", "\u0444": "f", "\u0445": "kh", "\u0446": "ts", "\u0447": "ch",
    "\u0448": "sh", "\u0449": "shch", "\u044a": "", "\u044b": "y", "\u044c": "", "\u044d": "e", "\u044e": "yu", "\u044f": "ya",
    "\u0451": "e", "\u0401": "E"
  };
  function transliterateCyrillicToLatin(str) {
    if (!str || !/[\u0400-\u04FF]/.test(str)) return str;
    var out = "";
    for (var i = 0; i < str.length; i++) {
      out += CYRILLIC_TO_LATIN[str[i]] !== undefined ? CYRILLIC_TO_LATIN[str[i]] : str[i];
    }
    return out;
  }

  function parseLocation(locationStr) {
    if (!locationStr || !locationStr.trim()) return "Unknown";
    const s = locationStr.trim();
    // Already clean format from scraper: "City, Country" or "City, Region, Country" (no "Click here" / "located in")
    if (!/click\s+here|located\s+in/i.test(s)) {
      var result = s;
      if (/[\u0400-\u04FF]/.test(result)) result = transliterateCyrillicToLatin(result);
      return result;
    }
    // Legacy: "Click here to enter the camera located in United States, region California, San Diego"
    const regionMatch = s.match(/located\s+in\s+([^,]+),\s*region\s+[^,]+,\s*(.+)$/i);
    var result = regionMatch ? (regionMatch[2] + ", " + regionMatch[1]).trim() : null;
    if (!result) {
      const inMatch = s.match(/\s+in\s+(.+)$/);
      result = inMatch ? inMatch[1].trim() : s;
    }
    if (result && /,\s*United States\s*$/i.test(result) && /[\u0400-\u04FF]/.test(result)) {
      var cityPart = result.replace(/\s*,\s*United States\s*$/i, "");
      var englishCity = {
        "Лас-Вегас": "Las Vegas", "Бока-Ратон": "Boca Raton", "Олбани": "Albany", "Монтерей": "Monterey",
        "Эвансвилл": "Evansville", "Лас Вегас": "Las Vegas", "Бока Ратон": "Boca Raton"
      }[cityPart];
      if (englishCity) result = englishCity + ", United States";
    }
    if (result && /[\u0400-\u04FF]/.test(result)) {
      result = transliterateCyrillicToLatin(result);
    }
    return result;
  }

  /** Extract country from location string. Handles "located in X, ..." and clean "City, Country". */
  function getCountryFromLocation(locationStr) {
    if (!locationStr || !String(locationStr).trim()) return null;
    var s = String(locationStr).trim();
    var m = s.match(/located\s+in\s+([^,]+)/i);
    if (m) return m[1].trim();
    var parts = s.split(",").map(function (p) { return p.trim(); }).filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 1] : null;
  }

  /** Feed list for PREV/NEXT: all feedCams or filtered by country. */
  function getVisibleFeedCams() {
    if (!countryFilter) return feedCams;
    return feedCams.filter(function (c) {
      return canonicalCountry(getCountryFromLocation(c.location)) === countryFilter;
    });
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

  /** US state / region name → IANA timezone (for camera local time). */
  var LOCATION_TO_TZ = {
    Alabama: "America/Chicago", Alaska: "America/Anchorage", Arizona: "America/Phoenix", Arkansas: "America/Chicago",
    California: "America/Los_Angeles", Colorado: "America/Denver", Connecticut: "America/New_York",
    Delaware: "America/New_York", "District of Columbia": "America/New_York", Florida: "America/New_York",
    Georgia: "America/New_York", Hawaii: "Pacific/Honolulu", Idaho: "America/Boise", Illinois: "America/Chicago",
    Indiana: "America/Indiana/Indianapolis", Iowa: "America/Chicago", Kansas: "America/Chicago",
    Kentucky: "America/Kentucky/Louisville", Louisiana: "America/Chicago", Maine: "America/New_York",
    Maryland: "America/New_York", Massachusetts: "America/New_York", Michigan: "America/Detroit",
    Minnesota: "America/Chicago", Mississippi: "America/Chicago", Missouri: "America/Chicago",
    Montana: "America/Denver", Nebraska: "America/Chicago", Nevada: "America/Los_Angeles",
    "New Hampshire": "America/New_York", "New Jersey": "America/New_York", "New Mexico": "America/Denver",
    "New York": "America/New_York", "North Carolina": "America/New_York", "North Dakota": "America/Chicago",
    Ohio: "America/New_York", Oklahoma: "America/Chicago", Oregon: "America/Los_Angeles",
    Pennsylvania: "America/New_York", "Rhode Island": "America/New_York", "South Carolina": "America/New_York",
    "South Dakota": "America/Chicago", Tennessee: "America/Chicago", Texas: "America/Chicago",
    Utah: "America/Denver", Vermont: "America/New_York", Virginia: "America/New_York",
    Washington: "America/Los_Angeles", "West Virginia": "America/New_York", Wisconsin: "America/Chicago",
    Wyoming: "America/Denver"
  };
  var COUNTRY_TO_TZ = {
    Japan: "Asia/Tokyo", Mexico: "America/Mexico_City", "United Kingdom": "Europe/London", UK: "Europe/London",
    Germany: "Europe/Berlin", France: "Europe/Paris", Spain: "Europe/Madrid", Italy: "Europe/Rome",
    "South Korea": "Asia/Seoul", Korea: "Asia/Seoul", India: "Asia/Kolkata", Brazil: "America/Sao_Paulo",
    Canada: "America/Toronto", Australia: "Australia/Sydney", Russia: "Europe/Moscow", China: "Asia/Shanghai"
  };

  function getTimezoneForLocation(locationStr) {
    if (!locationStr || !String(locationStr).trim()) return null;
    var s = String(locationStr).trim();
    var regionMatch = s.match(/region\s+([^,]+)/i);
    if (regionMatch) {
      var region = regionMatch[1].trim();
      if (LOCATION_TO_TZ[region]) return LOCATION_TO_TZ[region];
    }
    if (/United States/i.test(s)) return "America/New_York";
    for (var country in COUNTRY_TO_TZ) {
      if (s.indexOf(country) >= 0) return COUNTRY_TO_TZ[country];
    }
    return null;
  }

  function pad2(n) { return String(n).length >= 2 ? String(n) : "0" + n; }

  /** Format current time in the camera's local timezone (YYYY-MM-DD HH:MM:SS). */
  function formatLocalTimeForCam(cam) {
    if (!cam) return "—";
    var tz = getTimezoneForLocation(cam.location);
    try {
      if (tz) {
        var d = new Date();
        var formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
        });
        var parts = formatter.formatToParts(d);
        var get = function (type) { return (parts.find(function (p) { return p.type === type; }) || {}).value || ""; };
        return get("year") + "-" + pad2(get("month")) + "-" + pad2(get("day")) + " " +
          pad2(get("hour")) + ":" + pad2(get("minute")) + ":" + pad2(get("second"));
      }
      var d = new Date();
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " +
        pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    } catch (e) {
      var d = new Date();
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " +
        pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    }
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
    // Use saved location immediately (from cams.json); only live data is local time and weather.
    if (mapLink) {
      mapLink.textContent = "LOC: " + (cam.locationShort || "—");
      mapLink.href = "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(cam.locationShort || "");
    }
    updateWeather(cam.locationShort);
    if (localTimeEl)
      localTimeEl.textContent = "LOCAL_TIME: " + formatLocalTimeForCam(cam);

    var visitsEl = document.getElementById("viewers-count");
    if (visitsEl) visitsEl.textContent = "…";
    var camId = cam && (cam.id != null) ? String(cam.id) : "";
    currentHudCamId = camId || "";
    if (!camId) {
      if (visitsEl) visitsEl.textContent = "—";
    } else {
      fetch("/api/cam-visit?cam_id=" + encodeURIComponent(camId))
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          return r.json();
        })
        .then(function (data) {
          var el = document.getElementById("viewers-count");
          if (el) el.textContent = typeof data.count === "number" ? data.count : "—";
        })
        .catch(function () {
          var el = document.getElementById("viewers-count");
          if (el) el.textContent = "—";
        });
    }
    var thumbsUpEl = document.getElementById("thumbs-up-count");
    var thumbsDownEl = document.getElementById("thumbs-down-count");
    if (thumbsUpEl) thumbsUpEl.textContent = "…";
    if (thumbsDownEl) thumbsDownEl.textContent = "…";
    if (camId) {
      // Restore voted state from localStorage immediately so "already liked" shows when returning to a feed
      updateThumbsButtonState(camId);
      fetch("/api/cam-thumbs?cam_id=" + encodeURIComponent(camId))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (currentHudCamId !== camId) return;
          if (data && thumbsUpEl) thumbsUpEl.textContent = typeof data.up === "number" ? data.up : "0";
          if (data && thumbsDownEl) thumbsDownEl.textContent = typeof data.down === "number" ? data.down : "0";
          updateThumbsButtonState(camId);
        })
        .catch(function () {
          if (currentHudCamId !== camId) return;
          if (thumbsUpEl) thumbsUpEl.textContent = "0";
          if (thumbsDownEl) thumbsDownEl.textContent = "0";
          updateThumbsButtonState(camId);
        });
    } else {
      if (thumbsUpEl) thumbsUpEl.textContent = "0";
      if (thumbsDownEl) thumbsDownEl.textContent = "0";
      updateThumbsButtonState("");
    }

    if (netIspEl) netIspEl.textContent = "NET_ISP: —";
    if (netAsnEl) netAsnEl.textContent = "ASN: —";
    if (netIspEl) netIspEl.textContent = "NET_ISP: …";
    if (netAsnEl) netAsnEl.textContent = "ASN: …";
    fetchIpInfo(ip, (data) => {
      if (!data || data.error) {
        if (netIspEl) netIspEl.textContent = "NET_ISP: —";
        if (netAsnEl) netAsnEl.textContent = "ASN: —";
        if (mapLink && ip !== "—") {
          mapLink.textContent = "LOC: " + (cam.locationShort || "—");
          mapLink.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(cam.locationShort || "");
        }
        updateWeather(cam.locationShort);
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
      // When we have an IP, use ipinfo's location to correct wrong/misspelled scraper data (e.g. Filadelfiya → Philadelphia).
      var locParts = [data.city, data.region, data.country].filter(Boolean);
      var ipinfoLoc = locParts.length ? locParts.join(", ") : null;
      if (ipinfoLoc && mapLink) {
        mapLink.textContent = "LOC: " + ipinfoLoc;
        mapLink.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ipinfoLoc);
      }
      var latLon = null;
      if (data.loc && typeof data.loc === "string") {
        var parts = data.loc.split(",").map(function (p) { return parseFloat(p.trim()); });
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          latLon = { lat: parts[0], lon: parts[1] };
        }
      }
      if (latLon) {
        updateWeather(ipinfoLoc || cam.locationShort, latLon);
      } else if (ipinfoLoc) {
        updateWeather(ipinfoLoc);
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

  var weatherCache = {};
  async function updateWeather(locationName, directCoords) {
    const el = document.getElementById("weather-display");
    if (!el) return;
    let lat, lon;
    var cacheKey = "";
    if (directCoords && typeof directCoords.lat === "number" && typeof directCoords.lon === "number") {
      lat = directCoords.lat;
      lon = directCoords.lon;
      cacheKey = lat + "," + lon;
    } else {
      const loc = (locationName || "").trim();
      if (!loc) {
        el.textContent = "TEMP: — | COND: — | WIND: — | HUM: —";
        return;
      }
      cacheKey = loc;
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
    }
    if (weatherCache[cacheKey]) {
      el.textContent = weatherCache[cacheKey];
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
      const text = "TEMP: " + temp + "°F | COND: " + cond + " | WIND: " + wind + " mph | HUM: " + hum + "%";
      el.textContent = text;
      weatherCache[cacheKey] = text;
    } catch (e) {
      if (!weatherCache[cacheKey]) el.textContent = "WEATHER_SIGNAL_LOST";
    }
  }

  function getCoordsForLocation(locStr) {
    if (LOC_TO_COORDS[locStr]) return LOC_TO_COORDS[locStr];
    const parts = locStr.split(",").map((s) => s.trim());
    const country = parts[parts.length - 1];
    return COUNTRY_CENTER[country] || [0, 0];
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function loadCams() {
    const loadList = fetch("/api/thumbnail-ids")
      .then((r) => (r.ok ? r.json() : []))
      .then((ids) => {
        thumbnailIds = new Set((ids || []).map(String));
        return thumbnailIds;
      })
      .catch(() => (thumbnailIds = new Set()));
    return Promise.all([
      fetch("cams.json")
        .then((r) => r.json())
        .then((data) => {
          cams = (data || []).map((c) => ({
            ...c,
            url: normalizeUrl(c.embed_url || c.url || ""),
            locationShort: parseLocation(c.location),
          }));
          shuffleArray(cams);
          return cams;
        })
        .catch((e) => {
          console.error("[UPLINK] Failed to load cams.json", e);
          cams = [];
          return cams;
        }),
      loadList,
    ]).then(([c]) => c);
  }

  function setFeedErrorHandlers(img) {
    delete img.dataset.retried;
    img.onerror = () => {
      if (!img.dataset.retried) {
        img.dataset.retried = "1";
        const src = img.src;
        setTimeout(() => { img.src = src; }, 2000);
        return;
      }
      img.classList.add("hidden");
      document.getElementById("feed-placeholder").classList.add("visible");
    };
    img.onload = () => {
      document.getElementById("feed-placeholder").classList.remove("visible");
    };
  }

  /** When current feed shows no signal, skip to the next feed (keep cam in list so pool stays full). */
  function skipNoSignalToNext() {
    var visible = getVisibleFeedCams();
    if (visible.length <= 0) return;
    var nextIdx = (currentIndex + 1) % visible.length;
    if (nextIdx === currentIndex) return; // only one cam left
    showFeed(nextIdx);
  }

  function showFeed(index) {
    var visible = getVisibleFeedCams();
    if (!visible.length) return;
    currentIndex = ((index % visible.length) + visible.length) % visible.length;
    const cam = visible[currentIndex];
    const mainFeed = document.getElementById("camera-feed");
    const nextFeed = document.getElementById("camera-feed-next");
    const placeholder = document.getElementById("feed-placeholder");
    if (!mainFeed) return;

    visibleFeedEl = mainFeed;
    preloadFeedEl = nextFeed;

    if (!cam.url) {
      mainFeed.classList.add("hidden");
      if (placeholder) placeholder.classList.add("visible");
      return;
    }

    placeholder.classList.remove("visible");
    mainFeed.classList.remove("hidden");
    if (nextFeed) nextFeed.classList.add("hidden");
    preloadFeedEl.src = "";

    // Main view = screenshot/thumbnail only; click opens live feed in new tab.
    mainFeed.removeAttribute("src");
    mainFeed.dataset.pngUrl = matrixStaticThumbnailPngUrl(cam.id);
    // If we know this cam has no thumbnail file, use snapshot URL (via proxy on HTTPS) immediately.
    var hasThumb = thumbnailIds.size > 0 && thumbnailIds.has(String(cam.id));
    if (!hasThumb && cam.url) {
      mainFeed.src = feedDisplayUrl(cam.url, true);
      mainFeed.onerror = function () {
        this.onerror = null;
        this.src = NO_SIGNAL_DATA_URI;
        skipNoSignalToNext();
      };
    } else {
      mainFeed.src = matrixStaticThumbnailUrl(cam.id);
      mainFeed.onerror = function () {
        if (!this.dataset.triedPng && this.dataset.pngUrl) {
          this.dataset.triedPng = "1";
          this.src = this.dataset.pngUrl;
        } else if (!this.dataset.triedSnapshot && cam.url) {
          this.dataset.triedSnapshot = "1";
          var el = this;
          this.onerror = function () {
            el.onerror = null;
            el.src = NO_SIGNAL_DATA_URI;
            skipNoSignalToNext();
          };
          this.src = feedDisplayUrl(cam.url, true);
        } else {
          this.onerror = null;
          this.src = NO_SIGNAL_DATA_URI;
          skipNoSignalToNext();
        }
      };
    }
    mainFeed.onload = function () {
      if (placeholder) placeholder.classList.remove("visible");
    };
    if (placeholder) placeholder.textContent = "SIGNAL_LOST";

    updateNodeHUD(cam);
    startFeedRefresh();
  }

  function swapToPreloadedFeed() {
    var visible = getVisibleFeedCams();
    if (!visible.length || !visibleFeedEl || !preloadFeedEl) return;
    currentIndex = (currentIndex + 1) % visible.length;
    var cam = visible[currentIndex];

    visibleFeedEl.classList.add("hidden");
    preloadFeedEl.classList.remove("hidden");

    var nextIdx = (currentIndex + 1) % visible.length;
    visibleFeedEl.src = feedDisplayUrl(visible[nextIdx].url, true);
    setFeedErrorHandlers(visibleFeedEl);

    var tmp = visibleFeedEl;
    visibleFeedEl = preloadFeedEl;
    preloadFeedEl = tmp;

    updateNodeHUD(cam);
    startFeedRefresh();
  }

  function startFeedRefresh() {
    if (feedRefreshTimer) clearInterval(feedRefreshTimer);
  }

  var localTimeInterval = null;

  function startViewerTracking() {
    try {
      if (localTimeInterval) clearInterval(localTimeInterval);
      var localTimeEl = document.getElementById("local-time");
      if (localTimeEl) {
        function tickLocalTime() {
          if (!localTimeEl) return;
          var visible = getVisibleFeedCams();
          var cam = visible.length ? visible[currentIndex] : null;
          localTimeEl.textContent = "LOCAL_TIME: " + formatLocalTimeForCam(cam);
        }
        tickLocalTime();
        localTimeInterval = setInterval(tickLocalTime, 1000);
      }
    } catch (e) {}
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
      if (feedAudioCtx.state === "suspended") {
        feedAudioCtx.resume().catch(function () {});
      }
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
    var landing = document.getElementById("landing");
    var viewscreen = document.getElementById("viewscreen");
    if (!landing || !viewscreen) return;

    landing.addEventListener("click", function () {
      landing.classList.add("hidden");
      viewscreen.classList.remove("hidden");
      startFeedAmbientSound();
      startViewerTracking();
      // Re-attach feed/nav handlers now that viewscreen is visible (in case init() ran before DOM ready)
      initFeedNav();
      initFeedClick();
      initMuteButton();
      loadCams()
        .then(function () {
          // Only show cams that have a saved thumbnail so the carousel uses static files, not live proxy.
          if (thumbnailIds.size > 0) {
            feedCams = cams.filter(function (c) { return thumbnailIds.has(String(c.id)); });
          }
          if (feedCams.length === 0) {
            feedCams = cams.filter(function (c) {
              var u = (c.url || "").trim();
              if (!u) return false;
              return snapshotScore(u) <= 1 || getLiveStreamUrl(u) !== u;
            });
          }
          if (feedCams.length === 0) feedCams = cams;
          initCountryFilter();
          try {
            showFeed(0);
          } catch (e) {
            console.error("[UPLINK] showFeed(0) failed", e);
          }
        })
        .catch(function (err) {
          console.error("[UPLINK] loadCams failed", err);
        });
    });
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  const MATRIX_SIZE = 24;

  /** Prefer cams that return a single image (snapshot URLs) so matrix thumbnails load reliably. */
  function snapshotScore(url) {
    if (!url) return 0;
    const u = url.toLowerCase();
    if (u.includes("snapshotjpeg") || u.includes("snapshot.cgi") || u.includes("image.jpg") || u.includes("image.jpeg")) return 3;
    if (u.includes("webcapture") && u.includes("command=snap")) return 3;
    if (u.includes("video.jpg") || u.includes("video.jpeg") || u.includes("/jpg/") || u.includes("nph-jpeg")) return 2;
    if (u.includes("mjpg") || u.includes("mjpeg") || u.includes("faststream") || u.includes("videostream")) return 1;
    return 0;
  }

  /** True if this URL returns one image per request (needs refresh to "play" on main feed). */
  function isSnapshotOnly(url) {
    return snapshotScore(url) >= 2;
  }

  /** For Live View: return a stream URL when the stored URL is snapshot-only (e.g. SnapshotJPEG → nphMotionJpeg). */
  function getLiveStreamUrl(camUrl) {
    if (!camUrl) return "";
    var url = camUrl.trim();
    if (snapshotScore(url) <= 1) return url;
    try {
      var a = document.createElement("a");
      a.href = url;
      var origin = a.origin || (a.protocol + "//" + a.hostname + (a.port ? ":" + a.port : ""));
      var pathname = (a.pathname || "/").replace(/\/+$/, "") || "/";
      var u = url.toLowerCase();
      // Snapshot-only APIs we can't reliably convert to a stream path — pass through so live viewer shows at least one frame
      if (u.includes("jpgmulreq") || u.includes("getoneshot") || u.includes("onvif/snapshot")) {
        return url;
      }
      if (u.includes("snapshotjpeg")) {
        return origin + "/nphMotionJpeg?Resolution=640x480&Quality=Standard";
      }
      if (u.includes("image.jpg") || u.includes("image.jpeg")) {
        return origin + "/mjpg/video.mjpg";
      }
      // Vivotek / similar: cgi-bin/viewer/video.jpg → cgi-bin/viewer/mjpg/video.mjpg (MJPEG stream)
      if (u.includes("video.jpg") || u.includes("video.jpeg")) {
        return origin + pathname.replace(/\/video\.(jpg|jpeg)$/i, "/mjpg/video.mjpg");
      }
      // webcapture.jpg?command=snap → same path without query = MJPEG stream (Hi3516 etc.)
      if (u.includes("webcapture") && u.includes("command=snap")) {
        return origin + pathname || origin + "/webcapture.jpg";
      }
      // snapshot.cgi / nph-jpeg → try common stream path
      if (u.includes("snapshot.cgi") || u.includes("nph-jpeg")) {
        return origin + "/nphMotionJpeg?Resolution=640x480&Quality=Standard";
      }
      // /jpg/ or /jpeg/ single-frame path → try /mjpg/video.mjpg on same host
      if (u.includes("/jpg/") || u.includes("/jpeg/")) {
        return origin + "/mjpg/video.mjpg";
      }
    } catch (e) {}
    return url;
  }

  /*
   * Matrix shows only cams with a thumbnail. Each tile shows the snapshot for that cam (thumbnails/{id}.jpg).
   * Click sets main feed to that cam's stream.
   */
  /** Only cams that have a thumbnail file; matrix shows only these so every tile loads. */
  function getRandomMatrixSlice() {
    if (!cams.length) return [];
    const pool = thumbnailIds.size > 0
      ? cams.filter((c) => thumbnailIds.has(String(c.id)))
      : [];
    if (pool.length === 0) return [];
    const size = Math.min(MATRIX_SIZE, pool.length);
    const shuffled = pool.slice().sort((a, b) => {
      const scoreA = snapshotScore(a.url);
      const scoreB = snapshotScore(b.url);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return Math.random() - 0.5;
    });
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
    if (slice.length === 0) {
      const msg = document.createElement("p");
      msg.className = "matrix-empty-msg";
      msg.textContent = "No thumbnail cache. Run thumbnail_scraper to populate matrix previews.";
      grid.appendChild(msg);
      return;
    }
    slice.forEach((cam) => {
      const item = document.createElement("div");
      item.className = "matrix-item";
      item.dataset.camId = String(cam.id);

      // Matrix = static thumbnails only (no live proxy). Keeps Railway to one live stream (main feed).
      const img = document.createElement("img");
      img.alt = cam.locationShort || "Feed";
      img.loading = "lazy";
      img.style.background = "#0a0a0a";
      img.dataset.pngUrl = matrixStaticThumbnailPngUrl(cam.id);
      img.src = matrixStaticThumbnailUrl(cam.id);
      img.onerror = function () {
        if (!this.dataset.triedPng && this.dataset.pngUrl) {
          this.dataset.triedPng = "1";
          this.src = this.dataset.pngUrl;
        } else {
          this.onerror = null;
          this.src = NO_SIGNAL_DATA_URI;
        }
      };

      const tooltip = document.createElement("div");
      tooltip.className = "matrix-tooltip";
      tooltip.innerHTML =
        "LOC: " + escapeHtml(cam.locationShort || "—") + "<br>IP: " + escapeHtml(extractIP(cam.url));

      item.appendChild(img);
      item.appendChild(tooltip);

      item.addEventListener("click", function () {
        var camId = item.dataset.camId;
        if (!camId) return;
        var visible = getVisibleFeedCams();
        var i = visible.findIndex(function (c) { return String(c.id) === camId; });
        if (i >= 0) {
          currentIndex = i;
          showFeed(i);
        } else {
          showFeed(0);
        }
        viewscreen.classList.remove("matrix-open");
        panel.classList.add("hidden");
        feedMatrixOpen = false;
        applyFeedAmbientMute();
      });

      grid.appendChild(item);
    });
  }

  function initFeedClick() {
    var wrap = document.querySelector(".feed-wrap");
    if (!wrap) return;
    wrap.style.cursor = "pointer";
    wrap.title = "Click to open live stream";
    wrap.addEventListener("click", function () {
      var visible = getVisibleFeedCams();
      if (!visible.length) return;
      var cam = visible[currentIndex];
      if (!cam || !cam.url) return;
      var liveUrl = getLiveStreamUrl(cam.url);
      if (liveUrl) window.open("/live-viewer.html?url=" + encodeURIComponent(liveUrl), "_blank", "noopener");
    });
  }

  function initCountryFilter() {
    var select = document.getElementById("country-filter");
    if (!select) return;
    var countries = [];
    var seen = {};
    for (var i = 0; i < feedCams.length; i++) {
      var raw = getCountryFromLocation(feedCams[i].location);
      var canon = raw ? canonicalCountry(raw) : "";
      if (canon && !seen[canon]) {
        seen[canon] = true;
        countries.push(canon);
      }
    }
    countries.sort();
    select.innerHTML = "<option value=\"\">All</option>";
    for (var j = 0; j < countries.length; j++) {
      var opt = document.createElement("option");
      opt.value = countries[j];
      opt.textContent = countryDisplayName(countries[j]);
      select.appendChild(opt);
    }
    select.addEventListener("change", function () {
      countryFilter = select.value || null;
      currentIndex = 0;
      showFeed(0);
    });
  }

  function initFeedNav() {
    var prevBtn = document.getElementById("feed-prev-btn");
    var nextBtn = document.getElementById("feed-next-btn");
    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        var visible = getVisibleFeedCams();
        if (!visible.length) return;
        var prevIdx = (currentIndex - 1 + visible.length) % visible.length;
        showFeed(prevIdx);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        var visible = getVisibleFeedCams();
        if (!visible.length) return;
        var nextIdx = (currentIndex + 1) % visible.length;
        showFeed(nextIdx);
      });
    }
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

  function updateThumbsButtonState(camId) {
    var thumbUp = document.getElementById("thumb-up-btn");
    var thumbDown = document.getElementById("thumb-down-btn");
    if (!thumbUp || !thumbDown) return;
    var voted;
    try { voted = camId ? localStorage.getItem("thumb_" + camId) : null; } catch (e) { voted = null; }
    thumbUp.disabled = !!voted;
    thumbDown.disabled = !!voted;
    thumbUp.title = voted === "up" ? "You voted thumbs up" : "Thumbs up";
    thumbDown.title = voted === "down" ? "You voted thumbs down" : "Thumbs down";
  }

  function initThumbsButtons() {
    var thumbUp = document.getElementById("thumb-up-btn");
    var thumbDown = document.getElementById("thumb-down-btn");
    function sendVote(vote, e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      var camId = currentHudCamId;
      if (!camId) {
        var visible = getVisibleFeedCams();
        if (visible.length && visible[currentIndex] && visible[currentIndex].id != null) {
          camId = String(visible[currentIndex].id);
        }
      }
      if (!camId) return;
      try {
        if (localStorage.getItem("thumb_" + camId)) {
          updateThumbsButtonState(camId);
          return;
        }
      } catch (err) {}
      var upEl = document.getElementById("thumbs-up-count");
      var downEl = document.getElementById("thumbs-down-count");
      var prevUp = upEl ? parseInt(upEl.textContent, 10) || 0 : 0;
      var prevDown = downEl ? parseInt(downEl.textContent, 10) || 0 : 0;
      if (upEl) upEl.textContent = vote === "up" ? prevUp + 1 : prevUp;
      if (downEl) downEl.textContent = vote === "down" ? prevDown + 1 : prevDown;
      thumbUp.disabled = true;
      thumbDown.disabled = true;
      fetch("/api/cam-thumb?cam_id=" + encodeURIComponent(camId) + "&vote=" + encodeURIComponent(vote))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data) {
            if (upEl) upEl.textContent = typeof data.up === "number" ? data.up : prevUp + (vote === "up" ? 1 : 0);
            if (downEl) downEl.textContent = typeof data.down === "number" ? data.down : prevDown + (vote === "down" ? 1 : 0);
            try { localStorage.setItem("thumb_" + camId, vote); } catch (err) {}
          }
        })
        .catch(function () {
          if (upEl) upEl.textContent = prevUp;
          if (downEl) downEl.textContent = prevDown;
          thumbUp.disabled = false;
          thumbDown.disabled = false;
        });
    }
    if (thumbUp) thumbUp.addEventListener("click", function (e) { sendVote("up", e); });
    if (thumbDown) thumbDown.addEventListener("click", function (e) { sendVote("down", e); });
  }

  function acceptLegal() {
    try {
      localStorage.setItem("uplink_agreed", "true");
    } catch (e) {}
    var modal = document.getElementById("legal-modal");
    if (modal) modal.classList.add("hidden");
  }

  function init() {
    try {
      if (localStorage.getItem("uplink_agreed") === "true") {
        var modal = document.getElementById("legal-modal");
        if (modal) modal.classList.add("hidden");
      }
    } catch (e) {}
    var connectBtn = document.getElementById("connect-btn");
    if (connectBtn) connectBtn.addEventListener("click", acceptLegal);
    initLanding();
    initThumbsButtons();
  }

  init();
})();
