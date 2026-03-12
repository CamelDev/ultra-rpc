// ===== Request Types =====
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
export type RequestType = 'REST' | 'GRPC'

export interface KeyValuePair {
  id: string
  key: string
  value: string
  enabled: boolean
}

export interface RequestConfig {
  id: string
  name: string
  type: RequestType
  method: HttpMethod
  url: string
  params: KeyValuePair[]
  headers: KeyValuePair[]
  body: string
  bodyType: 'json' | 'text' | 'form-data' | 'none'
  // gRPC specific
  grpcService?: string
  grpcMethod?: string
  grpcPayload?: string
  grpcReflection?: boolean
  timeoutMs?: number
  postResponseScript?: string
}

export interface ResponseData {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  time: number // ms
  size: number // bytes
}

export interface Tab {
  id: string
  request: RequestConfig
  isDirty?: boolean
}

// ===== Collections =====
export interface Collection {
  id: string
  name: string
  requests: RequestConfig[]
  variables?: KeyValuePair[]
}

// ===== Environments =====
export interface Environment {
  id: string
  name: string
  variables: KeyValuePair[]
  isActive: boolean
}

// ===== gRPC Types =====
export interface GrpcServiceInfo {
  name: string
  methods: GrpcMethodInfo[]
}

export interface GrpcMethodInfo {
  name: string
  fullName: string
  requestType: string
  responseType: string
  isClientStreaming: boolean
  isServerStreaming: boolean
  requestSchema?: string  // JSON schema for request
}

// ===== History =====
export interface HistoryEntry {
  id: string
  request: RequestConfig
  response: ResponseData | null
  timestamp: number
}
