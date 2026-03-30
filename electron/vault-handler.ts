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
    if (process.env.MOCK_VAULT_UNAVAILABLE === 'true') {
      throw new Error('Encryption is not available on this system (MOCK)')
    }
    const filePath = getVaultPath(envId)
    if (!fs.existsSync(filePath)) {
      return []
    }

    const encrypted = fs.readFileSync(filePath)
    
    if (!safeStorage.isEncryptionAvailable()) {
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
