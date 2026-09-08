import type { RequestConfig, KeyValuePair } from '../types'

const _uid = () => Math.random().toString(36).substring(2, 11)

export function getAutoBodyType(body?: string | null): 'json' | 'text' | 'none' {
  if (!body || !body.trim()) {
    return 'none'
  }
  if (body.trim().startsWith('{')) {
    return 'json'
  }
  return 'text'
}

export function createEmptyRequest(type: 'REST' | 'GRPC' | 'GRAPHQL' = 'REST'): RequestConfig {
  return {
    id: _uid(),
    name: type === 'GRAPHQL' ? 'New GraphQL Request' : 'New Request',
    type,
    method: type === 'GRAPHQL' ? 'POST' : 'GET',
    url: '',
    params: [emptyKV()],
    headers: [emptyKV()],
    body: '',
    grpcService: '',
    grpcMethod: '',
    grpcPayload: '{}',
    grpcReflection: true,
    timeoutMs: 30000,
    activeConfigTab: 'body',
    // GraphQL defaults
    graphqlQuery: type === 'GRAPHQL' ? '' : undefined,
    graphqlVariables: type === 'GRAPHQL' ? '{}' : undefined,
    graphqlOperationName: type === 'GRAPHQL' ? '' : undefined,
  }
}

export function emptyKV(): KeyValuePair {
  return { id: _uid(), key: '', value: '', enabled: true }
}

export function kvToRecord(pairs: KeyValuePair[]): Record<string, any> {
  const result: Record<string, any> = {}
  pairs.forEach(p => {
    if (p.enabled && p.key) {
      result[p.key] = p.value
    }
  })
  return result
}

export function recordToKV(record: Record<string, any>): KeyValuePair[] {
  return Object.entries(record).map(([key, value]) => ({
    id: `var-${key}`,
    key,
    value: String(value),
    enabled: true
  }))
}

export function uid() { return _uid() }
