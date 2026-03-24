import { ipcMain, app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'
import { VaultEntry } from '../src/types'

export const getVaultDir = () => {
  const dir = path.join(app.getPath('userData'), 'vaults')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const getVaultPath = (envId: string) =>
  path.join(getVaultDir(), `${envId}.vault`)

export function registerVaultHandlers() {
  ipcMain.handle('vault:get', async (_, { envId }: { envId: string }) => {
    try {
      const filePath = getVaultPath(envId)
      if (!fs.existsSync(filePath)) {
        return { success: true, entries: [] }
      }

      const encrypted = fs.readFileSync(filePath)
      
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encryption is not available on this system')
      }

      const decrypted = safeStorage.decryptString(encrypted)
      const entries: VaultEntry[] = JSON.parse(decrypted)
      
      return { success: true, entries }
    } catch (err: any) {
      console.error('Failed to get vault:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('vault:save', async (_, { envId, entries }: { envId: string; entries: VaultEntry[] }) => {
    try {
      const filePath = getVaultPath(envId)
      
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encryption is not available on this system')
      }

      const json = JSON.stringify(entries)
      const encrypted = safeStorage.encryptString(json)
      
      fs.writeFileSync(filePath, encrypted)
      
      return { success: true }
    } catch (err: any) {
      console.error('Failed to save vault:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('vault:delete', async (_, { envId }: { envId: string }) => {
    try {
      const filePath = getVaultPath(envId)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      return { success: true }
    } catch (err: any) {
      console.error('Failed to delete vault:', err)
      return { success: false, error: err.message }
    }
  })
}
