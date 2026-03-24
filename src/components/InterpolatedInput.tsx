import React, { forwardRef } from 'react'
import type { Environment } from '../types'
import Editor, { type EditorHandle } from './Editor'
import './InterpolatedInput.css'

interface Props {
  value: string
  onChange: (value: string) => void
  activeEnv?: Environment | null
  collectionVariables?: any[]
  placeholder?: string
  className?: string
  multiline?: boolean
  highlightJson?: boolean
  highlightJs?: boolean
  wrapLines?: boolean
  onKeyDown?: (e: React.KeyboardEvent) => void
  disabled?: boolean
  theme?: 'dark' | 'light'
  style?: React.CSSProperties
  enableSearch?: boolean
}

const InterpolatedInput = forwardRef<EditorHandle, Props>(function InterpolatedInput({
  value,
  onChange,
  activeEnv,
  collectionVariables,
  placeholder,
  className = '',
  multiline = false,
  highlightJson = false,
  highlightJs = false,
  wrapLines = true,
  onKeyDown,
  disabled = false,
  theme = 'dark',
  style,
  enableSearch = false,
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
        collectionVariables={collectionVariables}
        onKeyDown={onKeyDown}
        theme={theme}
        enableSearch={enableSearch}
      />
    </div>
  )
})

export default InterpolatedInput
