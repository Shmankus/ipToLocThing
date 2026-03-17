import { startTransition, useEffect, useRef, useState } from 'react'
import './logMapper.css'
import {
  buildPlottedEntries,
  colorSet,
  comparePortNames,
  formatCoordinates,
  formatFieldValue,
  formatKeyLabel,
  getNmapData,
  getRoutePoints,
  hasCoordinates,
  normalizeEntries,
  projectPoint,
  readableLogTime,
} from './logMapperHelpers'
import type { Entry, RawEntry } from './logMapperHelpers'

const DEFAULT_PICKER_SUBTITLE = 'Select a capture to open the map view.'
const CLICK_RADIUS = 8
const MAX_ZOOM = 6
const MIN_ZOOM = 0.6
const ZOOM_STEP = 1.2
const PAN_THRESHOLD = 3
const POINT_RADIUS = 3
const SELECTED_POINT_RADIUS = 4.5
const HOP_RADIUS = 2.4
const SELECTED_HOP_RADIUS = 4.2
const MAP_IMAGE_SRC = `${import.meta.env.BASE_URL}Icons/map_simple.png`

// Current pan/zoom transform applied to both the map image and SVG overlay.
type ViewState = {
  scale: number
  tx: number
  ty: number
}

// Cached stage size so lat/lon can be projected into the current pixel space.
type MapSize = {
  width: number
  height: number
}

// Mutable drag state lives in a ref so mousemove does not rerender on every frame.
type DragState = {
  panning: boolean
  movedWhilePanning: boolean
  lastX: number
  lastY: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Builds the small status panel shown over the map.
 * Keeping it as a single string preserves the original preformatted debug-style UI.
 */
function statusText(
  activeLogName: string,
  entryCount: number,
  plottedCount: number,
  segmentCount: number,
  selectedEntry: Entry | null,
): string {
  const lines = [
    `Log: ${activeLogName ? `logs/${activeLogName}` : 'none'}`,
    `Entries: ${entryCount}`,
    `Plotted points: ${plottedCount}`,
    `Trace segments: ${segmentCount}`,
  ]

  if (selectedEntry?.ip) {
    lines.push(`Selected: ${selectedEntry.ip}`)
  }

  return lines.join('\n')
}

/**
 * Renders object fields in a stable order for the inspector.
 * We hide bulky/internal fields here and format the remaining values consistently.
 */
function renderRows(data: Record<string, unknown>, hiddenKeys: string[] = []) {
  const hidden = new Set(hiddenKeys)

  return Object.keys(data)
    .filter((key) => !hidden.has(key))
    .sort()
    .map((key) => (
      <div className="log-mapper__row" key={key}>
        {formatKeyLabel(key)}: {formatFieldValue(key, data[key])}
      </div>
    ))
}

export default function LogMapperView() {
  // Log picker / loading state.
  const [logNames, setLogNames] = useState<string[]>([])
  const [pickerSubtitle, setPickerSubtitle] = useState(DEFAULT_PICKER_SUBTITLE)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [loadingLogName, setLoadingLogName] = useState<string | null>(null)
  const [isPickerOpen, setIsPickerOpen] = useState(true)

  // Loaded log data and current map selection.
  const [activeLogName, setActiveLogName] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [selectedEntries, setSelectedEntries] = useState<Entry[]>([])
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(0)
  const [selectedHopIndex, setSelectedHopIndex] = useState<number | null>(null)

  // Viewport and projected geometry state.
  const [view, setView] = useState<ViewState>({ scale: 1, tx: 0, ty: 0 })
  const [mapSize, setMapSize] = useState<MapSize>({ width: 0, height: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [plottedEntries, setPlottedEntries] = useState(() => buildPlottedEntries([], 0, 0))
  const [segmentCount, setSegmentCount] = useState(0)

  const mapWrapRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<DragState>({
    panning: false,
    movedWhilePanning: false,
    lastX: 0,
    lastY: 0,
  })
  const viewRef = useRef(view)

  // Derived selection objects used by the inspector and highlight overlay.
  const selectedEntry = selectedEntries[selectedEntryIndex] ?? null
  const selectedPlottedEntry = selectedEntry
    ? plottedEntries.find((plotted) => plotted.entry === selectedEntry) ?? null
    : null
  const selectedHop = selectedEntry && selectedHopIndex !== null
    ? selectedEntry.trace[selectedHopIndex] ?? null
    : null
  const nmapData = getNmapData(selectedEntry)

  // Some pointer handlers need the latest transform immediately without waiting for rerender.
  useEffect(() => {
    viewRef.current = view
  }, [view])

  /**
   * Watches the visible map container so routes/points can be reprojected whenever
   * the stage changes size.
   */
  useEffect(() => {
    const element = mapWrapRef.current
    if (!element) return

    const updateSize = () => {
      setMapSize({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    }

    updateSize()

    const observer = new ResizeObserver(updateSize)
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  /**
   * Rebuilds projected map geometry whenever the loaded entries or stage size changes.
   * This keeps the render pass itself mostly declarative.
   */
  useEffect(() => {
    if (!mapSize.width || !mapSize.height) return

    const nextPlottedEntries = buildPlottedEntries(entries, mapSize.width, mapSize.height)
    setPlottedEntries(nextPlottedEntries)
    setSegmentCount(
      nextPlottedEntries.reduce((total, plottedEntry) => total + plottedEntry.routeSegments.length, 0),
    )
  }, [entries, mapSize.height, mapSize.width])

  // Load the available local logs as soon as the view opens.
  useEffect(() => {
    void loadLogList()
  }, [])

  /**
   * Global mouse listeners keep drag-pan working even if the pointer leaves the map bounds.
   * Drag bookkeeping is stored in refs to avoid rendering on every mousemove.
   */
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragRef.current.panning) return

      const dx = event.clientX - dragRef.current.lastX
      const dy = event.clientY - dragRef.current.lastY

      if (Math.abs(dx) + Math.abs(dy) > PAN_THRESHOLD) {
        dragRef.current.movedWhilePanning = true
      }

      dragRef.current.lastX = event.clientX
      dragRef.current.lastY = event.clientY

      setView((currentView) => ({
        ...currentView,
        tx: currentView.tx + dx,
        ty: currentView.ty + dy,
      }))
    }

    const handleMouseUp = () => {
      dragRef.current.panning = false
      setIsPanning(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  /**
   * Pulls the list of local JSON logs from the dev-only Vite endpoint.
   * This endpoint only exists in development, so production cannot switch into this view.
   */
  async function loadLogList(nextSubtitle = DEFAULT_PICKER_SUBTITLE) {
    setIsLoadingLogs(true)
    setPickerError(null)
    setPickerSubtitle(nextSubtitle)

    try {
      const response = await fetch('/__dev/logs')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const payload = (await response.json()) as string[]
      const nextLogNames = payload.filter((fileName) => /^log.*\.json$/i.test(fileName))
      setLogNames(nextLogNames)

      if (!nextLogNames.length) {
        setPickerError('No logs found in the local logs directory.')
      }
    } catch (error) {
      setPickerError(`Failed to list local logs: ${String(error)}`)
    } finally {
      setIsLoadingLogs(false)
    }
  }

  /**
   * Loads a single log, normalizes the geo_cache payload, and resets the current
   * selection/view so the new file opens from a known state.
   */
  async function loadLog(logName: string) {
    setLoadingLogName(logName)
    setPickerSubtitle(`Loading ${logName}...`)
    setPickerError(null)

    try {
      const response = await fetch(`/__dev/logs/${encodeURIComponent(logName)}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const payload = (await response.json()) as { geo_cache?: RawEntry[] }
      const nextEntries = normalizeEntries(payload.geo_cache)

      startTransition(() => {
        setEntries(nextEntries)
        setActiveLogName(logName)
        setSelectedEntries([])
        setSelectedEntryIndex(0)
        setSelectedHopIndex(null)
        setView({ scale: 1, tx: 0, ty: 0 })
        setIsPickerOpen(false)
      })

      setPickerSubtitle(DEFAULT_PICKER_SUBTITLE)
    } catch (error) {
      setPickerError(`Failed to load ${logName}: ${String(error)}`)
      setIsPickerOpen(true)
      setPickerSubtitle(DEFAULT_PICKER_SUBTITLE)
    } finally {
      setLoadingLogName(null)
    }
  }

  // Returns to the picker and clears any stale selection from the previous file.
  function openPicker() {
    setSelectedEntries([])
    setSelectedEntryIndex(0)
    setSelectedHopIndex(null)
    setIsPickerOpen(true)
    void loadLogList()
  }

  /**
   * Zooms around the current cursor position instead of the screen center.
   * That keeps the point under the pointer anchored during wheel zoom.
   */
  function zoomAt(screenX: number, screenY: number, factor: number) {
    setView((currentView) => {
      const nextScale = clamp(currentView.scale * factor, MIN_ZOOM, MAX_ZOOM)
      if (nextScale === currentView.scale) return currentView

      const ratio = nextScale / currentView.scale
      return {
        scale: nextScale,
        tx: screenX - ((screenX - currentView.tx) * ratio),
        ty: screenY - ((screenY - currentView.ty) * ratio),
      }
    })
  }

  function resetView() {
    setView({ scale: 1, tx: 0, ty: 0 })
  }

  /**
   * Converts a browser mouse position into map-space coordinates by accounting for
   * both the current element bounds and the active pan/zoom transform.
   */
  function clientToMapPoint(clientX: number, clientY: number): { x: number; y: number; sx: number; sy: number } | null {
    const overlay = overlayRef.current
    if (!overlay || !mapSize.width || !mapSize.height) return null

    const rect = overlay.getBoundingClientRect()
    if (!rect.width || !rect.height) return null

    const currentView = viewRef.current
    const sx = (clientX - rect.left) * (mapSize.width / rect.width)
    const sy = (clientY - rect.top) * (mapSize.height / rect.height)

    return {
      x: (sx - currentView.tx) / currentView.scale,
      y: (sy - currentView.ty) / currentView.scale,
      sx,
      sy,
    }
  }

  // Finds all destination points close to the click so stacked IPs can be cycled in the inspector.
  function selectEntriesNear(clientX: number, clientY: number) {
    const mapPoint = clientToMapPoint(clientX, clientY)
    if (!mapPoint) return

    const matches = plottedEntries
      .filter((plotted) => Math.hypot(plotted.destination.x - mapPoint.x, plotted.destination.y - mapPoint.y) <= CLICK_RADIUS)
      .map((plotted) => plotted.entry)

    setSelectedEntries(matches)
    setSelectedEntryIndex(0)
    setSelectedHopIndex(null)
  }

  // Moves between overlapping entries that share the same click area.
  function moveSelectedEntry(delta: number) {
    if (selectedEntries.length < 2) return

    setSelectedEntryIndex((currentIndex) => {
      const nextIndex = currentIndex + delta + selectedEntries.length
      return nextIndex % selectedEntries.length
    })
    setSelectedHopIndex(null)
  }

  // Ignore the synthetic click fired after a drag-pan so dragging does not also select a point.
  function handleMapClick(event: React.MouseEvent<HTMLDivElement>) {
    if (dragRef.current.movedWhilePanning) {
      dragRef.current.movedWhilePanning = false
      return
    }

    selectEntriesNear(event.clientX, event.clientY)
  }

  /**
   * Matches the old standalone mapper behavior:
   * ctrl+wheel zooms and plain wheel pans the current viewport.
   */
  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()

    const mapPoint = clientToMapPoint(event.clientX, event.clientY)
    if (!mapPoint) return

    if (event.ctrlKey) {
      zoomAt(mapPoint.sx, mapPoint.sy, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
      return
    }

    setView((currentView) => ({
      ...currentView,
      tx: currentView.tx - event.deltaX,
      ty: currentView.ty - event.deltaY,
    }))
  }

  // Starts a left-button drag-pan gesture.
  function handleMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return

    event.preventDefault()
    dragRef.current.panning = true
    dragRef.current.movedWhilePanning = false
    dragRef.current.lastX = event.clientX
    dragRef.current.lastY = event.clientY
    setIsPanning(true)
  }

  return (
    <div className="log-mapper">
      {/* Full-screen picker overlay for choosing which saved log to inspect. */}
      <section className={`log-mapper__picker ${isPickerOpen ? '' : 'is-hidden'}`}>
        <div className="log-mapper__picker-card">
          <h1 className="log-mapper__picker-title">Choose a Log</h1>
          <p className="log-mapper__picker-subtitle">{pickerSubtitle}</p>

          <div className="log-mapper__picker-list">
            {isLoadingLogs && <div className="log-mapper__picker-message">Loading logs...</div>}
            {!isLoadingLogs && pickerError && <div className="log-mapper__picker-message">{pickerError}</div>}
            {!isLoadingLogs && !pickerError && logNames.map((logName) => (
              <button
                className="log-mapper__log-option"
                disabled={Boolean(loadingLogName)}
                key={logName}
                onClick={() => {
                  void loadLog(logName)
                }}
                type="button"
              >
                <span className="log-mapper__log-time">{readableLogTime(logName)}</span>
                <span className="log-mapper__log-name">{`logs/${logName}`}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Interactive map stage: static image plus SVG overlay that share the same transform. */}
      <div
        className={`log-mapper__stage ${isPanning ? 'is-panning' : ''}`}
        onClick={handleMapClick}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        ref={mapWrapRef}
      >
        <img
          alt="World map background"
          className="log-mapper__map"
          src={MAP_IMAGE_SRC}
          style={{
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            transformOrigin: 'top left',
          }}
        />

        <svg className="log-mapper__overlay" ref={overlayRef} viewBox={`0 0 ${mapSize.width} ${mapSize.height}`}>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {/* Base routes for every plotted entry. */}
            <g>
              {plottedEntries.flatMap((plotted) => {
                const colors = colorSet(plotted.entry.direction)
                return plotted.routeSegments.map((segment) => (
                  <line
                    className="log-mapper__route"
                    key={segment.key}
                    stroke={colors.route}
                    strokeWidth={1.2}
                    x1={segment.start.x}
                    x2={segment.end.x}
                    y1={segment.start.y}
                    y2={segment.end.y}
                  />
                ))
              })}
            </g>

            {/* Selected route and hop markers are rendered in a separate layer for emphasis. */}
            {selectedPlottedEntry && (
              <g>
                {selectedPlottedEntry.routeSegments.map((segment) => {
                  const colors = colorSet(selectedPlottedEntry.entry.direction)
                  return (
                    <line
                      className="log-mapper__route"
                      key={`${segment.key}-selected`}
                      stroke={colors.activeRoute}
                      strokeWidth={2.2}
                      x1={segment.start.x}
                      x2={segment.end.x}
                      y1={segment.start.y}
                      y2={segment.end.y}
                    />
                  )
                })}

                {getRoutePoints(selectedPlottedEntry.entry).slice(0, -1).map((hop, hopIndex) => {
                  if (!hasCoordinates(hop)) return null
                  const hopPoint = projectPoint(hop, mapSize.width, mapSize.height)
                  return (
                    <circle
                      className="log-mapper__hop"
                      cx={hopPoint.x}
                      cy={hopPoint.y}
                      fill="rgba(255, 255, 255, 0.85)"
                      key={`${selectedPlottedEntry.key}-hop-${hopIndex}`}
                      r={HOP_RADIUS}
                    />
                  )
                })}

                {selectedHop && hasCoordinates(selectedHop) && (
                  <circle
                    cx={projectPoint(selectedHop, mapSize.width, mapSize.height).x}
                    cy={projectPoint(selectedHop, mapSize.width, mapSize.height).y}
                    fill={colorSet(selectedPlottedEntry.entry.direction).point}
                    r={SELECTED_HOP_RADIUS}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                )}
              </g>
            )}

            {/* Destination points stay on top so hit-testing remains intuitive. */}
            <g>
              {plottedEntries.map((plotted) => {
                const isSelected = plotted.entry === selectedEntry
                const colors = colorSet(plotted.entry.direction)

                return (
                  <circle
                    className={`log-mapper__point ${isSelected ? 'is-selected' : ''}`}
                    cx={plotted.destination.x}
                    cy={plotted.destination.y}
                    fill={colors.point}
                    fillOpacity={selectedEntry && !isSelected ? 0.35 : 1}
                    key={plotted.key}
                    r={isSelected ? SELECTED_POINT_RADIUS : POINT_RADIUS}
                  />
                )
              })}
            </g>
          </g>
        </svg>
      </div>

      {!isPickerOpen && (
        <>
          <div className="log-mapper__status">
            {statusText(activeLogName, entries.length, plottedEntries.length, segmentCount, selectedEntry)}
          </div>

          {/* Small map control strip that mirrors the standalone page controls. */}
          <nav className="log-mapper__controls">
            <button onClick={openPicker} type="button">Choose Log</button>
            <button
              onClick={() => {
                zoomAt(mapSize.width / 2, mapSize.height / 2, ZOOM_STEP)
              }}
              type="button"
            >
              +
            </button>
            <button
              onClick={() => {
                zoomAt(mapSize.width / 2, mapSize.height / 2, 1 / ZOOM_STEP)
              }}
              type="button"
            >
              -
            </button>
            <button onClick={resetView} type="button">Reset</button>
          </nav>

          {/* Inspector switches between entry details and per-hop details for the current selection. */}
          <aside className={`log-mapper__inspector ${selectedEntry ? '' : 'is-hidden'}`}>
            {selectedEntry ? (
              <div className="log-mapper__inspector-content">
                <div className="log-mapper__button-row">
                  {selectedHop ? (
                    <button
                      onClick={() => {
                        setSelectedHopIndex(null)
                      }}
                      type="button"
                    >
                      Back To Entry
                    </button>
                  ) : (
                    selectedEntries.length > 1 && (
                      <>
                        <button onClick={() => moveSelectedEntry(-1)} type="button">Prev Entry</button>
                        <button onClick={() => moveSelectedEntry(1)} type="button">Next Entry</button>
                      </>
                    )
                  )}
                </div>

                <h3>
                  {selectedHop
                    ? `Hop ${selectedHopIndex !== null ? selectedHopIndex + 1 : ''}`
                    : `Entry ${selectedEntryIndex + 1} / ${selectedEntries.length}`}
                </h3>

                {selectedHop ? (
                  renderRows(selectedHop as Record<string, unknown>)
                ) : (
                  <>
                    {renderRows(selectedEntry as Record<string, unknown>, ['trace', 'locLookupTime', 'lat', 'lon', 'Nmap', 'nmap'])}
                    <div className="log-mapper__row">Coordinates: {formatCoordinates(selectedEntry)}</div>
                    <div className="log-mapper__row">Trace Hops: {selectedEntry.trace.length}</div>

                    {nmapData && Object.keys(nmapData).length > 0 && (
                      <div className="log-mapper__section">
                        <div className="log-mapper__section-title">Nmap ports</div>
                        {Object.keys(nmapData).sort(comparePortNames).map((port) => (
                          <div className="log-mapper__row" key={port}>
                            {port}: {String(nmapData[port] ?? 'n/a')}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="log-mapper__section">
                      <div className="log-mapper__section-title">Trace hops</div>
                      {!selectedEntry.trace.length ? (
                        <div className="log-mapper__muted">No trace data</div>
                      ) : (
                        <div className="log-mapper__hop-list">
                          {selectedEntry.trace.map((hop, hopIndex) => {
                            const locationParts = [hop.country, hop.province].filter(
                              (part) => part && part !== '-',
                            )

                            return (
                              <button
                                key={`${selectedEntry.ip || 'entry'}-trace-${hopIndex}`}
                                onClick={() => {
                                  setSelectedHopIndex(hopIndex)
                                }}
                                type="button"
                              >
                                [{hopIndex + 1}] {hop.ip || 'n/a'}
                                {locationParts.length ? ` - ${locationParts.join(', ')}` : ''}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="log-mapper__muted">Click a colored point to inspect its route.</div>
            )}
          </aside>
        </>
      )}
    </div>
  )
}
