import React, { useState } from 'react'
import { Search, Loader2, ChevronRight, Server, Zap, AlertCircle, RefreshCw, ArrowRight, FileType, FolderOpen, BookOpen } from 'lucide-react'
import InterpolatedInput from './InterpolatedInput'
import ProtoDefinitionModal from './ProtoDefinitionModal'
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
  insecure?: boolean
  headers: Record<string, string>
  protoPath?: string
  grpcReflection?: boolean
  onSelectService: (service: string) => void
  onSelectMethod: (service: string, method: string, sampleBody?: string) => void
  onHostChange: (host: string) => void
  onProtoPathChange: (path: string) => void
  onGrpcReflectionChange: (useReflection: boolean) => void
  interpolate: (text: string) => string
  // Interpolation context
  activeEnv?: any
  contextVariables?: Record<string, string>
  vaultEntries?: any[]
  theme?: string
}

const GrpcReflectionPanel: React.FC<Props> = ({ 
  host, 
  insecure = false, 
  headers, 
  protoPath = '',
  grpcReflection = true,
  onSelectService, 
  onSelectMethod,
  onHostChange,
  onProtoPathChange,
  onGrpcReflectionChange,
  interpolate,
  activeEnv,
  contextVariables,
  vaultEntries,
  theme
}) => {
  const [services, setServices] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discovered, setDiscovered] = useState(false)
  const [expandedService, setExpandedService] = useState<string | null>(null)
  const [methodsMap, setMethodsMap] = useState<Record<string, MethodInfo[]>>({})
  const [methodsLoading, setMethodsLoading] = useState<string | null>(null)
  const [methodsError, setMethodsError] = useState<Record<string, string>>({})
  const [showDefinitionBrowser, setShowDefinitionBrowser] = useState(false)

  const discoverServices = async () => {
    if (grpcReflection && !host.trim()) {
      setError('Enter a host:port first')
      return
    }

    if (!grpcReflection && !protoPath.trim()) {
      setError('Select a proto file first')
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
        host: interpolate(host).trim() || 'localhost', // backend expects string
        insecure,
        headers,
        protoPath: !grpcReflection ? interpolate(protoPath) : undefined
      })

      if (result.success && result.services) {
        // filter out grpc built-ins if reflection, but if proto we can keep them or same logic
        const filtered = result.services.filter(
          s => !s.startsWith('grpc.reflection')
        )
        setServices(filtered)
        setDiscovered(true)
      } else {
        console.error('Reflection failed with result error:', result.error)
        throw new Error(result.error || 'Reflection failed')
      }
    } catch (err: any) {
      console.error('Reflection caught error:', err)
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
        host: interpolate(host).trim() || 'localhost',
        insecure,
        headers,
        serviceName,
        protoPath: !grpcReflection ? interpolate(protoPath) : undefined
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
      {/* 1. Mode Toggle on TOP */}
      <div className="reflect-mode-toggle">
        <button 
          type="button"
          className={`reflect-mode-btn ${grpcReflection ? 'active' : ''}`}
          onClick={() => onGrpcReflectionChange(true)}
        >
          <Server size={13} /> Server Reflection
        </button>
        <button 
          type="button"
          className={`reflect-mode-btn ${!grpcReflection ? 'active' : ''}`}
          onClick={() => onGrpcReflectionChange(false)}
        >
          <FileType size={13} /> Proto File
        </button>
      </div>

      <div className="reflect-header">
        <div className="reflect-header-info">
          <Search size={14} />
          <span className="reflect-title">Service Discovery</span>
        </div>
      </div>

      {grpcReflection && (
        <div className="reflect-host-input">
          <label>Host</label>
          <InterpolatedInput
            className="address-input"
            style={{ flex: 1 }}
            value={host}
            onChange={onHostChange}
            placeholder="host:port (e.g. api.example.com:443)"
            activeEnv={activeEnv}
            contextVariables={contextVariables}
            vaultEntries={vaultEntries}
            theme={theme}
          />
        </div>
      )}

      {!grpcReflection && (
        <div className="reflect-proto-input">
          <input
            type="text"
            placeholder="Path to .proto file"
            value={protoPath}
            onChange={(e) => onProtoPathChange(e.target.value)}
          />
          <button 
            type="button"
            className="btn-secondary" 
            title="Browse"
            onClick={async (e) => {
              e.preventDefault()
              if (window.ultraRpc) {
                const res = await window.ultraRpc.pickFile()
                console.log("pickFile result:", res)
                if (res.success && res.path) {
                  onProtoPathChange(res.path)
                }
              }
            }}
          >
            <FolderOpen size={14} />
          </button>
        </div>
      )}

      {/* 4. Action Buttons BELOW inputs */}
      <div className="reflect-actions">
        {discovered && (
          <button
            className="btn-ghost reflect-browse-btn"
            onClick={() => setShowDefinitionBrowser(true)}
            title="Browse the full schema definition"
          >
            <BookOpen size={13} /> Browse Definition
          </button>
        )}
        <button
          className="btn-primary reflect-discover-btn"
          onClick={discoverServices}
          disabled={loading || (grpcReflection ? !host.trim() : !protoPath.trim())}
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
            {grpcReflection ? (
              <>
                Enter a gRPC server address above and click <strong>Discover Services</strong> to
                auto-detect available services via server reflection.
              </>
            ) : (
              <>
                Select a local <strong>.proto</strong> file and click <strong>Discover Services</strong> to
                load services and methods from the definition.
              </>
            )}
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

      {showDefinitionBrowser && (
        <ProtoDefinitionModal
          services={services}
          methodsMap={methodsMap}
          host={host}
          insecure={insecure}
          headers={headers}
          protoPath={protoPath}
          grpcReflection={grpcReflection}
          interpolate={interpolate}
          onClose={() => setShowDefinitionBrowser(false)}
          onSelectMethod={(service, method, sampleBody) => {
            onSelectMethod(service, method, sampleBody)
            setShowDefinitionBrowser(false)
          }}
        />
      )}
    </div>
  )
}

export default GrpcReflectionPanel
