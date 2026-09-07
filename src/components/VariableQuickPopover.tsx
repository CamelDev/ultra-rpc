import React, { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Variable, X, Check, Save, Folder, Globe, Shield } from 'lucide-react'
import type { VariableSource } from '../lib/variable-utils'
import './VariableQuickPopover.css'

function computePopoverPosition(x: number, y: number) {
  const popoverWidth = 320
  const popoverHeight = 180
  const padding = 12
  const innerWidth = typeof window !== 'undefined' ? window.innerWidth : 1000

  let left = x - popoverWidth / 2
  if (left < padding) left = padding
  if (left + popoverWidth > innerWidth - padding) {
    left = innerWidth - popoverWidth - padding
  }

  const spaceAbove = y
  const isBelow = spaceAbove < popoverHeight + 30
  const top = isBelow ? y + 14 : y - 10
  const transform = isBelow ? 'none' : 'translateY(-100%)'

  return { left, top, transform, isBelow }
}

export interface VariableQuickPopoverProps {
  varName: string
  currentValue: string
  source: VariableSource
  sourceLabel: string
  collectionName?: string
  environmentName?: string
  canSaveCollection: boolean
  canSaveEnvironment: boolean
  x: number
  y: number
  onClose: () => void
  onSave: (name: string, value: string, scope: 'collection' | 'environment') => void | Promise<void>
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export const VariableQuickPopover: React.FC<VariableQuickPopoverProps> = ({
  varName,
  currentValue,
  source,
  sourceLabel,
  collectionName,
  environmentName,
  canSaveCollection,
  canSaveEnvironment,
  x,
  y,
  onClose,
  onSave,
  onMouseEnter,
  onMouseLeave,
}) => {
  const [value, setValue] = useState(currentValue)
  const [targetScope, setTargetScope] = useState<'collection' | 'environment'>(() => {
    if (source === 'collection') return 'collection'
    if (source === 'environment') return 'environment'
    return canSaveCollection ? 'collection' : 'environment'
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pos = useMemo(() => computePopoverPosition(x, y), [x, y])

  // Synchronize value if currentValue changes

  // Focus and select input on open
  useEffect(() => {
    if (source !== 'vault' && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [source])

  // Dismiss on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  // Keyboard navigation: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleSave = async () => {
    if (isSaving || source === 'vault') return
    setIsSaving(true)
    try {
      await onSave(varName, value, targetScope)
      setIsSaved(true)
      setTimeout(() => {
        setIsSaved(false)
        onClose()
      }, 600)
    } catch (err) {
      console.error('Failed to save variable:', err)
    } finally {
      setIsSaving(false)
    }
  }

  return createPortal(
    <div
      className="var-quick-popover-anchor"
      style={{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
        transform: pos.transform,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={popoverRef}
        className={`var-quick-popover glass ${pos.isBelow ? 'popover-below' : 'popover-above'}`}
      >
        {/* Header */}
      <div className="var-quick-header">
        <div className="var-quick-title-group">
          <Variable size={14} className="var-quick-icon" />
          <span className="var-quick-name">{`{{${varName}}}`}</span>
          <span className={`var-quick-badge source-${source}`}>
            {sourceLabel}
          </span>
        </div>
        <button
          className="var-quick-close-btn"
          onClick={onClose}
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      {source === 'vault' ? (
        <div className="var-quick-vault-note">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', fontWeight: 600, color: 'var(--purple)' }}>
            <Shield size={13} /> Vault Secret (Encrypted)
          </div>
          This variable is securely stored in your OS keychain. To modify its value, use the Environment Vault panel.
        </div>
      ) : (
        <>
          {/* Scope Selector */}
          {(canSaveCollection || canSaveEnvironment) && (
            <div className="var-quick-scope-row">
              <span className="var-quick-label">Save to:</span>
              <div className="var-quick-scope-pills">
                {canSaveCollection && (
                  <button
                    type="button"
                    className={`var-quick-scope-pill ${targetScope === 'collection' ? 'active' : ''}`}
                    onClick={() => setTargetScope('collection')}
                    title={collectionName ? `Collection: ${collectionName}` : 'Collection Variables'}
                  >
                    <Folder size={11} />
                    <span>{collectionName || 'Collection'}</span>
                  </button>
                )}
                {canSaveEnvironment && (
                  <button
                    type="button"
                    className={`var-quick-scope-pill ${targetScope === 'environment' ? 'active' : ''}`}
                    onClick={() => setTargetScope('environment')}
                    title={environmentName ? `Environment: ${environmentName}` : 'Active Environment'}
                  >
                    <Globe size={11} />
                    <span>{environmentName || 'Environment'}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Value Input */}
          <div className="var-quick-input-group">
            <span className="var-quick-label">Value:</span>
            <input
              ref={inputRef}
              type="text"
              className="var-quick-input"
              placeholder={source === 'undefined' ? `Enter value for {{${varName}}}...` : 'Variable value'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSave()
                }
              }}
            />
          </div>

          {/* Footer Actions */}
          <div className="var-quick-actions">
            <span className="var-quick-hint">
              <kbd>↵</kbd> Save &bull; <kbd>Esc</kbd> Close
            </span>
            <button
              type="button"
              className={`var-quick-save-btn ${isSaved ? 'saved' : ''}`}
              disabled={isSaving}
              onClick={handleSave}
            >
              {isSaved ? (
                <>
                  <Check size={12} /> Saved!
                </>
              ) : (
                <>
                  <Save size={12} /> Save
                </>
              )}
            </button>
          </div>
        </>
      )}
      </div>
    </div>,
    document.body
  )
}
export default VariableQuickPopover
