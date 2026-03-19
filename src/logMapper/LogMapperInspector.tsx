/**
 * LogMapperInspector renders the right-side detail panel for the current selection.
 *
 * Depending on what the user has selected, this panel can show either:
 * - entry-level details for a destination IP
 * - hop-level details for a single traceroute hop
 *
 * It also handles the rich "inspection" UI around that selection: alternate entries at
 * the same point, the expandable entry list, Nmap port details, and the clickable hop list.
 * Like the other child components, it is mostly presentational and callback-driven. The
 * parent owns the actual selection state; this component focuses on turning that state
 * into a readable drill-down experience.
 */
import {
  comparePortNames,
  formatCoordinates,
  formatFieldValue,
  formatKeyLabel,
  formatLocation,
  getNmapData,
} from '../logMapperHelpers'
import type { Entry, Hop } from '../logMapperHelpers'
import type { IpGroup } from './types'

type LogMapperInspectorProps = {
  selectedEntry: Entry | null
  selectedEntries: Entry[]
  selectedEntryIndex: number
  selectedHop: Hop | null
  selectedHopIndex: number | null
  selectedIp: string
  selectedIpGroup: IpGroup | null
  selectionSharesSameIp: boolean
  isEntryListExpanded: boolean
  onToggleEntryList: () => void
  onSelectEntry: (entryIndex: number) => void
  onBackToEntry: () => void
  onPrevEntry: () => void
  onNextEntry: () => void
  onSelectHop: (hopIndex: number) => void
}

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

export default function LogMapperInspector({
  selectedEntry,
  selectedEntries,
  selectedEntryIndex,
  selectedHop,
  selectedHopIndex,
  selectedIp,
  selectedIpGroup,
  selectionSharesSameIp,
  isEntryListExpanded,
  onToggleEntryList,
  onSelectEntry,
  onBackToEntry,
  onPrevEntry,
  onNextEntry,
  onSelectHop,
}: LogMapperInspectorProps) {
  if (!selectedEntry) {
    return (
      <aside className="log-mapper__inspector">
        <div className="log-mapper__muted">Choose an IP on the left or click a point on the map.</div>
      </aside>
    )
  }

  const nmapData = getNmapData(selectedEntry)
  const hopNmapData = selectedHop ? getNmapData(selectedHop as unknown as Entry) : null

  return (
    <aside className="log-mapper__inspector">
      <div className="log-mapper__inspector-content">
        <div className="log-mapper__button-row">
          {selectedHop ? (
            <button
              onClick={() => {
                onBackToEntry()
              }}
              type="button"
            >
              Back To Entry
            </button>
          ) : (
            selectedEntries.length > 1 && (
              <>
                <button onClick={onPrevEntry} type="button">Prev Entry</button>
                <button onClick={onNextEntry} type="button">Next Entry</button>
              </>
            )
          )}
        </div>

        <h3>
          {selectedHop
            ? `Hop ${selectedHopIndex !== null ? selectedHopIndex + 1 : ''} - ${selectedHop.ip || 'n/a'}`
            : selectedIp}
        </h3>
        <div className="log-mapper__muted">
          {selectedHop
            ? formatLocation(selectedHop)
            : `${selectedEntries.length} ${selectedEntries.length === 1 ? 'entry' : 'entries'}${selectedIpGroup ? ` - ${selectedIpGroup.location}` : ''}`}
        </div>

        {selectedHop ? (
          <>
            {renderRows(selectedHop as Record<string, unknown>, [
              'Nmap',
              'nmap',
              'tracedIps',
              'uniqueIPs',
            ])}
            {hopNmapData && Object.keys(hopNmapData).length > 0 ? (
              <div className="log-mapper__section">
                <div className="log-mapper__section-title">Nmap ports</div>
                {Object.keys(hopNmapData).sort(comparePortNames).map((port) => (
                  <div className="log-mapper__row" key={port}>
                    {port}: {String(hopNmapData[port] ?? 'n/a')}
                  </div>
                ))}
              </div>
            ) : (
              <div className="log-mapper__section">
                <div className="log-mapper__section-title">Nmap ports</div>
                <div className="log-mapper__muted">No Nmap data</div>
              </div>
            )}
          </>
        ) : (
          <>
            {selectedEntries.length > 1 && (
              <div className="log-mapper__section">
                <div className="log-mapper__section-header">
                  <div className="log-mapper__section-title">
                    {selectionSharesSameIp ? 'Entries For This IP' : 'Entries At This Point'}
                  </div>
                  <button
                    className="log-mapper__section-toggle"
                    onClick={onToggleEntryList}
                    type="button"
                  >
                    {isEntryListExpanded ? 'Hide List' : `Show List (${selectedEntries.length})`}
                  </button>
                </div>
                {isEntryListExpanded ? (
                  <div className="log-mapper__entry-list">
                    {selectedEntries.map((entry, entryIndex) => (
                      <button
                        className={`log-mapper__entry-item ${entryIndex === selectedEntryIndex ? 'is-active' : ''}`}
                        key={`${entry.ip || 'entry'}-${entryIndex}`}
                        onClick={() => {
                          onSelectEntry(entryIndex)
                        }}
                        type="button"
                      >
                        <span className="log-mapper__entry-item-title">
                          #{entryIndex + 1} {entry.direction === 'out' ? 'Outgoing' : 'Incoming'}
                        </span>
                        <span className="log-mapper__entry-item-meta">
                          {formatLocation(entry)} {' | '} {entry.trace.length} hops
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="log-mapper__muted">
                    {selectedEntries.length} entries hidden until expanded.
                  </div>
                )}
              </div>
            )}

            {renderRows(selectedEntry as Record<string, unknown>, [
              'trace',
              'locLookupTime',
              'lat',
              'lon',
              'Nmap',
              'nmap',
              'tracedIps',
              'uniqueIPs',
            ])}
            <div className="log-mapper__row">Coordinates: {formatCoordinates(selectedEntry)}</div>
            <div className="log-mapper__row">Trace Hops: {selectedEntry.trace.length}</div>

            {nmapData && Object.keys(nmapData).length > 0 ? (
              <div className="log-mapper__section">
                <div className="log-mapper__section-title">Nmap ports</div>
                {Object.keys(nmapData).sort(comparePortNames).map((port) => (
                  <div className="log-mapper__row" key={port}>
                    {port}: {String(nmapData[port] ?? 'n/a')}
                  </div>
                ))}
              </div>
            ) : (
              <div className="log-mapper__section">
                <div className="log-mapper__section-title">Nmap ports</div>
                <div className="log-mapper__muted">No Nmap data</div>
              </div>
            )}
            <div className="log-mapper__section">
              <div className="log-mapper__section-title">Trace hops</div>
              {!selectedEntry.trace.length ? (
                <div className="log-mapper__muted">No trace data</div>
              ) : (
                <div className="log-mapper__hop-list">
                  {selectedEntry.trace.map((hop, hopIndex) => (
                    <button
                      key={`${selectedEntry.ip || 'entry'}-trace-${hopIndex}`}
                      onClick={() => {
                        onSelectHop(hopIndex)
                      }}
                      type="button"
                    >
                      [{hopIndex + 1}] {hop.ip || 'n/a'} - {formatLocation(hop)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
