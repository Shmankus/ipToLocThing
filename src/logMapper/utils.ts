import { formatLocation } from '../logMapperHelpers'
import type { Entry } from '../logMapperHelpers'
import type { IpGroup } from './types'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function entryIpLabel(entry: Pick<Entry, 'ip'> | null | undefined): string {
  return typeof entry?.ip === 'string' && entry.ip.trim() ? entry.ip : 'n/a'
}

export function buildIpGroups(entries: Entry[]): IpGroup[] {
  const groups = new Map<string, IpGroup>()

  entries.forEach((entry) => {
    const ip = entryIpLabel(entry)
    const location = formatLocation(entry)
    const existing = groups.get(ip)

    if (existing) {
      existing.entries.push(entry)
      existing.traceCount += entry.trace.length
      if (existing.location !== location) {
        existing.location = existing.location === 'Unknown location' ? location : 'Multiple locations'
      }
      return
    }

    groups.set(ip, {
      ip,
      entries: [entry],
      location,
      traceCount: entry.trace.length,
    })
  })

  return [...groups.values()]
}
