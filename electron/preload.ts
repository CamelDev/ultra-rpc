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
  saveRequest: (args: any) => ipcRenderer.invoke('storage:saveRequest', args),
  deleteRequest: (args: any) => ipcRenderer.invoke('storage:deleteRequest', args),
  deleteCollection: (args: any) => ipcRenderer.invoke('storage:deleteCollection', args),
  renameCollection: (args: any) => ipcRenderer.invoke('storage:renameCollection', args),
  exportCollection: (args: any) => ipcRenderer.invoke('storage:exportCollection', args),
  importCollection: () => ipcRenderer.invoke('storage:importCollection'),
  openFolder: () => ipcRenderer.invoke('storage:openFolder'),

  // ===== History =====
  getHistory: () => ipcRenderer.invoke('storage:getHistory'),
  addHistory: (entry: any) => ipcRenderer.invoke('storage:addHistory', entry),
  clearHistory: () => ipcRenderer.invoke('storage:clearHistory'),

  // ===== Environments =====
  getEnvironments: () => ipcRenderer.invoke('storage:getEnvironments'),
  saveEnvironments: (envs: any[]) => ipcRenderer.invoke('storage:saveEnvironments', envs),

  // ===== Settings =====
  getSettings: () => ipcRenderer.invoke('storage:getSettings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('storage:saveSettings', settings),
})
