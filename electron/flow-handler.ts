import { ipcMain } from 'electron'
import { FlowDefinition } from '../src/types/flow'
import { FlowEngine } from './engine/flow-engine'

const activeEngines: Map<string, FlowEngine> = new Map()

export function registerFlowHandlers() {
  ipcMain.handle('flow:execute', async (event, args: { flow: FlowDefinition, activeEnvId?: string, environments?: any[], collections?: any[], libraries?: any[] }) => {
    const { flow, activeEnvId, environments, collections, libraries } = args
    const webContents = event.sender
    const engine = new FlowEngine(flow, webContents, activeEnvId, environments, collections, libraries)
    activeEngines.set(flow.id, engine)

    try {
      const result = await engine.execute()
      return result
    } finally {
      activeEngines.delete(flow.id)
    }
  })

  ipcMain.handle('flow:stop', async (_event, flowId: string) => {
    const engine = activeEngines.get(flowId)
    if (engine) {
      engine.stop()
      return { success: true }
    }
    return { success: false, error: 'Flow not running' }
  })

  // Cancel only the currently running step's network request, marking it as error
  ipcMain.handle('flow:cancel-step', async (_event, flowId: string) => {
    const engine = activeEngines.get(flowId)
    if (engine) {
      engine.cancelCurrentStep()
      return { success: true }
    }
    return { success: false, error: 'Flow not running' }
  })

  // Execute exactly one step (by stepId) then stop — for manual step-by-step mode
  ipcMain.handle('flow:execute-step', async (event, args: { flow: FlowDefinition, stepId: string, activeEnvId?: string, environments?: any[], collections?: any[], libraries?: any[] }) => {
    const { flow, stepId, activeEnvId, environments, collections, libraries } = args
    const webContents = event.sender

    const targetIndex = flow.steps.findIndex(s => s.id === stepId)
    if (targetIndex === -1) {
      return { success: false, error: `Step ${stepId} not found` }
    }

    // Temporarily clear the target step's status so the engine will actually run it
    const stepsForEngine = flow.steps.map((s) => {
      if (s.id === stepId) {
        return { ...s, status: undefined as any, error: undefined }
      }
      return s
    })
    const modifiedFlow = { ...flow, steps: stepsForEngine }

    const engine = new FlowEngine(modifiedFlow, webContents, activeEnvId, environments, collections, libraries)
    activeEngines.set(flow.id, engine)

    try {
      // Run until inclusive of targetIndex, then stop
      const result = await engine.executeUntil(targetIndex)
      return result
    } finally {
      activeEngines.delete(flow.id)
    }
  })
}
