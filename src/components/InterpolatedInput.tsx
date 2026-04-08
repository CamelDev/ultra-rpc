import React, { forwardRef } from 'react'
import type { Environment } from '../types'
import Editor, { type EditorHandle } from './Editor'
import './InterpolatedInput.css'

interface Props {
  value: string
  onChange: (value: string) => void
  activeEnv?: Environment | null
  contextVariables?: any[]
  vaultEntries?: any[]
  placeholder?: string
  className?: string
  multiline?: boolean
  highlightJson?: boolean
  highlightJs?: boolean
  wrapLines?: boolean
  onKeyDown?: (e: React.KeyboardEvent) => void,
  onBlur?: () => void,
  disabled?: boolean,
  theme?: 'dark' | 'light'
  style?: React.CSSProperties
  enableSearch?: boolean
  onFollowDefinition?: (name: string) => void
}

const InterpolatedInput = forwardRef<EditorHandle, Props>(function InterpolatedInput({
  value,
  onChange,
    activeEnv,
    contextVariables,
    vaultEntries,
    placeholder,
    className = '',
    multiline = false,
    highlightJson = false,
    highlightJs = false,
    wrapLines = true,
    onKeyDown,
    onBlur,
    disabled = false,
    theme = 'dark',
    style,
    enableSearch = false,
    onFollowDefinition,
  }, ref) {
    const language = highlightJson ? 'json' : (highlightJs ? 'javascript' : 'plain')
    
    return (
      <div className={`interpolated-input-container ${className}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', ...style }}>
        <Editor
          ref={ref}
          value={value}
          onChange={onChange}
          language={language}
          placeholder={placeholder}
          readOnly={disabled}
          singleLine={!multiline}
          wrapLines={wrapLines}
          activeEnv={activeEnv}
          contextVariables={contextVariables}
          vaultEntries={vaultEntries}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          theme={theme}
          enableSearch={enableSearch}
          onFollowDefinition={onFollowDefinition}
        />
      </div>
    )
  })

export default InterpolatedInput
