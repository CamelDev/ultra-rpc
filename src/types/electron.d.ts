import { RequestType, VaultEntry } from './index'

// Type declarations for the ultraRpc API exposed via preload
export interface UltraRpcApi {
  // REST
  sendRestRequest: (req: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
    insecure?: boolean
    protocol?: 'auto' | 'http1' | 'http2'
    timeoutMs?: number
  }) => Promise<{
    success: boolean
    data?: { type: RequestType; status: number; statusText: string; headers: Record<string, string>; body: string; time: number; size: number }
    error?: string
    time?: number
  }>

  // gRPC
  grpcReflect: (args: { host: string; insecure: boolean; headers: Record<string, string>; protoPath?: string }) => Promise<{ success: boolean; services?: string[]; error?: string }>
  grpcMethods: (args: { host: string; insecure: boolean; headers: Record<string, string>; serviceName: string; protoPath?: string }) => Promise<{
    success: boolean
    methods?: { name: string; fullName: string; requestType: string; responseType: string; clientStreaming: boolean; serverStreaming: boolean; sampleBody?: string }[]
    error?: string
  }>
  grpcCall: (args: { host: string; insecure: boolean; headers: Record<string, string>; service: string; method: string; payload: string; protoPath?: string; timeoutMs?: number }) => Promise<{
    success: boolean
    data?: { type: RequestType; status: number; statusText: string; headers: Record<string, string>; body: string; time: number; size: number }
    error?: string; code?: number; time?: number
  }>

  // Collections
  listCollections: () => Promise<{ success: boolean; collections?: { id: string; name: string; children: any[]; variables?: any[]; path?: string }[]; warnings?: string[]; error?: string }>
  createCollection: (args: { name: string; path?: string }) => Promise<{ success: boolean; id?: string; error?: string }>
  createFolder: (args: { collectionId: string; folderName: string; parentId?: string }) => Promise<{ success: boolean; id?: string; error?: string }>
  saveCollectionVariables: (args: { collectionId: string; variables: any[] }) => Promise<{ success: boolean; error?: string }>
  saveRequest: (args: { collectionId: string; request: any }) => Promise<{ success: boolean; error?: string }>
  deleteRequest: (args: { collectionId: string; requestId: string }) => Promise<{ success: boolean; error?: string }>
  deleteFolder: (args: { collectionId: string; folderId: string }) => Promise<{ success: boolean; error?: string }>
  renameFolder: (args: { collectionId: string; folderId: string; newName: string }) => Promise<{ success: boolean; error?: string }>
  deleteCollection: (args: { collectionId: string }) => Promise<{ success: boolean; error?: string }>
  renameCollection: (args: { collectionId: string; newName: string }) => Promise<{ success: boolean; newId?: string; error?: string }>
  cloneCollection: (args: { collectionId: string }) => Promise<{ success: boolean; id?: string; error?: string }>
  cloneRequest: (args: { collectionId: string; requestId: string }) => Promise<{ success: boolean; id?: string; error?: string }>
  reorderRequests: (args: { collectionId: string; order: string[] }) => Promise<{ success: boolean; error?: string }>
  moveItem: (args: { collectionId: string; itemId: string; targetCollectionId?: string; targetParentId: string | null; newIndex: number }) => Promise<{ success: boolean; error?: string }>
  exportCollection: (args: { collectionId: string }) => Promise<{ success: boolean; path?: string; error?: string }>
  importCollection: () => Promise<{ success: boolean; id?: string; name?: string; requestCount?: number; error?: string }>
  openFolder: () => Promise<{ success: boolean; id?: string; name?: string; requestCount?: number; path?: string; error?: string }>
  getCollectionPath: (args: { collectionId: string }) => Promise<{ success: boolean; path?: string; error?: string }>
  showCollectionInFolder: (args: { collectionId: string }) => Promise<{ success: boolean; error?: string }>
  moveCollection: (args: { collectionId: string; currentPath?: string }) => Promise<{ success: boolean; newPath?: string; error?: string }>
  pickFolder: () => Promise<{ success: boolean; path?: string; error?: string }>
  pickFile: () => Promise<{ success: boolean; path?: string; error?: string }>
  linkCollection: () => Promise<{ success: boolean; path?: string; error?: string }>

  // History
  getHistory: () => Promise<{ success: boolean; history?: any[]; error?: string }>
  addHistory: (entry: any) => Promise<{ success: boolean; error?: string }>
  clearHistory: () => Promise<{ success: boolean; error?: string }>

  // Environments
  getEnvironments: () => Promise<{ success: boolean; environments?: any[]; error?: string }>
  saveEnvironments: (envs: any[]) => Promise<{ success: boolean; error?: string }>
  importEnvironment: () => Promise<{ success: boolean; environments?: any[]; error?: string }>

  // Vault
  getVault: (args: { envId: string }) => Promise<{ success: boolean; entries?: VaultEntry[]; error?: string }>
  saveVault: (args: { envId: string; entries: VaultEntry[] }) => Promise<{ success: boolean; error?: string }>
  deleteVault: (args: { envId: string }) => Promise<{ success: boolean; error?: string }>

  // Settings
  getSettings: () => Promise<{ success: boolean; settings?: any; error?: string }>
  saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>

  // Globals (pm.globals)
  getGlobals: () => Promise<{ success: boolean; globals?: any[]; error?: string }>
  saveGlobals: (globals: any[]) => Promise<{ success: boolean; error?: string }>

  // Tree State
  getTreeOpenState: () => Promise<Record<string, true>>
  setTreeOpenState: (openState: Record<string, true>) => Promise<{ success: boolean; error?: string }>

  // Utils
  openExternal: (url: string) => Promise<void>
  showInFolder: (folderPath: string) => Promise<void>
  confirmClose: () => Promise<void>
  onRequestClose: (callback: () => void) => () => void
  debugLog: (msg: string) => void
}

declare global {
  interface Window {
    ultraRpc: UltraRpcApi
  }
}
