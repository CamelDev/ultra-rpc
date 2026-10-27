import type { RequestConfig } from '../types'

// Single-quoted POSIX shell arguments preserve whitespace, newlines and metacharacters.
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

export function exportRequest(request: RequestConfig, resolve: (value: string) => string, insecure = false, protocol?: string): string {
  const url = resolve(request.url)
  const headers: Record<string, string> = {}
  request.headers.filter(h => h.enabled && h.key).forEach(h => { headers[resolve(h.key)] = resolve(h.value) })
  const args: string[] = []
  if (request.type === 'GRPC') {
    const secure = url.startsWith('https://') || url.endsWith(':443') || url.includes(':443/')
    if (!secure) args.push('-plaintext')
    else if (insecure) args.push('-insecure')
    if (request.timeoutMs) args.push(`-max-time ${request.timeoutMs / 1000}`)
    if (request.protoPath) args.push(`-proto ${quote(request.protoPath)}`)
    Object.entries(headers).forEach(([key, value]) => { if (value) args.push(`-H ${quote(`${key}: ${value}`)}`) })
    args.push(`-d ${quote(resolve(request.grpcPayload || '{}'))}`)
    args.push(quote(url.replace(/^https?:\/\//, '').split('/')[0]))
    args.push(quote(`${request.grpcService || ''}/${request.grpcMethod || ''}`))
    return ['grpcurl', ...args].join(' \\\n  ')
  }
  args.push(`-X ${request.type === 'GRAPHQL' ? 'POST' : request.method}`)
  if (insecure) args.push('-k')
  if (request.timeoutMs) args.push(`--max-time ${request.timeoutMs / 1000}`)
  if (protocol === 'http2') args.push('--http2')
  if (protocol === 'http1') args.push('--http1.1')
  let fullUrl = url
  if (request.type === 'REST') {
    const params = new URLSearchParams()
    request.params.filter(p => p.enabled && p.key).forEach(p => params.append(resolve(p.key), resolve(p.value)))
    if (params.size) fullUrl += (fullUrl.includes('?') ? '&' : '?') + params.toString()
  }
  let body: string | undefined
  if (request.type === 'GRAPHQL') {
    let variables: unknown
    try { variables = JSON.parse(resolve(request.graphqlVariables || '{}')) } catch { throw new Error('Invalid JSON in GraphQL variables') }
    const payload: Record<string, unknown> = { query: resolve(request.graphqlQuery || '') }
    if (variables && Object.keys(variables).length) payload.variables = variables
    if (request.graphqlOperationName) payload.operationName = request.graphqlOperationName
    body = JSON.stringify(payload, null, 2)
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'
  } else if (request.bodyType !== 'none' && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
    body = resolve(request.body || '')
  }
  Object.entries(headers).forEach(([key, value]) => args.push(`-H ${quote(`${key}: ${value}`)}`))
  if (body !== undefined) args.push(`--data-raw ${quote(body)}`)
  args.push(quote(fullUrl))
  return ['curl', ...args].join(' \\\n  ')
}
