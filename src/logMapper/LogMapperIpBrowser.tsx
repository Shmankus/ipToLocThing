/**
 * LogMapperIpBrowser renders the left-side list of unique IPs found in the active log.
 *
 * Each item in the list is already grouped by the parent, so this component only needs
 * to display the summary for each IP: address, human-readable location, entry count,
 * and total trace-hop count. Clicking an item tells the parent which IP should become
 * the active selection.
 *
 * This file is intentionally "dumb" UI. It does not know anything about map geometry,
 * raw log parsing, or inspector details. Its job is to make the IP catalog easy to scan
 * and easy to select.
 */
import type { IpGroup } from './types'

type LogMapperIpBrowserProps = {
  ipGroups: IpGroup[]
  selectedIp: string
  onSelectIp: (ip: string) => void
}

export default function LogMapperIpBrowser({
  ipGroups,
  selectedIp,
  onSelectIp,
}: LogMapperIpBrowserProps) {
  return (
    <aside className="log-mapper__ip-browser">
      <div className="log-mapper__panel-header">
        <h3 className="log-mapper__panel-title">IP List</h3>
        <div className="log-mapper__muted">
          {ipGroups.length} unique {ipGroups.length === 1 ? 'IP' : 'IPs'}
        </div>
      </div>

      <div className="log-mapper__ip-list">
        {!ipGroups.length ? (
          <div className="log-mapper__muted">No IPs loaded.</div>
        ) : (
          ipGroups.map((group) => {
            const isActive = group.ip === selectedIp

            return (
              <button
                className={`log-mapper__ip-item ${isActive ? 'is-active' : ''}`}
                key={group.ip}
                onClick={() => {
                  onSelectIp(group.ip)
                }}
                type="button"
              >
                <span className="log-mapper__ip-item-primary">
                  <span>{group.ip}</span>
                  <span className="log-mapper__ip-item-location">{group.location}</span>
                </span>
                <span className="log-mapper__ip-item-meta">
                  {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                  {' | '}
                  {group.traceCount} total trace hops
                </span>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
