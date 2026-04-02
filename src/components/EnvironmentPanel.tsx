import React, { useState } from 'react'
import { Plus, Trash2, ChevronDown, Edit2, Save, Download, ShieldCheck, ShieldOff, Globe, Check, Lock, Share } from 'lucide-react'
import Tooltip from './Tooltip'
import type { Environment, KeyValuePair, VaultEntry } from '../types'
import { emptyKV } from '../lib/helpers'
import './EnvironmentPanel.css'

interface Props {
  environments: Environment[]
  onChange: (environments: Environment[]) => void
  onDeleteRequest: (id: string, name: string) => void
  onApplyToAllTabs: (envId: string) => void
  activeEnvId: string | null
  onSetActive: (id: string | null) => void
  vaults: Record<string, VaultEntry[]>
  onVaultChange: (envId: string, entries: VaultEntry[]) => void
  vaultAvailable: boolean
}

const EnvironmentPanel: React.FC<Props> = ({
  environments,
  activeEnvId,
  onSetActive,
  onChange,
  onDeleteRequest,
  onApplyToAllTabs,
  vaults,
  onVaultChange,
  vaultAvailable
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [vaultExpanded, setVaultExpanded] = useState<Record<string, boolean>>({})

  const uid = () => Math.random().toString(36).substring(2, 11)

  const handleImport = async () => {
    const result = await window.ultraRpc.importEnvironment()
    if (result.success && result.environments) {
      const newEnvs = [...environments, ...result.environments]
      onChange(newEnvs)
      if (result.environments.length > 0) {
        setExpandedId(result.environments[0].id)
      }
    } else if (result.error && result.error !== 'Cancelled') {
      alert(`Import failed: ${result.error}`)
    }
  }

  const handleExport = async (envId: string) => {
    const result = await window.ultraRpc.exportEnvironment({ envId })
    if (result.success) {
      console.log('Environment exported:', result.path)
    } else if (result.error && result.error !== 'Cancelled') {
      alert(`Export failed: ${result.error}`)
    }
  }

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

  const toggleSslVerification = (envId: string) => {
    onChange(environments.map(env => {
      if (env.id !== envId) return env
      const current = env.sslVerification !== false // default true
      return { ...env, sslVerification: !current }
    }))
  }

  const updateProtocol = (envId: string, protocol: 'auto' | 'http1' | 'http2') => {
    onChange(environments.map(env => {
      if (env.id !== envId) return env
      return { ...env, protocol }
    }))
  }

  // ===== Vault handlers =====
  const addVaultEntry = (envId: string) => {
    const current = vaults[envId] ?? []
    const newEntry: VaultEntry = { id: uid(), key: '', value: '' }
    onVaultChange(envId, [...current, newEntry])
  }

  const updateVaultEntry = (envId: string, entryId: string, field: 'key' | 'value', value: string) => {
    const current = vaults[envId] ?? []
    onVaultChange(envId, current.map(e => e.id === entryId ? { ...e, [field]: value } : e))
  }

  const deleteVaultEntry = (envId: string, entryId: string) => {
    const current = vaults[envId] ?? []
    onVaultChange(envId, current.filter(e => e.id !== entryId))
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
        <div className="env-panel-actions">
          <Tooltip text="Add Environment" position="bottom">
            <button className="btn-ghost env-action-btn" onClick={addEnvironment}>
              <Plus size={14} />
            </button>
          </Tooltip>
          <Tooltip text="Import Environment" position="bottom">
            <button className="btn-ghost env-action-btn" onClick={handleImport}>
              <Download size={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      {environments.length === 0 && (
        <div className="env-empty">
          No environments yet. Create one to manage variables like BASE_URL and AUTH_TOKEN.
        </div>
      )}

      {environments.map(env => (
        <div
          className={`env-item ${activeEnvId === env.id ? 'active' : ''} ${expandedId === env.id ? 'expanded' : ''}`}
          key={env.id}
          onContextMenu={(e) => {
            e.preventDefault()
            onSetActive(env.id === activeEnvId ? null : env.id)
          }}
        >
          <div className="env-item-header" onClick={() => setExpandedId(expandedId === env.id ? null : env.id)}>
            <div className="env-status-dot" />
            <ChevronDown
              size={14}
              className={`env-chevron ${expandedId === env.id ? 'env-chevron-open' : ''}`}
            />
            {editingName === env.id ? (
              <input
                className="env-name-input"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => {
                  e.stopPropagation()
                  if (e.key === 'Enter') saveRename(env.id)
                }}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span className="env-name">{env.name}</span>
            )}
            <div className="env-item-actions" onClick={e => e.stopPropagation()}>
              {editingName === env.id ? (
                <Tooltip text="Save name" position="top">
                  <button className="btn-ghost env-action" onClick={() => saveRename(env.id)}>
                    <Save size={13} />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip text="Rename" position="top">
                  <button className="btn-ghost env-action" onClick={() => startRename(env)}>
                    <Edit2 size={13} />
                  </button>
                </Tooltip>
              )}

              <Tooltip text="Apply to all tabs" position="top">
                <button className="btn-ghost env-action" onClick={() => {
                  if (window.confirm(`Apply environment "${env.name}" to all opened tabs?`)) {
                    onApplyToAllTabs(env.id)
                  }
                }}>
                  <Globe size={13} />
                </button>
              </Tooltip>

              <Tooltip text="Export UltraRPC Environment" position="top">
                <button className="btn-ghost env-action" onClick={() => handleExport(env.id)}>
                  <Share size={13} />
                </button>
              </Tooltip>

              <Tooltip text="Delete Environment" position="top">
                <button className="btn-ghost env-action env-delete" onClick={() => onDeleteRequest(env.id, env.name)}>
                  <Trash2 size={13} />
                </button>
              </Tooltip>
            </div>
          </div>

          {expandedId === env.id && (
            <div className="env-item-body">
              {/* SSL Verification Toggle */}
              <div className="env-ssl-row">
                <Tooltip
                  text={env.sslVerification !== false ? 'SSL verification is ON — click to disable' : 'SSL verification is OFF — click to enable'}
                  position="top"
                >
                  <button
                    className={`env-ssl-toggle ${env.sslVerification !== false ? 'env-ssl-on' : 'env-ssl-off'}`}
                    onClick={() => toggleSslVerification(env.id)}
                  >
                    {env.sslVerification !== false
                      ? <><ShieldCheck size={13} /> SSL Verification<span className="env-ssl-badge env-ssl-badge-on">ON</span></>
                      : <><ShieldOff size={13} /> SSL Verification<span className="env-ssl-badge env-ssl-badge-off">OFF</span></>}
                  </button>
                </Tooltip>
              </div>

              <div className="env-protocol-row">
                <label className="env-protocol-label">Protocol</label>
                <select
                  className="env-protocol-select"
                  value={env.protocol || 'auto'}
                  onChange={(e) => updateProtocol(env.id, e.target.value as any)}
                >
                  <option value="auto">Auto</option>
                  <option value="http1">HTTP/1.1</option>
                  <option value="http2">HTTP/2</option>
                </select>
              </div>

              {env.variables.map(v => (
                <div
                  className={['env-var-row', !v.enabled ? 'env-var-row-disabled' : ''].filter(Boolean).join(' ')}
                  key={v.id}
                >
                  <Tooltip text={v.enabled ? 'Disable Variable' : 'Enable Variable'} position="top">
                    <button
                      className={`env-var-check ${v.enabled ? 'env-var-check-on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        updateVariable(env.id, v.id, 'enabled', !v.enabled)
                      }}
                    >
                      {v.enabled && <Check size={12} />}
                    </button>
                  </Tooltip>
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
                  <Tooltip text="Remove Variable" position="left">
                    <button className="env-var-delete" onClick={() => removeVariable(env.id, v.id)}>
                      <Trash2 size={12} />
                    </button>
                  </Tooltip>
                </div>
              ))}
              <button className="kv-add" onClick={() => addVariable(env.id)}>
                <Plus size={14} /> Add variable
              </button>

              {/* Vault Section */}
              <div className="vault-section">
                <div
                  className="vault-header"
                  onClick={() => setVaultExpanded(prev => ({ ...prev, [env.id]: !prev[env.id] }))}
                >
                  <div className="vault-header-left">
                    <Lock size={13} className="vault-lock-icon" />
                    <span className="vault-title">Vault</span>
                    <span className="vault-count">({vaults[env.id]?.length || 0})</span>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`env-chevron ${vaultExpanded[env.id] ? 'env-chevron-open' : ''}`}
                  />
                </div>

                {vaultExpanded[env.id] && !vaultAvailable && (
                  <div className="vault-unavailable-warning">
                    <ShieldOff size={14} />
                    <span>Vault is disabled because encryption is unavailable on this system (access denied or not supported).</span>
                  </div>
                )}

                {vaultExpanded[env.id] && (
                  <div className="vault-content">
                    {(vaults[env.id] || []).map(v => (
                      <div className="vault-row" key={v.id}>
                        <input
                          className="env-var-input vault-key"
                          placeholder="SECRET_KEY"
                          value={v.key}
                          onChange={e => updateVaultEntry(env.id, v.id, 'key', e.target.value)}
                          disabled={!vaultAvailable}
                        />
                        <input
                          className="env-var-input vault-value"
                          type="password"
                          placeholder="••••••••"
                          autoComplete="off"
                          spellCheck={false}
                          value={v.value}
                          onChange={e => updateVaultEntry(env.id, v.id, 'value', e.target.value)}
                          disabled={!vaultAvailable}
                        />
                        <Tooltip text="Remove Secret" position="left">
                          <button
                            className="env-var-delete"
                            onClick={() => deleteVaultEntry(env.id, v.id)}
                            disabled={!vaultAvailable}
                          >
                            <Trash2 size={12} />
                          </button>
                        </Tooltip>
                      </div>
                    ))}
                    <button
                      className="kv-add vault-add"
                      onClick={() => addVaultEntry(env.id)}
                      disabled={!vaultAvailable}
                    >
                      <Plus size={14} /> Add secret
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default EnvironmentPanel
