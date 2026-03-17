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

const getSettingsPath = () => {
  const p = path.join(app.getPath('userData'), 'settings.json')
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
  timeoutMs?: number
  preRequestScript?: string
  postResponseScript?: string
}

interface SavedCollection {
  id: string
  name: string
  items: CollectionItem[]
  variables?: any[]
}

interface CollectionItem {
  id: string
  name: string
  type: 'folder' | 'request'
  request?: SavedRequest
  items?: CollectionItem[]
}

const validateRequest = (req: any): SavedRequest | null => {
  if (!req || typeof req !== 'object') return null
  
  // Basic heuristic: a request should have at least a URL or a name + method
  // We skip files that are obviously not requests (like package.json, _meta.json, etc.)
  if (!req.url && !req.name) return null
  if (!req.method && req.type !== 'GRPC') return null

  return {
    id: req.id || Math.random().toString(36).substring(2, 11),
    name: req.name || req.url || 'Untitled Request',
    type: req.type || 'REST',
    method: req.method || 'GET',
    url: req.url || '',
    params: Array.isArray(req.params) ? req.params : [],
    headers: Array.isArray(req.headers) ? req.headers : [],
    body: req.body || '',
    bodyType: req.bodyType || 'none',
    grpcService: req.grpcService,
    grpcMethod: req.grpcMethod,
    grpcPayload: req.grpcPayload,
    grpcReflection: typeof req.grpcReflection === 'boolean' ? req.grpcReflection : undefined,
    timeoutMs: req.timeoutMs,
    preRequestScript: req.preRequestScript,
    postResponseScript: req.postResponseScript
  }
}

const extractRequests = (data: any): CollectionItem[] => {
  const items: CollectionItem[] = []

  if (data.info && data.info.schema && data.info.schema.includes('postman')) {
    // Postman v2.1 format
    const mapItems = (postmanItems: any[]): CollectionItem[] => {
      const results: CollectionItem[] = []
      for (const item of postmanItems) {
        if (item.item && Array.isArray(item.item)) {
          results.push({
            id: Math.random().toString(36).substring(2, 11),
            name: item.name || 'Folder',
            type: 'folder',
            items: mapItems(item.item)
          })
        } else if (item.request) {
          const req = item.request
          const mapped: any = {
            id: Math.random().toString(36).substring(2, 11),
            name: item.name || 'Untitled Request',
            type: 'REST',
            method: typeof req.method === 'string' ? req.method : 'GET',
            url: typeof req.url === 'string' ? req.url : (req.url?.raw || ''),
            params: [],
            headers: (req.header || []).map((h: any) => ({
              id: Math.random().toString(36).substring(2, 11),
              key: h.key,
              value: h.value,
              enabled: !h.disabled
            })),
            body: req.body?.raw || '',
            bodyType: req.body?.mode === 'raw' ? 'json' : 'none'
          }

          if (item.event) {
            for (const event of item.event) {
              const script = (event.script?.exec || []).join('\n')
              if (!script) continue
              const convertedScript = script
                .replace(/pm\.environment\.set\(/g, 'ultra.env.set(')
                .replace(/pm\.environment\.get\(/g, 'ultra.env.get(')
                .replace(/pm\.collectionVariables\.set\(/g, 'ultra.collection.set(')
                .replace(/pm\.collectionVariables\.get\(/g, 'ultra.collection.get(')
                .replace(/pm\.response\.json\(\)/g, 'ultra.response.body')
              
              if (event.listen === 'prerequest') mapped.preRequestScript = convertedScript
              else if (event.listen === 'test') mapped.postResponseScript = convertedScript
            }
          }

          const validated = validateRequest(mapped)
          if (validated) {
            results.push({
              id: validated.id,
              name: validated.name,
              type: 'request',
              request: validated
            })
          }
        }
      }
      return results
    }
    items.push(...mapItems(data.item || []))
  } else if (data._ultrarpc_version && data.collection) {
    // UltraRPC format (handling legacy flat and new nested)
    const rawItems = data.collection.items || []
    if (rawItems.length > 0) {
      items.push(...rawItems)
    } else {
      // Legacy flat requests
      const rawReqs = data.collection.requests || []
      for (const r of rawReqs) {
        const validated = validateRequest(r)
        if (validated) {
          items.push({
            id: validated.id,
            name: validated.name,
            type: 'request',
            request: validated
          })
        }
      }
    }
  } else if (Array.isArray(data)) {
    // Generic array of requests
    for (const r of data) {
      const validated = validateRequest(r)
      if (validated) {
        items.push({
          id: validated.id,
          name: validated.name,
          type: 'request',
          request: validated
        })
      }
    }
  } else {
    // Single request
    const validated = validateRequest(data)
    if (validated) {
      items.push({
        id: validated.id,
        name: validated.name,
        type: 'request',
        request: validated
      })
    }
  }

  return items
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

      const buildTree = (dirPath: string): CollectionItem[] => {
        const items: CollectionItem[] = []
        const files = fs.readdirSync(dirPath, { withFileTypes: true })
        
        // Load meta for ordering if it exists in this folder
        let order: string[] = []
        const metaPath = path.join(dirPath, '_meta.json')
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
            order = meta.requestOrder || []
          } catch { /* */ }
        }

        for (const entry of files) {
          if (entry.name === '_meta.json') continue

          if (entry.isDirectory()) {
            items.push({
              id: entry.name,
              name: entry.name, // Will be overridden by meta if we add folder meta later
              type: 'folder',
              items: buildTree(path.join(dirPath, entry.name))
            })
          } else if (entry.name.endsWith('.json')) {
            try {
              const content = JSON.parse(fs.readFileSync(path.join(dirPath, entry.name), 'utf-8'))
              const validated = validateRequest(content)
              if (validated) {
                items.push({
                  id: validated.id,
                  name: validated.name,
                  type: 'request',
                  request: validated
                })
              }
            } catch { /* skip corrupt */ }
          }
        }

        // Apply ordering if meta exists
        if (order.length > 0) {
          items.sort((a, b) => {
            const idxA = order.indexOf(a.id)
            const idxB = order.indexOf(b.id)
            if (idxA !== -1 && idxB !== -1) return idxA - idxB
            if (idxA !== -1) return -1
            if (idxB !== -1) return 1
            return 0
          })
        }

        return items
      }

      for (const dir of dirs) {
        const collPath = path.join(root, dir.name)
        const metaPath = path.join(collPath, '_meta.json')
        let meta: any = { id: dir.name, name: dir.name, variables: [] }
        if (fs.existsSync(metaPath)) {
          try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          } catch { /* use defaults */ }
        }

        collections.push({
          id: meta.id,
          name: meta.name,
          items: buildTree(collPath),
          variables: meta.variables || []
        })
      }

      return { success: true, collections }
    } catch (err: any) {
      console.error('List Collections Error:', err)
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
  
  // Save collection variables
  ipcMain.handle('storage:saveCollectionVariables', async (_event, args: { collectionId: string; variables: any[] }) => {
    try {
      const root = getStorageRoot()
      const metaPath = path.join(root, args.collectionId, '_meta.json')
      let meta: any = { id: args.collectionId, name: args.collectionId, variables: [] }
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { /* */ }
      }
      meta.variables = args.variables
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Reorder requests in a collection
  ipcMain.handle('storage:reorderRequests', async (_event, args: { collectionId: string; order: string[] }) => {
    try {
      const root = getStorageRoot()
      const metaPath = path.join(root, args.collectionId, '_meta.json')
      let meta: any = { id: args.collectionId, name: args.collectionId, variables: [] }
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { /* */ }
      }
      meta.requestOrder = args.order
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
          { name: 'Postman Collection', extensions: ['postman_collection', 'json'] },
          { name: 'UltraRPC Collection', extensions: ['ultrarpc.json', 'json'] },
          { name: 'JSON Files', extensions: ['json'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      const content = fs.readFileSync(result.filePaths[0], 'utf-8')
      const data = JSON.parse(content)

      let collectionName = 'Imported Collection'
      const items = extractRequests(data)
      let variables: any[] = []

      if (data.info && data.info.name) {
        collectionName = data.info.name
      } else if (data.collection && data.collection.name) {
        collectionName = data.collection.name
      } else if (data.name) {
        collectionName = data.name
      } else {
        collectionName = path.basename(result.filePaths[0], path.extname(result.filePaths[0]))
      }

      if (data.variable) {
        variables = (data.variable || []).map((v: any) => ({
          id: Math.random().toString(36).substring(2, 11),
          key: v.key,
          value: v.value,
          enabled: true
        }))
      } else if (data.collection && data.collection.variables) {
        variables = data.collection.variables
      }

      if (items.length === 0) {
        return { success: false, error: 'No valid requests found in file' }
      }

      // Create collection folder
      const root = getStorageRoot()
      const id = collectionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      
      let finalId = id
      let counter = 1
      while (fs.existsSync(path.join(root, finalId))) {
        finalId = `${id}-${counter++}`
      }
      
      const finalCollDir = path.join(root, finalId)
      fs.mkdirSync(finalCollDir, { recursive: true })

      // Write meta
      fs.writeFileSync(
        path.join(finalCollDir, '_meta.json'),
        JSON.stringify({ id: finalId, name: collectionName, variables }, null, 2)
      )

      // Write tree
      const saveItems = (folderPath: string, itemsToSave: CollectionItem[]) => {
        for (const item of itemsToSave) {
          if (item.type === 'folder' && item.items) {
            const subDir = path.join(folderPath, item.name.replace(/[^a-z0-9 ]+/gi, '_'))
            fs.mkdirSync(subDir, { recursive: true })
            saveItems(subDir, item.items)
          } else if (item.type === 'request' && item.request) {
            fs.writeFileSync(
              path.join(folderPath, `${item.request.id}.json`),
              JSON.stringify(item.request, null, 2)
            )
          }
        }
      }
      saveItems(finalCollDir, items)

      return { success: true, id: finalId, name: collectionName, requestCount: items.length }
    } catch (err: any) {
      console.error('Import Error:', err)
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

      const items = buildStaticTree(folderPath)

      if (items.length === 0) {
        return { success: false, error: 'No valid requests found in the selected folder' }
      }

      // Symlink or copy to our storage so it appears in the list
      const root = getStorageRoot()
      const id = folderName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      const destPath = path.join(root, id)

      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true })
      }

      fs.writeFileSync(
        path.join(destPath, '_meta.json'),
        JSON.stringify({ id, name: folderName, externalPath: folderPath }, null, 2)
      )

      const copyItems = (src: string, dest: string) => {
        const entries = fs.readdirSync(src, { withFileTypes: true })
        for (const entry of entries) {
          const s = path.join(src, entry.name)
          const d = path.join(dest, entry.name)
          if (entry.isDirectory()) {
            fs.mkdirSync(d, { recursive: true })
            copyItems(s, d)
          } else if (entry.name.endsWith('.json')) {
            try {
              const content = JSON.parse(fs.readFileSync(s, 'utf-8'))
              const validated = validateRequest(content)
              if (validated) {
                fs.writeFileSync(d, JSON.stringify(validated, null, 2))
              }
            } catch { /* skip */ }
          }
        }
      }
      copyItems(folderPath, destPath)

      return { success: true, id, name: folderName, path: folderPath }
    } catch (err: any) {
      console.error('Open Folder Error:', err)
      return { success: false, error: err.message }
    }
  })

function buildStaticTree(dirPath: string): CollectionItem[] {
  const items: CollectionItem[] = []
  const files = fs.readdirSync(dirPath, { withFileTypes: true })
  
  for (const entry of files) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const subItems = buildStaticTree(fullPath)
      if (subItems.length > 0) {
        items.push({
          id: entry.name,
          name: entry.name,
          type: 'folder',
          items: subItems
        })
      }
    } else if (entry.name.endsWith('.json') || entry.name.endsWith('.postman_collection')) {
      try {
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
        const extracted = extractRequests(content)
        items.push(...extracted)
      } catch { /* skip */ }
    }
  }
  return items
}

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
      // Keep max 30 entries
      history.unshift(entry)
      if (history.length > 30) history = history.slice(0, 30)
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

  ipcMain.handle('storage:importEnvironment', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Import Postman Environment',
        filters: [
          { name: 'Postman Environment', extensions: ['json'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      const content = fs.readFileSync(result.filePaths[0], 'utf-8')
      const data = JSON.parse(content)

      const processEnv = (envData: any) => {
        const name = envData.name || 'Imported Environment'
        const values = envData.values || []
        const variables = values.map((v: any) => ({
          id: Math.random().toString(36).substring(2, 11),
          key: v.key,
          value: v.value,
          enabled: v.enabled !== false
        }))
        // Ensure at least one empty row for the UI if it's empty
        if (variables.length === 0) {
          variables.push({ id: Math.random().toString(36).substring(2, 11), key: '', value: '', enabled: true })
        }
        return {
          id: Math.random().toString(36).substring(2, 11),
          name,
          variables,
          isActive: false
        }
      }

      let imported: any[] = []
      if (Array.isArray(data)) {
        imported = data.map(processEnv)
      } else if (data.info && data.info.schema && data.info.schema.includes('environment')) {
        // Single environment format
        imported = [processEnv(data)]
      } else if (data.values && Array.isArray(data.values)) {
        // Likely a naked environment object
        imported = [processEnv(data)]
      } else {
        return { success: false, error: 'Invalid Postman Environment format' }
      }

      return { success: true, environments: imported }
    } catch (err: any) {
      console.error('Import Environment Error:', err)
      return { success: false, error: err.message }
    }
  })

  // ===== Settings Persistence =====

  ipcMain.handle('storage:getSettings', async () => {
    try {
      const settingsPath = getSettingsPath()
      if (!fs.existsSync(settingsPath)) {
        return { success: true, settings: { theme: 'dark' } }
      }
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      return { success: true, settings: data }
    } catch (err: any) {
      return { success: false, settings: { theme: 'dark' }, error: err.message }
    }
  })

  ipcMain.handle('storage:saveSettings', async (_event, settings: any) => {
    try {
      const settingsPath = getSettingsPath()
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
