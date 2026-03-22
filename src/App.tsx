import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Plus,
  Send,
  Save,
  Settings,
  Globe,

  X,
  Loader2,
  Info,
  WrapText,
  Hourglass,
  FolderOpen,
  AlignLeft,
  Search,
} from 'lucide-react'
import { motion, Reorder } from 'framer-motion'
import KeyValueEditor from './components/KeyValueEditor'
import InterpolatedInput from './components/InterpolatedInput'
import type { EditorHandle } from './components/Editor'
import ResponseViewer from './components/ResponseViewer'
import EnvironmentPanel from './components/EnvironmentPanel'
import CollectionPanel from './components/CollectionPanel'
import HistoryPanel from './components/HistoryPanel'
import GrpcReflectionPanel from './components/GrpcReflectionPanel'
import AboutModal from './components/AboutModal'
import type { Tab, RequestConfig, ResponseData, Environment, Collection, CollectionItem } from './types'
import { createEmptyRequest } from './lib/helpers'
import pkg from '../package.json'
import Toaster, { addToast } from './components/Toaster'

type RequestTab = 'params' | 'headers' | 'body' | 'auth' | 'pre-request' | 'post-response'

interface HistoryEntry {
  id: string
  request: RequestConfig
  statusCode?: number
  timestamp: number
}

const App: React.FC = () => {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const saved = localStorage.getItem('ultraRpcTabs')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      } catch (e) {
        console.error('Failed to restore tabs:', e)
      }
    }
    return [{ id: '1', request: createEmptyRequest() }]
  })

  const [activeTabId, setActiveTabId] = useState(() => {
    const savedId = localStorage.getItem('ultraRpcActiveTabId')
    const savedTabs = localStorage.getItem('ultraRpcTabs')
    if (savedId && savedTabs) {
      try {
        const parsed = JSON.parse(savedTabs)
        if (Array.isArray(parsed) && parsed.some((t: any) => t.id === savedId)) {
          return savedId
        }
      } catch {}
    }
    // Fallback to first tab if active id not found or invalid
    const saved = localStorage.getItem('ultraRpcTabs')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id
      } catch {}
    }
    return '1'
  })



  // ===== Per-tab response state =====
  const [responses, setResponses] = useState<Record<string, ResponseData | null>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [loadingTabs, setLoadingTabs] = useState<Record<string, boolean>>({})
  const [scriptLogs, setScriptLogs] = useState<Record<string, string[]>>({})
  const [scriptErrors, setScriptErrors] = useState<Record<string, string | null>>({})

  // ===== UI state =====
  const [activeConfigTab, setActiveConfigTab] = useState<RequestTab>('params')
  const [showEnvPanel, setShowEnvPanel] = useState(false)
  const [showHistoryPanel, setShowHistoryPanel] = useState(() => localStorage.getItem('ultraRpcShowHistory') === 'true')
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const [saveModalRequestName, setSaveModalRequestName] = useState('')
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'collection' | 'request' | 'folder' | 'environment', id: string, name: string, collectionId?: string } | null>(null)

  // ===== Environments =====
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null)

  // ===== Settings & Theme =====
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [showSettingsPopup, setShowSettingsPopup] = useState(false)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [wrapLines, setWrapLines] = useState(true)
  const bodyEditorRef = useRef<EditorHandle>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null)

  // ===== Helpers for Nested Collections =====
  const getAllRequests = useCallback((collection: Collection): RequestConfig[] => {
    const requests: RequestConfig[] = []
    const traverse = (children: CollectionItem[]) => {
      for (const item of children) {
        if (item.type === 'request' && item.request) {
          requests.push(item.request)
        } else if (item.type === 'folder' && item.children) {
          traverse(item.children)
        }
      }
    }
    traverse(collection.children)
    return requests
  }, [])

  const findCollectionByRequestId = useCallback((requestId: string): Collection | null => {
    for (const coll of collections) {
      const requests = getAllRequests(coll)
      if (requests.some(r => r.id === requestId)) return coll
    }
    return null
  }, [collections, getAllRequests])

  // ===== Sidebar Resizing =====
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('ultraRpcSidebarWidth')
    return saved ? parseInt(saved, 10) : 300
  })
  const [isResizing, setIsResizing] = useState(false)

  const [requestPanelHeight, setRequestPanelHeight] = useState(() => {
    const saved = localStorage.getItem('ultraRpcRequestHeight')
    return saved ? parseInt(saved, 10) : 380
  })
  const [requestPanelWidth, setRequestPanelWidth] = useState(() => {
    const saved = localStorage.getItem('ultraRpcRequestWidth')
    return saved ? parseInt(saved, 10) : 600
  })
  const [threeColumnLayout, setThreeColumnLayout] = useState(() => {
    const saved = localStorage.getItem('ultraRpcThreeColumnLayout')
    return saved === 'true'
  })
  const [isResizingResponse, setIsResizingResponse] = useState(false)
  const [isResizingVertical, setIsResizingVertical] = useState(false)
  const [showGrpcDiscovery, setShowGrpcDiscovery] = useState(false)
  const [grpcDiscoveryUrl, setGrpcDiscoveryUrl] = useState('')

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
    if (isResizingVertical) {
      const handleMouseMove = (e: MouseEvent) => {
        const newWidth = e.clientX - sidebarWidth - 4 // 4px for resizer/offsets
        if (newWidth >= 300 && newWidth <= 1200) {
          setRequestPanelWidth(newWidth)
        }
      }
      const handleMouseUp = () => {
        setIsResizingVertical(false)
        localStorage.setItem('ultraRpcRequestWidth', requestPanelWidth.toString())
      }
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isResizingVertical, sidebarWidth, requestPanelWidth])

  useEffect(() => {
    localStorage.setItem('ultraRpcSidebarWidth', sidebarWidth.toString())
  }, [sidebarWidth])

  const resetLayout = () => {
    localStorage.removeItem('ultraRpcSidebarWidth')
    localStorage.removeItem('ultraRpcRequestHeight')
    localStorage.removeItem('ultraRpcRequestWidth')
    setSidebarWidth(300)
    setRequestPanelHeight(380)
    setRequestPanelWidth(600)
    setShowSettingsPopup(false)
  }

  // ===== Collections =====

  // ===== History =====
  const [history, setHistory] = useState<HistoryEntry[]>([])


  // Persist tabs whenever they change
  useEffect(() => {
    localStorage.setItem('ultraRpcTabs', JSON.stringify(tabs))
  }, [tabs])

  // Persist active tab ID
  useEffect(() => {
    localStorage.setItem('ultraRpcActiveTabId', activeTabId)
  }, [activeTabId])

  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  const collectionsRef = useRef(collections)
  useEffect(() => {
    collectionsRef.current = collections
  }, [collections])

  useEffect(() => {
    if (!window.ultraRpc) return

    const unsubscribe = window.ultraRpc.onRequestClose(() => {
      const hasDirtyTabs = tabsRef.current.some((t: Tab) => t.isDirty)
      
      if (hasDirtyTabs) {
        const confirm = window.confirm(
          'You have unsaved changes in your tabs.\nAre you sure you want to exit? Unsaved progress will be lost.'
        )
        if (confirm) {
          const isNewAndUnsaved = (t: Tab) => {
            if (!t.isDirty) return false
            if (t.owningCollectionId) return false
            
            let found = false
            for (const coll of collectionsRef.current) {
              const traverse = (children: any[]) => {
                if (!children) return
                for (const item of children) {
                  if (item.type === 'request' && item.request && item.request.id === t.id) {
                    found = true
                  } else if (item.type === 'folder' && item.children) {
                    traverse(item.children)
                  }
                }
              }
              traverse(coll.children)
              if (found) break
            }
            return !found
          }

          const tabsToKeep = tabsRef.current.filter((t: Tab) => !isNewAndUnsaved(t))
          if (tabsToKeep.length === 0) {
            const emptyId = Math.random().toString(36).substring(2, 11)
            tabsToKeep.push({
              id: emptyId,
              request: {
                id: emptyId, name: '', type: 'REST', method: 'GET', url: '',
                params: [], headers: [], body: '', bodyType: 'none'
              },
              isDirty: false
            })
          }
          
          localStorage.setItem('ultraRpcTabs', JSON.stringify(tabsToKeep))
          if (!tabsToKeep.some((t: Tab) => t.id === localStorage.getItem('ultraRpcActiveTabId'))) {
             localStorage.setItem('ultraRpcActiveTabId', tabsToKeep[tabsToKeep.length - 1].id)
          }

          window.ultraRpc.confirmClose()
        }
      } else {
        window.ultraRpc.confirmClose()
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])


  // Apply theme to body
  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme')
    } else {
      document.body.classList.remove('light-theme')
    }
  }, [theme])

  const loadCollections = useCallback(async () => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.listCollections()
    if (res.success && res.collections) {
      setCollections(res.collections)
      // Show warnings if any (non-blocking toasts)
      if (res.warnings && res.warnings.length > 0) {
        res.warnings.forEach(w => addToast({ type: 'warning', message: w }))
      }
    } else {
      addToast({ type: 'error', message: res.error || 'Failed to load collections' })
    }
  }, [])

  const handleMoveCollection = async (collectionId: string, currentPath?: string) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.moveCollection({ collectionId, currentPath })
    if (res.success) {
      addToast({ type: 'success', message: 'Collection moved successfully' })
      loadCollections()
    } else if (res.error !== 'Cancelled') {
      addToast({ type: 'error', message: res.error || 'Failed to move collection' })
    }
  }

  const handleCloneCollection = async (collectionId: string) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.cloneCollection({ collectionId })
    if (res.success) {
      addToast({ type: 'success', message: 'Collection cloned successfully' })
      loadCollections()
    } else {
      addToast({ type: 'error', message: res.error || 'Failed to clone collection' })
    }
  }

  const handleCloneRequest = async (collectionId: string, requestId: string) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.cloneRequest({ collectionId, requestId })
    if (res.success) {
      addToast({ type: 'success', message: 'Request cloned successfully' })
      loadCollections()
    } else {
      addToast({ type: 'error', message: res.error || 'Failed to clone request' })
    }
  }

  const loadHistory = useCallback(async () => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.getHistory()
    if (res.success && res.history) setHistory(res.history)
  }, [])

  const saveAppSetting = useCallback(async (key: string, value: any) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.getSettings()
    const current = res.success ? (res.settings || {}) : {}
    await window.ultraRpc.saveSettings({ ...current, [key]: value })
  }, [])

   const handleSaveCollectionVariables = useCallback(async (id: string, variables: any[]) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.saveCollectionVariables({ collectionId: id, variables })
    if (res.success) {
      setCollections(prev => prev.map(c => c.id === id ? { ...c, variables } : c))
    }
  }, [])

  // Persist environments when they change
  const handleEnvChange = useCallback((envs: Environment[]) => {
    setEnvironments(envs)
    if (window.ultraRpc) window.ultraRpc.saveEnvironments(envs)
  }, [])

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
        if (res.settings.threeColumnLayout !== undefined) {
          setThreeColumnLayout(res.settings.threeColumnLayout)
        }
      }
    })
    loadCollections()
    loadHistory()
  }, [loadCollections, loadHistory])

  // ===== Helpers =====
  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeRequest = activeTab?.request
  const activeEnv = environments.find(e => e.id === (activeTab?.request.envId || activeEnvId))
  const activeRequestCollection = activeTab ? findCollectionByRequestId(activeTab.request.id) : null

  const updateActiveRequest = useCallback((partial: Partial<RequestConfig>) => {
    setTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, request: { ...t.request, ...partial }, isDirty: true } : t
    ))
  }, [activeTabId])

  const applyEnvToAllTabs = useCallback((envId: string) => {
    setTabs(prev => prev.map(t => ({
      ...t,
      request: { ...t.request, envId },
      isDirty: true
    })))
    setActiveEnvId(envId)
    saveAppSetting('activeEnvId', envId)
  }, [saveAppSetting])

  const addEmptyTab = () => {
    const newReq = createEmptyRequest()
    newReq.envId = activeEnvId // Inherit global env for new tabs
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
        const owningCollection = findCollectionByRequestId(request.id)
        const newTab: Tab = { id: request.id, request: { ...request }, owningCollectionId: owningCollection?.id }
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

  const interpolate = (str: string, envOverride?: Environment, collectionsOverride?: Collection[]): string => {
    if (!str) return str
    
    // Find collection associated with active request in the override or current set
    const currentCollections = collectionsOverride || collections
    const activeColl = activeTab ? currentCollections.find(c => getAllRequests(c).some(r => r.id === activeTab.request.id)) : null
    
    // Resolve environment: request-level first, then global active
    const requestEnvId = activeTab?.request.envId
    const effectiveEnvId = requestEnvId !== undefined ? requestEnvId : activeEnvId
    const currentEnv = envOverride || environments.find(e => e.id === effectiveEnvId)
    
    const result = str.replace(/\{\{([\w.-]+)\}\}/g, (_, varName) => {
      // 1. Collection variables
      if (activeColl?.variables) {
        const found = activeColl.variables.find(v => v.key === varName && v.enabled)
        if (found) return found.value
      }

      // 2. Env variables
      if (currentEnv) {
        const found = currentEnv.variables.find(v => v.key === varName && v.enabled)
        if (found) return found.value
      }

      return `{{${varName}}}`
    })
    
    console.log(`[interpolate] IN="${str}" OUT="${result}" (env=${currentEnv?.name} numVars=${currentEnv?.variables.length})`)
    return result
  }

  // ===== Save to history =====
  const addToHistory = async (request: RequestConfig, statusCode?: number) => {
    const entry: HistoryEntry = {
      id: Math.random().toString(36).substring(2, 11),
      request: { ...request },
      timestamp: Date.now(),
      statusCode,
    }
    setHistory(prev => [entry, ...prev].slice(0, 30))
    if (window.ultraRpc) window.ultraRpc.addHistory(entry)
  }

  const clearHistory = async () => {
    setHistory([])
    if (window.ultraRpc) window.ultraRpc.clearHistory()
  }

  // ===== Save current request to collection =====
  const saveToCollection = useCallback(async (collectionId: string) => {
    if (!activeRequest || !window.ultraRpc) return
    const res = await window.ultraRpc.saveRequest({ collectionId, request: activeRequest })
    
    if (res.success) {
      // Clear dirty flag on active tab and remember the collection
      setTabs(prev => prev.map(t => 
        t.id === activeTabId ? { ...t, isDirty: false, owningCollectionId: collectionId } : t
      ))
      loadCollections()
      setShowSaveMenu(false)
    } else {
      addToast({ type: 'error', message: res.error || 'Failed to save request' })
    }
  }, [activeRequest, activeTabId, loadCollections])

  const handleSaveActiveRequest = useCallback(async () => {
    if (!activeRequest) return
    
    let targetCollectionId = activeTab?.owningCollectionId
    if (!targetCollectionId) {
      const owningCollection = findCollectionByRequestId(activeRequest.id)
      targetCollectionId = owningCollection?.id
    }

    if (targetCollectionId) {
      // It's a known request linked to a collection, silently auto-save it
      saveToCollection(targetCollectionId)
    } else if (collections.length === 0) {
      // No collections exist, auto-create "My collection"
      if (window.ultraRpc) {
        const result = await window.ultraRpc.createCollection({ name: 'My collection' })
        if (result.success && result.id) {
          // Immediately save to this new collection
          await window.ultraRpc.saveRequest({ collectionId: result.id, request: activeRequest })
          
          // Clear dirty flag on active tab
          setTabs(prev => prev.map(t => 
            t.id === activeTabId ? { ...t, isDirty: false } : t
          ))

          loadCollections()
        }
      }
    } else {
      // It's a new or decoupled request, open the standard picker
      setSaveModalRequestName(activeRequest.name || 'New Request')
      setSelectedCollectionId(null)
      setShowSaveMenu(true)
    }
  }, [activeRequest, activeTab, findCollectionByRequestId, saveToCollection, collections, loadCollections, activeTabId])

  const handleSaveAll = useCallback(async () => {
    if (!window.ultraRpc) return
    
    const dirtyTabsWithCollection = tabs.filter(t => t.isDirty)
      .map(t => ({ tab: t, collectionId: t.owningCollectionId || findCollectionByRequestId(t.id)?.id }))
      .filter(x => !!x.collectionId) as { tab: Tab, collectionId: string }[]
    
    if (dirtyTabsWithCollection.length === 0) return

    const savedIds: string[] = []

    for (const item of dirtyTabsWithCollection) {
      const res = await window.ultraRpc.saveRequest({ collectionId: item.collectionId, request: item.tab.request })
      if (res.success) {
        savedIds.push(item.tab.id)
      } else {
        addToast({ type: 'error', message: `Failed to save ${item.tab.request.name || 'Untitled'}: ${res.error}` })
      }
    }

    // Clear dirty flags for successfully saved tabs
    if (savedIds.length > 0) {
      setTabs(prev => prev.map(t => {
        const savedItem = dirtyTabsWithCollection.find(st => st.tab.id === t.id && savedIds.includes(t.id))
        if (savedItem) {
          return { ...t, isDirty: false, owningCollectionId: savedItem.collectionId }
        }
        return t
      }))
      loadCollections()
    }

    if (savedIds.length > 0) {
      addToast({ type: 'success', message: `Saved ${savedIds.length} request(s)` })
    }
  }, [tabs, findCollectionByRequestId, loadCollections])

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S or Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) {
          handleSaveAll()
        } else {
          handleSaveActiveRequest()
        }
      }

      // ESC key to close modals
      if (e.key === 'Escape') {
        setShowSaveMenu(false)
        setConfirmDelete(null)
        setEditingCollection(null)
        setShowSettingsPopup(false)
        setShowAboutModal(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSaveActiveRequest, handleSaveAll])

  const handleRenameRequest = (reqId: string, newName: string) => {
    setTabs(prev => prev.map(t => 
      t.request.id === reqId 
        ? { ...t, request: { ...t.request, name: newName }, isDirty: true } 
        : t
    ))
  }

  const handleFormatJson = useCallback(() => {
    if (!activeRequest) return
    const currentBody = activeRequest.type === 'GRPC' ? (activeRequest.grpcPayload || '') : (activeRequest.body || '')
    if (!currentBody.trim()) return

    try {
      // 1. Identify unquoted {{var}} and temporarily quote them to make JSON valid
      let inString = false
      let intermediate = ''
      for (let i = 0; i < currentBody.length; i++) {
        const char = currentBody[i]
        // Handle escaped quotes
        if (char === '"' && (i === 0 || currentBody[i - 1] !== '\\')) {
          inString = !inString
        }

        // If we find {{ while not in a string, it's an unquoted variable
        if (!inString && currentBody.slice(i, i + 2) === '{{') {
          const end = currentBody.indexOf('}}', i)
          if (end !== -1) {
            const varContent = currentBody.slice(i, end + 2)
            intermediate += `"___ULTRA_UNQUOTED___${varContent}"`
            i = end + 1
            continue
          }
        }
        intermediate += char
      }

      // 2. Parse and format
      const parsed = JSON.parse(intermediate)
      const formatted = JSON.stringify(parsed, null, 2)

      // 3. Restore unquoted variables by removing the placeholder prefix and its surrounding quotes
      const final = formatted.replace(/"___ULTRA_UNQUOTED___(\{\{.*?\}\})"/g, '$1')

      if (activeRequest.type === 'GRPC') {
        updateActiveRequest({ grpcPayload: final })
      } else {
        updateActiveRequest({ body: final })
      }
      addToast({ type: 'success', message: 'JSON Formatted' })
    } catch (e: any) {
      addToast({ type: 'error', message: `Invalid JSON: ${e.message}` })
    }
  }, [activeRequest, updateActiveRequest])

  const runPreRequestScript = async (request: RequestConfig): Promise<{ environments: Environment[], collections: Collection[] } | null> => {
    if (!request.preRequestScript || !request.preRequestScript.trim()) return null

    // We need to work with local copies to avoid race conditions with React state updates
    let currentEnvs = [...environments]
    let currentCollections = [...collections]
    
    const parentCollection = currentCollections.find(c => getAllRequests(c).some(r => r.id === request.id))
    
    const mockConsole = {
      log: (...args: any[]) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')
        setScriptLogs(prev => ({ ...prev, [activeTabId]: [...(prev[activeTabId] || []), `[${timestamp}] LOG: ${msg}`] }))
      },
      error: (...args: any[]) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')
        setScriptLogs(prev => ({ ...prev, [activeTabId]: [...(prev[activeTabId] || []), `[${timestamp}] ERROR: ${msg}`] }))
      }
    }

    const testResults: { name: string; status: 'pass' | 'fail'; message?: string }[] = []

    try {
      const ultra = {
        env: {
          get: (key: string) => {
            const requestEnvId = request.envId
            const effectiveEnvId = requestEnvId !== undefined ? requestEnvId : activeEnvId
            const targetEnv = currentEnvs.find(e => e.id === effectiveEnvId)
            if (!targetEnv) return undefined
            return targetEnv.variables.find(v => v.key === key && v.enabled)?.value
          },
          set: (key: string, value: string) => {
            const requestEnvId = request.envId
            const effectiveEnvId = requestEnvId !== undefined ? requestEnvId : activeEnvId
            if (!effectiveEnvId) {
              mockConsole.error('No active environment associated with this tab/globally.')
              return
            }
            currentEnvs = currentEnvs.map(e => {
              if (e.id === effectiveEnvId) {
                const vars = [...e.variables]
                const idx = vars.findIndex(v => v.key === key)
                if (idx >= 0) {
                  vars[idx] = { ...vars[idx], value: String(value) }
                } else {
                  vars.push({ id: Math.random().toString(36).substring(2, 11), key, value: String(value), enabled: true })
                }
                return { ...e, variables: vars }
              }
              return e
            })
            setEnvironments(currentEnvs)
            if (window.ultraRpc) window.ultraRpc.saveEnvironments(currentEnvs)
            mockConsole.log(`Set env variable: ${key}`)
          },
          all: () => {
            const requestEnvId = request.envId
            const effectiveEnvId = requestEnvId !== undefined ? requestEnvId : activeEnvId
            const targetEnv = currentEnvs.find(e => e.id === effectiveEnvId)
            if (!targetEnv) return {}
            const vars: Record<string, string> = {}
            targetEnv.variables.forEach(v => { if (v.enabled) vars[v.key] = v.value })
            return vars
          }
        },
        collection: {
          get: (key: string) => {
            const target = currentCollections.find(c => c.id === parentCollection?.id)
            if (!target?.variables) return undefined
            return target.variables.find(v => v.key === key && v.enabled)?.value
          },
          set: (key: string, value: string) => {
            if (!parentCollection) {
              mockConsole.error('Request must be in a collection to set variables.')
              return
            }
            currentCollections = currentCollections.map(c => {
              if (c.id === parentCollection.id) {
                const vars = [...(c.variables || [])]
                const idx = vars.findIndex(v => v.key === key)
                if (idx >= 0) {
                  vars[idx] = { ...vars[idx], value: String(value) }
                } else {
                  vars.push({ id: Math.random().toString(36).substring(2, 11), key, value: String(value), enabled: true })
                }
                handleSaveCollectionVariables(c.id, vars)
                return { ...c, variables: vars }
              }
              return c
            })
            setCollections(currentCollections)
            mockConsole.log(`Set collection variable: ${key}`)
          },
          all: () => {
            const target = currentCollections.find(c => c.id === parentCollection?.id)
            if (!target?.variables) return {}
            const vars: Record<string, string> = {}
            target.variables.forEach(v => { if (v.enabled) vars[v.key] = v.value })
            return vars
          }
        },
        test: (name: string, fn: () => void) => {
          try {
            fn()
            testResults.push({ name, status: 'pass' })
            mockConsole.log(`TEST PASS: ${name}`)
          } catch (err: any) {
            testResults.push({ name, status: 'fail', message: err.message })
            mockConsole.error(`TEST FAIL: ${name} -> ${err.message}`)
          }
        },
        expect: (val: any) => ({
          toBe: (expected: any) => { if (val !== expected) throw new Error(`Expected ${expected} but got ${val}`) },
          toInclude: (str: string) => { if (!String(val).includes(str)) throw new Error(`Expected "${val}" to include "${str}"`) },
          toBeTruthy: () => { if (!val) throw new Error(`Expected value to be truthy but got ${val}`) },
        })
      }

      const script = new Function('ultra', 'console', request.preRequestScript)
      script(ultra, mockConsole)
      
      return { environments: currentEnvs, collections: currentCollections }
    } catch (err: any) {
      mockConsole.error(`Pre-request Runtime Error: ${err.message}`)
      setScriptErrors(prev => ({ ...prev, [activeTabId]: `Pre-request Script Error: ${err.message}` }))
      return null // Continue request even if pre-script fails
    }
  }

  const runPostResponseScript = async (request: RequestConfig, response: ResponseData, tabId: string) => {
    if (!request.postResponseScript || !request.postResponseScript.trim()) return

    const parentCollection = findCollectionByRequestId(request.id)
    if (!parentCollection) return

    const mockConsole = {
      log: (...args: any[]) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')
        setScriptLogs(prev => ({ ...prev, [tabId]: [...(prev[tabId] || []), `[${timestamp}] LOG: ${msg}`] }))
      },
      error: (...args: any[]) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
        const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')
        setScriptLogs(prev => ({ ...prev, [tabId]: [...(prev[tabId] || []), `[${timestamp}] ERROR: ${msg}`] }))
      }
    }

    try {
      // Prepare response body as object if JSON
      let bodyObj = response.body
      try {
        bodyObj = JSON.parse(response.body)
      } catch { /* stay as string */ }
      
      const ultra = {
        response: { ...response, body: bodyObj },
        env: {
          get: (varName: string) => {
            const requestEnvId = request.envId
            const effectiveEnvId = requestEnvId !== undefined ? requestEnvId : activeEnvId
            const targetEnv = environments.find(e => e.id === effectiveEnvId)
            if (!targetEnv) return undefined
            return targetEnv.variables.find(v => v.key === varName && v.enabled)?.value
          },
          set: (varName: string, value: string) => {
            const requestEnvId = request.envId
            const effectiveEnvId = requestEnvId !== undefined ? requestEnvId : activeEnvId
            if (!effectiveEnvId) {
              mockConsole.error('No active environment associated with this tab/globally.')
              return
            }
            setEnvironments(prev => {
              const newEnvs = prev.map(e => {
                if (e.id === effectiveEnvId) {
                  const vars = [...e.variables]
                  const idx = vars.findIndex(v => v.key === varName)
                  if (idx >= 0) {
                    vars[idx] = { ...vars[idx], value: String(value) }
                  } else {
                    vars.push({ id: Math.random().toString(36).substring(2, 11), key: varName, value: String(value), enabled: true })
                  }
                  return { ...e, variables: vars }
                }
                return e
              })
              if (window.ultraRpc) window.ultraRpc.saveEnvironments(newEnvs)
              return newEnvs
            })
            mockConsole.log(`Set env variable: ${varName}`)
          },
          all: () => {
            const requestEnvId = request.envId
            const effectiveEnvId = requestEnvId !== undefined ? requestEnvId : activeEnvId
            const targetEnv = environments.find(e => e.id === effectiveEnvId)
            if (!targetEnv) return {}
            const vars: Record<string, string> = {}
            targetEnv.variables.forEach(v => { if (v.enabled) vars[v.key] = v.value })
            return vars
          }
        },
        collection: {
          get: (varName: string) => {
            if (!parentCollection?.variables) return undefined
            return parentCollection.variables.find(v => v.key === varName && v.enabled)?.value
          },
          set: (varName: string, value: string) => {
            setCollections(prev => {
              const target = prev.find(c => c.id === parentCollection.id)
              if (!target) return prev
              
              const vars = [...(target.variables || [])]
              const existingIdx = vars.findIndex(v => v.key === varName)
              if (existingIdx >= 0) {
                vars[existingIdx] = { ...vars[existingIdx], value: String(value) }
              } else {
                vars.push({ id: Math.random().toString(36).substring(2, 11), key: varName, value: String(value), enabled: true })
              }
              
              handleSaveCollectionVariables(target.id, vars).then(() => {
                 mockConsole.log(`Set collection variable: ${varName}`)
              }).catch(err => {
                 mockConsole.error(`Failed to save variable ${varName}: ${err.message}`)
              })
              
              return prev.map(c => c.id === target.id ? { ...c, variables: vars } : c)
            })
          },
          all: () => {
            if (!parentCollection?.variables) return {}
            const vars: Record<string, string> = {}
            parentCollection.variables.forEach(v => { if (v.enabled) vars[v.key] = v.value })
            return vars
          }
        },
        test: (name: string, fn: () => void) => {
          try {
            fn()
            mockConsole.log(`TEST PASS: ${name}`)
          } catch (err: any) {
            mockConsole.error(`TEST FAIL: ${name} -> ${err.message}`)
          }
        },
        expect: (val: any) => ({
          toBe: (expected: any) => { if (val !== expected) throw new Error(`Expected ${expected} but got ${val}`) },
          toInclude: (str: string) => { if (!String(val).includes(str)) throw new Error(`Expected "${val}" to include "${str}"`) },
          toBeTruthy: () => { if (!val) throw new Error(`Expected value to be truthy but got ${val}`) },
        })
      }

      // Sandbox execution
      const script = new Function('ultra', 'console', request.postResponseScript)
      script(ultra, mockConsole)
    } catch (err: any) {
      mockConsole.error(`Post-response Runtime Error: ${err.message}`)
      setScriptErrors(prev => ({ ...prev, [tabId]: `Script Error: ${err.message}` }))
    }
  }

  // ===== Send Request =====
  const sendRequest = async () => {
    if (!activeRequest) return

    const tabId = activeTabId // Capture current active tab ID
    setLoadingTabs(prev => ({ ...prev, [tabId]: true }))
    setErrors(prev => ({ ...prev, [activeTabId]: null }))
    setResponses(prev => ({ ...prev, [activeTabId]: null }))
    setScriptLogs(prev => ({ ...prev, [activeTabId]: [] }))
    setScriptErrors(prev => ({ ...prev, [activeTabId]: null }))

    let scriptResult = null
    try {
      scriptResult = await runPreRequestScript(activeRequest)
    } catch (e) {
      console.error('Pre-request script failed, but continuing request:', e)
    }

    const effectiveEnvIdForUrl = activeRequest.envId || activeEnvId
    const updatedEnv = scriptResult?.environments.find(e => e.id === effectiveEnvIdForUrl) || environments.find(e => e.id === effectiveEnvIdForUrl)
    const url = interpolate(activeRequest.url, updatedEnv, scriptResult?.collections)
    let statusCode: number | undefined

    if (activeRequest.type === 'GRPC') {
      try {
        if (!window.ultraRpc) throw new Error('Electron IPC not available. Run the app in Electron.')

        const headers: Record<string, string> = {}
        activeRequest.headers.filter(h => h.enabled && h.key).forEach(h => {
          headers[interpolate(h.key, updatedEnv, scriptResult?.collections)] = interpolate(h.value, updatedEnv, scriptResult?.collections)
        })

        if (!activeRequest.grpcService) {
          throw new Error('Select a service first. Use the "Discover Services" button below to find available services via reflection.')
        }
        if (!activeRequest.grpcMethod) {
          throw new Error('Enter a method name to call.')
        }

        const effectiveEnvId = activeRequest.envId || activeEnvId
        const currentEnv = scriptResult?.environments.find(e => e.id === effectiveEnvId) || environments.find(e => e.id === effectiveEnvId)
        const isInsecure = currentEnv?.sslVerification === false

        const result = await window.ultraRpc.grpcCall({
          host: url, insecure: isInsecure, headers,
          service: activeRequest.grpcService, method: activeRequest.grpcMethod,
          payload: interpolate(activeRequest.grpcPayload || '{}', updatedEnv, scriptResult?.collections),
          timeoutMs: activeRequest.timeoutMs,
          protoPath: activeRequest.protoPath
        })
        if (result.success && result.data) {
          statusCode = result.data.status
          setResponses(prev => ({ ...prev, [tabId]: result.data! }))
          runPostResponseScript(activeRequest, result.data, tabId)
        } else {
          throw new Error(result.error || 'gRPC call failed')
        }
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [tabId]: err.message }))
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
          enabledParams.forEach(p => searchParams.append(interpolate(p.key, updatedEnv, scriptResult?.collections), interpolate(p.value, updatedEnv, scriptResult?.collections)))
          fullUrl += (fullUrl.includes('?') ? '&' : '?') + searchParams.toString()
        }

        const effectiveEnvId = activeRequest.envId || activeEnvId
        const currentEnv = scriptResult?.environments.find(e => e.id === effectiveEnvId) || environments.find(e => e.id === effectiveEnvId)
        const isInsecure = currentEnv?.sslVerification === false

        if (window.ultraRpc) {
          const result = await window.ultraRpc.sendRestRequest({
            method: activeRequest.method, url: fullUrl, headers,
            body: ['POST', 'PUT', 'PATCH'].includes(activeRequest.method) ? interpolate(activeRequest.body, updatedEnv, scriptResult?.collections) : undefined,
            insecure: isInsecure,
            timeoutMs: activeRequest.timeoutMs
          })
          if (result.success && result.data) {
            statusCode = result.data.status
            setResponses(prev => ({ ...prev, [tabId]: result.data! }))
            runPostResponseScript(activeRequest, result.data, tabId)
          } else {
            throw new Error(result.error || 'Request failed')
          }
        } else {
          const start = Date.now()
          const resp = await fetch(fullUrl, {
            method: activeRequest.method, headers,
            body: ['POST', 'PUT', 'PATCH'].includes(activeRequest.method) ? interpolate(activeRequest.body, updatedEnv, scriptResult?.collections) : undefined,
          })
          const body = await resp.text()
          const time = Date.now() - start
          const respHeaders: Record<string, string> = {}
          resp.headers.forEach((v, k) => { respHeaders[k] = v })
          statusCode = resp.status
          const respData = { type: 'REST' as const, status: resp.status, statusText: resp.statusText, headers: respHeaders, body, time, size: new Blob([body]).size }
          setResponses(prev => ({
            ...prev,
            [tabId]: respData,
          }))
          runPostResponseScript(activeRequest, respData, tabId)
        }
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [tabId]: err.message }))
      }
    }

    // Record in history
    addToHistory(activeRequest, statusCode)
    setLoadingTabs(prev => ({ ...prev, [tabId]: false }))
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

  const configTabs = ([
    { key: 'params', label: 'Params' },
    { key: 'headers', label: 'Headers' },
    { key: 'body', label: 'Body' },
    { key: 'auth', label: 'Options' },
    { key: 'pre-request', label: 'Pre-request' },
    { key: 'post-response', label: 'Post-response' },
  ] as { key: RequestTab; label: string }[]).filter(t => {
    if (activeRequest?.type === 'GRPC' && t.key === 'params') return false
    return true
  })

  // Auto-switch away from Params if it becomes hidden
  useEffect(() => {
    if (activeRequest?.type === 'GRPC' && activeConfigTab === 'params') {
      setActiveConfigTab('headers')
    }
  }, [activeRequest?.type, activeConfigTab])

  if (!activeRequest) return null

  return (
    <div className="app-container">
      {/* ===== SIDEBAR ===== */}
      <aside className="sidebar" style={{ width: sidebarWidth }}>
        <div className="title-bar" style={{ paddingLeft: navigator.userAgent.includes('Mac') ? '80px' : '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img src="./icon.png" alt="UltraRPC" width={18} height={18} style={{ borderRadius: '4px' }} />
            <span style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '0.5px' }}>UltraRPC</span>
          </div>
        </div>

        <div style={{ padding: '12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
          <button 
            className="btn-ghost"
            style={{ padding: '6px' }} 
            onClick={() => setShowAboutModal(true)}
            data-tooltip="About UltraRPC"
            data-tooltip-pos="right"
          >
            <Info size={18} />
          </button>

          <button 
            className={`btn-ghost ${showSettingsPopup ? 'env-toggle-active' : ''}`}
            style={{ padding: '6px' }} 
            onClick={() => setShowSettingsPopup(!showSettingsPopup)}
            data-tooltip="Settings"
            data-tooltip-pos="right"
          >
            <Settings size={18} />
          </button>

          <button
            className={`btn-ghost ${showHistoryPanel ? 'env-toggle-active' : ''}`}
            style={{ padding: '6px' }}
            onClick={() => {
              const next = !showHistoryPanel;
              setShowHistoryPanel(next);
              localStorage.setItem('ultraRpcShowHistory', next.toString());
            }}
            data-tooltip="History"
            data-tooltip-pos="right"
          >
            <Hourglass size={18} />
          </button>
          
          <button
            className={`btn-ghost ${showEnvPanel ? 'env-toggle-active' : ''}`}
            style={{ padding: '6px' }}
            onClick={() => setShowEnvPanel(!showEnvPanel)}
            data-tooltip="Environments"
            data-tooltip-pos="right"
          >
            <Globe size={18} />
          </button>

          {showSettingsPopup && (
            <div className="settings-popup glass fade-in" style={{ top: '50px', bottom: 'auto' }}>
              <div className="settings-popup-header">Global Settings</div>
              <div className="settings-row">
                <span className="settings-label">Theme</span>
                <div className="theme-toggle-group">
                  <button 
                    className={`theme-toggle-btn ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => {
                      setTheme('light')
                      if (window.ultraRpc) window.ultraRpc.saveSettings({ theme: 'light' })
                      setShowSettingsPopup(false)
                    }}
                  >
                    Daylight
                  </button>
                  <button 
                    className={`theme-toggle-btn ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => {
                      setTheme('dark')
                      if (window.ultraRpc) window.ultraRpc.saveSettings({ theme: 'dark' })
                      setShowSettingsPopup(false)
                    }}
                  >
                    Midnight
                  </button>
                </div>
              </div>
              <div className="settings-row" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                <span className="settings-label">Layout</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: threeColumnLayout ? 'var(--text-secondary)' : 'var(--accent)', fontWeight: 600 }}>Vertical</span>
                  <button 
                    className="layout-toggle"
                    onClick={() => {
                      const newValue = !threeColumnLayout
                      setThreeColumnLayout(newValue)
                      localStorage.setItem('ultraRpcThreeColumnLayout', newValue.toString())
                      saveAppSetting('threeColumnLayout', newValue)
                      setShowSettingsPopup(false)
                    }}
                    style={{
                      width: '34px',
                      height: '18px',
                      borderRadius: '10px',
                      background: threeColumnLayout ? 'var(--accent)' : 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      position: 'relative',
                      transition: 'all 0.2s ease',
                      padding: 0
                    }}
                  >
                    <div style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: 'white',
                      position: 'absolute',
                      top: '2px',
                      left: threeColumnLayout ? '18px' : '2px',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                    }} />
                  </button>
                  <span style={{ fontSize: '11px', color: threeColumnLayout ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 600 }}>3-Column</span>
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

        {/* Environment Panel (Pinned at top) */}
        {showEnvPanel && (
          <div className="sidebar-env-container">
            <div className="sidebar-env-content no-scrollbar">
              <EnvironmentPanel
                environments={environments}
                onChange={handleEnvChange}
                onDeleteRequest={(id: string, name: string) => setConfirmDelete({ type: 'environment', id, name })}
                onApplyToAllTabs={applyEnvToAllTabs}
              />
            </div>
          </div>
        )}

        <nav className="sidebar-nav">
          {/* History Panel */}
          {showHistoryPanel && (
            <>
              <HistoryPanel
                history={history}
                onOpenRequest={(req) => openRequestTab(req, true)}
                onClear={clearHistory}
              />
              <div className="sidebar-divider" />
            </>
          )}

          {/* Collections Panel */}
          <CollectionPanel
            collections={collections}
            onRefresh={loadCollections}
            onOpenRequest={(req) => openRequestTab(req, false)}
            onRenameRequest={handleRenameRequest}
            onEditVariables={setEditingCollection}
            onDeleteRequest={(collId, reqId, name) => setConfirmDelete({ type: 'request', id: reqId, name, collectionId: collId })}
            onDeleteFolder={(collId, folderId, folderName) => setConfirmDelete({ type: 'folder', id: folderId, name: folderName, collectionId: collId })}
            onDeleteCollection={(id, name) => setConfirmDelete({ type: 'collection', id, name })}
            onMoveCollection={handleMoveCollection}
            onCloneCollection={handleCloneCollection}
            onCloneRequest={handleCloneRequest}
          />
        </nav>

      </aside>

      <div 
        className={`sidebar-resizer ${isResizing ? 'resizing' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); setIsResizing(true) }}
      />

      {/* ===== MAIN ===== */}
      <main className="main-content">
        {/* Tab bar */}
        <header className="title-bar" style={{ padding: '0', background: 'var(--bg-secondary)' }}>
          <Reorder.Group 
            axis="x" 
            values={tabs} 
            onReorder={setTabs} 
            className="tab-bar no-scrollbar"
            as="div"
          >
            {tabs.map(tab => (
              <Reorder.Item
                key={tab.id}
                value={tab}
                id={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`tab-item ${activeTabId === tab.id ? 'tab-active' : ''}`}
                as="div"
              >
                <span className="tab-method" style={{ color: methodColor(tab.request.type === 'GRPC' ? 'GRPC' : tab.request.method) }}>
                  {tab.request.type === 'GRPC' ? 'gRPC' : tab.request.method}
                </span>
                
                <span 
                  className="tab-title" 
                  style={{ color: tab.isDirty ? 'var(--danger)' : 'var(--text-primary)' }}
                >
                  {tab.request.name || tab.request.url || 'Untitled'}
                  {tab.isDirty ? '*' : ''}
                </span>
                
                <button className="tab-close" onClick={(e) => removeTab(e, tab.id)}>
                  <X size={12} />
                </button>
                {activeTabId === tab.id && (
                  <motion.div layoutId="activeTab" className="tab-indicator" />
                )}
              </Reorder.Item>
            ))}
            <button className="tab-add" onClick={() => addEmptyTab()}>
              <Plus size={16} />
            </button>
          </Reorder.Group>
        </header>

        {/* Content */}
        <section className={`request-section ${threeColumnLayout ? 'three-column' : ''}`}>
          <div 
            className="request-top-pane" 
            style={threeColumnLayout ? { width: `${requestPanelWidth}px`, height: '100%' } : { height: `${requestPanelHeight}px` }}
          >
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

                {(() => {
                  const isTypeLocked = !!activeRequestCollection || !!responses[activeTabId];
                  if (isTypeLocked) return null;

                  return (
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
                  );
                })()}

                <InterpolatedInput
                  className="address-input"
                  placeholder={activeRequest.type === 'GRPC' ? 'host:port (e.g. api.example.com:443)' : 'https://api.example.com/endpoint'}
                  value={activeRequest.url}
                  onChange={(val) => updateActiveRequest({ url: val })}
                  onKeyDown={(e) => e.key === 'Enter' && sendRequest()}
                  activeEnv={activeEnv}
                  collectionVariables={activeRequestCollection?.variables}
                  theme={theme}
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

              </div>

              {/* Active env selector */}
              {environments.length > 0 && (
                <div className="env-selector-wrapper">
                  <Globe size={12} className="env-selector-icon" />
                  <select
                    className="env-selector"
                    value={activeRequest.envId !== undefined ? (activeRequest.envId || '') : (activeEnvId || '')}
                    onChange={(e) => {
                      const val = e.target.value;
                      const newId = val === '' ? null : val;
                      updateActiveRequest({ envId: newId });
                    }}
                  >
                    <option value="">No Environment</option>
                    {environments.map(env => (
                      <option key={env.id} value={env.id}>{env.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* gRPC-specific fields at the top of the request pane (fixed) */}
              {activeRequest.type === 'GRPC' && (
                (() => {
                  const isLocked = !!responses[activeTabId];
                  return (
                    <div className="grpc-fields" style={{ padding: '4px 16px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                      <div className="grpc-field-row" id="grpc-service-row">
                        <label className="grpc-label">Service</label>
                        <InterpolatedInput
                          className="grpc-input"
                          placeholder="Use Discover below, or type e.g. mypackage.MyService"
                          value={activeRequest.grpcService || ''}
                          onChange={(val) => updateActiveRequest({ grpcService: val })}
                          activeEnv={activeEnv}
                          collectionVariables={activeRequestCollection?.variables}
                          disabled={isLocked}
                          theme={theme}
                        />
                      </div>
                      <div className="grpc-field-row" id="grpc-method-row">
                        <label className="grpc-label">Method</label>
                        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                          <InterpolatedInput
                            className="grpc-input"
                            style={{ flex: 1 }}
                            placeholder="e.g. GetUser"
                            value={activeRequest.grpcMethod || ''}
                            onChange={(val) => updateActiveRequest({ grpcMethod: val })}
                            activeEnv={activeEnv}
                            collectionVariables={activeRequestCollection?.variables}
                            disabled={isLocked}
                            theme={theme}
                          />
                          <button 
                            type="button"
                            className="btn-primary"
                            disabled={isLocked}
                            onClick={() => {
                              setGrpcDiscoveryUrl(activeRequest.url)
                              setShowGrpcDiscovery(true)
                            }}
                            style={{ padding: '0 12px', whiteSpace: 'nowrap' }}
                            title="Discover Services"
                          >
                            <Search size={14} style={{ marginRight: '6px' }} /> Discover
                          </button>
                        </div>
                      </div>
                      <div className="grpc-field-row" id="grpc-proto-row">
                        <label className="grpc-label">Proto Path</label>
                        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                          <InterpolatedInput
                            className="grpc-input"
                            style={{ flex: 1 }}
                            placeholder="Optional: /path/to/service.proto"
                            value={activeRequest.protoPath || ''}
                            onChange={(val) => updateActiveRequest({ protoPath: val })}
                            activeEnv={activeEnv}
                            collectionVariables={activeRequestCollection?.variables}
                            disabled={isLocked}
                            theme={theme}
                          />
                          <button 
                            type="button"
                            className="btn-ghost"
                            disabled={isLocked}
                            onClick={async (e) => {
                              e.preventDefault()
                              if (!window.ultraRpc) return
                              const res = await window.ultraRpc.pickFile()
                              console.log("pickFile app result:", res)
                              if (res.success && res.path) {
                                updateActiveRequest({ protoPath: res.path })
                              }
                            }}
                            style={{ padding: '0 12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}
                            title="Pick Proto File"
                          >
                            <FolderOpen size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()
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
                    {ct.key === 'pre-request' && activeRequest.preRequestScript && (
                      <span className="config-tab-badge-dot" />
                    )}
                    {ct.key === 'post-response' && activeRequest.postResponseScript && (
                      <span className="config-tab-badge-dot" />
                    )}
                  </button>
                ))}
              </div>

              {/* ==== Scrollable Config Content ==== */}
                <div className="request-pane-content no-scrollbar" style={{ display: 'flex', flexDirection: 'column' }}>
                  {/* gRPC discovery in a modal */}
                  {activeRequest.type === 'GRPC' && showGrpcDiscovery && (
                    <div className="modal-overlay" onClick={() => setShowGrpcDiscovery(false)}>
                      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '800px', height: '85vh', display: 'flex', flexDirection: 'column' }}>
                        <div className="modal-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px' }}>
                          <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3>gRPC Service Discovery</h3>
                            <button className="btn-ghost" onClick={() => setShowGrpcDiscovery(false)} style={{ padding: '4px' }}>
                              <X size={20} />
                            </button>
                          </div>
                          <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Host</label>
                            <input 
                              type="text" 
                              className="address-input" 
                              style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: '6px', fontSize: '13px' }}
                              value={grpcDiscoveryUrl}
                              onChange={(e) => setGrpcDiscoveryUrl(e.target.value)}
                              placeholder="host:port (e.g. api.example.com:443)"
                            />
                          </div>
                        </div>
                        <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                          <GrpcReflectionPanel
                            host={interpolate(grpcDiscoveryUrl)}
                            insecure={(() => {
                              const effectiveEnvId = activeRequest.envId || activeEnvId
                              const currentEnv = environments.find(e => e.id === effectiveEnvId)
                              return currentEnv?.sslVerification === false
                            })()}
                            headers={(() => {
                              const h: Record<string, string> = {}
                              activeRequest.headers.filter(hdr => hdr.enabled && hdr.key).forEach(hdr => {
                                h[interpolate(hdr.key)] = interpolate(hdr.value)
                              })
                              return h
                            })()}
                            protoPath={interpolate(activeRequest.protoPath || '')}
                            grpcReflection={activeRequest.grpcReflection !== false}
                            onSelectService={(svc) => updateActiveRequest({ grpcService: svc })}
                            onSelectMethod={(svc, method, sampleBody) => {
                              updateActiveRequest({
                                url: grpcDiscoveryUrl,
                                grpcService: svc,
                                grpcMethod: method,
                                grpcPayload: sampleBody || '{}',
                                bodyType: 'json',
                              })
                              setActiveConfigTab('body')
                              setShowGrpcDiscovery(false)
                            }}
                            onProtoPathChange={(path) => updateActiveRequest({ protoPath: path })}
                            onGrpcReflectionChange={(useReflection) => updateActiveRequest({ grpcReflection: useReflection })}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="config-content">
                  {activeConfigTab === 'params' && (
                      <KeyValueEditor
                        pairs={activeRequest.params}
                        onChange={(params) => updateActiveRequest({ params })}
                        keyPlaceholder="Parameter"
                        valuePlaceholder="Value"
                        activeEnv={activeEnv}
                        collectionVariables={activeRequestCollection?.variables}
                        theme={theme}
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
                        theme={theme}
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
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                          <button
                            className="btn-ghost"
                            style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => bodyEditorRef.current?.openSearch()}
                            title="Search in editor (⌘F)"
                          >
                            <Search size={14} /> Search
                          </button>
                          {(activeRequest.bodyType === 'json' || activeRequest.type === 'GRPC') && (
                            <button 
                              className="btn-ghost"
                              style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                              onClick={handleFormatJson}
                              title="Standardize JSON indentation"
                            >
                              <AlignLeft size={14} /> Format
                            </button>
                          )}
                          <button 
                            className={`btn-ghost ${wrapLines ? 'env-toggle-active' : ''}`}
                            style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => setWrapLines(!wrapLines)}
                            title="Toggle Line Wrap"
                          >
                            <WrapText size={14} /> Wrap
                          </button>
                        </div>
                      </div>
                      {activeRequest.bodyType !== 'none' && (
                        <InterpolatedInput
                          ref={bodyEditorRef}
                          className="body-textarea"
                          multiline
                          activeEnv={activeEnv}
                          wrapLines={wrapLines}
                          collectionVariables={activeRequestCollection?.variables}
                          enableSearch
                          placeholder={activeRequest.type === 'GRPC'
                            ? '{\n  "field": "value"\n}'
                            : activeRequest.bodyType === 'json'
                            ? '{\n  "key": "value"\n}'
                            : 'Plain text body...'}
                          value={activeRequest.type === 'GRPC' ? (activeRequest.grpcPayload || '') : (activeRequest.body || '')}
                          highlightJson={activeRequest.bodyType === 'json'}
                          onChange={(val) => {
                            if (activeRequest.type === 'GRPC') {
                              updateActiveRequest({ grpcPayload: val })
                            } else {
                              updateActiveRequest({ body: val })
                            }
                          }}
                          theme={theme}
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
                  {activeConfigTab === 'pre-request' && (
                    <div className="script-section" style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', height: '100%' }}>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                          Pre-request Script (JavaScript)
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            Run code before the request is sent. Access <code>ultra.env</code> or <code>ultra.collection</code> to update variables.
                          </p>
                          <button 
                            className={`btn-ghost ${wrapLines ? 'env-toggle-active' : ''}`}
                            style={{ padding: '4px 8px', fontSize: '11px', flexShrink: 0 }}
                            onClick={() => setWrapLines(!wrapLines)}
                            title="Toggle Line Wrap"
                          >
                            <WrapText size={14} />
                          </button>
                        </div>
                      </div>
                      <div style={{ flex: 1, minHeight: '150px' }}>
                        <InterpolatedInput
                            multiline
                            className="script-editor"
                            placeholder="// code here...&#10;ultra.env.set('timestamp', Date.now().toString());"
                            value={activeRequest.preRequestScript || ''}
                            onChange={val => updateActiveRequest({ preRequestScript: val })}
                            activeEnv={activeEnv}
                            highlightJs={true}
                            wrapLines={wrapLines}
                            collectionVariables={activeRequestCollection?.variables}
                            theme={theme}
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
                              <div key={i} className={`console-log-entry ${log.includes('ERROR') ? 'console-log-entry-error' : ''}`}>
                                {log}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeConfigTab === 'post-response' && (
                    <div className="script-section" style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', height: '100%' }}>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                          Post-Response Script (JavaScript)
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            Run code after a successful response. Access <code>ultra.response</code> and update variables with <code>ultra.setCollectionVariable(key, value)</code>.
                          </p>
                          <button 
                            className={`btn-ghost ${wrapLines ? 'env-toggle-active' : ''}`}
                            style={{ padding: '4px 8px', fontSize: '11px', flexShrink: 0 }}
                            onClick={() => setWrapLines(!wrapLines)}
                            title="Toggle Line Wrap"
                          >
                            <WrapText size={14} />
                          </button>
                        </div>
                      </div>
                      <div style={{ flex: 1, minHeight: '150px' }}>
                        <InterpolatedInput
                            multiline
                            className="script-editor"
                            placeholder="// code here...&#10;if (ultra.response.body.token) {&#10;  ultra.setCollectionVariable('auth_token', ultra.response.body.token);&#10;}"
                            value={activeRequest.postResponseScript || ''}
                            onChange={val => updateActiveRequest({ postResponseScript: val })}
                            activeEnv={activeEnv}
                            highlightJs={true}
                            wrapLines={wrapLines}
                            collectionVariables={activeRequestCollection?.variables}
                            theme={theme}
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
                              <div key={i} className={`console-log-entry ${log.includes('ERROR') ? 'console-log-entry-error' : ''}`}>
                                {log}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </motion.div>
          </div>

          {threeColumnLayout ? (
            <div 
              className={`v-resizer ${isResizingVertical ? 'resizing' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); setIsResizingVertical(true) }}
            />
          ) : (
            <div 
              className={`h-resizer ${isResizingResponse ? 'resizing' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); setIsResizingResponse(true) }}
            />
          )}

          <div className="request-bottom-pane" style={threeColumnLayout ? { flex: 1, height: '100%' } : {}}>
            <h3 className="section-label">Response</h3>
            <ResponseViewer 
              response={responses[activeTabId] || null} 
              error={errors[activeTabId] || null}
              scriptError={scriptErrors[activeTabId] || null}
              loading={loadingTabs[activeTabId] || false}
              theme={theme}
            />
          </div>
        </section>
      </main>

      <AboutModal 
        isOpen={showAboutModal} 
        onClose={() => setShowAboutModal(false)} 
        version={pkg.version}
      />

      {/* Collection Variables Modal */}
      {editingCollection && (
        <div className="modal-overlay" onClick={() => setEditingCollection(null)}>
          <motion.div 
            className="modal-content glass"
            style={{ maxWidth: '1100px' }}
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
                theme={theme}
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
      <AboutModal 
        isOpen={showAboutModal} 
        onClose={() => setShowAboutModal(false)} 
        version={pkg.version}
      />

      {/* Save Request Modal */}
      {showSaveMenu && (
        <div className="modal-overlay" onClick={() => setShowSaveMenu(false)}>
          <motion.div 
            className="modal-content glass" 
            style={{ maxWidth: '400px' }}
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
          >
            <div className="modal-header">
              <h3>Save Request</h3>
              <button className="btn-ghost" onClick={() => setShowSaveMenu(false)} style={{ padding: '4px' }}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Request Name
                </label>
                <input 
                  type="text"
                  className="modal-input"
                  value={saveModalRequestName}
                  onChange={(e) => setSaveModalRequestName(e.target.value)}
                  placeholder="e.g. Get User Profile"
                  style={{
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  autoFocus
                />
              </div>

              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                Select a collection to save this request to:
              </p>
              
              <div className="collection-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {collections.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                    No collections found. Create a collection first in the sidebar.
                  </div>
                ) : (
                  collections.map(c => (
                    <div 
                      key={c.id}
                      className={`collection-modal-item ${selectedCollectionId === c.id ? 'active' : ''}`}
                      onClick={() => setSelectedCollectionId(c.id)}
                      style={{
                        padding: '10px 12px',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        marginBottom: '4px',
                        background: selectedCollectionId === c.id ? 'var(--accent-muted)' : 'transparent',
                        border: '1px solid',
                        borderColor: selectedCollectionId === c.id ? 'var(--accent)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        color: 'var(--text-primary)',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ 
                        width: '16px', 
                        height: '16px', 
                        borderRadius: '50%', 
                        border: '2px solid var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        {selectedCollectionId === c.id && (
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} />
                        )}
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: selectedCollectionId === c.id ? 600 : 400 }}>
                        {c.name}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
              <button 
                className="btn-ghost" 
                onClick={() => setShowSaveMenu(false)}
                style={{ padding: '8px 16px' }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={!selectedCollectionId || !saveModalRequestName.trim()}
                onClick={async () => {
                  if (activeRequest && selectedCollectionId) {
                    const updatedRequest = { ...activeRequest, name: saveModalRequestName.trim() }
                    await window.ultraRpc?.saveRequest({ collectionId: selectedCollectionId, request: updatedRequest })
                    setTabs(prev => prev.map(t =>
                      t.id === activeTabId ? { ...t, request: updatedRequest, isDirty: false, owningCollectionId: selectedCollectionId } : t
                    ))
                    loadCollections()
                    setShowSaveMenu(false)
                  }
                }}
                style={{ padding: '8px 24px' }}
              >
                OK
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <motion.div 
            className="modal-content glass" 
            style={{ maxWidth: '400px' }}
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
          >
            <div className="modal-header">
              <h3>Confirm Delete</h3>
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)} style={{ padding: '4px' }}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              <p style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '8px' }}>
                Are you sure you want to delete this {confirmDelete.type}?
              </p>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                <strong>{confirmDelete.name}</strong>
              </p>
              {confirmDelete.type === 'collection' && (
                <p style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Info size={12} /> This will also delete all requests inside this collection.
                </p>
              )}
              {confirmDelete.type === 'folder' && (
                <p style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Info size={12} /> This will also delete all requests inside this folder.
                </p>
              )}
            </div>
            
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
              <button 
                className="btn-ghost" 
                onClick={() => setConfirmDelete(null)}
                style={{ padding: '8px 16px' }}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                style={{ background: 'var(--danger)', borderColor: 'var(--danger)', padding: '8px 24px' }}
                onClick={async () => {
                  const rpc = window.ultraRpc
                  let tabsToClose: string[] = []

                  if (confirmDelete.type === 'collection' && rpc) {
                    await rpc.deleteCollection({ collectionId: confirmDelete.id })
                    tabsToClose = tabs.filter(t => t.owningCollectionId === confirmDelete.id).map(t => t.id)
                  } else if (confirmDelete.type === 'request' && confirmDelete.collectionId && rpc) {
                    await rpc.deleteRequest({ collectionId: confirmDelete.collectionId, requestId: confirmDelete.id })
                    tabsToClose = [confirmDelete.id]
                  } else if (confirmDelete.type === 'folder' && confirmDelete.collectionId && rpc) {
                    await rpc.deleteFolder({ collectionId: confirmDelete.collectionId, folderId: confirmDelete.id })
                    // Recursively finding all requests in a folder is hard here, 
                    // but we can at least close the ones that have this folder in their path if we had it.
                    // For now, let's just refresh and see.
                    // Actually, let's at least close requests whose owningCollectionId matches.
                    // But we don't have folder info in tabs easily.
                  } else if (confirmDelete.type === 'environment') {
                    const newEnvs = environments.filter(e => e.id !== confirmDelete.id)
                    setEnvironments(newEnvs)
                    if (rpc) await rpc.saveEnvironments(newEnvs)
                    if (activeEnvId === confirmDelete.id) setActiveEnvId(null)
                  }

                  if (tabsToClose.length > 0) {
                    setTabs(prev => {
                      const remaining = prev.filter(t => !tabsToClose.includes(t.id))
                      if (remaining.length === 0) {
                        const newReq = createEmptyRequest()
                        const newTab = { id: newReq.id, request: newReq }
                        setActiveTabId(newTab.id)
                        return [newTab]
                      }
                      if (tabsToClose.includes(activeTabId)) {
                        setActiveTabId(remaining[0].id)
                      }
                      return remaining
                    })
                  }

                  setConfirmDelete(null)
                  if (rpc) loadCollections()
                }}
              >
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
      <Toaster />
    </div>
  )
}

export default App
