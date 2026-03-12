// Type declarations for the ultraRpc API exposed via preload
export interface UltraRpcApi {
  // REST
  sendRestRequest: (req: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
  }) => Promise<{
    success: boolean
    data?: { status: number; statusText: string; headers: Record<string, string>; body: string; time: number; size: number }
    error?: string
    time?: number
  }>

  // gRPC
  grpcReflect: (args: { host: string; insecure: boolean; headers: Record<string, string> }) => Promise<{ success: boolean; services?: string[]; error?: string }>
  grpcMethods: (args: { host: string; insecure: boolean; headers: Record<string, string>; serviceName: string }) => Promise<{
    success: boolean
    methods?: { name: string; fullName: string; requestType: string; responseType: string; clientStreaming: boolean; serverStreaming: boolean; sampleBody?: string }[]
    error?: string
  }>
  grpcCall: (args: { host: string; insecure: boolean; headers: Record<string, string>; service: string; method: string; payload: string; protoPath?: string }) => Promise<{
    success: boolean
    data?: { status: number; statusText: string; headers: Record<string, string>; body: string; time: number; size: number }
    error?: string; code?: number; time?: number
  }>

  // Collections
  listCollections: () => Promise<{ success: boolean; collections?: { id: string; name: string; requests: any[] }[]; error?: string }>
  createCollection: (args: { name: string }) => Promise<{ success: boolean; id?: string; error?: string }>
  saveRequest: (args: { collectionId: string; request: any }) => Promise<{ success: boolean; error?: string }>
  deleteRequest: (args: { collectionId: string; requestId: string }) => Promise<{ success: boolean; error?: string }>
  deleteCollection: (args: { collectionId: string }) => Promise<{ success: boolean; error?: string }>
  renameCollection: (args: { collectionId: string; newName: string }) => Promise<{ success: boolean; error?: string }>
  exportCollection: (args: { collectionId: string }) => Promise<{ success: boolean; path?: string; error?: string }>
  importCollection: () => Promise<{ success: boolean; id?: string; name?: string; requestCount?: number; error?: string }>
  openFolder: () => Promise<{ success: boolean; id?: string; name?: string; requestCount?: number; path?: string; error?: string }>

  // History
  getHistory: () => Promise<{ success: boolean; history?: any[]; error?: string }>
  addHistory: (entry: any) => Promise<{ success: boolean; error?: string }>
  clearHistory: () => Promise<{ success: boolean; error?: string }>

  // Environments
  getEnvironments: () => Promise<{ success: boolean; environments?: any[]; error?: string }>
  saveEnvironments: (envs: any[]) => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    ultraRpc: UltraRpcApi
  }
}
