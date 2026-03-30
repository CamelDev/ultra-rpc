import type { RequestConfig, KeyValuePair } from '../types'

const _uid = () => Math.random().toString(36).substring(2, 11)

export function createEmptyRequest(type: 'REST' | 'GRPC' = 'REST'): RequestConfig {
  return {
    id: _uid(),
    name: 'New Request',
    type,
    method: 'GET',
    url: '',
    params: [emptyKV()],
    headers: [emptyKV()],
    body: '',
    bodyType: 'json',
    grpcService: '',
    grpcMethod: '',
    grpcPayload: '{}',
    grpcReflection: true,
    timeoutMs: 30000,
    activeConfigTab: type === 'GRPC' ? 'headers' : 'params',
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
