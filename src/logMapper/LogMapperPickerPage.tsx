/**
 * LogMapperPickerPage is the standalone page for browsing and opening saved logs.
 *
 * This file owns the picker-specific data flow:
 * - requesting the available log list from the dev endpoint
 * - hydrating entry counts for logs when needed
 * - loading the chosen log file and normalizing its data
 * - handing the selected log back up to App so the dedicated map page can open
 *
 * The actual visual rendering of the list still lives in LogMapperPicker. This page is
 * the stateful container around that presentational component, which keeps the picker as
 * a real screen instead of an overlay that sits on top of the map UI.
 */
import { startTransition, useCallback, useEffect, useState } from 'react'
import { normalizeEntries } from '../logMapperHelpers'
import type { Entry, RawEntry } from '../logMapperHelpers'
import LogMapperPicker from './LogMapperPicker'

const DEFAULT_PICKER_SUBTITLE = 'Select a capture to open the map view.'

type LogMapperPickerPageProps = {
  onOpenLog: (logName: string, entries: Entry[]) => void
}

export default function LogMapperPickerPage({ onOpenLog }: LogMapperPickerPageProps) {
  const [logNames, setLogNames] = useState<string[]>([])
  const [logEntryCounts, setLogEntryCounts] = useState<Record<string, number>>({})
  const [pickerSubtitle, setPickerSubtitle] = useState(DEFAULT_PICKER_SUBTITLE)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [loadingLogName, setLoadingLogName] = useState<string | null>(null)

  const hydrateLogEntryCounts = useCallback(async (names: string[]) => {
    try {
      await Promise.all(
        names.map(async (name) => {
          const response = await fetch(`/__dev/logs/${encodeURIComponent(name)}`)
          if (!response.ok) return

          const payload = (await response.json()) as { geo_cache?: unknown }
          const count = Array.isArray(payload?.geo_cache) ? payload.geo_cache.length : 0

          setLogEntryCounts((current) => ({
            ...current,
            [name]: count,
          }))
        }),
      )
    } catch {
      // Best-effort only: counts are optional in the picker UI.
    }
  }, [])

  const loadLogList = useCallback(async (nextSubtitle = DEFAULT_PICKER_SUBTITLE) => {
    setIsLoadingLogs(true)
    setPickerError(null)
    setPickerSubtitle(nextSubtitle)

    try {
      const response = await fetch('/__dev/logs')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const payload = (await response.json()) as Array<string | { name?: unknown; count?: unknown }>
      const nextLogNames: string[] = []
      const nextLogCounts: Record<string, number> = {}
      let needsCountHydration = false

      for (const item of payload) {
        const name = typeof item === 'string' ? item : String(item?.name ?? '')
        if (!name || !/^log.*\.json$/i.test(name)) continue

        nextLogNames.push(name)

        if (item && typeof item === 'object') {
          const count = Number(item.count)
          if (Number.isFinite(count)) {
            nextLogCounts[name] = count
            continue
          }
        }

        needsCountHydration = true
      }

      setLogNames(nextLogNames)
      setLogEntryCounts(nextLogCounts)

      if (needsCountHydration && nextLogNames.length) {
        void hydrateLogEntryCounts(nextLogNames)
      }

      if (!nextLogNames.length) {
        setPickerError('No logs found in the local logs directory.')
      }
    } catch (error) {
      setPickerError(`Failed to list local logs: ${String(error)}`)
    } finally {
      setIsLoadingLogs(false)
    }
  }, [hydrateLogEntryCounts])

  useEffect(() => {
    void loadLogList()
  }, [loadLogList])

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
        onOpenLog(logName, nextEntries)
      })

      setPickerSubtitle(DEFAULT_PICKER_SUBTITLE)
    } catch (error) {
      setPickerError(`Failed to load ${logName}: ${String(error)}`)
      setPickerSubtitle(DEFAULT_PICKER_SUBTITLE)
    } finally {
      setLoadingLogName(null)
    }
  }

  function findLogSize(logName: string): string {
    const count = logEntryCounts[logName]
    if (count == null) return 'n/a'
    return `${count} entries`
  }

  return (
    <div className="log-mapper">
      <LogMapperPicker
        findLogSize={findLogSize}
        isLoadingLogs={isLoadingLogs}
        loadingLogName={loadingLogName}
        logNames={logNames}
        onLoadLog={(logName) => {
          void loadLog(logName)
        }}
        pickerError={pickerError}
        pickerSubtitle={pickerSubtitle}
      />
    </div>
  )
}
