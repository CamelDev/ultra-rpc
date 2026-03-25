// ===== Request Types =====
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
export type RequestType = 'REST' | 'GRPC'

export interface KeyValuePair {
  id: string
  key: string
  value: string
  enabled: boolean
}

export type RequestTab = 'params' | 'headers' | 'body' | 'auth' | 'pre-request' | 'post-response'

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
  activeConfigTab?: RequestTab
  // gRPC specific
  grpcService?: string
  grpcMethod?: string
  grpcPayload?: string
  grpcReflection?: boolean
  protoPath?: string
  timeoutMs?: number
  preRequestScript?: string
  postResponseScript?: string
}

export interface ResponseData {
  type: RequestType
  status: number
  statusText: string
  headers: Record<string, string>
  trailers?: Record<string, string>
  body: string
  time: number // ms
  size: number // bytes
}

export interface Tab {
  id: string
  request: RequestConfig
  isDirty?: boolean
  owningCollectionId?: string
  envId?: string | null
}

// ===== Collections =====
export type CollectionItemType = 'folder' | 'request'

export interface CollectionItem {
  id: string
  name: string
  type: CollectionItemType
  request?: RequestConfig
  children?: CollectionItem[]
  isExpanded?: boolean
}

export interface Collection {
  id: string
  name: string
  children: CollectionItem[]
  variables?: KeyValuePair[]
  path?: string // Filesystem path to the collection directory
}

// ===== Vault =====
export interface VaultEntry {
  id: string      // uid, local only
  key: string
  value: string
}

// ===== Environments =====
export interface Environment {
  id: string
  name: string
  variables: KeyValuePair[]
  isActive: boolean
  sslVerification?: boolean // true = validate SSL certs (default), false = skip validation
  protocol?: 'auto' | 'http1' | 'http2'
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

// ===== Code Library =====
export interface Library {
  id: string
  name: string
  filePath: string
  enabled: boolean
}

// ===== History =====
export interface HistoryEntry {
  id: string
  request: RequestConfig
  response: ResponseData | null
  timestamp: number
}
