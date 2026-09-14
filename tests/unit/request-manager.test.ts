import { describe, it, expect } from 'bun:test'
import {
  registerActiveRequest,
  unregisterActiveRequest,
  cancelActiveRequest,
  isRequestActive
} from '../../electron/lib/request-cancellation'

describe('Request Manager (In-flight cancellation)', () => {
  it('registers an active request and returns an AbortController', () => {
    const reqId = 'test-req-1'
    const controller = registerActiveRequest(reqId)

    expect(controller).toBeDefined()
    expect(controller.signal.aborted).toBe(false)
    expect(isRequestActive(reqId)).toBe(true)

    unregisterActiveRequest(reqId, controller)
    expect(isRequestActive(reqId)).toBe(false)
  })

  it('cancels an active request and triggers abort event', () => {
    const reqId = 'test-req-2'
    const controller = registerActiveRequest(reqId)
    let abortFired = false

    controller.signal.addEventListener('abort', () => {
      abortFired = true
    })

    const cancelled = cancelActiveRequest(reqId)
    expect(cancelled).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(abortFired).toBe(true)
    expect(isRequestActive(reqId)).toBe(false)
  })

  it('returns false when cancelling non-existent request', () => {
    const cancelled = cancelActiveRequest('non-existent-id')
    expect(cancelled).toBe(false)
  })

  it('aborts existing controller if same requestId is registered again', () => {
    const reqId = 'test-req-3'
    const controller1 = registerActiveRequest(reqId)
    let abort1Fired = false
    controller1.signal.addEventListener('abort', () => {
      abort1Fired = true
    })

    const controller2 = registerActiveRequest(reqId)
    expect(abort1Fired).toBe(true)
    expect(controller1.signal.aborted).toBe(true)
    expect(controller2.signal.aborted).toBe(false)
    expect(isRequestActive(reqId)).toBe(true)

    unregisterActiveRequest(reqId, controller2)
    expect(isRequestActive(reqId)).toBe(false)
  })

  it('does not unregister if a mismatched controller is passed', () => {
    const reqId = 'test-req-4'
    const controller1 = registerActiveRequest(reqId)
    const dummyController = new AbortController()

    unregisterActiveRequest(reqId, dummyController)
    expect(isRequestActive(reqId)).toBe(true)

    unregisterActiveRequest(reqId, controller1)
    expect(isRequestActive(reqId)).toBe(false)
  })
})
