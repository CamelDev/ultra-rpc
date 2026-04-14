import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Plus, Send, Save, Settings, Globe, Braces, X, Loader2,
  Info, FolderOpen,
  Search,
  WrapText, AlertTriangle, ShieldCheck, Hourglass, AlignLeft, Folder, Code,
  GitBranch, Sparkles, Target, Layers, ChevronRight, ChevronDown
} from 'lucide-react'
import { motion, Reorder } from 'framer-motion'
import { useScriptValidation } from './hooks/useScriptValidation'
import ValidationBanner from './components/ValidationBanner'
import KeyValueEditor from './components/KeyValueEditor'
import InterpolatedInput from './components/InterpolatedInput'
import type { EditorHandle } from './components/Editor'
import ResponseViewer from './components/ResponseViewer'
import EnvironmentPanel from './components/EnvironmentPanel'
import CollectionPanel, { type CollectionPanelHandle } from './components/CollectionPanel'
import HistoryPanel from './components/HistoryPanel'
import GrpcReflectionPanel from './components/GrpcReflectionPanel'
import AboutModal from './components/AboutModal'
import AiInfoModal from './components/AiInfoModal'
import LibraryModal from './components/LibraryModal'
import { FlowCanvas } from './components/FlowCanvas'
import FlowPanel from './components/FlowPanel'
import type { FlowDefinition } from './types/flow'
import type { Tab, TabGroup, RequestConfig, ResponseData, Environment, Collection, CollectionItem, VaultEntry, Library } from './types'
import TabGroupsModal from './components/TabGroupsModal'
import { createEmptyRequest } from './lib/helpers'
import IntroPage from './components/IntroPage'
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
  const [tabs, setTabsState] = useState<Tab[]>(() => {
    const saved = localStorage.getItem('ultraRpcTabs')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      } catch (e) {
        console.error('Failed to restore tabs:', e)
      }
    }
    if (window.ultraRpc?.isTest) {
      const emptyReq = createEmptyRequest()
      // Use a stable ID in test mode for the initial tab so activeTabId can find it
      emptyReq.id = 'test-tab-initial'
      return [{ id: emptyReq.id, type: 'request', request: emptyReq, isDirty: false }]
    }
    return [] // Start with no tabs, showing intro page in background
  })
  const tabsRef = useRef<Tab[]>(tabs)
  const collectionPanelRef = useRef<CollectionPanelHandle>(null)
  const setTabs = useCallback((updater: React.SetStateAction<Tab[]>) => {
    const next = typeof updater === 'function'
      ? (updater as any)(tabsRef.current)
      : updater

    tabsRef.current = next
    setTabsState(next)
  }, [])

  const [activeTabId, setActiveTabIdState] = useState<string>(() => {
    const savedId = localStorage.getItem('ultraRpcActiveTabId')
    const savedTabs = localStorage.getItem('ultraRpcTabs')
    if (savedId && savedTabs) {
      try {
        const parsed = JSON.parse(savedTabs)
        if (Array.isArray(parsed) && parsed.some((t: any) => t.id === savedId)) {
          return savedId
        }
      } catch { }
    }
    // Fallback to first tab if active id not found or invalid
    const saved = localStorage.getItem('ultraRpcTabs')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id
      } catch { }
    }
    if (window.ultraRpc?.isTest) return 'test-tab-initial'
    return '' // No active tab
  })
  const activeTabIdRef = useRef<string>(activeTabId)
  const setActiveTabId = useCallback((id: string) => {
    setActiveTabIdState(id)
    activeTabIdRef.current = id
  }, [])



  // ===== Per-tab response state =====
  const [responses, setResponses] = useState<Record<string, ResponseData | null>>({})
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [loadingTabs, setLoadingTabs] = useState<Record<string, boolean>>({})
  const [scriptLogs, setScriptLogs] = useState<Record<string, string[]>>({})
  const [scriptErrors, setScriptErrors] = useState<Record<string, string | null>>({})

  // ===== UI state =====
  const [showEnvPanel, setShowEnvPanel] = useState(false)
  const [showHistoryPanel, setShowHistoryPanel] = useState(() => localStorage.getItem('ultraRpcShowHistory') === 'true')
  const [showFlowPanel, setShowFlowPanel] = useState(() => localStorage.getItem('ultraRpcShowFlowPanel') === 'true')
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const [saveModalRequestName, setSaveModalRequestName] = useState('')
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'collection' | 'request' | 'folder' | 'environment' | 'flow', id: string, name: string, collectionId?: string } | null>(null)
  const [deleteCollectionFiles, setDeleteCollectionFiles] = useState(false)
  const [showSettingsPopup, setShowSettingsPopup] = useState(false)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [showAiInfoModal, setShowAiInfoModal] = useState(false)

  // ===== Tab Groups =====
  const [tabGroups, setTabGroups] = useState<TabGroup[]>(() => {
    try {
      const saved = localStorage.getItem('ultraRpcTabGroups')
      if (saved) return JSON.parse(saved)
    } catch { }
    return []
  })
  const [showTabGroupsModal, setShowTabGroupsModal] = useState(false)
  // Context menu state for tab right-click grouping
  const [tabContextMenu, setTabContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  // Inline rename state — which group header is being edited
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)

  // ===== Environments =====
  const [collections, setCollectionsState] = useState<Collection[]>([])
  const collectionsRef = useRef<Collection[]>([])
  const setCollections = useCallback((updater: React.SetStateAction<Collection[]>) => {
    if (typeof updater === 'function') {
      setCollectionsState(prev => {
        const next = updater(prev)
        collectionsRef.current = next
        return next
      })
    } else {
      collectionsRef.current = updater
      setCollectionsState(updater)
    }
  }, [])

  const [environments, setEnvironmentsState] = useState<Environment[]>([])
  const environmentsRef = useRef<Environment[]>([])
  const setEnvironments = useCallback((updater: React.SetStateAction<Environment[]>) => {
    if (typeof updater === 'function') {
      setEnvironmentsState(prev => {
        const next = updater(prev)
        environmentsRef.current = next
        return next
      })
    } else {
      environmentsRef.current = updater
      setEnvironmentsState(updater)
    }
  }, [])


  const [libraries, setLibrariesState] = useState<Library[]>([])
  const librariesRef = useRef<Library[]>([])
  const setLibraries = useCallback((updater: React.SetStateAction<Library[]>) => {
    if (typeof updater === 'function') {
      setLibrariesState(prev => {
        const next = updater(prev)
        librariesRef.current = next
        return next
      })
    } else {
      librariesRef.current = updater
      setLibrariesState(updater)
    }
  }, [])
  const [showLibraryModal, setShowLibraryModal] = useState(false)
  const [initialLibraryId, setInitialLibraryId] = useState<string | null>(null)
  const [libraryMethodMap, setLibraryMethodMap] = useState<Record<string, string>>({})

  const [activeEnvId, setActiveEnvIdState] = useState<string | null>(null)
  const activeEnvIdRef = useRef<string | null>(null)
  const setActiveEnvId = useCallback((id: string | null) => {
    setActiveEnvIdState(id)
    activeEnvIdRef.current = id
  }, [])
  const [vaults, setVaults] = useState<Record<string, VaultEntry[]>>({})
  const vaultsRef = useRef(vaults)
  useEffect(() => { vaultsRef.current = vaults }, [vaults])
  const [vaultAvailable, setVaultAvailable] = useState(true)

  // ===== Settings & Theme =====
  const [theme, setTheme] = useState<'dark' | 'light' | 'auto'>('dark')
  const [systemThemeSync, setSystemThemeSync] = useState<'dark' | 'light'>('dark')
  const resolvedTheme = theme === 'auto' ? systemThemeSync : theme

  const preRequestValidation = useScriptValidation()
  const postResponseValidation = useScriptValidation()
  const [wrapLines, setWrapLines] = useState(true)
  const bodyEditorRef = useRef<EditorHandle>(null)
  const preRequestEditorRef = useRef<EditorHandle>(null)
  const postResponseEditorRef = useRef<EditorHandle>(null)
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null)
  
  const [showSaveFlowModal, setShowSaveFlowModal] = useState(false)
  const [saveFlowModalName, setSaveFlowModalName] = useState('New Flow')
  const [saveFlowModalPath, setSaveFlowModalPath] = useState('')
  const [flowToClone, setFlowToClone] = useState<FlowDefinition | null>(null)
  const [flows, setFlows] = useState<{ flow: FlowDefinition; collectionId?: string; collectionName?: string; path: string }[]>([])

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
    for (const coll of collectionsRef.current) {
      const requests = getAllRequests(coll)
      if (requests.some(r => r.id === requestId)) return coll
    }
    return null
  }, [getAllRequests])

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
  const [mcpEnabled, setMcpEnabled] = useState(false)
  const [mcpPort, setMcpPort] = useState(3000)
  const [isResizingResponse, setIsResizingResponse] = useState(false)
  const [isResizingVertical, setIsResizingVertical] = useState(false)
  const [showGrpcDiscovery, setShowGrpcDiscovery] = useState(false)
  const [grpcDiscoveryUrl, setGrpcDiscoveryUrl] = useState('')
  const [libraryModalWidth, setLibraryModalWidth] = useState(() => {
    const saved = localStorage.getItem('ultraRpcLibraryModalWidth')
    return saved ? parseInt(saved, 10) : 1100
  })
  const [libraryModalHeight, setLibraryModalHeight] = useState(() => {
    const saved = localStorage.getItem('ultraRpcLibraryModalHeight')
    return saved ? parseInt(saved, 10) : 760
  })

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

  useEffect(() => {
    const scanLibraries = async () => {
      const map: Record<string, string> = {}
      for (const lib of libraries) {
        if (!lib.enabled) continue
        const res = await window.ultraRpc?.readFileContents(lib.filePath)
        if (res?.success && res.content) {
          // Match assignments: ultra.lib.methodName = ...
          const regex = /ultra\.lib\.([a-zA-Z0-9_]+)\s*=/g
          let match
          while ((match = regex.exec(res.content)) !== null) {
            map[match[1]] = lib.id
          }
        }
      }
      setLibraryMethodMap(map)
    }
    scanLibraries()
  }, [libraries])

  const handleFollowDefinition = useCallback((methodName: string) => {
    const libId = libraryMethodMap[methodName]
    if (libId) {
      setInitialLibraryId(libId)
      setShowLibraryModal(true)
    }
  }, [libraryMethodMap])

  const resetLayout = () => {
    localStorage.removeItem('ultraRpcSidebarWidth')
    localStorage.removeItem('ultraRpcRequestHeight')
    localStorage.removeItem('ultraRpcRequestWidth')
    setSidebarWidth(300)
    setRequestPanelHeight(380)
    setRequestPanelWidth(600)
    setShowSettingsPopup(false)
  }

  const handleLibraryModalResize = (width: number, height: number) => {
    setLibraryModalWidth(width)
    setLibraryModalHeight(height)
    localStorage.setItem('ultraRpcLibraryModalWidth', width.toString())
    localStorage.setItem('ultraRpcLibraryModalHeight', height.toString())
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

  // Persist tab groups
  useEffect(() => {
    localStorage.setItem('ultraRpcTabGroups', JSON.stringify(tabGroups))
  }, [tabGroups])

  useEffect(() => {
    if (tabs.length === 0 && window.ultraRpc?.isTest) {
      const emptyReq = createEmptyRequest()
      emptyReq.id = 'test-tab-initial'
      setTabs([{ id: emptyReq.id, type: 'request', request: emptyReq, isDirty: false }])
      setActiveTabId('test-tab-initial')
    }
  }, [tabs.length])

  // Removed stale tabsRef update useEffect

  // Removed useEffect that was resetting activeConfigTab on every activeTabId change.
  // This was breaking persistence and causing E2E failures.

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
            const emptyReq = createEmptyRequest()
            tabsToKeep.push({
              id: emptyReq.id,
              type: 'request',
              request: emptyReq,
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
    if (resolvedTheme === 'light') {
      document.body.classList.add('light-theme')
    } else {
      document.body.classList.remove('light-theme')
    }
  }, [resolvedTheme])

  // Theme Sync from Electron
  useEffect(() => {
    if (!window.ultraRpc) return

    // Initial sync
    window.ultraRpc.getShouldUseDark().then(isDark => {
      setSystemThemeSync(isDark ? 'dark' : 'light')
    })

    const unsubscribe = window.ultraRpc.onThemeUpdated((isDark) => {
      setSystemThemeSync(isDark ? 'dark' : 'light')
    })
    return unsubscribe
  }, [])


  // Push theme source to Electron
  useEffect(() => {
    if (window.ultraRpc) {
      window.ultraRpc.setThemeSource(theme === 'auto' ? 'system' : theme)
    }
  }, [theme])

  const loadFlows = useCallback(async () => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.listFlows()
    if (res.success && res.flows) {
      setFlows(res.flows)
    }
  }, [])

  const loadCollections = useCallback(async () => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.listCollections()
    if (res.success && res.collections) {
      setCollections(res.collections)
      if (res.warnings && res.warnings.length > 0) {
        res.warnings.forEach(w => addToast({ type: 'warning', message: w }))
      }
      loadFlows()
    }
  }, [addToast, setCollections, loadFlows])

  const loadEnvironments = useCallback(async () => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.getEnvironments()
    if (res.success && res.environments) {
      setEnvironments(res.environments)
      // Load vaults for each environment
      const vaultEntries = await Promise.all(
        res.environments.map((e: any) => window.ultraRpc.getVault({ envId: e.id }))
      )
      const vaultMap: Record<string, VaultEntry[]> = {}
      res.environments.forEach((e: any, i: number) => {
        vaultMap[e.id] = vaultEntries[i].entries ?? []
      })
      setVaults(vaultMap)
      vaultsRef.current = vaultMap
    }
  }, [setEnvironments, setVaults])

  // MCP action — refresh collections panel, show toast, play sound
  useEffect(() => {
    if (!window.ultraRpc?.onMcpAction) return

    const ACTION_LABELS: Record<string, string> = {
      create_collection:   '📁 Collection created',
      add_rest_request:    '➕ REST request added',
      update_rest_request: '✏️ REST request updated',
      add_grpc_request:    '➕ gRPC request added',
      update_grpc_request: '✏️ gRPC request updated',
      add_flow:            '🌊 Flow added',
      update_flow:         '✏️ Flow updated',
    }

    const playMcpChime = () => {
      try {
        const ctx = new AudioContext()
        // Brief ascending two-note chime: C5 → E5
        const notes = [523.25, 659.25]
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.type = 'sine'
          osc.frequency.value = freq
          const startAt = ctx.currentTime + i * 0.12
          gain.gain.setValueAtTime(0, startAt)
          gain.gain.linearRampToValueAtTime(0.18, startAt + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.22)
          osc.start(startAt)
          osc.stop(startAt + 0.25)
        })
        setTimeout(() => ctx.close(), 800)
      } catch {
        // AudioContext unavailable — silent fallback
      }
    }

    const unsubscribeMcp = window.ultraRpc.onMcpAction((event) => {
      // 1. Refresh relevant panel
      if (event.action.includes('collection') || event.action.includes('request')) {
        loadCollections()
      } else if (event.action.includes('environment')) {
        loadEnvironments()
      }

      // 2. Toast
      const label = ACTION_LABELS[event.action] ?? 'AI action executed'
      addToast({
        type: 'success',
        message: `${label}: "${event.name}"`,
        duration: 5000,
      })

      // 3. Sound
      playMcpChime()
    })

    return unsubscribeMcp
  }, [loadCollections, loadEnvironments, addToast])

  const handleMoveCollection = useCallback(async (collectionId: string, currentPath?: string) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.moveCollection({ collectionId, currentPath })
    if (res.success) {
      addToast({ type: 'success', message: 'Collection moved successfully' })
      setCollections(prev => prev.filter(c => c.id !== collectionId)) // Optimistic update
      // Reload to get the full updated structure and ensure consistency
      loadCollections()
    } else if (res.error !== 'Cancelled') {
      addToast({ type: 'error', message: res.error || 'Failed to move collection' })
    }
  }, [loadCollections, setCollections])

  const handleCloneCollection = useCallback(async (collectionId: string) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.cloneCollection({ collectionId })
    if (res.success) {
      addToast({ type: 'success', message: 'Collection cloned successfully' })
      window.ultraRpc.listCollections().then(res => { if (res.success && res.collections) setCollections(res.collections) })
    } else {
      addToast({ type: 'error', message: res.error || 'Failed to clone collection' })
    }
  }, [setCollections])

  const handleCloneRequest = useCallback(async (collectionId: string, requestId: string) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.cloneRequest({ collectionId, requestId })
    if (res.success) {
      addToast({ type: 'success', message: 'Request cloned successfully' })
      window.ultraRpc.listCollections().then(res => { if (res.success && res.collections) setCollections(res.collections) })
    } else {
      addToast({ type: 'error', message: res.error || 'Failed to clone request' })
    }
  }, [setCollections])

  const handleImportEnvironments = useCallback((envs: Environment[], vaultEntries?: Record<string, { key: string; value: string }[]>) => {
    setEnvironments(prev => {
      const merged = [...prev, ...envs]
      if (window.ultraRpc) window.ultraRpc.saveEnvironments(merged)
      return merged
    })
    if (vaultEntries && window.ultraRpc) {
      for (const [envId, entries] of Object.entries(vaultEntries)) {
        const vaultItems = entries.map((e: { key: string; value: string }) => ({
          id: Math.random().toString(36).substring(2, 11),
          key: e.key,
          value: e.value,
        }))
        setVaults(prev => ({ ...prev, [envId]: vaultItems }))
        window.ultraRpc.saveVault({ envId, entries: vaultItems })
      }
    }
  }, [setEnvironments])

  const handleRenameRequest = useCallback((reqId: string, newName: string) => {
    setTabs(prev => prev.map(t =>
      t.type === 'request' && t.id === reqId
        ? { ...t, request: { ...t.request, name: newName }, isDirty: false }
        : t
    ))
  }, [setTabs])

  const handleDeleteRequest = useCallback((collId: string, reqId: string, name: string) => {
    setConfirmDelete({ type: 'request', id: reqId, name, collectionId: collId })
  }, [])

  const handleDeleteFolder = useCallback((collId: string, folderId: string, folderName: string) => {
    setConfirmDelete({ type: 'folder', id: folderId, name: folderName, collectionId: collId })
  }, [])

  const handleDeleteCollection = useCallback((id: string, name: string) => {
    setConfirmDelete({ type: 'collection', id, name })
  }, [])

  useEffect(() => {
    if (window.ultraRpc) {
      loadCollections()
      loadFlows()
      loadEnvironments()

      window.ultraRpc.getLibraries().then(res => { if (res.success && res.libraries) setLibraries(res.libraries) })
    }
  }, [loadCollections, loadFlows, loadEnvironments, setLibraries])



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

  const handleSaveContextVariables = useCallback(async (id: string, variables: any[]) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.saveContextVariables({ collectionId: id, variables })
    if (res.success) {
      setCollections(prev => prev.map(c => c.id === id ? { ...c, variables } : c))
    }
  }, [setCollections])

  // Persist environments when they change
  const handleEnvChange = useCallback((envs: Environment[]) => {
    setEnvironments(envs)
    if (window.ultraRpc) window.ultraRpc.saveEnvironments(envs)
  }, [setEnvironments])



  const handleVaultChange = useCallback(async (envId: string, entries: VaultEntry[]) => {
    setVaults(prev => ({ ...prev, [envId]: entries }))
    if (window.ultraRpc) await window.ultraRpc.saveVault({ envId, entries })
  }, [])

  // ===== Load persisted data on mount =====
  useEffect(() => {
    if (!window.ultraRpc) return

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
        if (res.settings.mcpEnabled !== undefined) {
          setMcpEnabled(res.settings.mcpEnabled)
        }
        if (res.settings.mcpPort !== undefined) {
          setMcpPort(res.settings.mcpPort)
        }
      }
    })
    window.ultraRpc.checkVaultAvailability().then(available => {
      setVaultAvailable(available)
    })
    loadCollections()
    loadHistory()
  }, [loadHistory, loadCollections])



  // ===== Helpers =====
  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeRequest = activeTab?.type === 'request' ? activeTab.request! : createEmptyRequest()
  const activeEnv = environments.find(e => e.id === (activeTab?.envId || activeEnvId))
  const activeVaultEntries = vaults[(activeTab?.envId || activeEnvId) ?? ''] || []
  const activeRequestTab = activeTab?.type === 'request' ? activeTab : null
  const activeRequestCollection = activeRequestTab ? findCollectionByRequestId(activeRequestTab.request.id) : null

  const activeConfigTab = activeRequest?.activeConfigTab || 'params'
  const setActiveConfigTab = (tab: RequestTab) => {
    setTabs(prev =>
      prev.map(t =>
        t.id === activeTabId && t.type === 'request' ? { ...t, request: { ...t.request!, activeConfigTab: tab } } : t
      )
    )
  }

  const updateActiveRequest = useCallback((partial: Partial<RequestConfig>) => {
    setTabs(prev => {
      return prev.map(t => {
        if (t.id !== activeTabIdRef.current || t.type !== 'request') return t

        const skipDirtyKeys = ['activeConfigTab']
        const hasChanged = Object.entries(partial).some(([key, val]) => {
          const current = (t.request as any)[key]
          const isSkipped = skipDirtyKeys.includes(key)

          let changed = false
          if (typeof val === 'object' && val !== null) {
            if (Array.isArray(val) && val.length === 0 && (current === undefined || current === null || current === '')) {
              changed = false
            } else if (current === undefined || current === null) {
              changed = JSON.stringify(val) !== JSON.stringify(Array.isArray(val) ? [] : {})
            } else {
              changed = JSON.stringify(val) !== JSON.stringify(current)
            }
          } else {
            changed = (current ?? '') !== (val ?? '')
          }

          if (isSkipped) return false
          return changed
        })

        return {
          ...t,
          request: { ...t.request!, ...partial },
          isDirty: t.isDirty || hasChanged
        }
      })
    })
  }, [activeTabId])

  const updateTabEnv = useCallback((envId: string | null) => {
    setTabs(prev => {
      return prev.map(t =>
        t.id === activeTabIdRef.current ? { ...t, envId } : t
      )
    })
  }, [activeTabId])

  const applyEnvToAllTabs = useCallback((envId: string | null) => {
    setTabs(prev => {
      return prev.map(t => ({
        ...t,
        envId
      }))
    })
    setActiveEnvId(envId)
    saveAppSetting('activeEnvId', envId)
  }, [saveAppSetting])

  const addEmptyTab = () => {
    if (window.ultraRpc?.isTest) {
      const newReq = createEmptyRequest()
      const nt: Tab = { id: newReq.id, type: 'request', request: newReq, isDirty: false, envId: activeEnvId }
      setTabs(prev => [...prev, nt])
      setActiveTabId(newReq.id)
      return
    }
    const id = Math.random().toString(36).substring(2, 11)
    const newTab: Tab = { id, type: 'intro', isDirty: false, envId: activeEnvId }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(id)
  }

  const handleIntroAction = useCallback((type: 'REST' | 'GRPC', tabId: string) => {
    const newReq = createEmptyRequest()
    newReq.type = type
    if (type === 'GRPC') {
      newReq.method = 'POST' as any
      newReq.url = ''
    }

    const latestTabs = tabsRef.current
    const tabToUpdate = latestTabs.find(t => t.id === tabId)

    if (tabToUpdate) {
      setTabs(prev => prev.map(t => 
        t.id === tabId ? { ...t, type: 'request', request: newReq, isDirty: false } : t
      ))
    } else {
      const id = Math.random().toString(36).substring(2, 11)
      const newTab: Tab = { id, type: 'request', request: newReq, isDirty: false, envId: activeEnvIdRef.current }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(id)
    }
  }, [setTabs, setActiveTabId])

  const openRequestTab = useCallback((request: RequestConfig, fromHistory: boolean) => {
    const latestTabs = tabsRef.current
    if (fromHistory) {
      // Historical snapshots shouldn't overwrite the active collection model. Give them a new ID.
      const newReq = { ...request, id: Math.random().toString(36).substring(2, 11) }
      const newTab: Tab = { id: newReq.id, type: 'request', request: newReq, isDirty: false, envId: (request as any).envId || activeEnvIdRef.current }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(newReq.id)
    } else {
      // From Collection
      const existingTab = latestTabs.find(t => t.id === request.id)
      if (existingTab) {
        // Tab exactly matching this collection request is already open, just switch to it.
        setActiveTabId(request.id)
      } else {
        // It's not open, so open it, preserving its unique ID so saves overwrite it.
        const owningCollection = findCollectionByRequestId(request.id)
        const newTab: Tab = {
          id: request.id,
          type: 'request',
          request: { ...request },
          owningCollectionId: owningCollection?.id,
          isDirty: false,
          envId: (request as any).envId || activeEnvIdRef.current
        }
        setTabs(prev => [...prev, newTab])
        setActiveTabId(request.id)
      }
    }
  }, [setTabs, setActiveTabId, findCollectionByRequestId])

  const handleOpenRequestFromCollection = useCallback((req: RequestConfig) => openRequestTab(req, false), [openRequestTab])

  const handleJumpToRequest = useCallback((requestId: string) => {
    let foundRequest: RequestConfig | null = null
    const find = (items: any[]) => {
      for (const item of items) {
        if (item.type === 'request' && item.request && item.request.id === requestId) {
          foundRequest = item.request
          return true
        }
        if (item.type === 'folder' && item.children && find(item.children)) return true
      }
      return false
    }
    collectionsRef.current.forEach(c => find(c.children || []))
    
    if (foundRequest) {
      openRequestTab(foundRequest, false)
    } else {
      addToast({ type: 'error', message: 'Original request not found' })
    }
  }, [openRequestTab, addToast])


  const removeTab = (e: React.MouseEvent | null, id: string) => {
    if (e) e.stopPropagation()
    const latestTabs = tabsRef.current
    const tabToClose = latestTabs.find(t => t.id === id)
    if (tabToClose?.isDirty) {
      if (!window.confirm(`This request has unsaved changes.\nAre you sure you want to close it?`)) {
        return
      }
    }

    const newTabs = latestTabs.filter(t => t.id !== id)
    setTabs(newTabs)
    
    // If we closed the active tab, switch to the last one or clear
    if (activeTabIdRef.current === id) {
      if (newTabs.length > 0) {
        setActiveTabId(newTabs[newTabs.length - 1].id)
      } else {
        setActiveTabId('')
      }
    }
  }

  // ===== Tab Group Helpers =====
  const GROUP_COLORS = [
    '#3b82f6', '#a855f7', '#ec4899', '#ef4444', '#f97316',
    '#f59e0b', '#22c55e', '#14b8a6', '#06b6d4', '#6366f1',
  ]
  const nextGroupColor = (existingGroups: TabGroup[]) => {
    const used = new Set(existingGroups.map(g => g.color))
    for (const c of GROUP_COLORS) { if (!used.has(c)) return c }
    return GROUP_COLORS[existingGroups.length % GROUP_COLORS.length]
  }

  /**
   * Add a tab to an existing group, or create a new group with it.
   * groupId === '__new__' creates a brand-new group containing just this tab.
   */
  const addTabToGroup = (tabId: string, groupId: string) => {
    if (groupId === '__new__') {
      const newGroup: TabGroup = {
        id: Math.random().toString(36).substring(2, 11),
        name: `Group ${tabGroups.length + 1}`,
        color: nextGroupColor(tabGroups),
        isHidden: false,
        isCollapsed: false,
      }
      setTabGroups(prev => [...prev, newGroup])
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, groupId: newGroup.id } : t))
      // Immediately enter rename mode so user can name the group
      setTimeout(() => setEditingGroupId(newGroup.id), 50)
    } else {
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, groupId } : t))
    }
    setTabContextMenu(null)
  }

  const removeTabFromGroup = (tabId: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, groupId: undefined } : t))
    setTabContextMenu(null)
  }

  const handleUpdateGroup = (groupId: string, updates: Partial<TabGroup>) => {
    setTabGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...updates } : g))
  }

  const handleDeleteGroup = (groupId: string) => {
    // Ungroup all member tabs, then remove the group
    setTabs(prev => prev.map(t => t.groupId === groupId ? { ...t, groupId: undefined } : t))
    setTabGroups(prev => prev.filter(g => g.id !== groupId))
  }

  const toggleGroupCollapse = (groupId: string) => {
    setTabGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, isCollapsed: !g.isCollapsed } : g
    ))
  }

  const interpolate = (
    str: string,
    envOverride?: Environment,
    collectionsOverride?: Collection[],
    tabIdOverride?: string
  ): string => {
    if (!str) return str

    const targetTabId = tabIdOverride || activeTabId
    const currentTabs = tabsRef.current
    const targetTab = currentTabs.find(t => t.id === targetTabId)

    if (targetTab?.type === 'flow') return str // Flows don't interpolate variables

    // Find collection associated with the target request
    const currentCollections = collectionsOverride || collectionsRef.current
    const activeColl = targetTab ? currentCollections.find(c => {
      const traverse = (children: CollectionItem[]): boolean => {
        for (const item of children) {
          const reqId = targetTab.type === 'request' ? targetTab.request?.id : null
          if (item.type === 'request' && item.request?.id === reqId) return true
          if (item.type === 'folder' && item.children && traverse(item.children)) return true
        }
        return false
      }
      return traverse(c.children)
    }) : null

    // Resolve environment: override first, then tab-level, then global active
    const requestEnvId = targetTab?.envId
    const effectiveEnvId = requestEnvId !== undefined ? requestEnvId : activeEnvIdRef.current
    const latestEnvs = environmentsRef.current
    const currentEnv = envOverride || latestEnvs.find(e => e.id === effectiveEnvId)

    const result = str.replace(/\{\{([\w.-]+)\}\}/g, (_, varName) => {
      // 0. Vault (highest precedence — secrets override everything)
      if (currentEnv) {
        const vaultEntries = vaultsRef.current[currentEnv.id] ?? []
        const found = vaultEntries.find(v => v.key === varName)
        if (found) return found.value
      }

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
    const tabId = activeTabIdRef.current
    const latestTabs = tabsRef.current
    const currentTab = latestTabs.find(t => t.id === tabId)

    if (!currentTab || currentTab.type !== 'request' || !currentTab.request || !window.ultraRpc) return
    const requestToSave = currentTab.request

    const res = await window.ultraRpc.saveRequest({ collectionId, request: requestToSave })

    if (res.success) {
      // Clear dirty flag on active tab and remember the collection
      setTabs(prev => prev.map(t =>
        t.id === tabId ? { ...t, isDirty: false, owningCollectionId: collectionId } : t
      ))
      window.ultraRpc.listCollections().then(res => { if (res.success && res.collections) setCollections(res.collections) })
      setShowSaveMenu(false)
    } else {
      addToast({ type: 'error', message: res.error || 'Failed to save request' })
    }
  }, [setCollections])

  const handleSaveActiveRequest = useCallback(async () => {
    const tabId = activeTabIdRef.current
    const latestTabs = tabsRef.current
    const currentTab = latestTabs.find(t => t.id === tabId)

    if (!currentTab) return

    if (currentTab.type === 'flow' && currentTab.flow) {
      const colId = currentTab.owningCollectionId || findCollectionByFlowId(currentTab.flow.id)?.id
      
      if (colId) {
        const res = await window.ultraRpc.saveFlow({ collectionId: colId, flow: currentTab.flow })
        if (res.success) {
          setTabs(prev => prev.map(t => t.id === tabId ? { ...t, isDirty: false, owningCollectionId: colId, ...(res.path ? { path: res.path } : {}) } : t))
          addToast({ type: 'success', message: 'Flow Saved' })
          loadFlows()
        } else {
          addToast({ type: 'error', message: res.error || 'Failed to save flow' })
        }
      } else if (currentTab.path) {
        const res = await window.ultraRpc.saveFlowStandalone({ path: currentTab.path, flow: currentTab.flow })
        if (res.success) {
          setTabs(prev => prev.map(t => t.id === tabId ? { ...t, isDirty: false, ...(res.path ? { path: res.path } : {}) } : t))
          addToast({ type: 'success', message: 'Flow Saved' })
          loadFlows()
        } else {
          addToast({ type: 'error', message: res.error || 'Failed to save flow' })
        }
      } else {
        // Unsaved new flow - show the save modal
        setSaveFlowModalName(currentTab.flow.name || 'New Flow')
        setSaveFlowModalPath('')
        setFlowToClone(null)
        setShowSaveFlowModal(true)
      }
      return
    }

    if (currentTab.type !== 'request' || !currentTab.request) return
    const requestToSave = currentTab.request

    let targetCollectionId = currentTab?.owningCollectionId
    if (!targetCollectionId) {
      const owningCollection = findCollectionByRequestId(requestToSave.id)
      targetCollectionId = owningCollection?.id
    }

    if (targetCollectionId) {
      // It's a known request linked to a collection, silently auto-save it
      saveToCollection(targetCollectionId)
    } else if (collectionsRef.current.length === 0) {
      // No collections exist, auto-create "My collection"
      if (window.ultraRpc) {
        const result = await window.ultraRpc.createCollection({ name: 'My collection' })
        if (result.success && result.id) {
          // Immediately save to this new collection
          await window.ultraRpc.saveRequest({ collectionId: result.id, request: requestToSave })

          // Clear dirty flag on active tab
          setTabs(prev => prev.map(t =>
            t.id === tabId ? { ...t, isDirty: false, owningCollectionId: result.id! } : t
          ))

          loadCollections()
        }
      }
    } else {
      // It's a new or decoupled request, open the standard picker
      setSaveModalRequestName(requestToSave.name || 'New Request')
      setSelectedCollectionId(null)
      setShowSaveMenu(true)
    }
  }, [saveToCollection, loadCollections, findCollectionByRequestId, loadFlows])

  const findCollectionIdByItemId = (itemId: string) => {
    const coll = collections.find(c => {
      if (c.id === itemId) return true
      const traverse = (items: any[]): boolean => {
        for (const item of items) {
          if (item.id === itemId) return true
          if (item.type === 'folder' && item.children && traverse(item.children)) return true
        }
        return false
      }
      return traverse(c.children || [])
    })
    return coll?.id
  }

  const findCollectionByFlowId = (flowId: string) => {
    const currentCollections = collectionsRef.current || collections
    return currentCollections.find(c => {
      const traverse = (items: any[]): boolean => {
        for (const item of items) {
          if (item.type === 'flow' && item.flow?.id === flowId) return true
          if (item.type === 'folder' && item.children && traverse(item.children)) return true
        }
        return false
      }
      return traverse(c.children || [])
    })
  }

  const handleOpenFlowTab = useCallback((flow: FlowDefinition, path?: string) => {
    const latestTabs = tabsRef.current
    const existingTab = latestTabs.find(t => t.type === 'flow' && t.id === flow.id)
    if (existingTab) {
      setActiveTabId(flow.id)
    } else {
      const owningColl = findCollectionByFlowId(flow.id)
      const newTab: Tab = {
        id: flow.id,
        type: 'flow',
        flow: { ...flow },
        owningCollectionId: owningColl?.id,
        path: path,
        isDirty: false,
        envId: activeEnvIdRef.current
      }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(flow.id)
    }
  }, [setTabs, setActiveTabId])

  const handleNewFlow = async (parentId?: string) => {
    setSaveFlowModalName('New Flow')
    
    // Resolve path if parentId is provided
    if (parentId) {
      const res = await window.ultraRpc.getCollectionPath({ collectionId: findCollectionIdByItemId(parentId) || parentId })
      if (res.success && res.path) {
        setSaveFlowModalPath(res.path)
      }
    } else if (collectionsRef.current.length > 0) {
      const res = await window.ultraRpc.getCollectionPath({ collectionId: collectionsRef.current[0].id })
      if (res.success && res.path) setSaveFlowModalPath(res.path)
    } else {
      setSaveFlowModalPath('')
    }
    
    setShowSaveFlowModal(true)
  }

  const confirmCreateFlow = async () => {
    if (!window.ultraRpc || !saveFlowModalPath) {
      addToast({ type: 'warning', message: 'Please select a destination folder.' })
      return
    }

    const newFlow: FlowDefinition = {
      id: Math.random().toString(36).substring(2, 11),
      name: saveFlowModalName.trim() || 'New Flow',
      steps: [],
      settings: {
        timeoutMs: 30000,
        onFailure: 'stop',
        repeat: 0
      },
      variables: {}
    }
    
    // If cloning, use the original template's steps and settings
    const flowData: FlowDefinition = flowToClone ? {
      ...newFlow,
      steps: JSON.parse(JSON.stringify(flowToClone.steps)), // deep copy to avoid reference sharing
      settings: { ...flowToClone.settings },
      variables: { ...flowToClone.variables }
    } : newFlow

    const res = await window.ultraRpc.saveFlowToPath({
      folderPath: saveFlowModalPath,
      flow: flowData
    })

    if (res.success) {
      setShowSaveFlowModal(false)
      setFlowToClone(null)
      loadCollections()
      loadFlows()
      handleOpenFlowTab(flowData, res.path)
    } else {
      addToast({ type: 'error', message: res.error || 'Failed to create flow' })
    }
  }

  const handleDeleteFlow = async (collectionId: string, flowId: string, path?: string) => {
    if (!confirm('Are you sure you want to delete this flow?')) return
    const res = await window.ultraRpc.deleteFlow({ collectionId, flowId, path })
    if (res.success) {
      loadCollections()
      loadFlows()
      addToast({ type: 'success', message: 'Flow Deleted' })
    } else {
      addToast({ type: 'error', message: res.error || 'Failed to delete flow' })
    }
  }

  const handleRenameFlow = async (collectionId: string | undefined, flowId: string, newName: string, path?: string) => {
    console.log("Renaming flow...", collectionId, flowId, newName);
    const res = await window.ultraRpc.renameFlow({ collectionId, flowId, newName, path });
    console.log("Rename result:", res);
    if (res.success && res.newId) {
      loadCollections()
      loadFlows()
      setTabs(prev => prev.map(t => 
        t.type === 'flow' && t.id === flowId 
          ? { ...t, id: res.newId!, flow: { ...t.flow, id: res.newId!, name: newName } } 
          : t
      ))
      if (activeTabId === flowId) setActiveTabId(res.newId)
    } else {
      addToast({ type: 'error', message: res.error || 'Failed to rename flow' })
    }
  }

  const handleMoveFlow = async (flowId: string, currentPath: string) => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.pickFolder()
    if (res.success && res.path) {
      const moveRes = await window.ultraRpc.moveFlow({ flowId, currentPath, targetFolderPath: res.path })
      if (moveRes.success) {
        addToast({ type: 'success', message: 'Flow moved successfully' })
        loadCollections()
        loadFlows()
      } else {
        addToast({ type: 'error', message: moveRes.error || 'Failed to move flow' })
      }
    }
  }

  const handleCloneFlow = useCallback((flow: FlowDefinition, path: string) => {
    // Priority check: Use the latest tab state if it's open
    const latestTabs = tabsRef.current
    const tabState = latestTabs.find(t => t.type === 'flow' && t.id === flow.id)
    const activeFlow = (tabState && tabState.type === 'flow') ? tabState.flow : flow

    setSaveFlowModalName(`${activeFlow.name} Copy`)
    const dir = path.replace(/[\\/][^\\/]+$/, '')
    setSaveFlowModalPath(dir)
    setFlowToClone(activeFlow)
    setShowSaveFlowModal(true)
  }, [setSaveFlowModalName, setSaveFlowModalPath, setFlowToClone, setShowSaveFlowModal])

  const handleReorderFlows = async (newFlows: { flow: FlowDefinition; path: string }[]) => {
    setFlows(newFlows as any)
    if (window.ultraRpc) {
      const order = newFlows.map(f => f.path)
      await window.ultraRpc.saveFlowOrder({ order })
    }
  }

  // Autosave dirty flows with a 1-second debounce
  useEffect(() => {
    const dirtyFlows = tabs.filter(t => t.type === 'flow' && t.isDirty)
    if (dirtyFlows.length === 0) return

    const timer = setTimeout(async () => {
      let updatedFlows = false
      for (const tab of dirtyFlows) {
        if (tab.type !== 'flow' || !tab.flow) continue
        const colId = tab.owningCollectionId || findCollectionByFlowId?.(tab.flow.id)?.id
        if (colId) {
          const res = await window.ultraRpc.saveFlow({ collectionId: colId, flow: tab.flow })
          if (res.success) {
            setTabs(prev => prev.map(t => (t.id === tab.id && t.type === 'flow') ? { ...t, isDirty: false, ...(res.path ? { path: res.path } : {}) } : t))
            updatedFlows = true
          }
        } else if (tab.path) {
          const res = await window.ultraRpc.saveFlowStandalone({ path: tab.path, flow: tab.flow })
          if (res.success) {
            setTabs(prev => prev.map(t => (t.id === tab.id && t.type === 'flow') ? { ...t, isDirty: false, ...(res.path ? { path: res.path } : {}) } : t))
            updatedFlows = true
          }
        }
      }
      if (updatedFlows) loadFlows()
    }, 1000)

    return () => clearTimeout(timer)
  }, [tabs, findCollectionByFlowId, setTabs, loadFlows])
  const handleLinkFlow = async () => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.linkFlow()
    if (res.success && res.flow) {
      handleOpenFlowTab(res.flow, res.path)
      loadFlows()
    } else if (res.error) {
      addToast({ type: 'error', message: res.error })
    }
  }

  const handleSaveAll = useCallback(async () => {
    if (!window.ultraRpc) return

    const latestTabs = tabsRef.current
    const dirtyTabs = latestTabs.filter(t => t.isDirty)

    if (dirtyTabs.length === 0) return

    const savedIds: string[] = []
    const newPaths: Record<string, string> = {}
    let updatedFlows = false

    for (const t of dirtyTabs) {
      if (t.type === 'request' && t.request) {
        const collectionId = t.owningCollectionId || findCollectionByRequestId(t.id)?.id
        if (collectionId) {
          const res = await window.ultraRpc.saveRequest({ collectionId, request: t.request })
          if (res.success) savedIds.push(t.id)
          else addToast({ type: 'error', message: `Failed to save ${t.request.name || 'Untitled'}: ${res.error}` })
        }
      } else if (t.type === 'flow' && t.flow) {
        const colId = t.owningCollectionId || findCollectionByFlowId(t.flow.id)?.id
        if (colId) {
          const res = await window.ultraRpc.saveFlow({ collectionId: colId, flow: t.flow })
          if (res.success) {
            savedIds.push(t.id)
            updatedFlows = true
            if (res.path) newPaths[t.id] = res.path
          }
          else addToast({ type: 'error', message: `Failed to save flow ${t.flow.name}: ${res.error}` })
        } else if (t.path) {
          const res = await window.ultraRpc.saveFlowStandalone({ path: t.path, flow: t.flow })
          if (res.success) {
            savedIds.push(t.id)
            updatedFlows = true
            if (res.path) newPaths[t.id] = res.path
          }
          else addToast({ type: 'error', message: `Failed to save flow ${t.flow.name}: ${res.error}` })
        }
      }
    }

    if (savedIds.length > 0) {
      setTabs(prev => prev.map(t => {
        if (savedIds.includes(t.id)) {
          return { ...t, isDirty: false, ...(newPaths[t.id] ? { path: newPaths[t.id] } : {}) }
        }
        return t
      }))
      loadCollections()
      if (updatedFlows) loadFlows()
    }

    if (savedIds.length > 0) {
      addToast({ type: 'success', message: `Saved ${savedIds.length} item(s)` })
    }
  }, [tabs, findCollectionByRequestId, loadCollections])

  // Keyboard Shortcuts (stable listener)
  const handleSaveActiveRequestRef = useRef(handleSaveActiveRequest)
  const handleSaveAllRef = useRef(handleSaveAll)
  const activePopupsRef = useRef({
    showSaveMenu,
    confirmDelete,
    editingCollection,
    showSettingsPopup,
    showAboutModal,
    showAiInfoModal,
    showLibraryModal,
    showGrpcDiscovery,
    showSaveFlowModal
  })
  
  useEffect(() => {
    handleSaveActiveRequestRef.current = handleSaveActiveRequest
    handleSaveAllRef.current = handleSaveAll
    activePopupsRef.current = {
      showSaveMenu,
      confirmDelete,
      editingCollection,
      showSettingsPopup,
      showAboutModal,
      showAiInfoModal,
      showLibraryModal,
      showGrpcDiscovery,
      showSaveFlowModal
    }
  }, [
    handleSaveActiveRequest, 
    handleSaveAll,
    showSaveMenu,
    confirmDelete,
    editingCollection,
    showSettingsPopup,
    showAboutModal,
    showAiInfoModal,
    showLibraryModal,
    showGrpcDiscovery,
    showSaveFlowModal
  ])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S or Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) {
          handleSaveAllRef.current()
        } else {
          handleSaveActiveRequestRef.current()
        }
      }
      
      // Ctrl+W or Cmd+W to close active tab
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        const activeId = activeTabIdRef.current
        if (activeId) {
          e.preventDefault()
          removeTab(null, activeId)
        }
      }

      // ESC key to close local popups
      if (e.key === 'Escape') {
        if (activePopupsRef.current.showSaveMenu) setShowSaveMenu(false)
        if (activePopupsRef.current.confirmDelete) setConfirmDelete(null)
        if (activePopupsRef.current.editingCollection) setEditingCollection(null)
        if (activePopupsRef.current.showSettingsPopup) setShowSettingsPopup(false)
        if (activePopupsRef.current.showAboutModal) setShowAboutModal(false)
        if (activePopupsRef.current.showAiInfoModal) setShowAiInfoModal(false)
        if (activePopupsRef.current.showLibraryModal) setShowLibraryModal(false)
        if (activePopupsRef.current.showGrpcDiscovery) setShowGrpcDiscovery(false)
        if (activePopupsRef.current.showSaveFlowModal) {
          setShowSaveFlowModal(false)
          setFlowToClone(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, []) // Stable listener

  const handleFormatJson = useCallback(async () => {
    if (bodyEditorRef.current) {
      await bodyEditorRef.current.format()
    }
  }, [])

  const runPreRequestScript = async (request: RequestConfig, tabEnvId: string | null | undefined): Promise<{ environments: Environment[], collections: Collection[] } | null> => {
    if (!request.preRequestScript || !request.preRequestScript.trim()) return null

    // We need to work with local copies to avoid race conditions with React state updates
    let currentEnvs = [...environmentsRef.current]
    let currentCollections = [...collectionsRef.current]

    // Find parent collection using the ref-based collections
    const parentCollection = currentCollections.find(c => {
      const traverse = (children: CollectionItem[]): boolean => {
        for (const item of children) {
          if (item.type === 'request' && item.request?.id === request.id) return true
          if (item.type === 'folder' && item.children && traverse(item.children)) return true
        }
        return false
      }
      return traverse(c.children)
    })

    const tabId = activeTabIdRef.current

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
      let activeOperations = 0
      let resolveScript: () => void
      const scriptDone = new Promise<void>(res => resolveScript = res)
      const checkDone = () => { if (activeOperations === 0) resolveScript() }

      const ultra = {
        env: {
          get: (key: string) => {
            const effectiveEnvId = tabEnvId !== undefined ? tabEnvId : activeEnvIdRef.current
            // 0. Vault first
            const vaultEntries = vaultsRef.current[effectiveEnvId ?? ''] ?? []
            const inVault = vaultEntries.find(v => v.key === key)
            if (inVault) return inVault.value

            const targetEnv = currentEnvs.find(e => e.id === effectiveEnvId)
            if (!targetEnv) return undefined
            return targetEnv.variables.find(v => v.key === key && v.enabled)?.value
          },
          set: (key: string, value: string) => {
            const effectiveEnvId = tabEnvId !== undefined ? tabEnvId : activeEnvIdRef.current
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
            // Ensure environmentsRef is also updated immediately for any concurrent scripts or UI
            environmentsRef.current = currentEnvs
            mockConsole.log(`Set env variable: ${key}`)
          },
          all: () => {
            const effectiveEnvId = tabEnvId !== undefined ? tabEnvId : activeEnvIdRef.current
            const targetEnv = currentEnvs.find(e => e.id === effectiveEnvId)
            if (!targetEnv) return {}
            const vars: Record<string, string> = {}
            targetEnv.variables.forEach(v => { if (v.enabled) vars[v.key] = v.value })
            return vars
          }
        },

        context: {
          get: (varName: string) => {
            const target = currentCollections.find(c => c.id === parentCollection?.id)
            if (!target?.variables) return undefined
            return target.variables.find(v => v.key === varName && v.enabled)?.value
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
                return { ...c, variables: vars }
              }
              return c
            })
            setCollections(currentCollections)
            // Ensure collectionsRef is also updated immediately for any concurrent scripts or UI
            collectionsRef.current = currentCollections
            mockConsole.log(`Set context variable: ${key}`)
          },
          all: () => {
            const target = currentCollections.find(c => c.id === parentCollection?.id)
            if (!target?.variables) return {}
            const vars: Record<string, string> = {}
            target.variables.forEach(v => { if (v.enabled) vars[v.key] = v.value })
            return vars
          }
        },
        expect: (val: any) => ({
          toBe: (expected: any) => { if (val !== expected) throw new Error(`Expected ${expected} but got ${val}`) },
          toInclude: (str: string) => { if (!String(val).includes(str)) throw new Error(`Expected "${val}" to include "${str}"`) },
          toBeTruthy: () => { if (!val) throw new Error(`Expected value to be truthy but got ${val}`) },
        }),
        sendRequest: (reqInput: any, cb: (err: any, res?: any) => void) => {
          activeOperations++
          if (!window.ultraRpc) {
            cb(new Error('IPC not available'))
            activeOperations--
            checkDone()
            return
          }
          const isObj = typeof reqInput === 'object'
          const adaptedReq = {
            method: isObj ? (reqInput.method || 'GET') : 'GET',
            url: isObj ? (reqInput.url || '') : reqInput,
            headers: isObj ? (reqInput.header || reqInput.headers || {}) : {},
            body: isObj ? (reqInput.body?.raw || reqInput.body || undefined) : undefined
          }

          window.ultraRpc.sendRestRequest(adaptedReq as any).then(res => {
            if (res.success && res.data) {
              const ultraRes = {
                json: () => {
                  try {
                    return JSON.parse(res.data!.body)
                  } catch (e) {
                    return null
                  }
                },
                text: () => res.data!.body,
                status: res.data!.status,
                headers: res.data!.headers
              }
              try { cb(null, ultraRes) } catch (e: any) { mockConsole.error('Callback error:', e.message) }
            } else {
              try { cb(new Error(res.error || 'Request failed')) } catch (e: any) { mockConsole.error('Callback error:', e.message) }
            }
          }).catch(err => {
            try { cb(err) } catch (e: any) { mockConsole.error('Callback error:', e.message) }
          }).finally(() => {
            activeOperations--
            checkDone()
          })
        },

        lib: {} as Record<string, any>
      }

      // Execute library scripts before main script
      let currentLibName = ''
      const libOwners: Record<string, string> = {}
      const libTarget: Record<string, any> = {}
      ultra.lib = new Proxy(libTarget, {
        set(target, key, value) {
          const k = String(key)
          if (k in target) {
            mockConsole.error(`[Library] Warning: ultra.lib.${k} already defined by "${libOwners[k]}", overwritten by "${currentLibName}"`)
          }
          libOwners[k] = currentLibName
          target[k] = value
          return true
        }
      })
      for (const lib of librariesRef.current) {
        if (!lib.enabled) continue
        const fileRes = await window.ultraRpc?.readFileContents(lib.filePath)
        if (!fileRes?.success || fileRes.content === undefined) {
          mockConsole.error(`[Library] "${lib.name}": cannot read file ${lib.filePath}`)
          continue
        }
        currentLibName = lib.name
        try {
          new Function('ultra', 'console', fileRes.content)(ultra, mockConsole)
        } catch (err: any) {
          mockConsole.error(`[Library] "${lib.name}" error: ${err.message}`)
        }
      }

      const script = new Function('ultra', 'console', request.preRequestScript)
      script(ultra, mockConsole)
      checkDone()

      // Safety timeout to prevent hanging forever if activeOperations somehow fails to reach 0
      let timer: any
      await Promise.race([
        scriptDone,
        new Promise(resolve => {
          timer = setTimeout(resolve, 5000)
        })
      ])
      if (timer) clearTimeout(timer)

      // Final save to disk after script finishes
      if (window.ultraRpc) {
        const effectiveEnvId = tabEnvId !== undefined ? tabEnvId : activeEnvIdRef.current
        if (effectiveEnvId) {
          const finalEnv = currentEnvs.find(e => e.id === effectiveEnvId)
          if (finalEnv) window.ultraRpc.saveEnvironments(currentEnvs)
        }
        if (parentCollection) {
          const finalColl = currentCollections.find(c => c.id === parentCollection.id)
          if (finalColl) handleSaveContextVariables(finalColl.id, finalColl.variables || [])
        }
      }

      return { environments: currentEnvs, collections: currentCollections }
    } catch (err: any) {
      mockConsole.error(`Pre-request Runtime Error: ${err.message}`)
      setScriptErrors(prev => ({ ...prev, [tabId]: `Pre-request Script Error: ${err.message}` }))
      return null // Continue request even if pre-script fails
    }
  }

  const runPostResponseScript = async (request: RequestConfig, response: ResponseData, tabId: string, tabEnvId: string | null | undefined, environmentsOverride?: Environment[], collectionsOverride?: Collection[]) => {
    if (!request.postResponseScript || !request.postResponseScript.trim()) return

    // Use local copies to avoid race conditions with React state updates
    let currentCollections = collectionsOverride || [...collectionsRef.current]
    let currentEnvs = environmentsOverride || [...environmentsRef.current]
    const parentCollection = currentCollections.find(c => getAllRequests(c).some(r => r.id === request.id))

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
      let activeOperations = 0
      let resolveScript: () => void
      const scriptDone = new Promise<void>(res => resolveScript = res)
      const checkDone = () => { if (activeOperations === 0) resolveScript() }

      // Prepare response body as object if JSON
      let bodyObj = response.body
      try {
        bodyObj = JSON.parse(response.body)
      } catch { /* stay as string */ }

      const ultra = {
        response: { ...response, body: bodyObj },
        env: {
          get: (varName: string) => {
            const effectiveEnvId = tabEnvId !== undefined ? tabEnvId : activeEnvIdRef.current
            // 0. Vault first
            const vaultEntries = vaultsRef.current[effectiveEnvId ?? ''] ?? []
            const inVault = vaultEntries.find(v => v.key === varName)
            if (inVault) return inVault.value

            const targetEnv = currentEnvs.find(e => e.id === effectiveEnvId)
            if (!targetEnv) return undefined
            return targetEnv.variables.find(v => v.key === varName && v.enabled)?.value
          },
          set: (varName: string, value: string) => {
            const effectiveEnvId = tabEnvId !== undefined ? tabEnvId : activeEnvIdRef.current
            if (!effectiveEnvId) {
              mockConsole.error('No active environment associated with this tab/globally.')
              return
            }
            currentEnvs = currentEnvs.map(e => {
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
            setEnvironments(currentEnvs)
            // Ensure environmentsRef is also updated immediately for any concurrent scripts or UI
            environmentsRef.current = currentEnvs
            mockConsole.log(`Set env variable: ${varName}`)
          },
          all: () => {
            const effectiveEnvId = tabEnvId !== undefined ? tabEnvId : activeEnvIdRef.current
            const targetEnv = currentEnvs.find(e => e.id === effectiveEnvId)
            if (!targetEnv) return {}
            const vars: Record<string, string> = {}
            targetEnv.variables.forEach(v => { if (v.enabled) vars[v.key] = v.value })
            return vars
          }
        },

        context: {
          get: (varName: string) => {
            const target = currentCollections.find(c => c.id === parentCollection?.id)
            if (!target?.variables) return undefined
            return target.variables?.find(v => v.key === varName && v.enabled)?.value
          },
          set: (varName: string, value: string) => {
            if (!parentCollection) {
              mockConsole.error('Request must be in a collection to set variables.')
              return
            }
            currentCollections = currentCollections.map(c => {
              if (c.id === parentCollection.id) {
                const vars = [...(c.variables || [])]
                const idx = vars.findIndex(v => v.key === varName)
                if (idx >= 0) {
                  vars[idx] = { ...vars[idx], value: String(value) }
                } else {
                  vars.push({ id: Math.random().toString(36).substring(2, 11), key: varName, value: String(value), enabled: true })
                }
                return { ...c, variables: vars }
              }
              return c
            })
            setCollections(currentCollections)
            // Ensure collectionsRef is also updated immediately for any concurrent scripts or UI
            collectionsRef.current = currentCollections
            mockConsole.log(`Set context variable: ${varName}`)
          },
          all: () => {
            const target = currentCollections.find(c => c.id === parentCollection?.id)
            if (!target?.variables) return {}
            const vars: Record<string, string> = {}
            target.variables.forEach(v => { if (v.enabled) vars[v.key] = v.value })
            return vars
          }
        },
        sendRequest: (reqInput: any, cb: (err: any, res?: any) => void) => {
          activeOperations++
          if (!window.ultraRpc) {
            cb(new Error('IPC not available'))
            activeOperations--
            checkDone()
            return
          }
          const isObj = typeof reqInput === 'object'
          const adaptedReq = {
            method: isObj ? (reqInput.method || 'GET') : 'GET',
            url: isObj ? (reqInput.url || '') : reqInput,
            headers: isObj ? (reqInput.header || reqInput.headers || {}) : {},
            body: isObj ? (reqInput.body?.raw || reqInput.body || undefined) : undefined
          }

          window.ultraRpc.sendRestRequest(adaptedReq as any).then(res => {
            if (res.success && res.data) {
              const ultraRes = {
                json: () => {
                  try {
                    return JSON.parse(res.data!.body)
                  } catch (e) {
                    return null
                  }
                },
                text: () => res.data!.body,
                status: res.data!.status,
                headers: res.data!.headers
              }
              try { cb(null, ultraRes) } catch (e: any) { mockConsole.error('Callback error:', e.message) }
            } else {
              try { cb(new Error(res.error || 'Request failed')) } catch (e: any) { mockConsole.error('Callback error:', e.message) }
            }
          }).catch(err => {
            try { cb(err) } catch (e: any) { mockConsole.error('Callback error:', e.message) }
          }).finally(() => {
            activeOperations--
            checkDone()
          })
        },

        lib: {} as Record<string, any>
      }

      // Execute library scripts before main script
      let currentLibName = ''
      const libOwners: Record<string, string> = {}
      const libTarget: Record<string, any> = {}
      ultra.lib = new Proxy(libTarget, {
        set(target, key, value) {
          const k = String(key)
          if (k in target) {
            mockConsole.error(`[Library] Warning: ultra.lib.${k} already defined by "${libOwners[k]}", overwritten by "${currentLibName}"`)
          }
          libOwners[k] = currentLibName
          target[k] = value
          return true
        }
      })
      for (const lib of librariesRef.current) {
        if (!lib.enabled) continue
        const fileRes = await window.ultraRpc?.readFileContents(lib.filePath)
        if (!fileRes?.success || fileRes.content === undefined) {
          mockConsole.error(`[Library] "${lib.name}": cannot read file ${lib.filePath}`)
          continue
        }
        currentLibName = lib.name
        try {
          new Function('ultra', 'console', fileRes.content)(ultra, mockConsole)
        } catch (err: any) {
          mockConsole.error(`[Library] "${lib.name}" error: ${err.message}`)
        }
      }

      // Sandbox execution
      const script = new Function('ultra', 'console', request.postResponseScript)
      script(ultra, mockConsole)
      checkDone()


      // Safety timeout to prevent hanging forever if activeOperations somehow fails to reach 0
      let timer: any
      await Promise.race([
        scriptDone,
        new Promise(resolve => {
          timer = setTimeout(resolve, 5000)
        })
      ])
      if (timer) clearTimeout(timer)

      // Final save to disk after script finishes
      if (window.ultraRpc) {
        const effectiveEnvId = tabEnvId !== undefined ? tabEnvId : activeEnvIdRef.current
        if (effectiveEnvId) {
          const finalEnv = currentEnvs.find(e => e.id === effectiveEnvId)
          if (finalEnv) window.ultraRpc.saveEnvironments(currentEnvs)
        }
        if (parentCollection) {
          const finalColl = currentCollections.find(c => c.id === parentCollection.id)
          if (finalColl) handleSaveContextVariables(finalColl.id, finalColl.variables || [])
        }
      }
    } catch (err: any) {
      mockConsole.error(`Post-response Runtime Error: ${err.message}`)
      setScriptErrors(prev => ({ ...prev, [tabId]: `Post-response Script Error: ${err.message}` }))
    }
  }

  // ===== Send Request =====
  const sendRequest = async () => {
    const tabId = activeTabIdRef.current
    const latestTabs = tabsRef.current
    const currentTab = latestTabs.find(t => t.id === tabId)

    if (!currentTab || currentTab.type !== 'request' || !currentTab.request || !tabId) return

    setLoadingTabs(prev => ({ ...prev, [tabId]: true }))
    setErrors(prev => ({ ...prev, [tabId]: null }))
    setResponses(prev => ({ ...prev, [tabId]: null }))
    setScriptLogs(prev => ({ ...prev, [tabId]: [] }))
    setScriptErrors(prev => ({ ...prev, [tabId]: null }))

    let scriptResult = null
    try {
      scriptResult = await runPreRequestScript(currentTab.request, currentTab.envId)
    } catch (e: any) {
      console.error('Pre-request script failed, but continuing request:', e)
      setScriptErrors(prev => ({ ...prev, [tabId]: `Pre-request Error: ${e.message}` }))
    }

    const latestEnvs = environmentsRef.current
    const latestCollections = collectionsRef.current
    const effectiveEnvId = currentTab.envId || activeEnvIdRef.current
    const updatedEnv = latestEnvs.find(e => e.id === effectiveEnvId)

    const interpolateLocal = (text: string) => {
      return interpolate(text, updatedEnv, scriptResult?.collections || latestCollections, tabId)
    }

    const url = interpolateLocal(currentTab.request.url)
    let statusCode: number | undefined

    if (currentTab.request.type === 'GRPC') {
      try {
        if (!window.ultraRpc) throw new Error('Electron IPC not available. Run the app in Electron.')

        const headers: Record<string, string> = {}
        currentTab.request.headers.filter(h => h.enabled && h.key).forEach(h => {
          headers[interpolateLocal(h.key)] = interpolateLocal(h.value)
        })

        if (!currentTab.request.grpcService) {
          throw new Error('Select a service first. Use the "Discover Services" button below to find available services via reflection.')
        }
        if (!currentTab.request.grpcMethod) {
          throw new Error('Enter a method name to call.')
        }

        const isInsecure = updatedEnv?.sslVerification === false

        const result = await window.ultraRpc.grpcCall({
          host: url, insecure: isInsecure, headers,
          service: currentTab.request.grpcService, method: currentTab.request.grpcMethod,
          payload: interpolateLocal(currentTab.request.grpcPayload || '{}'),
          timeoutMs: currentTab.request.timeoutMs,
          protoPath: currentTab.request.protoPath
        })
        if (result.success && result.data) {
          statusCode = result.data.status
          setResponses(prev => ({ ...prev, [tabId]: result.data! }))
          await runPostResponseScript(currentTab.request, result.data, tabId, currentTab.envId, scriptResult?.environments, scriptResult?.collections)
        } else {
          throw new Error(result.error || 'gRPC call failed')
        }
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [tabId]: err.message }))
      }
    } else {
      try {
        const headers: Record<string, string> = {}
        currentTab.request.headers.filter(p => p.enabled && p.key).forEach(h => {
          headers[interpolateLocal(h.key)] = interpolateLocal(h.value)
        })

        const enabledParams = currentTab.request.params.filter(p => p.enabled && p.key)
        let fullUrl = url
        if (enabledParams.length > 0) {
          const searchParams = new URLSearchParams()
          enabledParams.forEach(p => searchParams.append(interpolateLocal(p.key), interpolateLocal(p.value)))
          fullUrl += (fullUrl.includes('?') ? '&' : '?') + searchParams.toString()
        }

        const isInsecure = updatedEnv?.sslVerification === false

        if (window.ultraRpc) {
          const result = await window.ultraRpc.sendRestRequest({
            method: currentTab.request.method, url: fullUrl, headers,
            body: ['POST', 'PUT', 'PATCH'].includes(currentTab.request.method) ? interpolateLocal(currentTab.request.body || '') : undefined,
            insecure: isInsecure,
            protocol: updatedEnv?.protocol,
            timeoutMs: currentTab.request.timeoutMs
          })
          if (result.success && result.data) {
            statusCode = result.data.status
            setResponses(prev => ({ ...prev, [tabId]: result.data! }))
            await runPostResponseScript(currentTab.request, result.data, tabId, currentTab.envId, scriptResult?.environments, scriptResult?.collections)
          } else {
            throw new Error(result.error || 'Request failed')
          }
        } else {
          const start = Date.now()
          const resp = await fetch(fullUrl, {
            method: currentTab.request.method, headers,
            body: ['POST', 'PUT', 'PATCH'].includes(currentTab.request.method) ? interpolateLocal(currentTab.request.body || '') : undefined,
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
          await runPostResponseScript(currentTab.request, respData, tabId, currentTab.envId, scriptResult?.environments, scriptResult?.collections)
        }
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [tabId]: err.message }))
      }
    }

    // Record in history
    addToHistory(currentTab.request, statusCode)
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
    { key: 'auth', label: activeRequest?.type === 'GRPC' ? 'Options & Timeout' : 'Options' },
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

  const handleLocateInTree = (reqId: string) => {
    if (sidebarWidth < 100) setSidebarWidth(300)
    setShowHistoryPanel(false)
    setShowFlowPanel(false)
    collectionPanelRef.current?.locateNode(reqId)
  }

  // Remove early return null to allow rendering IntroPage when no tabs are open
  // if (!activeTab) return null

  return (
    <div className={`app-container ${resolvedTheme}-theme`}>
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

          <button
            className="btn-ghost"
            style={{ padding: '6px' }}
            onClick={() => setShowLibraryModal(true)}
            data-tooltip="Code Library"
            data-tooltip-pos="right"
          >
            <Braces size={18} />
          </button>

          <button
            className={`btn-ghost ${showFlowPanel ? 'env-toggle-active' : ''}`}
            style={{ padding: '6px' }}
            onClick={() => {
              const next = !showFlowPanel;
              setShowFlowPanel(next);
              localStorage.setItem('ultraRpcShowFlowPanel', next.toString());
            }}
            data-tooltip="Flow Runner"
            data-tooltip-pos="right"
          >
            <GitBranch size={18} />
          </button>

          <button
            className={`btn-ghost ${showAiInfoModal ? 'env-toggle-active' : ''}`}
            style={{ padding: '6px' }}
            onClick={() => setShowAiInfoModal(true)}
            data-tooltip="AI Model Context Protocol"
            data-tooltip-pos="left"
          >
            <Sparkles size={18} fill={showAiInfoModal ? 'currentColor' : 'none'} />
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
                  <button
                    className={`theme-toggle-btn ${theme === 'auto' ? 'active' : ''}`}
                    onClick={() => {
                      setTheme('auto')
                      if (window.ultraRpc) window.ultraRpc.saveSettings({ theme: 'auto' })
                      setShowSettingsPopup(false)
                    }}
                  >
                    System
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
                <span className="settings-label">MCP Server</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    className="layout-toggle"
                    onClick={() => {
                      const newValue = !mcpEnabled
                      setMcpEnabled(newValue)
                      saveAppSetting('mcpEnabled', newValue)
                    }}
                    style={{
                      width: '34px',
                      height: '18px',
                      borderRadius: '10px',
                      background: mcpEnabled ? 'var(--accent)' : 'var(--bg-tertiary)',
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
                      left: mcpEnabled ? '18px' : '2px',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                    }} />
                  </button>
                  <span style={{ fontSize: '11px', color: mcpEnabled ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 600 }}>Enabled</span>
                  <input
                    type="number"
                    value={mcpPort}
                    onChange={(e) => {
                      const newPort = parseInt(e.target.value) || 3000
                      setMcpPort(newPort)
                    }}
                    onBlur={(e) => {
                       const newPort = parseInt(e.target.value) || 3000
                       saveAppSetting('mcpPort', newPort)
                    }}
                    disabled={!mcpEnabled}
                    style={{
                      width: '80px',
                      fontSize: '11px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      padding: '2px 4px',
                      color: 'var(--text-primary)'
                    }}
                    title="MCP Port"
                  />
                  {mcpEnabled && (
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#10b981',
                        boxShadow: '0 0 6px #10b981',
                        marginLeft: 'auto'
                      }}
                      title="MCP Server Running"
                    />
                  )}
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
            <div className="sidebar-env-content">
              <EnvironmentPanel
                environments={environments}
                activeEnvId={(activeTab?.envId || activeEnvId)}
                onSetActive={applyEnvToAllTabs}
                onChange={handleEnvChange}
                onDeleteRequest={(id, name) => setConfirmDelete({ type: 'environment', id, name })}
                onApplyToAllTabs={applyEnvToAllTabs}
                vaults={vaults}
                onVaultChange={handleVaultChange}
                vaultAvailable={vaultAvailable}
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
            ref={collectionPanelRef}
            collections={collections}
            onRefresh={loadCollections}
            onOpenRequest={handleOpenRequestFromCollection}
            onRenameRequest={handleRenameRequest}
            onEditVariables={setEditingCollection}
            onDeleteRequest={handleDeleteRequest}
            onDeleteFolder={handleDeleteFolder}
            onDeleteCollection={handleDeleteCollection}
            onMoveCollection={handleMoveCollection}
            onCloneCollection={handleCloneCollection}
            onCloneRequest={handleCloneRequest}
            onImportEnvironments={handleImportEnvironments}
            onOpenFlow={handleOpenFlowTab}
          />

          {showFlowPanel && (
            <FlowPanel
              collections={collections}
              flows={flows}
              onOpenFlow={handleOpenFlowTab}
              onNewFlow={handleNewFlow}
              onDeleteFlow={handleDeleteFlow}
              onRenameFlow={handleRenameFlow}
              onLinkFlow={handleLinkFlow}
              onMoveFlow={handleMoveFlow}
              onCloneFlow={handleCloneFlow}
              onReorderFlows={handleReorderFlows}
            />
          )}
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
            {(() => {
              // Build a flattened render list, injecting group-header pseudo-items
              const renderedGroupIds = new Set<string>()

              return tabs.flatMap(tab => {
                const group = tab.groupId ? tabGroups.find(g => g.id === tab.groupId) : undefined

                // If tab's group is hidden, skip the tab entirely
                if (group?.isHidden) return []

                const elements: React.ReactNode[] = []

                // Inject group header before the first tab of each group
                if (group && !renderedGroupIds.has(group.id)) {
                  renderedGroupIds.add(group.id)
                  const isEditing = editingGroupId === group.id
                  elements.push(
                    <div
                      key={`grp-header-${group.id}`}
                      className="tab-group-header"
                      style={{ '--group-color': group.color } as React.CSSProperties}
                      onClick={() => { if (!isEditing) toggleGroupCollapse(group.id) }}
                      title={isEditing ? '' : (group.isCollapsed ? `Expand "${group.name}"` : `Collapse "${group.name}". Double-click to rename.`)}
                    >
                      <div
                        className="tab-group-header-pill"
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setEditingGroupId(group.id)
                        }}
                      >
                        {isEditing ? (
                          <input
                            className="tab-group-rename-input"
                            defaultValue={group.name}
                            autoFocus
                            onFocus={e => e.target.select()}
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === 'Escape') {
                                const val = (e.target as HTMLInputElement).value.trim()
                                if (val) handleUpdateGroup(group.id, { name: val })
                                setEditingGroupId(null)
                              }
                            }}
                            onBlur={e => {
                              const val = e.target.value.trim()
                              if (val) handleUpdateGroup(group.id, { name: val })
                              setEditingGroupId(null)
                            }}
                            style={{ '--group-color': group.color } as React.CSSProperties}
                          />
                        ) : (
                          <span className="tab-group-header-label">{group.name}</span>
                        )}
                        {!isEditing && (group.isCollapsed
                          ? <ChevronRight size={11} className="tab-group-header-chevron" />
                          : <ChevronDown size={11} className="tab-group-header-chevron" />
                        )}
                      </div>
                    </div>
                  )
                }

                // If group is collapsed, skip the tab (but we still rendered the header above)
                if (group?.isCollapsed) return elements

                elements.push(
                  <Reorder.Item
                    key={tab.id}
                    value={tab}
                    id={tab.id}
                    onClick={() => setActiveTabId(tab.id)}
                    onContextMenu={(e: React.MouseEvent) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setTabContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY })
                    }}
                    className={`tab-item ${activeTabId === tab.id ? 'tab-active' : ''}`}
                    data-dirty={tab.isDirty ? 'true' : 'false'}
                    data-group-id={tab.groupId || ''}
                    as="div"
                    style={group ? {
                      '--group-color': group.color,
                      borderTop: `4px solid ${group.color}`,
                      background: `color-mix(in srgb, ${group.color} 6%, transparent)`,
                    } as React.CSSProperties : undefined}
                  >
                    <span className="tab-method" style={{
                      color: methodColor(
                        tab.type === 'flow' ? 'POST' : 
                        tab.type === 'request' ? (tab.request?.type === 'GRPC' ? 'GRPC' : tab.request?.method || 'GET') : 
                        'GET'
                      ),
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {tab.type === 'flow' ? (
                        <><GitBranch size={12} /> FLOW</>
                      ) : tab.type === 'request' ? (
                        tab.request?.type === 'GRPC' ? 'gRPC' : tab.request?.method
                      ) : (
                        'NEW'
                      )}
                    </span>

                    <span
                      className="tab-title"
                      style={{ color: tab.isDirty ? 'var(--danger)' : 'var(--text-primary)' }}
                    >
                      {tab.type === 'flow' ? (tab.flow?.name || 'New Flow') : 
                       tab.type === 'request' ? (tab.request?.name || tab.request?.url || 'Untitled') : 
                       'New Tab'}
                      {tab.isDirty ? '*' : ''}
                    </span>

                    <button className="tab-close" onClick={(e) => removeTab(e, tab.id)}>
                      <X size={12} />
                    </button>
                    {activeTabId === tab.id && (
                      <div className="tab-indicator" />
                    )}
                  </Reorder.Item>
                )

                return elements
              })
            })()}
            <button className="tab-add" onClick={() => addEmptyTab()}>
              <Plus size={16} />
            </button>
            <button
              className={`tab-add tab-groups-btn ${tabGroups.length > 0 ? 'tab-groups-btn-active' : ''}`}
              onClick={() => setShowTabGroupsModal(true)}
              title="Manage tab groups"
            >
              <Layers size={14} />
              {tabGroups.length > 0 && (
                <span className="tab-groups-badge">{tabGroups.length}</span>
              )}
            </button>
          </Reorder.Group>
        </header>

        {/* Content */}
        <section className={`request-section ${threeColumnLayout ? 'three-column' : ''}`}>
          <div
            className={`request-top-pane ${activeTab?.type === 'flow' ? 'flow-pane' : ''}`}
            style={threeColumnLayout 
              ? { width: activeTab?.type === 'flow' ? '100%' : `${requestPanelWidth}px`, height: '100%' } 
              : { height: activeTab?.type === 'flow' ? '100%' : `${requestPanelHeight}px` }
            }
          >
            <div
              key={activeTabId}
              className="request-container"
            >
              {activeTab?.type === 'intro' || !activeTab ? (
                <IntroPage 
                  onNewRequest={(type) => handleIntroAction(type, activeTab?.id || '')} 
                  onOpenCollection={() => {
                    if (window.ultraRpc) window.ultraRpc.importCollection()
                  }}
                  onImportEnvironments={() => setShowEnvPanel(true)}
                />
              ) : activeTab?.type === 'flow' && activeTab.flow ? (
                <FlowCanvas
                  flow={activeTab.flow}
                  onUpdate={(updates) => {
                    setTabs(prev => prev.map(t =>
                      t.id === activeTab.id && t.type === 'flow'
                        ? { ...t, flow: { ...t.flow, ...updates }, isDirty: true }
                        : t
                    ))
                  }}
                  collections={collections}
                  environments={environments}
                  libraries={libraries}
                  activeEnvId={activeEnvId}
                  onFollowDefinition={handleFollowDefinition}
                  onOpenRequest={handleJumpToRequest}
                />
              ) : activeTab?.type === 'request' && activeTab.request ? (
                <div className="request-container">
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
                      contextVariables={activeRequestCollection?.variables}
                      vaultEntries={activeVaultEntries}
                      theme={resolvedTheme}
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

                  {/* Collection label and active env selector */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div className="header-field-group">
                      <span className="header-field-label">Collection</span>
                      {activeRequestCollection ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div className="collection-label-wrapper" title={`Part of collection: ${activeRequestCollection.name}`}>
                            <Folder size={12} className="collection-label-icon" />
                            <span className="collection-label-text">{activeRequestCollection.name}</span>
                          </div>
                          <button
                            className="locate-in-tree-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLocateInTree(activeRequest.id);
                            }}
                            title="Locate in Collection Tree"
                          >
                            <Target size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="collection-label-wrapper unassigned">
                          <span className="collection-label-text">Save to assign to the collection</span>
                        </div>
                      )}
                    </div>

                    {environments.length > 0 && (
                      <div className="header-field-group" style={{ marginLeft: '8px' }}>
                        <span className="header-field-label">Environment</span>
                        <div className="env-selector-wrapper">
                          <Globe size={12} className="env-selector-icon" />
                          <select
                            className="env-selector"
                            value={activeTab?.envId !== undefined ? (activeTab?.envId || '') : (activeEnvId || '')}
                            onChange={(e) => {
                              const val = e.target.value;
                              const newId = val === '' ? null : val;
                              updateTabEnv(newId);
                            }}
                          >
                            <option value="">No Environment</option>
                            {environments.map(env => (
                              <option key={env.id} value={env.id}>{env.name}</option>
                            ))}
                          </select>
                          {activeRequest.type === 'GRPC' && activeEnv?.protocol === 'http1' && (
                            <div className="env-selector-warning" data-tooltip="gRPC strictly requires HTTP/2. Using an HTTP/1.1 environment will likely cause failures.">
                              <AlertTriangle size={14} color="#ef4444" />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* gRPC-specific fields at the top of the request pane (fixed) */}
                  {activeRequest.type === 'GRPC' && (
                    (() => {
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
                              contextVariables={activeRequestCollection?.variables}
                              vaultEntries={activeVaultEntries}
                              theme={resolvedTheme}
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
                                contextVariables={activeRequestCollection?.variables}
                                vaultEntries={activeVaultEntries}
                                theme={resolvedTheme}
                              />
                              <button
                                type="button"
                                className="btn-primary"
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
                                contextVariables={activeRequestCollection?.variables}
                                vaultEntries={activeVaultEntries}
                                theme={resolvedTheme}
                              />
                              <button
                                type="button"
                                className="btn-ghost"
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
                  <div className="request-pane-content" style={{ display: 'flex', flexDirection: 'column' }}>
                    {/* gRPC discovery in a modal */}
                    {activeRequest.type === 'GRPC' && showGrpcDiscovery && (
                      <div className="modal-overlay" onClick={() => setShowGrpcDiscovery(false)}>
                        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '850px', height: '85vh' }}>
                          <div className="modal-header">
                            <h3>gRPC Service Discovery</h3>
                            <button className="modal-close-btn" onClick={() => setShowGrpcDiscovery(false)}>
                              <X size={20} />
                            </button>
                          </div>
                          
                          <div className="modal-body">
                            <GrpcReflectionPanel
                              host={grpcDiscoveryUrl}
                              onHostChange={(val) => setGrpcDiscoveryUrl(val)}
                              insecure={(() => {
                                const effectiveEnvId = activeTab?.envId || activeEnvId
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
                              protoPath={activeRequest.protoPath || ''}
                              grpcReflection={activeRequest.grpcReflection !== false}
                              interpolate={interpolate}
                              activeEnv={activeEnv}
                              contextVariables={activeRequestCollection?.variables}
                              vaultEntries={activeVaultEntries}
                              theme={resolvedTheme}
                              onSelectService={(svc) => updateActiveRequest({ grpcService: svc })}
                              onSelectMethod={(svc, method, sampleBody) => {
                                updateActiveRequest({
                                  url: grpcDiscoveryUrl,
                                  grpcService: svc,
                                  grpcMethod: method,
                                  grpcPayload: sampleBody || '{}',
                                  bodyType: 'json',
                                  ...(activeRequest.grpcReflection !== false ? { protoPath: '' } : {})
                                })
                                setActiveConfigTab('body')
                                setShowGrpcDiscovery(false)
                              }}
                              onProtoPathChange={(path) => updateActiveRequest({ protoPath: path })}
                              onGrpcReflectionChange={(useReflection) => updateActiveRequest({ grpcReflection: useReflection })}
                            />
                          </div>

                          <div className="modal-footer">
                            <button className="btn-ghost" onClick={() => setShowGrpcDiscovery(false)} style={{ padding: '8px 20px' }}>
                              Close
                            </button>
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
                          contextVariables={activeRequestCollection?.variables}
                          vaultEntries={activeVaultEntries}
                          theme={resolvedTheme}
                        />
                      )}
                      {activeConfigTab === 'headers' && (
                        <KeyValueEditor
                          pairs={activeRequest.headers}
                          onChange={(headers) => updateActiveRequest({ headers })}
                          keyPlaceholder="Header"
                          valuePlaceholder="Value"
                          activeEnv={activeEnv}
                          contextVariables={activeRequestCollection?.variables}
                          vaultEntries={activeVaultEntries}
                          theme={resolvedTheme}
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
                              <button
                                className="btn-ghost"
                                style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={handleFormatJson}
                                title="Standardize JSON indentation (Shift+Alt+F)"
                              >
                                <Code size={14} /> Format
                              </button>
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
                              contextVariables={activeRequestCollection?.variables}
                              vaultEntries={activeVaultEntries}
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
                              theme={resolvedTheme}
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
                                  width: '160px',
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
                                Run code before the request is sent. Access <code>ultra.env.get</code> or <code>ultra.context.set</code> to update variables. <strong>Tip:</strong> <code>Cmd/Ctrl + Click</code> on <code>ultra.lib.*</code> methods to Go to Definition.
                              </p>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                <button
                                  className={`btn-ghost ${preRequestValidation.validationStatus === 'success' ? 'val-success' : preRequestValidation.validationStatus === 'error' ? 'val-error' : ''}`}
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                  onClick={() => preRequestValidation.validate(activeRequest.preRequestScript || '')}
                                  title="Check for syntax errors"
                                >
                                  <ShieldCheck size={14} /> Validate
                                </button>
                                <button
                                  className="btn-ghost"
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                  onClick={() => preRequestEditorRef.current?.format()}
                                  title="Prettify script (Shift+Alt+F)"
                                >
                                  <AlignLeft size={14} /> Format
                                </button>
                                <button
                                  className={`btn-ghost ${wrapLines ? 'env-toggle-active' : ''}`}
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                  onClick={() => setWrapLines(!wrapLines)}
                                  title="Toggle Line Wrap"
                                >
                                  <WrapText size={14} />
                                </button>
                              </div>
                            </div>
                          </div>

                          <ValidationBanner
                            status={preRequestValidation.validationStatus}
                            error={preRequestValidation.validationError}
                            style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}
                          />

                          <div style={{ flex: 1, minHeight: '150px' }}>
                            <InterpolatedInput
                              ref={preRequestEditorRef}
                              multiline
                              className="script-editor"
                              placeholder="// code here...&#10;ultra.env.set('timestamp', Date.now().toString());"
                              value={activeRequest.preRequestScript || ''}
                              onChange={val => {
                                updateActiveRequest({ preRequestScript: val })
                                preRequestValidation.resetValidation()
                              }}
                              activeEnv={activeEnv}
                              highlightJs={true}
                              wrapLines={wrapLines}
                              contextVariables={activeRequestCollection?.variables}
                              vaultEntries={activeVaultEntries}
                              theme={resolvedTheme}
                              onFollowDefinition={handleFollowDefinition}
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
                                 Run code after a successful response. Access <code>ultra.response</code> and update variables with <code>ultra.context.set(key, value)</code>. <strong>Tip:</strong> <code>Cmd/Ctrl + Click</code> on <code>ultra.lib.*</code> methods to Go to Definition.
                              </p>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                <button
                                  className={`btn-ghost ${postResponseValidation.validationStatus === 'success' ? 'val-success' : postResponseValidation.validationStatus === 'error' ? 'val-error' : ''}`}
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                  onClick={() => postResponseValidation.validate(activeRequest.postResponseScript || '')}
                                  title="Check for syntax errors"
                                >
                                  <ShieldCheck size={14} /> Validate
                                </button>
                                <button
                                  className="btn-ghost"
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                  onClick={() => postResponseEditorRef.current?.format()}
                                  title="Prettify script (Shift+Alt+F)"
                                >
                                  <Code size={14} /> Format
                                </button>
                                <button
                                  className={`btn-ghost ${wrapLines ? 'env-toggle-active' : ''}`}
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                  onClick={() => setWrapLines(!wrapLines)}
                                  title="Toggle Line Wrap"
                                >
                                  <WrapText size={14} />
                                </button>
                              </div>
                            </div>
                          </div>

                          <ValidationBanner
                            status={postResponseValidation.validationStatus}
                            error={postResponseValidation.validationError}
                            style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}
                          />

                          <div style={{ flex: 1, minHeight: '150px' }}>
                            <InterpolatedInput
                              ref={postResponseEditorRef}
                              multiline
                              className="script-editor"
                              placeholder="// code here...&#10;if (ultra.response.body.token) {&#10;  ultra.context.set('auth_token', ultra.response.body.token);&#10;}"
                              value={activeRequest.postResponseScript || ''}
                              onChange={val => {
                                updateActiveRequest({ postResponseScript: val })
                                postResponseValidation.resetValidation()
                              }}
                              activeEnv={activeEnv}
                              highlightJs={true}
                              wrapLines={wrapLines}
                              contextVariables={activeRequestCollection?.variables}
                              vaultEntries={activeVaultEntries}
                              theme={resolvedTheme}
                              onFollowDefinition={handleFollowDefinition}
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
                </div>
              ) : (
                <div className="empty-state">
                  <p>No active tab. Create or open a request.</p>
                </div>
              )}
            </div>
          </div>

          {(activeTab?.type !== 'flow') && (
            <>
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
                  theme={resolvedTheme}
                />
              </div>
            </>
          )}
        </section>
      </main>

      <AboutModal
        isOpen={showAboutModal}
        onClose={() => setShowAboutModal(false)}
        version={pkg.version}
      />

      <AiInfoModal
        isOpen={showAiInfoModal}
        onClose={() => setShowAiInfoModal(false)}
      />

      <LibraryModal
        isOpen={showLibraryModal}
        onClose={() => {
          setShowLibraryModal(false)
          setInitialLibraryId(null)
        }}
        libraries={libraries}
        initialSelectedId={initialLibraryId}
        onSave={(libs) => {
          setLibraries(libs)
          if (window.ultraRpc) window.ultraRpc.saveLibraries(libs)
        }}
        initialWidth={libraryModalWidth}
        initialHeight={libraryModalHeight}
        onResize={handleLibraryModalResize}
        theme={resolvedTheme}
      />



      {/* Context Variables Modal */}
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
              <h3>Context Variables: {editingCollection.name}</h3>
              <button className="btn-ghost" onClick={() => setEditingCollection(null)} style={{ padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div style={{ marginBottom: '20px', padding: '12px', background: 'var(--accent-muted)', borderRadius: '8px', border: '1px solid var(--accent)', color: 'var(--text-primary)', fontSize: '13px', lineHeight: '1.5' }}>
                <strong>Pro Tip:</strong> Context variables are scoped to this collection and override environment variables. Use <code>{`{{VARIABLE_NAME}}`}</code> in any request field.
              </div>

              <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Variable Definitions
              </div>

              <KeyValueEditor
                pairs={collections.find(c => c.id === editingCollection.id)?.variables || []}
                onChange={(vars) => handleSaveContextVariables(editingCollection.id, vars)}
                keyPlaceholder="Variable Name"
                valuePlaceholder="Current Value"
                activeEnv={activeEnv}
                contextVariables={collections.find(c => c.id === editingCollection.id)?.variables || []}
                vaultEntries={activeVaultEntries}
                theme={resolvedTheme}
                confirmDelete={true}
              />
            </div>

            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setEditingCollection(null)}>
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Save Flow Modal */}
      {showSaveFlowModal && (
        <div className="modal-overlay" onClick={() => { setShowSaveFlowModal(false); setFlowToClone(null); }}>
          <motion.div
            className="modal-content glass"
            style={{ maxWidth: '400px' }}
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
          >
            <div className="modal-header">
              <h3>{flowToClone ? 'Clone Flow' : 'New Flow'}</h3>
              <button className="btn-ghost" onClick={() => { setShowSaveFlowModal(false); setFlowToClone(null); }} style={{ padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Flow Name
                </label>
                <input
                  type="text"
                  className="modal-input"
                  value={saveFlowModalName}
                  onChange={(e) => setSaveFlowModalName(e.target.value)}
                  placeholder="e.g. Auth Flow"
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmCreateFlow()
                    if (e.key === 'Escape') { setShowSaveFlowModal(false); setFlowToClone(null); }
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Save To Folder
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="modal-input"
                    value={saveFlowModalPath}
                    readOnly
                    placeholder="Select folder..."
                    style={{
                      flex: 1,
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      fontSize: '12px'
                    }}
                  />
                  <button 
                    className="btn secondary" 
                    onClick={async () => {
                      const res = await window.ultraRpc.pickFolder()
                      if (res.success && res.path) setSaveFlowModalPath(res.path)
                    }}
                    style={{ padding: '0 12px', height: '34px' }}
                  >
                    Browse
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--border-subtle)', padding: '16px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn-ghost" onClick={() => { setShowSaveFlowModal(false); setFlowToClone(null); }}>Cancel</button>
              <button 
                className="btn-primary" 
                onClick={confirmCreateFlow}
                disabled={!saveFlowModalPath}
              >
                {flowToClone ? 'Clone Flow' : 'Create Flow'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

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
                <div style={{ marginTop: '16px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Info size={12} /> This will remove the collection from the application.
                  </p>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: 'var(--danger)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      padding: '4px 0'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={deleteCollectionFiles}
                      onChange={e => setDeleteCollectionFiles(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    Also delete request files from collection
                  </label>
                </div>
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
                    await rpc.deleteCollection({ collectionId: confirmDelete.id, deleteFiles: deleteCollectionFiles })
                    tabsToClose = tabs.filter(t => t.owningCollectionId === confirmDelete.id).map(t => t.id)
                  } else if (confirmDelete.type === 'request' && confirmDelete.collectionId && rpc) {
                    await rpc.deleteRequest({ collectionId: confirmDelete.collectionId, requestId: confirmDelete.id })
                    tabsToClose = [confirmDelete.id]
                  } else if (confirmDelete.type === 'flow' && confirmDelete.collectionId && rpc) {
                    await rpc.deleteFlow({ collectionId: confirmDelete.collectionId, flowId: confirmDelete.id })
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
                    if (rpc) {
                      await rpc.saveEnvironments(newEnvs)
                      await rpc.deleteVault({ envId: confirmDelete.id })
                    }
                    setVaults(prev => {
                      const next = { ...prev }
                      delete next[confirmDelete.id]
                      return next
                    })
                    if (activeEnvId === confirmDelete.id) setActiveEnvId(null)
                  }

                  if (tabsToClose.length > 0) {
                    setTabs(prev => {
                      const remaining = prev.filter(t => !tabsToClose.includes(t.id))
                      if (remaining.length === 0) {
                        const newReq = createEmptyRequest()
                        const newTab: Tab = { id: newReq.id, type: 'request', request: newReq, isDirty: false }
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
                  setDeleteCollectionFiles(false)
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

      {/* Tab Groups Modal */}
      {showTabGroupsModal && (
        <TabGroupsModal
          groups={tabGroups}
          tabCountPerGroup={tabGroups.reduce((acc, g) => {
            acc[g.id] = tabs.filter(t => t.groupId === g.id).length
            return acc
          }, {} as Record<string, number>)}
          onUpdateGroup={handleUpdateGroup}
          onDeleteGroup={handleDeleteGroup}
          onClose={() => setShowTabGroupsModal(false)}
        />
      )}
      {/* Tab Right-Click Context Menu */}
      {tabContextMenu && (() => {
        const ctxTab = tabs.find(t => t.id === tabContextMenu.tabId)
        const ctxGroup = ctxTab?.groupId ? tabGroups.find(g => g.id === ctxTab.groupId) : null
        return (
          <>
            {/* Click-away backdrop */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
              onClick={() => setTabContextMenu(null)}
            />
            <div
              className="tab-context-menu"
              style={{ top: tabContextMenu.y, left: tabContextMenu.x, zIndex: 9999 }}
              onClick={e => e.stopPropagation()}
            >
              {/* Group section header */}
              <div className="tab-ctx-section-label">Tab Group</div>

              {/* Add to new group */}
              <button
                className="tab-ctx-item"
                onClick={() => addTabToGroup(tabContextMenu.tabId, '__new__')}
              >
                <span className="tab-ctx-dot" style={{ background: 'var(--accent)' }} />
                New group
              </button>

              {/* Add to existing group */}
              {tabGroups.length > 0 && (
                <>
                  <div className="tab-ctx-divider" />
                  <div className="tab-ctx-section-label">Add to group</div>
                  {tabGroups.map(g => (
                    <button
                      key={g.id}
                      className={`tab-ctx-item ${ctxTab?.groupId === g.id ? 'tab-ctx-item-active' : ''}`}
                      onClick={() => addTabToGroup(tabContextMenu.tabId, g.id)}
                    >
                      <span className="tab-ctx-dot" style={{ background: g.color }} />
                      {g.name}
                      {ctxTab?.groupId === g.id && <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.6 }}>current</span>}
                    </button>
                  ))}
                </>
              )}

              {/* Remove from group */}
              {ctxGroup && (
                <>
                  <div className="tab-ctx-divider" />
                  <button
                    className="tab-ctx-item tab-ctx-item-danger"
                    onClick={() => removeTabFromGroup(tabContextMenu.tabId)}
                  >
                    Remove from group
                  </button>
                </>
              )}
            </div>
          </>
        )
      })()}
    </div>
  )
}

export default App
