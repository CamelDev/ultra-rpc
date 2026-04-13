import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  X,
  Search,
  Server,
  Zap,
  ArrowRight,
  Loader2,
  ChevronRight,
  ChevronDown,
  BookOpen,
  AlertCircle,
  Code2,
  CornerDownRight,
  Layers,
} from 'lucide-react'
import Editor from './Editor'
import './ProtoDefinitionModal.css'

interface MethodInfo {
  name: string
  fullName: string
  requestType: string
  responseType: string
  clientStreaming: boolean
  serverStreaming: boolean
  sampleBody?: string
  responseSampleBody?: string
}

interface Props {
  services: string[]
  methodsMap: Record<string, MethodInfo[]>
  host: string
  insecure?: boolean
  headers: Record<string, string>
  protoPath?: string
  grpcReflection?: boolean
  interpolate: (text: string) => string
  onClose: () => void
  onSelectMethod: (service: string, method: string, sampleBody?: string) => void
}

type LoadState = 'idle' | 'loading' | 'done' | 'error'

interface Selection {
  service: string
  method: MethodInfo | null
}

// ─── helpers ────────────────────────────────────────────────────────────────

function streamingLabel(m: MethodInfo): { label: string; cls: string } {
  if (m.clientStreaming && m.serverStreaming)
    return { label: 'bidi stream', cls: 'proto-badge-bidi' }
  if (m.clientStreaming) return { label: 'client stream', cls: 'proto-badge-client' }
  if (m.serverStreaming) return { label: 'server stream', cls: 'proto-badge-server' }
  return { label: 'unary', cls: 'proto-badge-unary' }
}

function getServiceShortName(fullName: string) {
  const parts = fullName.split('.')
  return parts[parts.length - 1]
}

function getPackageName(fullName: string) {
  const parts = fullName.split('.')
  parts.pop()
  return parts.join('.') || '(root)'
}

/** Tokenise a proto type name into its short + package parts */
function splitTypeName(fullName: string): { pkg: string; short: string } {
  const clean = fullName.startsWith('.') ? fullName.slice(1) : fullName
  const idx = clean.lastIndexOf('.')
  if (idx === -1) return { pkg: '', short: clean }
  return { pkg: clean.slice(0, idx), short: clean.slice(idx + 1) }
}

/** Render a coloured type chip */
function TypeChip({ typeName }: { typeName: string }) {
  const { short } = splitTypeName(typeName)
  return (
    <span className="proto-type-chip" title={typeName}>
      {short}
    </span>
  )
}

// ─── sample body renderer ───────────────────────────────────────────────────

function SampleBodyViewer({ json, label, theme }: { json: string; label: string; theme?: string }) {
  return (
    <div className="proto-sample-wrap">
      <div className="proto-sample-header">
        <Code2 size={12} />
        <span>{label}</span>
      </div>
      <div className="proto-sample-editor">
        <Editor
          value={json}
          language="json"
          readOnly
          autoHeight
          wrapLines={false}
          theme={(theme === 'light' ? 'light' : 'dark') as 'light' | 'dark'}
          className="proto-sample-cm"
        />
      </div>
    </div>
  )
}

// ─── main component ──────────────────────────────────────────────────────────

const ProtoDefinitionModal: React.FC<Props> = ({
  services,
  methodsMap: initialMethodsMap,
  host,
  insecure = false,
  headers,
  protoPath,
  grpcReflection = true,
  interpolate,
  onClose,
  onSelectMethod,
}) => {
  const [query, setQuery] = useState('')
  const [methodsMap, setMethodsMap] = useState<Record<string, MethodInfo[]>>(initialMethodsMap)
  const [loadStates, setLoadStates] = useState<Record<string, LoadState>>({})
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({})
  const [expandedServices, setExpandedServices] = useState<Set<string>>(() => {
    // Auto-expand all services that already have methods loaded
    const s = new Set<string>()
    for (const svc of services) {
      if (initialMethodsMap[svc]) s.add(svc)
    }
    // If nothing loaded yet, expand first service
    if (s.size === 0 && services.length > 0) s.add(services[0])
    return s
  })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [schemaTab, setSchemaTab] = useState<'request' | 'response'>('request')
  const searchRef = useRef<HTMLInputElement>(null)

  // Focus search on open
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // ESC closes modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const loadMethods = useCallback(
    async (serviceName: string) => {
      if (methodsMap[serviceName] || loadStates[serviceName] === 'loading') return

      setLoadStates(prev => ({ ...prev, [serviceName]: 'loading' }))
      try {
        const result = await window.ultraRpc.grpcMethods({
          host: interpolate(host).trim() || 'localhost',
          insecure,
          headers,
          serviceName,
          protoPath: !grpcReflection ? interpolate(protoPath || '') : undefined,
        })
        if (result.success && result.methods) {
          setMethodsMap(prev => ({ ...prev, [serviceName]: result.methods! }))
          setLoadStates(prev => ({ ...prev, [serviceName]: 'done' }))
        } else {
          setLoadErrors(prev => ({ ...prev, [serviceName]: result.error || 'Failed' }))
          setLoadStates(prev => ({ ...prev, [serviceName]: 'error' }))
        }
      } catch (err: any) {
        setLoadErrors(prev => ({ ...prev, [serviceName]: err.message }))
        setLoadStates(prev => ({ ...prev, [serviceName]: 'error' }))
      }
    },
    [methodsMap, loadStates, host, insecure, headers, protoPath, grpcReflection, interpolate]
  )

  // Load all services eagerly (in background) so search works across all
  useEffect(() => {
    for (const svc of services) {
      if (!methodsMap[svc] && loadStates[svc] !== 'loading') {
        loadMethods(svc)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleService = (svc: string) => {
    setExpandedServices(prev => {
      const next = new Set(prev)
      if (next.has(svc)) {
        next.delete(svc)
      } else {
        next.add(svc)
        loadMethods(svc)
      }
      return next
    })
  }

  const selectMethod = (svc: string, method: MethodInfo) => {
    setSelection({ service: svc, method })
    setSchemaTab('request') // reset tab when switching methods
  }

  const selectService = (svc: string) => {
    setSelection({ service: svc, method: null })
  }

  // ── filtering ──────────────────────────────────────────────────────────────
  const q = query.toLowerCase().trim()

  const filteredServices = services.filter(svc => {
    if (!q) return true
    if (svc.toLowerCase().includes(q)) return true
    const methods = methodsMap[svc] || []
    return methods.some(
      m =>
        m.name.toLowerCase().includes(q) ||
        m.requestType.toLowerCase().includes(q) ||
        m.responseType.toLowerCase().includes(q)
    )
  })

  function matchesMethods(svc: string): MethodInfo[] {
    const methods = methodsMap[svc] || []
    if (!q) return methods
    return methods.filter(
      m =>
        svc.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.requestType.toLowerCase().includes(q) ||
        m.responseType.toLowerCase().includes(q)
    )
  }

  function highlight(text: string) {
    if (!q) return <>{text}</>
    const idx = text.toLowerCase().indexOf(q)
    if (idx === -1) return <>{text}</>
    return (
      <>
        {text.slice(0, idx)}
        <mark className="proto-highlight">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    )
  }

  // ── detail panel ───────────────────────────────────────────────────────────
  const renderDetail = () => {
    if (!selection) {
      return (
        <div className="proto-detail-empty">
          <div className="proto-detail-empty-icon">
            <Layers size={40} strokeWidth={1.2} />
          </div>
          <div className="proto-detail-empty-title">Select a service or method</div>
          <div className="proto-detail-empty-sub">
            Use the tree on the left to explore services and methods.
          </div>
        </div>
      )
    }

    if (!selection.method) {
      // Service-level view
      const methods = methodsMap[selection.service] || []
      const state = loadStates[selection.service]
      return (
        <div className="proto-detail-service">
          <div className="proto-detail-service-name">
            <Server size={18} />
            <span>{getServiceShortName(selection.service)}</span>
          </div>
          <div className="proto-detail-service-pkg">
            <span className="proto-pkg-label">package</span>
            <code>{getPackageName(selection.service)}</code>
          </div>
          <div className="proto-detail-service-full">
            <span className="proto-pkg-label">full name</span>
            <code>{selection.service}</code>
          </div>

          {state === 'loading' && (
            <div className="proto-detail-service-loading">
              <Loader2 size={14} className="spin" /> Loading methods…
            </div>
          )}

          {methods.length > 0 && (
            <div className="proto-detail-methods-grid">
              {methods.map(m => {
                const { label, cls } = streamingLabel(m)
                return (
                  <button
                    key={m.name}
                    className="proto-detail-method-card"
                    onClick={() => selectMethod(selection.service, m)}
                  >
                    <div className="proto-detail-method-card-header">
                      <span className="proto-detail-method-card-name">{m.name}</span>
                      <span className={`proto-badge ${cls}`}>{label}</span>
                    </div>
                    <div className="proto-detail-method-card-types">
                      <span className="proto-flow-label">req</span>
                      <TypeChip typeName={m.requestType} />
                      <ArrowRight size={12} className="proto-flow-arrow" />
                      <span className="proto-flow-label">res</span>
                      <TypeChip typeName={m.responseType} />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    // Method-level view
    const m = selection.method
    const { label, cls } = streamingLabel(m)

    const activeBody = schemaTab === 'response'
      ? (m.responseSampleBody || '{}')
      : (m.sampleBody || '{}')
    const activeTypeName = schemaTab === 'response' ? m.responseType : m.requestType

    return (
      <div className="proto-detail-method">
        {/* Method header */}
        <div className="proto-detail-method-header">
          <div className="proto-detail-method-title">
            <Zap size={16} className="proto-detail-method-icon" />
            <span className="proto-detail-method-name-big">{m.name}</span>
            <span className={`proto-badge ${cls}`}>{label}</span>
          </div>
          <div className="proto-detail-method-service">
            <CornerDownRight size={12} />
            <span>{selection.service}</span>
          </div>
        </div>

        {/* Request / Response tab toggle */}
        <div className="proto-schema-tabs">
          <button
            className={`proto-schema-tab ${schemaTab === 'request' ? 'proto-schema-tab-active' : ''}`}
            onClick={() => setSchemaTab('request')}
          >
            <ArrowRight size={12} />
            Request
            <TypeChip typeName={m.requestType} />
          </button>
          <button
            className={`proto-schema-tab ${schemaTab === 'response' ? 'proto-schema-tab-active' : ''}`}
            onClick={() => setSchemaTab('response')}
          >
            <ArrowRight size={12} style={{ transform: 'rotate(180deg)' }} />
            Response
            <TypeChip typeName={m.responseType} />
          </button>
        </div>

        {/* Active type full name */}
        <div className="proto-active-type-row">
          <span className="proto-pkg-label">type</span>
          <code className="proto-active-type-name">{activeTypeName}</code>
        </div>

        {/* Streaming info */}
        {(m.clientStreaming || m.serverStreaming) && (
          <div className="proto-streaming-info">
            {m.clientStreaming && (
              <div className="proto-streaming-item">
                <span className="proto-streaming-dot proto-streaming-dot-client" />
                Client sends a stream of messages
              </div>
            )}
            {m.serverStreaming && (
              <div className="proto-streaming-item">
                <span className="proto-streaming-dot proto-streaming-dot-server" />
                Server returns a stream of messages
              </div>
            )}
          </div>
        )}

        {/* Schema body with syntax highlighting */}
        <SampleBodyViewer
          key={schemaTab}
          json={activeBody}
          label={schemaTab === 'request' ? 'Request Structure' : 'Response Structure'}
        />

        {/* Use button (only for request) */}
        {schemaTab === 'request' && (
          <button
            className="proto-use-btn"
            onClick={() => {
              onSelectMethod(selection.service, m.name, m.sampleBody)
              onClose()
            }}
          >
            <ArrowRight size={14} />
            Use this method
          </button>
        )}
      </div>
    )
  }

  // ── total method count ─────────────────────────────────────────────────────
  const totalMethods = Object.values(methodsMap).reduce((s, ms) => s + ms.length, 0)
  const loadedCount = Object.values(loadStates).filter(s => s === 'done').length
  const stillLoading = services.some(svc => !methodsMap[svc] && loadStates[svc] === 'loading')

  return (
    <div className="proto-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="proto-modal">
        {/* ── HEADER ── */}
        <div className="proto-modal-header">
          <div className="proto-modal-header-left">
            <BookOpen size={16} className="proto-modal-icon" />
            <span className="proto-modal-title">Schema Browser</span>
            {host && (
              <span className="proto-modal-source">
                {grpcReflection ? interpolate(host) : (protoPath?.split('/').pop() || 'proto file')}
              </span>
            )}
            <div className="proto-modal-stats">
              {services.length} services
              {totalMethods > 0 && ` · ${totalMethods} methods`}
              {stillLoading && (
                <span className="proto-modal-loading-badge">
                  <Loader2 size={10} className="spin" /> loading…
                </span>
              )}
              {!stillLoading && loadedCount > 0 && (
                <span className="proto-modal-loaded-badge">
                  {loadedCount}/{services.length} loaded
                </span>
              )}
            </div>
          </div>
          <div className="proto-modal-header-right">
            <div className="proto-search-wrap">
              <Search size={13} className="proto-search-icon" />
              <input
                ref={searchRef}
                className="proto-search-input"
                type="text"
                placeholder="Search services, methods, types…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              {query && (
                <button className="proto-search-clear" onClick={() => setQuery('')}>
                  <X size={12} />
                </button>
              )}
            </div>
            <button className="proto-modal-close" onClick={onClose} title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="proto-modal-body">
          {/* ── LEFT TREE ── */}
          <div className="proto-tree">
            <div className="proto-tree-inner">
              {filteredServices.length === 0 && (
                <div className="proto-tree-empty">
                  No results for "<strong>{query}</strong>"
                </div>
              )}

              {filteredServices.map(svc => {
                const isExpanded = expandedServices.has(svc) || !!q
                const state = loadStates[svc]
                const methods = matchesMethods(svc)
                const isActiveSvc = selection?.service === svc
                const shortName = getServiceShortName(svc)
                const pkg = getPackageName(svc)

                return (
                  <div key={svc} className="proto-tree-service">
                    <button
                      className={`proto-tree-svc-btn ${isActiveSvc && !selection?.method ? 'proto-tree-svc-btn-active' : ''}`}
                      onClick={() => {
                        toggleService(svc)
                        selectService(svc)
                      }}
                    >
                      <span className="proto-tree-chevron">
                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </span>
                      <Server size={13} className="proto-tree-svc-icon" />
                      <span className="proto-tree-svc-name">{highlight(shortName)}</span>
                      {pkg && <span className="proto-tree-svc-pkg">{highlight(pkg)}</span>}
                      {state === 'loading' && <Loader2 size={11} className="spin proto-tree-spinner" />}
                      {state === 'error' && <AlertCircle size={11} className="proto-tree-err-icon" />}
                    </button>

                    {isExpanded && (
                      <div className="proto-tree-methods">
                        {loadErrors[svc] && (
                          <div className="proto-tree-method-err">
                            <AlertCircle size={11} /> {loadErrors[svc]}
                          </div>
                        )}

                        {methods.map(method => {
                          const { label, cls } = streamingLabel(method)
                          const isActiveMethod =
                            selection?.service === svc && selection?.method?.name === method.name
                          return (
                            <button
                              key={method.name}
                              className={`proto-tree-method-btn ${isActiveMethod ? 'proto-tree-method-btn-active' : ''}`}
                              onClick={() => selectMethod(svc, method)}
                            >
                              <span className="proto-tree-method-indent" />
                              <Zap size={11} className="proto-tree-method-icon" />
                              <span className="proto-tree-method-name">{highlight(method.name)}</span>
                              <span className={`proto-badge proto-badge-sm ${cls}`}>{label}</span>
                            </button>
                          )
                        })}

                        {methods.length === 0 && state !== 'loading' && !loadErrors[svc] && methodsMap[svc] && (
                          <div className="proto-tree-no-methods">No methods</div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── RIGHT DETAIL ── */}
          <div className="proto-detail">
            {renderDetail()}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProtoDefinitionModal
