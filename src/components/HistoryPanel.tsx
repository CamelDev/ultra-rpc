import React from 'react'
import { Clock, Trash2 } from 'lucide-react'
import type { RequestConfig } from '../types'
import './HistoryPanel.css'

interface HistoryEntry {
  id: string
  request: RequestConfig
  timestamp: number
  statusCode?: number
}

interface Props {
  history: HistoryEntry[]
  onOpenRequest: (request: RequestConfig) => void
  onClear: () => void
}

const HistoryPanel: React.FC<Props> = ({ history, onOpenRequest, onClear }) => {
  const methodColor = (m: string) => {
    switch (m) {
      case 'GET': return '#22c55e'
      case 'POST': return '#f59e0b'
      case 'PUT': return '#3b82f6'
      case 'DELETE': return '#ef4444'
      case 'PATCH': return '#8b5cf6'
      default: return '#a855f7'
    }
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const statusColor = (code?: number) => {
    if (!code) return 'var(--text-secondary)'
    if (code >= 200 && code < 300) return '#22c55e'
    if (code >= 400 && code < 500) return '#f59e0b'
    if (code >= 500) return '#ef4444'
    return 'var(--text-secondary)'
  }

  return (
    <div className="hist-panel">
      <div className="hist-header">
        <span className="hist-title">
          <Clock size={14} /> History
        </span>
        {history.length > 0 && (
          <button className="btn-ghost hist-clear" onClick={onClear} title="Clear history">
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>

      {history.length === 0 && (
        <div className="hist-empty">No requests yet</div>
      )}

      <div className="hist-list">
        {history.map(entry => (
          <div
            className="hist-item"
            key={entry.id}
            onClick={() => onOpenRequest(entry.request)}
          >
            <span className="hist-method" style={{ color: methodColor(entry.request.type === 'GRPC' ? 'GRPC' : entry.request.method) }}>
              {entry.request.type === 'GRPC' ? 'gRPC' : entry.request.method}
            </span>
            <span className="hist-url">{entry.request.name || entry.request.url || 'Untitled'}</span>
            <div className="hist-meta">
              {entry.statusCode && (
                <span className="hist-status" style={{ color: statusColor(entry.statusCode) }}>
                  {entry.statusCode}
                </span>
              )}
              <span className="hist-time">{formatTime(entry.timestamp)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default HistoryPanel
