import { test, expect, _electron as electron } from '@playwright/test'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))

test.describe('Collection export', () => {
  let electronApp: any
  let page: any
  let userDataDir: string

  test.beforeEach(async () => {
    userDataDir = join(tmpdir(), `ultrarpc-test-collection-export-${Date.now()}`)
    mkdirSync(userDataDir, { recursive: true })
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox', '--disable-setuid-sandbox', `--user-data-dir=${userDataDir}`, '--no-lock'],
      env: { ...process.env, NODE_ENV: 'test' },
    })
    page = await electronApp.firstWindow()
    await page.waitForSelector('.app-container', { timeout: 30000 })
  })

  test.afterEach(async () => {
    if (electronApp) await electronApp.close()
    if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true })
  })

  test('exports a collection tree and confirms the saved file', async () => {
    test.setTimeout(60000)
    const collectionId = await page.evaluate(async () => {
      const created = await window.ultraRpc.createCollection({ name: 'Export source' })
      if (!created.success || !created.id) throw new Error(created.error || 'Could not create collection')
      const folder = await window.ultraRpc.createFolder({ collectionId: created.id, folderName: 'Nested folder' })
      if (!folder.success || !folder.id) throw new Error(folder.error || 'Could not create folder')
      const saved = await window.ultraRpc.saveRequest({
        collectionId: created.id,
        request: {
          id: 'nested-request', type: 'REST', name: 'Nested request', method: 'GET',
          url: 'https://example.test/nested', headers: [], params: [], body: '', bodyType: 'none',
        },
      })
      if (!saved.success) throw new Error(saved.error || 'Could not save request')
      const moved = await window.ultraRpc.moveItem({
        collectionId: created.id, itemId: 'nested-request', targetParentId: folder.id, newIndex: 0,
      })
      if (!moved.success) throw new Error(moved.error || 'Could not move request')
      return created.id
    })

    await page.reload()
    await page.waitForSelector('.app-container', { timeout: 30000 })

    const exportPath = join(userDataDir, 'exported-collection.ultrarpc.json')
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath }) as any
    }, exportPath)

    const collectionNode = page.locator('.tree-node').filter({
      has: page.locator('.tree-node-name', { hasText: /^Export source$/ }),
    }).first()
    await expect(collectionNode).toBeVisible()
    await collectionNode.locator('.coll-action-btn').click()
    await page.locator('.coll-context-menu button:has-text("Export")').click()

    await expect(page.locator('.toast__message')).toContainText(`Collection exported to ${exportPath}`)
    expect(existsSync(exportPath)).toBe(true)
    const exported = JSON.parse(readFileSync(exportPath, 'utf-8'))
    expect(exported._ultrarpc_version).toBe('2.0')
    expect(exported.collection.children).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Nested folder',
        type: 'folder',
        children: [expect.objectContaining({ name: 'Nested request', type: 'request' })],
      }),
    ]))

    await collectionNode.click()
    const folderNode = page.locator('.tree-node').filter({
      has: page.locator('.tree-node-name', { hasText: /^Nested folder$/ }),
    }).first()
    await expect(folderNode).toBeVisible()
    const folderExportPath = join(userDataDir, 'exported-folder.ultrarpc.json')
    await electronApp.evaluate(async (params: any, filePath: string) => {
      const { dialog } = params
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath }) as any
    }, folderExportPath)
    await folderNode.locator('.coll-action-btn').click()
    await page.locator('.coll-context-menu button:has-text("Export")').click()
    await expect(page.locator('.toast__message', {
      hasText: `Folder exported to ${folderExportPath}`,
    })).toBeVisible()
    const exportedFolder = JSON.parse(readFileSync(folderExportPath, 'utf-8'))
    expect(exportedFolder.collection.name).toBe('Nested folder')
    expect(exportedFolder.collection.children).toEqual([
      expect.objectContaining({ name: 'Nested request', type: 'request' }),
    ])

    expect(collectionId).toBeTruthy()
  })
})
