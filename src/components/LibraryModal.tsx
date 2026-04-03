import React, { useState, useEffect, useCallback, useRef } from 'react'
import Editor, { type EditorHandle } from './Editor'
import type { Library } from '../types'
import { AlertTriangle, Plus, Link, Save, Trash2, FilePlus, FolderSearch, ShieldCheck, Pencil, Code, Copy, Check, X } from 'lucide-react'
import { motion, AnimatePresence, useDragControls } from 'framer-motion'
import { useScriptValidation } from '../hooks/useScriptValidation'
import ValidationBanner from './ValidationBanner'
import './LibraryModal.css'

interface LibraryModalProps {
  isOpen: boolean
  onClose: () => void
  libraries: Library[]
  onSave: (libraries: Library[]) => void
  initialWidth?: number
  initialHeight?: number
  onResize?: (width: number, height: number) => void
  theme?: 'dark' | 'light'
  initialSelectedId?: string | null
}

function basename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath
}

function detectCollisions(scripts: { name: string; content: string }[]): Record<string, string[]> {
  const keyOwners: Record<string, string[]> = {}
  for (const script of scripts) {
    const lines = script.content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
      const m = trimmed.match(/ultra\.lib\.(\w+)\s*=/)
      if (m) {
        const key = m[1]
        if (!keyOwners[key]) keyOwners[key] = []
        if (!keyOwners[key].includes(script.name)) keyOwners[key].push(script.name)
      }
    }
  }
  return Object.fromEntries(Object.entries(keyOwners).filter(([, owners]) => owners.length > 1))
}

const LibraryModal: React.FC<LibraryModalProps> = ({
  isOpen,
  onClose,
  libraries,
  onSave,
  initialWidth = 1100,
  initialHeight = 760,
  onResize,
  theme = 'dark',
  initialSelectedId = null
}) => {
  const [localLibs, setLocalLibs] = useState<Library[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [fileContents, setFileContents] = useState<Record<string, string>>({})
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set())
  const [collisions, setCollisions] = useState<Record<string, string[]>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  
  const selectedLib = localLibs.find(l => l.id === selectedId)
  const collisionKeys = Object.keys(collisions)
  const dragControls = useDragControls()
  
  const { validationStatus, validationError, validate, resetValidation } = useScriptValidation()
  const editorRef = useRef<EditorHandle>(null)

  // Resizing state
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight })
  const sizeRef = useRef(size)
  useEffect(() => { sizeRef.current = size }, [size])

  const [sidebarWidth, setSidebarWidth] = useState(240)
  const sidebarWidthRef = useRef(sidebarWidth)
  useEffect(() => { sidebarWidthRef.current = sidebarWidth }, [sidebarWidth])

  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      // Full initialization on OPEN
      setLocalLibs(libraries)
      setSelectedId(initialSelectedId || libraries[0]?.id || null)
      setFileContents({})
      setDirtyIds(new Set())
      setSize({ width: initialWidth, height: initialHeight })
      resetValidation()
    } else if (isOpen && wasOpenRef.current) {
      // Partial sync while ALREADY OPEN (e.g. from external source)
      // We only update localLibs, but we don't wipe fileContents or change selection
      // unless the selectedId no longer exists in libraries
      setLocalLibs(libraries)
      if (selectedId && !libraries.find(l => l.id === selectedId)) {
        setSelectedId(libraries[0]?.id || null)
      }
    }
    wasOpenRef.current = isOpen
  }, [isOpen, libraries, initialWidth, initialHeight, initialSelectedId])

  // Proper resize handler
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    const startWidth = size.width
    const startHeight = size.height

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      const deltaY = moveEvent.clientY - startY
      const newWidth = Math.max(600, startWidth + deltaX)
      const newHeight = Math.max(400, startHeight + deltaY)

      setSize({ width: newWidth, height: newHeight })
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (onResize) onResize(sizeRef.current.width, sizeRef.current.height)
    };

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const handleSidebarResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startWidth = sidebarWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      // Allow between 150px and 500px or up to 50% of the modal width
      const newWidth = Math.max(150, Math.min(500, startWidth + deltaX))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Load file contents when selection changes
  useEffect(() => {
    if (!selectedId) return
    const lib = localLibs.find(l => l.id === selectedId)
    if (!lib || fileContents[selectedId] !== undefined) return
    window.ultraRpc?.readFileContents(lib.filePath).then(res => {
      if (res.success && res.content !== undefined) {
        setFileContents(prev => ({ ...prev, [selectedId]: res.content! }))
      } else {
        setFileContents(prev => ({ ...prev, [selectedId]: `// Could not read file: ${lib.filePath}` }))
      }
    })
  }, [selectedId, localLibs])

  // Recompute collisions
  useEffect(() => {
    const enabledLibs = localLibs.filter(l => l.enabled)
    const scripts = enabledLibs
      .filter(l => fileContents[l.id] !== undefined)
      .map(l => ({ name: l.name, content: fileContents[l.id] }))

    const missing = enabledLibs.filter(l => fileContents[l.id] === undefined)
    if (missing.length > 0) {
      Promise.all(missing.map(l =>
        window.ultraRpc?.readFileContents(l.filePath).then(res => ({
          id: l.id,
          name: l.name,
          content: res.success ? (res.content || '') : ''
        }))
      )).then(results => {
        const newContents: Record<string, string> = {}
        results.forEach(r => { if (r) newContents[r.id] = r.content })
        setFileContents(prev => ({ ...prev, ...newContents }))
      })
    }
    setCollisions(detectCollisions(scripts))
  }, [localLibs, fileContents])

  const confirmSwitchAway = useCallback((targetId: string) => {
    if (selectedId && dirtyIds.has(selectedId)) {
      if (!confirm('You have unsaved changes. Discard and switch?')) return false
      setDirtyIds(prev => { const s = new Set(prev); s.delete(selectedId); return s })
    }
    setSelectedId(targetId)
    resetValidation()
    return true
  }, [selectedId, dirtyIds, resetValidation])

  const handleNew = async () => {
    const res = await window.ultraRpc?.saveNewJsFile()
    if (!res?.success || !res.path) return
    const newLib: Library = {
      id: Math.random().toString(36).substring(2, 11),
      name: basename(res.path),
      filePath: res.path,
      enabled: true,
    }
    const template = '// Register functions on ultra.lib to use them in your scripts:\n// ultra.lib.myFunction = (arg) => { return arg }\n'
    const updated = [...localLibs, newLib]
    setLocalLibs(updated)
    setFileContents(prev => ({ ...prev, [newLib.id]: template }))
    setSelectedId(newLib.id)
    onSave(updated)
  }

  const handleLink = async () => {
    const res = await window.ultraRpc?.pickJsFile()
    if (!res?.success || !res.path) return
    const newLib: Library = {
      id: Math.random().toString(36).substring(2, 11),
      name: basename(res.path),
      filePath: res.path,
      enabled: true,
    }
    const updated = [...localLibs, newLib]
    setLocalLibs(updated)
    setSelectedId(newLib.id)
    onSave(updated)
  }

  const handleSave = async () => {
    if (!selectedId) return
    const lib = localLibs.find(l => l.id === selectedId)
    if (!lib) return
    const content = fileContents[selectedId] ?? ''
    const res = await window.ultraRpc?.writeFileContents(lib.filePath, content)
    if (res?.success) {
      setDirtyIds(prev => { const s = new Set(prev); s.delete(selectedId); return s })
    }
  }

  const handleClose = useCallback(() => {
    if (dirtyIds.size > 0) {
      if (!confirm(`You have unsaved changes in ${dirtyIds.size} script(s). Are you sure you want to close?`)) return
    }
    onClose()
  }, [onClose, dirtyIds])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  const handleSaveAs = async () => {
    if (!selectedId) return
    const content = fileContents[selectedId] ?? ''
    const res = await window.ultraRpc?.saveFileAs(content)
    if (!res?.success || !res.path) return
    const newLib: Library = {
      id: Math.random().toString(36).substring(2, 11),
      name: basename(res.path),
      filePath: res.path,
      enabled: true,
    }
    const updated = [...localLibs, newLib]
    setLocalLibs(updated)
    setFileContents(prev => ({ ...prev, [newLib.id]: content }))
    setSelectedId(newLib.id)
    onSave(updated)
  }

  const handleDelete = async (id: string) => {
    const lib = localLibs.find(l => l.id === id)
    if (lib) {
      if (!confirm(`Are you sure you want to DELETE "${lib.name}"?\n\nThis will permanently remove the file from your disk.`)) return
      
      const res = await window.ultraRpc?.deleteJsFile(lib.filePath)
      if (res && !res.success) {
        alert(res.error || 'Failed to delete file from disk')
        return
      }
    }
    const next = localLibs.filter(l => l.id !== id)
    setLocalLibs(next)
    setFileContents(prev => { const c = { ...prev }; delete c[id]; return c })
    setDirtyIds(prev => { const s = new Set(prev); s.delete(id); return s })
    if (selectedId === id) setSelectedId(next[0]?.id || null)
    onSave(next)
  }

  const handleRename = async (id: string, newName: string) => {
    const lib = localLibs.find(l => l.id === id)
    if (!lib) return

    const trimmed = newName.trim()
    if (!trimmed || trimmed === lib.name) {
      setEditingId(null)
      setRenameError(null)
      return
    }

    const res = await window.ultraRpc?.renameJsFile({ oldPath: lib.filePath, newName: trimmed })
    if (res?.success && res.newPath) {
      const updated = localLibs.map(l => l.id === id ? { 
        ...l, 
        name: basename(res.newPath!), 
        filePath: res.newPath! 
      } : l)
      
      // Update fileContents cache key if needed (though we use ID, so it's mostly about the meta)
      setLocalLibs(updated)
      setEditingId(null)
      setRenameError(null)
      onSave(updated)
    } else {
      setRenameError(res?.error || 'Failed to rename file')
    }
  }

  const handleShowInFolder = (filePath: string) => {
    window.ultraRpc?.showInFolder(filePath)
  }

  const handleToggleEnabled = (id: string) => {
    const updated = localLibs.map(l => l.id === id ? { ...l, enabled: !l.enabled } : l)
    setLocalLibs(updated)
    onSave(updated)
  }

  const handleEditorChange = (val: string) => {
    if (!selectedId) return
    setFileContents(prev => ({ ...prev, [selectedId]: val }))
    setDirtyIds(prev => new Set(prev).add(selectedId))
    resetValidation()
  }

  const handleValidate = () => {
    if (!selectedId) return
    validate(fileContents[selectedId] ?? '', { checkUltraLib: true })
  }

  const handleCopy = async (id: string, content?: string) => {
    const textToCopy = content ?? fileContents[id] ?? ''
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Failed to copy text:', err)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="library-modal glass floating-window"
          drag
          dragControls={dragControls}
          dragMomentum={false}
          dragListener={false}
          initial={{ opacity: 0, scale: 0.95, x: '-50%', y: '-50%', top: '50%', left: '50%' }}
          animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%', top: '50%', left: '50%' }}
          exit={{ opacity: 0, scale: 0.95 }}
          style={{ width: `${size.width}px`, height: `${size.height}px` }}
        >
          <div 
            className="modal-header drag-handle"
            onPointerDown={(e) => dragControls.start(e)}
            style={{ cursor: 'move' }}
          >
            <h3>Code Library</h3>
            <button className="btn-ghost btn-close-header" onClick={handleClose}>
              <X size={18} />
            </button>
          </div>

        {/* Toolbar */}
        <div className="library-toolbar">
          <button className="btn-ghost" onClick={handleNew}>
            <Plus size={14} /> New
          </button>
          <button className="btn-ghost" onClick={handleLink}>
            <Link size={14} /> Link Script
          </button>
          <div style={{ flex: 1 }} />
          <button 
            className={`btn-ghost ${validationStatus === 'success' ? 'val-success' : validationStatus === 'error' ? 'val-error' : ''}`} 
            onClick={handleValidate}
            disabled={!selectedId}
            title="Check script for syntax errors"
          >
            <ShieldCheck size={14} /> Validate
          </button>
          <button
            className="btn-ghost"
            onClick={() => editorRef.current?.format()}
            disabled={!selectedId}
            title="Prettify code (Shift+Alt+F)"
          >
            <Code size={14} /> Format
          </button>
          <button
            className={`btn-ghost ${copiedId === selectedId ? 'val-success' : ''}`}
            onClick={() => selectedId && handleCopy(selectedId)}
            disabled={!selectedId}
            title="Copy script to clipboard"
          >
            {copiedId === selectedId ? <Check size={14} /> : <Copy size={14} />} Copy
          </button>
          <div style={{ width: '8px' }} />
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={!selectedId || !dirtyIds.has(selectedId)}
          >
            <Save size={14} /> Save
          </button>
          <button
            className="btn-ghost"
            onClick={handleSaveAs}
            disabled={!selectedId}
          >
            <FilePlus size={14} /> Save As…
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left panel: script list */}
          <div className="library-sidebar" style={{ width: `${sidebarWidth}px` }}>
            {localLibs.length === 0 && (
              <div style={{ padding: '20px', color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center' }}>
                No scripts yet.
              </div>
            )}
            {localLibs.map(lib => (
              <div
                key={lib.id}
                className={`library-item ${selectedId === lib.id ? 'selected' : ''}`}
                onClick={() => confirmSwitchAway(lib.id)}
              >
                <input
                  type="checkbox"
                  checked={lib.enabled}
                  onChange={e => { e.stopPropagation(); handleToggleEnabled(lib.id) }}
                  style={{ flexShrink: 0, cursor: 'pointer' }}
                  title={lib.enabled ? 'Enabled' : 'Disabled'}
                />
                <div className="library-item-content">
                  {editingId === lib.id ? (
                    <div style={{ position: 'relative', width: '100%' }}>
                      <input
                        className={`lib-rename-input ${renameError ? 'error' : ''}`}
                        autoFocus
                        value={nameInput}
                        onChange={e => { setNameInput(e.target.value); setRenameError(null) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRename(lib.id, nameInput);
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingId(null);
                            setRenameError(null);
                          }
                        }}
                        onBlur={() => {
                          if (!renameError) handleRename(lib.id, nameInput)
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                      {renameError && <div className="lib-rename-error-tip">{renameError}</div>}
                    </div>
                  ) : (
                    <>
                      <div className="library-item-name">
                        {dirtyIds.has(lib.id) ? '● ' : ''}{lib.name}
                      </div>
                      <div className="library-item-path">
                        {lib.filePath}
                      </div>
                    </>
                  )}
                </div>
                {!editingId && (
                  <>
                    <button
                      className={`lib-item-btn ${copiedId === lib.id ? 'val-success' : ''}`}
                      style={{ opacity: selectedId === lib.id ? 1 : 0.5 }}
                      onClick={async (e) => {
                        e.stopPropagation()
                        let content = fileContents[lib.id]
                        if (content === undefined) {
                          const res = await window.ultraRpc?.readFileContents(lib.filePath)
                          content = (res?.success && res.content !== undefined) ? res.content : ''
                        }
                        handleCopy(lib.id, content)
                      }}
                      title="Copy script content"
                    >
                      {copiedId === lib.id ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    <button
                      className="lib-item-btn"
                      style={{ opacity: selectedId === lib.id ? 1 : 0.5 }}
                      onClick={e => { 
                        e.stopPropagation(); 
                        setEditingId(lib.id); 
                        setNameInput(lib.name.replace(/\.js$/, '')); 
                        setRenameError(null);
                      }}
                      title="Rename script"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="lib-item-btn"
                      style={{ opacity: selectedId === lib.id ? 1 : 0.5 }}
                      onClick={e => { e.stopPropagation(); handleShowInFolder(lib.filePath) }}
                      title={navigator.userAgent.includes('Mac') ? 'Reveal in Finder' : 'Show in Explorer'}
                    >
                      <FolderSearch size={14} />
                    </button>
                    <button
                      className="lib-item-btn danger"
                      style={{ opacity: selectedId === lib.id ? 1 : 0.5 }}
                      onClick={e => { e.stopPropagation(); handleDelete(lib.id) }}
                      title="Remove from library"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Splitter */}
          <div className="library-splitter" onMouseDown={handleSidebarResizeStart}>
            <div className="library-splitter-handle" />
          </div>

          {/* Right panel: editor */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Collision warning */}
            {collisionKeys.length > 0 && (
              <div className="collision-banner">
                <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '1px' }} />
                <div>
                  <strong style={{ color: 'var(--warning)' }}>Name collisions:</strong>{' '}
                  {collisionKeys.map(key => (
                    <span key={key}>
                      <code>ultra.lib.{key}</code> in {collisions[key].join(', ')}{' '}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Validation Results */}
            <ValidationBanner status={validationStatus} error={validationError} />

            {selectedLib ? (
              <div className="library-editor" style={{ flex: 1, overflow: 'hidden' }}>
                <Editor
                  ref={editorRef}
                  value={fileContents[selectedId!] ?? ''}
                  onChange={handleEditorChange}
                  language="javascript"
                  onKeyDown={handleKeyDown}
                  theme={theme}
                />
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                Select a script to edit
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer" style={{ padding: '12px', justifyContent: 'flex-end', display: 'flex' }}>
          <button className="btn-primary btn-large" onClick={handleClose}>Close</button>
          <div className="modal-resizer" onMouseDown={handleResizeStart} />
        </div>
      </motion.div>
      )}
    </AnimatePresence>
  )
}

export default LibraryModal
