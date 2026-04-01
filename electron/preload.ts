import { contextBridge, ipcRenderer } from 'electron'

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('ultraRpc', {
  // ===== REST =====
  sendRestRequest: (req: any) => ipcRenderer.invoke('rest:send', req),

  // ===== gRPC =====
  grpcReflect: (args: any) => ipcRenderer.invoke('grpc:reflect', args),
  grpcMethods: (args: any) => ipcRenderer.invoke('grpc:methods', args),
  grpcCall: (args: any) => ipcRenderer.invoke('grpc:call', args),

  // ===== Collections =====
  listCollections: () => ipcRenderer.invoke('storage:listCollections'),
  createCollection: (args: any) => ipcRenderer.invoke('storage:createCollection', args),
  createFolder: (args: { collectionId: string; folderName: string; parentId?: string }) => 
    ipcRenderer.invoke('storage:createFolder', args),
  saveContextVariables: (args: any) => ipcRenderer.invoke('storage:saveContextVariables', args),
  saveRequest: (args: any) => ipcRenderer.invoke('storage:saveRequest', args),
  deleteRequest: (args: any) => ipcRenderer.invoke('storage:deleteRequest', args),
  deleteFolder: (args: { collectionId: string; folderId: string }) => ipcRenderer.invoke('storage:deleteFolder', args),
  renameFolder: (args: { collectionId: string; folderId: string; newName: string }) => 
    ipcRenderer.invoke('storage:renameFolder', args),
  deleteCollection: (args: any) => ipcRenderer.invoke('storage:deleteCollection', args),
  renameCollection: (args: any) => ipcRenderer.invoke('storage:renameCollection', args),
  cloneCollection: (args: { collectionId: string }) => ipcRenderer.invoke('storage:cloneCollection', args),
  cloneRequest: (args: { collectionId: string; requestId: string }) => ipcRenderer.invoke('storage:cloneRequest', args),
  reorderRequests: (args: any) => ipcRenderer.invoke('storage:reorderRequests', args),
  moveItem: (args: { collectionId: string; itemId: string; targetParentId: string | null; newIndex: number }) => 
    ipcRenderer.invoke('storage:moveItem', args),
  exportCollection: (args: any) => ipcRenderer.invoke('storage:exportCollection', args),
  importCollection: () => ipcRenderer.invoke('storage:importCollection'),
  getCollectionPath: (args: any) => ipcRenderer.invoke('storage:getCollectionPath', args),
  showCollectionInFolder: (args: any) => ipcRenderer.invoke('storage:showCollectionInFolder', args),
  moveCollection: (args: any) => ipcRenderer.invoke('storage:moveCollection', args),
  pickFolder: () => ipcRenderer.invoke('storage:pickFolder'),
  pickFile: () => ipcRenderer.invoke('storage:pickFile'),
  linkCollection: () => ipcRenderer.invoke('storage:linkCollection'),

  // ===== History =====
  getHistory: () => ipcRenderer.invoke('storage:getHistory'),
  addHistory: (entry: any) => ipcRenderer.invoke('storage:addHistory', entry),
  clearHistory: () => ipcRenderer.invoke('storage:clearHistory'),

  // ===== Environments =====
  getEnvironments: () => ipcRenderer.invoke('storage:getEnvironments'),
  saveEnvironments: (envs: any[]) => ipcRenderer.invoke('storage:saveEnvironments', envs),
  importEnvironment: () => ipcRenderer.invoke('storage:importEnvironment'),
  exportEnvironment: (args: { envId: string }) => ipcRenderer.invoke('storage:exportEnvironment', args),

  // ===== Vault =====
  checkVaultAvailability: () => ipcRenderer.invoke('vault:check-availability'),
  getVault: (args: { envId: string }) => ipcRenderer.invoke('vault:get', args),
  saveVault: (args: { envId: string; entries: any[] }) => ipcRenderer.invoke('vault:save', args),
  deleteVault: (args: { envId: string }) => ipcRenderer.invoke('vault:delete', args),

  // ===== Settings =====
  getSettings: () => ipcRenderer.invoke('storage:getSettings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('storage:saveSettings', settings),



  // ===== Libraries =====
  getLibraries: () => ipcRenderer.invoke('storage:getLibraries'),
  saveLibraries: (libraries: any[]) => ipcRenderer.invoke('storage:saveLibraries', libraries),
  pickJsFile: () => ipcRenderer.invoke('storage:pickJsFile'),
  saveNewJsFile: () => ipcRenderer.invoke('storage:saveNewJsFile'),
  readFileContents: (filePath: string) => ipcRenderer.invoke('storage:readFileContents', filePath),
  writeFileContents: (filePath: string, content: string) => ipcRenderer.invoke('storage:writeFileContents', filePath, content),
  saveFileAs: (content: string) => ipcRenderer.invoke('storage:saveFileAs', content),
  renameJsFile: (args: { oldPath: string; newName: string }) => ipcRenderer.invoke('storage:renameJsFile', args),
  deleteJsFile: (filePath: string) => ipcRenderer.invoke('storage:deleteJsFile', filePath),

  // ===== Tree Open State =====
  getTreeOpenState: () => ipcRenderer.invoke('tree:getOpenState'),
  setTreeOpenState: (openState: Record<string, true>) => ipcRenderer.invoke('tree:setOpenState', openState),

  // ===== Utils =====
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  showInFolder: (folderPath: string) => ipcRenderer.invoke('app:showInFolder', folderPath),
  confirmClose: () => ipcRenderer.invoke('app:confirm-close'),
  debugLog: (msg: string) => ipcRenderer.invoke('app:debug-log', msg),
  onRequestClose: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('app:request-close', listener)
    return () => {
      ipcRenderer.removeListener('app:request-close', listener)
    }
  },

  // ===== Theme =====
  setThemeSource: (source: 'light' | 'dark' | 'system') => ipcRenderer.invoke('theme:set-source', source),
  getShouldUseDark: () => ipcRenderer.invoke('theme:get-should-use-dark'),
  onThemeUpdated: (callback: (isDark: boolean) => void) => {
    const listener = (_: any, isDark: boolean) => callback(isDark)
    ipcRenderer.on('theme:updated', listener)
    return () => {
      ipcRenderer.removeListener('theme:updated', listener)
    }
  },

  // ===== Formatting =====
  formatCode: (args: { code: string; language: string }) => ipcRenderer.invoke('code:format', args),
  // ===== Flow =====
  flow: {
    execute: (flow: any, activeEnvId?: string | null, environments?: any[], collections?: any[], libraries?: any[]) => ipcRenderer.invoke('flow:execute', { flow, activeEnvId, environments, collections, libraries }),
    stop: (flowId: string) => ipcRenderer.invoke('flow:stop', flowId),
    cancelStep: (flowId: string) => ipcRenderer.invoke('flow:cancel-step', flowId),
    executeStep: (flow: any, stepId: string, activeEnvId?: string | null, environments?: any[], collections?: any[], libraries?: any[]) => ipcRenderer.invoke('flow:execute-step', { flow, stepId, activeEnvId, environments, collections, libraries }),
    onStepStatus: (callback: (stepId: string, status: any) => void) => {
      const listener = (_: any, data: any) => {
        callback(data.stepId, data)
      }
      ipcRenderer.on('flow:step-status', listener)
      return () => {
        ipcRenderer.removeListener('flow:step-status', listener)
      }
    },
    onLog: (callback: (data: { timestamp: number, level: string, message: string }) => void) => {
      const listener = (_: any, data: any) => callback(data)
      ipcRenderer.on('flow:log', listener)
      return () => {
        ipcRenderer.removeListener('flow:log', listener)
      }
    },
    onClearLogs: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('flow:clear-logs', listener)
      return () => {
        ipcRenderer.removeListener('flow:clear-logs', listener)
      }
    },
    onVariableUpdate: (callback: (data: { type: 'set' | 'delete' | 'clear', key?: string, value?: any }) => void) => {
      const listener = (_: any, data: any) => callback(data)
      ipcRenderer.on('flow:variable-update', listener)
      return () => {
        ipcRenderer.removeListener('flow:variable-update', listener)
      }
    },
    showInFolder: (args: { collectionId: string; flowId: string }) => ipcRenderer.invoke('storage:showFlowInFolder', args),
    export: (args: { collectionId: string; flowId: string }) => ipcRenderer.invoke('storage:exportFlow', args),
  },
  saveFlow: (args: { collectionId: string; flow: any; parentId?: string }) => 
    ipcRenderer.invoke('storage:saveFlow', args),
  saveFlowToPath: (args: { folderPath: string; flow: any }) => 
    ipcRenderer.invoke('storage:saveFlowToPath', args),
  saveFlowStandalone: (args: { path: string; flow: any }) => 
    ipcRenderer.invoke('storage:saveFlowStandalone', args),
  listFlows: () => ipcRenderer.invoke('storage:listFlows'),
  linkFlow: () => ipcRenderer.invoke('storage:linkFlow'),
  saveFlowOrder: (args: { order: string[] }) => 
    ipcRenderer.invoke('storage:saveFlowOrder', args),
  moveFlow: (args: { flowId: string; currentPath: string; targetFolderPath: string }) => 
    ipcRenderer.invoke('storage:moveFlow', args),
  deleteFlow: (args: { collectionId: string; flowId: string; path?: string }) => 
    ipcRenderer.invoke('storage:deleteFlow', args),
  renameFlow: (args: { collectionId?: string; flowId: string; newName: string; path?: string }) => 
    ipcRenderer.invoke('storage:renameFlow', args),
})
