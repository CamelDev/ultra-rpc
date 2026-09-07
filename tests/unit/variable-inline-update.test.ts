import { describe, it, expect } from 'bun:test'
import { resolveVariableInfo, upsertVariableInList } from '../../src/lib/variable-utils'
import type { KeyValuePair, Environment, VaultEntry } from '../../src/types'

describe('Variable Inline Resolution and Upsert Utils', () => {
  const contextVars: KeyValuePair[] = [
    { id: '1', key: 'baseUrl', value: 'https://api.example.com', enabled: true },
    { id: '2', key: 'disabledVar', value: 'secret123', enabled: false },
  ]

  const activeEnv: Environment = {
    id: 'env-1',
    name: 'Production',
    variables: [
      { id: '3', key: 'baseUrl', value: 'https://prod.example.com', enabled: true },
      { id: '4', key: 'apiKey', value: 'prod-key-123', enabled: true },
    ]
  }

  const vaultEntries: VaultEntry[] = [
    { key: 'secretToken', value: 'vault-encrypted-value' }
  ]

  it('resolves Vault variables with highest priority', () => {
    const res = resolveVariableInfo('secretToken', contextVars, activeEnv, vaultEntries)
    expect(res.source).toBe('vault')
    expect(res.sourceLabel).toBe('Vault Secret')
  })

  it('resolves Collection variables overriding Environment variables', () => {
    const res = resolveVariableInfo('baseUrl', contextVars, activeEnv, vaultEntries)
    expect(res.source).toBe('collection')
    expect(res.currentValue).toBe('https://api.example.com')
  })

  it('resolves Environment variables when not present in Collection', () => {
    const res = resolveVariableInfo('apiKey', contextVars, activeEnv, vaultEntries)
    expect(res.source).toBe('environment')
    expect(res.currentValue).toBe('prod-key-123')
    expect(res.sourceLabel).toBe('Production')
  })

  it('reports undefined when variable is not defined or is disabled in collection and absent in env', () => {
    const res = resolveVariableInfo('disabledVar', contextVars, activeEnv, vaultEntries)
    expect(res.source).toBe('undefined')
    expect(res.currentValue).toBe('')
  })

  it('upsertVariableInList updates an existing variable', () => {
    const updated = upsertVariableInList(contextVars, 'baseUrl', 'https://staging.example.com')
    expect(updated.length).toBe(2)
    const found = updated.find(v => v.key === 'baseUrl')
    expect(found?.value).toBe('https://staging.example.com')
    expect(found?.enabled).toBe(true)
  })

  it('upsertVariableInList appends a new variable if not present', () => {
    const updated = upsertVariableInList(contextVars, 'newVar', 'newValue123')
    expect(updated.length).toBe(3)
    const found = updated.find(v => v.key === 'newVar')
    expect(found?.value).toBe('newValue123')
    expect(found?.enabled).toBe(true)
    expect(found?.id).toBeDefined()
  })
})
