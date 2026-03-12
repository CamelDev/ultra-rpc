import React, { useState, useCallback, useEffect } from 'react'
import {
  Plus,
  Send,
  Save,
  Settings,
  Globe,
  Zap,
  X,
  Loader2,
} from 'lucide-react'
import { motion } from 'framer-motion'
import KeyValueEditor from './components/KeyValueEditor'
import InterpolatedInput from './components/InterpolatedInput'
import ResponseViewer from './components/ResponseViewer'
import EnvironmentPanel from './components/EnvironmentPanel'
import CollectionPanel from './components/CollectionPanel'
import HistoryPanel from './components/HistoryPanel'
import GrpcReflectionPanel from './components/GrpcReflectionPanel'
import type { Tab, RequestConfig, ResponseData, Environment } from './types'
import { createEmptyRequest } from './lib/helpers'

type RequestTab = 'params' | 'headers' | 'body' | 'auth' | 'script'

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
  variables?: any[]
}

const App: React.FC = () => {
  // ===== Tab State =====
  const [tabs, setTabs] = useState<Tab[]>([
    { id: '1', request: createEmptyRequest() },
  ])
  const [activeTabId, setActiveTabId] = useState('1')
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [tabNameInput, setTabNameInput] = useState('')

  // ===== Per-tab response state =====
  const [responses, setResponses] = useState<Record<string, ResponseData | null>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [loadingTabs, setLoadingTabs] = useState<Record<string, boolean>>({})
  const [scriptLogs, setScriptLogs] = useState<Record<string, string[]>>({})

  // ===== UI state =====
  const [activeConfigTab, setActiveConfigTab] = useState<RequestTab>('params')
  const [showEnvPanel, setShowEnvPanel] = useState(false)
  const [showSaveMenu, setShowSaveMenu] = useState(false)

  // ===== Environments =====
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null)

  // ===== Settings & Theme =====
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [showSettingsPopup, setShowSettingsPopup] = useState(false)
  const [editingCollection, setEditingCollection] = useState<CollectionData | null>(null)

  // ===== Sidebar Resizing =====
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('ultraRpcSidebarWidth')
    return saved ? parseInt(saved, 10) : 260
  })
  const [isResizing, setIsResizing] = useState(false)

  const [requestPanelHeight, setRequestPanelHeight] = useState(() => {
    const saved = localStorage.getItem('ultraRpcRequestHeight')
    return saved ? parseInt(saved, 10) : 380
  })
  const [isResizingResponse, setIsResizingResponse] = useState(false)

  useEffect(() => {
    if (isResizing) {
      const handleMouseMove = (e: MouseEvent) => {
        let newWidth = e.clientX
        if (newWidth < 200) newWidth = 200
        if (newWidth > 800) newWidth = 800
        setSidebarWidth(newWidth)
      }
      const handleMouseUp = () => {
        setIsResizing(false)
        localStorage.setItem('ultraRpcSidebarWidth', sidebarWidth.toString())
      }
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isResizing, sidebarWidth])

  useEffect(() => {
    if (isResizingResponse) {
      const handleMouseMove = (e: MouseEvent) => {
        // Calculate relative Y position within the request-section (approximate)
        const newHeight = e.clientY - 120 // 120px offset for header/tabs
        if (newHeight >= 150 && newHeight <= 800) {
          setRequestPanelHeight(newHeight)
        }
      }
      const handleMouseUp = () => {
        setIsResizingResponse(false)
        localStorage.setItem('ultraRpcRequestHeight', requestPanelHeight.toString())
      }
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isResizingResponse, requestPanelHeight])

  useEffect(() => {
    localStorage.setItem('ultraRpcSidebarWidth', sidebarWidth.toString())
  }, [sidebarWidth])

  const resetLayout = () => {
    localStorage.removeItem('ultraRpcSidebarWidth')
    localStorage.removeItem('ultraRpcRequestHeight')
    setSidebarWidth(260)
    setRequestPanelHeight(380)
  }

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
    window.ultraRpc.getSettings().then(res => {
      if (res.success && res.settings) {
        if (res.settings.theme) {
          setTheme(res.settings.theme)
        }
        if (res.settings.activeEnvId) {
          setActiveEnvId(res.settings.activeEnvId)
        }
      }
    })
    loadCollections()
    loadHistory()
  }, [])

  // Apply theme to body
  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme')
    } else {
      document.body.classList.remove('light-theme')
    }
  }, [theme])

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

  const saveAppSetting = async (key: string, value: any) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.getSettings()
    const current = res.success ? (res.settings || {}) : {}
    await window.ultraRpc.saveSettings({ ...current, [key]: value })
  }

  const handleSaveCollectionVariables = async (id: string, variables: any[]) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.saveCollectionVariables({ collectionId: id, variables })
    if (res.success) {
      setCollections(prev => prev.map(c => c.id === id ? { ...c, variables } : c))
    }
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
  const activeRequestCollection = activeTab ? collections.find(c => c.requests.some(r => r.id === activeTab.request.id)) : null

  const updateActiveRequest = useCallback((partial: Partial<RequestConfig>) => {
    setTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, request: { ...t.request, ...partial }, isDirty: true } : t
    ))
  }, [activeTabId])

  const addEmptyTab = () => {
    const newReq = createEmptyRequest()
    const newTab: Tab = { id: newReq.id, request: newReq }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newReq.id)
  }

  const openRequestTab = (request: RequestConfig, fromHistory: boolean) => {
    if (fromHistory) {
      // Historical snapshots shouldn't overwrite the active collection model. Give them a new ID.
      const newReq = { ...request, id: Math.random().toString(36).substring(2, 11) }
      const newTab: Tab = { id: newReq.id, request: newReq }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(newReq.id)
    } else {
      // From Collection
      const existingTab = tabs.find(t => t.id === request.id)
      if (existingTab) {
        // Tab exactly matching this collection request is already open, just switch to it.
        setActiveTabId(request.id)
      } else {
        // It's not open, so open it, preserving its unique ID so saves overwrite it.
        const newTab: Tab = { id: request.id, request: { ...request } }
        setTabs(prev => [...prev, newTab])
        setActiveTabId(request.id)
      }
    }
  }

  const removeTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const tabToClose = tabs.find(t => t.id === id)
    if (tabToClose?.isDirty) {
      if (!window.confirm(`This request has unsaved changes.\nAre you sure you want to close it?`)) {
        return
      }
    }

    const newTabs = tabs.filter(t => t.id !== id)
    if (newTabs.length === 0) {
      const newReq = createEmptyRequest()
      setTabs([{ id: newReq.id, request: newReq, isDirty: false }])
      setActiveTabId(newReq.id)
    } else {
      setTabs(newTabs)
      if (activeTabId === id) setActiveTabId(newTabs[newTabs.length - 1].id)
    }
  }

  const interpolate = (str: string): string => {
    if (!str) return str
    return str.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
      // 1. Collection variables
      if (activeRequestCollection?.variables) {
        const found = activeRequestCollection.variables.find(v => v.enabled && v.key === varName)
        if (found) return found.value
      }

      // 2. Env variables
      if (activeEnv) {
        const found = activeEnv.variables.find(v => v.enabled && v.key === varName)
        if (found) return found.value
      }

      return `{{${varName}}}`
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
    
    // Clear dirty flag on active tab
    setTabs(prev => prev.map(t => 
      t.id === activeTabId ? { ...t, isDirty: false } : t
    ))

    loadCollections()
    setShowSaveMenu(false)
  }

  const handleSaveActiveRequest = () => {
    if (!activeRequest) return
    
    // Check if the current request naturally belongs to any known collection
    const owningCollection = collections.find(c => 
      c.requests.some(r => r.id === activeRequest.id)
    )

    if (owningCollection) {
      // It's a known request linked to a collection, silently auto-save it
      saveToCollection(owningCollection.id)
    } else {
      // It's a new or decoupled request, open the standard picker
      setShowSaveMenu(true)
    }
  }

  const handleRenameRequest = (reqId: string, newName: string) => {
    setTabs(prev => prev.map(t => 
      t.request.id === reqId 
        ? { ...t, request: { ...t.request, name: newName }, isDirty: true } 
        : t
    ))
  }

  const runPostResponseScript = async (request: RequestConfig, response: ResponseData) => {
    if (!request.postResponseScript || !request.postResponseScript.trim()) return

    const parentCollection = collections.find(c => c.requests.some(r => r.id === request.id))
    if (!parentCollection) return

    const logs: string[] = []
    const mockConsole = {
      log: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')
        logs.push(`[LOG] ${msg}`)
        setScriptLogs(prev => ({ ...prev, [activeTabId]: [...(prev[activeTabId] || []), `[LOG] ${msg}`] }))
      },
      error: (...args: any[]) => {
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')
        logs.push(`[ERROR] ${msg}`)
        setScriptLogs(prev => ({ ...prev, [activeTabId]: [...(prev[activeTabId] || []), `[ERROR] ${msg}`] }))
      }
    }

    try {
      // Prepare response body as object if JSON
      let bodyObj = response.body
      try {
        bodyObj = JSON.parse(response.body)
      } catch { /* stay as string */ }
      
      try {
        const bodyType = Array.isArray(bodyObj) ? 'Array' : typeof bodyObj
        mockConsole.log(`[Script Debug] Response Body Type: ${bodyType}`)
        mockConsole.log(`[Script Debug] Response Status: ${response.status}`)
        if (bodyType === 'object' && bodyObj !== null) {
          mockConsole.log(`[Script Debug] Available Keys: ${Object.keys(bodyObj).join(', ')}`)
        } else if (bodyType === 'Array' && bodyObj.length > 0) {
          mockConsole.log(`[Script Debug] First Array Item Keys: ${Object.keys(bodyObj[0]).join(', ')}`)
        }
      } catch (e) {
        mockConsole.log(`[Script Debug] Error analyzing body: ${e}`)
      }

      const currentVars = [...(parentCollection.variables || [])]

      const ultra = {
        response: { ...response, body: bodyObj },
        setCollectionVariable: (key: string, value: string) => {
          // Use the latest state of currentVars (shared across calls in this script run)
          const existingIdx = currentVars.findIndex(v => v.key === key)
          if (existingIdx >= 0) {
            currentVars[existingIdx] = { ...currentVars[existingIdx], value: String(value) }
          } else {
            currentVars.push({ id: Math.random().toString(36).substring(2, 11), key, value: String(value), enabled: true })
          }
          
          handleSaveCollectionVariables(parentCollection.id, [...currentVars]).then(() => {
             mockConsole.log(`[Script] Saved variable: ${key}`)
          }).catch(err => {
             mockConsole.error(`[Script] Failed to save variable ${key}: ${err.message}`)
          })
        }
      }

      // Sandbox execution
      const script = new Function('ultra', 'console', request.postResponseScript)
      script(ultra, mockConsole)
    } catch (err: any) {
      console.error('Post-response script error:', err)
      mockConsole.error(`Runtime Error: ${err.message}`)
      setErrors(prev => ({ ...prev, [activeTabId]: `Script Error: ${err.message}` }))
    }
  }

  // ===== Send Request =====
  const sendRequest = async () => {
    if (!activeRequest) return

    setLoadingTabs(prev => ({ ...prev, [activeTabId]: true }))
    setErrors(prev => ({ ...prev, [activeTabId]: null }))
    setResponses(prev => ({ ...prev, [activeTabId]: null }))
    setScriptLogs(prev => ({ ...prev, [activeTabId]: [] }))

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
          payload: interpolate(activeRequest.grpcPayload || '{}'),
          timeoutMs: activeRequest.timeoutMs
        })
        if (result.success && result.data) {
          statusCode = result.data.status
          setResponses(prev => ({ ...prev, [activeTabId]: result.data! }))
          runPostResponseScript(activeRequest, result.data)
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
            runPostResponseScript(activeRequest, result.data)
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
          const respData = { status: resp.status, statusText: resp.statusText, headers: respHeaders, body, time, size: new Blob([body]).size }
          setResponses(prev => ({
            ...prev,
            [activeTabId]: respData,
          }))
          runPostResponseScript(activeRequest, respData)
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
    { key: 'auth', label: 'Options' },
    { key: 'script', label: 'Script' },
  ]

  if (!activeRequest) return null

  return (
    <div className="app-container">
      {/* ===== SIDEBAR ===== */}
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="title-bar" style={{ paddingLeft: navigator.userAgent.includes('Mac') ? '80px' : '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Zap size={18} color="var(--accent)" fill="var(--accent)" />
            <span style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '0.5px' }}>ULTRARPC</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {/* History Panel */}
          <HistoryPanel
            history={history}
            onOpenRequest={(req) => openRequestTab(req, true)}
            onClear={clearHistory}
          />

          <div className="sidebar-divider" />

          {/* Collections Panel */}
          <CollectionPanel
            collections={collections}
            onRefresh={loadCollections}
            onOpenRequest={(req) => openRequestTab(req, false)}
            onSaveToCollection={saveToCollection}
            onRenameRequest={handleRenameRequest}
            onEditVariables={setEditingCollection}
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

        <div style={{ padding: '12px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
          <button 
            className={`btn-ghost ${showSettingsPopup ? 'env-toggle-active' : ''}`}
            style={{ padding: '6px' }} 
            onClick={() => setShowSettingsPopup(!showSettingsPopup)}
            title="Settings"
          >
            <Settings size={18} />
          </button>
          
          <button
            className={`btn-ghost ${showEnvPanel ? 'env-toggle-active' : ''}`}
            style={{ padding: '6px' }}
            onClick={() => setShowEnvPanel(!showEnvPanel)}
            title="Environments"
          >
            <Globe size={18} />
          </button>

          {showSettingsPopup && (
            <div className="settings-popup glass fade-in">
              <div className="settings-popup-header">Global Settings</div>
              <div className="settings-row">
                <span className="settings-label">Theme</span>
                <div className="theme-toggle-group">
                  <button 
                    className={`theme-toggle-btn ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => {
                      setTheme('light')
                      if (window.ultraRpc) window.ultraRpc.saveSettings({ theme: 'light' })
                    }}
                  >
                    Daylight
                  </button>
                  <button 
                    className={`theme-toggle-btn ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => {
                      setTheme('dark')
                      if (window.ultraRpc) window.ultraRpc.saveSettings({ theme: 'dark' })
                    }}
                  >
                    Midnight
                  </button>
                </div>
              </div>
              <div className="settings-row" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                <span className="settings-label">Interface</span>
                <button 
                  className="btn-ghost" 
                  style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 600 }}
                  onClick={resetLayout}
                >
                  Reset Layout
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div 
        className={`sidebar-resizer ${isResizing ? 'resizing' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); setIsResizing(true) }}
      />

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
                
                {editingTabId === tab.id ? (
                  <input
                    className="tab-title-input"
                    value={tabNameInput}
                    onChange={(e) => setTabNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, request: { ...t.request, name: tabNameInput } } : t))
                        setEditingTabId(null)
                      }
                    }}
                    onBlur={() => {
                      setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, request: { ...t.request, name: tabNameInput } } : t))
                      setEditingTabId(null)
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '12px', outline: 'none', minWidth: '80px', flex: 1 }}
                  />
                ) : (
                  <span 
                    className="tab-title" 
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setEditingTabId(tab.id)
                      setTabNameInput(tab.request.name || tab.request.url || '')
                    }}
                    title="Double-click to rename"
                    style={{ color: tab.isDirty ? 'var(--danger)' : 'var(--text-primary)' }}
                  >
                    {tab.request.name || tab.request.url || 'Untitled'}
                    {tab.isDirty ? '*' : ''}
                  </span>
                )}
                
                <button className="tab-close" onClick={(e) => removeTab(e, tab.id)}>
                  <X size={12} />
                </button>
                {activeTabId === tab.id && (
                  <motion.div layoutId="activeTab" className="tab-indicator" />
                )}
              </div>
            ))}
            <button className="tab-add" onClick={() => addEmptyTab()}>
              <Plus size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <section className="request-section">
          <div className="request-top-pane" style={{ height: `${requestPanelHeight}px` }}>
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

                <InterpolatedInput
                  className="address-input"
                  placeholder={activeRequest.type === 'GRPC' ? 'host:port (e.g. api.example.com:443)' : 'https://api.example.com/endpoint'}
                  value={activeRequest.url}
                  onChange={(val) => updateActiveRequest({ url: val })}
                  onKeyDown={(e) => e.key === 'Enter' && sendRequest()}
                  activeEnv={activeEnv}
                  collectionVariables={activeRequestCollection?.variables}
                />
                <button 
                  className="btn-ghost save-btn" 
                  onClick={handleSaveActiveRequest}
                  title="Save Request (Auto-saves to Collection if already exists)"
                  style={{ 
                    padding: '0 12px', 
                    color: activeTab?.isDirty ? 'var(--danger)' : 'var(--text-secondary)' 
                  }}
                >
                  <Save size={14} />
                </button>
                <button className="btn-primary send-btn" onClick={sendRequest} disabled={loadingTabs[activeTabId]}>
                  {loadingTabs[activeTabId] ? (
                    <><Loader2 size={14} className="spin" /> Sending</>
                  ) : (
                    <><Send size={14} /> Send</>
                  )}
                </button>

                {/* Save Menu Popup */}
                {showSaveMenu && (
                  <div 
                    className="save-menu glass fade-in-tooltip" 
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 8px)',
                      right: 0,
                      width: '240px',
                      padding: '8px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                      zIndex: 100
                    }}
                  >
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', padding: '0 4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Save to Collection
                    </div>
                    {collections.length === 0 && (
                      <div style={{ padding: '8px 4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        No collections yet. Create one in the sidebar.
                      </div>
                    )}
                    {collections.map(c => (
                      <button 
                        key={c.id}
                        className="save-menu-item"
                        onClick={() => {
                          saveToCollection(c.id)
                          setShowSaveMenu(false)
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 12px',
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Active env selector */}
              {environments.length > 0 && (
                <div className="env-selector-wrapper">
                  <Globe size={12} className="env-selector-icon" />
                  <select
                    className="env-selector"
                    value={activeEnvId || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const newId = val === '' ? null : val;
                      setActiveEnvId(newId);
                      saveAppSetting('activeEnvId', newId);
                    }}
                  >
                    <option value="">No Environment</option>
                    {environments.map(env => (
                      <option key={env.id} value={env.id}>{env.name}</option>
                    ))}
                  </select>
                </div>
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
                    {ct.key === 'script' && activeRequest.postResponseScript && (
                      <span className="config-tab-badge-dot" />
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
                    activeEnv={activeEnv}
                    collectionVariables={activeRequestCollection?.variables}
                  />
                )}
                {activeConfigTab === 'headers' && (
                  <KeyValueEditor
                    pairs={activeRequest.headers}
                    onChange={(headers) => updateActiveRequest({ headers })}
                    keyPlaceholder="Header"
                    valuePlaceholder="Value"
                    activeEnv={activeEnv}
                    collectionVariables={activeRequestCollection?.variables}
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
                      <InterpolatedInput
                        className="body-textarea"
                        multiline
                        activeEnv={activeEnv}
                        collectionVariables={activeRequestCollection?.variables}
                        placeholder={activeRequest.type === 'GRPC'
                          ? '{\n  "field": "value"\n}'
                          : activeRequest.bodyType === 'json'
                          ? '{\n  "key": "value"\n}'
                          : 'Plain text body...'}
                        value={activeRequest.type === 'GRPC' ? (activeRequest.grpcPayload || '') : (activeRequest.body || '')}
                        highlightJson={activeRequest.bodyType === 'json' || activeRequest.type === 'GRPC'}
                        onChange={(val) => {
                          if (activeRequest.type === 'GRPC') {
                            updateActiveRequest({ grpcPayload: val })
                          } else {
                            updateActiveRequest({ body: val })
                          }
                        }}
                      />
                    )}
                  </div>
                )}
                {activeConfigTab === 'auth' && (
                  <div className="options-section" style={{ padding: '16px', color: 'var(--text-secondary)' }}>
                    <div style={{ marginBottom: '24px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                        Request Timeout (Deadline)
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input 
                          type="number" 
                          min="0"
                          placeholder="30000 (Default)"
                          style={{
                            background: 'var(--bg-tertiary)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-primary)',
                            padding: '6px 10px',
                            borderRadius: '4px',
                            width: '120px',
                            outline: 'none',
                            fontSize: '13px'
                          }}
                          value={activeRequest.timeoutMs || ''}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10)
                            updateActiveRequest({ timeoutMs: isNaN(val) ? undefined : val })
                          }}
                        />
                        <span style={{ fontSize: '12px' }}>milliseconds</span>
                      </div>
                    </div>
                  </div>
                )}
                {activeConfigTab === 'script' && (
                  <div className="script-section" style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <div style={{ marginBottom: '12px' }}>
                      <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                        Post-Response Script (JavaScript)
                      </label>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        Run code after a successful response. Access <code>ultra.response</code> and update variables with <code>ultra.setCollectionVariable(key, value)</code>.
                      </p>
                    </div>
                    <div style={{ flex: 1, minHeight: '150px' }}>
                       <InterpolatedInput
                          multiline
                          className="script-editor"
                          placeholder="// code here...&#10;if (ultra.response.body.token) {&#10;  ultra.setCollectionVariable('auth_token', ultra.response.body.token);&#10;}"
                          value={activeRequest.postResponseScript || ''}
                          onChange={val => updateActiveRequest({ postResponseScript: val })}
                          activeEnv={activeEnv}
                          collectionVariables={activeRequestCollection?.variables}
                        />
                    </div>
                    
                    {/* Console Log Viewer */}
                    <div className="script-console glass">
                      <div className="console-header">
                        <span className="console-title">Console Output</span>
                        <button 
                          className="btn-ghost" 
                          style={{ fontSize: '10px', padding: '2px 8px' }}
                          onClick={() => setScriptLogs(prev => ({ ...prev, [activeTabId]: [] }))}
                        >
                          Clear
                        </button>
                      </div>
                      <div className="console-logs">
                        {(scriptLogs[activeTabId] || []).length === 0 ? (
                          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No logs yet...</div>
                        ) : (
                          scriptLogs[activeTabId].map((log, i) => (
                            <div key={i} className={`console-log-entry ${log.startsWith('[ERROR]') ? 'console-log-entry-error' : ''}`}>
                              {log}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ==== gRPC specific fields (below content now) ==== */}
              {activeRequest.type === 'GRPC' && (
                <>
                  <div className="grpc-fields">
                    <div className="grpc-field-row">
                      <label className="grpc-label">Service</label>
                      <InterpolatedInput
                        className="grpc-input"
                        placeholder="Use Discover below, or type e.g. mypackage.MyService"
                        value={activeRequest.grpcService || ''}
                        onChange={(val) => updateActiveRequest({ grpcService: val })}
                        activeEnv={activeEnv}
                        collectionVariables={activeRequestCollection?.variables}
                      />
                    </div>
                    <div className="grpc-field-row">
                      <label className="grpc-label">Method</label>
                      <InterpolatedInput
                        className="grpc-input"
                        placeholder="e.g. GetUser"
                        value={activeRequest.grpcMethod || ''}
                        onChange={(val) => updateActiveRequest({ grpcMethod: val })}
                        activeEnv={activeEnv}
                        collectionVariables={activeRequestCollection?.variables}
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
            </motion.div>
          </div>

          <div 
            className={`h-resizer ${isResizingResponse ? 'resizing' : ''}`}
            onMouseDown={() => setIsResizingResponse(true)}
          />

          <div className="request-bottom-pane">
            <h3 className="section-label">Response</h3>
            <ResponseViewer 
              response={responses[activeTabId] || null} 
              error={errors[activeTabId] || null}
              loading={loadingTabs[activeTabId] || false}
            />
          </div>
        </section>
      </main>

      {/* Collection Variables Modal */}
      {editingCollection && (
        <div className="modal-overlay" onClick={() => setEditingCollection(null)}>
          <motion.div 
            className="modal-content glass" 
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
          >
            <div className="modal-header">
              <h3>Collection Variables: {editingCollection.name}</h3>
              <button className="btn-ghost" onClick={() => setEditingCollection(null)} style={{ padding: '4px' }}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              <div style={{ marginBottom: '20px', padding: '12px', background: 'var(--accent-muted)', borderRadius: '8px', border: '1px solid var(--accent)', color: 'var(--text-primary)', fontSize: '13px', lineHeight: '1.5' }}>
                <strong>Pro Tip:</strong> Collection variables are scoped to this collection and override environment variables. Use <code>{`{{VARIABLE_NAME}}`}</code> in any request field.
              </div>
              
              <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Variable Definitions
              </div>
              
              <KeyValueEditor
                pairs={collections.find(c => c.id === editingCollection.id)?.variables || []}
                onChange={(vars) => handleSaveCollectionVariables(editingCollection.id, vars)}
                keyPlaceholder="Variable Name"
                valuePlaceholder="Current Value"
                activeEnv={activeEnv}
              />
            </div>
            
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setEditingCollection(null)}>
                Save & Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

export default App
