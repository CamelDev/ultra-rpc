import React, { useMemo } from 'react'
import { Clock, HardDrive, CheckCircle, XCircle, Copy, ChevronDown, ChevronRight } from 'lucide-react'
import type { ResponseData } from '../types'
import './ResponseViewer.css'

interface Props {
  response: ResponseData | null
  error: string | null
  loading: boolean
}

const ResponseViewer: React.FC<Props> = ({ response, error, loading }) => {
  const [showHeaders, setShowHeaders] = React.useState(false)
  const [copied, setCopied] = React.useState(false)

  const formattedBody = useMemo(() => {
    if (!response) return ''
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2)
    } catch {
      return response.body
    }
  }, [response])

  const statusClass = useMemo(() => {
    if (!response) return ''
    if (response.status >= 200 && response.status < 300) return 'status-success'
    if (response.status >= 400 && response.status < 500) return 'status-warning'
    if (response.status >= 500) return 'status-error'
    return 'status-info'
  }, [response])

  const copyBody = async () => {
    if (!response) return
    await navigator.clipboard.writeText(formattedBody)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  if (loading) {
    return (
      <div className="response-viewer">
        <div className="response-loading">
          <div className="loading-spinner" />
          <span>Sending request...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="response-viewer">
        <div className="response-error">
          <XCircle size={20} />
          <div>
            <div className="response-error-title">Request Failed</div>
            <div className="response-error-msg">{error}</div>
          </div>
        </div>
      </div>
    )
  }

  if (!response) {
    return (
      <div className="response-viewer">
        <div className="response-empty">
          <div className="response-empty-icon">⚡</div>
          <div className="response-empty-text">Send a request to see the response</div>
        </div>
      </div>
    )
  }

  return (
    <div className="response-viewer">
      {/* Status bar */}
      <div className="response-status-bar">
        <div className="response-stats">
          <span className={`response-status-badge ${statusClass}`}>
            {response.status >= 200 && response.status < 400 ? (
              <CheckCircle size={14} />
            ) : (
              <XCircle size={14} />
            )}
            {response.status} {response.statusText}
          </span>
          <span className="response-stat">
            <Clock size={13} /> {response.time}ms
          </span>
          <span className="response-stat">
            <HardDrive size={13} /> {formatSize(response.size)}
          </span>
        </div>
        <div className="response-actions">
          <button className="btn-ghost response-action-btn" onClick={copyBody}>
            <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Headers collapsible */}
      <button className="response-headers-toggle" onClick={() => setShowHeaders(!showHeaders)}>
        {showHeaders ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Response Headers ({Object.keys(response.headers).length})
      </button>
      {showHeaders && (
        <div className="response-headers">
          {Object.entries(response.headers).map(([key, value]) => (
            <div className="response-header-row" key={key}>
              <span className="response-header-key">{key}</span>
              <span className="response-header-value">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="response-body-container">
        <pre className="response-body">
          <code>
            {(() => {
              if (response.headers['content-type']?.includes('application/json') || formattedBody.startsWith('{') || formattedBody.startsWith('[')) {
                const jsonRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g
                const subParts: React.ReactNode[] = []
                let lastIndex = 0
                let match
                
                while ((match = jsonRegex.exec(formattedBody)) !== null) {
                  if (match.index > lastIndex) {
                    subParts.push(<span key={`text-${lastIndex}`}>{formattedBody.substring(lastIndex, match.index)}</span>)
                  }

                  const matchStr = match[0]
                  let className = 'json-value'
                  
                  if (/^".*"\s*:$/.test(matchStr)) {
                    className = 'json-key'
                  } else if (matchStr.startsWith('"')) {
                    className = 'json-string'
                  } else if (matchStr === 'true' || matchStr === 'false') {
                    className = 'json-boolean'
                  } else if (matchStr === 'null') {
                    className = 'json-null'
                  } else if (!isNaN(Number(matchStr))) {
                    className = 'json-number'
                  }

                  subParts.push(<span key={`match-${match.index}`} className={className}>{matchStr}</span>)
                  lastIndex = jsonRegex.lastIndex
                }

                if (lastIndex < formattedBody.length) {
                  subParts.push(<span key={`text-end`}>{formattedBody.substring(lastIndex)}</span>)
                }
                
                return subParts
              }
              return formattedBody
            })()}
          </code>
        </pre>
      </div>
    </div>
  )
}

export default ResponseViewer
