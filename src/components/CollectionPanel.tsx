import React, { useState, useMemo, useCallback } from 'react'
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
  MoreHorizontal,
  Zap,
  Save,
} from 'lucide-react'
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from 'react-arborist'
import './CollectionPanel.css'
import type { Collection, CollectionItem, RequestConfig, KeyValuePair } from '../types'

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

type TreeDataItem = {
  id: string; // unique for tree
  realId: string; // actual id on disk
  name: string;
  type: 'collection' | 'folder' | 'request';
  children?: TreeDataItem[];
  request?: RequestConfig;
  variables?: KeyValuePair[];
};

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

const CollectionPanel: React.FC<Props> = ({
  collections,
  onRefresh,
  onOpenRequest,
  onSaveToCollection,
  onRenameRequest,
  onEditVariables,
  onDeleteRequest,
  onDeleteFolder,
  onDeleteCollection,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [showNewInput, setShowNewInput] = useState(false)
  const [newName, setNewName] = useState('')
  const [contextMenu, setContextMenu] = useState<string | null>(null)
  const treeRef = React.useRef<TreeApi<TreeDataItem>>(null)
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

  // Map collections to a single tree data structure with unique IDs
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

    // Convert tree IDs back to real IDs and get target real parent ID
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

  const createCollection = async () => {
    if (!newName.trim()) return
    if (window.ultraRpc) {
      await window.ultraRpc.createCollection({ name: newName.trim() })
      setNewName('')
      setShowNewInput(false)
      onRefresh()
    }
  }

  const handleRename = async (node: NodeApi<TreeDataItem>) => {
    if (!nameInput.trim() || !window.ultraRpc) return
    
    const collectionId = getCollectionIdOfNode(node)
    if (!collectionId) return

    if (node.data.type === 'collection') {
      await window.ultraRpc.renameCollection({ collectionId: node.data.id, newName: nameInput.trim() })
    } else if (node.data.type === 'request' && node.data.request) {
      const updatedRequest = { ...node.data.request, name: nameInput.trim() }
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

      return (
        <div 
          ref={dragHandle as (el: HTMLDivElement | null) => void}
          style={style} 
          className={`tree-node ${node.isSelected ? 'selected' : ''}`}
          onClick={() => {
            if (isRequest && request) onOpenRequest(request)
            else node.toggle()
          }}
        >
          <div className="tree-node-content" style={{ paddingLeft: node.level * 6 }}>
            {/* Chevron for nesting */}
            {(isCollection || isFolder) && (
              <div className="tree-node-chevron" onClick={(e) => { e.stopPropagation(); node.toggle(); }}>
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
              <input
                className="coll-rename-input"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRename(node)}
                onBlur={() => handleRename(node)}
                onClick={e => e.stopPropagation()}
                autoFocus
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
                  onClick={() => setContextMenu(contextMenu === node.data.id ? null : node.data.id)}
                >
                  <MoreHorizontal size={13} />
                </button>
              ) : (
                <>
                  <button
                    className="coll-req-btn"
                    title="Rename"
                    onClick={() => { setEditingId(node.data.id); setNameInput(isRequest && request ? request.name : node.data.name) }}
                  >
                    <Edit2 size={11} />
                  </button>
                  <button className="coll-req-btn danger" title="Delete" onClick={handleDelete}>
                    <Trash2 size={11} />
                  </button>
                </>
              )}
            </div>
          </div>

          {isCollection && contextMenu === node.data.id && (
            <div className="coll-context-menu" onClick={(e) => { e.stopPropagation(); setContextMenu(null); }}>
              <button onClick={() => onSaveToCollection(node.data.id)}>
                <Save size={12} /> Save current request
              </button>
              <button onClick={() => { setEditingId(node.data.id); setNameInput(node.data.name) }}>
                <Edit2 size={12} /> Rename
              </button>
              <button onClick={() => onEditVariables(node.data as unknown as Collection)}>
                <Zap size={12} /> Variables
              </button>
              <button onClick={() => window.ultraRpc?.exportCollection({ collectionId: node.data.id })}>
                <Download size={12} /> Export
              </button>
              <div className="coll-context-divider" />
              <button className="coll-danger-action" onClick={() => onDeleteCollection(node.data.id, node.data.name)}>
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}
        </div>
      )
    }
  }, [
    editingId, nameInput, contextMenu, 
    onOpenRequest, onSaveToCollection, onEditVariables, 
    onDeleteRequest, onDeleteFolder, onDeleteCollection, getCollectionIdOfNode, handleRename
  ])

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

      <div className="coll-tree-container" ref={containerRef}>
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
        >
          {NodeRenderer}
        </Tree>
      </div>
    </div>
  )
}

export default CollectionPanel
