import React, { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Reorder } from 'framer-motion'
import Tooltip from './Tooltip'
import { 
  Search, GitBranch, Plus, Trash2, Folder, 
  Edit2, Move, Copy, Upload, X, Download, 
  MoreHorizontal, FolderSearch 
} from 'lucide-react'
import type { Collection, FlowDefinition } from '../types'
import './FlowPanel.css'

interface ContextMenuState {
  x: number
  y: number
  item: { flow: FlowDefinition; collectionId?: string; collectionName?: string; path: string }
}

const FlowContextMenu: React.FC<{
  menu: ContextMenuState
  onClose: () => void
  onRename: () => void
  onMove: () => void
  onClone: () => void
  onExport: () => void
  onReveal: () => void
  onDelete: () => void
}> = ({ menu, onClose, onRename, onMove, onClone, onExport, onReveal, onDelete }) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [adjustedPos, setAdjustedPos] = useState({ x: menu.x, y: menu.y })

  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    let { x, y } = menu
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8
    setAdjustedPos({ x, y })
  }, [menu])

  const fileManagerLabel = () => {
    const ua = navigator.userAgent
    if (ua.includes('Macintosh') || ua.includes('Mac OS')) return 'Reveal in Finder'
    if (ua.includes('Windows')) return 'Reveal in Explorer'
    return 'Reveal in Files'
  }

  return createPortal(
    <>
      <div 
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }} 
        onMouseDown={onClose} 
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div 
        ref={menuRef}
        className="flow-context-menu"
        style={{ position: 'fixed', left: adjustedPos.x, top: adjustedPos.y, zIndex: 9999 }}
        onMouseDown={e => e.stopPropagation()}
      >
        <button onClick={() => { onRename(); onClose(); }}><Edit2 size={12} /> Rename</button>
        <button onClick={() => { onClone(); onClose(); }}><Copy size={12} /> Clone</button>
        <button onClick={() => { onMove(); onClose(); }}><Move size={12} /> Move...</button>
        <button onClick={() => { onExport(); onClose(); }}><Download size={12} /> Export</button>
        <div className="flow-context-divider" />
        <button onClick={() => { onReveal(); onClose(); }}><FolderSearch size={12} /> {fileManagerLabel()}</button>
        <div className="flow-context-divider" />
        <button className="flow-danger-action" onClick={() => { onDelete(); onClose(); }}><Trash2 size={12} /> Delete</button>
      </div>
    </>,
    document.body
  )
}

interface FlowPanelProps {
  collections: Collection[]
  flows: { flow: FlowDefinition; collectionId?: string; collectionName?: string; path: string }[]
  onOpenFlow: (flow: FlowDefinition, path?: string) => void
  onNewFlow: (parentId?: string) => void
  onDeleteFlow: (collectionId: string, flowId: string, path?: string) => void
  onRenameFlow: (collectionId: string | undefined, flowId: string, newName: string, path?: string) => Promise<void>
  onOpenFile: () => void
  onMoveFlow: (flowId: string, path: string) => void
  onCloneFlow: (flow: FlowDefinition, path: string) => void
  onReorderFlows: (flows: { flow: FlowDefinition; collectionId?: string; collectionName?: string; path: string }[]) => void
}

const FlowPanel: React.FC<FlowPanelProps> = ({ 
  collections, 
  flows,
  onOpenFlow, 
  onNewFlow, 
  onDeleteFlow,
  onRenameFlow,
  onOpenFile,
  onMoveFlow,
  onCloneFlow,
  onReorderFlows
}) => {
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const handleRename = async (collectionId: string | undefined, flow: FlowDefinition, path?: string) => {
    if (!editName.trim() || editName === (flow.name || "")) {
      setEditingId(null)
      return
    }
    await onRenameFlow(collectionId, flow.id, editName.trim(), path)
    setEditingId(null)
  }

  const filteredFlows = useMemo(() => {
    return flows.filter(f => 
      (f.flow.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (f.collectionName && f.collectionName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      f.path.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [flows, searchQuery])

  return (
    <div className="flow-panel fade-in">
      <div className="flow-panel-header">
        <div className="sidebar-section-label">
           <GitBranch size={13} /> Flows
        </div>
        
        <div className="flow-search-wrapper">
          <div className="flow-search-input-container">
            <Search size={12} className="flow-search-icon" />
            <input
              type="text"
              placeholder="Search..."
              className="flow-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="flow-search-clear" onClick={() => setSearchQuery('')}>
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        <div className="flow-panel-actions">
           <Tooltip text="Import Flow File" position="bottom">
             <button 
               className="btn-ghost icon-btn" 
               onClick={onOpenFile} 
             >
               <Upload size={14} />
             </button>
           </Tooltip>
           {collections.length > 0 && (
             <Tooltip text="New Flow" position="bottom">
               <button 
                 className="btn-ghost icon-btn" 
                 onClick={() => onNewFlow(collections[0].id)} 
               >
                 <Plus size={15} />
               </button>
             </Tooltip>
           )}
        </div>
      </div>

      <Reorder.Group 
        axis="y" 
        values={flows} 
        onReorder={onReorderFlows}
        className="flow-list"
        style={{ pointerEvents: searchQuery ? 'none' : 'auto' }}
      >
        {filteredFlows.length === 0 ? (
          <div className="flow-empty">
            {searchQuery ? 'No flows match search' : 'No flows defined yet'}
          </div>
        ) : (
          filteredFlows.map((item) => {
            const { flow, collectionId, collectionName, path } = item
            return (
              <Reorder.Item 
                key={flow.id} 
                value={item}
                className="flow-item"
                onClick={() => onOpenFlow(flow, path)}
                onContextMenu={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  setContextMenu({ x: e.clientX, y: e.clientY, item })
                }}
                dragListener={!searchQuery}
              >
                <div className="flow-item-icon">
                  <GitBranch size={16} />
                </div>
                  <div className="flow-item-info">
                    {editingId === flow.id ? (
                      <input
                        autoFocus
                        className="flow-rename-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => handleRename(collectionId, flow, path)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(collectionId, flow, path)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="flow-item-name">{flow.name}</div>
                    )}
                    <div className="flow-item-meta" title={path}>
                      <Folder size={10} />
                      {collectionName ? (
                        collectionName
                      ) : (
                        <span>
                          {path.split(/[\\/]/).filter(Boolean).reverse()[1] || 'Flows'}
                        </span>
                      )}
                    </div>
                  </div>
                <div className="flow-item-actions" onClick={e => e.stopPropagation()}>
                  <button 
                    className="flow-action-btn more-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setContextMenu({ x: e.clientX, y: e.clientY, item })
                    }}
                    onContextMenu={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, item })
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              </Reorder.Item>
            )
          })
        )}
      </Reorder.Group>

      {contextMenu && (
        <FlowContextMenu 
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={() => {
            setEditingId(contextMenu.item.flow.id)
            setEditName(contextMenu.item.flow.name || "")
          }}
          onMove={() => onMoveFlow(contextMenu.item.flow.id, contextMenu.item.path)}
          onClone={() => onCloneFlow(contextMenu.item.flow, contextMenu.item.path)}
          onExport={() => {
            if (window.ultraRpc) {
              window.ultraRpc.flow.export({ 
                collectionId: contextMenu.item.collectionId || '', 
                flowId: contextMenu.item.flow.id 
              })
            }
          }}
          onReveal={() => {
            if (window.ultraRpc?.showInFolder) {
              window.ultraRpc.showInFolder(contextMenu.item.path)
            }
          }}
          onDelete={() => onDeleteFlow(contextMenu.item.collectionId || '', contextMenu.item.flow.id, contextMenu.item.path)}
        />
      )}
    </div>
  )
}

export default FlowPanel
