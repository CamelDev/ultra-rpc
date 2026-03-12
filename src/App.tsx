import React, { useState, useCallback, useEffect } from 'react'
import {
  Plus,
  Send,
  Settings,
  Globe,
  Zap,
  X,
  Loader2,
} from 'lucide-react'
import { motion } from 'framer-motion'
import KeyValueEditor from './components/KeyValueEditor'
import ResponseViewer from './components/ResponseViewer'
import EnvironmentPanel from './components/EnvironmentPanel'
import CollectionPanel from './components/CollectionPanel'
import HistoryPanel from './components/HistoryPanel'
import GrpcReflectionPanel from './components/GrpcReflectionPanel'
import type { Tab, RequestConfig, ResponseData, Environment } from './types'
import { createEmptyRequest } from './lib/helpers'

type RequestTab = 'params' | 'headers' | 'body' | 'auth'

interface HistoryEntry {
  id: string
  request: RequestConfig
  timestamp: number
  statusCode?: number
}

interface CollectionData {
  id: string
  name: string
  requests: RequestConfig[]
}

const App: React.FC = () => {
  // ===== Tab State =====
  const [tabs, setTabs] = useState<Tab[]>([
    { id: '1', request: createEmptyRequest() },
  ])
  const [activeTabId, setActiveTabId] = useState('1')

  // ===== Per-tab response state =====
  const [responses, setResponses] = useState<Record<string, ResponseData | null>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [loadingTabs, setLoadingTabs] = useState<Record<string, boolean>>({})

  // ===== UI state =====
  const [activeConfigTab, setActiveConfigTab] = useState<RequestTab>('params')
  const [showEnvPanel, setShowEnvPanel] = useState(false)

  // ===== Environments =====
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null)

  // ===== Collections =====
  const [collections, setCollections] = useState<CollectionData[]>([])

  // ===== History =====
  const [history, setHistory] = useState<HistoryEntry[]>([])

  // ===== Load persisted data on mount =====
  useEffect(() => {
    if (!window.ultraRpc) return
    window.ultraRpc.getEnvironments().then(res => {
      if (res.success && res.environments) setEnvironments(res.environments)
    })
    loadCollections()
    loadHistory()
  }, [])

  const loadCollections = async () => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.listCollections()
    if (res.success && res.collections) setCollections(res.collections)
  }

  const loadHistory = async () => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.getHistory()
    if (res.success && res.history) setHistory(res.history)
  }

  // Persist environments when they change
  const handleEnvChange = (envs: Environment[]) => {
    setEnvironments(envs)
    if (window.ultraRpc) window.ultraRpc.saveEnvironments(envs)
  }

  // ===== Helpers =====
  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeRequest = activeTab?.request
  const activeEnv = environments.find(e => e.id === activeEnvId)

  const updateActiveRequest = useCallback((partial: Partial<RequestConfig>) => {
    setTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, request: { ...t.request, ...partial } } : t
    ))
  }, [activeTabId])

  const addTab = (request?: RequestConfig) => {
    const newReq = request ? { ...request, id: Math.random().toString(36).substring(2, 11) } : createEmptyRequest()
    const newTab: Tab = { id: newReq.id, request: newReq }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newReq.id)
  }

  const removeTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const newTabs = tabs.filter(t => t.id !== id)
    if (newTabs.length === 0) {
      const newReq = createEmptyRequest()
      setTabs([{ id: newReq.id, request: newReq }])
      setActiveTabId(newReq.id)
    } else {
      setTabs(newTabs)
      if (activeTabId === id) setActiveTabId(newTabs[newTabs.length - 1].id)
    }
  }

  // ===== Env variable interpolation =====
  const interpolate = (str: string): string => {
    if (!activeEnv) return str
    return str.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
      const found = activeEnv.variables.find(v => v.enabled && v.key === varName)
      return found ? found.value : `{{${varName}}}`
    })
  }

  // ===== Save to history =====
  const addToHistory = async (request: RequestConfig, statusCode?: number) => {
    const entry: HistoryEntry = {
      id: Math.random().toString(36).substring(2, 11),
      request: { ...request },
      timestamp: Date.now(),
      statusCode,
    }
    setHistory(prev => [entry, ...prev].slice(0, 100))
    if (window.ultraRpc) window.ultraRpc.addHistory(entry)
  }

  const clearHistory = async () => {
    setHistory([])
    if (window.ultraRpc) window.ultraRpc.clearHistory()
  }

  // ===== Save current request to collection =====
  const saveToCollection = async (collectionId: string) => {
    if (!activeRequest || !window.ultraRpc) return
    await window.ultraRpc.saveRequest({ collectionId, request: activeRequest })
    loadCollections()
  }

  // ===== Send Request =====
  const sendRequest = async () => {
    if (!activeRequest) return

    setLoadingTabs(prev => ({ ...prev, [activeTabId]: true }))
    setErrors(prev => ({ ...prev, [activeTabId]: null }))
    setResponses(prev => ({ ...prev, [activeTabId]: null }))

    const url = interpolate(activeRequest.url)
    let statusCode: number | undefined

    if (activeRequest.type === 'GRPC') {
      try {
        if (!window.ultraRpc) throw new Error('Electron IPC not available. Run the app in Electron.')

        const headers: Record<string, string> = {}
        activeRequest.headers.filter(h => h.enabled && h.key).forEach(h => {
          headers[interpolate(h.key)] = interpolate(h.value)
        })

        if (!activeRequest.grpcService) {
          throw new Error('Select a service first. Use the "Discover Services" button below to find available services via reflection.')
        }
        if (!activeRequest.grpcMethod) {
          throw new Error('Enter a method name to call.')
        }

        const result = await window.ultraRpc.grpcCall({
          host: url, insecure: true, headers,
          service: activeRequest.grpcService, method: activeRequest.grpcMethod,
          payload: activeRequest.grpcPayload || '{}',
        })
        if (result.success && result.data) {
          statusCode = result.data.status
          setResponses(prev => ({ ...prev, [activeTabId]: result.data! }))
        } else {
          throw new Error(result.error || 'gRPC call failed')
        }
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [activeTabId]: err.message }))
      }
    } else {
      try {
        const headers: Record<string, string> = {}
        activeRequest.headers.filter(h => h.enabled && h.key).forEach(h => {
          headers[interpolate(h.key)] = interpolate(h.value)
        })

        const enabledParams = activeRequest.params.filter(p => p.enabled && p.key)
        let fullUrl = url
        if (enabledParams.length > 0) {
          const searchParams = new URLSearchParams()
          enabledParams.forEach(p => searchParams.append(interpolate(p.key), interpolate(p.value)))
          fullUrl += (fullUrl.includes('?') ? '&' : '?') + searchParams.toString()
        }

        if (window.ultraRpc) {
          const result = await window.ultraRpc.sendRestRequest({
            method: activeRequest.method, url: fullUrl, headers,
            body: ['POST', 'PUT', 'PATCH'].includes(activeRequest.method) ? interpolate(activeRequest.body) : undefined,
          })
          if (result.success && result.data) {
            statusCode = result.data.status
            setResponses(prev => ({ ...prev, [activeTabId]: result.data! }))
          } else {
            throw new Error(result.error || 'Request failed')
          }
        } else {
          const start = Date.now()
          const resp = await fetch(fullUrl, {
            method: activeRequest.method, headers,
            body: ['POST', 'PUT', 'PATCH'].includes(activeRequest.method) ? interpolate(activeRequest.body) : undefined,
          })
          const body = await resp.text()
          const time = Date.now() - start
          const respHeaders: Record<string, string> = {}
          resp.headers.forEach((v, k) => { respHeaders[k] = v })
          statusCode = resp.status
          setResponses(prev => ({
            ...prev,
            [activeTabId]: { status: resp.status, statusText: resp.statusText, headers: respHeaders, body, time, size: new Blob([body]).size },
          }))
        }
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [activeTabId]: err.message }))
      }
    }

    // Record in history
    addToHistory(activeRequest, statusCode)
    setLoadingTabs(prev => ({ ...prev, [activeTabId]: false }))
  }

  // ===== Method Color =====
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

  const configTabs: { key: RequestTab; label: string }[] = [
    { key: 'params', label: 'Params' },
    { key: 'headers', label: 'Headers' },
    { key: 'body', label: 'Body' },
    { key: 'auth', label: 'Auth' },
  ]

  if (!activeRequest) return null

  return (
    <div className="app-container">
      {/* ===== SIDEBAR ===== */}
      <aside className="sidebar">
        <div className="title-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Zap size={18} color="var(--accent)" fill="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '0.5px' }}>ULTRARPC</span>
          </div>
        </div>

        <div style={{ padding: '12px', display: 'flex', gap: '6px' }}>
          <button className="btn-primary" style={{ flex: 1, height: '32px', fontSize: '12px' }} onClick={() => addTab()}>
            <Plus size={14} /> NEW
          </button>
        </div>

        <nav className="sidebar-nav">
          {/* History Panel */}
          <HistoryPanel
            history={history}
            onOpenRequest={(req) => addTab(req)}
            onClear={clearHistory}
          />

          <div className="sidebar-divider" />

          {/* Collections Panel */}
          <CollectionPanel
            collections={collections}
            onRefresh={loadCollections}
            onOpenRequest={(req) => addTab(req)}
            onSaveToCollection={saveToCollection}
          />

          {/* Environment Panel */}
          {showEnvPanel && (
            <>
              <div className="sidebar-divider" />
              <EnvironmentPanel
                environments={environments}
                onChange={handleEnvChange}
                activeEnvId={activeEnvId}
                onSetActive={setActiveEnvId}
              />
            </>
          )}
        </nav>

        <div style={{ padding: '12px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn-ghost" style={{ padding: '6px' }}><Settings size={18} /></button>
          <button
            className={`btn-ghost ${showEnvPanel ? 'env-toggle-active' : ''}`}
            style={{ padding: '6px' }}
            onClick={() => setShowEnvPanel(!showEnvPanel)}
            title="Environments"
          >
            <Globe size={18} />
          </button>
        </div>
      </aside>

      {/* ===== MAIN ===== */}
      <main className="main-content">
        {/* Tab bar */}
        <header className="title-bar" style={{ padding: '0', background: 'var(--bg-secondary)' }}>
          <div className="tab-bar no-scrollbar">
            {tabs.map(tab => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`tab-item ${activeTabId === tab.id ? 'tab-active' : ''}`}
              >
                <span className="tab-method" style={{ color: methodColor(tab.request.type === 'GRPC' ? 'GRPC' : tab.request.method) }}>
                  {tab.request.type === 'GRPC' ? 'gRPC' : tab.request.method}
                </span>
                <span className="tab-title">
                  {tab.request.url || tab.request.name}
                </span>
                <button className="tab-close" onClick={(e) => removeTab(e, tab.id)}>
                  <X size={12} />
                </button>
                {activeTabId === tab.id && (
                  <motion.div layoutId="activeTab" className="tab-indicator" />
                )}
              </div>
            ))}
            <button className="tab-add" onClick={() => addTab()}>
              <Plus size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <section className="request-section">
          <motion.div
            key={activeTabId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="request-container"
          >
            {/* ==== Address Bar ==== */}
            <div className="address-bar glass">
              {activeRequest.type === 'GRPC' ? (
                <div className="address-type-badge grpc-badge">gRPC</div>
              ) : (
                <select
                  className="method-select"
                  value={activeRequest.method}
                  onChange={(e) => updateActiveRequest({ method: e.target.value as any })}
                  style={{ color: methodColor(activeRequest.method) }}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </select>
              )}

              <div className="address-type-toggle">
                <button
                  className={`type-btn ${activeRequest.type === 'REST' ? 'type-btn-active' : ''}`}
                  onClick={() => updateActiveRequest({ type: 'REST' })}
                >REST</button>
                <button
                  className={`type-btn ${activeRequest.type === 'GRPC' ? 'type-btn-active' : ''}`}
                  onClick={() => updateActiveRequest({ type: 'GRPC' })}
                >gRPC</button>
              </div>

              <input
                className="address-input"
                placeholder={activeRequest.type === 'GRPC' ? 'host:port (e.g. api.example.com:443)' : 'https://api.example.com/endpoint'}
                value={activeRequest.url}
                onChange={(e) => updateActiveRequest({ url: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && sendRequest()}
              />
              <button className="btn-primary send-btn" onClick={sendRequest} disabled={loadingTabs[activeTabId]}>
                {loadingTabs[activeTabId] ? (
                  <><Loader2 size={14} className="spin" /> Sending</>
                ) : (
                  <><Send size={14} /> Send</>
                )}
              </button>
            </div>

            {/* Active env indicator */}
            {activeEnv && (
              <div className="active-env-indicator">
                <Globe size={12} /> {activeEnv.name}
              </div>
            )}

            {/* ==== gRPC specific fields ==== */}
            {activeRequest.type === 'GRPC' && (
              <>
                <div className="grpc-fields">
                  <div className="grpc-field-row">
                    <label className="grpc-label">Service</label>
                    <input
                      className="grpc-input"
                      placeholder="Use Discover below, or type e.g. mypackage.MyService"
                      value={activeRequest.grpcService || ''}
                      onChange={(e) => updateActiveRequest({ grpcService: e.target.value })}
                    />
                  </div>
                  <div className="grpc-field-row">
                    <label className="grpc-label">Method</label>
                    <input
                      className="grpc-input"
                      placeholder="e.g. GetUser"
                      value={activeRequest.grpcMethod || ''}
                      onChange={(e) => updateActiveRequest({ grpcMethod: e.target.value })}
                    />
                  </div>
                </div>

                <GrpcReflectionPanel
                  host={interpolate(activeRequest.url)}
                  headers={(() => {
                    const h: Record<string, string> = {}
                    activeRequest.headers.filter(hdr => hdr.enabled && hdr.key).forEach(hdr => {
                      h[interpolate(hdr.key)] = interpolate(hdr.value)
                    })
                    return h
                  })()}
                  onSelectService={(svc) => updateActiveRequest({ grpcService: svc })}
                  onSelectMethod={(svc, method, sampleBody) => {
                    updateActiveRequest({
                      grpcService: svc,
                      grpcMethod: method,
                      grpcPayload: sampleBody || '{}',
                      bodyType: 'json',
                    })
                    setActiveConfigTab('body')
                  }}
                />
              </>
            )}

            {/* ==== Config Tabs ==== */}
            <div className="config-tabs">
              {configTabs.map(ct => (
                <button
                  key={ct.key}
                  className={`config-tab ${activeConfigTab === ct.key ? 'config-tab-active' : ''}`}
                  onClick={() => setActiveConfigTab(ct.key)}
                >
                  {ct.label}
                  {ct.key === 'params' && activeRequest.params.filter(p => p.key).length > 0 && (
                    <span className="config-tab-badge">{activeRequest.params.filter(p => p.key).length}</span>
                  )}
                  {ct.key === 'headers' && activeRequest.headers.filter(h => h.key).length > 0 && (
                    <span className="config-tab-badge">{activeRequest.headers.filter(h => h.key).length}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ==== Config Content ==== */}
            <div className="config-content">
              {activeConfigTab === 'params' && (
                <KeyValueEditor
                  pairs={activeRequest.params}
                  onChange={(params) => updateActiveRequest({ params })}
                  keyPlaceholder="Parameter"
                  valuePlaceholder="Value"
                />
              )}
              {activeConfigTab === 'headers' && (
                <KeyValueEditor
                  pairs={activeRequest.headers}
                  onChange={(headers) => updateActiveRequest({ headers })}
                  keyPlaceholder="Header"
                  valuePlaceholder="Value"
                />
              )}
              {activeConfigTab === 'body' && (
                <div className="body-editor">
                  <div className="body-type-bar">
                    {(['json', 'text', 'none'] as const).map(bt => (
                      <button
                        key={bt}
                        className={`body-type-btn ${activeRequest.bodyType === bt ? 'body-type-active' : ''}`}
                        onClick={() => updateActiveRequest({ bodyType: bt })}
                      >
                        {bt.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {activeRequest.bodyType !== 'none' && (
                    <textarea
                      className="body-textarea"
                      placeholder={activeRequest.type === 'GRPC'
                        ? '{\n  "field": "value"\n}'
                        : activeRequest.bodyType === 'json'
                        ? '{\n  "key": "value"\n}'
                        : 'Plain text body...'}
                      value={activeRequest.type === 'GRPC' ? (activeRequest.grpcPayload || '') : activeRequest.body}
                      onChange={(e) => {
                        if (activeRequest.type === 'GRPC') {
                          updateActiveRequest({ grpcPayload: e.target.value })
                        } else {
                          updateActiveRequest({ body: e.target.value })
                        }
                      }}
                    />
                  )}
                </div>
              )}
              {activeConfigTab === 'auth' && (
                <div className="auth-section">
                  <div className="auth-hint">
                    Add authentication headers directly in the <strong>Headers</strong> tab.
                    <br /><br />
                    For gRPC, use headers like:
                    <pre className="auth-example">Authorization: Basic {'<base64_credentials>'}</pre>
                    <br />
                    Use <code>{'{{VARIABLE}}'}</code> syntax to reference environment variables.
                  </div>
                </div>
              )}
            </div>

            {/* ==== Response ==== */}
            <div className="response-section">
              <h3 className="section-label">Response</h3>
              <ResponseViewer
                response={responses[activeTabId] || null}
                error={errors[activeTabId] || null}
                loading={loadingTabs[activeTabId] || false}
              />
            </div>
          </motion.div>
        </section>
      </main>
    </div>
  )
}

export default App
