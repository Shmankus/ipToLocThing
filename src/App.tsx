import { useEffect, useRef, useState } from 'react'
import { DeskThing } from '@deskthing/client'
import LogMapperView from './LogMapperView'
import LogMapperPickerPage from './logMapper/LogMapperPickerPage'
import type { Entry } from './logMapperHelpers'
import MapComponentHandle, { type MapComponentHandle as MapComponentHandleType } from './mapComponent'

const isDev = import.meta.env.DEV
const IN_COLOR = 'rgba(0, 255, 255, 0.7)'
const OUT_COLOR = 'rgba(255, 0, 0, 0.7)'

type ViewMode = 'screen' | 'log-picker' | 'log-mapper'
type IpLocationPayload = {
  lat: number
  lon: number
  ip: string
  uniqueIPs?: string | number
  tracedIps?: number
  trace?: Array<Record<string, unknown>>
  direction?: 'in' | 'out'
}

function ScreenViewer({
  serverStatus,
  hasLiveData,
  onLiveData,
}: {
  serverStatus: string
  hasLiveData: boolean
  onLiveData: () => void
}) {
  const [locUniqueIps, setLocUniqueIps] = useState(0)
  const [tracedIps, setTracedIps] = useState(0)
  const mapRef = useRef<MapComponentHandleType>(null)

  useEffect(() => {
    const handleFocus = () => {
      DeskThing.fatal('viewFocused ')
      DeskThing.send({
        type: 'focusUpdate',
        payload: '1',
      })
    }

    const handleBlur = () => {
      DeskThing.fatal('viewBlurred ')
      DeskThing.send({
        type: 'focusUpdate',
        payload: '0',
      })
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  useEffect(() => {
    const handler = (msg: { payload?: unknown }) => {
      if (!msg.payload || typeof msg.payload !== 'object') return

      const payload = msg.payload as IpLocationPayload

      try {
        if (isDev) {
          console.log(payload)
        }

        onLiveData()
        setLocUniqueIps(Number.parseFloat(String(payload.uniqueIPs ?? 0)))
        setTracedIps(Number(payload.tracedIps ?? 0))

        if (payload.trace && payload.trace.length > 1) {
          mapRef.current?.addTraceRoute(
            payload.lat,
            payload.lon,
            payload.ip,
            payload.direction === 'in' ? IN_COLOR : OUT_COLOR,
            1000,
            payload.trace,
            payload.direction,
          )
          return
        }

        mapRef.current?.addPoint(
          payload.lat,
          payload.lon,
          payload.ip,
          payload.direction === 'in' ? IN_COLOR : OUT_COLOR,
          1000,
        )
      } catch (error) {
        console.error('Failed to parse ipLocationUpdate payload', error)
      }
    }

    return DeskThing.on('ipLocationUpdate', handler)
  }, [])

  const showStartupOverlay =
    serverStatus === 'ERROR' ||
    (!hasLiveData && (serverStatus === 'loading' || serverStatus === 'stopped'))
  const overlayMessage = isDev ? '| Loading live map... |' : '| Tap on screen to start |'

  return (
    <div className="pointer-events-none h-screen w-screen cursor-none">
      {showStartupOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-lg">
          <div className="text-center text-white">
            <div>{overlayMessage}</div>
            <div className="mt-3">| serverStatus: {serverStatus} |</div>
          </div>
        </div>
      )}

      <div className="absolute bottom-5 left-5 z-10 w-auto bg-black/70 text-md text-white">
        <div className="p-2">| Unique IP&apos;s: {locUniqueIps}</div>
        <div className="p-2">| Traced Ips: {tracedIps}</div>
      </div>

      <div className="absolute bottom-5 right-5 z-10 flex flex-row items-center gap-2 bg-black/70 px-2 py-1 text-md text-white">
        <div>| Incoming:</div>
        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: IN_COLOR }} />
        <div>| Outgoing:</div>
        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: OUT_COLOR }} />
        <div>|</div>
      </div>

      <MapComponentHandle ref={mapRef} />
    </div>
  )
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewMode>(isDev ? 'log-picker' : 'screen')
  const [serverStatus, setServerStatus] = useState('stopped')
  const [selectedLogName, setSelectedLogName] = useState('')
  const [selectedLogEntries, setSelectedLogEntries] = useState<Entry[]>([])
  const [hasLiveData, setHasLiveData] = useState(false)
  const hasRequestedLiveStart = useRef(false)

  useEffect(() => {
    const handler = (msg: { payload?: string }) => {
      if (msg.payload) {
        setServerStatus(msg.payload)
      }
    }

    return DeskThing.on('serverStatus', handler)
  }, [])

  // In development we open on the saved-log inspector first.
  // The live capture process only starts the first time the user intentionally switches to the map.
  function openLiveView() {
    if (isDev && !hasRequestedLiveStart.current) {
      setServerStatus('loading')
      DeskThing.send({
        type: 'liveMapStart',
      })
      hasRequestedLiveStart.current = true
    }

    setActiveView('screen')
  }

  function openLogPicker() {
    setActiveView('log-picker')
  }

  function openSavedLog(logName: string, entries: Entry[]) {
    setSelectedLogName(logName)
    setSelectedLogEntries(entries)
    setActiveView('log-mapper')
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      {isDev && (
        <div className="pointer-events-auto absolute right-4 bottom-12 z-50 flex gap-2">
          <button
            className={`rounded-md border px-3 py-2 text-sm ${
              activeView === 'screen'
                ? 'border-white/40 bg-white/20 text-white'
                : 'border-white/20 bg-black/70 text-white/80'
            }`}
            onClick={openLiveView}
            type="button"
          >
            Live View
          </button>
          <button
            className={`rounded-md border px-3 py-2 text-sm ${
              activeView === 'log-picker' || activeView === 'log-mapper'
                ? 'border-white/40 bg-white/20 text-white'
                : 'border-white/20 bg-black/70 text-white/80'
            }`}
            onClick={openLogPicker}
            type="button"
          >
            Log Mapper
          </button>
        </div>
      )}

      {activeView === 'screen' ? (
        <ScreenViewer
          serverStatus={serverStatus}
          hasLiveData={hasLiveData}
          onLiveData={() => {
            setHasLiveData(true)
          }}
        />
      ) : activeView === 'log-picker' || !selectedLogName ? (
        <LogMapperPickerPage onOpenLog={openSavedLog} />
      ) : (
        <LogMapperView
          activeLogName={selectedLogName}
          entries={selectedLogEntries}
          onOpenPicker={openLogPicker}
        />
      )}
    </div>
  )
}
