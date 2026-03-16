import React, { useEffect, useRef, useState, useCallback } from 'react'
import { EditorState, StateEffect, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers, highlightActiveLine, highlightActiveLineGutter, type DecorationSet, ViewPlugin, ViewUpdate, Decoration } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { RangeSetBuilder } from '@codemirror/state'
import { createPortal } from 'react-dom'
import type { Environment } from '../types'
import './Editor.css'

const variableHighlighter = Decoration.mark({ class: 'cm-variable-token' })
const jsonKeyHighlighter = Decoration.mark({ class: 'cm-json-key' })
const jsonValueHighlighter = Decoration.mark({ class: 'cm-json-value' })

function getVariableDecos(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()
  const regex = /\{\{\w+\}\}/g
  let match
  while ((match = regex.exec(text)) !== null) {
    builder.add(match.index, match.index + match[0].length, variableHighlighter)
  }
  return builder.finish()
}

function getJsonDecos(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()
  const regex = /"((?:[^"\\]|\\.)*)"\s*:\s*("(?:[^"\\]|\\.)*")?/g
  const ranges: { from: number; to: number; type: 'key' | 'value' }[] = []
  let match

  while ((match = regex.exec(text)) !== null) {
    const keyStart = match.index
    const keyEnd = keyStart + match[1].length + 2
    ranges.push({ from: keyStart, to: keyEnd, type: 'key' })

    if (match[2] !== undefined) {
      const valueStart = text.indexOf(match[2], keyEnd)
      if (valueStart !== -1) {
        ranges.push({ from: valueStart, to: valueStart + match[2].length, type: 'value' })
      }
    }
  }

  ranges.sort((a, b) => a.from - b.from)
  for (const r of ranges) {
    builder.add(r.from, r.to, r.type === 'key' ? jsonKeyHighlighter : jsonValueHighlighter)
  }
  return builder.finish()
}

const variablePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) {
    this.decorations = getVariableDecos(view)
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = getVariableDecos(update.view)
    }
  }
}, {
  decorations: v => v.decorations
})

const jsonPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) {
    this.decorations = getJsonDecos(view)
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = getJsonDecos(update.view)
    }
  }
}, {
  decorations: v => v.decorations
})

interface Props {
  value: string
  onChange?: (value: string) => void
  language?: 'json' | 'javascript' | 'plain'
  placeholder?: string
  readOnly?: boolean
  singleLine?: boolean
  wrapLines?: boolean
  className?: string
  activeEnv?: Environment | null
  collectionVariables?: any[]
  onKeyDown?: (e: React.KeyboardEvent) => void
}

const Editor: React.FC<Props> = ({
  value,
  onChange,
  language = 'plain',
  placeholder = '',
  readOnly = false,
  singleLine = false,
  wrapLines = true,
  className = '',
  activeEnv,
  collectionVariables,
  onKeyDown,
}) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [tooltip, setTooltip] = useState<{ visible: boolean, x: number, y: number, text: string }>({
    visible: false, x: 0, y: 0, text: ''
  })
  const tooltipTimeoutId = useRef<any>(null)

  // Memoize extensions to avoid re-creating the editor too often
  const getExtensions = useCallback(() => {
    const extensions: Extension[] = [
      oneDark,
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      variablePlugin,
      wrapLines ? EditorView.lineWrapping : [],
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-string': { color: '#85e89d !important' },          // string values → green
        '.cm-string.cm-property': { color: '#79b8ff !important' }, // property keys → blue
        '.cm-property': { color: '#79b8ff !important' },        // unquoted property keys → blue
      }),
      EditorView.domEventHandlers({
        focus: () => setIsFocused(true),
        blur: () => setIsFocused(false),
        keydown: (e) => {
          if (onKeyDown) onKeyDown(e as any)
          if (singleLine && e.key === 'Enter') {
            e.preventDefault()
            return true
          }
          return false
        },
        mousemove: (e, view) => {
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
          if (pos === null) {
            handleMouseLeaveVar()
            return
          }

          const text = view.state.doc.toString()
          // Check if pos is inside a variable {{...}}
          const regex = /\{\{\w+\}\}/g
          let match
          let found = false
          while ((match = regex.exec(text)) !== null) {
            if (pos >= match.index && pos <= match.index + match[0].length) {
              const varName = match[0].slice(2, -2)
              const titleText = resolveVariable(varName)
              handleMouseEnterVar(e as any, titleText)
              found = true
              break
            }
          }
          if (!found) handleMouseLeaveVar()
        },
        mouseleave: () => {
          handleMouseLeaveVar()
        }
      })
    ]

    if (language === 'json') {
      extensions.push(javascript())
      extensions.push(jsonPlugin)
    }
    if (language === 'javascript') extensions.push(javascript())
    if (!singleLine) {
      extensions.push(lineNumbers())
      extensions.push(highlightActiveLine())
      extensions.push(highlightActiveLineGutter())
    }
    if (placeholder) extensions.push(cmPlaceholder(placeholder))
    if (readOnly) extensions.push(EditorState.readOnly.of(true))

    return extensions
  }, [language, placeholder, readOnly, singleLine, wrapLines, onKeyDown, activeEnv, collectionVariables])

  const resolveVariable = useCallback((varName: string) => {
    let titleText = `Variable: ${varName} (Not found)`

    const collVar = collectionVariables?.find(v => v.enabled && v.key === varName)
    if (collVar) {
      const val = collVar.value
      titleText = `${varName} = ${val} (Collection)`
    } else if (activeEnv) {
      const envVar = activeEnv.variables.find((v) => v.enabled && v.key === varName)
      if (envVar) {
        const val = envVar.value
        titleText = `${varName} = ${val} (${activeEnv.name})`
      } else {
        titleText = `${varName} (Not found in ${activeEnv.name})`
      }
    } else {
      titleText = `${varName} (No environment/collection variable found)`
    }
    return titleText
  }, [activeEnv, collectionVariables])

  const handleMouseEnterVar = useCallback((e: React.MouseEvent, text: string) => {
    if (tooltipTimeoutId.current) clearTimeout(tooltipTimeoutId.current)
    tooltipTimeoutId.current = setTimeout(() => {
      setTooltip({
        visible: true,
        x: e.clientX,
        y: e.clientY - 20,
        text
      })
    }, 200)
  }, [])

  const handleMouseLeaveVar = useCallback(() => {
    if (tooltipTimeoutId.current) clearTimeout(tooltipTimeoutId.current)
    setTooltip(prev => ({ ...prev, visible: false }))
  }, [])

  useEffect(() => {
    if (!editorRef.current) return

    const state = EditorState.create({
      doc: value,
      extensions: getExtensions()
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
      dispatch: (tr) => {
        view.update([tr])
        if (tr.docChanged && onChange) {
          onChange(tr.newDoc.toString())
        }
      }
    })

    viewRef.current = view

    return () => {
      view.destroy()
    }
  }, []) // Initialize once

  // Sync value from props if it changes externally
  useEffect(() => {
    if (viewRef.current && viewRef.current.state.doc.toString() !== value) {
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: value }
      })
    }
  }, [value])

  // Update extensions when they change
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: StateEffect.reconfigure.of(getExtensions())
      })
    }
  }, [getExtensions])

  return (
    <div className={`editor-container ${className} ${isFocused ? 'focused' : ''} ${readOnly ? 'readonly' : ''} ${singleLine ? 'singleline' : ''}`} ref={editorRef}>
      {tooltip.visible && createPortal(
        <div 
          className="env-tooltip glass fade-in-tooltip"
          style={{ 
            position: 'fixed',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            zIndex: 9999,
            transform: 'translateX(-50%)',
            pointerEvents: 'none'
          }}
        >
          {tooltip.text}
        </div>,
        document.body
      )}
    </div>
  )
}

export default Editor
