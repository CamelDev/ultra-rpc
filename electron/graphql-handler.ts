import { ipcMain } from 'electron'
import { handleRestRequest } from './rest-handler'

// ===== Standard GraphQL Introspection Query =====
const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        kind
        name
        description
        fields(includeDeprecated: true) {
          name
          description
          isDeprecated
          deprecationReason
          args {
            name
            description
            defaultValue
            type {
              ...TypeRef
            }
          }
          type {
            ...TypeRef
          }
        }
        inputFields {
          name
          description
          defaultValue
          type {
            ...TypeRef
          }
        }
        enumValues(includeDeprecated: true) {
          name
          description
          isDeprecated
          deprecationReason
        }
        possibleTypes {
          name
        }
      }
    }
  }

  fragment TypeRef on __Type {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`

// ===== Type References =====
interface GraphqlRequest {
  url: string
  query: string
  variables?: string
  operationName?: string
  headers: Record<string, string>
  insecure?: boolean
  timeoutMs?: number
  abortSignal?: AbortSignal
}

interface IntrospectionRequest {
  url: string
  headers: Record<string, string>
  insecure?: boolean
}

// ===== Helpers =====

function formatTypeRef(typeRef: any): string {
  if (!typeRef) return 'Unknown'
  if (typeRef.kind === 'NON_NULL') {
    return `${formatTypeRef(typeRef.ofType)}!`
  }
  if (typeRef.kind === 'LIST') {
    return `[${formatTypeRef(typeRef.ofType)}]`
  }
  return typeRef.name || 'Unknown'
}

function countGraphqlErrors(body: string): number {
  try {
    const parsed = JSON.parse(body)
    if (Array.isArray(parsed?.errors)) {
      return parsed.errors.length
    }
  } catch {
    // Not JSON or no errors field
  }
  return 0
}

// ===== Handler Functions =====

export async function handleGraphqlRequest(req: GraphqlRequest) {
  // Build the standard GraphQL POST body
  let variables: Record<string, unknown> | undefined
  if (req.variables) {
    try {
      variables = JSON.parse(req.variables)
    } catch {
      return {
        success: false,
        error: 'Invalid JSON in GraphQL variables',
        time: 0,
      }
    }
  }

  const graphqlBody: Record<string, unknown> = { query: req.query }
  if (variables && Object.keys(variables).length > 0) {
    graphqlBody.variables = variables
  }
  if (req.operationName) {
    graphqlBody.operationName = req.operationName
  }

  // Ensure Content-Type header is set
  const headers = { ...req.headers }
  if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json'
  }

  // Delegate to the REST handler — GraphQL is just HTTP POST
  const result = await handleRestRequest({
    method: 'POST',
    url: req.url,
    headers,
    body: JSON.stringify(graphqlBody),
    insecure: req.insecure,
    timeoutMs: req.timeoutMs,
    abortSignal: req.abortSignal,
  })

  // Enhance the response: change type and annotate GraphQL errors in statusText
  if (result.success && result.data) {
    result.data.type = 'GRAPHQL' as any
    const errorCount = countGraphqlErrors(result.data.body)
    if (errorCount > 0) {
      result.data.statusText = `${result.data.status} OK (${errorCount} GraphQL error${errorCount > 1 ? 's' : ''})`
    }
  }

  return result
}

async function handleGraphqlIntrospect(req: IntrospectionRequest) {
  try {
    // Ensure Content-Type header is set
    const headers = { ...req.headers }
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }

    const result = await handleRestRequest({
      method: 'POST',
      url: req.url,
      headers,
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
      insecure: req.insecure,
    })

    if (!result.success) {
      return { success: false, error: result.error || 'Introspection request failed' }
    }

    const parsed = JSON.parse(result.data!.body)

    if (parsed.errors?.length) {
      const messages = parsed.errors.map((e: any) => e.message).join('; ')
      return { success: false, error: `Introspection failed: ${messages}` }
    }

    const rawSchema = parsed.data?.__schema
    if (!rawSchema) {
      return { success: false, error: 'No __schema found in introspection response. The server may have introspection disabled.' }
    }

    // Transform into our schema format
    const schema = {
      queryType: rawSchema.queryType?.name || undefined,
      mutationType: rawSchema.mutationType?.name || undefined,
      subscriptionType: rawSchema.subscriptionType?.name || undefined,
      types: (rawSchema.types || [])
        .filter((t: any) => !t.name.startsWith('__')) // Filter introspection meta-types
        .map((t: any) => ({
          name: t.name,
          kind: t.kind,
          description: t.description || undefined,
          fields: t.fields?.map((f: any) => ({
            name: f.name,
            type: formatTypeRef(f.type),
            description: f.description || undefined,
            isDeprecated: f.isDeprecated || false,
            deprecationReason: f.deprecationReason || undefined,
            args: f.args?.length ? f.args.map((a: any) => ({
              name: a.name,
              type: formatTypeRef(a.type),
              description: a.description || undefined,
              defaultValue: a.defaultValue || undefined,
            })) : undefined,
          })) || undefined,
          inputFields: t.inputFields?.map((f: any) => ({
            name: f.name,
            type: formatTypeRef(f.type),
            description: f.description || undefined,
            defaultValue: f.defaultValue || undefined,
          })) || undefined,
          enumValues: t.enumValues?.map((e: any) => e.name) || undefined,
          possibleTypes: t.possibleTypes?.map((p: any) => p.name) || undefined,
        })),
    }

    return { success: true, schema }
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown introspection error' }
  }
}

// ===== IPC Registration =====

export function registerGraphqlHandlers() {
  ipcMain.handle('graphql:send', async (_event, req: GraphqlRequest) => {
    return handleGraphqlRequest(req)
  })

  ipcMain.handle('graphql:introspect', async (_event, req: IntrospectionRequest) => {
    return handleGraphqlIntrospect(req)
  })
}
