import { ipcMain } from 'electron'
import {
  registerActiveRequest,
  unregisterActiveRequest,
  cancelActiveRequest,
  isRequestActive
} from './lib/request-cancellation'

export {
  registerActiveRequest,
  unregisterActiveRequest,
  cancelActiveRequest,
  isRequestActive
}

/**
 * Register IPC handlers for request cancellation.
 */
export function registerRequestHandlers() {
  ipcMain.handle('request:cancel', async (_event, requestId: string) => {
    return { success: cancelActiveRequest(requestId) }
  })
}
