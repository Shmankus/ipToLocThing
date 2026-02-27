import Map from 'react-offline-map';

import { useState, forwardRef, useImperativeHandle, useCallback, memo, useMemo, useEffect } from 'react';
const isDev = process.env.NODE_ENV === 'development';
/**
 * Represents a temporary circle point rendered on the map overlay.
 * Coordinates (lat, lng) are stored as pre-converted pixel values, not degrees.
 */
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
}

/**
 * The externally-accessible API exposed to parent components via a ref.
 * Use this interface when typing a ref that will be passed to MapComponentHandle.
 *
 * @example
 * const mapRef = useRef<MapComponentHandle>(null);
 * <MapComponentHandle ref={mapRef} />
 * mapRef.current?.addPoint(51.5, -0.1, '#00FF00', 8);
 */
export interface MapComponentHandle {
  /**
   * Adds a temporary circle at the given coordinates that disappears after 1 second.
   * @param lat - Latitude in degrees (-90 to 90)
   * @param lng - Longitude in degrees (-180 to 180)
   * @param color - Optional CSS color string (default: '#FF0000')
   * @param radius - Optional circle radius in pixels (default: 0.1)
   * @param duration - Optional duration in milliseconds (default: 1000)
   * @param text - Optional text to display on the circle
   */
  addPoint: (lat: number, lng: number, color?: string, radius?: number, duration?: number, text?: string) => void;
  addText: (lat: number, lng: number, text: string, duration?: number) => void;
}

/**
 * A memoized, static map component that renders once and never re-renders.
 *
 * Wrapping in `memo` means React will skip re-rendering this component as long
 * as its props don't change. Since it receives no props, it only ever renders
 * on mount — preventing the expensive map tile rendering from firing every time
 * a circle is added or removed.
 *
 * Dimensions are captured once via `useMemo` with an empty dependency array,
 * ensuring window.innerWidth/Height are read only at mount time.
 */
const StaticMap = memo(() => {
  const width = useMemo(() => window.innerWidth, []);
  const height = useMemo(() => window.innerHeight, []);

  return (
    <Map
      width={width}
      height={height}
      mapQuality= {(isDev ? 'high' : 'low')}
    />
  );
});


/**
 * A memoized SVG overlay that renders circles and optional text on top of the map.
 * Receives an array of circles and texts as props, and re-renders only when these arrays change.
 * Each circle and text has a unique `id` used as the React `key` to optimize rendering when items are added or removed.
 *
 * The SVG is absolutely positioned to cover the entire map, and `pointerEvents: 'none'` allows clicks to pass through to the map below.
 * Circles are rendered as `<circle>` elements, and texts are rendered as `<text>` elements with red fill for visibility.
 * In development mode, text labels are shown; in production, only circles are rendered to minimize visual clutter.
 * 
 * @param circles - Array of TemporaryPoint objects representing circles to render
 * @param texts - Array of TemporaryText objects representing text labels to render (only in development mode)
 */
const CirclesOverlayWithText = memo(({ circles, texts }: { circles: TemporaryPoint[], texts: TemporaryText[] }) => (
  <svg
    style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    width={window.innerWidth}
    height={window.innerHeight}
  >
    {circles.map((c) => (
      // `key` uses the unique id so React can efficiently diff added/removed circles
      <circle key={c.id} cx={c.lng} cy={c.lat} r={c.r} fill={c.fill} />
    ))}
    {(isDev) && texts.map((t) => (
      <text key={t.id} x={t.lng} y={t.lat} fill="orange" fontSize="12" textAnchor="middle" alignmentBaseline="middle">
        {t.text}
      </text>
    ))}
  </svg>
));

/**
 * The main map component that composes StaticMap and CirclesOverlay.
 *
 * Uses `forwardRef` to accept a ref from the parent, and `useImperativeHandle`
 * to expose the `addPoint` method on that ref. This allows parent components to
 * imperatively trigger circle additions without needing to manage circle state
 * themselves or pass callbacks down through props.
 *
 * State is intentionally kept here (not in a parent) so that only this subtree
 * re-renders when circles change, and StaticMap is fully isolated.
 */
const MapComponentHandle = forwardRef<MapComponentHandle>((props, ref) => {
  // Array of currently visible circles. Each addition and removal triggers a
  // re-render of CirclesOverlay only — StaticMap is unaffected due to memo.
  const [circles, setCircles] = useState<TemporaryPoint[]>([]);
  const [circleText, setCircleText] = useState<TemporaryText[]>([]);

  /**
   * Adds a circle at the given lat/lng and schedules its removal after 1 second.
   *
   * Lat/lng degrees are converted to pixel coordinates:
   *   X (lng): shifts range from [-180, 180] to [0, 360], then scales to screen width
   *   Y (lat): flipped because screen Y increases downward but latitude increases upward,
   *            shifts range from [90, -90] to [0, 180], then scales to screen height
   *
   * Wrapped in `useCallback` with `[]` so the function reference is stable across
   * renders — required for `useImperativeHandle` to not re-fire unnecessarily.
   */
  const addCircle = useCallback((lat: number, lng: number, color = '#FF0000', radius = 0.1, duration = 1000) => {
    const id = `${lat},${lng}`;

    setCircles((prev) => {
      if (prev.some(c => c.id === id)) return prev; // already exists, skip

      setTimeout(() => {
        setCircles((prev) => prev.filter((c) => c.id !== id));
      }, duration);

      return [...prev, {
        id,
        lng: ((lng + 180) / 360) * window.innerWidth,
        lat: ((90 - lat) / 180) * window.innerHeight,
        r: radius,
        fill: color,
      }];
    });
  }, []);

  // MERGE TEXT AND CIRCLE ADDITION INTO ONE FUNCTION LATER, ALSO MAKE TEXT OPTIONAL IN addCircle TO AVOID DUPLICATE CALLS

  const addText = useCallback((lat: number, lng: number, text: string, duration = 1000) => {
    const id = `${lat},${lng},${text}`; // Unique ID based on coordinates and text

    setCircleText((prev) => {
      if (prev.some(t => t.id === id)) return prev; // already exists, skip

      setTimeout(() => {
        setCircleText((prev) => prev.filter((t) => t.id !== id));
      }, duration);



      return [...prev, {
        id,
        lng: ((lng + 180) / 360) * window.innerWidth,   // x axis
        lat: ((90 - lat) / 180) * window.innerHeight - 12,    // y axis, flipped (offset by 12px to avoid overlapping with circle)
        text,
      }];
    });
  }, []);


  // clears the circle and text array every 10 seconds (FIX MEMORY LEAK LATER)

  // useEffect(() => {

  //   const intervalId = setInterval(() => {
  //     setCircles([]);
  //     setCircleText([]);
  //     console.log("Cleared circles and texts to prevent memory leak");
  //   }, 10000);

  //   return () => {
  //     clearInterval(intervalId);
  //   };
  // }, []);


  /**
   * Exposes `addPoint` and `addText` on the forwarded ref so parent components can call them directly.
   * The dependency on `addCircle` ensures the exposed function updates if addCircle ever changes
   * (it won't here due to the empty useCallback dep array, but it's correct practice).
   */
  useImperativeHandle(ref, () => ({ addPoint: addCircle, addText }), [addCircle, addText]);

  return (
    // `position: relative` makes this div the anchor for CirclesOverlay's `position: absolute`
    <>
      <div style={{ position: 'relative' }}>
        {/* Hides built-in map toolbar and navigation controls via attribute selectors */}
        <style>{`[role="toolbar"],[role="navigation"]{display:none!important}`}</style>
        <StaticMap />
      </div>
      <CirclesOverlayWithText circles={circles} texts={circleText} /> {/* Renders circles and text on top of the map, re-rendering only when these arrays change */}
    </>
  );
});

export default MapComponentHandle;