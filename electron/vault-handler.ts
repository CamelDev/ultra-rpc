import { ipcMain, app, safeStorage } from 'electron'
import fs from 'fs'
import path from 'path'

// Redefine VaultEntry locally to avoid importing from renderer types, 
// which improves build stability in the Electron main process.
export interface VaultEntry {
  id: string
  key: string
  value: string
}

export const getVaultDir = () => {
  const dir = path.join(app.getPath('userData'), 'vaults')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export const getVaultPath = (envId: string) =>
  path.join(getVaultDir(), `${envId}.vault`)

export async function getDecryptedVaultEntries(envId: string): Promise<VaultEntry[]> {
  try {
    const isTest = process.env.NODE_ENV === 'test'
    if (process.env.MOCK_VAULT_UNAVAILABLE === 'true') {
      throw new Error('Encryption is not available on this system (MOCK)')
    }
    const filePath = getVaultPath(envId)
    if (!fs.existsSync(filePath)) {
      return []
    }

    const encrypted = fs.readFileSync(filePath)
    
    if (!safeStorage.isEncryptionAvailable()) {
      if (isTest) {
        // Fallback for CI environments where safeStorage might be unavailable
        const decrypted = encrypted.toString('utf-8')
        try {
          return JSON.parse(decrypted)
        } catch {
          // If it's real encrypted data but we are in test mode and can't decrypt, return empty
          return []
        }
      }
      throw new Error('Encryption is not available on this system')
    }

    const decrypted = safeStorage.decryptString(encrypted)
    const entries: VaultEntry[] = JSON.parse(decrypted)
    return entries
  } catch (err: any) {
    console.error('Failed to decrypt vault:', err)
    return []
  }
}

export function registerVaultHandlers() {
  ipcMain.handle('vault:check-availability', () => {
    if (process.env.MOCK_VAULT_UNAVAILABLE === 'true') return false
    if (process.env.NODE_ENV === 'test') return true
    return safeStorage.isEncryptionAvailable()
  })

  ipcMain.handle('vault:get', async (_, { envId }: { envId: string }) => {
    try {
      const entries = await getDecryptedVaultEntries(envId)
      return { success: true, entries }
    } catch (err: any) {
      console.error('Failed to get vault:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('vault:save', async (_, { envId, entries }: { envId: string; entries: VaultEntry[] }) => {
    try {
      if (process.env.MOCK_VAULT_UNAVAILABLE === 'true') {
        throw new Error('Encryption is not available on this system (MOCK)')
      }
      const filePath = getVaultPath(envId)
      
      const json = JSON.stringify(entries)
      
      if (!safeStorage.isEncryptionAvailable()) {
        if (process.env.NODE_ENV === 'test') {
          // Fallback for CI environments
          fs.writeFileSync(filePath, json, 'utf-8')
          return { success: true }
        }
        throw new Error('Encryption is not available on this system')
      }

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
