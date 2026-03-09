const SVG_NS = "http://www.w3.org/2000/svg";
const CFG = {
    longSegPx: 220,
    shortBucket: 18,
    longBucket: 55,
    minArrowSegPx: 8,
    arrowLen: 16,
    arrowWidth: 10,
    clickRadius: 6,
    panThreshold: 2
};
const state = {
    loadedData: null,
    activeLogPath: "",
    plotted: [],
    selected: [],
    selectedIndex: 0,
    selectedHopIndex: null,
    selectedIps: new Set(),
    highlighted: null,
    scale: 1,
    tx: 0,
    ty: 0,
    panning: false,
    movedDuringPan: false,
    panX: 0,
    panY: 0
};

const ui = {};

// -----------------------------------------------------------------------------
// Data Normalization / Trace Shaping
// -----------------------------------------------------------------------------

/** Returns finite number or null. */
function toNum(v) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Sorts hops by TTL ascending with unknown TTL at end. */
function sortTraceByTtl(trace) {
    return [...trace].sort((a, b) => {
        const at = Number(a?.ttl);
        const bt = Number(b?.ttl);
        const av = Number.isFinite(at);
        const bv = Number.isFinite(bt);
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return at - bt;
    });
}

/** Returns "country|province" key for trace simplification. */
function regionKey(p) {
    return `${p?.country || "n/a"}|${p?.province || "n/a"}`;
}

/** Removes consecutive duplicates and A->B->A ping-pong patterns by region. */
function simplifyTrace(points) {
    if (!Array.isArray(points) || points.length <= 2) return points || [];
    const collapsed = [];
    for (const p of points) {
        // Keep only the first hop when the region repeats consecutively.
        if (!collapsed.length || regionKey(collapsed[collapsed.length - 1]) !== regionKey(p)) collapsed.push(p);
    }
    const simplified = [];
    for (const p of collapsed) {
        // Collapse immediate ping-pong loops (A -> B -> A) by removing B.
        if (simplified.length >= 2 && regionKey(simplified[simplified.length - 2]) === regionKey(p)) {
            simplified.pop();
            continue;
        }
        simplified.push(p);
    }
    return simplified;
}

/** Normalizes one hop to numeric coords. */
function normalizeHop(h) {
    if (!h || typeof h !== "object") return null;
    return { ...h, lat: toNum(h.lat), lon: toNum(h.lon) };
}

/** Normalizes one entry and supports legacy swapped lat/lon-country/province logs. */
function normalizeEntry(e) {
    if (!e || typeof e !== "object") return null;
    let lat = toNum(e.lat);
    let lon = toNum(e.lon);
    if (lat === null || lon === null) {
        // Legacy logs had lat/lon swapped with country/province.
        const legacyLat = toNum(e.country);
        const legacyLon = toNum(e.province);
        if (legacyLat !== null && legacyLon !== null) { lat = legacyLat; lon = legacyLon; }
    }
    let country = typeof e.country === "string" ? e.country : null;
    let province = typeof e.province === "string" ? e.province : null;
    if (!country && typeof e.lat === "string") country = e.lat;
    if (!province && typeof e.lon === "string") province = e.lon;
    const trace = Array.isArray(e.trace) ? sortTraceByTtl(e.trace.map(normalizeHop).filter(Boolean)) : [];
    return { ...e, lat, lon, country: country || "n/a", province: province || "n/a", trace };
}

/** Returns true if point has renderable coords (non-zero finite lat/lon). */
function renderable(p) {
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat !== 0 && p.lon !== 0;
}

// -----------------------------------------------------------------------------
// Coordinate / View Transform Helpers
// -----------------------------------------------------------------------------

/** Converts lon/lat to map pixel space. */
function lonToX(lon, w) { return ((lon + 180) / 360) * w; }
function latToY(lat, h) { return ((90 - lat) / 180) * h; }

/** Applies current pan/zoom transform to image and SVG viewport layer. */
function applyView() {
    const vp = document.getElementById("viewport-layer");
    if (!vp) return;
    // Apply the same transform to SVG overlay and map image so they stay aligned.
    vp.setAttribute("transform", `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
    ui.mapImage.style.transformOrigin = "top left";
    ui.mapImage.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
}

/** Zooms around a specific screen point. */
function zoomAt(sx, sy, factor) {
    const next = Math.max(0.6, Math.min(8, state.scale * factor));
    if (next === state.scale) return;
    const ratio = next / state.scale;
    // Anchor zoom under mouse position by adjusting translation with scale ratio.
    state.tx = sx - ((sx - state.tx) * ratio);
    state.ty = sy - ((sy - state.ty) * ratio);
    state.scale = next;
    applyView();
}

/** Resets view transform to default. */
function resetZoom() { state.scale = 1; state.tx = 0; state.ty = 0; applyView(); }

/** Converts client point to untransformed map coordinates. */
function screenToMap(clientX, clientY) {
    const rect = ui.overlay.getBoundingClientRect();
    // First convert viewport coordinates to map pixel coordinates...
    const sx = (clientX - rect.left) * (ui.mapWrap.clientWidth / rect.width);
    const sy = (clientY - rect.top) * (ui.mapWrap.clientHeight / rect.height);
    // ...then invert current pan/zoom transform for hit-testing.
    return { x: (sx - state.tx) / state.scale, y: (sy - state.ty) / state.scale, sx, sy };
}

// -----------------------------------------------------------------------------
// SVG Primitives / Segment Keying
// -----------------------------------------------------------------------------

/** Draws SVG line. */
function drawLine(parent, x1, y1, x2, y2, color, width) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("class", "trace-segment");
    line.setAttribute("x1", String(x1)); line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2)); line.setAttribute("y2", String(y2));
    line.setAttribute("stroke", color); line.setAttribute("stroke-width", String(width));
    line.setAttribute("stroke-opacity", "0.6"); parent.appendChild(line);
    return line;
}

/** Draws SVG circle. */
function drawCircle(parent, x, y, r, fill, cls) {
    const c = document.createElementNS(SVG_NS, "circle");
    if (cls) c.setAttribute("class", cls);
    c.setAttribute("cx", String(x)); c.setAttribute("cy", String(y)); c.setAttribute("r", String(r)); c.setAttribute("fill", fill);
    parent.appendChild(c);
    return c;
}

/** Draws a centered direction arrow on a segment. */
function drawMidArrow(parent, x1, y1, x2, y2, color) {
    const a = Math.atan2(y2 - y1, x2 - x1), mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const L = CFG.arrowLen, W = CFG.arrowWidth;
    const tipX = mx + Math.cos(a) * (L / 2), tipY = my + Math.sin(a) * (L / 2);
    const backX = mx - Math.cos(a) * (L / 2), backY = my - Math.sin(a) * (L / 2);
    const nx = Math.cos(a + Math.PI / 2) * (W / 2), ny = Math.sin(a + Math.PI / 2) * (W / 2);
    const p = document.createElementNS(SVG_NS, "polygon");
    p.setAttribute("class", "trace-arrow");
    p.setAttribute("points", `${tipX},${tipY} ${backX + nx},${backY + ny} ${backX - nx},${backY - ny}`);
    p.setAttribute("fill", color); p.setAttribute("fill-opacity", "0.98");
    p.setAttribute("stroke", "rgba(60,60,60,0.65)"); p.setAttribute("stroke-width", "0.8");
    parent.appendChild(p);
}

/** Computes region-aware trace segment keys for dedupe/suppression. */
function makeSegKeys(seg) {
    const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    const bucket = len > CFG.longSegPx ? CFG.longBucket : CFG.shortBucket;
    const q = (v) => Math.round(v / bucket) * bucket;
    const fwd = `${q(seg.x1)},${q(seg.y1)}->${q(seg.x2)},${q(seg.y2)}`;
    const rev = `${q(seg.x2)},${q(seg.y2)}->${q(seg.x1)},${q(seg.y1)}`;
    return { len, undirected: fwd < rev ? fwd : rev, directed: fwd, reverseDirected: rev };
}

// -----------------------------------------------------------------------------
// Inspector Rendering
// -----------------------------------------------------------------------------

/** Shows placeholder when no selection is active. */
function setInspectorEmpty() {
    ui.inspector.classList.add("hidden");
    ui.inspectorContent.classList.add("muted");
    ui.inspectorContent.textContent = "Click a colored point to inspect its route.";
}

/** Adds one label/value row in inspector panel. */
function addRow(parent, label, value) {
    const row = document.createElement("div");
    row.className = "row";
    row.textContent = `${label}: ${value}`;
    parent.appendChild(row);
}

/** Humanizes key names for display labels. */
function keyLabel(key) {
    return String(key).replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());
}

/** Formats field values for inspector output. */
function fieldValue(key, value) {
    if (value === null || value === undefined || value === "") return "n/a";
    if (key === "rtt") return `${value} ms`;
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

/** Renders all object fields except hidden keys, sorted for stable UI. */
function renderFields(parent, obj, hidden = []) {
    const hiddenSet = new Set(hidden);
    for (const k of Object.keys(obj).filter((k) => !hiddenSet.has(k)).sort()) {
        addRow(parent, keyLabel(k), fieldValue(k, obj[k]));
    }
}

/** Moves selection among entries sharing click area. */
function moveEntry(delta) {
    state.selectedIndex = (state.selectedIndex + delta + state.selected.length) % state.selected.length;
    state.highlighted = state.selected[state.selectedIndex] || null;
    applyTraceHighlight();
    renderInspector();
}

/** Renders inspector for selected entry/hop. */
function renderInspector() {
    ui.inspectorContent.innerHTML = "";
    ui.inspectorContent.classList.remove("muted");
    if (!state.selected.length) return setInspectorEmpty();
    ui.inspector.classList.remove("hidden");

    const entry = state.selected[state.selectedIndex];
    const trace = Array.isArray(entry.trace) ? entry.trace : [];
    const nav = document.createElement("div");
    nav.className = "button-row";
    if (state.selectedHopIndex !== null) {
        const b = document.createElement("button"); b.textContent = "Back To Entry";
        b.addEventListener("click", () => { state.selectedHopIndex = null; renderInspector(); }); nav.appendChild(b);
    } else if (state.selected.length > 1) {
        const p = document.createElement("button"), n = document.createElement("button");
        p.textContent = "Prev Entry"; n.textContent = "Next Entry";
        p.addEventListener("click", () => moveEntry(-1)); n.addEventListener("click", () => moveEntry(1));
        nav.appendChild(p); nav.appendChild(n);
    }
    if (nav.children.length) ui.inspectorContent.appendChild(nav);

    const title = document.createElement("h3");
    title.textContent = `Entry ${state.selectedIndex + 1} / ${state.selected.length}`;
    ui.inspectorContent.appendChild(title);

    if (state.selectedHopIndex !== null) {
        addRow(ui.inspectorContent, "Hop #", state.selectedHopIndex + 1);
        renderFields(ui.inspectorContent, trace[state.selectedHopIndex] || {});
        return;
    }

    renderFields(ui.inspectorContent, entry, ["trace", "locLookupTime"]);
    addRow(ui.inspectorContent, "Lat, Lon", `${entry.lat ?? "n/a"}, ${entry.lon ?? "n/a"}`);
    addRow(ui.inspectorContent, "Trace Hops", trace.length);

    const section = document.createElement("div");
    section.className = "section";
    const title2 = document.createElement("div");
    title2.textContent = "Trace IPs (click for hop details)";
    section.appendChild(title2);
    if (!trace.length) {
        const none = document.createElement("div");
        none.className = "muted";
        none.textContent = "No trace data";
        section.appendChild(none);
    } else {
        const hopList = document.createElement("div");
        hopList.className = "hop-list";
        for (let i = 0; i < trace.length; i++) {
            const hop = trace[i] || {};
            const b = document.createElement("button");
            const loc = [hop.country, hop.province].filter(Boolean).join(", ");
            b.textContent = `[${i + 1}] ${hop.ip || "n/a"}${loc ? " - " + loc : ""}`;
            b.addEventListener("click", () => { state.selectedHopIndex = i; renderInspector(); });
            hopList.appendChild(b);
        }
        section.appendChild(hopList);
    }
    ui.inspectorContent.appendChild(section);
}

// -----------------------------------------------------------------------------
// Trace Highlighting / Arrow Rules
// -----------------------------------------------------------------------------

/** Applies selected-trace emphasis and directional arrows. */
function applyTraceHighlight() {
    const viewport = document.getElementById("viewport-layer");
    if (!viewport) return;
    const defs = ui.overlay.querySelector("defs");
    viewport.querySelectorAll(".trace-arrow").forEach((n) => n.remove());
    if (defs) defs.innerHTML = "";
    const seenEdges = new Set(), seenLongRegionPairs = new Set();
    const hasSelection = Boolean(state.highlighted);

    for (const plotted of state.plotted) {
        const selected = hasSelection && plotted.entry === state.highlighted;
        plotted.point.classList.toggle("selected", selected);
        plotted.point.setAttribute("r", selected ? "4.2" : "3");
        plotted.point.setAttribute("fill-opacity", hasSelection && !selected ? "0.35" : "1");

        for (let i = 0; i < plotted.segments.length; i++) {
            const seg = plotted.segments[i];
            seg.line.setAttribute("stroke-opacity", !hasSelection ? "0.6" : (selected ? "0.95" : "0.15"));
            seg.line.setAttribute("stroke-width", !hasSelection ? "1" : (selected ? "2.2" : "1"));
            if (!selected || !defs) { seg.line.setAttribute("stroke", "rgba(255,255,255,0.7)"); continue; }

            const gradId = `selected-trace-grad-${seg.gk}`;
            const g = document.createElementNS(SVG_NS, "linearGradient");
            g.setAttribute("id", gradId); g.setAttribute("gradientUnits", "userSpaceOnUse");
            g.setAttribute("x1", String(seg.x1)); g.setAttribute("y1", String(seg.y1));
            g.setAttribute("x2", String(seg.x2)); g.setAttribute("y2", String(seg.y2));
            const t0 = seg.total <= 1 ? 0 : seg.i / (seg.total - 1);
            const t1 = seg.total <= 1 ? 1 : Math.min(1, (seg.i + 1) / (seg.total - 1));
            const s0 = document.createElementNS(SVG_NS, "stop"), s1 = document.createElementNS(SVG_NS, "stop");
            const col0 = `rgba(${Math.round(190 + (90 - 190) * t0)}, ${Math.round(50 + (0 - 50) * t0)}, ${Math.round(50 + (0 - 50) * t0)}, 0.98)`;
            const col1 = `rgba(${Math.round(190 + (90 - 190) * t1)}, ${Math.round(50 + (0 - 50) * t1)}, ${Math.round(50 + (0 - 50) * t1)}, 0.98)`;
            s0.setAttribute("offset", "0%"); s0.setAttribute("stop-color", col0);
            s1.setAttribute("offset", "100%"); s1.setAttribute("stop-color", col1);
            g.appendChild(s0); g.appendChild(s1); defs.appendChild(g);
            seg.line.setAttribute("stroke", `url(#${gradId})`);

            const keys = makeSegKeys(seg);
            // Don't spam arrows on tiny or already-seen equivalent segments.
            if (keys.len <= CFG.minArrowSegPx || seenEdges.has(keys.undirected)) continue;
            // Collapse long cross-region duplicates (coarse geolocation can create mirrored overlaps).
            if (keys.len > CFG.longSegPx && seg.fromR !== seg.toR) {
                const pair = seg.fromR < seg.toR ? `${seg.fromR}<->${seg.toR}` : `${seg.toR}<->${seg.fromR}`;
                if (seenLongRegionPairs.has(pair)) continue;
                seenLongRegionPairs.add(pair);
            }
            // Suppress immediate reverse jitter (A -> B -> A) from traceroute noise.
            if (i > 0) {
                const prev = plotted.segments[i - 1];
                const prevKeys = makeSegKeys(prev);
                if (prevKeys.undirected === keys.undirected && keys.directed === prevKeys.reverseDirected) continue;
            }

            const inbound = plotted.entry.direction === "in";
            drawMidArrow(viewport, inbound ? seg.x2 : seg.x1, inbound ? seg.y2 : seg.y1, inbound ? seg.x1 : seg.x2, inbound ? seg.y1 : seg.y2, "rgba(255,255,255,0.98)");
            seenEdges.add(keys.undirected);
        }

        for (let i = 0; i < plotted.hops.length; i++) {
            const hop = plotted.hops[i];
            hop.setAttribute("fill-opacity", !hasSelection ? "0.6" : (selected ? "0.95" : "0.2"));
            hop.setAttribute("r", selected ? "2.6" : "2");
            hop.setAttribute("fill", selected ? "#7d0000" : "rgba(255,255,255,0.6)");
        }

        if (selected) {
            // Re-append selected shapes to draw them above non-selected routes.
            for (const s of plotted.segments) viewport.appendChild(s.line);
            for (const h of plotted.hops) viewport.appendChild(h);
            viewport.appendChild(plotted.point);
        }
    }
}

// -----------------------------------------------------------------------------
// Map Rendering Pipeline
// -----------------------------------------------------------------------------

/** Updates selection from click location. */
function selectEntriesNearClick(x, y) {
    const matches = state.plotted.filter((p) => ((p.x - x) ** 2 + (p.y - y) ** 2) ** 0.5 <= CFG.clickRadius);
    if (!matches.length) {
        state.selectedIps = new Set(); state.selected = []; state.selectedIndex = 0; state.selectedHopIndex = null; state.highlighted = null;
        applyTraceHighlight(); renderInspector(); return;
    }
    state.selectedIps = new Set(matches.map((m) => m.entry.ip));
    state.selected = matches.map((m) => m.entry);
    state.selectedIndex = 0;
    state.selectedHopIndex = null;
    state.highlighted = state.selected[0] || null;
    applyTraceHighlight();
    renderInspector();
}

/** Renders map points/lines for current data snapshot. */
function renderGeoCache(data) {
    const w = ui.mapWrap.clientWidth, h = ui.mapWrap.clientHeight;
    ui.overlay.innerHTML = "";
    ui.overlay.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const defs = document.createElementNS(SVG_NS, "defs"), viewport = document.createElementNS(SVG_NS, "g");
    viewport.setAttribute("id", "viewport-layer");
    ui.overlay.appendChild(defs); ui.overlay.appendChild(viewport);
    state.plotted = [];

    const entries = Array.isArray(data.geo_cache) ? data.geo_cache.map(normalizeEntry).filter(Boolean) : [];
    let pointsPlotted = 0, segCount = 0;

    for (const entry of entries) {
        if (!renderable(entry)) continue;
        // Simplify visual route before drawing to remove repeated region oscillations.
        const trace = simplifyTrace((Array.isArray(entry.trace) ? entry.trace : []).filter(renderable));
        const pointColor = entry.direction === "out" ? "#ff7474" : "#6bc5ff";
        const segments = [], hops = [];
        const baseKey = String(entry.ip || "entry").replace(/[^a-zA-Z0-9_-]/g, "_");

        for (let i = 0; i < trace.length - 1; i++) {
            const a = trace[i], b = trace[i + 1];
            const x1 = lonToX(a.lon, w), y1 = latToY(a.lat, h), x2 = lonToX(b.lon, w), y2 = latToY(b.lat, h);
            const line = drawLine(viewport, x1, y1, x2, y2, "rgba(255,255,255,0.7)", 1);
            segments.push({ line, x1, y1, x2, y2, fromR: regionKey(a), toR: regionKey(b), i, total: trace.length, gk: `${baseKey}-${i}` });
            segCount++;
        }
        if (trace.length) {
            // Always connect last visible hop to destination marker.
            const last = trace[trace.length - 1];
            const x1 = lonToX(last.lon, w), y1 = latToY(last.lat, h), x2 = lonToX(entry.lon, w), y2 = latToY(entry.lat, h);
            const line = drawLine(viewport, x1, y1, x2, y2, "rgba(255,255,255,0.7)", 1);
            segments.push({ line, x1, y1, x2, y2, fromR: regionKey(last), toR: regionKey(entry), i: trace.length - 1, total: trace.length, gk: `${baseKey}-dest` });
            segCount++;
        }
        for (const hop of trace) hops.push(drawCircle(viewport, lonToX(hop.lon, w), latToY(hop.lat, h), 2, "rgba(255,255,255,0.6)", "trace-hop"));
        const x = lonToX(entry.lon, w), y = latToY(entry.lat, h);
        const point = drawCircle(viewport, x, y, 3, pointColor, "dest-point");
        state.plotted.push({ entry, x, y, point, segments, hops });
        pointsPlotted++;
    }

    if (state.selectedIps.size > 0) {
        // Rebind selection to fresh entry objects after each render pass.
        state.selected = state.plotted.filter((p) => state.selectedIps.has(p.entry.ip)).map((p) => p.entry);
        if (!state.selected.length) {
            state.selectedIps = new Set(); state.selectedIndex = 0; state.selectedHopIndex = null; state.highlighted = null; setInspectorEmpty();
        } else {
            state.selectedIndex = Math.min(state.selectedIndex, state.selected.length - 1);
            state.highlighted = state.selected[state.selectedIndex] || null;
        }
    }

    applyTraceHighlight();
    ui.status.textContent = `Log: ${state.activeLogPath}\nLoaded geo_cache entries: ${entries.length}\nPlotted points: ${pointsPlotted}\nTrace segments: ${segCount}`;
    applyView();
}

// -----------------------------------------------------------------------------
// Log Discovery / Loading
// -----------------------------------------------------------------------------

/** Chooses newest log filename from directory listing HTML. */
function pickLatestLogFromHtml(html) {
    const strict = [...html.matchAll(/log_\d{8}_\d{6}\.json/g)].map((m) => m[0]);
    const loose = [...html.matchAll(/log_[^"'<>\s]+\.json/g)].map((m) => m[0]);
    const names = [...new Set([...strict, ...loose])];
    if (!names.length) return null;
    names.sort((a, b) => b.localeCompare(a));
    return `logs/${names[0]}`;
}

/** Extracts all log filenames from directory listing HTML (newest first). */
function listLogPathsFromHtml(html) {
    const strict = [...html.matchAll(/log_\d{8}_\d{6}\.json/g)].map((m) => m[0]);
    const loose = [...html.matchAll(/log_[^"'<>\s]+\.json/g)].map((m) => m[0]);
    const names = [...new Set([...strict, ...loose])];
    names.sort((a, b) => b.localeCompare(a));
    return names.map((n) => `logs/${n}`);
}

/** Formats log filename timestamp into a readable local datetime label. */
function readableLogTime(logPath) {
    const name = logPath.split("/").pop() || "";
    const m = name.match(/log_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.json/);
    if (!m) return name;
    const [, y, mo, d, h, mi, s] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    return dt.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

/** Resolves the newest log path from the logs directory listing. */
async function resolveLogPath() {
    // Directory listing is the source of truth for "latest".
    const res = await fetch("logs/");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const latest = pickLatestLogFromHtml(await res.text());
    if (!latest) throw new Error("No log_YYYYMMDD_HHMMSS.json files found in logs/");
    return latest;
}

/** Loads selected JSON log and renders map. */
async function loadAndRender(logPath) {
    try {
        const chosenPath = logPath || await resolveLogPath();
        const res = await fetch(chosenPath);
        if (!res.ok) throw new Error("HTTP " + res.status);
        state.activeLogPath = chosenPath;
        state.loadedData = await res.json();
        window.logJson = state.loadedData;
        renderGeoCache(state.loadedData);
        ui.logPicker.classList.add("hidden");
        ui.status.style.display = "block";
        ui.zoomControls.style.display = "flex";
    } catch (err) {
        ui.status.textContent =
            "Failed to load latest log from logs/.\n" +
            String(err) + "\n" +
            "Open this page via a local server (not file://).";
    }
}

/** Loads log file list and renders picker UI. */
async function showLogPicker() {
    ui.status.style.display = "none";
    ui.zoomControls.style.display = "none";
    ui.logPicker.classList.remove("hidden");
    ui.logPickerList.textContent = "Loading logs...";

    try {
        const res = await fetch("logs/");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const paths = listLogPathsFromHtml(await res.text());
        if (!paths.length) throw new Error("No logs found in logs/");

        ui.logPickerList.innerHTML = "";

        // Probe each JSON to compute entry count, then sort by size descending.
        const enriched = await Promise.all(paths.map(async (p) => {
            try {
                const r = await fetch(p);
                if (!r.ok) throw new Error("HTTP " + r.status);
                const j = await r.json();
                const count = Array.isArray(j?.geo_cache) ? j.geo_cache.length : 0;
                return { path: p, count };
            } catch (_) {
                return { path: p, count: -1 };
            }
        }));

        enriched.sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return b.path.localeCompare(a.path);
        });

        for (const item of enriched) {
            const p = item.path;
            const b = document.createElement("button");
            b.className = "log-option";
            b.type = "button";
            const entriesLabel = item.count >= 0 ? `${item.count} entries` : "entries unknown";
            b.innerHTML =
                `<span class="log-time">${readableLogTime(p)}</span>` +
                `<span class="log-name">${p}</span>` +
                `<span class="log-name">${entriesLabel}</span>`;
            b.addEventListener("click", () => loadAndRender(p));
            ui.logPickerList.appendChild(b);
        }
    } catch (err) {
        ui.logPickerList.textContent = `Failed to list logs: ${String(err)}`;
    }
}

// -----------------------------------------------------------------------------
// Interaction Handlers
// -----------------------------------------------------------------------------

/** Handles click selection while ignoring drag-end clicks. */
function onOverlayClick(e) {
    if (state.movedDuringPan) { state.movedDuringPan = false; return; }
    const p = screenToMap(e.clientX, e.clientY);
    selectEntriesNearClick(p.x, p.y);
}

/** Handles wheel interaction: Ctrl+wheel zoom, plain wheel pan. */
function onOverlayWheel(e) {
    e.preventDefault();
    const p = screenToMap(e.clientX, e.clientY);
    if (e.ctrlKey) return zoomAt(p.sx, p.sy, e.deltaY < 0 ? 1.12 : 0.89);
    state.tx -= e.deltaX; state.ty -= e.deltaY; applyView();
}

/** Starts drag-pan. */
function onMouseDown(e) {
    state.panning = true; state.movedDuringPan = false; state.panX = e.clientX; state.panY = e.clientY;
}

/** Updates drag-pan movement. */
function onMouseMove(e) {
    if (!state.panning) return;
    const dx = e.clientX - state.panX, dy = e.clientY - state.panY;
    if (Math.abs(dx) + Math.abs(dy) > CFG.panThreshold) state.movedDuringPan = true;
    state.panX = e.clientX; state.panY = e.clientY; state.tx += dx; state.ty += dy; applyView();
}

/** Ends drag-pan. */
function onMouseUp() { state.panning = false; }

// -----------------------------------------------------------------------------
// Bootstrap
// -----------------------------------------------------------------------------

/** Caches DOM nodes used by the mapper. */
function cacheDom() {
    ui.mapWrap = document.getElementById("map-wrap");
    ui.mapImage = document.getElementById("map-image");
    ui.overlay = document.getElementById("overlay");
    ui.status = document.getElementById("status");
    ui.inspector = document.getElementById("inspector");
    ui.inspectorContent = document.getElementById("inspector-content");
    ui.zoomIn = document.getElementById("zoom-in");
    ui.zoomOut = document.getElementById("zoom-out");
    ui.zoomReset = document.getElementById("zoom-reset");
    ui.backToPicker = document.getElementById("back-to-picker");
    ui.zoomControls = document.getElementById("zoom-controls");
    ui.logPicker = document.getElementById("log-picker");
    ui.logPickerList = document.getElementById("log-picker-list");
}

/** Registers all UI event handlers. */
function bindEvents() {
    ui.overlay.addEventListener("click", onOverlayClick);
    ui.overlay.addEventListener("wheel", onOverlayWheel, { passive: false });
    ui.overlay.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("resize", () => { if (state.loadedData) renderGeoCache(state.loadedData); });
    ui.zoomIn.addEventListener("click", () => zoomAt(ui.mapWrap.clientWidth / 2, ui.mapWrap.clientHeight / 2, 1.2));
    ui.zoomOut.addEventListener("click", () => zoomAt(ui.mapWrap.clientWidth / 2, ui.mapWrap.clientHeight / 2, 0.84));
    ui.zoomReset.addEventListener("click", resetZoom);
    ui.backToPicker.addEventListener("click", () => {
        state.selected = [];
        state.selectedIps = new Set();
        state.selectedIndex = 0;
        state.selectedHopIndex = null;
        state.highlighted = null;
        showLogPicker();
    });
}

/** Bootstraps the mapper page. */
function init() {
    cacheDom();
    // Try common map asset roots so this page works under multiple server layouts.
    ui.mapImage.addEventListener("error", () => {
        if (ui.mapImage.src.includes("/Icons/")) {
            ui.mapImage.src = "public/Icons/map_simple.png";
            return;
        }
        if (ui.mapImage.src.includes("/public/Icons/")) {
            ui.mapImage.src = "/Icons/map_simple.png";
        }
    });
    bindEvents();
    showLogPicker();
}

init();
