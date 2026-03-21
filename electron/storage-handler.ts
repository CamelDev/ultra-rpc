import { ipcMain, dialog, app, shell } from 'electron'
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

const findFileRecursively = (dir: string, filename: string): string | null => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFileRecursively(fullPath, filename)
      if (found) return found
    } else if (entry.name === filename) {
      return fullPath
    }
  }
  return null
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
  children: CollectionItem[]
  variables?: any[]
  path?: string
}

interface CollectionItem {
  id: string
  name: string
  type: 'folder' | 'request'
  request?: SavedRequest
  children?: CollectionItem[]
}

const validateRequest = (req: any, idOverride?: string): SavedRequest | null => {
  if (!req || typeof req !== 'object') return null

  // Basic heuristic: a request should have at least a URL or a name + method
  // We skip files that are obviously not requests (like package.json, _meta.json, etc.)
  if (!req.url && !req.name) return null
  if (!req.method && req.type !== 'GRPC') return null

  return {
    id: idOverride || req.id || Math.random().toString(36).substring(2, 11),
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

const findRequestByIdRecursively = (dir: string, requestId: string): string | null => {
  const filename = `${requestId}.json`
  console.log(`[storage] findRequestByIdRecursively: searching for ${filename} in ${dir}`)
  const found = findFileRecursively(dir, filename)
  if (found) console.log(`[storage] Found request at: ${found}`)
  else console.warn(`[storage] Request NOT found: ${filename} in ${dir}`)
  return found
}

const findFolderByIdRecursively = (dir: string, folderId: string): string | null => {
  const metaPath = path.join(dir, '_meta.json')
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      if (meta.id === folderId) return dir
    } catch { /* skip */ }
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findFolderByIdRecursively(path.join(dir, entry.name), folderId)
      if (found) return found
    }
  }
  return null
}

const updateOrderMeta = (dirPath: string, itemId: string, action: 'add' | 'remove' | 'add-after', index?: number, refId?: string) => {
  const metaPath = path.join(dirPath, '_meta.json')
  let meta: any = { id: path.basename(dirPath), name: path.basename(dirPath), requestOrder: [] }
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    } catch { /* skip */ }
  }
  if (!meta.requestOrder) meta.requestOrder = []

  const existingIdx = meta.requestOrder.indexOf(itemId)
  if (existingIdx !== -1) meta.requestOrder.splice(existingIdx, 1)

  if (action === 'add') {
    if (typeof index === 'number') {
      meta.requestOrder.splice(index, 0, itemId)
    } else {
      meta.requestOrder.push(itemId)
    }
  } else if (action === 'add-after' && refId) {
    const idx = meta.requestOrder.indexOf(refId)
    if (idx !== -1) {
      meta.requestOrder.splice(idx + 1, 0, itemId)
    } else {
      meta.requestOrder.push(itemId)
    }
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
}

const getCollectionDir = (collectionId: string): string | null => {
  console.log('[storage] Resolving collection dir for:', collectionId)
  const root = getStorageRoot()
  const defaultDir = path.join(root, collectionId)
  if (fs.existsSync(defaultDir)) {
    console.log('[storage] Found in default root:', defaultDir)
    return defaultDir
  }

  // Check external paths
  const settingsPath = getSettingsPath()
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      const paths: string[] = Array.isArray(settings.collectionPaths) ? settings.collectionPaths : []
      console.log('[storage] Checking external paths:', paths)
      const extPath = paths.find(p => {
        if (!fs.existsSync(p)) return false
        try {
          const m = JSON.parse(fs.readFileSync(path.join(p, '_meta.json'), 'utf-8'))
          return m.id === collectionId
        } catch { return false }
      })
      if (extPath) {
        console.log('[storage] Found in external path:', extPath)
        return extPath
      }
    } catch (e) {
      console.error('[storage] Error reading settings:', e)
    }
  }

  console.warn('[storage] Collection NOT found for ID:', collectionId)
  return null
}

/**
 * Ensures that the requestOrder in _meta.json matches the actual files on disk.
 * - Removes dead IDs
 * - Adds missing IDs
 * - Deduplicates
 */
const verifyAndRepairOrder = (dirPath: string, discoveredIds: string[]): string[] => {
  const metaPath = path.join(dirPath, '_meta.json')
  let meta: any = { id: path.basename(dirPath), name: path.basename(dirPath), requestOrder: [] }

  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    } catch { /* skip */ }
  }

  const currentOrder: string[] = Array.isArray(meta.requestOrder) ? meta.requestOrder : []

  // 1. Filter out IDs that no longer exist on disk
  const existingOrder = currentOrder.filter(id => discoveredIds.includes(id))

  // 2. Add IDs from disk that are missing in the order
  const missingInOrder = discoveredIds.filter(id => !existingOrder.includes(id))

  // 3. Combine and deduplicate
  const finalOrder = [...new Set([...existingOrder, ...missingInOrder])]

  const hasChanged = JSON.stringify(currentOrder) !== JSON.stringify(finalOrder)
  if (hasChanged || !meta.requestOrder) {
    meta.requestOrder = finalOrder
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
  }

  return finalOrder
}

const extractRequests = (data: any): CollectionItem[] => {
  const children: CollectionItem[] = []

  if (data.info && data.info.schema && data.info.schema.includes('postman')) {
    // Postman v2.1 format
    const mapItems = (postmanItems: any[], pathPrefix = 'pm'): CollectionItem[] => {
      const results: CollectionItem[] = []
      for (let i = 0; i < postmanItems.length; i++) {
        const item = postmanItems[i]
        const stableId = `${pathPrefix}_${i}`

        if (item.item && Array.isArray(item.item)) {
          results.push({
            id: stableId,
            name: item.name || 'Folder',
            type: 'folder',
            children: mapItems(item.item, stableId)
          })
        } else if (item.request) {
          const req = item.request
          const requestId = stableId
          const mapped: any = {
            id: requestId,
            name: item.name || 'Untitled Request',
            type: 'REST',
            method: typeof req.method === 'string' ? req.method : 'GET',
            url: typeof req.url === 'string' ? req.url : (req.url?.raw || ''),
            params: [],
            headers: (req.header || []).map((h: any, hi: number) => ({
              id: `${requestId}_h_${hi}`,
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

          const validated = validateRequest(mapped, requestId)
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
    children.push(...mapItems(data.item || []))
  } else if (data._ultrarpc_version && data.collection) {
    // UltraRPC format (handling legacy flat and new nested)
    const rawItems = data.collection.children || data.collection.items || []
    if (rawItems.length > 0) {
      children.push(...rawItems)
    } else {
      // Legacy flat requests
      const rawReqs = data.collection.requests || []
      for (const r of rawReqs) {
        const validated = validateRequest(r, r.id)
        if (validated) {
          children.push({
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
        children.push({
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
      children.push({
        id: validated.id,
        name: validated.name,
        type: 'request',
        request: validated
      })
    }
  }

  return children
}

export function registerStorageHandlers() {
  // ===== Collections =====

  // List all collections (default storage + externally-registered paths)
  ipcMain.handle('storage:listCollections', async () => {
    try {
      const root = getStorageRoot()
      const warnings: string[] = []

      const buildTree = (dirPath: string): CollectionItem[] => {
        const childrenList: CollectionItem[] = []
        const files = fs.readdirSync(dirPath, { withFileTypes: true })

        for (const entry of files) {
          if (entry.name === '_meta.json') continue
          const fullPath = path.join(dirPath, entry.name)

          if (entry.isDirectory()) {
            let folderId = entry.name
            const subMetaPath = path.join(fullPath, '_meta.json')
            if (fs.existsSync(subMetaPath)) {
              try {
                const subMeta = JSON.parse(fs.readFileSync(subMetaPath, 'utf-8'))
                if (subMeta.id) folderId = subMeta.id
              } catch { /* */ }
            } else {
              folderId = Math.random().toString(36).substring(2, 11)
              fs.writeFileSync(subMetaPath, JSON.stringify({ id: folderId, name: entry.name }, null, 2))
            }
            childrenList.push({
              id: folderId, name: entry.name, type: 'folder', children: buildTree(fullPath)
            })
          } else if (entry.name.endsWith('.json')) {
            try {
              const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
              const idFromDisk = path.basename(entry.name, '.json')
              const validated = validateRequest(content, idFromDisk)
              if (validated) {
                // Ensure internal ID matches filename
                if (validated.id !== idFromDisk) {
                  validated.id = idFromDisk
                  // We don't necessarily need to write it back immediately, 
                  // but the UI must use the filename-based ID.
                }
                childrenList.push({ id: validated.id, name: validated.name, type: 'request', request: validated })
              }
            } catch { /* skip corrupt */ }
          }
        }

        const discoveredIds = childrenList.map(item => item.id)
        const validatedOrder = verifyAndRepairOrder(dirPath, discoveredIds)
        if (validatedOrder.length > 0) {
          childrenList.sort((a, b) => {
            const idxA = validatedOrder.indexOf(a.id)
            const idxB = validatedOrder.indexOf(b.id)
            if (idxA !== -1 && idxB !== -1) return idxA - idxB
            if (idxA !== -1) return -1
            if (idxB !== -1) return 1
            return 0
          })
        }
        return childrenList
      }

      const loadCollectionFromDir = (collDir: string, displayPath: string): SavedCollection | null => {
        const metaPath = path.join(collDir, '_meta.json')
        const dirName = path.basename(collDir)

        // The directory name is the source of truth for the collection name.
        // The ID is the slugified directory name to ensure valid paths and consistency.
        const name = dirName
        const id = dirName.toLowerCase().replace(/[^a-z0-9]+/g, '-')

        let meta: any = { variables: [] }
        if (fs.existsSync(metaPath)) {
          try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          } catch { /* use defaults */ }
        }

        // Clean up or backfill meta (we no longer store name, and ID should match dir slug)
        let changed = false
        if (meta.name) { delete meta.name; changed = true }
        if (meta.id !== id) { meta.id = id; changed = true }
        if (!meta.path) { meta.path = displayPath; changed = true }

        if (changed) {
          try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)) } catch { /* ignore */ }
        }

        return {
          id,
          name,
          children: buildTree(collDir),
          variables: meta.variables || [],
          path: displayPath
        }
      }

      const collections: SavedCollection[] = []
      const seenIds = new Set<string>()

      // 1. Default storage directory
      const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory())
      for (const dir of dirs) {
        const collPath = path.join(root, dir.name)
        const coll = loadCollectionFromDir(collPath, collPath)
        if (coll && !seenIds.has(coll.id)) {
          seenIds.add(coll.id)
          collections.push(coll)
        }
      }

      // 2. Externally-registered paths (moved collections)
      let externalPaths: string[] = []
      try {
        const settingsPath = getSettingsPath()
        if (fs.existsSync(settingsPath)) {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
          externalPaths = Array.isArray(settings.collectionPaths) ? settings.collectionPaths : []
        }
      } catch { /* ignore */ }

      for (const extPath of externalPaths) {
        if (!fs.existsSync(extPath)) {
          warnings.push(`Collection folder not found: ${extPath}`)
          continue
        }
        const coll = loadCollectionFromDir(extPath, extPath)
        if (coll) {
          if (!seenIds.has(coll.id)) {
            seenIds.add(coll.id)
            collections.push(coll)
          }
        }
      }

      return { success: true, collections, warnings }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Create a new collection
  ipcMain.handle('storage:createCollection', async (_event, args: { name: string, path?: string }) => {
    try {
      const root = getStorageRoot()
      const id = args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')

      let collDir: string
      if (args.path) {
        collDir = path.join(args.path, id)
      } else {
        collDir = path.join(root, id)
      }

      if (fs.existsSync(collDir)) {
        return { success: false, error: 'Collection with that name already exists in the target location' }
      }

      fs.mkdirSync(collDir, { recursive: true })

      const meta = { id, path: collDir }
      fs.writeFileSync(
        path.join(collDir, '_meta.json'),
        JSON.stringify(meta, null, 2)
      )

      // If external path, register in settings
      if (args.path) {
        const settingsPath = getSettingsPath()
        let settings: any = {}
        if (fs.existsSync(settingsPath)) {
          try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) } catch { /* */ }
        }
        const paths: string[] = Array.isArray(settings.collectionPaths) ? settings.collectionPaths : []
        if (!paths.includes(collDir)) paths.push(collDir)
        settings.collectionPaths = paths
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      }

      return { success: true, id }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Pick a folder for collection creation or import
  ipcMain.handle('storage:pickFolder', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Collection Parent Folder',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }
      return { success: true, path: result.filePaths[0] }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Pick a file for gRPC proto
  ipcMain.handle('storage:pickFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Proto File',
        filters: [{ name: 'Protocol Buffers', extensions: ['proto'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }
      return { success: true, path: result.filePaths[0] }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Link an existing folder as a collection
  ipcMain.handle('storage:linkCollection', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Existing Collection Folder',
        properties: ['openDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      const folderPath = result.filePaths[0]
      const folderName = path.basename(folderPath)
      const metaPath = path.join(folderPath, '_meta.json')

      // Check for meta, create if missing, or update if exists
      // Favor the folder name as the ID base for new links to avoid collisions
      const derivedId = folderName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')

      if (!fs.existsSync(metaPath)) {
        fs.writeFileSync(
          metaPath,
          JSON.stringify({ id: derivedId, path: folderPath }, null, 2)
        )
      } else {
        // Ensure path and ID are updated in meta if it exists (ensuring uniqueness)
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          meta.path = folderPath
          // If the folder name was changed manually, the ID in meta might still be old.
          // We'll update it to match the folder name to avoid collisions if they copied/renamed.
          meta.id = derivedId
          delete meta.name // clean up old name property
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
        } catch { /* ignore */ }
      }

      // Register in settings
      const settingsPath = getSettingsPath()
      let settings: any = {}
      if (fs.existsSync(settingsPath)) {
        try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) } catch { /* */ }
      }
      const paths: string[] = Array.isArray(settings.collectionPaths) ? settings.collectionPaths : []
      if (!paths.includes(folderPath)) paths.push(folderPath)
      settings.collectionPaths = paths
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

      return { success: true, path: folderPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Save a request to a collection
  ipcMain.handle('storage:saveRequest', async (_event, args: { collectionId: string; request: SavedRequest }) => {
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) {
        return { success: false, error: 'Collection not found: ' + args.collectionId }
      }

      const filename = `${args.request.id}.json`
      // Check if file exists recursively first (to update in its current folder)
      let targetPath = findFileRecursively(collDir, filename)
      if (!targetPath) {
        targetPath = path.join(collDir, filename)
      }

      fs.writeFileSync(
        targetPath,
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
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) {
        return { success: false, error: 'Collection not found' }
      }

      const filename = `${args.requestId}.json`
      const filePath = findFileRecursively(collDir, filename)

      if (filePath && fs.existsSync(filePath)) {
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
      const collDir = getCollectionDir(args.collectionId)
      if (collDir && fs.existsSync(collDir)) {
        fs.rmSync(collDir, { recursive: true, force: true })
        
        // If it was an external path, remove from settings
        const root = getStorageRoot()
        if (!collDir.startsWith(root)) {
           const settingsPath = getSettingsPath()
           if (fs.existsSync(settingsPath)) {
              try {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
                if (Array.isArray(settings.collectionPaths)) {
                  settings.collectionPaths = settings.collectionPaths.filter((p: string) => p !== collDir)
                  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
                }
              } catch { /* skip */ }
           }
        }
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Delete a folder within a collection
  ipcMain.handle('storage:deleteFolder', async (_event, args: { collectionId: string; folderPath: string }) => {
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }
      
      const fullPath = path.join(collDir, args.folderPath)
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true })
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Create a new folder within a collection
  ipcMain.handle('storage:createFolder', async (_event, args: { collectionId: string; folderName: string; parentId?: string }) => {
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }

      let parentPath = collDir
      if (args.parentId && args.parentId !== args.collectionId) {
        const found = findFolderByIdRecursively(collDir, args.parentId)
        if (!found) return { success: false, error: 'Parent folder not found' }
        parentPath = found
      }

      const folderSlug = args.folderName.replace(/[^a-z0-9 -]+/gi, '_')
      const folderPath = path.join(parentPath, folderSlug)

      if (fs.existsSync(folderPath)) {
        return { success: false, error: 'A folder with that name already exists in this location' }
      }

      fs.mkdirSync(folderPath, { recursive: true })
      
      const folderId = Math.random().toString(36).substring(2, 11)
      const subMetaPath = path.join(folderPath, '_meta.json')
      fs.writeFileSync(
        subMetaPath,
        JSON.stringify({ id: folderId, name: args.folderName }, null, 2)
      )

      return { success: true, id: folderId }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Rename a folder within a collection
  ipcMain.handle('storage:renameFolder', async (_event, args: { collectionId: string; folderId: string; newName: string }) => {
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }

      const oldPath = findFolderByIdRecursively(collDir, args.folderId)
      if (!oldPath) return { success: false, error: 'Folder not found' }

      const parentDir = path.dirname(oldPath)
      const folderSlug = args.newName.replace(/[^a-z0-9 -]+/gi, '_')
      const newPath = path.join(parentDir, folderSlug)

      if (oldPath !== newPath && fs.existsSync(newPath)) {
        return { success: false, error: 'A folder with that name already exists in this location' }
      }

      fs.renameSync(oldPath, newPath)

      // Update _meta.json
      const metaPath = path.join(newPath, '_meta.json')
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          meta.name = args.newName
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
        } catch { /* */ }
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Rename a collection — renames dir to match new name slug, checks for duplicates
  ipcMain.handle('storage:renameCollection', async (_event, args: { collectionId: string; newName: string }) => {
    try {
      let oldDir = getCollectionDir(args.collectionId)
      let isExternal = false

      if (!oldDir) {
        return { success: false, error: 'Collection not found' }
      }
      
      const root = getStorageRoot()
      isExternal = !oldDir.startsWith(root)

      const trimmedName = args.newName.trim()
      if (!trimmedName) return { success: false, error: 'Name cannot be empty' }

      const newSlug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const parentDir = path.dirname(oldDir)
      const newDir = path.join(parentDir, newSlug)

      if (newSlug !== path.basename(oldDir) && fs.existsSync(newDir)) {
        return { success: false, error: `A folder named "${newSlug}" already exists in that location` }
      }

      fs.renameSync(oldDir, newDir)

      // Update _meta.json
      const metaPath = path.join(newDir, '_meta.json')
      let meta: any = { id: newSlug }
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { /* */ }
      }
      meta.id = newSlug
      delete meta.name // Only directory name is valid for the collection name
      if (isExternal || meta.path) {
        meta.path = newDir
      }
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))

      // Update settings.json if external
      if (isExternal) {
        const settingsPath = getSettingsPath()
        let settings: any = {}
        if (fs.existsSync(settingsPath)) {
          try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) } catch { /* */ }
        }
        const paths = Array.isArray(settings.collectionPaths) ? settings.collectionPaths : []
        const idx = paths.indexOf(oldDir)
        if (idx !== -1) {
          paths[idx] = newDir
          settings.collectionPaths = paths
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
        }
      }

      return { success: true, newId: newSlug }
    } catch (err: any) {
      console.error('[storage] Rename Collection Error:', err)
      return { success: false, error: err.message }
    }
  })

  // Clone a collection
  ipcMain.handle('storage:cloneCollection', async (_event, args: { collectionId: string }) => {
    try {
      const srcDir = getCollectionDir(args.collectionId)
      if (!srcDir) return { success: false, error: 'Source collection not found' }

      const parentDir = path.dirname(srcDir)
      const baseName = path.basename(srcDir)
      
      let newName = `${baseName} Copy`
      let newSlug = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      let destDir = path.join(parentDir, newSlug)
      
      let counter = 1
      while (fs.existsSync(destDir)) {
        newName = `${baseName} Copy ${counter}`
        newSlug = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        destDir = path.join(parentDir, newSlug)
        counter++
      }

      // Copy directory recursively
      fs.cpSync(srcDir, destDir, { recursive: true })

      // Update ID in the new _meta.json
      const metaPath = path.join(destDir, '_meta.json')
      let meta: any = { id: newSlug }
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          meta.id = newSlug
          delete meta.name // Slug is source of truth
          if (meta.path) meta.path = destDir
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
        } catch { /* ignore */ }
      }

      // If external, register new path in settings
      const root = getStorageRoot()
      if (!destDir.startsWith(root)) {
        const settingsPath = getSettingsPath()
        let settings: any = {}
        if (fs.existsSync(settingsPath)) {
          try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) } catch { /* */ }
        }
        const paths: string[] = Array.isArray(settings.collectionPaths) ? settings.collectionPaths : []
        if (!paths.includes(destDir)) {
          paths.push(destDir)
          settings.collectionPaths = paths
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
        }
      }

      return { success: true, id: newSlug }
    } catch (err: any) {
      console.error('[storage] Clone Collection Error:', err)
      return { success: false, error: err.message }
    }
  })

  // Save collection variables
  ipcMain.handle('storage:saveCollectionVariables', async (_event, args: { collectionId: string; variables: any[] }) => {
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }

      const metaPath = path.join(collDir, '_meta.json')
      let meta: any = { id: args.collectionId, variables: [] }
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

  // Move an item (request or folder) to a new location
  ipcMain.handle('storage:moveItem', async (_event, args: { collectionId: string; itemId: string; targetCollectionId?: string; targetParentId: string | null; newIndex: number }) => {
    try {
      const srcCollDir = getCollectionDir(args.collectionId)
      if (!srcCollDir) return { success: false, error: 'Source collection not found' }

      const targetCollectionId = args.targetCollectionId || args.collectionId
      const targetCollDir = getCollectionDir(targetCollectionId)
      if (!targetCollDir) return { success: false, error: 'Target collection not found' }

      // 1. Find the item (request or folder) in source collection
      let sourcePath = findRequestByIdRecursively(srcCollDir, args.itemId)
      let isRequest = true
      if (!sourcePath) {
        sourcePath = findFolderByIdRecursively(srcCollDir, args.itemId)
        isRequest = false
      }

      if (!sourcePath) return { success: false, error: 'Item not found' }

      // 2. Find the target parent in target collection
      let targetParentPath = targetCollDir
      if (args.targetParentId) {
        // targetParentId could be a folder ID or the collection ID itself
        if (args.targetParentId === targetCollectionId) {
          targetParentPath = targetCollDir
        } else {
          const foundPath = findFolderByIdRecursively(targetCollDir, args.targetParentId)
          if (!foundPath) return { success: false, error: 'Target parent not found' }
          targetParentPath = foundPath
        }
      }

      // 3. Determine new path
      let itemName = path.basename(sourcePath)
      let newPath = path.join(targetParentPath, itemName)

      // Handle collision in target
      if (sourcePath !== newPath && fs.existsSync(newPath)) {
        const ext = isRequest ? '.json' : ''
        const base = isRequest ? path.basename(itemName, '.json') : itemName
        let counter = 1
        while (fs.existsSync(newPath)) {
          itemName = `${base}-${counter}${ext}`
          newPath = path.join(targetParentPath, itemName)
          counter++
        }
      }

      const sourceParentPath = path.dirname(sourcePath)

      // 4. Move the file/folder
      if (sourcePath !== newPath) {
        fs.renameSync(sourcePath, newPath)
        
        // If it's a request, we might need to update its internal ID if it's a slug,
        // but currently we use the base filename as ID in many places.
        // Let's check if the ID needs update.
        if (isRequest) {
          try {
            const data = JSON.parse(fs.readFileSync(newPath, 'utf-8'))
            const newId = path.basename(newPath, '.json')
            if (data.id !== newId) {
              data.id = newId
              fs.writeFileSync(newPath, JSON.stringify(data, null, 2))
            }
          } catch { /* skip */ }
        }
      }

      // 5. Update ordering in source parent and target parent
      updateOrderMeta(sourceParentPath, args.itemId, 'remove')
      const finalItemId = isRequest ? path.basename(newPath, '.json') : path.basename(newPath)
      updateOrderMeta(targetParentPath, finalItemId, 'add', args.newIndex)

      return { success: true }
    } catch (err: any) {
      console.error('Move Item Error:', err)
      return { success: false, error: err.message }
    }
  })

  // Clone a request
  ipcMain.handle('storage:cloneRequest', async (_event, args: { collectionId: string; requestId: string }) => {
    console.log('[storage] Clone Request:', args)
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }

      const sourcePath = findRequestByIdRecursively(collDir, args.requestId)
      console.log('[storage] Source path found:', sourcePath)
      if (!sourcePath) return { success: false, error: 'Request not found' }

      const dir = path.dirname(sourcePath)
      const baseName = path.basename(sourcePath, '.json')
      
      let newId = `${baseName}-copy`
      let newPath = path.join(dir, `${newId}.json`)
      
      let counter = 1
      while (fs.existsSync(newPath)) {
        newId = `${baseName}-copy-${counter}`
        newPath = path.join(dir, `${newId}.json`)
        counter++
      }

      // Read, update, and write
      const content = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'))
      content.id = newId
      content.name = (content.name || 'Untitled') + ' Copy'
      fs.writeFileSync(newPath, JSON.stringify(content, null, 2))

      // Update order meta: place it right after the original
      updateOrderMeta(dir, newId, 'add-after', 0, args.requestId)

      return { success: true, id: newId }
    } catch (err: any) {
      console.error('[storage] Clone Request Error:', err)
      return { success: false, error: err.message }
    }
  })

  // Move a collection directory to a user-chosen location
  ipcMain.handle('storage:moveCollection', async (_event, args: { collectionId: string, currentPath?: string }) => {
    try {
      const root = getStorageRoot()
      let srcDir = args.currentPath || path.join(root, args.collectionId)

      if (!fs.existsSync(srcDir)) {
        // Try resolving from ID in default storage if no path given
        srcDir = path.join(root, args.collectionId)
      }

      if (!fs.existsSync(srcDir)) {
        return { success: false, error: 'Collection not found at: ' + srcDir }
      }

      // Read current meta to get human-readable name
      const srcMetaPath = path.join(srcDir, '_meta.json')
      let meta: any = { id: args.collectionId, name: args.collectionId }
      if (fs.existsSync(srcMetaPath)) {
        try { meta = JSON.parse(fs.readFileSync(srcMetaPath, 'utf-8')) } catch { /* */ }
      }

      // Show directory picker
      const result = await dialog.showOpenDialog({
        title: `Move "${meta.name}" to…`,
        properties: ['openDirectory', 'createDirectory'],
        message: 'Choose the destination folder for this collection',
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      const destParent = result.filePaths[0]
      const destDir = path.join(destParent, path.basename(srcDir))

      if (fs.existsSync(destDir)) {
        return { success: false, error: `A folder named "${path.basename(srcDir)}" already exists at the destination` }
      }

      // Copy recursively then remove source
      fs.cpSync(srcDir, destDir, { recursive: true })

      // Update _meta.json in destination with new path
      const destMetaPath = path.join(destDir, '_meta.json')
      if (fs.existsSync(destMetaPath)) {
        try {
          const m = JSON.parse(fs.readFileSync(destMetaPath, 'utf-8'))
          m.path = destDir
          delete m.externalPath // clean up old field if present
          fs.writeFileSync(destMetaPath, JSON.stringify(m, null, 2))
        } catch { /* */ }
      }

      // Register new path and cleanup old in settings
      const settingsPath = getSettingsPath()
      let settings: any = {}
      if (fs.existsSync(settingsPath)) {
        try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) } catch { /* */ }
      }

      let paths: string[] = Array.isArray(settings.collectionPaths) ? settings.collectionPaths : []

      // Remove old path if it was there
      paths = paths.filter(p => p !== srcDir)

      // Add new path if it's NOT in the default app data location
      if (!destDir.startsWith(root)) {
        if (!paths.includes(destDir)) paths.push(destDir)
      }

      settings.collectionPaths = paths
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

      // Remove old directory
      fs.rmSync(srcDir, { recursive: true, force: true })

      return { success: true, newPath: destDir }
    } catch (err: any) {
      console.error('Move Collection Error:', err)
      return { success: false, error: err.message }
    }
  })


  // Return the filesystem path of a collection
  ipcMain.handle('storage:getCollectionPath', async (_event, args: { collectionId: string }) => {
    try {
      const root = getStorageRoot()
      const collPath = path.join(root, args.collectionId)
      const metaPath = path.join(collPath, '_meta.json')
      let resolvedPath = collPath
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          if (meta.externalPath) resolvedPath = meta.externalPath
          else if (meta.path) resolvedPath = meta.path
        } catch { /* use default */ }
      }
      return { success: true, path: resolvedPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Reveal a collection folder in the OS file manager
  ipcMain.handle('storage:showCollectionInFolder', async (_event, args: { collectionId: string }) => {
    try {
      const root = getStorageRoot()
      const collPath = path.join(root, args.collectionId)
      const metaPath = path.join(collPath, '_meta.json')
      let resolvedPath = collPath
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          if (meta.externalPath) resolvedPath = meta.externalPath
          else if (meta.path) resolvedPath = meta.path
        } catch { /* use default */ }
      }
      shell.showItemInFolder(resolvedPath)
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
      const children = extractRequests(data)
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

      if (children.length === 0) {
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
      const saveItems = (folderPath: string, childrenToSave: CollectionItem[]) => {
        for (const item of childrenToSave) {
          if (item.type === 'folder' && item.children) {
            const subDir = path.join(folderPath, item.name.replace(/[^a-z0-9 ]+/gi, '_'))
            fs.mkdirSync(subDir, { recursive: true })
            saveItems(subDir, item.children)
          } else if (item.type === 'request' && item.request) {
            fs.writeFileSync(
              path.join(folderPath, `${item.request.id}.json`),
              JSON.stringify(item.request, null, 2)
            )
          }
        }
      }
      saveItems(finalCollDir, children)

      return { success: true, id: finalId, name: collectionName, requestCount: children.length }
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

      const children = buildStaticTree(folderPath)

      if (children.length === 0) {
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
    const childrenList: CollectionItem[] = []
    const files = fs.readdirSync(dirPath, { withFileTypes: true })

    for (const entry of files) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        const subItems = buildStaticTree(fullPath)
        if (subItems.length > 0) {
          childrenList.push({
            id: entry.name,
            name: entry.name,
            type: 'folder',
            children: subItems
          })
        }
      } else if (entry.name.endsWith('.json') || entry.name.endsWith('.postman_collection')) {
        try {
          const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
          const extracted = extractRequests(content)
          childrenList.push(...extracted)
        } catch { /* skip */ }
      }
    }
    return childrenList
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

  ipcMain.handle('storage:saveSettings', async (_event, newSettings: any) => {
    try {
      const settingsPath = getSettingsPath()
      let settings: any = {}
      if (fs.existsSync(settingsPath)) {
        try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) } catch { /* */ }
      }
      // Merge new settings with existing ones
      Object.assign(settings, newSettings)
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ===== Tree Open State Persistence =====

  const getTreeOpenStatePath = () => {
    return path.join(app.getPath('userData'), 'treeOpenState.json')
  }

  ipcMain.handle('tree:getOpenState', async () => {
    try {
      const statePath = getTreeOpenStatePath()
      console.log('[Main/TreeState] Reading state from:', statePath)
      if (!fs.existsSync(statePath)) {
        console.log('[Main/TreeState] File does not exist, returning empty state')
        return {} // Return empty state for first run
      }
      const data = fs.readFileSync(statePath, 'utf-8')
      console.log('[Main/TreeState] Returning parsed state')
      return JSON.parse(data)
    } catch (err) {
      console.error('[Main/TreeState] Failed to read tree open state:', err)
      return {}
    }
  })

  ipcMain.handle('tree:setOpenState', async (_event, openState: Record<string, true>) => {
    try {
      const statePath = getTreeOpenStatePath()
      console.log('[Main/TreeState] Saving state to:', statePath, openState)
      fs.writeFileSync(statePath, JSON.stringify(openState, null, 2))
      return { success: true }
    } catch (err: any) {
      console.error('[Main/TreeState] Failed to save tree open state:', err)
      return { success: false, error: err.message }
    }
  })
}
