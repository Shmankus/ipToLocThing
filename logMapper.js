const SVG_NS = "http://www.w3.org/2000/svg";
const LOG_PICKER_SUBTITLE = "Select a capture to open the map view.";
const MAP_IMAGE_FALLBACKS = [
    "public/Icons/map_simple.png",
    "/Icons/map_simple.png",
    "Icons/map_simple.png"
];

const CONFIG = {
    clickRadius: 8,
    panThreshold: 3,
    pointRadius: 3,
    selectedPointRadius: 4.5,
    hopRadius: 2.4,
    selectedHopRadius: 4.2,
    zoomStep: 1.2,
    minZoom: 0.6,
    maxZoom: 6,
    colors: {
        in: {
            point: "#6bc5ff",
            route: "rgba(107, 197, 255, 0.28)",
            activeRoute: "rgba(107, 197, 255, 0.95)"
        },
        out: {
            point: "#ff7474",
            route: "rgba(255, 116, 116, 0.28)",
            activeRoute: "rgba(255, 116, 116, 0.95)"
        }
    }
};

const state = {
    logPath: "",
    entries: [],
    plottedPoints: [],
    segmentCount: 0,
    selection: {
        matches: [],
        entryIndex: 0,
        hopIndex: null
    },
    view: {
        scale: 1,
        tx: 0,
        ty: 0,
        panning: false,
        movedWhilePanning: false,
        lastX: 0,
        lastY: 0
    },
    layers: {
        viewport: null,
        routes: null,
        selected: null,
        points: null
    }
};

const ui = {};

function numberOrNull(value) {
    const result = typeof value === "number" ? value : Number(value);
    return Number.isFinite(result) ? result : null;
}

function labelOrFallback(value, fallback = "n/a") {
    return typeof value === "string" && value.trim() ? value : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function sortTraceByTtl(trace) {
    return [...trace].sort((left, right) => {
        const leftTtl = numberOrNull(left?.ttl);
        const rightTtl = numberOrNull(right?.ttl);

        if (leftTtl === null && rightTtl === null) return 0;
        if (leftTtl === null) return 1;
        if (rightTtl === null) return -1;
        return leftTtl - rightTtl;
    });
}

function regionKey(point) {
    return `${point?.country || "n/a"}|${point?.province || "n/a"}`;
}

function hasCoordinates(point) {
    return (
        Number.isFinite(point?.lat) &&
        Number.isFinite(point?.lon) &&
        !(point.lat === 0 && point.lon === 0)
    );
}

function simplifyTrace(trace) {
    if (!Array.isArray(trace) || trace.length < 3) return trace || [];

    const withoutRepeats = [];
    for (const hop of trace) {
        if (!withoutRepeats.length || regionKey(withoutRepeats[withoutRepeats.length - 1]) !== regionKey(hop)) {
            withoutRepeats.push(hop);
        }
    }

    const simplified = [];
    for (const hop of withoutRepeats) {
        if (simplified.length >= 2 && regionKey(simplified[simplified.length - 2]) === regionKey(hop)) {
            simplified.pop();
            continue;
        }
        simplified.push(hop);
    }

    return simplified;
}

function normalizeHop(rawHop) {
    if (!rawHop || typeof rawHop !== "object") return null;

    return {
        ...rawHop,
        ttl: numberOrNull(rawHop.ttl),
        lat: numberOrNull(rawHop.lat),
        lon: numberOrNull(rawHop.lon),
        country: labelOrFallback(rawHop.country, "-"),
        province: labelOrFallback(rawHop.province, "-")
    };
}

function normalizeEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== "object") return null;

    let lat = numberOrNull(rawEntry.lat);
    let lon = numberOrNull(rawEntry.lon);

    if (lat === null || lon === null) {
        const legacyLat = numberOrNull(rawEntry.country);
        const legacyLon = numberOrNull(rawEntry.province);
        if (legacyLat !== null && legacyLon !== null) {
            lat = legacyLat;
            lon = legacyLon;
        }
    }

    const country = typeof rawEntry.country === "string" ? rawEntry.country : rawEntry.lat;
    const province = typeof rawEntry.province === "string" ? rawEntry.province : rawEntry.lon;
    const trace = Array.isArray(rawEntry.trace)
        ? sortTraceByTtl(rawEntry.trace.map(normalizeHop).filter(Boolean))
        : [];

    return {
        ...rawEntry,
        lat,
        lon,
        country: labelOrFallback(country),
        province: labelOrFallback(province),
        direction: rawEntry.direction === "out" ? "out" : "in",
        trace
    };
}

function normalizeEntries(rawEntries) {
    return Array.isArray(rawEntries) ? rawEntries.map(normalizeEntry).filter(Boolean) : [];
}

function getRoutePoints(entry) {
    const trace = simplifyTrace(entry.trace.filter(hasCoordinates));
    return [...trace, entry].filter(hasCoordinates);
}

function getColorSet(direction) {
    return CONFIG.colors[direction] || CONFIG.colors.in;
}

function projectPoint(point, width, height) {
    return {
        x: ((point.lon + 180) / 360) * width,
        y: ((90 - point.lat) / 180) * height
    };
}

function formatCoordinates(point) {
    return hasCoordinates(point) ? `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}` : "n/a";
}

function createElement(tagName, options = {}) {
    const element = document.createElement(tagName);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type) element.type = options.type;

    for (const [name, value] of Object.entries(options.attrs || {})) {
        element.setAttribute(name, String(value));
    }

    return element;
}

function createSvgElement(tagName, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tagName);
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, String(value));
    }
    return element;
}

function drawCircle(parent, x, y, attributes = {}) {
    const circle = createSvgElement("circle", { cx: x, cy: y, ...attributes });
    parent.appendChild(circle);
    return circle;
}

function drawLine(parent, x1, y1, x2, y2, attributes = {}) {
    const line = createSvgElement("line", {
        class: "trace-segment",
        x1,
        y1,
        x2,
        y2,
        ...attributes
    });
    parent.appendChild(line);
    return line;
}

function addInfoRow(parent, label, value) {
    const row = createElement("div", { className: "row", text: `${label}: ${value}` });
    parent.appendChild(row);
}

function formatKeyLabel(key) {
    return String(key)
        .replace(/([A-Z])/g, " $1")
        .replace(/_/g, " ")
        .replace(/^./, (letter) => letter.toUpperCase());
}

function formatFieldValue(key, value) {
    if (value === null || value === undefined || value === "") return "n/a";
    if (key === "rtt") return `${value} ms`;
    if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

function renderFields(parent, data, hiddenKeys = []) {
    const hidden = new Set(hiddenKeys);
    const keys = Object.keys(data).filter((key) => !hidden.has(key)).sort();

    for (const key of keys) {
        addInfoRow(parent, formatKeyLabel(key), formatFieldValue(key, data[key]));
    }
}

function getNmapData(entry) {
    const nmap = entry?.Nmap ?? entry?.nmap;
    if (!nmap || typeof nmap !== "object" || Array.isArray(nmap)) return null;
    return nmap;
}

function comparePortNames(left, right) {
    const leftPort = numberOrNull(left);
    const rightPort = numberOrNull(right);

    if (leftPort !== null && rightPort !== null) return leftPort - rightPort;
    if (leftPort !== null) return -1;
    if (rightPort !== null) return 1;
    return left.localeCompare(right);
}

function renderNmapSection(parent, nmapData) {
    const ports = Object.keys(nmapData).sort(comparePortNames);
    if (!ports.length) return;

    const section = createElement("div", { className: "section" });
    section.appendChild(createElement("div", { text: "Nmap ports" }));

    for (const port of ports) {
        addInfoRow(section, port, String(nmapData[port] ?? "n/a"));
    }

    parent.appendChild(section);
}

function getSelectedEntry() {
    return state.selection.matches[state.selection.entryIndex] || null;
}

function clearSelection() {
    state.selection.matches = [];
    state.selection.entryIndex = 0;
    state.selection.hopIndex = null;
}

function setInspectorEmpty(message = "Click a colored point to inspect its route.") {
    ui.inspector.classList.add("hidden");
    ui.inspectorContent.classList.add("muted");
    ui.inspectorContent.textContent = message;
}

function renderInspector() {
    const entry = getSelectedEntry();
    ui.inspectorContent.innerHTML = "";

    if (!entry) {
        setInspectorEmpty();
        return;
    }

    const trace = Array.isArray(entry.trace) ? entry.trace : [];
    const selectedHop = state.selection.hopIndex === null ? null : trace[state.selection.hopIndex] || null;

    ui.inspector.classList.remove("hidden");
    ui.inspectorContent.classList.remove("muted");

    const nav = createElement("div", { className: "button-row" });
    if (selectedHop) {
        const backButton = createElement("button", { type: "button", text: "Back To Entry" });
        backButton.addEventListener("click", () => {
            state.selection.hopIndex = null;
            renderSelection();
            renderInspector();
        });
        nav.appendChild(backButton);
    } else if (state.selection.matches.length > 1) {
        const prevButton = createElement("button", { type: "button", text: "Prev Entry" });
        const nextButton = createElement("button", { type: "button", text: "Next Entry" });

        prevButton.addEventListener("click", () => moveSelectedEntry(-1));
        nextButton.addEventListener("click", () => moveSelectedEntry(1));

        nav.appendChild(prevButton);
        nav.appendChild(nextButton);
    }

    if (nav.children.length) {
        ui.inspectorContent.appendChild(nav);
    }

    const title = createElement("h3", {
        text: selectedHop
            ? `Hop ${state.selection.hopIndex + 1}`
            : `Entry ${state.selection.entryIndex + 1} / ${state.selection.matches.length}`
    });
    ui.inspectorContent.appendChild(title);

    if (selectedHop) {
        renderFields(ui.inspectorContent, selectedHop);
        return;
    }

    const nmapData = getNmapData(entry);

    renderFields(ui.inspectorContent, entry, ["trace", "locLookupTime", "lat", "lon", "Nmap", "nmap"]);
    addInfoRow(ui.inspectorContent, "Coordinates", formatCoordinates(entry));
    addInfoRow(ui.inspectorContent, "Trace Hops", trace.length);

    if (nmapData) {
        renderNmapSection(ui.inspectorContent, nmapData);
    }

    const traceSection = createElement("div", { className: "section" });
    traceSection.appendChild(createElement("div", { text: "Trace hops" }));

    if (!trace.length) {
        traceSection.appendChild(createElement("div", { className: "muted", text: "No trace data" }));
    } else {
        const hopList = createElement("div", { className: "hop-list" });
        trace.forEach((hop, index) => {
            const locationParts = [hop.country, hop.province].filter((part) => part && part !== "-");
            const label = `[${index + 1}] ${hop.ip || "n/a"}${locationParts.length ? ` - ${locationParts.join(", ")}` : ""}`;
            const button = createElement("button", { type: "button", text: label });

            button.addEventListener("click", () => {
                state.selection.hopIndex = index;
                renderSelection();
                renderInspector();
            });

            hopList.appendChild(button);
        });
        traceSection.appendChild(hopList);
    }

    ui.inspectorContent.appendChild(traceSection);
}

function rebuildOverlay() {
    const width = ui.mapWrap.clientWidth;
    const height = ui.mapWrap.clientHeight;

    ui.overlay.innerHTML = "";
    ui.overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const viewport = createSvgElement("g", { id: "viewport-layer" });
    const routesLayer = createSvgElement("g", { id: "routes-layer" });
    const selectedLayer = createSvgElement("g", { id: "selected-route-layer" });
    const pointsLayer = createSvgElement("g", { id: "points-layer" });

    viewport.appendChild(routesLayer);
    viewport.appendChild(selectedLayer);
    viewport.appendChild(pointsLayer);
    ui.overlay.appendChild(viewport);

    state.layers.viewport = viewport;
    state.layers.routes = routesLayer;
    state.layers.selected = selectedLayer;
    state.layers.points = pointsLayer;
}

function drawRoute(layer, entry, options = {}) {
    const points = getRoutePoints(entry);
    const width = ui.mapWrap.clientWidth;
    const height = ui.mapWrap.clientHeight;
    let segments = 0;

    for (let index = 0; index < points.length - 1; index += 1) {
        const start = projectPoint(points[index], width, height);
        const end = projectPoint(points[index + 1], width, height);
        drawLine(layer, start.x, start.y, end.x, end.y, {
            stroke: options.lineColor || "rgba(255, 255, 255, 0.3)",
            "stroke-width": options.lineWidth || 1.2,
            "stroke-opacity": options.lineOpacity || 1
        });
        segments += 1;
    }

    if (options.showHopDots) {
        for (const hop of points.slice(0, -1)) {
            const { x, y } = projectPoint(hop, width, height);
            drawCircle(layer, x, y, {
                class: "trace-hop",
                r: options.hopRadius || CONFIG.hopRadius,
                fill: options.hopColor || "rgba(255, 255, 255, 0.8)",
                "fill-opacity": options.hopOpacity || 1
            });
        }
    }

    return segments;
}

function applyView() {
    if (!state.layers.viewport) return;

    const { scale, tx, ty } = state.view;
    state.layers.viewport.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
    ui.mapImage.style.transformOrigin = "top left";
    ui.mapImage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function resetView() {
    state.view.scale = 1;
    state.view.tx = 0;
    state.view.ty = 0;
    applyView();
}

function zoomAt(screenX, screenY, factor) {
    const nextScale = clamp(state.view.scale * factor, CONFIG.minZoom, CONFIG.maxZoom);
    if (nextScale === state.view.scale) return;

    const ratio = nextScale / state.view.scale;
    state.view.tx = screenX - ((screenX - state.view.tx) * ratio);
    state.view.ty = screenY - ((screenY - state.view.ty) * ratio);
    state.view.scale = nextScale;
    applyView();
}

function clientToMapPoint(clientX, clientY) {
    const rect = ui.overlay.getBoundingClientRect();
    const sx = (clientX - rect.left) * (ui.mapWrap.clientWidth / rect.width);
    const sy = (clientY - rect.top) * (ui.mapWrap.clientHeight / rect.height);

    return {
        x: (sx - state.view.tx) / state.view.scale,
        y: (sy - state.view.ty) / state.view.scale,
        sx,
        sy
    };
}

function updateStatus() {
    const selectedEntry = getSelectedEntry();
    const lines = [
        `Log: ${state.logPath || "none"}`,
        `Entries: ${state.entries.length}`,
        `Plotted points: ${state.plottedPoints.length}`,
        `Trace segments: ${state.segmentCount}`
    ];

    if (selectedEntry) {
        lines.push(`Selected: ${selectedEntry.ip || "n/a"}`);
    }

    ui.status.textContent = lines.join("\n");
}

function renderSelection() {
    const selectedEntry = getSelectedEntry();

    for (const plottedPoint of state.plottedPoints) {
        const isSelected = plottedPoint.entry === selectedEntry;
        plottedPoint.point.classList.toggle("selected", isSelected);
        plottedPoint.point.setAttribute("r", isSelected ? CONFIG.selectedPointRadius : CONFIG.pointRadius);
        plottedPoint.point.setAttribute("fill-opacity", selectedEntry && !isSelected ? "0.35" : "1");

        if (isSelected) {
            state.layers.points.appendChild(plottedPoint.point);
        }
    }

    if (!state.layers.selected) return;
    state.layers.selected.innerHTML = "";

    if (!selectedEntry) {
        updateStatus();
        return;
    }

    const colors = getColorSet(selectedEntry.direction);
    drawRoute(state.layers.selected, selectedEntry, {
        lineColor: colors.activeRoute,
        lineWidth: 2.2,
        showHopDots: true,
        hopColor: "rgba(255, 255, 255, 0.85)"
    });

    if (state.selection.hopIndex !== null) {
        const hop = selectedEntry.trace[state.selection.hopIndex];
        if (hasCoordinates(hop)) {
            const { x, y } = projectPoint(hop, ui.mapWrap.clientWidth, ui.mapWrap.clientHeight);
            drawCircle(state.layers.selected, x, y, {
                r: CONFIG.selectedHopRadius,
                fill: colors.point,
                stroke: "#ffffff",
                "stroke-width": 1.5
            });
        }
    }

    updateStatus();
}

function renderMap() {
    rebuildOverlay();
    state.plottedPoints = [];
    state.segmentCount = 0;

    const width = ui.mapWrap.clientWidth;
    const height = ui.mapWrap.clientHeight;

    for (const entry of state.entries) {
        if (!hasCoordinates(entry)) continue;

        const colors = getColorSet(entry.direction);
        state.segmentCount += drawRoute(state.layers.routes, entry, {
            lineColor: colors.route,
            lineWidth: 1.2
        });

        const { x, y } = projectPoint(entry, width, height);
        const point = drawCircle(state.layers.points, x, y, {
            class: "dest-point",
            r: CONFIG.pointRadius,
            fill: colors.point
        });

        state.plottedPoints.push({ entry, x, y, point });
    }

    renderSelection();
    applyView();
}

function setSelection(entries) {
    state.selection.matches = entries;
    state.selection.entryIndex = 0;
    state.selection.hopIndex = null;
    renderSelection();
    renderInspector();
}

function moveSelectedEntry(delta) {
    if (state.selection.matches.length < 2) return;

    state.selection.entryIndex = (
        state.selection.entryIndex + delta + state.selection.matches.length
    ) % state.selection.matches.length;
    state.selection.hopIndex = null;

    renderSelection();
    renderInspector();
}

function selectEntriesNear(x, y) {
    const matches = state.plottedPoints
        .filter((point) => Math.hypot(point.x - x, point.y - y) <= CONFIG.clickRadius)
        .map((point) => point.entry);

    setSelection(matches);
}

function setPickerVisible(visible) {
    ui.logPicker.classList.toggle("hidden", !visible);
    ui.status.style.display = visible ? "none" : "block";
    ui.zoomControls.style.display = visible ? "none" : "flex";
}

function normalizeLogPath(rawPath) {
    if (typeof rawPath !== "string" || !rawPath.trim()) return null;

    let decodedPath = rawPath.trim();
    try {
        decodedPath = decodeURIComponent(decodedPath);
    } catch (_) {
        // Keep the original string if it is only partially encoded.
    }

    const cleanPath = decodedPath
        .replace(/\\/g, "/")
        .replace(/[?#].*$/, "");
    const fileName = cleanPath.split("/").filter(Boolean).pop();

    if (!fileName || !/^log.*\.json$/i.test(fileName)) return null;
    return `logs/${fileName}`;
}

function listLogPathsFromHtml(html) {
    const hrefMatches = [...html.matchAll(/href=["']([^"']+\.json(?:[?#][^"']*)?)["']/gi)].map((match) => match[1]);
    const textMatches = [...html.matchAll(/(?:logs(?:%5C|\/|\\))?log[^"'<>\s]*\.json/gi)].map((match) => match[0]);
    const logPaths = [...new Set([...hrefMatches, ...textMatches].map(normalizeLogPath).filter(Boolean))];

    logPaths.sort((left, right) => right.localeCompare(left));
    return logPaths;
}

function readableLogTime(logPath) {
    const fileName = logPath.split("/").pop() || "";
    const match = fileName.match(/log_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.json/);

    if (!match) return fileName;

    const [, year, month, day, hour, minute, second] = match;
    const date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
    );

    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

function createLogButton(logPath) {
    const button = createElement("button", { className: "log-option", type: "button" });
    const title = createElement("span", { className: "log-time", text: readableLogTime(logPath) });
    const name = createElement("span", { className: "log-name", text: logPath });

    button.appendChild(title);
    button.appendChild(name);
    button.addEventListener("click", () => {
        void loadLog(logPath);
    });

    return button;
}

async function showLogPicker(subtitle = LOG_PICKER_SUBTITLE) {
    setPickerVisible(true);
    clearSelection();
    renderInspector();
    ui.logPickerSubtitle.textContent = subtitle;
    ui.logPickerList.textContent = "Loading logs...";

    try {
        const response = await fetch("logs/");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const logPaths = listLogPathsFromHtml(await response.text());
        if (!logPaths.length) throw new Error("No logs found in logs/");

        ui.logPickerList.innerHTML = "";
        for (const logPath of logPaths) {
            ui.logPickerList.appendChild(createLogButton(logPath));
        }
    } catch (error) {
        ui.logPickerList.textContent = `Failed to list logs: ${String(error)}`;
    }
}

async function loadLog(logPath) {
    try {
        const response = await fetch(logPath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        state.logPath = logPath;
        state.entries = normalizeEntries(data.geo_cache);
        window.logJson = data;

        clearSelection();
        renderInspector();
        resetView();
        renderMap();
        ui.logPickerSubtitle.textContent = LOG_PICKER_SUBTITLE;
        setPickerVisible(false);
    } catch (error) {
        await showLogPicker(`Failed to load ${logPath}: ${String(error)}`);
    }
}

function handleOverlayClick(event) {
    if (state.view.movedWhilePanning) {
        state.view.movedWhilePanning = false;
        return;
    }

    const point = clientToMapPoint(event.clientX, event.clientY);
    selectEntriesNear(point.x, point.y);
}

function handleOverlayWheel(event) {
    event.preventDefault();

    const point = clientToMapPoint(event.clientX, event.clientY);
    if (event.ctrlKey) {
        zoomAt(point.sx, point.sy, event.deltaY < 0 ? CONFIG.zoomStep : 1 / CONFIG.zoomStep);
        return;
    }

    state.view.tx -= event.deltaX;
    state.view.ty -= event.deltaY;
    applyView();
}

function handleMouseDown(event) {
    if (event.button !== 0) return;

    event.preventDefault();
    state.view.panning = true;
    state.view.movedWhilePanning = false;
    state.view.lastX = event.clientX;
    state.view.lastY = event.clientY;
}

function handleMouseMove(event) {
    if (!state.view.panning) return;

    const dx = event.clientX - state.view.lastX;
    const dy = event.clientY - state.view.lastY;

    if (Math.abs(dx) + Math.abs(dy) > CONFIG.panThreshold) {
        state.view.movedWhilePanning = true;
    }

    state.view.lastX = event.clientX;
    state.view.lastY = event.clientY;
    state.view.tx += dx;
    state.view.ty += dy;
    applyView();
}

function handleMouseUp() {
    state.view.panning = false;
}

function handleMapImageError() {
    const currentIndex = Number(ui.mapImage.dataset.fallbackIndex || "0");
    const nextIndex = currentIndex + 1;
    if (nextIndex >= MAP_IMAGE_FALLBACKS.length) return;

    ui.mapImage.dataset.fallbackIndex = String(nextIndex);
    ui.mapImage.src = MAP_IMAGE_FALLBACKS[nextIndex];
}

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
    ui.logPickerSubtitle = document.getElementById("log-picker-subtitle");
    ui.logPickerList = document.getElementById("log-picker-list");
}

function bindEvents() {
    ui.overlay.addEventListener("click", handleOverlayClick);
    ui.overlay.addEventListener("wheel", handleOverlayWheel, { passive: false });
    ui.overlay.addEventListener("mousedown", handleMouseDown);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("resize", () => {
        if (state.entries.length) {
            renderMap();
        }
    });

    ui.zoomIn.addEventListener("click", () => {
        zoomAt(ui.mapWrap.clientWidth / 2, ui.mapWrap.clientHeight / 2, CONFIG.zoomStep);
    });
    ui.zoomOut.addEventListener("click", () => {
        zoomAt(ui.mapWrap.clientWidth / 2, ui.mapWrap.clientHeight / 2, 1 / CONFIG.zoomStep);
    });
    ui.zoomReset.addEventListener("click", resetView);
    ui.backToPicker.addEventListener("click", () => {
        void showLogPicker();
    });
    ui.mapImage.addEventListener("error", handleMapImageError);
}

function init() {
    cacheDom();
    ui.mapImage.dataset.fallbackIndex = "0";
    setInspectorEmpty();
    bindEvents();
    void showLogPicker();
}

init();
