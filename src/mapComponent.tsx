//import Map from 'react-offline-map';

import { useState, forwardRef, useImperativeHandle, useCallback, memo, useEffect, useRef } from 'react';
const isDev = process.env.NODE_ENV === 'development';

interface TemporaryPoint {
  id: string;   // Unique identifier used to target and remove the circle after its duration
  lat: number;  // Pixel Y position on the SVG overlay (converted from latitude)
  lng: number;  // Pixel X position on the SVG overlay (converted from longitude)
  r: number;    // Radius of the circle in pixels
  fill: string; // CSS color string for the circle fill
}

interface TemporaryText {
  id: string;   // Unique identifier used to target and remove the text after its duration
  lat: number;  // Pixel Y position on the SVG overlay (converted from latitude)
  lng: number;  // Pixel X position on the SVG overlay (converted from longitude)
  text: string; // Text content to display
  fill: string; // CSS color string for the text fill
}

interface TraceLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

// adds functions to the MapComponentHandle
export interface MapComponentHandle {
  addPoint: (lat: number, lng: number, ip: string, color: string, duration: number) => void;
  addTraceRoute: (lat: number, lon: number, ip: string, color: string, duration: number, trace: Array<Object>) => void;
}


// Handler that updates circles, texts and lines on ref updates
const CirclesOverlayWithText = ({ circles, texts, lines }: {
  circles: Map<string, TemporaryPoint>,
  texts: Map<string, TemporaryText>,
  lines: Map<string, TraceLine>
}) => (
  <svg style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} width={window.innerWidth} height={window.innerHeight}>
    {[...lines.values()].map((l) => (
      <line key={l.id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth={1} strokeOpacity={0.6} />
    ))}
    {[...circles.values()].map((c) => (
      <circle key={c.id} cx={c.lng} cy={c.lat} r={c.r} fill={c.fill} />
    ))}
    {[...texts.values()].map((t) => (
      <text key={t.id} x={t.lng} y={t.lat} fill={t.fill} fontSize="12" textAnchor="middle" alignmentBaseline="middle">{t.text}</text>
    ))}
  </svg>
);


const StaticMap = memo(() => {
  return (
    <>
      <img src="Icons/map_simple.png" alt="dev map" style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} />
    </>
  );
});

const MapComponentHandle = forwardRef<MapComponentHandle>((props, ref) => {
  const THROTTLE_MS = 500; // only add a new point for same IP every 2 seconds


  // cleans up points every 10 seconds so i dont have to fix the memory leak somewhere
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const lastSeenRef = useRef<Map<string, number>>(new Map());


  // helper to register a timeout
  const addTimeout = (fn: () => void, delay: number) => {
    const id = setTimeout(fn, delay);
    timeoutsRef.current.push(id);
    return id;
  };

  // ref maps
  const circlesRef = useRef<Map<string, TemporaryPoint>>(new Map());
  const textsRef = useRef<Map<string, TemporaryText>>(new Map());
  const linesRef = useRef<Map<string, TraceLine>>(new Map());

  // render states
  const [, forceRender] = useState(0);
  const renderPending = useRef(false);

  // handled rerenders of the circles and lines
  const scheduleRender = useCallback(() => {
    if (!renderPending.current) {
      renderPending.current = true;
      requestAnimationFrame(() => {
        forceRender(n => n + 1);
        renderPending.current = false;
      });
    }
  }, []);


    /**
* Adds a temporary trace given the locations of the trace array
* 
* @param lat - Latitude in degrees (-90 to 90)
* @param lng - Longitude in degrees (-180 to 180)
* @param ip - IP address used for throttle deduplication
* @param color - CSS color string for the text fill (e.g. 'white', '#FF0000')
* @param duration - Time in milliseconds before the text is removed. Pass 0 to keep permanently.
* 
* @remarks
* Throttled per IP — will silently skip if the same IP was seen within THROTTLE_MS.
* Coordinates are converted from degrees to pixel positions using the current window size.
* Y axis is flipped and offset by 12px to avoid overlapping with circle markers.
**/
  const addPoint = useCallback((lat: number, lng: number, ip: string, color: string, duration: number) => {
    const now = Date.now();
    const lastSeen = lastSeenRef.current.get(ip) || 0;
    if (now - lastSeen < THROTTLE_MS) return; // skip if seen recently
    lastSeenRef.current.set(ip, now);

    const id = `${ip}-${now}`;
    const point = {
      id,
      lng: ((lng + 180) / 360) * window.innerWidth,
      lat: ((90 - lat) / 180) * window.innerHeight,
      r: 5,
      fill: color,
    };

    circlesRef.current.set(id, point);
    scheduleRender();

    if (duration > 0) {
      addTimeout(() => {
        circlesRef.current.delete(id);
        scheduleRender();
      }, duration);
    } else {
      addText(lat, lng, ip, ip, color, duration);
    }
  }, [scheduleRender]);


  /**
* Adds a temporary trace given the locations of the trace array
* 
* @param lat - Latitude in degrees (-90 to 90)
* @param lng - Longitude in degrees (-180 to 180)
* @param ip - IP address used for throttle deduplication
* @param color - CSS color string for the text fill (e.g. 'white', '#FF0000')
* @param duration - Time in milliseconds before the text is removed. Pass 0 to keep permanently.
* 
* @remarks
* Throttled per IP — will silently skip if the same IP was seen within THROTTLE_MS.
* Coordinates are converted from degrees to pixel positions using the current window size.
* Y axis is flipped and offset by 12px to avoid overlapping with circle markers.
**/
  const addTracePoint = useCallback((lat: number, lng: number, ip: string, color: string, duration: number) => {
    const now = Date.now();
    const lastSeen = lastSeenRef.current.get(`hop-${ip}`) || 0;
    if (now - lastSeen < THROTTLE_MS) return;
    lastSeenRef.current.set(`hop-${ip}`, now);

    const id = `${ip}-${now}`;
    const point = {
      id,
      lng: ((lng + 180) / 360) * window.innerWidth,
      lat: ((90 - lat) / 180) * window.innerHeight,
      r: 3,
      fill: color,
    };

    circlesRef.current.set(id, point);
    scheduleRender();

    if (duration > 0) {
      addTimeout(() => {
        circlesRef.current.delete(id);
        scheduleRender();
      }, duration);
    } else {
      addText(lat, lng, ip, ip, color, duration);
    }
  }, [scheduleRender]);


  /**
 * Adds a temporary trace given the locations of the trace array
 * 
 * @param lat - Latitude in degrees (-90 to 90)
 * @param lng - Longitude in degrees (-180 to 180)
 * @param ip - IP address used for throttle deduplication
 * @param color - CSS color string for the text fill (e.g. 'white', '#FF0000')
 * @param duration - Time in milliseconds before the text is removed. Pass 0 to keep permanently.
 * @param trace - Array of trace points with the format of: {ttl: 1, ip: '100.110.24.1', rtt: 0.22, lon: 0, lat: 0}
 * 
 * @remarks
 * Throttled per IP — will silently skip if the same IP was seen within THROTTLE_MS.
 * Coordinates are converted from degrees to pixel positions using the current window size.
 * Y axis is flipped and offset by 12px to avoid overlapping with circle markers.
 * 
 * FIX: right now this shows hops as white, might not be ordered correctly, use the lat and lon to set the original in or out point
 * and then maybe order them and test
 */

  const addTraceRoute = useCallback((lat: number, lon: number, ip: string, color: string, duration: number, trace: any[]) => {
    const now = Date.now();
    const lastSeen = lastSeenRef.current.get(`hop-${ip}`) || 0;
    if (now - lastSeen < THROTTLE_MS) return;
    lastSeenRef.current.set(`hop-${ip}`, now);

    color = "white";         // hops are white

    // every line except last
    const newLines: TraceLine[] = [];
    for (let i = 0; i < trace.length - 1; i++) {
      const from = trace[i];
      const to = trace[i + 1];
      if (!from.lat || !from.lon || !to.lat || !to.lon) continue;
      if (from.lat === to.lat && from.lon === to.lon) continue;

      const id = `${from.lat},${from.lon}-${to.lat},${to.lon}-${Math.random()}`;
      newLines.push({
        id,
        x1: ((from.lon + 180) / 360) * window.innerWidth,
        y1: ((90 - from.lat) / 180) * window.innerHeight,
        x2: ((to.lon + 180) / 360) * window.innerWidth,
        y2: ((90 - to.lat) / 180) * window.innerHeight,
        color,
      });
    }

    // connects to the last point
    const lastHop = [...trace].reverse().find(h => h.lat && h.lon);
    if (lastHop && lat && lon) {
      newLines.push({
        id: `${lastHop.lat},${lastHop.lon}-${lat},${lon}-${Math.random()}`,
        x1: ((lastHop.lon + 180) / 360) * window.innerWidth,
        y1: ((90 - lastHop.lat) / 180) * window.innerHeight,
        x2: ((lon + 180) / 360) * window.innerWidth,
        y2: ((90 - lat) / 180) * window.innerHeight,
        color,
      });
    }

    trace.forEach(hop => {
      if (hop.lat && hop.lon) {
        addTracePoint(hop.lat, hop.lon, hop.ip, color, duration);
      }
    });

    const lineIds = newLines.map(l => l.id);
    newLines.forEach(l => linesRef.current.set(l.id, l));
    scheduleRender();

    if (duration > 0) {
      addTimeout(() => {
        lineIds.forEach(id => linesRef.current.delete(id));
        scheduleRender();
      }, duration);
    }
    const destId = `${ip}-dest-${Date.now()}`;
    circlesRef.current.set(destId, {
      id: destId,
      lng: ((lon + 180) / 360) * window.innerWidth,
      lat: ((90 - lat) / 180) * window.innerHeight,
      r: 3,
      fill: color,
    });

    if (duration > 0) {
      addTimeout(() => {
        circlesRef.current.delete(destId);
        scheduleRender();
      }, duration);
    }
  }, [addTracePoint, scheduleRender]);


  /**
   * Adds a temporary text label at the given coordinates on the map overlay.
   * 
   * @param lat - Latitude in degrees (-90 to 90)
   * @param lng - Longitude in degrees (-180 to 180)
   * @param ip - IP address used for throttle deduplication
   * @param text - Text content to display
   * @param color - CSS color string for the text fill (e.g. 'white', '#FF0000')
   * @param duration - Time in milliseconds before the text is removed. Pass 0 to keep permanently.
   * 
   * @remarks
   * Throttled per IP — will silently skip if the same IP was seen within THROTTLE_MS.
   * Coordinates are converted from degrees to pixel positions using the current window size.
   * Y axis is flipped and offset by 12px to avoid overlapping with circle markers.
   */
  const addText = useCallback((lat: number, lng: number, ip: string, text: string, color: string, duration: number) => {
    const now = Date.now();
    const lastSeen = lastSeenRef.current.get(ip) || 0;
    if (now - lastSeen < THROTTLE_MS) return; // skip if seen recently
    lastSeenRef.current.set(ip, now);
    const id = `${lat},${lng},${Math.random()}`;
    const point = {
      id,
      lng: ((lng + 180) / 360) * window.innerWidth,
      lat: ((90 - lat) / 180) * window.innerHeight - 12,
      text,
      fill: color,
    };

    textsRef.current.set(id, point);
    scheduleRender();

    if (duration > 0) {
      addTimeout(() => {
        textsRef.current.delete(id);
        scheduleRender();
      }, duration);
    }
  }, [scheduleRender]);


  /**
   * Exposes `addPoint` and `addText` on the forwarded ref so parent components can call them directly.
   * The dependency on `addCircle` ensures the exposed function updates if addCircle ever changes
   * (it won't here due to the empty useCallback dep array, but it's correct practice).
   */
  useImperativeHandle(ref, () => ({ addPoint, addTraceRoute }), [addPoint, addTraceRoute]);



  // Interval that wipes all refs in order to preserve memory in case of leaks
  // FIX MEMORY LEAKS
  useEffect(() => {
    const interval = setInterval(() => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
      circlesRef.current.clear();
      textsRef.current.clear();
      linesRef.current.clear();
      lastSeenRef.current.clear(); // allow all IPs to be re-added after cleanup
      scheduleRender();
    }, 10000);
    return () => clearInterval(interval);
  }, [scheduleRender]);

  // main return for the component
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <StaticMap />
        <CirclesOverlayWithText circles={circlesRef.current} texts={textsRef.current} lines={linesRef.current} />

      </div>
    </div>
  );
});

export default MapComponentHandle;