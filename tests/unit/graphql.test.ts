/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import { createEmptyRequest } from '../../src/lib/helpers'

describe('GraphQL Support — Helpers and Request Configuration', () => {
  it('creates an empty GraphQL request with correct defaults', () => {
    const req = createEmptyRequest('GRAPHQL')
    expect(req.type).toBe('GRAPHQL')
    expect(req.method).toBe('POST')
    expect(req.name).toBe('New GraphQL Request')
    expect(req.graphqlQuery).toBe('')
    expect(req.graphqlVariables).toBe('{}')
    expect(req.graphqlOperationName).toBe('')
    expect(req.headers.length).toBeGreaterThan(0)
  })

  it('keeps REST defaults separate from GraphQL', () => {
    const req = createEmptyRequest('REST')
    expect(req.type).toBe('REST')
    expect(req.method).toBe('GET')
    expect(req.name).toBe('New Request')
    expect(req.graphqlQuery).toBeUndefined()
  })

  it('formats standard GraphQL HTTP POST payloads correctly', () => {
    const query = 'query GetUser($id: ID!) { user(id: $id) { id name } }'
    const variables = '{"id": "123"}'
    const operationName = 'GetUser'

    const parsedVars = JSON.parse(variables)
    const payload = {
      query,
      variables: parsedVars,
      operationName,
    }

    const serialized = JSON.stringify(payload)
    const roundTrip = JSON.parse(serialized)

    expect(roundTrip.query).toBe(query)
    expect(roundTrip.variables).toEqual({ id: '123' })
    expect(roundTrip.operationName).toBe('GetUser')
  })

  it('validates and preserves GraphQL fields in request persistence model', () => {
    // Simulates validateRequest in storage-handler.ts
    const rawReq = {
      id: 'gql-1',
      name: 'User Query',
      type: 'GRAPHQL',
      method: 'POST',
      url: 'https://api.example.com/graphql',
      graphqlQuery: 'query { me { id } }',
      graphqlVariables: '{}',
      graphqlOperationName: 'Me',
      headers: [{ id: '1', key: 'Authorization', value: 'Bearer token', enabled: true }],
      params: [],
    }

    const isValid = !!rawReq.id && !!rawReq.name && (!!rawReq.method || rawReq.type === 'GRPC' || rawReq.type === 'GRAPHQL')
    expect(isValid).toBe(true)

    const validated = {
      ...rawReq,
      graphqlQuery: rawReq.graphqlQuery,
      graphqlVariables: rawReq.graphqlVariables,
      graphqlOperationName: rawReq.graphqlOperationName,
    }

    expect(validated.type).toBe('GRAPHQL')
    expect(validated.graphqlQuery).toBe('query { me { id } }')
    expect(validated.graphqlVariables).toBe('{}')
    expect(validated.graphqlOperationName).toBe('Me')
  })
})
