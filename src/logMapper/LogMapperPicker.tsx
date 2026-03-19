/**
 * LogMapperPicker is the full-page picker used to choose which saved log file to open.
 *
 * This component is intentionally presentational. It does not fetch data on its own and
 * does not know how logs are loaded internally. Instead, the parent passes in the current
 * loading/error state, the list of available logs, and a callback for what should happen
 * when the user clicks one.
 *
 * In practice, this file is the "front door" to the log mapper. If you want to change
 * how the log list looks, how the empty/error states read, or what metadata is shown for
 * each log option, this is the component to edit.
 */
import { readableLogTime } from '../logMapperHelpers'

type LogMapperPickerProps = {
  isLoadingLogs: boolean
  pickerSubtitle: string
  pickerError: string | null
  logNames: string[]
  loadingLogName: string | null
  findLogSize: (logName: string) => string
  onLoadLog: (logName: string) => void
}

export default function LogMapperPicker({
  isLoadingLogs,
  pickerSubtitle,
  pickerError,
  logNames,
  loadingLogName,
  findLogSize,
  onLoadLog,
}: LogMapperPickerProps) {
  return (
    <section className="log-mapper__picker">
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
                onLoadLog(logName)
              }}
              type="button"
            >
              <span className="log-mapper__log-time">{readableLogTime(logName)}</span>
              <span className="log-mapper__log-name">{`logs/${logName}`}</span>
              <span className="log-mapper__log-size">{findLogSize(logName)}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
