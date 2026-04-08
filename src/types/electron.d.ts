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
  saveContextVariables: (args: { collectionId: string; variables: any[] }) => Promise<{ success: boolean; error?: string }>
  saveRequest: (args: { collectionId: string; request: any }) => Promise<{ success: boolean; error?: string }>
  deleteRequest: (args: { collectionId: string; requestId: string }) => Promise<{ success: boolean; error?: string }>
  deleteFolder: (args: { collectionId: string; folderId: string }) => Promise<{ success: boolean; error?: string }>
  renameFolder: (args: { collectionId: string; folderId: string; newName: string }) => Promise<{ success: boolean; error?: string }>
  deleteCollection: (args: { collectionId: string; deleteFiles?: boolean }) => Promise<{ success: boolean; error?: string }>
  renameCollection: (args: { collectionId: string; newName: string }) => Promise<{ success: boolean; newId?: string; error?: string }>
  cloneCollection: (args: { collectionId: string }) => Promise<{ success: boolean; id?: string; error?: string }>
  cloneRequest: (args: { collectionId: string; requestId: string }) => Promise<{ success: boolean; id?: string; error?: string }>
  reorderRequests: (args: { collectionId: string; order: string[] }) => Promise<{ success: boolean; error?: string }>
  moveItem: (args: { collectionId: string; itemId: string; targetCollectionId?: string; targetParentId: string | null; newIndex: number }) => Promise<{ success: boolean; error?: string }>
  exportCollection: (args: { collectionId: string }) => Promise<{ success: boolean; path?: string; error?: string }>
  importCollection: () => Promise<{ 
    success: boolean; 
    id?: string; 
    name?: string; 
    requestCount?: number; 
    environments?: any[]; 
    vaultEntries?: Record<string, any[]>; 
    error?: string 
  }>
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
  exportEnvironment: (args: { envId: string }) => Promise<{ success: boolean; path?: string; error?: string }>

  // Vault
  checkVaultAvailability: () => Promise<boolean>
  getVault: (args: { envId: string }) => Promise<{ success: boolean; entries?: VaultEntry[]; error?: string }>
  saveVault: (args: { envId: string; entries: VaultEntry[] }) => Promise<{ success: boolean; error?: string }>
  deleteVault: (args: { envId: string }) => Promise<{ success: boolean; error?: string }>

  // Settings
  getSettings: () => Promise<{ success: boolean; settings?: any; error?: string }>
  saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>



  // Libraries
  getLibraries: () => Promise<{ success: boolean; libraries?: import('./index').Library[]; error?: string }>
  saveLibraries: (libraries: import('./index').Library[]) => Promise<{ success: boolean; error?: string }>
  pickJsFile: () => Promise<{ success: boolean; path?: string; error?: string }>
  saveNewJsFile: () => Promise<{ success: boolean; path?: string; error?: string }>
  readFileContents: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
  writeFileContents: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
  saveFileAs: (content: string) => Promise<{ success: boolean; path?: string; error?: string }>
  renameJsFile: (args: { oldPath: string; newName: string }) => Promise<{ success: boolean; newPath?: string; error?: string }>
  deleteJsFile: (filePath: string) => Promise<{ success: boolean; error?: string }>

  // Tree State
  getTreeOpenState: () => Promise<Record<string, true>>
  setTreeOpenState: (openState: Record<string, true>) => Promise<{ success: boolean; error?: string }>

  // Utils
  openExternal: (url: string) => Promise<void>
  showInFolder: (folderPath: string) => Promise<void>
  confirmClose: () => Promise<void>
  onRequestClose: (callback: () => void) => () => void
  debugLog: (msg: string) => void

  // Theme
  setThemeSource: (source: 'light' | 'dark' | 'system') => Promise<boolean>
  getShouldUseDark: () => Promise<boolean>
  onThemeUpdated: (callback: (isDark: boolean) => void) => () => void
  onMcpAction: (callback: (event: { action: string; name: string; collectionId?: string }) => void) => () => void
  
  // Formatting
  formatCode: (args: { code: string; language: string }) => Promise<{ success: boolean; formatted?: string; error?: string }>

  flow: {
    execute: (flow: import('./flow').FlowDefinition, activeEnvId?: string | null, environments?: import('./index').Environment[], collections?: import('./index').Collection[], libraries?: import('./index').Library[]) => Promise<{ success: boolean; error?: string; variables?: Record<string, any>; stepStatuses?: Record<string, import('./flow').StepStatus> }>
    stop: (flowId: string) => Promise<void>
    cancelStep: (flowId: string) => Promise<{ success: boolean; error?: string }>
    executeStep: (flow: import('./flow').FlowDefinition, stepId: string, activeEnvId?: string | null, environments?: import('./index').Environment[], collections?: import('./index').Collection[], libraries?: import('./index').Library[]) => Promise<{ success: boolean; error?: string; variables?: Record<string, any>; stepStatuses?: Record<string, import('./flow').StepStatus> }>
    onStepStatus: (callback: (stepId: string, status: any) => void) => () => void
    onLog: (callback: (data: { timestamp: number, level: string, message: string }) => void) => () => void
    onClearLogs: (callback: () => void) => () => void
    onVariableUpdate: (callback: (data: { type: 'set' | 'delete' | 'clear', key?: string, value?: any }) => void) => () => void
    showInFolder: (args: { collectionId: string; flowId: string }) => Promise<{ success: boolean; error?: string }>
    export: (args: { collectionId: string; flowId: string }) => Promise<{ success: boolean; path?: string; error?: string }>
  }
  saveFlow: (args: { collectionId: string; flow: import('./flow').FlowDefinition; parentId?: string }) => Promise<{ success: boolean; path?: string; error?: string }>
  saveFlowToPath: (args: { folderPath: string; flow: import('./flow').FlowDefinition }) => Promise<{ success: boolean; collectionId?: string; path?: string; error?: string }>
  saveFlowStandalone: (args: { path: string; flow: import('./flow').FlowDefinition }) => Promise<{ success: boolean; path?: string; error?: string }>
  listFlows: () => Promise<{ success: boolean; flows?: { flow: import('./flow').FlowDefinition; collectionId?: string; collectionName?: string; path: string }[]; error?: string }>
  linkFlow: () => Promise<{ success: boolean; flow?: import('./flow').FlowDefinition; path?: string; error?: string }>
  saveFlowOrder: (args: { order: string[] }) => Promise<{ success: boolean; error?: string }>
  moveFlow: (args: { flowId: string; currentPath: string; targetFolderPath: string }) => Promise<{ success: boolean; newPath?: string; error?: string }>
  deleteFlow: (args: { collectionId: string; flowId: string; path?: string }) => Promise<{ success: boolean; error?: string }>
  renameFlow: (args: { collectionId?: string; flowId: string; newName: string; path?: string }) => Promise<{ success: boolean; newId?: string; error?: string }>
  isTest: boolean
}

declare global {
  interface Window {
    ultraRpc: UltraRpcApi
  }
}
