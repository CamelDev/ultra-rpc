import type { KeyValuePair, Environment, VaultEntry } from '../types'
import { uid } from './helpers'

export type VariableSource = 'vault' | 'collection' | 'environment' | 'undefined'

export interface ResolvedVariableInfo {
  varName: string
  source: VariableSource
  currentValue: string
  sourceLabel: string
}

/**
 * Resolves variable value and its origin following UltraRPC priority:
 * Vault -> Collection -> Environment
 */
export function resolveVariableInfo(
  varName: string,
  contextVariables?: KeyValuePair[] | null,
  activeEnv?: Environment | null,
  vaultEntries?: VaultEntry[] | null
): ResolvedVariableInfo {
  const inVault = vaultEntries?.find(v => v.key === varName)
  if (inVault) {
    return {
      varName,
      source: 'vault',
      currentValue: '••••••••',
      sourceLabel: 'Vault Secret',
    }
  }

  const collVar = contextVariables?.find(v => v.enabled && v.key === varName)
  if (collVar) {
    return {
      varName,
      source: 'collection',
      currentValue: collVar.value,
      sourceLabel: 'Collection',
    }
  }

  if (activeEnv) {
    const envVar = activeEnv.variables?.find(v => v.enabled && v.key === varName)
    if (envVar) {
      return {
        varName,
        source: 'environment',
        currentValue: envVar.value,
        sourceLabel: activeEnv.name || 'Environment',
      }
    }
  }

  return {
    varName,
    source: 'undefined',
    currentValue: '',
    sourceLabel: 'Not Defined',
  }
}

/**
 * Upserts a variable into a list of KeyValuePairs:
 * If it exists, updates value and ensures enabled: true.
 * If not, appends a new KeyValuePair.
 */
export function upsertVariableInList(
  list: KeyValuePair[] = [],
  key: string,
  value: string
): KeyValuePair[] {
  const trimmedKey = key.trim()
  const existingIndex = list.findIndex(item => item.key === trimmedKey)

  if (existingIndex >= 0) {
    return list.map((item, idx) =>
      idx === existingIndex ? { ...item, value, enabled: true } : item
    )
  }

  return [...list, { id: uid(), key: trimmedKey, value, enabled: true }]
}
