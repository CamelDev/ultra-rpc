// ===== GraphQL Schema Types =====
// Used by the introspection panel to represent discovered GraphQL schemas

export interface GraphqlSchema {
  queryType?: string
  mutationType?: string
  subscriptionType?: string
  types: GraphqlType[]
}

export interface GraphqlType {
  name: string
  kind: 'OBJECT' | 'INPUT_OBJECT' | 'ENUM' | 'SCALAR' | 'LIST' | 'NON_NULL' | 'UNION' | 'INTERFACE'
  description?: string
  fields?: GraphqlField[]
  inputFields?: GraphqlField[]
  enumValues?: string[]
  possibleTypes?: string[]   // For UNION and INTERFACE types
}

export interface GraphqlField {
  name: string
  type: string               // Formatted type string, e.g. "String!", "[User]!", "ID!"
  description?: string
  args?: GraphqlArg[]
  isDeprecated?: boolean
  deprecationReason?: string
}

export interface GraphqlArg {
  name: string
  type: string
  description?: string
  defaultValue?: string
}
