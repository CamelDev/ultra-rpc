import React, { useState } from 'react'
import {
  Folder,
  Plus,
  Trash2,
  Edit2,
  Save,
  Download,
  Upload,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  FileJson,
  MoreHorizontal,
} from 'lucide-react'
import type { RequestConfig } from '../types'
import './CollectionPanel.css'

interface Collection {
  id: string
  name: string
  requests: RequestConfig[]
}

interface Props {
  collections: Collection[]
  onRefresh: () => void
  onOpenRequest: (request: RequestConfig) => void
  onSaveToCollection: (collectionId: string) => void
}

const CollectionPanel: React.FC<Props> = ({ collections, onRefresh, onOpenRequest, onSaveToCollection }) => {
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

  const deleteCollection = async (id: string) => {
    if (window.ultraRpc) {
      await window.ultraRpc.deleteCollection({ collectionId: id })
      onRefresh()
    }
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

  const deleteRequest = async (collectionId: string, requestId: string) => {
    if (window.ultraRpc) {
      await window.ultraRpc.deleteRequest({ collectionId, requestId })
      onRefresh()
    }
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
        <div className="coll-item" key={coll.id}>
          <div
            className="coll-item-header"
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
            <span className="coll-count">{coll.requests.length}</span>

            <div className="coll-item-actions" onClick={e => e.stopPropagation()}>
              <button
                className="btn-ghost coll-action-btn"
                onClick={() => setContextMenu(contextMenu === coll.id ? null : coll.id)}
              >
                <MoreHorizontal size={13} />
              </button>
            </div>
          </div>

          {/* Context menu */}
          {contextMenu === coll.id && (
            <div className="coll-context-menu" onClick={() => setContextMenu(null)}>
              <button onClick={() => { onSaveToCollection(coll.id); }}>
                <Save size={12} /> Save current request
              </button>
              <button onClick={() => { setEditingId(coll.id); setNameInput(coll.name) }}>
                <Edit2 size={12} /> Rename
              </button>
              <button onClick={() => exportCollection(coll.id)}>
                <Download size={12} /> Export
              </button>
              <div className="coll-context-divider" />
              <button className="coll-danger-action" onClick={() => deleteCollection(coll.id)}>
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}

          {/* Requests list */}
          {expandedId === coll.id && (
            <div className="coll-requests">
              {coll.requests.length === 0 && (
                <div className="coll-no-requests">No requests saved</div>
              )}
              {coll.requests.map(req => (
                <div
                  className="coll-request-item"
                  key={req.id}
                  onClick={() => onOpenRequest(req)}
                >
                  <FileJson size={13} className="coll-req-icon" />
                  <span className="coll-req-method" style={{ color: methodColor(req.type === 'GRPC' ? 'GRPC' : req.method) }}>
                    {req.type === 'GRPC' ? 'gRPC' : req.method}
                  </span>
                  <span className="coll-req-name">{req.name || req.url || 'Untitled'}</span>
                  <button
                    className="coll-req-delete"
                    onClick={(e) => { e.stopPropagation(); deleteRequest(coll.id, req.id) }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default CollectionPanel
