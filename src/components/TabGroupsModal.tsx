import React, { useState } from 'react'
import { X, Trash2, Eye, EyeOff, Layers, Edit2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { TabGroup } from '../types'
import './TabGroupsModal.css'

const GROUP_COLORS = [
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#6366f1', // indigo
]

interface TabGroupsModalProps {
  groups: TabGroup[]
  tabCountPerGroup: Record<string, number>
  onUpdateGroup: (groupId: string, updates: Partial<TabGroup>) => void
  onDeleteGroup: (groupId: string) => void
  onClose: () => void
}

const TabGroupsModal: React.FC<TabGroupsModalProps> = ({
  groups,
  tabCountPerGroup,
  onUpdateGroup,
  onDeleteGroup,
  onClose,
}) => {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const handleDeleteClick = (groupId: string) => {
    setConfirmDeleteId(groupId)
  }

  const handleConfirmDelete = () => {
    if (confirmDeleteId) {
      onDeleteGroup(confirmDeleteId)
      setConfirmDeleteId(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        className="modal-content tab-groups-modal"
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Layers size={18} style={{ color: 'var(--accent)' }} />
            <h3>Tab Groups</h3>
          </div>
          <button className="btn-ghost" onClick={onClose} style={{ padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body tab-groups-modal-body">
          {groups.length === 0 ? (
            <div className="tab-groups-empty">
              <Layers size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
              <p>No tab groups yet.</p>
              <p style={{ fontSize: '12px', marginTop: '4px' }}>
                Drag one tab onto another to create a group.
              </p>
            </div>
          ) : (
            <div className="tab-groups-list">
              {groups.map(group => (
                <div key={group.id} className="tab-group-row">
                  {/* Color swatch + name */}
                  <div className="tab-group-info">
                    <div
                      className="tab-group-color-dot"
                      style={{ background: group.color }}
                    />
                    {editingGroupId === group.id ? (
                      <input
                        className="tab-group-rename-input"
                        autoFocus
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={() => {
                          if (editingName.trim() && editingName.trim() !== group.name) {
                            onUpdateGroup(group.id, { name: editingName.trim() })
                          }
                          setEditingGroupId(null)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur()
                          }
                          if (e.key === 'Escape') {
                            setEditingGroupId(null)
                          }
                        }}
                        style={{
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          fontSize: '13px',
                          width: '120px',
                          outline: 'none',
                          marginRight: '8px'
                        }}
                      />
                    ) : (
                      <>
                        <span 
                          className="tab-group-name" 
                          title="Double-click to rename"
                          onDoubleClick={() => {
                            setEditingGroupId(group.id)
                            setEditingName(group.name)
                          }}
                        >
                          {group.name}
                        </span>
                        <button
                          className="btn-ghost tab-group-action-btn tab-group-rename-btn"
                          title="Rename group"
                          onClick={() => {
                            setEditingGroupId(group.id)
                            setEditingName(group.name)
                          }}
                          style={{ marginLeft: '4px', padding: '2px', opacity: 0.6 }}
                        >
                          <Edit2 size={13} />
                        </button>
                      </>
                    )}
                    <span className="tab-group-count">
                      {tabCountPerGroup[group.id] ?? 0} tab{(tabCountPerGroup[group.id] ?? 0) !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Color picker */}
                  <div className="tab-group-colors">
                    {GROUP_COLORS.map(color => (
                      <button
                        key={color}
                        className={`tab-group-color-btn ${group.color === color ? 'active' : ''}`}
                        style={{ background: color }}
                        title={color}
                        onClick={() => onUpdateGroup(group.id, { color })}
                      />
                    ))}
                  </div>

                  {/* Controls */}
                  <div className="tab-group-actions">
                    <button
                      className={`btn-ghost tab-group-action-btn ${group.isHidden ? 'tg-action-active' : ''}`}
                      title={group.isHidden ? 'Show group' : 'Hide group'}
                      onClick={() => onUpdateGroup(group.id, { isHidden: !group.isHidden })}
                    >
                      {group.isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                    <button
                      className="btn-ghost tab-group-action-btn tab-group-delete-btn"
                      title="Delete group (ungroups tabs)"
                      onClick={() => handleDeleteClick(group.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inline delete confirmation */}
        <AnimatePresence>
          {confirmDeleteId && (
            <motion.div
              className="tab-groups-confirm-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="tab-groups-confirm-box">
                <p>Delete group <strong>"{groups.find(g => g.id === confirmDeleteId)?.name}"</strong>?</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Tabs will be ungrouped — not closed.
                </p>
                <div className="tab-groups-confirm-actions">
                  <button className="btn-ghost" onClick={() => setConfirmDeleteId(null)}>
                    Cancel
                  </button>
                  <button
                    style={{ background: 'var(--danger)', color: 'white', padding: '6px 16px', borderRadius: '6px' }}
                    onClick={handleConfirmDelete}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

export default TabGroupsModal
