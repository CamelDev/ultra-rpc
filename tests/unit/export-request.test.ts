import { describe, expect, test } from 'bun:test'
import { exportRequest } from '../../src/lib/export-request'
import type { RequestConfig } from '../../src/types'

const request: RequestConfig = { id: '1', name: 'Test', type: 'REST', method: 'POST', url: 'https://example.com', params: [{ id: '1', key: 'q', value: 'a b', enabled: true }], headers: [{ id: '2', key: 'Authorization', value: "it's secret", enabled: true }, { id: '3', key: 'ignored', value: 'x', enabled: false }], body: '{"a":1}', bodyType: 'json' }
const resolve = (value: string) => value

describe('request export', () => {
  test('exports enabled REST fields and safely quotes shell arguments', () => {
    const command = exportRequest(request, resolve, true)
    expect(command).toContain("'https://example.com?q=a+b'")
    expect(command).toContain("'Authorization: it'\\''s secret'")
    expect(command).toContain("--data-raw '{\"a\":1}'")
    expect(command).toContain('-k')
    expect(command).not.toContain('ignored')
  })
  test('exports GraphQL as a JSON POST', () => {
    const command = exportRequest({ ...request, type: 'GRAPHQL', graphqlQuery: 'query { user }', graphqlVariables: '{"id":1}' }, resolve)
    expect(command).toContain('Content-Type: application/json')
    expect(command).toContain('"query": "query { user }"')
    expect(command).toContain('"id": 1')
    expect(() => exportRequest({ ...request, type: 'GRAPHQL', graphqlVariables: '{' }, resolve)).toThrow('Invalid JSON')
  })
  test('exports gRPC transport and method', () => {
    const command = exportRequest({ ...request, type: 'GRPC', url: 'http://localhost:50051', grpcService: 'test.Service', grpcMethod: 'Call', grpcPayload: '{}' }, resolve)
    expect(command).toContain('-plaintext')
    expect(command).toContain("'localhost:50051'")
    expect(command).toContain("'test.Service/Call'")
  })
})
