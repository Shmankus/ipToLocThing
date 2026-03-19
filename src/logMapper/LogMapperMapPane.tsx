/**
 * LogMapperMapPane owns the visual map surface in the middle of the log mapper layout.
 *
 * This component is responsible for rendering:
 * - the map background image
 * - all route lines and arrowheads
 * - destination points and selected highlights
 * - hop markers for the currently selected route
 * - the small status block and map control buttons
 *
 * It does not own the source-of-truth state for selection, panning, zooming, or log data.
 * Those pieces are all passed in from LogMapperView. That split is deliberate: this file
 * focuses on "how the map looks and reacts," while the parent decides "what the current
 * state of the mapper is."
 */
import type { MouseEvent, RefObject, WheelEvent } from 'react'
import {
  colorSet,
  getRoutePoints,
  hasCoordinates,
  projectPoint,
} from '../logMapperHelpers'
import type { Entry, Hop, PlottedEntry } from '../logMapperHelpers'
import type { MapSize, ViewState } from './types'

const POINT_RADIUS = 3
const SELECTED_POINT_RADIUS = 4.5
const HOP_RADIUS = 2.4
const SELECTED_HOP_RADIUS = 4.2
const MAP_IMAGE_SRC = `${import.meta.env.BASE_URL}Icons/map_simple.png`
const ARROW_LEN = 16
const ARROW_WIDTH = 10
const MIN_ARROW_SEG_PX = 8
const ARROW_LONG_SEG_PX = 220
const ARROW_SHORT_BUCKET = 18
const ARROW_LONG_BUCKET = 55

type RouteLine = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  reverseArrow?: boolean
}

type LogMapperMapPaneProps = {
  activeLogName: string
  entryCount: number
  plottedEntries: PlottedEntry[]
  segmentCount: number
  selectedEntry: Entry | null
  selectedHop: Hop | null
  view: ViewState
  mapSize: MapSize
  isPanning: boolean
  mapWrapRef: RefObject<HTMLDivElement | null>
  overlayRef: RefObject<SVGSVGElement | null>
  onMapClick: (event: MouseEvent<HTMLDivElement>) => void
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void
  onWheel: (event: WheelEvent<HTMLDivElement>) => void
  onOpenPicker: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onResetView: () => void
}

function getMidArrowPoints(x1: number, y1: number, x2: number, y2: number): string | null {
  const dx = x2 - x1
  const dy = y2 - y1
  const segLen = Math.hypot(dx, dy)
  if (segLen < MIN_ARROW_SEG_PX) return null

  const a = Math.atan2(dy, dx)
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const tipX = mx + Math.cos(a) * (ARROW_LEN / 2)
  const tipY = my + Math.sin(a) * (ARROW_LEN / 2)
  const backX = mx - Math.cos(a) * (ARROW_LEN / 2)
  const backY = my - Math.sin(a) * (ARROW_LEN / 2)
  const nx = Math.cos(a + Math.PI / 2) * (ARROW_WIDTH / 2)
  const ny = Math.sin(a + Math.PI / 2) * (ARROW_WIDTH / 2)

  return `${tipX},${tipY} ${backX + nx},${backY + ny} ${backX - nx},${backY - ny}`
}

function getArrowKeys(line: RouteLine) {
  const ax1 = line.reverseArrow ? line.x2 : line.x1
  const ay1 = line.reverseArrow ? line.y2 : line.y1
  const ax2 = line.reverseArrow ? line.x1 : line.x2
  const ay2 = line.reverseArrow ? line.y1 : line.y2
  const len = Math.hypot(ax2 - ax1, ay2 - ay1)
  if (len < MIN_ARROW_SEG_PX) return null

  const bucket = len > ARROW_LONG_SEG_PX ? ARROW_LONG_BUCKET : ARROW_SHORT_BUCKET
  const q = (value: number) => Math.round(value / bucket) * bucket
  const fwd = `${q(ax1)},${q(ay1)}->${q(ax2)},${q(ay2)}`
  const rev = `${q(ax2)},${q(ay2)}->${q(ax1)},${q(ay1)}`
  const undirected = fwd < rev ? fwd : rev

  return { undirected, directed: fwd, reverseDirected: rev }
}

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

export default function LogMapperMapPane({
  activeLogName,
  entryCount,
  plottedEntries,
  segmentCount,
  selectedEntry,
  selectedHop,
  view,
  mapSize,
  isPanning,
  mapWrapRef,
  overlayRef,
  onMapClick,
  onMouseDown,
  onWheel,
  onOpenPicker,
  onZoomIn,
  onZoomOut,
  onResetView,
}: LogMapperMapPaneProps) {
  const selectedPlottedEntry = selectedEntry
    ? plottedEntries.find((plotted) => plotted.entry === selectedEntry) ?? null
    : null

  const routeLines = plottedEntries.flatMap((plotted) => {
    const colors = colorSet(plotted.entry.direction)
    const reverseArrow = plotted.entry.direction === 'in'

    return plotted.routeSegments.map((segment) => ({
      id: segment.key,
      x1: segment.start.x,
      y1: segment.start.y,
      x2: segment.end.x,
      y2: segment.end.y,
      color: colors.route,
      reverseArrow,
    }))
  })

  const selectedRouteLines = selectedPlottedEntry
    ? selectedPlottedEntry.routeSegments.map((segment) => {
      const colors = colorSet(selectedPlottedEntry.entry.direction)
      return {
        id: `${segment.key}-selected`,
        x1: segment.start.x,
        y1: segment.start.y,
        x2: segment.end.x,
        y2: segment.end.y,
        color: colors.activeRoute,
        reverseArrow: selectedPlottedEntry.entry.direction === 'in',
      }
    })
    : []

  return (
    <section className="log-mapper__map-pane">
      <div className="log-mapper__status">
        {statusText(activeLogName, entryCount, plottedEntries.length, segmentCount, selectedEntry)}
      </div>

      <nav className="log-mapper__controls">
        <button onClick={onOpenPicker} type="button">Choose Log</button>
        <button onClick={onZoomIn} type="button">+</button>
        <button onClick={onZoomOut} type="button">-</button>
        <button onClick={onResetView} type="button">Reset</button>
      </nav>

      <div
        className={`log-mapper__stage ${isPanning ? 'is-panning' : ''}`}
        onClick={onMapClick}
        onMouseDown={onMouseDown}
        onWheel={onWheel}
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
            <g>
              {routeLines.map((line) => (
                <line
                  className="log-mapper__route"
                  key={line.id}
                  stroke={line.color}
                  strokeWidth={1.2}
                  x1={line.x1}
                  x2={line.x2}
                  y1={line.y1}
                  y2={line.y2}
                />
              ))}
              {(() => {
                const edgeInfo = new Map<string, Set<string>>()
                routeLines.forEach((line) => {
                  const keys = getArrowKeys(line)
                  if (!keys) return

                  const set = edgeInfo.get(keys.undirected) || new Set<string>()
                  set.add(keys.directed)
                  edgeInfo.set(keys.undirected, set)
                })

                const renderedUndirected = new Set<string>()
                const renderedDirected = new Set<string>()

                return routeLines.map((line) => {
                  const keys = getArrowKeys(line)
                  if (!keys) return null

                  const info = edgeInfo.get(keys.undirected)
                  const biDirectional = Boolean(
                    info && info.has(keys.directed) && info.has(keys.reverseDirected),
                  )

                  if (biDirectional) {
                    if (renderedDirected.has(keys.directed)) return null
                    renderedDirected.add(keys.directed)
                  } else {
                    if (renderedUndirected.has(keys.undirected)) return null
                    renderedUndirected.add(keys.undirected)
                  }

                  const points = line.reverseArrow
                    ? getMidArrowPoints(line.x2, line.y2, line.x1, line.y1)
                    : getMidArrowPoints(line.x1, line.y1, line.x2, line.y2)
                  if (!points) return null

                  return (
                    <polygon
                      key={`${line.id}-arrow`}
                      points={points}
                      fill={line.color}
                      fillOpacity={0.98}
                      stroke="rgba(60,60,60,0.65)"
                      strokeWidth={0.8}
                    />
                  )
                })
              })()}
            </g>

            {selectedPlottedEntry && (
              <g>
                {selectedRouteLines.map((line) => (
                  <line
                    className="log-mapper__route"
                    key={line.id}
                    stroke={line.color}
                    strokeWidth={2.2}
                    x1={line.x1}
                    x2={line.x2}
                    y1={line.y1}
                    y2={line.y2}
                  />
                ))}
                {selectedRouteLines.map((line) => {
                  const points = line.reverseArrow
                    ? getMidArrowPoints(line.x2, line.y2, line.x1, line.y1)
                    : getMidArrowPoints(line.x1, line.y1, line.x2, line.y2)
                  if (!points) return null

                  return (
                    <polygon
                      key={`${line.id}-arrow`}
                      points={points}
                      fill={line.color}
                      fillOpacity={0.98}
                      stroke="rgba(60,60,60,0.65)"
                      strokeWidth={0.8}
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
    </section>
  )
}
