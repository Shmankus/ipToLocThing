export type Direction = 'in' | 'out'

export interface RawHop {
  ttl?: number | string | null
  lat?: number | string | null
  lon?: number | string | null
  ip?: string
  rtt?: number | string | null
  country?: string | null
  province?: string | null
  [key: string]: unknown
}

export interface Hop extends RawHop {
  ttl: number | null
  lat: number | null
  lon: number | null
  country: string
  province: string
}

export interface RawEntry {
  lat?: number | string | null
  lon?: number | string | null
  ip?: string
  country?: string | number | null
  province?: string | number | null
  direction?: string | null
  trace?: RawHop[] | null
  Nmap?: Record<string, unknown> | null
  nmap?: Record<string, unknown> | null
  [key: string]: unknown
}

export interface Entry extends RawEntry {
  lat: number | null
  lon: number | null
  country: string
  province: string
  direction: Direction
  trace: Hop[]
}

export interface ProjectedPoint {
  x: number
  y: number
}

export interface RouteSegment {
  key: string
  start: ProjectedPoint
  end: ProjectedPoint
}

export interface PlottedEntry {
  key: string
  entry: Entry
  destination: ProjectedPoint
  routeSegments: RouteSegment[]
}

export function numberOrNull(value: unknown): number | null {
  const result = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(result) ? result : null
}

export function labelOrFallback(value: unknown, fallback = 'n/a'): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function sortTraceByTtl(trace: Hop[]): Hop[] {
  return [...trace].sort((left, right) => {
    const leftTtl = numberOrNull(left?.ttl)
    const rightTtl = numberOrNull(right?.ttl)

    if (leftTtl === null && rightTtl === null) return 0
    if (leftTtl === null) return 1
    if (rightTtl === null) return -1
    return leftTtl - rightTtl
  })
}

export function regionKey(point: Pick<Entry | Hop, 'country' | 'province'> | null | undefined): string {
  return `${point?.country || 'n/a'}|${point?.province || 'n/a'}`
}

export function hasCoordinates(
  point: Pick<Entry | Hop, 'lat' | 'lon'> | null | undefined,
): point is Pick<Entry | Hop, 'lat' | 'lon'> & { lat: number; lon: number } {
  if (!point) return false

  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    !(point.lat === 0 && point.lon === 0)
  )
}

export function simplifyTrace(trace: Hop[]): Hop[] {
  if (!Array.isArray(trace) || trace.length < 3) return trace || []

  const withoutRepeats: Hop[] = []
  for (const hop of trace) {
    if (
      !withoutRepeats.length ||
      regionKey(withoutRepeats[withoutRepeats.length - 1]) !== regionKey(hop)
    ) {
      withoutRepeats.push(hop)
    }
  }

  const simplified: Hop[] = []
  for (const hop of withoutRepeats) {
    if (simplified.length >= 2 && regionKey(simplified[simplified.length - 2]) === regionKey(hop)) {
      simplified.pop()
      continue
    }

    simplified.push(hop)
  }

  return simplified
}

export function normalizeHop(rawHop: RawHop | null | undefined): Hop | null {
  if (!rawHop || typeof rawHop !== 'object') return null

  return {
    ...rawHop,
    ttl: numberOrNull(rawHop.ttl),
    lat: numberOrNull(rawHop.lat),
    lon: numberOrNull(rawHop.lon),
    country: labelOrFallback(rawHop.country, '-'),
    province: labelOrFallback(rawHop.province, '-'),
  }
}

export function normalizeEntry(rawEntry: RawEntry | null | undefined): Entry | null {
  if (!rawEntry || typeof rawEntry !== 'object') return null

  let lat = numberOrNull(rawEntry.lat)
  let lon = numberOrNull(rawEntry.lon)

  if (lat === null || lon === null) {
    const legacyLat = numberOrNull(rawEntry.country)
    const legacyLon = numberOrNull(rawEntry.province)
    if (legacyLat !== null && legacyLon !== null) {
      lat = legacyLat
      lon = legacyLon
    }
  }

  const country = typeof rawEntry.country === 'string' ? rawEntry.country : rawEntry.lat
  const province = typeof rawEntry.province === 'string' ? rawEntry.province : rawEntry.lon
  const trace = Array.isArray(rawEntry.trace)
    ? sortTraceByTtl(rawEntry.trace.map(normalizeHop).filter(Boolean) as Hop[])
    : []

  return {
    ...rawEntry,
    lat,
    lon,
    country: labelOrFallback(country),
    province: labelOrFallback(province),
    direction: rawEntry.direction === 'out' ? 'out' : 'in',
    trace,
  }
}

export function normalizeEntries(rawEntries: RawEntry[] | null | undefined): Entry[] {
  return Array.isArray(rawEntries)
    ? rawEntries.map(normalizeEntry).filter(Boolean) as Entry[]
    : []
}

export function getRoutePoints(entry: Entry): Array<Entry | Hop> {
  const trace = simplifyTrace(entry.trace.filter(hasCoordinates))
  return [...trace, entry].filter(hasCoordinates) as Array<Entry | Hop>
}

export function projectPoint(
  point: Pick<Entry | Hop, 'lat' | 'lon'> & { lat: number; lon: number },
  width: number,
  height: number,
): ProjectedPoint {
  return {
    x: ((point.lon + 180) / 360) * width,
    y: ((90 - point.lat) / 180) * height,
  }
}

export function buildPlottedEntries(entries: Entry[], width: number, height: number): PlottedEntry[] {
  return entries.flatMap((entry, index) => {
    if (!hasCoordinates(entry)) return []

    const routePoints = getRoutePoints(entry)
    const projectedPoints = routePoints.map((point) =>
      projectPoint(point as { lat: number; lon: number }, width, height),
    )

    const routeSegments = projectedPoints.slice(0, -1).map((start, segmentIndex) => ({
      key: `${entry.ip || 'entry'}-${index}-segment-${segmentIndex}`,
      start,
      end: projectedPoints[segmentIndex + 1],
    }))

    return [
      {
        key: `${entry.ip || 'entry'}-${index}`,
        entry,
        destination: projectedPoints[projectedPoints.length - 1],
        routeSegments,
      },
    ]
  })
}

export function formatCoordinates(point: Pick<Entry | Hop, 'lat' | 'lon'> | null | undefined): string {
  return hasCoordinates(point) ? `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}` : 'n/a'
}

export function formatLocation(
  point: Pick<Entry | Hop, 'country' | 'province'> | null | undefined,
  fallback = 'Unknown location',
): string {
  const parts = [point?.province, point?.country].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '' && part !== '-',
  )

  return parts.length ? parts.join(', ') : fallback
}

export function formatKeyLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

export function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'n/a'
  if (key === 'rtt') return `${value} ms`
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function getNmapData(entry: Entry | null): Record<string, unknown> | null {
  const nmap = entry?.Nmap ?? entry?.nmap
  if (!nmap || typeof nmap !== 'object' || Array.isArray(nmap)) return null
  return nmap
}

export function comparePortNames(left: string, right: string): number {
  const leftPort = numberOrNull(left)
  const rightPort = numberOrNull(right)

  if (leftPort !== null && rightPort !== null) return leftPort - rightPort
  if (leftPort !== null) return -1
  if (rightPort !== null) return 1
  return left.localeCompare(right)
}

export function readableLogTime(logName: string): string {
  const match = logName.match(/log_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.json/i)
  if (!match) return logName

  const [, year, month, day, hour, minute, second] = match
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function colorSet(direction: Direction): {
  point: string
  route: string
  activeRoute: string
} {
  if (direction === 'out') {
    return {
      point: '#ff7474',
      route: 'rgba(255, 116, 116, 0.28)',
      activeRoute: 'rgba(255, 116, 116, 0.95)',
    }
  }

  return {
    point: '#6bc5ff',
    route: 'rgba(107, 197, 255, 0.28)',
    activeRoute: 'rgba(107, 197, 255, 0.95)',
  }
}
