import { ipcMain, dialog, app, shell, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { getVaultPath, getDecryptedVaultEntries } from './vault-handler'
import { VaultEntry } from '../src/types'
import { parseBrunoCollection } from './bruno-importer'
import { startMcpServer, stopMcpServer } from './mcp-server'

// Default storage root: user's home/.ultrarpc
export const getStorageRoot = () => {
  const root = path.join(app.getPath('userData'), 'collections')
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })
  return root
}

const getHistoryPath = () => {
  const p = path.join(app.getPath('userData'), 'history.json')
  return p
}



export const getEnvPath = () => {
  const p = path.join(app.getPath('userData'), 'environments.json')
  return p
}

export const getSettingsPath = () => {
  const p = path.join(app.getPath('userData'), 'settings.json')
  return p
}

const getFlowsPath = () => {
  const p = path.join(app.getPath('userData'), 'flows.json')
  return p
}

/**
 * NOTE ON VAULT STORAGE:
 * Vaults are stored in app.getPath('userData')/vaults/{envId}.vault
 * They are managed by vault-handler.ts using Electron's safeStorage (Native OS Encryption).
 * For non-sensitive data, use environments.json (managed here).
 * For secrets (API keys, tokens), use the Vault integration.
 */

export const sanitizeFolderName = (text: string): string => {
  return text.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Untitled'
}

const flowNameFromFilename = (filename: string): string => {
  return filename.replace(/\.ultrarpc\.json$/, '').replace(/\.flow\.json$/, '').replace(/\.json$/, '')
}

const filenameFromName = (name: string, defaultName: string = 'Untitled.json'): string => {
  let sanitized = name.replace(/[<>:"/\\|?*]/g, '_').trim() || defaultName
  if (!sanitized.toLowerCase().endsWith('.json')) {
    sanitized += '.json'
  }
  return sanitized
}

const writeQueues = new Map<string, Promise<any>>()

/**
 * Ensures that file read-mutate-write operations for the same path are executed sequentially.
 */
const queuedTask = async <T>(key: string, task: () => Promise<T>): Promise<T> => {
  const previous = writeQueues.get(key) || Promise.resolve()
  const next = (async () => {
    try {
      await previous
    } catch {
      // Ignore previous errors in the chain
    }
    return task()
  })()

  writeQueues.set(key, next)
  next.finally(() => {
    if (writeQueues.get(key) === next) {
      writeQueues.delete(key)
    }
  })
  return next
}


export const getUniqueFilename = (dir: string, baseName: string, extension: string, currentPath?: string, isFlow?: boolean): string => {
  const sanitizedBase = filenameFromName(baseName, isFlow ? 'Untitled Flow.json' : 'Untitled Request.json')
  let filename = sanitizedBase
  let fullPath = path.join(dir, filename)
  
  // If the path is the same as the current file, it's fine
  if (currentPath && path.resolve(fullPath) === path.resolve(currentPath)) {
    return filename
  }

  let counter = 1
  while (fs.existsSync(fullPath)) {
    const extIdx = sanitizedBase.lastIndexOf('.json')
    const base = extIdx !== -1 ? sanitizedBase.slice(0, extIdx) : sanitizedBase
    const ext = extIdx !== -1 ? sanitizedBase.slice(extIdx) : '.json'
    filename = `${base}-${counter}${ext}`
    fullPath = path.join(dir, filename)
    counter++
  }
  return filename
}

const migrateDirectoryToSlugs = (dir: string) => {
  const metaPath = path.join(dir, '_meta.json')
  let meta: any = { idMap: {} }
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* */ }
  }
  if (!meta.idMap) meta.idMap = {}
  
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  let changed = false

  for (const entry of entries) {
    if (entry.name === '_meta.json') continue
    const fullPath = path.join(dir, entry.name)
    
    if (entry.isDirectory()) {
      // We don't recurse here because buildTree handles recursion and will call this for each subDir
      continue 
    } else {
      if (!entry.name.endsWith('.json')) continue

      let isFlow = false
      try {
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
        isFlow = !!(content.steps && content.settings)
      } catch { /* skip corrupt */ }

      const ext = isFlow ? '' : '.json'
      const idFromFilename = path.basename(entry.name, entry.name.endsWith('.flow.json') ? '.flow.json' : '.json')
      
      try {
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
        const id = content.id || idFromFilename
        
        // If it's not in the map, OR if the filename is still the random ID
        if (!meta.idMap[id] || entry.name.startsWith(id)) {
          const newName = content.name || 'Untitled'
          const newFilename = getUniqueFilename(dir, newName, ext, fullPath, isFlow)
          const newPath = path.join(dir, newFilename)
          
          if (fullPath !== newPath) {
            fs.renameSync(fullPath, newPath)
            meta.idMap[id] = newFilename
            changed = true
          } else if (!meta.idMap[id]) {
            meta.idMap[id] = entry.name
            changed = true
          }
        }
      } catch { /* skip */ }
    }
  }

  if (changed) {
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
  }
}

const findFileRecursively = (dir: string, filename: string): string | null => {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
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
  type: 'folder' | 'request' | 'flow'
  request?: SavedRequest
  flow?: any
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

export const findRequestByIdRecursively = (dir: string, requestId: string): string | null => {
  // First, check for _meta.json in this directory to see if it has a mapping
  const metaPath = path.join(dir, '_meta.json')
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      if (meta.idMap && meta.idMap[requestId]) {
        const filePath = path.join(dir, meta.idMap[requestId])
        if (fs.existsSync(filePath)) return filePath
      }
    } catch { /* skip */ }
  }

  // Fallback to manual scan in this directory first
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }

  // 1. Check files in this directory
  for (const entry of entries) {
    if (entry.isDirectory()) continue
    const name = entry.name
    if (name.endsWith('.json')) {
      const fullPath = path.join(dir, name)
      try {
        const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
        if (content.id === requestId) return fullPath
      } catch { /* skip */ }
    }
  }

  // 2. Recurse into subdirectories
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const fullPath = path.join(dir, entry.name)
      const found = findRequestByIdRecursively(fullPath, requestId)
      if (found) return found
    }
  }

  return null
}

const findFolderByIdRecursively = (dir: string, folderId: string): string | null => {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const subDir = path.join(dir, entry.name)
    const metaPath = path.join(subDir, '_meta.json')
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        if (meta.id === folderId) return subDir
      } catch { /* skip */ }
    }
    // Recurse deeper
    const found = findFolderByIdRecursively(subDir, folderId)
    if (found) return found
  }

  return null
}

export const getRequestById = (requestId: string, collectionId?: string): SavedRequest | null => {
  let found: string | null = null

  // If collectionId is provided, try to find it there first for better performance
  if (collectionId) {
    const collDir = getCollectionDir(collectionId)
    if (collDir) {
      found = findRequestByIdRecursively(collDir, requestId)
    }
  }

  // Fallback to global search if not found in specific collection
  if (!found) {
    const root = path.join(app.getPath('userData'), 'collections')
    found = findRequestByIdRecursively(root, requestId)
  }
  if (found) {
    try {
      const content = JSON.parse(fs.readFileSync(found, 'utf-8'))
      return validateRequest(content, requestId)
    } catch { return null }
  }

  // Check external paths
  const settingsPath = path.join(app.getPath('userData'), 'settings.json')
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      const paths: string[] = Array.isArray(settings.collectionPaths) ? settings.collectionPaths : []
      for (const p of paths) {
        if (!fs.existsSync(p)) continue
        const foundExt = findRequestByIdRecursively(p, requestId)
        if (foundExt) {
          const content = JSON.parse(fs.readFileSync(foundExt, 'utf-8'))
          return validateRequest(content, requestId)
        }
      }
    } catch { /* skip */ }
  }
  return null
}

export const updateIdMap = (dirPath: string, id: string, filename: string | null) => {
  const metaPath = path.join(dirPath, '_meta.json')
  let meta: any = { id: path.basename(dirPath), name: path.basename(dirPath), idMap: {} }
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    } catch { /* skip */ }
  }
  if (!meta.idMap) meta.idMap = {}
  
  if (filename) {
    meta.idMap[id] = filename
  } else {
    delete meta.idMap[id]
  }
  
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
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

export const getCollectionDir = (collectionId: string): string | null => {
  const root = getStorageRoot()
  const defaultDir = path.join(root, collectionId)
  if (fs.existsSync(defaultDir)) {
    // Verify it's actually the right collection or it hasn't been overwritten
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(defaultDir, '_meta.json'), 'utf-8'))
      if (meta.id === collectionId) return defaultDir
    } catch {
      return defaultDir // fallback
    }
  }

  // If not found by slug, search all collections in root for matching ID
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const p = path.join(root, entry.name)
      try {
        const m = JSON.parse(fs.readFileSync(path.join(p, '_meta.json'), 'utf-8'))
        if (m.id === collectionId) return p
      } catch { /* skip */ }
    }
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
                .replace(/pm\.collectionVariables\.set\(/g, 'ultra.context.set(')
                .replace(/pm\.collectionVariables\.get\(/g, 'ultra.context.get(')
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
        // Automatically migrate to slugs if needed
        try { migrateDirectoryToSlugs(dirPath) } catch (err) { console.error('[storage] Migration error:', err) }

        const childrenList: CollectionItem[] = []
        const files = fs.readdirSync(dirPath, { withFileTypes: true })

        for (const entry of files) {
          if (entry.name === '_meta.json') continue
          const fullPath = path.join(dirPath, entry.name)

          if (entry.isDirectory()) {
            let folderId = entry.name
            let folderName = entry.name
            const subMetaPath = path.join(fullPath, '_meta.json')
            if (fs.existsSync(subMetaPath)) {
              try {
                const subMeta = JSON.parse(fs.readFileSync(subMetaPath, 'utf-8'))
                if (subMeta.id) folderId = subMeta.id
                // Ignore subMeta.name, always use actual folder name
              } catch { /* */ }
            } else {
              folderId = Math.random().toString(36).substring(2, 11)
              fs.writeFileSync(subMetaPath, JSON.stringify({ id: folderId, name: entry.name }, null, 2))
            }
            childrenList.push({
              id: folderId, name: folderName, type: 'folder', children: buildTree(fullPath)
            })
          } else if (entry.name.endsWith('.json')) {
            try {
              const contentStr = fs.readFileSync(fullPath, 'utf-8')
              const content = JSON.parse(contentStr)
              if (content.steps && content.settings) {
                const flow = content
                const flowId = flow.id || flowNameFromFilename(entry.name)
                flow.name = flowNameFromFilename(entry.name)
                childrenList.push({ id: flowId, name: flow.name, type: 'flow', flow })
              } else {
                const requestId = content.id || path.basename(entry.name, '.json')
                const validated = validateRequest(content, requestId)
                if (validated) {
                  const reqName = flowNameFromFilename(entry.name)
                  validated.name = reqName
                  childrenList.push({ id: validated.id, name: reqName, type: 'request', request: validated })
                }
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
        let name = dirName
        let id = sanitizeFolderName(dirName)

        let meta: any = { variables: [] }
        if (fs.existsSync(metaPath)) {
          try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          } catch { /* use defaults */ }
        }

        // Ignore name in meta, always use actual folder name
        name = dirName
        id = meta.id || sanitizeFolderName(dirName)

        // Clean up or backfill meta
        let changed = false
        if (!meta.id || meta.id !== id) { meta.id = id; changed = true }
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
      const id = sanitizeFolderName(args.name)

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

      const meta = { id, name: args.name, path: collDir }
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
      const derivedId = sanitizeFolderName(folderName)

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

      // 1. Find the current mapping for this ID if it exists
      let existingPath = findRequestByIdRecursively(collDir, args.request.id)
      let targetDir = collDir
      
      if (existingPath) {
        targetDir = path.dirname(existingPath)
      }

      // 2. Generate the slugified filename
      const extension = '.json'
      const newFilename = getUniqueFilename(targetDir, args.request.name || 'Untitled Request', extension, existingPath || undefined)
      const targetPath = path.join(targetDir, newFilename)

      // 3. Rename old file if the name changed
      if (existingPath && existingPath !== targetPath) {
        fs.renameSync(existingPath, targetPath)
      }

      // 4. Save the request
      fs.writeFileSync(
        targetPath,
        JSON.stringify(args.request, null, 2)
      )

      // 5. Update the idMap in the folder's _meta.json
      updateIdMap(targetDir, args.request.id, newFilename)

      return { success: true }
    } catch (err: any) {
      console.error('[storage] saveRequest Error:', err)
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

      const filePath = findRequestByIdRecursively(collDir, args.requestId)

      if (filePath && fs.existsSync(filePath)) {
        const folder = path.dirname(filePath)
        fs.unlinkSync(filePath)
        updateIdMap(folder, args.requestId, null)
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Save a flow to a collection
  ipcMain.handle('storage:saveFlow', async (_event, args: { collectionId: string; flow: any; parentId?: string }) => {
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }

      let targetDir = collDir
      if (args.parentId && args.parentId !== args.collectionId) {
        const found = findFolderByIdRecursively(collDir, args.parentId)
        if (found) targetDir = found
      }

      // Check if file already exists in this collection tree
      let existingPath = findRequestByIdRecursively(collDir, args.flow.id)
      if (existingPath) {
        targetDir = path.dirname(existingPath)
      }

      const extension = ''
      const newFilename = getUniqueFilename(targetDir, args.flow.name || 'Untitled Flow.json', extension, existingPath || undefined, true)
      const targetPath = path.join(targetDir, newFilename)

      if (existingPath && existingPath !== targetPath) {
        fs.renameSync(existingPath, targetPath)
      }

      const flowToSave = { ...args.flow }
      delete flowToSave.name
      fs.writeFileSync(targetPath, JSON.stringify(flowToSave, null, 2))
      updateIdMap(targetDir, args.flow.id, newFilename)

      // If it's outside the internal storage root, register it as a standalone reference
      const root = getStorageRoot()
      if (!path.resolve(targetPath).startsWith(path.resolve(root))) {
        registerFlowPath(targetPath)
      }

      return { success: true, path: targetPath }
    } catch (err: any) {
      console.error('[storage] saveFlow Error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('storage:saveFlowStandalone', async (_event, args: { path: string; flow: any }) => {
    try {
      const { path: filePath, flow } = args
      
      const dir = path.dirname(filePath)
      const extension = ''
      const newFilename = getUniqueFilename(dir, flow.name || 'Untitled Flow.json', extension, filePath, true)
      const targetPath = path.join(dir, newFilename)

      if (filePath !== targetPath) {
        fs.renameSync(filePath, targetPath)
        unregisterFlowPath(filePath)
        registerFlowPath(targetPath)
      }
      
      const flowToSave = { ...flow }
      delete flowToSave.name
      fs.writeFileSync(targetPath, JSON.stringify(flowToSave, null, 2))
      
      // Update ID map if it's inside a collection folder
      updateIdMap(dir, flow.id, newFilename)
      
      return { success: true, path: targetPath }
    } catch (err: any) {
      console.error('[storage] saveFlowStandalone Error:', err)
      return { success: false, error: err.message }
    }
  })

  // Save a flow to an arbitrary path (native folder picker)
  ipcMain.handle('storage:saveFlowToPath', async (_event, args: { folderPath: string; flow: any }) => {
    try {
      const { folderPath, flow } = args
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true })
      }

      // 1. Identify if this folder is an existing collection
      let collectionId: string | null = null
      const root = getStorageRoot()
      
      // Check default storage
      const entries = fs.readdirSync(root, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(root, entry.name, '_meta.json')
          if (fs.existsSync(metaPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
              const extPath = meta.externalPath || meta.path
              if (extPath && (extPath === folderPath || path.resolve(extPath) === path.resolve(folderPath))) {
                collectionId = meta.id || entry.name
                break
              }
            } catch { /* skip */ }
          }
        }
      }

      // 2. If not found, "link" it by adding a meta entry in our storage root
      if (!collectionId) {
        const folderName = path.basename(folderPath)
        const id = sanitizeFolderName(folderName)
        
        let finalId = id
        let counter = 1
        while (fs.existsSync(path.join(root, finalId))) {
          finalId = `${id}-${counter++}`
        }

        const destPath = path.join(root, finalId)
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true })
        }
        
        fs.writeFileSync(
          path.join(destPath, '_meta.json'),
          JSON.stringify({ id: finalId, name: folderName, externalPath: folderPath }, null, 2)
        )
        
        // Also register in settings for persistence
        const settingsPath = getSettingsPath()
        let settings: any = {}
        if (fs.existsSync(settingsPath)) {
          try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) } catch { /* */ }
        }
        const paths: string[] = Array.isArray(settings.collectionPaths) ? settings.collectionPaths : []
        if (!paths.includes(folderPath)) {
          paths.push(folderPath)
          settings.collectionPaths = paths
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
        }

        collectionId = finalId
      }

      // 3. Save the flow file
      const extension = ''
      const newFilename = getUniqueFilename(folderPath, flow.name || 'Untitled Flow.json', extension, undefined, true)
      const savePath = path.join(folderPath, newFilename)
      const flowToSave = { ...flow }
      delete flowToSave.name
      fs.writeFileSync(savePath, JSON.stringify(flowToSave, null, 2))

      // 4. Update ID map in the target folder
      updateIdMap(folderPath, flow.id, newFilename)

      // 5. Register in standalone registry
      registerFlowPath(savePath)

      return { success: true, collectionId, path: savePath }
    } catch (err: any) {
      console.error('Save Flow to Path error:', err)
      return { success: false, error: err.message }
    }
  })

  // List all flows from collections and standalone registry
  ipcMain.handle('storage:listFlows', async () => {
    try {
      const root = getStorageRoot()
      const workflows: { flow: any; collectionId?: string; collectionName?: string; path?: string }[] = []

      // 1. Scan collections
      const collections = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())

      const scanDir = (dir: string, collectionId: string, collectionName: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            scanDir(fullPath, collectionId, collectionName)
          } else if (entry.name.endsWith('.json')) {
            try {
              const flow = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
              if (flow.steps && flow.settings) {
                flow.name = flowNameFromFilename(entry.name)
                workflows.push({ flow, collectionId, collectionName, path: fullPath })
              }
            } catch { /* skip */ }
          }
        }
      }

      for (const col of collections) {
        const colDir = path.join(root, col.name)
        const metaPath = path.join(colDir, '_meta.json')
        let colName = col.name
        let searchDir = colDir
        let collectionId = col.name
        if (fs.existsSync(metaPath)) {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          colName = col.name
          if (meta.id) collectionId = meta.id
          if (meta.externalPath) searchDir = meta.externalPath
        }
        if (fs.existsSync(searchDir)) {
          scanDir(searchDir, collectionId, colName)
        }
      }

      // 2. Scan standalone registry from flows.json
      const flowsPath = getFlowsPath()
      let flowRefs: string[] = []
      if (fs.existsSync(flowsPath)) {
        try { flowRefs = JSON.parse(fs.readFileSync(flowsPath, 'utf-8')); } catch { /* */ }
      }

      for (const fPath of flowRefs) {
        // Avoid duplicates if already scanned in collections
        if (workflows.some(w => w.path === fPath)) continue
        if (fs.existsSync(fPath)) {
          try {
            const flowContent = JSON.parse(fs.readFileSync(fPath, 'utf-8'))
            if (flowContent.steps && flowContent.settings) {
              const flow = flowContent
              flow.name = flowNameFromFilename(path.basename(fPath))
              workflows.push({ flow, path: fPath })
            }
          } catch { /* skip corrupt */ }
        }
      }

      // 3. Apply custom sort order from flows.json
      if (flowRefs.length > 0) {
        workflows.sort((a, b) => {
          const aPath = a.path || ''
          const bPath = b.path || ''
          const aIdx = flowRefs.indexOf(aPath)
          const bIdx = flowRefs.indexOf(bPath)
          
          if (aIdx === -1 && bIdx === -1) return 0
          if (aIdx === -1) return 1
          if (bIdx === -1) return -1
          return aIdx - bIdx
        })
      }

      return { success: true, flows: workflows }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Save the display order for flows
  ipcMain.handle('storage:saveFlowOrder', async (_event, args: { order: string[] }) => {
    try {
      const flowsPath = getFlowsPath()
      fs.writeFileSync(flowsPath, JSON.stringify(args.order, null, 2))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Helper to register flow path
  const registerFlowPath = (filePath: string) => {
    const flowsPath = getFlowsPath()
    let refs: string[] = []
    if (fs.existsSync(flowsPath)) {
      try { refs = JSON.parse(fs.readFileSync(flowsPath, 'utf-8')) } catch { /* */ }
    }
    const resolvedPath = path.resolve(filePath)
    if (!refs.some(p => path.resolve(p) === resolvedPath)) {
      refs.push(filePath)
      fs.writeFileSync(flowsPath, JSON.stringify(refs, null, 2))
    }
  }

  // Helper to remove flow path from registry
  const unregisterFlowPath = (filePath: string) => {
    const flowsPath = getFlowsPath()
    if (!fs.existsSync(flowsPath)) return
    try {
      let refs: string[] = JSON.parse(fs.readFileSync(flowsPath, 'utf-8'))
      const resolvedPath = path.resolve(filePath)
      const filtered = refs.filter(p => path.resolve(p) !== resolvedPath)
      if (filtered.length !== refs.length) {
        fs.writeFileSync(flowsPath, JSON.stringify(filtered, null, 2))
      }
    } catch { /* */ }
  }

  // Rename a flow (physical file name rename)
  ipcMain.handle('storage:renameFlow', async (_event, args: { collectionId?: string; flowId: string; newName: string; path?: string }) => {
    try {
      let oldPath = args.path
      let collDir = args.collectionId ? getCollectionDir(args.collectionId) : null
      if (collDir) {
        oldPath = findRequestByIdRecursively(collDir, args.flowId) || oldPath
      }
      if (!oldPath || !fs.existsSync(oldPath)) return { success: false, error: 'Flow file not found' }

      const dir = path.dirname(oldPath)
      const extension = ''
      const newFilename = getUniqueFilename(dir, args.newName, extension, oldPath, true)
      const newPath = path.join(dir, newFilename)

      if (oldPath !== newPath && fs.existsSync(newPath)) {
        return { success: false, error: 'A flow with that name already exists in this folder' }
      }

      // 1. Rename the file
      if (oldPath !== newPath) {
        fs.renameSync(oldPath, newPath)
        updateIdMap(dir, args.flowId, newFilename)
      }

      // 2. Update standalone registry if it was there
      unregisterFlowPath(oldPath)
      registerFlowPath(newPath)

      // 3. Update ordering (id stays the same, so order entry stays the same)
      updateOrderMeta(dir, args.flowId, 'add')

      return { success: true, newId: args.flowId }
    } catch (err: any) {
      console.error('[storage] renameFlow Error:', err)
      return { success: false, error: err.message }
    }
  })

  // Delete a flow from a collection or registry
  ipcMain.handle('storage:deleteFlow', async (_event, args: { collectionId: string; flowId: string; path?: string }) => {
    try {
      let filePath = args.path
      
      if (!filePath && args.collectionId) {
        const collDir = getCollectionDir(args.collectionId)
        if (collDir) {
          filePath = findRequestByIdRecursively(collDir, args.flowId) || undefined
        }
      }

      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        unregisterFlowPath(filePath)
      }

      // Cleanup order in _meta if it's a collection item
      if (args.collectionId && args.flowId) {
        const collDir = getCollectionDir(args.collectionId)
        if (collDir) {
          const dir = filePath ? path.dirname(filePath) : collDir
          updateOrderMeta(dir, args.flowId, 'remove')
        }
      }

      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Link an existing flow file and register it
  ipcMain.handle('storage:linkFlow', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Existing Flow File',
        properties: ['openFile'],
        filters: [{ name: 'UltraRPC Flow', extensions: ['json'] }]
      })

      if (result.canceled || result.filePaths.length === 0) return { success: false }

      const filePath = result.filePaths[0]
      const flow = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      
      // Basic validation
      if (!flow.steps || !flow.settings) {
        return { success: false, error: 'Selected file is not a valid UltraRPC Flow.' }
      }

      // Register it
      registerFlowPath(filePath)

      return { success: true, flow, path: filePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Delete a collection
  ipcMain.handle('storage:deleteCollection', async (_event, args: { collectionId: string; deleteFiles?: boolean }) => {
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (collDir && fs.existsSync(collDir)) {
        const root = path.resolve(getStorageRoot())
        const resolvedCollDir = path.resolve(collDir)
        const isExternal = path.relative(root, resolvedCollDir).startsWith('..') || path.isAbsolute(path.relative(root, resolvedCollDir))

        if (args.deleteFiles) {
          fs.rmSync(collDir, { recursive: true, force: true })
        } else if (!isExternal) {
          // Internal path but we don't want to delete files -> move to backups
          const backupDir = path.join(app.getPath('userData'), 'backups', 'collections')
          if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
          const targetPath = path.join(backupDir, path.basename(collDir) + '_' + Date.now())
          fs.renameSync(collDir, targetPath)
        }

        // If it was an external path, remove from settings
        if (isExternal) {
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
  ipcMain.handle('storage:deleteFolder', async (_event, args: { collectionId: string; folderId: string }) => {
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }

      const folderPath = findFolderByIdRecursively(collDir, args.folderId)

      if (folderPath && fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true })
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
      const trimmedName = args.newName.trim()
      const newSlug = sanitizeFolderName(trimmedName)
      const newPath = path.join(parentDir, newSlug)

      if (oldPath !== newPath && fs.existsSync(newPath)) {
        return { success: false, error: 'A folder with that name already exists in this location' }
      }

      fs.renameSync(oldPath, newPath)

      // Update _meta.json
      const metaPath = path.join(newPath, '_meta.json')
      let meta: any = { id: args.folderId, name: trimmedName }
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          meta.name = trimmedName
        } catch { /* */ }
      }
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))

      return { success: true, newId: args.folderId }
    } catch (err: any) {
      console.error('[storage] Rename Folder Error:', err)
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

      const newSlug = sanitizeFolderName(trimmedName)
      const parentDir = path.dirname(oldDir)
      const newDir = path.join(parentDir, newSlug)

      if (newSlug !== path.basename(oldDir) && fs.existsSync(newDir)) {
        return { success: false, error: `A folder named "${newSlug}" already exists in that location` }
      }

      fs.renameSync(oldDir, newDir)

      // Update _meta.json
      const metaPath = path.join(newDir, '_meta.json')
      let meta: any = { id: args.collectionId, name: trimmedName }
      if (fs.existsSync(metaPath)) {
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { /* */ }
      }
      // Preserve ID, update name
      meta.name = trimmedName
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

      return { success: true, newId: args.collectionId }
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
      let newSlug = sanitizeFolderName(newName)
      let destDir = path.join(parentDir, newSlug)

      let counter = 1
      while (fs.existsSync(destDir)) {
        newName = `${baseName} Copy ${counter}`
        newSlug = sanitizeFolderName(newName)
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
  ipcMain.handle('storage:saveContextVariables', async (_event, args: { collectionId: string; variables: any[] }) => {
    const collDir = getCollectionDir(args.collectionId)
    if (!collDir) return { success: false, error: 'Collection not found' }
    const metaPath = path.join(collDir, '_meta.json')

    return queuedTask(metaPath, async () => {
      try {
        let meta: any = { id: args.collectionId, variables: [] }
        if (fs.existsSync(metaPath)) {
          try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) } catch { /* */ }
        }
        meta.variables = args.variables
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
        return { success: true }
      } catch (err: any) {
        console.error('[storage] Error saving context variables:', err)
        return { success: false, error: err.message }
      }
    })
  })

  // Move an item (request or folder) to a new location
  ipcMain.handle('storage:moveItem', async (_event, args: { collectionId: string; itemId: string; targetCollectionId?: string; targetParentId: string | null; newIndex: number }) => {
    try {
      const srcCollDir = getCollectionDir(args.collectionId)
      if (!srcCollDir) return { success: false, error: 'Source collection not found' }

      const targetCollectionId = args.targetCollectionId || args.collectionId
      const targetCollDir = getCollectionDir(targetCollectionId)
      if (!targetCollDir) return { success: false, error: 'Target collection not found' }

      // 1. Find the item (request, flow, or folder) in source collection
      let sourcePath = findRequestByIdRecursively(srcCollDir, args.itemId)
      let itemType: 'request' | 'flow' | 'folder' = 'request'
      
      if (sourcePath) {
        try {
          const content = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'))
          if (content.steps && content.settings) itemType = 'flow'
        } catch {}
      }
      
      if (!sourcePath) {
        sourcePath = findFolderByIdRecursively(srcCollDir, args.itemId)
        if (sourcePath) itemType = 'folder'
      }

      if (!sourcePath) return { success: false, error: 'Item not found' }

      // 2. Find the target parent in target collection
      let targetParentPath = targetCollDir
      if (args.targetParentId) {
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
        let ext = ''
        if (itemType === 'request') ext = '.json'
        else if (itemType === 'flow') ext = ''
        
        const base = itemType === 'folder' ? itemName : path.basename(itemName, ext)
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
      }

      // 5. Update ID mappings and ordering
      // Remove from source map
      if (itemType !== 'folder') {
        updateIdMap(sourceParentPath, args.itemId, null)
        updateIdMap(targetParentPath, args.itemId, itemName)
      }
      
      updateOrderMeta(sourceParentPath, args.itemId, 'remove')
      updateOrderMeta(targetParentPath, args.itemId, 'add', args.newIndex)

      return { success: true }
    } catch (err: any) {
      console.error('Move Item Error:', err)
      return { success: false, error: err.message }
    }
  })

  // Clone a request
  ipcMain.handle('storage:cloneRequest', async (_event, args: { collectionId: string; requestId: string }) => {
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }

      const sourcePath = findRequestByIdRecursively(collDir, args.requestId)
      if (!sourcePath) return { success: false, error: 'Request not found' }

      const dir = path.dirname(sourcePath)
      const content = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'))
      const newName = (content.name || 'Untitled') + ' Copy'
      const newId = Math.random().toString(36).substring(2, 11)
      
      const newFilename = getUniqueFilename(dir, newName, '.json')
      const newPath = path.join(dir, newFilename)

      content.id = newId
      content.name = newName
      fs.writeFileSync(newPath, JSON.stringify(content, null, 2))

      updateIdMap(dir, newId, newFilename)
      updateOrderMeta(dir, newId, 'add-after', 0, args.requestId)

      return { success: true, id: newId }
    } catch (err: any) {
      console.error('[storage] Clone Request Error:', err)
      return { success: false, error: err.message }
    }
  })

  // Move a flow file to a new location
  ipcMain.handle('storage:moveFlow', async (_event, args: { flowId: string; currentPath: string; targetFolderPath: string }) => {
    try {
      const { currentPath, targetFolderPath, flowId } = args
      if (!fs.existsSync(currentPath)) return { success: false, error: 'Source flow file not found' }
      if (!fs.existsSync(targetFolderPath)) fs.mkdirSync(targetFolderPath, { recursive: true })

      const filename = path.basename(currentPath)
      let destPath = path.join(targetFolderPath, filename)

      // Handle collision
      if (currentPath !== destPath && fs.existsSync(destPath)) {
        const ext = filename.endsWith('.json') ? '.json' : ''
        const base = path.basename(filename, ext)
        let counter = 1
        while (fs.existsSync(destPath)) {
          destPath = path.join(targetFolderPath, `${base}-${counter}${ext}`)
          counter++
        }
      }

      const sourceDir = path.dirname(currentPath)
      const targetDir = targetFolderPath

      // 1. Physically move the file
      if (currentPath !== destPath) {
        fs.renameSync(currentPath, destPath)
      }

      // 2. Update mappings
      updateIdMap(sourceDir, flowId, null)
      updateIdMap(targetDir, flowId, path.basename(destPath))

      // 3. Update Unified Flow Registry
      unregisterFlowPath(currentPath)
      const root = getStorageRoot()
      if (!destPath.startsWith(root)) {
        registerFlowPath(destPath)
      }

      // 4. Update ordering
      updateOrderMeta(sourceDir, flowId, 'remove')
      updateOrderMeta(targetDir, flowId, 'add')

      return { success: true, newPath: destPath }
    } catch (err: any) {
      console.error('Move Flow Error:', err)
      return { success: false, error: err.message }
    }
  })

  // Move a collection directory to a user-chosen location
  ipcMain.handle('storage:moveCollection', async (_event, args: { collectionId: string, currentPath?: string }) => {
    try {
      const root = getStorageRoot()
      let srcDir = getCollectionDir(args.collectionId)
      
      if (args.currentPath && fs.existsSync(args.currentPath)) {
        srcDir = args.currentPath
      }

      if (!srcDir || !fs.existsSync(srcDir)) {
        return { success: false, error: 'Collection not found' }
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
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }
      
      let resolvedPath = collDir
      const metaPath = path.join(collDir, '_meta.json')
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
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }
      
      let resolvedPath = collDir
      const metaPath = path.join(collDir, '_meta.json')
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
      const collDir = getCollectionDir(args.collectionId)

      if (!collDir || !fs.existsSync(collDir)) {
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
          { name: 'All Supported Collections', extensions: ['json', 'postman_collection', 'yml', 'yaml'] },
          { name: 'Postman Collection', extensions: ['postman_collection', 'json'] },
          { name: 'UltraRPC Collection', extensions: ['json'] },
          { name: 'Bruno (Exported)', extensions: ['yml', 'yaml'] },
          { name: 'JSON Files', extensions: ['json'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      const content = fs.readFileSync(result.filePaths[0], 'utf-8')

      // ── Bruno opencollection format (YAML) ──────────────────────────────────
      if (content.trimStart().startsWith('opencollection:')) {
        const parsed = parseBrunoCollection(content)

        if (parsed.children.length === 0) {
          return { success: false, error: 'No valid requests found in file' }
        }

        const root = getStorageRoot()
        const id = sanitizeFolderName(parsed.name)
        let finalId = id
        let counter = 1
        while (fs.existsSync(path.join(root, finalId))) {
          finalId = `${id}-${counter++}`
        }

        const finalCollDir = path.join(root, finalId)
        fs.mkdirSync(finalCollDir, { recursive: true })

        fs.writeFileSync(
          path.join(finalCollDir, '_meta.json'),
          JSON.stringify({ id: finalId, name: parsed.name, variables: parsed.variables }, null, 2)
        )

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
        saveItems(finalCollDir, parsed.children)

        return {
          success: true,
          id: finalId,
          name: parsed.name,
          requestCount: parsed.children.length,
          environments: parsed.environments,
          vaultEntries: parsed.vaultEntries,
        }
      }

      // ── JSON-based formats (Postman / UltraRPC) ─────────────────────────────
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
      const id = sanitizeFolderName(collectionName)

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
          } else if (item.type === 'flow' && item.flow) {
            const flowName = item.name || item.flow.name || 'Imported Flow'
            const flowToSave = { ...item.flow }
            delete flowToSave.name
            const filename = filenameFromName(flowName, 'Untitled Flow.json')
            fs.writeFileSync(
              path.join(folderPath, filename),
              JSON.stringify(flowToSave, null, 2)
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
    const envPath = getEnvPath()
    return queuedTask(envPath, async () => {
      try {
        fs.writeFileSync(envPath, JSON.stringify(envs, null, 2))
        return { success: true }
      } catch (err: any) {
        console.error('[storage] Error saving environments:', err)
        return { success: false, error: err.message }
      }
    })
  })

  ipcMain.handle('storage:exportEnvironment', async (_event, { envId }: { envId: string }) => {
    try {
      const envPath = getEnvPath()
      if (!fs.existsSync(envPath)) return { success: false, error: 'No environments found' }

      const envs = JSON.parse(fs.readFileSync(envPath, 'utf-8'))
      const env = envs.find((e: any) => e.id === envId)
      if (!env) return { success: false, error: 'Environment not found' }

      // Get vault entries
      const vaultEntries = await getDecryptedVaultEntries(envId)

      // Sanitize vault entries (clear values)
      const sanitizedVault = vaultEntries.map(entry => ({
        ...entry,
        value: ''
      }))

      // Prepare export data
      const exportData = {
        _ultrarpc_environment_export: true,
        version: 1,
        name: env.name,
        variables: env.variables,
        vault: sanitizedVault,
        sslVerification: env.sslVerification,
        protocol: env.protocol
      }

      const result = await dialog.showSaveDialog({
        title: 'Export UltraRPC Environment',
        defaultPath: `${env.name.replace(/[^a-z0-9]/gi, '_')}.json`,
        filters: [
          { name: 'UltraRPC Environment', extensions: ['json'] }
        ]
      })

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Cancelled' }
      }

      fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2))
      return { success: true, path: result.filePath }
    } catch (err: any) {
      console.error('Export Environment Error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('storage:importEnvironment', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Import Environment',
        filters: [
          { name: 'Environment', extensions: ['json'] },
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
      
      // Ensure flowOrder is never kept in settings.json legacy-style
      if (settings.flowOrder) {
        delete settings.flowOrder
      }
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

      // Handle MCP Server lifecycle
      if (settings.mcpEnabled) {
        startMcpServer(settings.mcpPort || 3000).catch(err => console.error('[MCP] Failed to start:', err))
      } else {
        stopMcpServer().catch(err => console.error('[MCP] Failed to stop:', err))
      }

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

  // ===== Libraries Persistence =====

  const getLibrariesPath = () => path.join(app.getPath('userData'), 'libraries.json')

  ipcMain.handle('storage:getLibraries', async () => {
    try {
      const librariesPath = getLibrariesPath()
      if (!fs.existsSync(librariesPath)) return { success: true, libraries: [] }
      const data = JSON.parse(fs.readFileSync(librariesPath, 'utf-8'))
      return { success: true, libraries: data }
    } catch (err: any) {
      return { success: false, libraries: [], error: err.message }
    }
  })

  ipcMain.handle('storage:saveLibraries', async (_event, libraries: any[]) => {
    try {
      const librariesPath = getLibrariesPath()
      fs.writeFileSync(librariesPath, JSON.stringify(libraries, null, 2))
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('storage:pickJsFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select JavaScript Library File',
        filters: [{ name: 'JavaScript', extensions: ['js'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false }
      return { success: true, path: result.filePaths[0] }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('storage:saveNewJsFile', async () => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Create New Library Script',
        defaultPath: 'my-library.js',
        filters: [{ name: 'JavaScript', extensions: ['js'] }],
      })
      if (result.canceled || !result.filePath) return { success: false }
      const template = '// Register functions on ultra.lib to use them in your scripts:\n// ultra.lib.myFunction = (arg) => { return arg }\n'
      fs.writeFileSync(result.filePath, template, 'utf-8')
      return { success: true, path: result.filePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('storage:readFileContents', async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' }
      const content = fs.readFileSync(filePath, 'utf-8')
      return { success: true, content }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('storage:deleteJsFile', async (_event, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        await shell.trashItem(filePath)
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('storage:renameJsFile', async (_event, { oldPath, newName }: { oldPath: string, newName: string }) => {
    try {
      if (!fs.existsSync(oldPath)) return { success: false, error: 'Original file not found' }
      
      const dir = path.dirname(oldPath)
      let finalName = newName.trim()
      if (!finalName.endsWith('.js')) finalName += '.js'
      
      const newPath = path.join(dir, finalName)
      
      if (fs.existsSync(newPath) && newPath.toLowerCase() !== oldPath.toLowerCase()) {
        return { success: false, error: 'A file with this name already exists' }
      }
      
      fs.renameSync(oldPath, newPath)
      return { success: true, newPath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('storage:writeFileContents', async (_event, filePath: string, content: string) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('storage:saveFileAs', async (_event, content: string) => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Save Library Script As',
        defaultPath: 'my-library.js',
        filters: [{ name: 'JavaScript', extensions: ['js'] }],
      })
      if (result.canceled || !result.filePath) return { success: false }
      fs.writeFileSync(result.filePath, content, 'utf-8')
      return { success: true, path: result.filePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Export a flow file to an external location
  ipcMain.handle('storage:exportFlow', async (_event, args: { collectionId: string; flowId: string }) => {
    try {
      const srcDir = getCollectionDir(args.collectionId)
      if (!srcDir) return { success: false, error: 'Collection not found' }
      
      const flowPath = findRequestByIdRecursively(srcDir, args.flowId)
      if (!flowPath || !fs.existsSync(flowPath)) {
        return { success: false, error: 'Flow file not found' }
      }

      const win = BrowserWindow.getFocusedWindow()
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        title: 'Export Flow',
        defaultPath: path.basename(flowPath),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })

      if (canceled || !filePath) return { success: true }

      fs.copyFileSync(flowPath, filePath)
      return { success: true, path: filePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Reveal a flow in the system file manager
  ipcMain.handle('storage:showFlowInFolder', async (_event, args: { collectionId: string; flowId: string }) => {
    try {
      const collDir = getCollectionDir(args.collectionId)
      if (!collDir) return { success: false, error: 'Collection not found' }

      const filePath = findRequestByIdRecursively(collDir, args.flowId)
      if (filePath && fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath)
        return { success: true }
      }
      return { success: false, error: 'Flow file not found' }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
