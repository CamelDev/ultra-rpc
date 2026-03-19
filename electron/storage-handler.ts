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

const findRequestByIdRecursively = (dir: string, requestId: string): string | null => {
  const filename = `${requestId}.json`
  return findFileRecursively(dir, filename)
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

const updateOrderMeta = (dirPath: string, itemId: string, action: 'add' | 'remove', index?: number) => {
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
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
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
              const validated = validateRequest(content)
              if (validated) childrenList.push({ id: validated.id, name: validated.name, type: 'request', request: validated })
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
        let meta: any = { id: dirName, name: dirName, variables: [] }
        if (fs.existsSync(metaPath)) {
          try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { /* use defaults */ }
        }
        // Backfill path into meta
        if (!meta.path) {
          meta.path = displayPath
          try { fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2)) } catch { /* ignore */ }
        }
        return {
          id: meta.id || dirName,
          name: meta.name || dirName,
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
        const metaPath = path.join(extPath, '_meta.json')
        if (!fs.existsSync(metaPath)) {
          warnings.push(`No collection metadata (_meta.json) found at: ${extPath}`)
          continue
        }
        const coll = loadCollectionFromDir(extPath, extPath)
        if (coll && !seenIds.has(coll.id)) {
          seenIds.add(coll.id)
          collections.push(coll)
        }
      }

      return { success: true, collections, warnings }
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
      const root = getStorageRoot()
      const collDir = path.join(root, args.collectionId)

      if (!fs.existsSync(collDir)) {
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

  // Delete a folder within a collection
  ipcMain.handle('storage:deleteFolder', async (_event, args: { collectionId: string; folderPath: string }) => {
    try {
      const root = getStorageRoot()
      // Note: folderPath is the relative path from the collection root
      const fullPath = path.join(root, args.collectionId, args.folderPath)
      
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true })
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Rename a collection — renames dir to match new name slug, checks for duplicates
  ipcMain.handle('storage:renameCollection', async (_event, args: { collectionId: string; newName: string }) => {
    try {
      const root = getStorageRoot()
      const oldDir = path.join(root, args.collectionId)

      if (!fs.existsSync(oldDir)) {
        return { success: false, error: 'Collection not found' }
      }

      const trimmedName = args.newName.trim()
      if (!trimmedName) {
        return { success: false, error: 'Name cannot be empty' }
      }

      // Compute the new directory slug
      const newSlug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const newDir = path.join(root, newSlug)

      // Check for duplicate: another dir already has this slug
      if (newSlug !== args.collectionId && fs.existsSync(newDir)) {
        return { success: false, error: `A collection named "${trimmedName}" already exists` }
      }

      // Also check for name collision in other collections' meta
      const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory())
      for (const dir of dirs) {
        if (dir.name === args.collectionId) continue
        const otherMeta = path.join(root, dir.name, '_meta.json')
        if (fs.existsSync(otherMeta)) {
          try {
            const m = JSON.parse(fs.readFileSync(otherMeta, 'utf-8'))
            if (m.name && m.name.trim().toLowerCase() === trimmedName.toLowerCase()) {
              return { success: false, error: `A collection named "${trimmedName}" already exists` }
            }
          } catch { /* skip */ }
        }
      }

      // Rename directory if slug changed
      if (newSlug !== args.collectionId) {
        fs.renameSync(oldDir, newDir)
      }

      // Update _meta.json with new id, name, and path
      const metaPath = path.join(newDir, '_meta.json')
      let meta: any = { id: newSlug, name: trimmedName }
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { /* */ }
      }
      meta.id = newSlug
      meta.name = trimmedName
      if (meta.path && !meta.externalPath) {
        meta.path = newDir
      }
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))

      return { success: true, newId: newSlug }
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

  // Move an item (request or folder) to a new location
  ipcMain.handle('storage:moveItem', async (_event, args: { collectionId: string; itemId: string; targetParentId: string | null; newIndex: number }) => {
    try {
      const root = getStorageRoot()
      const collDir = path.join(root, args.collectionId)
      
      if (!fs.existsSync(collDir)) return { success: false, error: 'Collection not found' }

      // 1. Find the item (request or folder)
      let sourcePath = findRequestByIdRecursively(collDir, args.itemId)
      let isRequest = true
      if (!sourcePath) {
        sourcePath = findFolderByIdRecursively(collDir, args.itemId)
        isRequest = false
      }

      if (!sourcePath) return { success: false, error: 'Item not found' }

      // 2. Find the target parent
      let targetParentPath = collDir
      if (args.targetParentId) {
        const foundPath = findFolderByIdRecursively(collDir, args.targetParentId)
        if (!foundPath) return { success: false, error: 'Target parent not found' }
        targetParentPath = foundPath
      }

      // 3. Determine new path
      const itemName = path.basename(sourcePath)
      const newPath = path.join(targetParentPath, itemName)

      const sourceParentPath = path.dirname(sourcePath)

      // 4. Move the file/folder if necessary
      if (sourcePath !== newPath) {
        if (fs.existsSync(newPath)) {
             return { success: false, error: 'An item with that name already exists in target' }
        }
        fs.renameSync(sourcePath, newPath)
      }

      // 5. Update ordering in source parent and target parent
      updateOrderMeta(sourceParentPath, args.itemId, 'remove')
      updateOrderMeta(targetParentPath, args.itemId, 'add', args.newIndex)

      return { success: true }
    } catch (err: any) {
      console.error('Move Item Error:', err)
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
}
