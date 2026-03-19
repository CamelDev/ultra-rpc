import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus,
  Trash2,
  Edit2,
  Upload,
  ChevronRight,
  ChevronDown,
  FolderSearch,
  Move,
  FolderOpen,
  X,
  Zap,
  Clipboard,
  Folder,
  MoreHorizontal,
  Download,
  Link,
} from 'lucide-react'
import { Tree, type NodeApi, type NodeRendererProps } from 'react-arborist'
import { useTreeOpenState } from '../hooks/useTreeOpenState'
import './CollectionPanel.css'
import type { Collection, CollectionItem, RequestConfig, KeyValuePair } from '../types'

interface Props {
  collections: Collection[]
  onRefresh: () => void
  onOpenRequest: (request: RequestConfig) => void
  onRenameRequest: (reqId: string, newName: string) => void
  onEditVariables: (collection: Collection) => void
  onDeleteRequest: (collectionId: string, requestId: string, requestName: string) => void
  onDeleteFolder: (collectionId: string, folderName: string) => void
  onDeleteCollection: (id: string, name: string) => void
  onMoveCollection: (collectionId: string, currentPath?: string) => void
}

// ─── Create Collection Modal ────────────────────────────────────────────────
interface CreateCollectionModalProps {
  onClose: () => void
  onConfirm: (name: string, path?: string) => void
}

const CreateCollectionModal: React.FC<CreateCollectionModalProps> = ({ onClose, onConfirm }) => {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleBrowse = async () => {
    if (!window.ultraRpc) return
    const res = await window.ultraRpc.pickFolder()
    if (res.success && res.path) {
      setPath(res.path)
    }
  }

  const handleCreate = () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    onConfirm(name.trim(), path || undefined)
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass" onClick={e => e.stopPropagation()} style={{ width: '400px' }}>
        <div className="modal-header">
          <h3>New Collection</h3>
          <button className="btn-ghost" onClick={onClose} style={{ padding: '4px' }}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>NAME</label>
            <input
              autoFocus
              className={error ? 'coll-rename-input--error' : ''}
              placeholder="e.g. My API"
              value={name}
              onChange={e => { setName(e.target.value); setError(null) }}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            {error && <div style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '2px' }}>{error}</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>PATH (OPTIONAL)</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                style={{ flex: 1 }}
                placeholder="Default storage"
                value={path}
                readOnly
              />
              <button className="btn-ghost" onClick={handleBrowse} style={{ padding: '0 12px', background: 'var(--bg-tertiary)' }} title="Pick Folder">
                <FolderOpen size={16} />
              </button>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              If empty, it will be saved in the default app directory.
            </p>
          </div>
        </div>
        <div className="modal-footer" style={{ padding: '16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleCreate}>Create Collection</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

type TreeDataItem = {
  id: string
  realId: string
  name: string
  type: 'collection' | 'folder' | 'request'
  children?: TreeDataItem[]
  request?: RequestConfig
  variables?: KeyValuePair[]
  path?: string
}

interface ContextMenuState {
  x: number
  y: number
  node: TreeDataItem
}

// OS-adaptive label for the file manager
const fileManagerLabel = () => {
  const ua = navigator.userAgent
  if (ua.includes('Macintosh') || ua.includes('Mac OS')) return 'Show in Finder'
  if (ua.includes('Windows')) return 'Show in Explorer'
  return 'Show in Files'
}

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

// ─── Inline Rename Input ───────────────────────────────────────────────────
interface InlineRenameInputProps {
  initialValue: string
  error: string | null
  onConfirm: (val: string) => void
  onCancel: () => void
  onChange?: () => void
}

const InlineRenameInput: React.FC<InlineRenameInputProps> = ({
  initialValue, error, onConfirm, onCancel, onChange
}) => {
  const [val, setVal] = useState(initialValue)

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <input
        className={`coll-rename-input${error ? ' coll-rename-input--error' : ''}`}
        value={val}
        onChange={e => { setVal(e.target.value); if (onChange) onChange() }}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') onConfirm(val)
          if (e.key === 'Escape') onCancel()
        }}
        onKeyUp={e => e.stopPropagation()}
        onKeyPress={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        autoFocus
        style={{ width: '100%' }}
      />
      {error && (
        <div className="coll-rename-error">{error}</div>
      )}
    </div>
  )
}

// ─── Portal Context Menu ────────────────────────────────────────────────────
interface CollContextMenuProps {
  menu: ContextMenuState
  onClose: () => void
  onRename: (id: string, name: string) => void
  onEditVariables: (node: TreeDataItem) => void
  onExport: (id: string) => void
  onCopyPath: (node: TreeDataItem) => void
  onShowInFolder: (realId: string) => void
  onMove: (id: string, path?: string) => void
  onDelete: (id: string, name: string) => void
}

const CollContextMenu: React.FC<CollContextMenuProps> = ({
  menu, onClose,
  onRename, onEditVariables, onExport,
  onCopyPath, onShowInFolder, onMove, onDelete,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  // Adjust position so the menu doesn't overflow the viewport
  const [adjustedPos, setAdjustedPos] = useState({ x: menu.x, y: menu.y })
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    let { x, y } = menu
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8
    setAdjustedPos({ x, y })
  }, [menu.x, menu.y])

  return createPortal(
    <>
      {/* Invisible backdrop to capture outside clicks */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        onMouseDown={onClose}
      />
      <div
        ref={menuRef}
        className="coll-context-menu"
        style={{
          position: 'fixed',
          left: adjustedPos.x,
          top: adjustedPos.y,
          zIndex: 9999,
          margin: 0,
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        <button onClick={() => { onRename(menu.node.id, menu.node.name); onClose() }}>
          <Edit2 size={12} /> Rename
        </button>
        <button onClick={() => { onEditVariables(menu.node); onClose() }}>
          <Zap size={12} /> Variables
        </button>
        <button onClick={() => { onExport(menu.node.id); onClose() }}>
          <Download size={12} /> Export
        </button>
        <div className="coll-context-divider" />
        <button onClick={() => { onCopyPath(menu.node); onClose() }}>
          <Clipboard size={12} /> Copy path
        </button>
        <button onClick={() => { onShowInFolder(menu.node.realId); onClose() }}>
          <FolderSearch size={12} /> {fileManagerLabel()}
        </button>
        <button onClick={() => { onMove(menu.node.realId, menu.node.path); onClose() }}>
          <Move size={12} /> Move collection
        </button>
        <div className="coll-context-divider" />
        <button
          className="coll-danger-action"
          onClick={() => { onDelete(menu.node.id, menu.node.name); onClose() }}
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </>,
    document.body
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────
const CollectionPanel: React.FC<Props> = ({
  collections,
  onRefresh,
  onOpenRequest,
  onRenameRequest,
  onEditVariables,
  onDeleteRequest,
  onDeleteFolder,
  onDeleteCollection,
  onMoveCollection,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const { treeRef, initialOpenState, onToggle } = useTreeOpenState()

  const containerRef = React.useRef<HTMLDivElement>(null)
  const [treeHeight, setTreeHeight] = useState(400)

  React.useEffect(() => {
    if (!containerRef.current) return
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setTreeHeight(entry.contentRect.height)
        }
      }
    })
    resizeObserver.observe(containerRef.current)
    return () => resizeObserver.disconnect()
  }, [])

  const treeData = useMemo<TreeDataItem[]>(() => {
    const usedIds = new Set<string>()
    const ensureUnique = (id: string): string => {
      let finalId = id
      let counter = 1
      while (usedIds.has(finalId)) {
        finalId = `${id}_dup_${counter++}`
      }
      usedIds.add(finalId)
      return finalId
    }

    const mapItems = (items: CollectionItem[]): TreeDataItem[] => {
      return items.map(item => ({
        id: ensureUnique(item.id),
        realId: item.id,
        name: item.name,
        type: item.type as 'folder' | 'request',
        children: item.children ? mapItems(item.children) : undefined,
        request: item.request,
      }))
    }

    return collections.map(coll => ({
      id: ensureUnique(coll.id),
      realId: coll.id,
      name: coll.name,
      type: 'collection' as const,
      children: mapItems(coll.children || []),
      variables: coll.variables,
      path: coll.path,
    }))
  }, [collections])

  const findCollectionIdForId = useCallback((realId: string, items: TreeDataItem[], parentCollId: string): string | null => {
    for (const item of items) {
      if (item.realId === realId) return parentCollId
      if (item.children) {
        const found = findCollectionIdForId(realId, item.children, parentCollId)
        if (found) return found
      }
    }
    return null
  }, [])

  const getCollectionIdOfNode = (node: NodeApi<TreeDataItem> | null): string | null => {
    let current: NodeApi<TreeDataItem> | null = node
    while (current) {
      if (current.data.type === 'collection') return current.data.id
      current = current.parent
    }
    return null
  }

  const onMove = async ({ dragIds, parentId, index }: { dragIds: string[], parentId: string | null, index: number }) => {
    if (!window.ultraRpc || !treeRef.current) return

    const targetNode = parentId ? treeRef.current.get(parentId) : null
    const targetParentRealId = targetNode ? targetNode.data.realId : null

    for (const id of dragIds) {
      const draggedNode = treeRef.current.get(id)
      if (!draggedNode) continue
      const realItemId = draggedNode.data.realId

      let collectionId: string | null = null
      for (const coll of treeData) {
        if (coll.realId === realItemId) continue
        if (findCollectionIdForId(realItemId, coll.children || [], coll.realId)) {
          collectionId = coll.realId
          break
        }
      }

      if (collectionId) {
        const isTargetRoot = collections.some(c => c.id === targetParentRealId)
        const targetParentIdForBackend = isTargetRoot ? null : targetParentRealId

        await window.ultraRpc.moveItem({
          collectionId,
          itemId: realItemId,
          targetParentId: targetParentIdForBackend,
          newIndex: index
        })
      }
    }
    onRefresh()
  }

  const handleCreateCollection = async (name: string, path?: string) => {
    if (window.ultraRpc) {
      const res = await window.ultraRpc.createCollection({ name, path })
      if (res.success) {
        setShowCreateModal(false)
        onRefresh()
      } else {
        // We could show an alert or just let the user try again
        alert(res.error || 'Failed to create collection')
      }
    }
  }

  const handleLinkCollection = async () => {
    if (window.ultraRpc) {
      const res = await window.ultraRpc.linkCollection()
      if (res.success) {
        onRefresh()
      } else if (res.error !== 'Cancelled') {
        alert(res.error || 'Failed to link collection')
      }
    }
  }

  const handleRename = async (node: NodeApi<TreeDataItem>, newValue?: string, dismissOnBlur = true) => {
    const freshName = (newValue ?? nameInput).trim()
    if (!freshName || !window.ultraRpc) {
      if (dismissOnBlur) { setEditingId(null); setRenameError(null) }
      return
    }

    const collectionId = getCollectionIdOfNode(node)
    if (!collectionId) return

    if (node.data.type === 'collection') {
      const result = await window.ultraRpc.renameCollection({ collectionId: node.data.realId, newName: freshName })
      if (!result.success) {
        setRenameError(result.error || 'Rename failed')
        return
      }
      setRenameError(null)
    } else if (node.data.type === 'request' && node.data.request) {
      const updatedRequest = { ...node.data.request, name: freshName }
      await window.ultraRpc.saveRequest({ collectionId, request: updatedRequest as RequestConfig })
      onRenameRequest(node.data.id, updatedRequest.name)
    }

    setEditingId(null)
    onRefresh()
  }

  const importCollection = async () => {
    if (window.ultraRpc) {
      const result = await window.ultraRpc.importCollection()
      if (result.success) onRefresh()
    }
  }

  const openFolder = async () => {
    if (window.ultraRpc) {
      const result = await window.ultraRpc.openFolder()
      if (result.success) onRefresh()
    }
  }

  // ─── Context menu action handlers ───────────────────────────────────────
  const handleMenuCopyPath = async (node: TreeDataItem) => {
    let collPath = node.path
    if (!collPath) {
      const res = await window.ultraRpc?.getCollectionPath({ collectionId: node.realId })
      collPath = res?.path
    }
    if (collPath) navigator.clipboard.writeText(collPath)
  }

  const handleMenuShowInFolder = (realId: string) => {
    window.ultraRpc?.showCollectionInFolder({ collectionId: realId })
  }

  // ─── Node Renderer ───────────────────────────────────────────────────────
  const NodeRenderer = useMemo(() => {
    return ({ node, style, dragHandle }: NodeRendererProps<TreeDataItem>) => {
      const isEditing = editingId === node.data.id
      const type = node.data.type
      const isCollection = type === 'collection'
      const isFolder = type === 'folder'
      const isRequest = type === 'request'
      const request = node.data.request

      const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation()
        const collectionId = getCollectionIdOfNode(node)
        if (!collectionId) return

        if (isFolder) {
          onDeleteFolder(collectionId, node.data.name)
        } else if (isRequest && request) {
          onDeleteRequest(collectionId, node.data.id, request.name || 'Untitled')
        }
      }

      const openContextMenu = (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, node: node.data })
      }

      return (
        <div
          ref={dragHandle as (el: HTMLDivElement | null) => void}
          style={style}
          className={`tree-node ${node.isSelected ? 'selected' : ''}`}
          onClick={() => {
            if (isRequest && request) onOpenRequest(request)
            else {
              node.toggle()
              onToggle()
            }
          }}
        >
          <div className="tree-node-content" style={{ paddingLeft: node.level * 6 }}>
            {(isCollection || isFolder) && (
              <div className="tree-node-chevron" onClick={(e) => {
                e.stopPropagation()
                node.toggle()
                onToggle()
              }}>
                {node.isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>
            )}
            {!isCollection && !isFolder && <div style={{ width: 0 }} />}

            {(isCollection || isFolder) && (
              <div className="tree-node-icon">
                <Folder size={16} className={isCollection ? 'collection-icon' : 'folder-icon'} />
              </div>
            )}

            {isRequest && request && (
              <span className="coll-req-method-label" style={{
                color: methodColor(request.type === 'GRPC' ? 'GRPC' : request.method),
                borderColor: methodColor(request.type === 'GRPC' ? 'GRPC' : request.method) + '44'
              }}>
                {request.type === 'GRPC' ? 'gRPC' : request.method}
              </span>
            )}

            {isEditing ? (
              <InlineRenameInput
                initialValue={nameInput}
                error={renameError}
                onConfirm={(val) => handleRename(node, val)}
                onCancel={() => { setEditingId(null); setRenameError(null) }}
                onChange={() => setRenameError(null)}
              />
            ) : (
              <span className="tree-node-name">
                {isRequest && request ? (request.name || request.url || 'Untitled') : node.data.name}
              </span>
            )}

            {(isCollection || isFolder) && <span className="coll-count">{node.data.children?.length || 0}</span>}

            <div className="tree-node-actions" onClick={e => e.stopPropagation()}>
              {isCollection ? (
                <button
                  className="btn-ghost coll-action-btn"
                  onClick={openContextMenu}
                >
                  <MoreHorizontal size={13} />
                </button>
              ) : (
                <>
                  <button
                    className="coll-req-btn"
                    data-tooltip="Rename"
                    data-tooltip-pos="top"
                    onClick={() => { setEditingId(node.data.id); setNameInput(isRequest && request ? request.name : node.data.name) }}
                  >
                    <Edit2 size={11} />
                  </button>
                  <button className="coll-req-btn danger" data-tooltip="Delete" data-tooltip-pos="top" onClick={handleDelete}>
                    <Trash2 size={11} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )
    }
  }, [
    editingId,
    onOpenRequest, onEditVariables,
    onDeleteRequest, onDeleteFolder, onDeleteCollection, getCollectionIdOfNode, handleRename, onToggle
  ])

  return (
    <div className="coll-panel">
      <div className="coll-header">
        <span className="coll-title">
          <Folder size={14} /> Collections
        </span>
        <div className="coll-header-actions">
          <button className="btn-ghost" onClick={() => setShowCreateModal(true)} data-tooltip="New Collection" data-tooltip-pos="bottom">
            <Plus size={16} />
          </button>
          <button className="btn-ghost" onClick={handleLinkCollection} data-tooltip="Link existing folder" data-tooltip-pos="bottom">
            <Link size={14} />
          </button>
          <button className="btn-ghost coll-btn" onClick={importCollection} data-tooltip="Import collection" data-tooltip-pos="bottom">
            <Upload size={14} />
          </button>
          <button className="btn-ghost coll-btn" onClick={openFolder} data-tooltip="Import folder" data-tooltip-pos="bottom">
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      {showCreateModal && (
        <CreateCollectionModal
          onClose={() => setShowCreateModal(false)}
          onConfirm={handleCreateCollection}
        />
      )}

      {collections.length === 0 && !showCreateModal && (
        <div className="coll-empty">
          No collections yet
        </div>
      )}

      <div className="coll-tree-container" ref={containerRef}>
        {initialOpenState === null ? null : (
          <Tree
            ref={treeRef}
            data={treeData}
            onMove={onMove}
            indent={6}
            rowHeight={28}
            width="100%"
            height={treeHeight}
            disableDrop={(args: any) => args.parentNode?.data?.type === 'request'}
            disableDrag={(node: any) => node.data?.type === 'collection'}
            initialOpenState={initialOpenState}
            openByDefault={false}
          >
            {NodeRenderer}
          </Tree>
        )}
      </div>

      {/* Portal-rendered context menu — lives outside tree to avoid overflow clipping */}
      {contextMenu && (
        <CollContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={(id, name) => { setEditingId(id); setNameInput(name) }}
          onEditVariables={(node) => onEditVariables(node as unknown as Collection)}
          onExport={(id) => window.ultraRpc?.exportCollection({ collectionId: id })}
          onCopyPath={handleMenuCopyPath}
          onShowInFolder={handleMenuShowInFolder}
          onMove={onMoveCollection}
          onDelete={onDeleteCollection}
        />
      )}
    </div>
  )
}

export default CollectionPanel
