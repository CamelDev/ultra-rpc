import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Environment } from '../types'
import './InterpolatedInput.css'

interface Props {
  value: string
  onChange: (value: string) => void
  activeEnv?: Environment | null
  placeholder?: string
  className?: string
  multiline?: boolean
  onKeyDown?: (e: React.KeyboardEvent) => void
  disabled?: boolean
}

const InterpolatedInput: React.FC<Props> = ({
  value,
  onChange,
  activeEnv,
  placeholder,
  className = '',
  multiline = false,
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

        if (activeEnv) {
          const found = activeEnv.variables.find((v) => v.enabled && v.key === varName)
          if (found) {
            val = found.value
            titleText = `${varName} = ${val}`
          } else {
            titleText = `${varName} (Not found in ${activeEnv.name})`
          }
        } else {
          titleText = `${varName} (No environment active)`
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
      return <span key={index}>{part}</span>
    })
  }

  const InputComponent = multiline ? 'textarea' : 'input'
  const wrapperClass = `interpolated-wrapper ${multiline ? 'multiline' : 'singleline'} ${className} ${isFocused ? 'focused' : ''}`

  return (
    <div className={wrapperClass}>
      <div className="interpolated-backdrop" ref={backdropRef} aria-hidden="true">
        {renderInterpolatedText()}
        {multiline && value.endsWith('\n') ? <br /> : null}
        {!value && placeholder && <span className="interpolated-placeholder">{placeholder}</span>}
      </div>
      <InputComponent
        ref={inputRef as any}
        className="interpolated-element"
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
