import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Environment } from '../types'
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
}) => {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  
  // Tooltip state
  const [tooltip, setTooltip] = useState<{ visible: boolean, x: number, y: number, text: string }>({
    visible: false, x: 0, y: 0, text: ''
  })
  const tooltipTimeoutId = useRef<any>(null)

  // Sync scrolling
  const handleScroll = () => {
    if (inputRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = inputRef.current.scrollTop
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }

  // Force sync on render (in case value changes layout)
  useEffect(() => {
    handleScroll()
  }, [value, multiline])

  // Clear tooltip on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutId.current) clearTimeout(tooltipTimeoutId.current)
    }
  }, [])

  const handleMouseEnterVar = (e: React.MouseEvent, text: string) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    // Small delay so it doesn't flicker while typing fast over it
    if (tooltipTimeoutId.current) clearTimeout(tooltipTimeoutId.current)
    tooltipTimeoutId.current = setTimeout(() => {
      setTooltip({
        visible: true,
        x: rect.left + (rect.width / 2),
        y: rect.top - 8,
        text
      })
    }, 200)
  }

  const handleMouseLeaveVar = () => {
    if (tooltipTimeoutId.current) clearTimeout(tooltipTimeoutId.current)
    setTooltip(prev => ({ ...prev, visible: false }))
  }

  const handleVarClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    inputRef.current?.focus()
  }

  const renderInterpolatedText = () => {
    if (!value) return null

    const parts = value.split(/(\{\{\w+\}\})/g)

    return parts.map((part, index) => {
      if (part.startsWith('{{') && part.endsWith('}}')) {
        const varName = part.slice(2, -2)
        let val = `{{${varName}}}`
        let titleText = `Variable: ${varName} (Not found)`

        // 1. Check collection variables first
        const collVar = collectionVariables?.find(v => v.enabled && v.key === varName)
        if (collVar) {
          val = collVar.value
          titleText = `${varName} = ${val} (Collection)`
        } 
        // 2. Check env variables
        else if (activeEnv) {
          const envVar = activeEnv.variables.find((v) => v.enabled && v.key === varName)
          if (envVar) {
            val = envVar.value
            titleText = `${varName} = ${val} (${activeEnv.name})`
          } else {
            titleText = `${varName} (Not found in ${activeEnv.name})`
          }
        } else {
          titleText = `${varName} (No environment/collection variable found)`
        }

        return (
          <span
            key={index}
            className="interpolated-var"
            onMouseEnter={(e) => handleMouseEnterVar(e, titleText)}
            onMouseLeave={handleMouseLeaveVar}
            onMouseDown={handleVarClick}
            onClick={handleVarClick}
          >
            {part}
          </span>
        )
      }
      
      // Text part that is NOT a variable
      if (highlightJson && part.trim() !== '') {
        // Very basic naive regex JSON highlighter
        // Matches "key": OR "string" OR number/boolean
        const jsonRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g
        
        const subParts: React.ReactNode[] = []
        let lastIndex = 0
        let match

        while ((match = jsonRegex.exec(part)) !== null) {
          if (match.index > lastIndex) {
            subParts.push(<span key={`text-${index}-${lastIndex}`}>{part.substring(lastIndex, match.index)}</span>)
          }

          const matchStr = match[0]
          let className = 'json-value'
          
          if (/^".*"\s*:$/.test(matchStr)) {
            className = 'json-key'
          } else if (matchStr.startsWith('"')) {
            className = 'json-string'
          } else if (matchStr === 'true' || matchStr === 'false') {
            className = 'json-boolean'
          } else if (matchStr === 'null') {
            className = 'json-null'
          } else if (!isNaN(Number(matchStr))) {
            className = 'json-number'
          }

          subParts.push(<span key={`match-${index}-${match.index}`} className={className}>{matchStr}</span>)
          lastIndex = jsonRegex.lastIndex
        }

        if (lastIndex < part.length) {
          subParts.push(<span key={`text-${index}-end`}>{part.substring(lastIndex)}</span>)
        }

        return <span key={index}>{subParts}</span>
      }

      // JS highlighting
      if (highlightJs && part.trim() !== '') {
        const jsRegex = /(\b(if|else|const|let|var|function|return|await|async|try|catch|finally|throw|new|class|extends|import|export|default|switch|case|break|continue|for|while|do|in|of|typeof|instanceof|void|delete|true|false|null|undefined|NaN|Infinity)\b|(\b(ultra|console|JSON|Object|Array|String|Number|Boolean|Promise|Math|Error|Map|Set)\b)|(\/\/.*)|("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"|'(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\'])*'|`(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\`])*`)|(-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?))/g
        
        const subParts: React.ReactNode[] = []
        let lastIndex = 0
        let match

        while ((match = jsRegex.exec(part)) !== null) {
          if (match.index > lastIndex) {
            subParts.push(<span key={`text-${index}-${lastIndex}`}>{part.substring(lastIndex, match.index)}</span>)
          }

          const matchStr = match[0]
          let className = 'js-default'
          
          if (matchStr.startsWith('//')) {
            className = 'js-comment'
          } else if (matchStr.startsWith('"') || matchStr.startsWith("'") || matchStr.startsWith('`')) {
            className = 'js-string'
          } else if (/^(true|false|null|undefined|NaN|Infinity)$/.test(matchStr)) {
            className = 'js-keyword-alt'
          } else if (/^(if|else|const|let|var|function|return|await|async|try|catch|finally|throw|new|class|extends|import|export|default|switch|case|break|continue|for|while|do|in|of|typeof|instanceof|void|delete)$/.test(matchStr)) {
            className = 'js-keyword'
          } else if (/^(ultra|console|JSON|Object|Array|String|Number|Boolean|Promise|Math|Error|Map|Set)$/.test(matchStr)) {
            className = 'js-builtin'
          } else if (!isNaN(Number(matchStr))) {
            className = 'js-number'
          }

          subParts.push(<span key={`match-${index}-${match.index}`} className={className}>{matchStr}</span>)
          lastIndex = jsRegex.lastIndex
        }

        if (lastIndex < part.length) {
          subParts.push(<span key={`text-${index}-end`}>{part.substring(lastIndex)}</span>)
        }

        return <span key={index}>{subParts}</span>
      }

      return <span key={index}>{part}</span>
    })
  }

  const InputComponent = multiline ? 'textarea' : 'input'
  const wrapperClass = `interpolated-wrapper ${multiline ? 'multiline' : 'singleline'} ${className} ${isFocused ? 'focused' : ''}`

  return (
    <div className={wrapperClass}>
      <div 
        className="interpolated-backdrop" 
        ref={backdropRef} 
        aria-hidden="true"
        style={{ whiteSpace: wrapLines ? 'pre-wrap' : 'pre' }}
      >
        {renderInterpolatedText()}
        {multiline && value.endsWith('\n') ? <br /> : null}
        {!value && placeholder && <span className="interpolated-placeholder">{placeholder}</span>}
      </div>
      <InputComponent
        ref={inputRef as any}
        className="interpolated-element"
        style={{ whiteSpace: wrapLines ? 'pre-wrap' : 'pre' }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={onKeyDown as any}
        disabled={disabled}
        spellCheck={false}
      />
      {tooltip.visible && createPortal(
        <div 
          className="env-tooltip glass fade-in-tooltip"
          style={{ 
            position: 'fixed',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            zIndex: 9999,
          }}
        >
          {tooltip.text}
        </div>,
        document.body
      )}
    </div>
  )
}

export default InterpolatedInput
