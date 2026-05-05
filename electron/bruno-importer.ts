import { parse as parseYaml } from 'yaml'
import type { CollectionItem, RequestConfig, KeyValuePair, Environment } from '../src/types'

export interface BrunoImportResult {
  name: string
  children: CollectionItem[]
  variables: KeyValuePair[]
  environments: Environment[]
  vaultEntries: Record<string, { key: string; value: string }[]>
}

const uid = () => Math.random().toString(36).substring(2, 11)

function convertBrunoScript(code: string): string {
  return code
    .replace(/\bbru\.setVar\s*\(/g, 'ultra.context.set(')
    .replace(/\bbru\.getVar\s*\(/g, 'ultra.context.get(')
    .replace(/\bres\.getBody\s*\(\s*\)/g, 'ultra.response.body')
    .replace(/\bres\.getStatus\s*\(\s*\)/g, 'ultra.response.status')
    .replace(/\breq\.setHeader\s*\(([^,]+),\s*([^)]+)\)/g, 'ultra.request.headers[$1] = $2')
}

export function convertHttpRequest(item: any): RequestConfig {
  const http = item.http || {}
  const settings = item.settings || {}
  const scripts = (item.runtime?.scripts || []) as any[]

  const headers: KeyValuePair[] = (http.headers || []).map((h: any) => ({
    id: uid(),
    key: h.name || '',
    value: String(h.value ?? ''),
    enabled: !h.disabled,
  }))

  const params: KeyValuePair[] = (http.params || []).map((p: any) => ({
    id: uid(),
    key: p.name || '',
    value: String(p.value ?? ''),
    enabled: !p.disabled,
  }))

  let body = ''
  let bodyType: RequestConfig['bodyType'] = 'none'
  if (http.body) {
    const bt = http.body.type
    if (bt === 'json') {
      bodyType = 'json'
      body = typeof http.body.data === 'string' ? http.body.data : JSON.stringify(http.body.data ?? '', null, 2)
    } else if (bt === 'form-urlencoded') {
      bodyType = 'form-data'
      const pairs = (http.body.data || []) as any[]
      body = pairs
        .map((p: any) => `${encodeURIComponent(p.name || '')}=${encodeURIComponent(p.value ?? '')}`)
        .join('&')
    } else if (bt === 'text') {
      bodyType = 'text'
      body = typeof http.body.data === 'string' ? http.body.data : String(http.body.data ?? '')
    } else if (http.body.data) {
      // Unknown type but has content — default to json
      bodyType = 'json'
      body = typeof http.body.data === 'string' ? http.body.data : JSON.stringify(http.body.data ?? '', null, 2)
    }
  }

  let preRequestScript: string | undefined
  let postResponseScript: string | undefined
  for (const s of scripts) {
    if (s.type === 'before-request' && s.code) preRequestScript = convertBrunoScript(s.code)
    if (s.type === 'after-response' && s.code) postResponseScript = convertBrunoScript(s.code)
  }

  const timeoutMs = settings.timeout && settings.timeout > 0 ? settings.timeout : undefined

  const method = (http.method || 'GET').toUpperCase() as RequestConfig['method']

  return {
    id: uid(),
    name: item.info?.name || 'Request',
    type: 'REST',
    method,
    url: String(http.url || ''),
    headers,
    params,
    body,
    bodyType,
    ...(timeoutMs !== undefined && { timeoutMs }),
    ...(preRequestScript !== undefined && { preRequestScript }),
    ...(postResponseScript !== undefined && { postResponseScript }),
  }
}

export function convertGrpcRequest(item: any): RequestConfig {
  const grpc = item.grpc || {}
  const scripts = (item.runtime?.scripts || []) as any[]

  // Parse /pkg.Service/Method into grpcService and grpcMethod
  const methodPath: string = grpc.method || ''
  const parts = methodPath.replace(/^\//, '').split('/')
  const grpcService = parts.length >= 2 ? parts.slice(0, -1).join('/') : ''
  const grpcMethod = parts.length >= 1 ? parts[parts.length - 1] : ''

  const headers: KeyValuePair[] = (grpc.metadata || []).map((m: any) => ({
    id: uid(),
    key: m.name || '',
    value: String(m.value ?? ''),
    enabled: true,
  }))

  let preRequestScript: string | undefined
  let postResponseScript: string | undefined
  for (const s of scripts) {
    if (s.type === 'before-request' && s.code) preRequestScript = convertBrunoScript(s.code)
    if (s.type === 'after-response' && s.code) postResponseScript = convertBrunoScript(s.code)
  }

  const grpcPayload = typeof grpc.message === 'string' ? grpc.message : JSON.stringify(grpc.message ?? '', null, 2)

  return {
    id: uid(),
    name: item.info?.name || 'gRPC Request',
    type: 'GRPC',
    method: 'POST',
    url: String(grpc.url || ''),
    headers,
    params: [],
    body: '',
    bodyType: grpcPayload.trim() ? 'json' : 'none',
    grpcService,
    grpcMethod,
    grpcPayload,
    grpcReflection: true,
    ...(preRequestScript !== undefined && { preRequestScript }),
    ...(postResponseScript !== undefined && { postResponseScript }),
  }
}

function convertBrunoItem(item: any): CollectionItem | null {
  const type = item.info?.type
  if (type === 'folder') {
    const children = (item.items || []).map(convertBrunoItem).filter(Boolean) as CollectionItem[]
    return {
      id: uid(),
      name: item.info?.name || 'Folder',
      type: 'folder',
      children,
    }
  } else if (type === 'http') {
    const request = convertHttpRequest(item)
    return { id: uid(), name: request.name, type: 'request', request }
  } else if (type === 'grpc') {
    const request = convertGrpcRequest(item)
    return { id: uid(), name: request.name, type: 'request', request }
  }
  return null
}

function extractBrunoEnvironments(config: any): {
  environments: Environment[]
  vaultEntries: Record<string, { key: string; value: string }[]>
} {
  const environments: Environment[] = []
  const vaultEntries: Record<string, { key: string; value: string }[]> = {}

  for (const env of config?.environments || []) {
    const envId = uid()
    const variables: KeyValuePair[] = []
    const secrets: { key: string; value: string }[] = []

    for (const v of env.variables || []) {
      if (v.secret) {
        secrets.push({ key: v.name || '', value: '' })
      } else {
        variables.push({
          id: uid(),
          key: v.name || '',
          value: String(v.value ?? ''),
          enabled: true,
        })
      }
    }

    environments.push({
      id: envId,
      name: env.name || 'Imported Environment',
      variables,
      isActive: false,
    })

    if (secrets.length > 0) {
      vaultEntries[envId] = secrets
    }
  }

  return { environments, vaultEntries }
}

export function parseBrunoCollection(yamlText: string): BrunoImportResult {
  const doc = parseYaml(yamlText) as any

  const name: string = doc.info?.name || 'Imported Collection'
  const children = ((doc.items || []) as any[]).map(convertBrunoItem).filter(Boolean) as CollectionItem[]
  const variables: KeyValuePair[] = []

  const { environments, vaultEntries } = extractBrunoEnvironments(doc.config)

  return { name, children, variables, environments, vaultEntries }
}

/**
 * Parse a single Bruno request file (YAML starting with "info:").
 * Returns the converted RequestConfig, or null if the file is not a recognised Bruno request.
 */
export function parseBrunoRequest(yamlText: string): RequestConfig | null {
  const doc = parseYaml(yamlText) as any
  if (!doc || !doc.info) return null
  const type = doc.info.type
  if (type === 'http') return convertHttpRequest(doc)
  if (type === 'grpc') return convertGrpcRequest(doc)
  return null
}
