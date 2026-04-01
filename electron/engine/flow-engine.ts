import { WebContents, ipcMain } from 'electron'
import * as fs from 'fs'
import { JSONPath } from 'jsonpath-plus'
import { 
  FlowDefinition, 
  FlowStep, 
  StepStatus, 
  StepStatusValue,
  FlowExecutionResult 
} from '../../src/types/flow'
import { handleRestRequest } from '../rest-handler'
import { handleGrpcCall } from '../grpc-handler'
import { getRequestById } from '../storage-handler'
import { getDecryptedVaultEntries } from '../vault-handler'

export class FlowEngine {
  private variables: Record<string, any> = {}
  private isStopped: boolean = false
  private currentStepIndex: number = 0
  private stepStatuses: Record<string, StepStatus> = {}
  private vaultCache: Record<string, any[]> = {}
  private currentAbortController: AbortController | null = null
  private isSingleStepMode: boolean = false

  constructor(
    private definition: FlowDefinition,
    private webContents: WebContents,
    private activeEnvId?: string | null,
    private environments: any[] = [],
    private collections: any[] = [],
    private libraries: any[] = []
  ) {
    for (const step of this.definition.steps) {
      if (step.status) {
        this.stepStatuses[step.id] = {
          stepId: step.id,
          status: step.status,
          error: step.error,
          requestData: step.requestData,
          responseData: step.responseData
        }
      }
    }
    // Also restore variables from previous run if we are resuming
    if (this.definition.variables) {
      this.variables = { ...this.definition.variables }
    }
  }

  public stop() {
    this.isStopped = true
    this.cancelCurrentStep()
  }

  public cancelCurrentStep() {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  public async execute(): Promise<FlowExecutionResult> {
    const startTime = Date.now()
    this.isSingleStepMode = false
    
    try {
      this.currentStepIndex = 0
      // Note: We do NOT reset variables or step statuses if we are resume-executing.
      // This allows the flow to carry forward state.

      while (this.currentStepIndex < this.definition.steps.length) {
        if (this.isStopped) {
          break
        }

          const step = this.definition.steps[this.currentStepIndex]
          const existingStatus = this.stepStatuses[step.id]?.status
          if (!step.enabled || existingStatus === 'success' || existingStatus === 'skipped') {
            if (!step.enabled) this.updateStepStatus(step.id, 'skipped')
            this.currentStepIndex++
            continue
          }

          let attempt = 0
          const maxRetries = this.definition.settings?.onFailure === 'retry' ? (this.definition.settings?.retryCount || 3) : 0
          let stepSuccess = false

          while (attempt <= maxRetries && !stepSuccess && !this.isStopped) {
            if (attempt > 0) {
              console.log(`[FlowEngine] Retrying step ${step.id} (Attempt ${attempt + 1}/${maxRetries + 1})`)
            }
            
            this.updateStepStatus(step.id, 'running')
            this.currentAbortController = new AbortController()
            
            try {
              const nextIndex = await this.executeStep(step)
              this.currentAbortController = null
              
              if (step.type !== 'restart') {
                this.updateStepStatus(step.id, 'success')
              }
              stepSuccess = true
              
              if (nextIndex !== undefined) {
                this.currentStepIndex = nextIndex
              } else {
                this.currentStepIndex++
              }
            } catch (error: any) {
              this.currentAbortController = null
              // If stopped manually via Cancel/Stop, don't retry and don't continue to maxRetries
              if (error.name === 'AbortError' || this.isStopped) {
                this.updateStepStatus(step.id, 'error', 'Cancelled by user')
                throw new Error('Cancelled by user')
              }
              const onFailure = this.definition.settings?.onFailure || 'stop'
              
              if (onFailure === 'retry' && attempt < maxRetries) {
                attempt++
                // Small delay before retry
                await new Promise(resolve => setTimeout(resolve, 1000))
                continue
              }

              if (onFailure === 'stop' || (onFailure === 'retry' && attempt >= maxRetries)) {
                this.updateStepStatus(step.id, 'error', error.message)
                throw error
              } else {
                // 'continue' behavior
                console.log(`[FlowEngine] Step ${step.id} failed, but onFailure is '${onFailure}'. Skipping...`)
                this.updateStepStatus(step.id, 'error', error.message)
                this.currentStepIndex++
                stepSuccess = true // Break step retry loop to move to next step
              }
            }
          }
        }

      return {
        success: !this.isStopped,
        startTime,
        endTime: Date.now(),
        variables: { ...this.variables },
        stepStatuses: this.stepStatuses
      }
    } catch (error: any) {
      return {
        success: false,
        startTime,
        endTime: Date.now(),
        variables: { ...this.variables },
        error: error.message,
        stepStatuses: this.stepStatuses
      }
    }
  }

  /**
   * Same as execute() but stops after the step at `stopAtIndex` completes.
   * Used to run a single step manually.
   */
  public async executeUntil(stopAtIndex: number): Promise<FlowExecutionResult> {
    const startTime = Date.now()
    this.currentStepIndex = 0
    this.isSingleStepMode = true

    try {
      while (this.currentStepIndex <= stopAtIndex) {
        if (this.isStopped) break

        const step = this.definition.steps[this.currentStepIndex]
        if (!step) break

        const existingStatus = this.stepStatuses[step.id]?.status
        if (!step.enabled || existingStatus === 'success' || existingStatus === 'skipped') {
          if (!step.enabled) this.updateStepStatus(step.id, 'skipped')
          this.currentStepIndex++
          continue
        }

        this.updateStepStatus(step.id, 'running')
        this.currentAbortController = new AbortController()

        try {
          const nextIndex = await this.executeStep(step)
          this.currentAbortController = null
          
          if (step.type !== 'restart') {
            this.updateStepStatus(step.id, 'success')
          }

          if (nextIndex !== undefined) {
            // Restart/Jump — stop if jump goes beyond our target
            if (nextIndex > stopAtIndex) break
            this.currentStepIndex = nextIndex
          } else {
            this.currentStepIndex++
          }
        } catch (error: any) {
          this.currentAbortController = null
          const msg = error.name === 'AbortError' ? 'Cancelled by user' : error.message
          this.updateStepStatus(step.id, 'error', msg)
          return {
            success: false,
            startTime,
            endTime: Date.now(),
            variables: this.variables,
            error: msg,
            stepStatuses: this.stepStatuses
          }
        }
      }

      return {
        success: true,
        startTime,
        endTime: Date.now(),
        variables: { ...this.variables },
        stepStatuses: this.stepStatuses
      }
    } catch (error: any) {
      return {
        success: false,
        startTime,
        endTime: Date.now(),
        variables: { ...this.variables },
        error: error.message,
        stepStatuses: this.stepStatuses
      }
    }
  }

  private updateStepStatus(stepId: string, status: StepStatusValue, error?: string, requestData?: any, responseData?: any) {
    const prev = this.stepStatuses[stepId] || {};
    const nextStatus = { 
      ...prev, 
      stepId, 
      status, 
      error, 
      requestData: requestData === undefined ? prev.requestData : requestData,
      responseData: responseData === undefined ? prev.responseData : responseData
    };
    this.stepStatuses[stepId] = nextStatus as any;
    this.webContents.send('flow:step-status', nextStatus);
  }

  private async executeStep(step: FlowStep): Promise<number | undefined> {
    switch (step.type) {
      case 'request':
        return await this.handleRequestStep(step)
      case 'delay':
        return await this.handleDelayStep(step)
      case 'assert':
        return await this.handleAssertStep(step)
      case 'script':
        return await this.handleScriptStep(step)
      case 'restart':
        return await this.handleRestartStep(step)
      default:
        throw new Error(`Unknown step type: ${step.type}`)
    }
  }

  private async handleRestartStep(_step: FlowStep): Promise<number | undefined> {
    this.webContents.send('flow:clear-logs')
    this.emitLog('info', 'Restarting flow: Resetting variables and step statuses...');
    
    // Reset all step statuses to idle and clear results
    for (const step of this.definition.steps) {
      this.updateStepStatus(step.id, 'idle', undefined, null, null)
    }

    // Reset variables to baseline
    this.variables = { ...this.definition.variables }
    
    // Sync UI variables
    this.emitVariableUpdate('clear')
    for (const [k, v] of Object.entries(this.variables)) {
      this.emitVariableUpdate('set', k, v)
    }

    // Jump back to the beginning ONLY in full flow mode
    // If we're executing a single step ("Run this step"), we just return undefined to stop
    if (this.isSingleStepMode) {
      this.emitLog('info', 'Single step execution: Stopped after reset.');
      return undefined
    }
    
    this.emitLog('info', 'Jumping back to step 1...');
    return 0
  }

  private async handleRequestStep(step: FlowStep): Promise<undefined> {
    if (!step.config.requestId) throw new Error('Request ID is missing')
    
    const savedRequest = getRequestById(step.config.requestId, step.config.collectionId)
    if (!savedRequest) throw new Error(`Request NOT found: ${step.config.requestId}`)
    
    console.log(`[FlowEngine] Preparing to execute ${savedRequest.type} request:`, {
      id: savedRequest.id,
      url: savedRequest.url,
      method: savedRequest.method
    })

    let response: any
    const envId = step.config.envId || this.definition.settings?.environmentId || this.activeEnvId
    const variables = await this.getVariables(envId, step.config.collectionId)
    const env = this.environments.find(e => e.id === envId)
    const insecure = env?.sslVerification === false // true if verification is disabled

    console.log(`[FlowEngine] Final variables for ${step.name}:`, variables)

    const globalTimeout = this.definition.settings?.timeoutMs || 30000

    if (savedRequest.preRequestScript) {
      try {
        const mockConsole = { log: (...args: any[]) => console.log('[Flow Pre-Script]', ...args), error: (...args: any[]) => console.error('[Flow Pre-Script Error]', ...args) }
        const sandbox = this.createSandbox(variables, mockConsole)
        const fn = new Function('ultra', 'console', savedRequest.preRequestScript)
        fn(sandbox, mockConsole)
        // Refresh variables mapping in case flow vars were updated
        for (const [k, v] of Object.entries(this.variables)) {
          variables[k] = String(v)
        }
      } catch (err: any) {
        console.error('Pre-request script error in flow:', err)
      }
    }

    if (savedRequest.type === 'GRPC') {
      const grpcReq = {
        host: this.interpolate(savedRequest.url, variables),
        insecure: insecure,
        headers: this.interpolateHeaders(savedRequest.headers, variables),
        service: savedRequest.grpcService || '',
        method: savedRequest.grpcMethod || '',
        payload: this.interpolate(savedRequest.grpcPayload || '{}', variables),
        timeoutMs: savedRequest.timeoutMs || globalTimeout,
        abortSignal: this.currentAbortController?.signal
      }
      this.updateStepStatus(step.id, 'running', undefined, grpcReq)
      console.log('[FlowEngine] Interpolated gRPC Request:', { ...grpcReq, payload: '(omitted)' })
      const result = await handleGrpcCall(grpcReq as any) as any
      if (!result.success) {
        if (this.currentAbortController?.signal.aborted) {
          throw new Error('Request cancelled')
        }
        console.error('[FlowEngine] gRPC call failed:', result.error)
        throw new Error(result.error || 'gRPC call failed')
      }
      response = result.data
      this.updateStepStatus(step.id, 'running', undefined, undefined, response)
    } else {
      const restReq = {
        method: savedRequest.method,
        url: this.interpolate(savedRequest.url, variables),
        headers: this.interpolateHeaders(savedRequest.headers, variables),
        body: this.interpolate(savedRequest.body, variables),
        insecure: insecure,
        timeoutMs: globalTimeout,
        abortSignal: this.currentAbortController?.signal
      }
      this.updateStepStatus(step.id, 'running', undefined, restReq)
      console.log('[FlowEngine] Interpolated REST Request:', { ...restReq, body: '(omitted)' })
      const result = await handleRestRequest(restReq as any) as any
      if (!result.success) {
        if (this.currentAbortController?.signal.aborted) {
          throw new DOMException('Request cancelled', 'AbortError')
        }
        console.error('[FlowEngine] REST request failed:', result.error)
        throw new Error(result.error || 'REST request failed')
      }
      response = result.data
      this.updateStepStatus(step.id, 'running', undefined, undefined, response)
    }
    
    console.log('[FlowEngine] Request successful, response status:', response.status)

    if (savedRequest.postResponseScript) {
      try {
        const mockConsole = { log: (...args: any[]) => console.log('[Flow Post-Script]', ...args), error: (...args: any[]) => console.error('[Flow Post-Script Error]', ...args) }
        let bodyObj = response?.body
        if (typeof bodyObj === 'string') {
          try { bodyObj = JSON.parse(bodyObj) } catch { /* ignore */ }
        }
        const respWithBody = response ? { ...response, body: bodyObj } : undefined
        
        const sandbox = this.createSandbox(variables, mockConsole, respWithBody)
        const fn = new Function('ultra', 'console', savedRequest.postResponseScript)
        fn(sandbox, mockConsole)
      } catch (err: any) {
        console.error('Post-response script error in flow:', err)
      }
    }

    // Extract variables
    if (step.config.bindings) {
      for (const binding of step.config.bindings) {
        try {
          // Check if body is a string or object. If string, try to parse.
          let jsonData = response.body
          if (typeof jsonData === 'string') {
            try { jsonData = JSON.parse(jsonData) } catch { /* not JSON */ }
          }
          
          const value = JSONPath({ path: binding.extractor, json: jsonData })
          // If value is an array of 1, take the first element
          const finalValue = Array.isArray(value) && value.length === 1 ? value[0] : value;
          const stringVal = typeof finalValue === 'object' ? JSON.stringify(finalValue) : String(finalValue);
          
          this.variables[binding.targetVariable] = stringVal;
          this.emitLog('info', `Variable extracted via binding: ${binding.targetVariable} = ${stringVal}`);
        } catch (err: any) {
          console.error(`Failed to extract variable ${binding.targetVariable}:`, err)
        }
      }
    }
    
    return undefined
  }

  private async handleDelayStep(step: FlowStep): Promise<undefined> {
    const ms = step.config.durationMs || 0
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      const signal = this.currentAbortController?.signal
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer)
          return reject(new Error('Delay cancelled'))
        }
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Delay cancelled'))
        })
      }
    })
    return undefined
  }

  private async handleAssertStep(step: FlowStep): Promise<undefined> {
    const { assertions, assertion: legacyAssertion } = step.config
    
    // Handle legacy single assertion if no multi-assertions exist
    if ((!assertions || assertions.length === 0) && legacyAssertion) {
      const envId = step.config.envId || this.definition.settings?.environmentId || this.activeEnvId
      const variables = await this.getVariables(envId, step.config.collectionId)
      const left = this.interpolate(legacyAssertion.left, variables)
      const right = this.interpolate(legacyAssertion.right, variables)
      
      let passed = false
      switch (legacyAssertion.operator) {
        case '==': passed = String(left) == String(right); break
        case '!=': passed = String(left) != String(right); break
        case '>': passed = Number(left) > Number(right); break
        case '<': passed = Number(left) < Number(right); break
        case 'contains': passed = String(left).includes(String(right)); break
      }
      if (!passed) {
        throw new Error(`Assertion failed: ${left} ${legacyAssertion.operator} ${right}`)
      }
      return undefined
    }

    if (!assertions || assertions.length === 0) return undefined

    const envId = step.config.envId || this.activeEnvId
    const variables = await this.getVariables(envId, step.config.collectionId)

    for (const assertion of assertions) {
      if (!assertion.enabled) continue

      const left = await this.resolveOperand(assertion.left, variables)
      const right = assertion.right ? await this.resolveOperand(assertion.right, variables) : undefined

      let passed = false
      const op = assertion.operator
      
      switch (op) {
        case '==': passed = String(left) == String(right); break
        case '!=': passed = String(left) != String(right); break
        case '>': passed = Number(left) > Number(right); break
        case '<': passed = Number(left) < Number(right); break
        case '>=': passed = Number(left) >= Number(right); break
        case '<=': passed = Number(left) <= Number(right); break
        case 'contains': passed = String(left).includes(String(right)); break
        case 'not_contains': passed = !String(left).includes(String(right)); break
        case 'matches': passed = new RegExp(String(right)).test(String(left)); break
        case 'exists': passed = left !== undefined && left !== null; break
        case 'not_exists': passed = left === undefined || left === null; break
        case 'is_null': passed = left === null; break
        case 'is_not_null': passed = left !== null; break
        default: throw new Error(`Unknown operator: ${op}`)
      }

      if (!passed) {
        const leftDesc = assertion.left.type === 'step_response' ? `Step Response(${assertion.left.stepId}:${assertion.left.value})` : String(left)
        const rightDesc = assertion.right ? (assertion.right.type === 'step_response' ? `Step Response(${assertion.right.stepId}:${assertion.right.value})` : String(right)) : ''
        throw new Error(`Assertion failed: ${leftDesc} ${op} ${rightDesc}`)
      }
    }

    return undefined
  }

  private async resolveOperand(operand: any, variables: Record<string, string>): Promise<any> {
    if (operand.type === 'constant') {
      return this.interpolate(operand.value, variables);
    } else if (operand.type === 'variable') {
      // Use internal variables store (which includes previous steps bindings) or environment variables
      return this.variables[operand.value] !== undefined ? this.variables[operand.value] : variables[operand.value];
    } else if (operand.type === 'step_response') {
      if (!operand.stepId) throw new Error('Step ID is required for step_response operand');
      const status = this.stepStatuses[operand.stepId];
      if (!status || !status.responseData) throw new Error(`Response for step ${operand.stepId} not found`);
      
      let jsonData = status.responseData.body;
      if (typeof jsonData === 'string') {
        try { jsonData = JSON.parse(jsonData); } catch { /* ignore */ }
      }
      
      try {
        const value = JSONPath({ path: operand.value, json: jsonData });
        // If value is an array of 1, take the first element (common for JSONPath)
        return Array.isArray(value) && value.length === 1 ? value[0] : value;
      } catch (err: any) {
        throw new Error(`JSONPath error on step ${operand.stepId}: ${err.message}`);
      }
    }
    return '';
  }


  private async handleScriptStep(step: FlowStep): Promise<undefined> {
    const { code } = step.config
    if (!code) return undefined

    const envId = step.config.envId || this.definition.settings?.environmentId || this.activeEnvId
    const variables = await this.getVariables(envId, step.config.collectionId)

    const mockConsole = {
      log: (...args: any[]) => console.log('[Flow Script]', ...args),
      error: (...args: any[]) => console.error('[Flow Script Error]', ...args)
    }
    
    const sandbox = this.createSandbox(variables, mockConsole)
    
    try {
      // Basic execution
      const fn = new Function('ultra', 'console', code)
      fn(sandbox, mockConsole)
    } catch (err: any) {
      throw new Error(`Script error: ${err.message}`)
    }

    return undefined
  }

  private async getVariables(envId?: string | null, collectionId?: string | null): Promise<Record<string, string>> {
    const vars: Record<string, string> = {}
    
    // 1. Start with Collection variables if available
    if (collectionId) {
      const coll = this.collections.find(c => c.id === collectionId)
      if (coll && coll.variables) {
        coll.variables.forEach((v: any) => {
          if (v.enabled !== false && v.key) {
            vars[v.key] = v.value
          }
        })
      }
    }

    // 2. Environment variables (inherited/fallback)
    if (envId) {
      const env = this.environments.find(e => e.id === envId)
      if (env && env.variables) {
        env.variables.forEach((v: any) => {
          if (v.enabled !== false && v.key && vars[v.key] === undefined) {
            vars[v.key] = v.value
          }
        })
      }

      // 3. Vault variables (Highest Priority for secrets - might override collection/env)
      try {
        if (!this.vaultCache[envId]) {
          console.log(`[FlowEngine] Fetching vault for env ${envId}`)
          this.vaultCache[envId] = await getDecryptedVaultEntries(envId)
        }
        
        const vaultEntries = this.vaultCache[envId]
        vaultEntries.forEach(entry => {
          if (entry.key) {
            vars[entry.key] = entry.value
          }
        })
      } catch (err) {
        console.error(`[FlowEngine] Failed to load vault for ${envId}:`, err)
      }
    }

    // 4. Flow variables (Most Local - Overrides everything)
    for (const [k, v] of Object.entries(this.variables)) {
      vars[k] = String(v)
    }

    return vars
  }

  private createSandbox(variables: Record<string, string>, mockConsole: any, responseObj?: any) {
    const sandbox: any = {
      log: (...args: any[]) => {
        mockConsole.log(...args)
        this.emitLog('info', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
      },
      response: responseObj,
      env: {
        get: (key: string) => variables[key],
        set: (key: string, val: string) => {
          throw new Error('Environment variables are read-only during flow execution.')
        },
        all: () => ({ ...variables })
      },
      context: {
        get: (key: string) => this.variables[key] !== undefined ? this.variables[key] : variables[key],
        set: (key: string, val: any) => {
          const stringVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
          this.variables[key] = stringVal;
          this.emitLog('info', `Variable set: ${key} = ${stringVal}`);
          this.emitVariableUpdate('set', key, stringVal);
        },
        delete: (key: string) => {
          delete this.variables[key];
          this.emitLog('info', `Variable deleted: ${key}`);
          this.emitVariableUpdate('delete', key);
        },
        clear: () => {
          this.variables = {};
          this.emitLog('info', `All flow variables cleared`);
          this.emitVariableUpdate('clear');
        },
        all: () => ({ ...this.variables })
      },
      lib: {}
    }

    // Execute library scripts if present
    if (this.libraries && this.libraries.length > 0) {
      for (const lib of this.libraries) {
        if (!lib.enabled) continue
        try {
          if (fs.existsSync(lib.filePath)) {
            const content = fs.readFileSync(lib.filePath, 'utf-8')
            const libFn = new Function('ultra', 'console', content)
            libFn(sandbox, mockConsole)
          }
        } catch (err: any) {
          console.error(`[FlowEngine] Library error (${lib.name}):`, err)
          this.emitLog('error', `Library script error (${lib.name}): ${err.message}`)
        }
      }
    }

    return sandbox
  }

  private emitVariableUpdate(type: 'set' | 'delete' | 'clear', key?: string, value?: any) {
    this.webContents.send('flow:variable-update', {
      flowId: this.definition.id,
      type,
      key,
      value: value === undefined ? undefined : String(value)
    });
  }

  private emitLog(level: 'info' | 'error' | 'warn', message: string) {
    this.webContents.send('flow:log', {
      timestamp: Date.now(),
      level,
      message
    });
  }

  private interpolate(val: string | any, variables: Record<string, string> = {}): any {
    if (typeof val !== 'string') return val
    
    return val.replace(/\{\{(.+?)\}\}/g, (_, key) => {
      const trimmed = key.trim()
      // Use the provided pre-merged variables map
      if (variables[trimmed] !== undefined) return variables[trimmed]
      
      // Fallback to flow-local state if variables map was empty/missing
      if (this.variables[trimmed] !== undefined) return this.variables[trimmed]
      
      return `{{${trimmed}}}`
    })
  }

  private interpolateHeaders(headers: any[] | Record<string, string>, variables: Record<string, string> = {}): Record<string, string> {
    const result: Record<string, string> = {}
    if (Array.isArray(headers)) {
      headers.forEach(h => {
        if (h.enabled !== false && h.key) {
          result[h.key] = this.interpolate(h.value, variables)
        }
      })
    } else {
      for (const [k, v] of Object.entries(headers)) {
        result[k] = this.interpolate(v, variables)
      }
    }
    return result
  }

}
