import React from 'react'
import type { Environment } from '../types'
import Editor from './Editor'
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
}

const InterpolatedInput: React.FC<Props> = ({
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
}) => {
  const language = highlightJson ? 'json' : (highlightJs ? 'javascript' : 'plain')
  
  return (
    <div className={`interpolated-input-container ${className}`}>
      <Editor
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
      />
    </div>
  )
}

export default InterpolatedInput
