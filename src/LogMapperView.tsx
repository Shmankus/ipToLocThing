/**
 * LogMapperView is the top-level coordinator for the loaded-log map page.
 *
 * This file is where the interactive state for a single opened log lives:
 * - keeping track of the currently selected IP / entry / hop
 * - tracking pan and zoom state for the map
 * - translating pointer input into map-space selection
 * - deriving grouped and projected data that child components can render
 *
 * The picker/listing screen now lives separately at the app level, so this component
 * no longer fetches logs or renders the picker as an overlay. Its job is to take an
 * already-loaded log and wire together the left-side IP browser, center map pane,
 * and right-side inspector. If something is wrong with selection or pan/zoom behavior,
 * this is the first file to inspect.
 */
import { useEffect, useRef, useState } from 'react'
import './logMapper.css'
import { buildPlottedEntries } from './logMapperHelpers'
import type { Entry } from './logMapperHelpers'
import LogMapperInspector from './logMapper/LogMapperInspector'
import LogMapperIpBrowser from './logMapper/LogMapperIpBrowser'
import LogMapperMapPane from './logMapper/LogMapperMapPane'
import type { DragState, MapSize, ViewState } from './logMapper/types'
import { buildIpGroups, clamp, entryIpLabel } from './logMapper/utils'

const CLICK_RADIUS = 8
const MAX_ZOOM = 6
const MIN_ZOOM = 0.6
const ZOOM_STEP = 1.2
const PAN_THRESHOLD = 3

type LogMapperViewProps = {
  activeLogName: string
  entries: Entry[]
  onOpenPicker: () => void
}

export default function LogMapperView({
  activeLogName,
  entries,
  onOpenPicker,
}: LogMapperViewProps) {
  const [selectedEntries, setSelectedEntries] = useState<Entry[]>([])
  const [selectedEntryIndex, setSelectedEntryIndex] = useState(0)
  const [selectedHopIndex, setSelectedHopIndex] = useState<number | null>(null)
  const [isEntryListExpanded, setIsEntryListExpanded] = useState(false)

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

  const selectedEntry = selectedEntries[selectedEntryIndex] ?? null
  const selectedHop = selectedEntry && selectedHopIndex !== null
    ? selectedEntry.trace[selectedHopIndex] ?? null
    : null
  const ipGroups = buildIpGroups(entries)
  const selectedIp = selectedEntry ? entryIpLabel(selectedEntry) : ''
  const selectedIpGroup = selectedEntry
    ? ipGroups.find((group) => group.ip === selectedIp) ?? null
    : null
  const selectionSharesSameIp = Boolean(selectedEntry) &&
    selectedEntries.every((entry) => entryIpLabel(entry) === selectedIp)

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    setIsEntryListExpanded(false)
  }, [selectedEntries])

  useEffect(() => {
    setSelectedEntries([])
    setSelectedEntryIndex(0)
    setSelectedHopIndex(null)
    setIsEntryListExpanded(false)
    setView({ scale: 1, tx: 0, ty: 0 })
  }, [activeLogName])

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

  useEffect(() => {
    if (!mapSize.width || !mapSize.height) return

    const nextPlottedEntries = buildPlottedEntries(entries, mapSize.width, mapSize.height)
    setPlottedEntries(nextPlottedEntries)
    setSegmentCount(
      nextPlottedEntries.reduce((total, plottedEntry) => total + plottedEntry.routeSegments.length, 0),
    )
  }, [entries, mapSize.height, mapSize.width])

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

  function clientToMapPoint(
    clientX: number,
    clientY: number,
  ): { x: number; y: number; sx: number; sy: number } | null {
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

  function selectEntries(entriesToSelect: Entry[], entryIndex = 0) {
    setSelectedEntries(entriesToSelect)
    setSelectedEntryIndex(entriesToSelect.length ? clamp(entryIndex, 0, entriesToSelect.length - 1) : 0)
    setSelectedHopIndex(null)
  }

  function selectEntriesNear(clientX: number, clientY: number) {
    const mapPoint = clientToMapPoint(clientX, clientY)
    if (!mapPoint) return

    const matches = plottedEntries
      .filter((plotted) => Math.hypot(plotted.destination.x - mapPoint.x, plotted.destination.y - mapPoint.y) <= CLICK_RADIUS)
      .map((plotted) => plotted.entry)

    selectEntries(matches)
  }

  function selectEntriesForIp(ip: string) {
    selectEntries(entries.filter((entry) => entryIpLabel(entry) === ip))
  }

  function moveSelectedEntry(delta: number) {
    if (selectedEntries.length < 2) return

    setSelectedEntryIndex((currentIndex) => {
      const nextIndex = currentIndex + delta + selectedEntries.length
      return nextIndex % selectedEntries.length
    })
    setSelectedHopIndex(null)
  }

  function handleMapClick(event: React.MouseEvent<HTMLDivElement>) {
    if (dragRef.current.movedWhilePanning) {
      dragRef.current.movedWhilePanning = false
      return
    }

    selectEntriesNear(event.clientX, event.clientY)
  }

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
      <div className="log-mapper__workspace">
        <LogMapperIpBrowser
          ipGroups={ipGroups}
          onSelectIp={selectEntriesForIp}
          selectedIp={selectedIp}
        />

        <LogMapperMapPane
          activeLogName={activeLogName}
          entryCount={entries.length}
          isPanning={isPanning}
          mapSize={mapSize}
          mapWrapRef={mapWrapRef}
          onMapClick={handleMapClick}
          onMouseDown={handleMouseDown}
          onOpenPicker={onOpenPicker}
          onResetView={resetView}
          onWheel={handleWheel}
          onZoomIn={() => {
            zoomAt(mapSize.width / 2, mapSize.height / 2, ZOOM_STEP)
          }}
          onZoomOut={() => {
            zoomAt(mapSize.width / 2, mapSize.height / 2, 1 / ZOOM_STEP)
          }}
          overlayRef={overlayRef}
          plottedEntries={plottedEntries}
          segmentCount={segmentCount}
          selectedEntry={selectedEntry}
          selectedHop={selectedHop}
          view={view}
        />

        <LogMapperInspector
          isEntryListExpanded={isEntryListExpanded}
          onBackToEntry={() => {
            setSelectedHopIndex(null)
          }}
          onNextEntry={() => {
            moveSelectedEntry(1)
          }}
          onPrevEntry={() => {
            moveSelectedEntry(-1)
          }}
          onSelectEntry={(entryIndex) => {
            selectEntries(selectedEntries, entryIndex)
          }}
          onSelectHop={(hopIndex) => {
            setSelectedHopIndex(hopIndex)
          }}
          onToggleEntryList={() => {
            setIsEntryListExpanded((current) => !current)
          }}
          selectedEntries={selectedEntries}
          selectedEntry={selectedEntry}
          selectedEntryIndex={selectedEntryIndex}
          selectedHop={selectedHop}
          selectedHopIndex={selectedHopIndex}
          selectedIp={selectedIp}
          selectedIpGroup={selectedIpGroup}
          selectionSharesSameIp={selectionSharesSameIp}
        />
      </div>
    </div>
  )
}
