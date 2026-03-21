import React, { useEffect, useRef, useState, useCallback } from 'react'
import { EditorState, StateEffect, type Extension, RangeSetBuilder } from '@codemirror/state'
import { 
  EditorView, 
  keymap, 
  placeholder as cmPlaceholder, 
  lineNumbers, 
  highlightActiveLine, 
  highlightActiveLineGutter, 
  type DecorationSet, 
  ViewPlugin, 
  ViewUpdate, 
  Decoration
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { syntaxHighlighting, HighlightStyle, codeFolding, foldGutter, foldKeymap, bracketMatching } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { createPortal } from 'react-dom'
import type { Environment } from '../types'
import './Editor.css'

const lightHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#7000df', fontWeight: 'bold' },
  { tag: t.string, color: '#116329' },
  { tag: t.comment, color: '#6a737d', fontStyle: 'italic' },
  { tag: t.number, color: '#005cc5' },
  { tag: t.bool, color: '#005cc5', fontWeight: 'bold' },
  { tag: t.function(t.variableName), color: '#6f42c1' },
  { tag: t.propertyName, color: '#005cc5' },
  { tag: t.variableName, color: '#24292e' },
  { tag: t.operator, color: '#d73a49' },
  { tag: t.className, color: '#6f42c1' },
  { tag: t.typeName, color: '#6f42c1' },
  { tag: t.meta, color: '#005cc5' },
  { tag: t.bracket, color: '#24292e' },
  { tag: t.name, color: '#24292e' },
])

const variableHighlighter = Decoration.mark({ class: 'cm-variable-token' })
const jsonKeyHighlighter = Decoration.mark({ class: 'cm-json-key' })
const jsonValueHighlighter = Decoration.mark({ class: 'cm-json-value' })

function getVariableDecos(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()
  const regex = /\{\{([\w.-]+)\}\}/g
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
  theme?: 'dark' | 'light'
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
  theme = 'dark',
}) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [tooltip, setTooltip] = useState<{ visible: boolean, x: number, y: number, text: string }>({
    visible: false, x: 0, y: 0, text: ''
  })
  const tooltipTimeoutId = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)

  // Keep the ref updated with the latest onChange prop
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])


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
        y: e.clientY - 45,
        text
      })
    }, 200)
  }, [])

  const handleMouseLeaveVar = useCallback(() => {
    if (tooltipTimeoutId.current) clearTimeout(tooltipTimeoutId.current)
    setTooltip(prev => ({ ...prev, visible: false }))
  }, [])

  // Memoize extensions to avoid re-creating the editor too often
  const getExtensions = useCallback(() => {
    const extensions: Extension[] = [
      theme === 'dark' ? oneDark : (language !== 'plain' ? syntaxHighlighting(lightHighlightStyle) : []),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      variablePlugin,
      (wrapLines && !singleLine) ? EditorView.lineWrapping : [],
      EditorView.theme({
        '&': { height: '100%', backgroundColor: 'transparent' },
        '.cm-scroller': { overflow: 'auto' },
        ...(language !== 'plain' ? (theme === 'dark' ? {
          '.cm-string': { color: '#85e89d !important' },          // string values → green
          '.cm-string.cm-property': { color: '#79b8ff !important' }, // property keys → blue
          '.cm-property': { color: '#79b8ff !important' },        // unquoted property keys → blue
          '.cm-json-key, .cm-json-key *': { color: '#79b8ff !important' },
          '.cm-json-value, .cm-json-value *': { color: '#85e89d !important' },
        } : {
          '.cm-string': { color: '#116329 !important' },          // string values → dark green
          '.cm-string.cm-property': { color: '#0550ae !important' }, // property keys → dark blue
          '.cm-property': { color: '#0550ae !important' },        // unquoted property keys → dark blue
          '.cm-json-key, .cm-json-key *': { color: '#0550ae !important' },
          '.cm-json-value, .cm-json-value *': { color: '#116329 !important' },
        }) : {}),
        ...(singleLine ? {
          '.cm-content': { 
            whiteSpace: 'nowrap !important',
          },
          '.cm-line': { 
            display: 'inline-block !important',
            padding: '0 !important',
          },
          '.cm-scroller': {
            overflowX: 'auto !important',
            overflowY: 'hidden !important',
          }
        } : {})
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
          const regex = /\{\{([\w.-]+)\}\}/g
          let match
          let found = false
          while ((match = regex.exec(text)) !== null) {
            if (pos >= match.index && pos <= match.index + match[0].length) {
              const varName = match[1] // Use the first capture group (the variable name inside {{...}})
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
      extensions.push(json())
      extensions.push(jsonPlugin)
      if (!singleLine) {
        extensions.push(codeFolding())
        extensions.push(foldGutter())
        extensions.push(bracketMatching())
        extensions.push(keymap.of(foldKeymap))
      }
    }
    if (language === 'javascript') {
      extensions.push(javascript())
      if (!singleLine) {
        extensions.push(codeFolding())
        extensions.push(foldGutter())
        extensions.push(bracketMatching())
        extensions.push(keymap.of(foldKeymap))
      }
    }
      if (!singleLine) {
        extensions.push(lineNumbers())
        extensions.push(highlightActiveLine())
        extensions.push(highlightActiveLineGutter())
      } else {
        // Strict single line: filter out newlines
        extensions.push(EditorState.transactionFilter.of(tr => {
          return tr.docChanged && tr.newDoc.lines > 1 ? [] : tr
        }))
      }
    if (placeholder) extensions.push(cmPlaceholder(placeholder))
    if (readOnly) extensions.push(EditorState.readOnly.of(true))

    return extensions
  }, [language, placeholder, readOnly, singleLine, wrapLines, onKeyDown, theme, handleMouseEnterVar, handleMouseLeaveVar, resolveVariable])

  // Initialize view once on mount
  const initialValue = useRef(value)
  const getExtensionsRef = useRef(getExtensions)
  
  useEffect(() => {
    getExtensionsRef.current = getExtensions
  }, [getExtensions])

  useEffect(() => {
    if (!editorRef.current) return

    const state = EditorState.create({
      doc: initialValue.current,
      extensions: getExtensionsRef.current()
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
      dispatch: (tr) => {
        view.update([tr])
        if (tr.docChanged && onChangeRef.current) {
          onChangeRef.current(tr.newDoc.toString())
        }
      }
    })

    viewRef.current = view
    
    // For E2E testing
    if (editorRef.current) {
      (editorRef.current as any).cmView = { view }
    }

    return () => {
      view.destroy()
    }
  }, []) // Initialize ONLY ONCE

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
