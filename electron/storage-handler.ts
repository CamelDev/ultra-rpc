import { ipcMain, dialog, app } from 'electron'
import fs from 'fs'
import path from 'path'

// Default storage root: user's home/.ultrarpc
const getStorageRoot = () => {
  const root = path.join(app.getPath('userData'), 'collections')
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })
  return root
}

const getHistoryPath = () => {
  const p = path.join(app.getPath('userData'), 'history.json')
  return p
}

const getEnvPath = () => {
  const p = path.join(app.getPath('userData'), 'environments.json')
  return p
}

interface SavedRequest {
  id: string
  name: string
  type: string
  method: string
  url: string
  params: any[]
  headers: any[]
  body: string
  bodyType: string
  grpcService?: string
  grpcMethod?: string
  grpcPayload?: string
  grpcReflection?: boolean
}

interface SavedCollection {
  id: string
  name: string
  requests: SavedRequest[]
}

export function registerStorageHandlers() {
  // ===== Collections =====

  // List all collections
  ipcMain.handle('storage:listCollections', async () => {
    try {
      const root = getStorageRoot()
      const dirs = fs.readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory())

      const collections: SavedCollection[] = []

      for (const dir of dirs) {
        const metaPath = path.join(root, dir.name, '_meta.json')
        let meta = { id: dir.name, name: dir.name }
        if (fs.existsSync(metaPath)) {
          try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          } catch { /* use defaults */ }
        }

        const requestFiles = fs.readdirSync(path.join(root, dir.name))
          .filter(f => f.endsWith('.json') && f !== '_meta.json')

        const requests: SavedRequest[] = []
        for (const file of requestFiles) {
          try {
            const content = fs.readFileSync(path.join(root, dir.name, file), 'utf-8')
            requests.push(JSON.parse(content))
          } catch { /* skip corrupt files */ }
        }

        collections.push({ id: meta.id, name: meta.name, requests })
      }

      return { success: true, collections }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Create a new collection
  ipcMain.handle('storage:createCollection', async (_event, args: { name: string }) => {
    try {
      const root = getStorageRoot()
      const id = args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      const collDir = path.join(root, id)

      if (fs.existsSync(collDir)) {
        return { success: false, error: 'Collection with that name already exists' }
      }

      fs.mkdirSync(collDir, { recursive: true })
      fs.writeFileSync(
        path.join(collDir, '_meta.json'),
        JSON.stringify({ id, name: args.name }, null, 2)
      )

      return { success: true, id }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Save a request to a collection
  ipcMain.handle('storage:saveRequest', async (_event, args: { collectionId: string; request: SavedRequest }) => {
    try {
      const root = getStorageRoot()
      const collDir = path.join(root, args.collectionId)

      if (!fs.existsSync(collDir)) {
        return { success: false, error: 'Collection not found' }
      }

      const filename = `${args.request.id}.json`
      fs.writeFileSync(
        path.join(collDir, filename),
        JSON.stringify(args.request, null, 2)
      )

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Delete a request from a collection
  ipcMain.handle('storage:deleteRequest', async (_event, args: { collectionId: string; requestId: string }) => {
    try {
      const root = getStorageRoot()
      const filePath = path.join(root, args.collectionId, `${args.requestId}.json`)

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Delete a collection
  ipcMain.handle('storage:deleteCollection', async (_event, args: { collectionId: string }) => {
    try {
      const root = getStorageRoot()
      const collDir = path.join(root, args.collectionId)
      if (fs.existsSync(collDir)) {
        fs.rmSync(collDir, { recursive: true, force: true })
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Rename a collection
  ipcMain.handle('storage:renameCollection', async (_event, args: { collectionId: string; newName: string }) => {
    try {
      const root = getStorageRoot()
      const metaPath = path.join(root, args.collectionId, '_meta.json')
      let meta = { id: args.collectionId, name: args.newName }
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { /* */ }
      }
      meta.name = args.newName
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ===== Import / Export =====

  // Export a collection as a single JSON file
  ipcMain.handle('storage:exportCollection', async (_event, args: { collectionId: string }) => {
    try {
      const root = getStorageRoot()
      const collDir = path.join(root, args.collectionId)

      if (!fs.existsSync(collDir)) {
        return { success: false, error: 'Collection not found' }
      }

      // Read meta
      const metaPath = path.join(collDir, '_meta.json')
      let meta = { id: args.collectionId, name: args.collectionId }
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { /* */ }
      }

      // Read all requests
      const requestFiles = fs.readdirSync(collDir)
        .filter(f => f.endsWith('.json') && f !== '_meta.json')
      const requests: SavedRequest[] = []
      for (const file of requestFiles) {
        try {
          requests.push(JSON.parse(fs.readFileSync(path.join(collDir, file), 'utf-8')))
        } catch { /* skip */ }
      }

      const exportData = {
        _ultrarpc_version: '1.0',
        collection: { ...meta, requests },
      }

      const result = await dialog.showSaveDialog({
        title: 'Export Collection',
        defaultPath: `${meta.name}.ultrarpc.json`,
        filters: [
          { name: 'UltraRPC Collection', extensions: ['ultrarpc.json', 'json'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Cancelled' }
      }

      fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2))
      return { success: true, path: result.filePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Import a collection from a JSON file
  ipcMain.handle('storage:importCollection', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Import Collection',
        filters: [
          { name: 'UltraRPC / JSON', extensions: ['json'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      const content = fs.readFileSync(result.filePaths[0], 'utf-8')
      const data = JSON.parse(content)

      // Support both UltraRPC format and generic array of requests
      let collectionName: string
      let requests: SavedRequest[]

      if (data._ultrarpc_version && data.collection) {
        collectionName = data.collection.name
        requests = data.collection.requests || []
      } else if (Array.isArray(data)) {
        collectionName = path.basename(result.filePaths[0], '.json')
        requests = data
      } else if (data.name && data.requests) {
        collectionName = data.name
        requests = data.requests
      } else {
        return { success: false, error: 'Unrecognized collection format' }
      }

      // Create collection folder
      const root = getStorageRoot()
      const id = collectionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      const collDir = path.join(root, id)
      fs.mkdirSync(collDir, { recursive: true })

      // Write meta
      fs.writeFileSync(
        path.join(collDir, '_meta.json'),
        JSON.stringify({ id, name: collectionName }, null, 2)
      )

      // Write requests
      for (const req of requests) {
        const reqId = req.id || Math.random().toString(36).substring(2, 11)
        fs.writeFileSync(
          path.join(collDir, `${reqId}.json`),
          JSON.stringify({ ...req, id: reqId }, null, 2)
        )
      }

      return { success: true, id, name: collectionName, requestCount: requests.length }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ===== Open collection folder to custom path (Bruno-style: use your repo) =====
  ipcMain.handle('storage:openFolder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Open Collection Folder',
        properties: ['openDirectory'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      const folderPath = result.filePaths[0]
      const folderName = path.basename(folderPath)

      // Read any .json files in the folder as requests
      const files = fs.readdirSync(folderPath)
        .filter(f => f.endsWith('.json') && f !== '_meta.json')

      const requests: SavedRequest[] = []
      for (const file of files) {
        try {
          requests.push(JSON.parse(fs.readFileSync(path.join(folderPath, file), 'utf-8')))
        } catch { /* skip */ }
      }

      // Symlink or copy to our storage so it appears in the list
      const root = getStorageRoot()
      const id = folderName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      const linkPath = path.join(root, id)

      // Store a reference file instead of duplicating
      if (!fs.existsSync(linkPath)) {
        fs.mkdirSync(linkPath, { recursive: true })
      }

      fs.writeFileSync(
        path.join(linkPath, '_meta.json'),
        JSON.stringify({ id, name: folderName, externalPath: folderPath }, null, 2)
      )

      // Copy requests to our storage
      for (const req of requests) {
        const reqId = req.id || Math.random().toString(36).substring(2, 11)
        fs.writeFileSync(
          path.join(linkPath, `${reqId}.json`),
          JSON.stringify({ ...req, id: reqId }, null, 2)
        )
      }

      return { success: true, id, name: folderName, requestCount: requests.length, path: folderPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ===== History =====

  ipcMain.handle('storage:getHistory', async () => {
    try {
      const histPath = getHistoryPath()
      if (!fs.existsSync(histPath)) return { success: true, history: [] }
      const data = JSON.parse(fs.readFileSync(histPath, 'utf-8'))
      return { success: true, history: data }
    } catch (err: any) {
      return { success: false, history: [], error: err.message }
    }
  })

  ipcMain.handle('storage:addHistory', async (_event, entry: any) => {
    try {
      const histPath = getHistoryPath()
      let history: any[] = []
      if (fs.existsSync(histPath)) {
        try { history = JSON.parse(fs.readFileSync(histPath, 'utf-8')) } catch { /* */ }
      }
      // Keep max 100 entries
      history.unshift(entry)
      if (history.length > 100) history = history.slice(0, 100)
      fs.writeFileSync(histPath, JSON.stringify(history, null, 2))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('storage:clearHistory', async () => {
    try {
      const histPath = getHistoryPath()
      fs.writeFileSync(histPath, '[]')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ===== Environments persistence =====

  ipcMain.handle('storage:getEnvironments', async () => {
    try {
      const envPath = getEnvPath()
      if (!fs.existsSync(envPath)) return { success: true, environments: [] }
      const data = JSON.parse(fs.readFileSync(envPath, 'utf-8'))
      return { success: true, environments: data }
    } catch (err: any) {
      return { success: false, environments: [], error: err.message }
    }
  })

  ipcMain.handle('storage:saveEnvironments', async (_event, envs: any[]) => {
    try {
      const envPath = getEnvPath()
      fs.writeFileSync(envPath, JSON.stringify(envs, null, 2))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
