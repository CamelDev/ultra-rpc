import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createRequire } from 'module'
import fs from 'fs'
import { registerRestHandlers } from './rest-handler'
import { registerGrpcHandlers } from './grpc-handler'
import { registerStorageHandlers } from './storage-handler'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Make require() available for CJS packages loaded externally (e.g. @grpc/grpc-js)
globalThis.require = createRequire(import.meta.url)

process.env.DIST = join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : join(process.env.DIST, '../public')

let win: BrowserWindow | null

const getWindowStatePath = () => {
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
  const windowState = loadWindowState()

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
    icon: join(process.env.VITE_PUBLIC!, 'icon.png'),
    titleBarOverlay: {
      color: '#18181b',
      symbolColor: '#fafafa',
      height: 40,
    },
    backgroundColor: '#09090b',
  })

  // Save state on resize and move
  const saveState = () => saveWindowState(win!)
  win.on('resized', saveState)
  win.on('moved', saveState)
  win.on('close', saveState)

  // Set the macOS Dock icon
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(join(process.env.VITE_PUBLIC!, 'icon.png'))
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(join(process.env.DIST!, 'index.html'))
  }
}

// Register IPC handlers
registerRestHandlers()
registerGrpcHandlers()
registerStorageHandlers()

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

app.whenReady().then(createWindow)
