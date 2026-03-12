import React, { useState } from 'react'
import { Plus, Trash2, Check, ChevronDown, Edit2, Save } from 'lucide-react'
import type { Environment, KeyValuePair } from '../types'
import { emptyKV } from '../lib/helpers'
import './EnvironmentPanel.css'

interface Props {
  environments: Environment[]
  onChange: (environments: Environment[]) => void
  activeEnvId: string | null
  onSetActive: (id: string | null) => void
}

const EnvironmentPanel: React.FC<Props> = ({ environments, onChange, activeEnvId, onSetActive }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')

  const uid = () => Math.random().toString(36).substring(2, 11)

  const addEnvironment = () => {
    const newEnv: Environment = {
      id: uid(),
      name: 'New Environment',
      variables: [
        { id: uid(), key: 'BASE_URL', value: '', enabled: true },
        { id: uid(), key: 'AUTH_TOKEN', value: '', enabled: true },
        emptyKV(),
      ],
      isActive: false,
    }
    onChange([...environments, newEnv])
    setExpandedId(newEnv.id)
  }

  const removeEnvironment = (id: string) => {
    onChange(environments.filter(e => e.id !== id))
    if (activeEnvId === id) onSetActive(null)
  }

  const updateVariable = (envId: string, varId: string, field: keyof KeyValuePair, value: string | boolean) => {
    onChange(environments.map(env => {
      if (env.id !== envId) return env
      return {
        ...env,
        variables: env.variables.map(v => (v.id === varId ? { ...v, [field]: value } : v)),
      }
    }))
  }

  const addVariable = (envId: string) => {
    onChange(environments.map(env => {
      if (env.id !== envId) return env
      return { ...env, variables: [...env.variables, emptyKV()] }
    }))
  }

  const removeVariable = (envId: string, varId: string) => {
    onChange(environments.map(env => {
      if (env.id !== envId) return env
      const vars = env.variables.filter(v => v.id !== varId)
      return { ...env, variables: vars.length === 0 ? [emptyKV()] : vars }
    }))
  }

  const startRename = (env: Environment) => {
    setEditingName(env.id)
    setNameInput(env.name)
  }

  const saveRename = (envId: string) => {
    onChange(environments.map(env => (env.id === envId ? { ...env, name: nameInput } : env)))
    setEditingName(null)
  }

  return (
    <div className="env-panel">
      <div className="env-panel-header">
        <span className="env-panel-title">Environments</span>
        <button className="btn-ghost env-add-btn" onClick={addEnvironment}>
          <Plus size={14} />
        </button>
      </div>

      {environments.length === 0 && (
        <div className="env-empty">
          No environments yet. Create one to manage variables like BASE_URL and AUTH_TOKEN.
        </div>
      )}

      {environments.map(env => (
        <div className={`env-item ${activeEnvId === env.id ? 'env-item-active' : ''}`} key={env.id}>
          <div className="env-item-header" onClick={() => setExpandedId(expandedId === env.id ? null : env.id)}>
            <ChevronDown
              size={14}
              className={`env-chevron ${expandedId === env.id ? 'env-chevron-open' : ''}`}
            />
            {editingName === env.id ? (
              <input
                className="env-name-input"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveRename(env.id)}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className="env-name">{env.name}</span>
            )}
            <div className="env-item-actions" onClick={e => e.stopPropagation()}>
              {editingName === env.id ? (
                <button className="btn-ghost env-action" onClick={() => saveRename(env.id)}>
                  <Save size={13} />
                </button>
              ) : (
                <button className="btn-ghost env-action" onClick={() => startRename(env)}>
                  <Edit2 size={13} />
                </button>
              )}
              <button
                className={`btn-ghost env-action ${activeEnvId === env.id ? 'env-active-check' : ''}`}
                onClick={() => onSetActive(activeEnvId === env.id ? null : env.id)}
                title="Set as active"
              >
                <Check size={13} />
              </button>
              <button className="btn-ghost env-action env-delete" onClick={() => removeEnvironment(env.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          {expandedId === env.id && (
            <div className="env-item-body">
              {env.variables.map(v => (
                <div className="env-var-row" key={v.id}>
                  <input
                    className="env-var-input env-var-key"
                    placeholder="VARIABLE_NAME"
                    value={v.key}
                    onChange={e => updateVariable(env.id, v.id, 'key', e.target.value)}
                  />
                  <input
                    className="env-var-input env-var-value"
                    placeholder="value"
                    value={v.value}
                    onChange={e => updateVariable(env.id, v.id, 'value', e.target.value)}
                  />
                  <button className="env-var-delete" onClick={() => removeVariable(env.id, v.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button className="kv-add" onClick={() => addVariable(env.id)}>
                <Plus size={14} /> Add variable
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default EnvironmentPanel
