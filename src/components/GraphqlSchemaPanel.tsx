import React, { useState, useMemo } from 'react'
import { Loader2, AlertCircle, RefreshCw, ArrowRight, Search, ChevronRight, Database } from 'lucide-react'
import type { GraphqlSchema, GraphqlType, GraphqlField } from '../types/graphql'
import './GraphqlSchemaPanel.css'

interface Props {
  url: string
  headers: Record<string, string>
  insecure?: boolean
  onSelectOperation: (query: string, operationName?: string, variables?: string) => void
  interpolate: (text: string) => string
}

function generateQueryForField(field: GraphqlField, types: GraphqlType[], depth = 0, visited = new Set<string>()): string {
  if (depth > 3) return ''

  // Extract the base type name (strip !, [])
  const baseType = field.type.replace(/[[\]!]/g, '').trim()

  // Check if it's an object type that has subfields
  const objectType = types.find(t => t.name === baseType && (t.kind === 'OBJECT' || t.kind === 'INTERFACE' || t.kind === 'UNION'))
  if (!objectType?.fields?.length || visited.has(baseType)) {
    return field.name
  }

  visited.add(baseType)

  // Select first few scalar/simple fields, skip complex nested objects at depth > 1
  const subFields = objectType.fields
    .filter(f => {
      const subBase = f.type.replace(/[[\]!]/g, '').trim()
      const subType = types.find(t => t.name === subBase)
      if (depth >= 2 && subType && (subType.kind === 'OBJECT' || subType.kind === 'INTERFACE')) return false
      return true
    })
    .slice(0, 8)

  if (subFields.length === 0) return field.name

  const indent = '  '.repeat(depth + 1)
  const innerIndent = '  '.repeat(depth + 2)
  const subFieldsStr = subFields
    .map(f => `${innerIndent}${generateQueryForField(f, types, depth + 1, new Set(visited))}`)
    .join('\n')

  return `${field.name} {\n${subFieldsStr}\n${indent}}`
}

function generateOperationQuery(
  opType: 'query' | 'mutation',
  field: GraphqlField,
  types: GraphqlType[]
): string {
  const opName = field.name.charAt(0).toUpperCase() + field.name.slice(1)

  // Build args
  let argDefs = ''
  let argUsage = ''
  if (field.args?.length) {
    const defs = field.args.map(a => `$${a.name}: ${a.type}`)
    const usages = field.args.map(a => `${a.name}: $${a.name}`)
    argDefs = `(${defs.join(', ')})`
    argUsage = `(${usages.join(', ')})`
  }

  // Build field selection
  const bodyPart = generateQueryForField({ ...field, name: `${field.name}${argUsage}` }, types, 0)

  return `${opType} ${opName}${argDefs} {\n  ${bodyPart}\n}`
}

const GraphqlSchemaPanel: React.FC<Props> = ({
  url,
  headers,
  insecure,
  onSelectOperation,
  interpolate,
}) => {
  const [schema, setSchema] = useState<GraphqlSchema | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discovered, setDiscovered] = useState(false)
  const [searchFilter, setSearchFilter] = useState('')
  const [expandedSection, setExpandedSection] = useState<'queries' | 'mutations' | null>('queries')

  const discoverSchema = async () => {
    if (!url.trim()) {
      setError('Enter a GraphQL endpoint URL first')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const resolvedUrl = interpolate(url)
      const resolvedHeaders: Record<string, string> = {}
      Object.entries(headers).forEach(([k, v]) => {
        resolvedHeaders[interpolate(k)] = interpolate(v)
      })

      const result = await window.ultraRpc.graphqlIntrospect({
        url: resolvedUrl,
        headers: resolvedHeaders,
        insecure,
      })

      if (result.success && result.schema) {
        setSchema(result.schema)
        setDiscovered(true)
      } else {
        setError(result.error || 'Introspection failed')
      }
    } catch (err: any) {
      setError(err.message || 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Extract queries and mutations from the schema
  const { queries, mutations } = useMemo(() => {
    if (!schema) return { queries: [], mutations: [] }

    const queryType = schema.types.find(t => t.name === schema.queryType)
    const mutationType = schema.types.find(t => t.name === schema.mutationType)

    const filterFn = (f: GraphqlField) => {
      if (!searchFilter) return true
      return f.name.toLowerCase().includes(searchFilter.toLowerCase())
    }

    return {
      queries: (queryType?.fields || []).filter(filterFn),
      mutations: (mutationType?.fields || []).filter(filterFn),
    }
  }, [schema, searchFilter])

  const handleSelectOperation = (opType: 'query' | 'mutation', field: GraphqlField) => {
    if (!schema) return
    const query = generateOperationQuery(opType, field, schema.types)
    const opName = field.name.charAt(0).toUpperCase() + field.name.slice(1)

    // Generate variables template
    let variables = '{}'
    if (field.args?.length) {
      const varsObj: Record<string, string> = {}
      field.args.forEach(a => {
        varsObj[a.name] = ''
      })
      variables = JSON.stringify(varsObj, null, 2)
    }

    onSelectOperation(query, opName, variables)
  }

  const renderField = (field: GraphqlField, opType: 'query' | 'mutation') => (
    <div key={field.name} className="graphql-operation-item">
      <div className="graphql-operation-header">
        <div className="graphql-operation-info">
          <span className="graphql-operation-name">{field.name}</span>
          <span className="graphql-operation-return-type">{field.type}</span>
        </div>
        <button
          className="graphql-use-btn"
          onClick={() => handleSelectOperation(opType, field)}
          title="Use this operation"
        >
          Use <ArrowRight size={12} />
        </button>
      </div>
      {field.description && (
        <div className="graphql-operation-description">{field.description}</div>
      )}
      {field.args && field.args.length > 0 && (
        <div className="graphql-operation-args">
          {field.args.map(arg => (
            <span key={arg.name} className="graphql-arg-chip">
              <span className="graphql-arg-name">{arg.name}</span>
              <span className="graphql-arg-type">{arg.type}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="graphql-schema-panel">
      {!discovered ? (
        <div className="graphql-discover-section">
          <div className="graphql-discover-info">
            <Database size={20} />
            <div>
              <p className="graphql-discover-title">Schema Introspection</p>
              <p className="graphql-discover-desc">
                Discover available queries and mutations by introspecting the GraphQL server.
              </p>
            </div>
          </div>
          <button
            className="graphql-discover-btn"
            onClick={discoverSchema}
            disabled={loading}
          >
            {loading ? (
              <><Loader2 size={14} className="spin" /> Discovering...</>
            ) : (
              <><Search size={14} /> Discover Schema</>
            )}
          </button>
        </div>
      ) : (
        <>
          <div className="graphql-toolbar">
            <div className="graphql-search-wrapper">
              <Search size={14} />
              <input
                className="graphql-search-input"
                placeholder="Filter operations..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
              />
            </div>
            <button
              className="graphql-refresh-btn"
              onClick={discoverSchema}
              disabled={loading}
              title="Refresh schema"
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>
          </div>

          {/* Queries Section */}
          {queries.length > 0 && (
            <div className="graphql-section">
              <button
                className="graphql-section-header"
                onClick={() => setExpandedSection(expandedSection === 'queries' ? null : 'queries')}
              >
                <ChevronRight
                  size={14}
                  className={`graphql-chevron ${expandedSection === 'queries' ? 'expanded' : ''}`}
                />
                <span className="graphql-section-title">Queries</span>
                <span className="graphql-section-count">{queries.length}</span>
              </button>
              {expandedSection === 'queries' && (
                <div className="graphql-section-content">
                  {queries.map(f => renderField(f, 'query'))}
                </div>
              )}
            </div>
          )}

          {/* Mutations Section */}
          {mutations.length > 0 && (
            <div className="graphql-section">
              <button
                className="graphql-section-header"
                onClick={() => setExpandedSection(expandedSection === 'mutations' ? null : 'mutations')}
              >
                <ChevronRight
                  size={14}
                  className={`graphql-chevron ${expandedSection === 'mutations' ? 'expanded' : ''}`}
                />
                <span className="graphql-section-title">Mutations</span>
                <span className="graphql-section-count">{mutations.length}</span>
              </button>
              {expandedSection === 'mutations' && (
                <div className="graphql-section-content">
                  {mutations.map(f => renderField(f, 'mutation'))}
                </div>
              )}
            </div>
          )}

          {queries.length === 0 && mutations.length === 0 && (
            <div className="graphql-empty">
              {searchFilter ? 'No operations match your filter.' : 'No queries or mutations found in the schema.'}
            </div>
          )}
        </>
      )}

      {error && (
        <div className="graphql-error">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

export default GraphqlSchemaPanel
