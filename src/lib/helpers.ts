import type { RequestConfig, KeyValuePair } from '../types'

const uid = () => Math.random().toString(36).substring(2, 11)

export function createEmptyRequest(type: 'REST' | 'GRPC' = 'REST'): RequestConfig {
  return {
    id: uid(),
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
  }
}

export function emptyKV(): KeyValuePair {
  return { id: uid(), key: '', value: '', enabled: true }
}

export function uid_export() { return uid() }
