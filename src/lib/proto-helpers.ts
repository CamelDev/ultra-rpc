/**
 * Helper utilities for the gRPC Schema Browser UI
 */

export interface MethodInfo {
  name: string
  fullName: string
  requestType: string
  responseType: string
  clientStreaming: boolean
  serverStreaming: boolean
  sampleBody?: string
  responseSampleBody?: string
  requestVariants?: any[]
  responseVariants?: any[]
}

export function streamingLabel(m: MethodInfo): { label: string; cls: string } {
  if (m.clientStreaming && m.serverStreaming)
    return { label: 'bidi stream', cls: 'proto-badge-bidi' }
  if (m.clientStreaming) return { label: 'client stream', cls: 'proto-badge-client' }
  if (m.serverStreaming) return { label: 'server stream', cls: 'proto-badge-server' }
  return { label: 'unary', cls: 'proto-badge-unary' }
}

export function getServiceShortName(fullName: string): string {
  const parts = fullName.split('.')
  return parts[parts.length - 1]
}

export function getPackageName(fullName: string): string {
  const parts = fullName.split('.')
  parts.pop()
  return parts.join('.') || '(root)'
}

/** Tokenise a proto type name into its short + package parts */
export function splitTypeName(fullName: string): { pkg: string; short: string } {
  const clean = fullName.startsWith('.') ? fullName.slice(1) : fullName
  const idx = clean.lastIndexOf('.')
  if (idx === -1) return { pkg: '', short: clean }
  return { pkg: clean.slice(0, idx), short: clean.slice(idx + 1) }
}
