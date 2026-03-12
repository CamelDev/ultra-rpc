import React from 'react'
import { Plus, Trash2, Check } from 'lucide-react'
import type { KeyValuePair } from '../types'
import { emptyKV } from '../lib/helpers'
import './KeyValueEditor.css'

interface Props {
  pairs: KeyValuePair[]
  onChange: (pairs: KeyValuePair[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}

const KeyValueEditor: React.FC<Props> = ({
  pairs,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
}) => {
  const update = (id: string, field: keyof KeyValuePair, value: string | boolean) => {
    onChange(pairs.map(p => (p.id === id ? { ...p, [field]: value } : p)))
  }

  const remove = (id: string) => {
    const updated = pairs.filter(p => p.id !== id)
    onChange(updated.length === 0 ? [emptyKV()] : updated)
  }

  const addRow = () => {
    onChange([...pairs, emptyKV()])
  }

  return (
    <div className="kv-editor">
      <div className="kv-header">
        <span className="kv-header-check"></span>
        <span className="kv-header-key">{keyPlaceholder}</span>
        <span className="kv-header-value">{valuePlaceholder}</span>
        <span className="kv-header-action"></span>
      </div>
      {pairs.map((pair) => (
        <div className={`kv-row ${!pair.enabled ? 'kv-row-disabled' : ''}`} key={pair.id}>
          <button
            className={`kv-check ${pair.enabled ? 'kv-check-on' : ''}`}
            onClick={() => update(pair.id, 'enabled', !pair.enabled)}
          >
            {pair.enabled && <Check size={12} />}
          </button>
          <input
            className="kv-input kv-key"
            placeholder={keyPlaceholder}
            value={pair.key}
            onChange={(e) => update(pair.id, 'key', e.target.value)}
          />
          <input
            className="kv-input kv-value"
            placeholder={valuePlaceholder}
            value={pair.value}
            onChange={(e) => update(pair.id, 'value', e.target.value)}
          />
          <button className="kv-delete" onClick={() => remove(pair.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="kv-add" onClick={addRow}>
        <Plus size={14} /> Add
      </button>
    </div>
  )
}

export default KeyValueEditor
