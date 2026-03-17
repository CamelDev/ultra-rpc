import React, { useState } from 'react'
import {
  Folder,
  Plus,
  Trash2,
  Edit2,
  Download,
  Upload,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  FileJson,
  MoreHorizontal,
  Zap,
  Save,
} from 'lucide-react'
import './CollectionPanel.css'
import type { Collection, CollectionItem, RequestConfig } from '../types'

interface Props {
  collections: Collection[]
  onRefresh: () => void
  onOpenRequest: (request: RequestConfig) => void
  onSaveToCollection: (collectionId: string) => void
  onRenameRequest: (reqId: string, newName: string) => void
  onEditVariables: (collection: Collection) => void
  onDeleteRequest: (collectionId: string, requestId: string, requestName: string) => void
  onDeleteFolder: (collectionId: string, folderName: string) => void
  onDeleteCollection: (id: string, name: string) => void
}

const CollectionItemView: React.FC<{
  item: CollectionItem
  collectionId: string
  level: number
  onOpenRequest: (request: RequestConfig) => void
  onRefresh: () => void
  onRenameRequest: (reqId: string, newName: string) => void
  onDeleteRequest: (collectionId: string, requestId: string, requestName: string) => void
  onDeleteFolder: (collectionId: string, folderName: string) => void
}> = ({ item, collectionId, level, onOpenRequest, onRefresh, onRenameRequest, onDeleteRequest, onDeleteFolder }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [editingReqId, setEditingReqId] = useState<string | null>(null)
  const [reqNameInput, setReqNameInput] = useState('')

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

  const deleteRequest = async (e: React.MouseEvent) => {
    e.stopPropagation()
    onDeleteRequest(collectionId, item.id, item.name || item.request?.name || 'Untitled')
  }

  const deleteFolder = async (e: React.MouseEvent) => {
    e.stopPropagation()
    onDeleteFolder(collectionId, item.name)
  }

  const renameRequest = async (e: React.KeyboardEvent | React.FocusEvent) => {
    if ((e as any).key && (e as any).key !== 'Enter') return
    if (!reqNameInput.trim() || !window.ultraRpc || !item.request) return
    
    const updatedRequest = { ...item.request, name: reqNameInput.trim() }
    await window.ultraRpc.saveRequest({ collectionId, request: updatedRequest as any })
    setEditingReqId(null)
    onRenameRequest(item.id, updatedRequest.name)
    onRefresh()
  }

  if (item.type === 'folder') {
    return (
      <div className="coll-folder">
        <div 
          className="coll-item-header folder-header" 
          style={{ paddingLeft: `${level * 12 + 8}px` }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Folder size={13} className="folder-icon" />
          <span className="coll-name">{item.name}</span>
          <span className="coll-count">{item.items?.length || 0}</span>
          
          <div className="folder-actions" onClick={e => e.stopPropagation()}>
            <button className="coll-req-btn danger" title="Delete Folder" onClick={deleteFolder}>
              <Trash2 size={11} />
            </button>
          </div>
        </div>
        {isExpanded && item.items && (
          <div className="coll-folder-children">
            {item.items.map(child => (
              <CollectionItemView 
                key={child.name || child.id} 
                item={child} 
                collectionId={collectionId}
                level={level + 1}
                onOpenRequest={onOpenRequest}
                onRefresh={onRefresh}
                onRenameRequest={onRenameRequest}
                onDeleteRequest={onDeleteRequest}
                onDeleteFolder={onDeleteFolder}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const req = item.request!
  return (
    <div
      className="coll-request-item"
      style={{ paddingLeft: `${level * 12 + 8}px` }}
      onClick={() => onOpenRequest(req)}
    >
      <FileJson size={13} className="coll-req-icon" />
      <span className="coll-req-method" style={{ color: methodColor(req.type === 'GRPC' ? 'GRPC' : req.method) }}>
        {req.type === 'GRPC' ? 'gRPC' : req.method}
      </span>
      {editingReqId === item.id ? (
        <input
          className="coll-rename-input"
          style={{ flex: 1, padding: '2px 4px' }}
          value={reqNameInput}
          onChange={e => setReqNameInput(e.target.value)}
          onKeyDown={renameRequest}
          onBlur={renameRequest}
          onClick={e => e.stopPropagation()}
          autoFocus
        />
      ) : (
        <span className="coll-req-name">{req.name || req.url || 'Untitled'}</span>
      )}

      <div className="coll-req-actions" onClick={e => e.stopPropagation()}>
        <button
          className="coll-req-btn"
          title="Rename"
          onClick={() => { setEditingReqId(item.id); setReqNameInput(req.name || req.url || '') }}
        >
          <Edit2 size={11} />
        </button>
        <button className="coll-req-btn danger" title="Delete" onClick={deleteRequest}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

const CollectionPanel: React.FC<Props> = ({ collections, onRefresh, onOpenRequest, onSaveToCollection, onRenameRequest, onEditVariables, onDeleteRequest, onDeleteFolder, onDeleteCollection }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [showNewInput, setShowNewInput] = useState(false)
  const [newName, setNewName] = useState('')
  const [contextMenu, setContextMenu] = useState<string | null>(null)

  const createCollection = async () => {
    if (!newName.trim()) return
    if (window.ultraRpc) {
      await window.ultraRpc.createCollection({ name: newName.trim() })
      setNewName('')
      setShowNewInput(false)
      onRefresh()
    }
  }

  const deleteCollection = async (id: string, name: string) => {
    onDeleteCollection(id, name)
  }

  const renameCollection = async (id: string) => {
    if (!nameInput.trim()) return
    if (window.ultraRpc) {
      await window.ultraRpc.renameCollection({ collectionId: id, newName: nameInput.trim() })
      setEditingId(null)
      onRefresh()
    }
  }

  const exportCollection = async (id: string) => {
    if (window.ultraRpc) {
      await window.ultraRpc.exportCollection({ collectionId: id })
    }
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

  return (
    <div className="coll-panel">
      <div className="coll-header">
        <span className="coll-title">
          <Folder size={14} /> Collections
        </span>
        <div className="coll-header-actions">
          <button className="btn-ghost coll-btn" onClick={() => setShowNewInput(!showNewInput)} title="New collection">
            <Plus size={14} />
          </button>
          <button className="btn-ghost coll-btn" onClick={importCollection} title="Import collection">
            <Upload size={14} />
          </button>
          <button className="btn-ghost coll-btn" onClick={openFolder} title="Open folder">
            <FolderOpen size={14} />
          </button>
        </div>
      </div>

      {showNewInput && (
        <div className="coll-new-input">
          <input
            placeholder="Collection name..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createCollection()}
            autoFocus
          />
          <button className="btn-primary coll-create-btn" onClick={createCollection}>
            <Plus size={12} />
          </button>
        </div>
      )}

      {collections.length === 0 && !showNewInput && (
        <div className="coll-empty">
          No collections yet
        </div>
      )}

      {collections.map(coll => (
        <div className="coll-item-group" key={coll.id}>
          <div
            className="coll-item-header collection-root"
            onClick={() => setExpandedId(expandedId === coll.id ? null : coll.id)}
          >
            {expandedId === coll.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {editingId === coll.id ? (
              <input
                className="coll-rename-input"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && renameCollection(coll.id)}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className="coll-name">{coll.name}</span>
            )}
            <span className="coll-count">{coll.items.length}</span>

            <div className="coll-item-actions" onClick={e => e.stopPropagation()}>
              <button
                className="btn-ghost coll-action-btn"
                onClick={() => setContextMenu(contextMenu === coll.id ? null : coll.id)}
              >
                <MoreHorizontal size={13} />
              </button>
            </div>
          </div>

          {contextMenu === coll.id && (
            <div className="coll-context-menu" onClick={() => setContextMenu(null)}>
              <button onClick={() => onSaveToCollection(coll.id)}>
                <Save size={12} /> Save current request
              </button>
              <button onClick={() => { setEditingId(coll.id); setNameInput(coll.name) }}>
                <Edit2 size={12} /> Rename
              </button>
              <button onClick={() => onEditVariables(coll)}>
                <Zap size={12} /> Variables
              </button>
              <button onClick={() => exportCollection(coll.id)}>
                <Download size={12} /> Export
              </button>
              <div className="coll-context-divider" />
              <button className="coll-danger-action" onClick={() => deleteCollection(coll.id, coll.name)}>
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}

          {expandedId === coll.id && (
            <div className="coll-tree">
              {coll.items.length === 0 && (
                <div className="coll-no-requests">No requests saved</div>
              )}
              {coll.items.map(item => (
                <CollectionItemView 
                  key={item.name || item.id} 
                  item={item} 
                  collectionId={coll.id}
                  level={0}
                  onOpenRequest={onOpenRequest}
                  onRefresh={onRefresh}
                  onRenameRequest={onRenameRequest}
                  onDeleteRequest={onDeleteRequest}
                  onDeleteFolder={onDeleteFolder}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default CollectionPanel
