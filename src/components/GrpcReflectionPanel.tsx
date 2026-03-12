import React, { useState } from 'react'
import { Search, Loader2, ChevronRight, Server, Zap, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react'
import './GrpcReflectionPanel.css'

interface MethodInfo {
  name: string
  fullName: string
  requestType: string
  responseType: string
  clientStreaming: boolean
  serverStreaming: boolean
  sampleBody?: string
}

interface Props {
  host: string
  headers: Record<string, string>
  onSelectService: (service: string) => void
  onSelectMethod: (service: string, method: string, sampleBody?: string) => void
}

const GrpcReflectionPanel: React.FC<Props> = ({ host, headers, onSelectService, onSelectMethod }) => {
  const [services, setServices] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discovered, setDiscovered] = useState(false)
  const [expandedService, setExpandedService] = useState<string | null>(null)
  const [methodsMap, setMethodsMap] = useState<Record<string, MethodInfo[]>>({})
  const [methodsLoading, setMethodsLoading] = useState<string | null>(null)
  const [methodsError, setMethodsError] = useState<Record<string, string>>({})

  const discoverServices = async () => {
    if (!host.trim()) {
      setError('Enter a host:port first')
      return
    }

    if (!window.ultraRpc) {
      setError('Electron IPC not available')
      return
    }

    setLoading(true)
    setError(null)
    setServices([])
    setDiscovered(false)
    setMethodsMap({})

    try {
      const result = await window.ultraRpc.grpcReflect({
        host: host.trim(),
        insecure: true,
        headers,
      })

      if (result.success && result.services) {
        const filtered = result.services.filter(
          s => !s.startsWith('grpc.reflection')
        )
        setServices(filtered)
        setDiscovered(true)
      } else {
        throw new Error(result.error || 'Reflection failed')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to discover services')
    } finally {
      setLoading(false)
    }
  }

  const loadMethods = async (serviceName: string) => {
    if (methodsMap[serviceName]) return // Already loaded

    if (!window.ultraRpc) return

    setMethodsLoading(serviceName)
    setMethodsError(prev => { const n = { ...prev }; delete n[serviceName]; return n })

    try {
      const result = await window.ultraRpc.grpcMethods({
        host: host.trim(),
        insecure: true,
        headers,
        serviceName,
      })

      if (result.success && result.methods) {
        setMethodsMap(prev => ({ ...prev, [serviceName]: result.methods! }))
      } else {
        setMethodsError(prev => ({ ...prev, [serviceName]: result.error || 'Failed to load methods' }))
      }
    } catch (err: any) {
      setMethodsError(prev => ({ ...prev, [serviceName]: err.message }))
    } finally {
      setMethodsLoading(null)
    }
  }

  const handleServiceClick = (service: string) => {
    onSelectService(service)
    const isExpanding = expandedService !== service
    setExpandedService(isExpanding ? service : null)
    if (isExpanding) {
      loadMethods(service)
    }
  }

  const handleMethodClick = (service: string, method: MethodInfo) => {
    onSelectMethod(service, method.name, method.sampleBody)
  }

  const getServiceShortName = (fullName: string) => {
    const parts = fullName.split('.')
    return parts[parts.length - 1]
  }

  const streamingLabel = (m: MethodInfo) => {
    if (m.clientStreaming && m.serverStreaming) return 'bidi'
    if (m.clientStreaming) return 'client stream'
    if (m.serverStreaming) return 'server stream'
    return 'unary'
  }

  return (
    <div className="reflect-panel">
      <div className="reflect-header">
        <div className="reflect-header-info">
          <Search size={14} />
          <span className="reflect-title">Service Discovery</span>
        </div>
        <button
          className="btn-primary reflect-discover-btn"
          onClick={discoverServices}
          disabled={loading || !host.trim()}
        >
          {loading ? (
            <><Loader2 size={13} className="spin" /> Discovering...</>
          ) : discovered ? (
            <><RefreshCw size={13} /> Refresh</>
          ) : (
            <><Zap size={13} /> Discover Services</>
          )}
        </button>
      </div>

      {!discovered && !error && !loading && (
        <div className="reflect-hint">
          <div className="reflect-hint-icon">🔍</div>
          <div className="reflect-hint-text">
            Enter a gRPC server address above and click <strong>Discover Services</strong> to
            auto-detect available services via server reflection.
          </div>
          <div className="reflect-hint-example">
            Example: <code>grpcb.in:9000</code>
          </div>
        </div>
      )}

      {error && (
        <div className="reflect-error">
          <AlertCircle size={16} />
          <div>
            <div className="reflect-error-title">Discovery Failed</div>
            <div className="reflect-error-msg">{error}</div>
          </div>
        </div>
      )}

      {loading && (
        <div className="reflect-loading">
          <Loader2 size={20} className="spin" />
          <span>Connecting to {host}...</span>
        </div>
      )}

      {discovered && services.length === 0 && (
        <div className="reflect-empty">
          No services found. The server may not support reflection.
        </div>
      )}

      {services.length > 0 && (
        <div className="reflect-services">
          <div className="reflect-services-header">
            <Server size={13} />
            <span>{services.length} service{services.length > 1 ? 's' : ''} found — click to discover methods</span>
          </div>
          {services.map(svc => (
            <div key={svc} className="reflect-service-item">
              <button
                className={`reflect-service-btn ${expandedService === svc ? 'reflect-service-btn-active' : ''}`}
                onClick={() => handleServiceClick(svc)}
              >
                <ChevronRight
                  size={14}
                  className={`reflect-chevron ${expandedService === svc ? 'reflect-chevron-open' : ''}`}
                />
                <span className="reflect-service-name">{getServiceShortName(svc)}</span>
                <span className="reflect-service-full">{svc}</span>
              </button>

              {/* Methods list */}
              {expandedService === svc && (
                <div className="reflect-methods">
                  {methodsLoading === svc && (
                    <div className="reflect-methods-loading">
                      <Loader2 size={14} className="spin" /> Loading methods...
                    </div>
                  )}

                  {methodsError[svc] && (
                    <div className="reflect-methods-error">
                      <AlertCircle size={12} /> {methodsError[svc]}
                    </div>
                  )}

                  {methodsMap[svc] && methodsMap[svc].length === 0 && (
                    <div className="reflect-methods-empty">No methods found</div>
                  )}

                  {methodsMap[svc]?.map(method => (
                    <button
                      key={method.name}
                      className="reflect-method-btn"
                      onClick={() => handleMethodClick(svc, method)}
                    >
                      <ArrowRight size={12} className="reflect-method-icon" />
                      <span className="reflect-method-name">{method.name}</span>
                      <span className="reflect-method-type">{streamingLabel(method)}</span>
                      <span className="reflect-method-sig">
                        {method.requestType} → {method.responseType}
                      </span>
                      <span className="reflect-use-btn">Use →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default GrpcReflectionPanel
