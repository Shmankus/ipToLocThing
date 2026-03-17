import { useEffect, useRef, useState } from 'react'
import { DeskThing } from '@deskthing/client'
import LogMapperView from './LogMapperView'
import MapComponentHandle, { type MapComponentHandle as MapComponentHandleType } from './mapComponent'

const isDev = import.meta.env.DEV
const IN_COLOR = 'rgba(0, 255, 255, 0.7)'
const OUT_COLOR = 'rgba(255, 0, 0, 0.7)'

type ViewMode = 'screen' | 'log-mapper'
type IpLocationPayload = {
  lat: number
  lon: number
  ip: string
  uniqueIPs?: string | number
  tracedIps?: number
  trace?: Array<Record<string, unknown>>
  direction?: 'in' | 'out'
}

function ScreenViewer() {
  const [serverStatus, setServerStatus] = useState('stopped')
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

  useEffect(() => {
    const handler = (msg: { payload?: string }) => {
      if (msg.payload) {
        setServerStatus(msg.payload)
      }
    }

    return DeskThing.on('serverStatus', handler)
  }, [])

  return (
    <div className="pointer-events-none h-screen w-screen cursor-none">
      {!isDev && (serverStatus === 'loading' || serverStatus === 'stopped' || serverStatus === 'ERROR') && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-lg">
          <div className="text-center text-white">
            <div>| Tap on screen to start |</div>
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
  const [activeView, setActiveView] = useState<ViewMode>('screen')

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      {isDev && (
        <div className="pointer-events-auto absolute right-4 top-4 z-50 flex gap-2">
          <button
            className={`rounded-md border px-3 py-2 text-sm ${
              activeView === 'screen'
                ? 'border-white/40 bg-white/20 text-white'
                : 'border-white/20 bg-black/70 text-white/80'
            }`}
            onClick={() => setActiveView('screen')}
            type="button"
          >
            Live View
          </button>
          <button
            className={`rounded-md border px-3 py-2 text-sm ${
              activeView === 'log-mapper'
                ? 'border-white/40 bg-white/20 text-white'
                : 'border-white/20 bg-black/70 text-white/80'
            }`}
            onClick={() => setActiveView('log-mapper')}
            type="button"
          >
            Log Mapper
          </button>
        </div>
      )}

      {activeView === 'log-mapper' ? <LogMapperView /> : <ScreenViewer />}
    </div>
  )
}
