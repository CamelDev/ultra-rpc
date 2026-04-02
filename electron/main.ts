import { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme } from 'electron'
import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { registerRestHandlers } from './rest-handler'
import { registerGrpcHandlers } from './grpc-handler'
import { registerStorageHandlers } from './storage-handler'
import { registerVaultHandlers } from './vault-handler'
import { registerFormatHandlers } from './format-handler'
import { registerFlowHandlers } from './flow-handler'
import { startMcpServer } from './mcp-server'
import { getSettingsPath } from './storage-handler'

process.on('uncaughtException', (err) => {
  try {
    const logPath = join(app.getPath('userData'), 'crash-report.txt')
    fs.appendFileSync(logPath, `\nUNCAUGHT EXCEPTION:\n${err.stack || err.message || err}\n`)
  } catch (e) { /* ignore */ }
  console.error('UNCAUGHT EXCEPTION:', err)
})

process.on('unhandledRejection', (reason) => {
  try {
    const logPath = join(app.getPath('userData'), 'crash-report.txt')
    fs.appendFileSync(logPath, `\nUNHANDLED REJECTION:\n${reason}\n`)
  } catch (e) { /* ignore */ }
  console.error('UNHANDLED REJECTION:', reason)
})

app.setName('UltraRPC')

if (process.env.USER_DATA_DIR) {
  app.setPath('userData', process.env.USER_DATA_DIR)
}

const template: Electron.MenuItemConstructorOptions[] = [
  {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  },
  {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(process.platform === 'darwin'
        ? [
            { type: 'separator' as const },
            { role: 'front' as const },
            { type: 'separator' as const },
            { role: 'window' as const }
          ]
        : [{ role: 'close' as const }])
    ]
  }
]

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Make require() available for CJS packages loaded externally (e.g. @grpc/grpc-js)
globalThis.require = createRequire(import.meta.url)

process.env.DIST = join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : join(process.env.DIST, '../public')

let win: BrowserWindow | null = null
let readyToClose = false

const skipLock = process.argv.includes('--no-lock')
try {
  const gotTheLock = skipLock ? true : app.requestSingleInstanceLock()

  if (!gotTheLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })

    // Register IPC handlers
    registerRestHandlers()
    registerGrpcHandlers()
    registerStorageHandlers()
    registerVaultHandlers()
    registerFormatHandlers()
    registerFlowHandlers()

    // Theme Management
    ipcMain.handle('theme:set-source', (_, source: 'light' | 'dark' | 'system') => {
      nativeTheme.themeSource = source
      return nativeTheme.shouldUseDarkColors
    })

    ipcMain.handle('theme:get-should-use-dark', () => {
      return nativeTheme.shouldUseDarkColors
    })

    nativeTheme.on('updated', () => {
      if (win) {
        const isDark = nativeTheme.shouldUseDarkColors
        win.webContents.send('theme:updated', isDark)
        
        // Update window appearance (Windows only for title bar overlay)
        if (process.platform === 'win32' && (win as any).setTitleBarOverlay) {
          (win as any).setTitleBarOverlay({
            color: isDark ? '#18181b' : '#f4f4f5',
            symbolColor: isDark ? '#fafafa' : '#09090b',
          })
        }
      }
    })

    // Utils
    ipcMain.handle('app:openExternal', async (_, url: string) => {
      await shell.openExternal(url)
    })

    ipcMain.handle('app:showInFolder', async (_, folderPath: string) => {
      shell.showItemInFolder(folderPath)
    })

    ipcMain.handle('app:confirm-close', () => {
      readyToClose = true
      if (win) saveWindowState(win)
      app.quit()
    })

    ipcMain.handle('app:debug-log', (_, msg: string) => {
      try {
        fs.appendFileSync(join(__dirname, '../../trigger.txt'), `RENDERER: ${msg}\n`)
      } catch {}
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit()
        win = null
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })

    app.whenReady().then(() => {
      console.log('>>> APP READY, CREATING WINDOW...')
      createWindow()

      // Start MCP server after Electron is fully ready (app.getPath works here)
      try {
        const p = getSettingsPath()
        if (fs.existsSync(p)) {
          const s = JSON.parse(fs.readFileSync(p, 'utf-8'))
          if (s.mcpEnabled) {
            startMcpServer(s.mcpPort || 3000).catch(console.error)
          }
        }
      } catch (e) { /* ignore */ }
    }).catch(err => {
      console.error('>>> app.whenReady failed:', err)
    })
  }
} catch (err: any) {
  try {
    const logPath = join(app.getPath('userData'), 'crash-report.txt')
    fs.appendFileSync(logPath, `\nFATAL ERROR DURING SETUP:\n${err.stack || err.message || err}\n`)
  } catch (e) { /* ignore */ }
  console.error('FATAL ERROR DURING SETUP:', err)
  process.exit(1)
}

function getWindowStatePath() {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState() {
  const defaultState = { width: 1280, height: 860, x: undefined, y: undefined }
  try {
    const p = getWindowStatePath()
    if (fs.existsSync(p)) {
      return { ...defaultState, ...JSON.parse(fs.readFileSync(p, 'utf-8')) }
    }
  } catch (err) {
    //
  }
  return defaultState
}

function saveWindowState(window: BrowserWindow) {
  try {
    const bounds = window.getBounds()
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(bounds))
  } catch (err) {
    //
  }
}

function createWindow() {
  console.log('>>> ENTERING createWindow()')
  try {
    const windowState = loadWindowState()
    console.log('>>> WINDOW STATE LOADED:', windowState)

    const isDark = nativeTheme.shouldUseDarkColors

    win = new BrowserWindow({
      width: windowState.width,
      height: windowState.height,
      x: windowState.x,
      y: windowState.y,
      minWidth: 900,
      minHeight: 600,
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
      titleBarStyle: 'hidden',
      icon: join(process.env.VITE_PUBLIC!, process.platform === 'win32' ? 'icon-win.png' : 'icon.png'),
      titleBarOverlay: {
        color: isDark ? '#18181b' : '#f4f4f5',
        symbolColor: isDark ? '#fafafa' : '#09090b',
        height: 40,
      },
      backgroundColor: isDark ? '#09090b' : '#ffffff',
    })

    // Save state on resize and move
    const saveState = () => win && saveWindowState(win)
    win.on('resized', saveState)
    win.on('moved', saveState)
    
    win.on('close', (e) => {
      if (readyToClose || process.env.NODE_ENV === 'test') return
      e.preventDefault()
      win?.webContents.send('app:request-close')
    })

    // Set the macOS Dock icon
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(join(process.env.VITE_PUBLIC!, 'icon.png'))
    }

    if (process.env.VITE_DEV_SERVER_URL) {
      win.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
      console.log('>>> LOADING LOCAL FILE')
      win.loadFile(join(process.env.DIST!, 'index.html'))
    }
  } catch (err: any) {
    console.error('>>> createWindow failed:', err)
    throw err
  }
}
