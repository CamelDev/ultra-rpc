/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import { shouldMarkDirty, createEmptyRequest } from '../../src/lib/helpers'

describe('shouldMarkDirty — change detection behavior', () => {
  it('does NOT mark dirty when switching activeConfigTab', () => {
    const req = createEmptyRequest('REST')
    expect(shouldMarkDirty(req, { activeConfigTab: 'headers' })).toBe(false)
    expect(shouldMarkDirty(req, { activeConfigTab: 'body' })).toBe(false)
    expect(shouldMarkDirty(req, { activeConfigTab: 'auth' })).toBe(false)
  })

  it('does NOT mark dirty when switching bodyType', () => {
    const req = createEmptyRequest('REST') // starts with bodyType: 'json'
    expect(shouldMarkDirty(req, { bodyType: 'text' })).toBe(false)
    expect(shouldMarkDirty(req, { bodyType: 'none' })).toBe(false)
    expect(shouldMarkDirty(req, { bodyType: 'json' })).toBe(false)
  })

  it('does NOT mark dirty when switching between empty body representations', () => {
    const reqEmpty = createEmptyRequest('REST') // body: ''
    expect(shouldMarkDirty(reqEmpty, { body: '' })).toBe(false)
    expect(shouldMarkDirty(reqEmpty, { body: '{\n  \n}' })).toBe(false)
    expect(shouldMarkDirty(reqEmpty, { body: '{}' })).toBe(false)

    const reqWithScaffolding = { ...createEmptyRequest('REST'), body: '{\n  \n}' }
    expect(shouldMarkDirty(reqWithScaffolding, { body: '' })).toBe(false)
    expect(shouldMarkDirty(reqWithScaffolding, { body: '{}' })).toBe(false)

    const grpcReq = createEmptyRequest('GRPC') // grpcPayload: '{}'
    expect(shouldMarkDirty(grpcReq, { grpcPayload: '' })).toBe(false)
    expect(shouldMarkDirty(grpcReq, { grpcPayload: '{\n  \n}' })).toBe(false)
  })

  it('marks dirty when typing actual text into body', () => {
    const req = createEmptyRequest('REST')
    expect(shouldMarkDirty(req, { body: 'hello' })).toBe(true)
    expect(shouldMarkDirty(req, { body: '{"key": 123}' })).toBe(true)
  })

  it('marks dirty when modifying an existing non-empty body', () => {
    const req = { ...createEmptyRequest('REST'), body: '{"a": 1}' }
    expect(shouldMarkDirty(req, { body: '{"a": 2}' })).toBe(true)
    expect(shouldMarkDirty(req, { body: '' })).toBe(true)
  })

  it('does NOT mark dirty when switching request type on an empty scratch tab', () => {
    const req = createEmptyRequest('REST')
    // isTabEffectivelyEmpty = true
    expect(shouldMarkDirty(req, { type: 'GRPC' }, true)).toBe(false)
    expect(shouldMarkDirty(req, { type: 'GRAPHQL' }, true)).toBe(false)
  })

  it('marks dirty when switching request type on an existing request with content', () => {
    const req = { ...createEmptyRequest('REST'), url: 'https://api.example.com' }
    // isTabEffectivelyEmpty = false
    expect(shouldMarkDirty(req, { type: 'GRPC' }, false)).toBe(true)
  })

  it('marks dirty when modifying URL, method, headers or params', () => {
    const req = createEmptyRequest('REST')
    expect(shouldMarkDirty(req, { url: 'https://example.com' })).toBe(true)
    expect(shouldMarkDirty(req, { method: 'POST' })).toBe(true)
    expect(shouldMarkDirty(req, { headers: [{ id: '1', key: 'Content-Type', value: 'application/json', enabled: true }] })).toBe(true)
  })
})
