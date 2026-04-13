import { ipcMain } from 'electron'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

const logPath = path.join(os.tmpdir(), 'ultrarpc-grpc-backend.log')
const depLogPath = path.join(os.tmpdir(), 'ultrarpc-deps.log')

function logDep(message: string) {
  fs.appendFileSync(depLogPath, `[${new Date().toISOString()}] ${message}\n`)
}

// protobufjs is kept external to avoid bundling issues in ESM.
// We use a lazy initializer to ensure globalThis.require is available (initialized in main.ts).
let protobufInstance: any = null
function getProtobuf() {
  if (protobufInstance) return protobufInstance
  protobufInstance = globalThis.require('protobufjs')
  globalThis.require('protobufjs/ext/descriptor')
  return protobufInstance
}

export interface GrpcRequest {
  host: string
  insecure: boolean
  headers: Record<string, string>
  service: string
  method: string
  payload: string
  protoPath?: string // Optional: use proto file instead of reflection
  timeoutMs?: number // Optional: deadline timeout in milliseconds
  abortSignal?: AbortSignal // Optional: for flow engine cancellation
}

// ===== gRPC Server Reflection v1 =====
// Follows the grpc.reflection.v1alpha.ServerReflection spec

function metadataToObject(metadata: grpc.Metadata): Record<string, string> {
  const obj: Record<string, string> = {}
  if (!metadata) return obj
  
  const json = metadata.toJSON()
  for (const [key, values] of Object.entries(json)) {
    if (Array.isArray(values)) {
      obj[key] = values.map(v => {
        if (typeof v === 'object' && v !== null && 'type' in v && (v as { type: string }).type === 'Buffer' && 'data' in v) {
          return Buffer.from((v as { data: any }).data).toString('base64')
        }
        return String(v)
      }).join(', ')
    } else {
      obj[key] = String(values)
    }
  }
  return obj
}

interface GrpcError extends Error {
  code?: number
  details?: string
  metadata?: grpc.Metadata
}

function formatGrpcError(err: GrpcError): string {
  let msg = `gRPC error (${err.code}): ${err.message || err.details || 'Call failed'}`

  if (err.metadata && typeof err.metadata.get === 'function') {
    const binArr = err.metadata.get('grpc-status-details-bin')
    const bin = binArr && binArr.length > 0 ? binArr[0] : null

    if (bin) {
      try {
        const statusProtoDef = `
          syntax = "proto3";
          package google.rpc;
          message Status {
            int32 code = 1;
            string message = 2;
            repeated Any details = 3;
          }
          message Any {
            string type_url = 1;
            bytes value = 2;
          }
        `
        const protobuf = getProtobuf()
        const root = protobuf.parse(statusProtoDef).root
        const StatusMessage = root.lookupType("google.rpc.Status")
        const decoded = StatusMessage.decode(Buffer.isBuffer(bin) ? bin : Buffer.from(bin))
        const obj = StatusMessage.toObject(decoded)

        if (obj.message && obj.message !== err.message && obj.message !== err.details) {
          msg += `\n\nServer Message: ${obj.message}`
        }

        if (obj.details && Array.isArray(obj.details)) {
          msg += `\n\n--- Error Details ---`
          obj.details.forEach((d: { typeUrl?: string, type_url?: string, value: Buffer | Uint8Array }) => {
            const buf = Buffer.from(d.value)
            // Extract printable characters >= 4 chars to filter out binary noise
            const printables = buf.toString('utf8').match(/[\x20-\x7E]{4,}/g)
            const text = printables ? printables.join(' | ') : '<binary data>'

            const rawType = d.typeUrl || d.type_url
            const typeName = rawType ? rawType.split('/').pop() : 'Unknown'
            msg += `\n[${typeName}]: ${text}`
          })
        }
      } catch {
        msg += `\n(Failed to parse status details)`
      }
    }
  }

  return msg
}

function createReflectionClient(host: string, insecure: boolean) {
  // Load the reflection proto inline
  const reflectionProto = `
syntax = "proto3";

package grpc.reflection.v1alpha;

service ServerReflection {
  rpc ServerReflectionInfo(stream ServerReflectionRequest) returns (stream ServerReflectionResponse);
}

message ServerReflectionRequest {
  string host = 1;
  oneof message_request {
    string file_by_filename = 3;
    string file_containing_symbol = 4;
    string file_containing_extension = 5;
    string all_extension_numbers_of_type = 6;
    string list_services = 7;
  }
}

message ServerReflectionResponse {
  string valid_host = 1;
  ServerReflectionRequest original_request = 2;
  oneof message_response {
    FileDescriptorResponse file_descriptor_response = 4;
    ListServiceResponse list_services_response = 6;
    ErrorResponse error_response = 7;
  }
}

message FileDescriptorResponse {
  repeated bytes file_descriptor_proto = 1;
}

message ListServiceResponse {
  repeated ServiceResponse service = 1;
}

message ServiceResponse {
  string name = 1;
}

message ErrorResponse {
  int32 error_code = 1;
  string error_message = 2;
}
`;

  // Write proto to temp file for loader
  const tmpDir = os.tmpdir()
  const protoPath = path.join(tmpDir, 'ultrarpc_reflection.proto')
  fs.writeFileSync(protoPath, reflectionProto)

  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })

  const grpcProto = grpc.loadPackageDefinition(packageDefinition) as any

  const isSecure = host.startsWith('https://') || host.endsWith(':443') || host.includes(':443/');
  const cleanHost = host.replace(/^https?:\/\//, '').split('/')[0];

  console.log(`[gRPC Backend] createReflectionClient: host=${host}, cleanHost=${cleanHost}, isSecure=${isSecure}, insecure=${insecure}`)

  let credentials: grpc.ChannelCredentials
  if (isSecure && insecure) {
    console.log(`[gRPC Backend] Using SSL with hostname & trust verification bypass (insecure=true)`)
    // HTTPS host with SSL verification disabled: use SSL but skip hostname/cert check
    credentials = grpc.credentials.createSsl(
      null, null, null,
      { 
        checkServerIdentity: () => undefined,
        rejectUnauthorized: false, // Bypass trust verification for self-signed certs
        // @ts-expect-error - passing to underlying tls socket
        'grpc.ssl_target_name_override': cleanHost,
        'grpc.default_authority': cleanHost
      }
    )
  } else if (isSecure) {
    console.log(`[gRPC Backend] Using full SSL verification`)
    // HTTPS host or secure port: full SSL verification
    credentials = grpc.credentials.createSsl()
  } else {
    console.log(`[gRPC Backend] Using insecure credentials (no TLS)`)
    // Plain HTTP host: no TLS at all
    credentials = grpc.credentials.createInsecure()
  }

  return new grpcProto.grpc.reflection.v1alpha.ServerReflection(cleanHost, credentials)
}

// Protobuf field type numbers → default values for sample body generation
// See: https://protobuf.dev/programming-guides/proto3/#scalar
// Helper to recursively index all message and enum types from descriptors
function indexDescriptorTypes(pkg: string, msg: any, messageTypes: Map<string, any>, enumTypes: Map<string, any>) {
  const name = msg.name
  const fullName = pkg ? `${pkg}.${name}` : name
  
  messageTypes.set(fullName, msg)
  messageTypes.set(`.${fullName}`, msg)
  
  if (msg.nestedType) {
    for (const nested of msg.nestedType) {
      indexDescriptorTypes(fullName, nested, messageTypes, enumTypes)
    }
  }
  
  if (msg.enumType) {
    for (const enm of msg.enumType) {
      const enmFullName = `${fullName}.${enm.name}`
      enumTypes.set(enmFullName, enm)
      enumTypes.set(`.${enmFullName}`, enm)
    }
  }
}

// Protobuf field type numbers → default values for sample body generation
// See: https://protobuf.dev/programming-guides/proto3/#scalar
// Protobuf field type numbers → default values for sample body generation
// See: https://protobuf.dev/programming-guides/proto3/#scalar
function generateSampleBody(
  messageTypes: Map<string, any>, 
  enumTypes: Map<string, any>, 
  typeName: string, 
  visited: Set<string>
): Record<string, any> {
  const getMsg = (name: string) => {
    if (!name) return null
    return messageTypes.get(name) || messageTypes.get(`.${name}`) || (name.startsWith('.') ? messageTypes.get(name.slice(1)) : null)
  }
  
  const msg = getMsg(typeName)
  if (!msg || !msg.field) return {}

  // Use a canonical name for visited check to avoid dot-prefix mismatches
  const canonicalName = (typeName.startsWith('.') ? typeName : `.${typeName}`)
  if (visited.has(canonicalName)) return {}
  visited.add(canonicalName)

  const result: Record<string, any> = {}

  for (const field of msg.field) {
    const name = field.jsonName || field.name
    let value: any

    // Check if it's a map entry
    let isMap = false
    if (field.type === 11 && field.label === 3) { // LABEL_REPEATED && TYPE_MESSAGE
      const fieldType = messageTypes.get(field.typeName)
      if (fieldType && fieldType.options && (fieldType.options.mapEntry || fieldType.options.map_entry)) {
        isMap = true
        const keyField = fieldType.field.find((f: any) => f.number === 1)
        const valField = fieldType.field.find((f: any) => f.number === 2)
        
        const sampleKey = keyField && keyField.type === 9 ? 'sample_key' : '1'
        let sampleVal: any
        if (valField.type === 11) {
          sampleVal = generateSampleBody(messageTypes, enumTypes, valField.typeName, visited)
        } else if (valField.type === 14) {
          const enm = enumTypes.get(valField.typeName)
          sampleVal = (enm && enm.value && enm.value.length > 0) ? enm.value[0].name : 0
        } else {
          // Simplified scalar sample for map value
          sampleVal = valField.type === 9 ? 'sample_value' : (valField.type === 8 ? true : 1)
        }
        result[name] = { [sampleKey]: sampleVal }
        continue
      }
    }

    // field.type is a number from FieldDescriptorProto.Type enum
    switch (field.type) {
      case 1: // TYPE_DOUBLE
      case 2: // TYPE_FLOAT
        value = 1.0; break
      case 3: // TYPE_INT64
      case 4: // TYPE_UINT64
      case 18: // TYPE_SINT64
      case 16: // TYPE_SFIXED64
      case 6: // TYPE_FIXED64
        value = '1'; break // Strings for 64-bit in JSON
      case 5: // TYPE_INT32
      case 13: // TYPE_UINT32
      case 15: // TYPE_SFIXED32
      case 7: // TYPE_FIXED32
      case 17: // TYPE_SINT32
        value = 1; break
      case 14: // TYPE_ENUM
        const enm = enumTypes.get(field.typeName)
        if (enm && enm.value && enm.value.length > 0) {
          value = enm.value[0].name
        } else {
          value = 0
        }
        break
      case 8: // TYPE_BOOL
        value = true; break
      case 9: // TYPE_STRING
        value = `${field.name}_sample`; break
      case 12: // TYPE_BYTES
        value = 'YmFzZTY0'; break // "base64" in base64
      case 11: // TYPE_MESSAGE
        value = generateSampleBody(messageTypes, enumTypes, field.typeName, visited); break
      default:
        value = null
    }

    // Repeated fields → wrap in array
    if (field.label === 3) { // LABEL_REPEATED
      result[name] = value !== null ? [value] : []
    } else {
      result[name] = value
    }
  }

  visited.delete(canonicalName)
  return result
}

// Helper to recursively convert JSON objects meant for gRPC maps into arrays of {key, value} entries.
// Necessary because protobuf.js (under reflection) treats maps as repeated entry messages.
function parseMapsToArrays(type: any, payload: any): any {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  if (!type || !type.fields) return payload

  const result = { ...payload }
  const payloadKeys = Object.keys(result)

  for (const [fieldName, field] of Object.entries(type.fields) as [string, any]) {
    // Robust field lookup: try exact name, jsonName, then normalized (snake/camel)
    const normalize = (s: string) => s.toLowerCase().replace(/_/g, '')
    const targetNames = [fieldName]
    if (field.jsonName) targetNames.push(field.jsonName)
    
    const normalizedTargets = targetNames.map(normalize)
    const keyInPayload = payloadKeys.find(pkg => 
      targetNames.includes(pkg) || normalizedTargets.includes(normalize(pkg))
    )

    if (keyInPayload) {
      let val = result[keyInPayload]
      
      if (field.resolvedType) {
        // Handle Protobuf wrapper types (google.protobuf.*Value)
        const isWrapper = field.resolvedType.fullName && 
                          field.resolvedType.fullName.startsWith('.google.protobuf.') && 
                          field.resolvedType.fullName.endsWith('Value')
        
        if (isWrapper && val !== null && typeof val !== 'object') {
          console.log(`[gRPC Backend] Wrapping field "${fieldName}": ${val}`)
          val = { value: val }
          result[keyInPayload] = val
        }

        // Handle Protobuf Timestamp (google.protobuf.Timestamp)
        if (field.resolvedType.fullName === '.google.protobuf.Timestamp' && typeof val === 'string') {
          const date = new Date(val)
          if (!isNaN(date.getTime())) {
            console.log(`[gRPC Backend] Converting string to Timestamp for field "${fieldName}": ${val}`)
            const seconds = Math.floor(date.getTime() / 1000)
            const nanos = (date.getTime() % 1000) * 1e6
            val = { seconds, nanos }
            result[keyInPayload] = val
          }
        }

        // Handle Protobuf Duration (google.protobuf.Duration)
        if (field.resolvedType.fullName === '.google.protobuf.Duration' && typeof val === 'string') {
          // Supporting "3.5s" or just number
          const match = val.match(/^(\d+(\.\d+)?)s?$/)
          if (match) {
            console.log(`[gRPC Backend] Converting string to Duration for field "${fieldName}": ${val}`)
            const totalSeconds = parseFloat(match[1])
            const seconds = Math.floor(totalSeconds)
            const nanos = Math.floor((totalSeconds % 1) * 1e9)
            val = { seconds, nanos }
            result[keyInPayload] = val
          }
        }

        // A field is a map if it's natively a map (field.map) or if it's a repeated map_entry message
        const isMapEntry = field.map || (
          field.repeated && 
          field.resolvedType && 
          field.resolvedType.options && 
          (field.resolvedType.options.mapEntry || field.resolvedType.options.map_entry)
        )

        if (isMapEntry && val && typeof val === 'object' && !Array.isArray(val)) {
          console.log(`[gRPC Backend] Converting map field "${fieldName}" (JSON key: "${keyInPayload}") to array of entries`)
          const arr = []
          for (const [k, v] of Object.entries(val)) {
            const valueField = field.resolvedType.fields['value']
            arr.push({
              key: k,
              value: (valueField && valueField.resolvedType) ? parseMapsToArrays(valueField.resolvedType, v) : v
            })
          }
          result[keyInPayload] = arr
        } else if (field.repeated && Array.isArray(val)) {
          result[keyInPayload] = val.map((item: any) => parseMapsToArrays(field.resolvedType, item))
        } else {
          result[keyInPayload] = parseMapsToArrays(field.resolvedType, val)
        }
      }

      // If we matched via fuzzy lookup but key is different, sync back to fieldName
      if (keyInPayload !== fieldName) {
        result[fieldName] = result[keyInPayload]
        delete result[keyInPayload]
      }
    }
  }

  return result
}

export interface GrpcResponseData {
  type: 'GRPC';
  status: number;
  statusText: string;
  headers: Record<string, string>;
  trailers?: Record<string, string>;
  body: string;
  time: number;
  size: number;
}

export interface GrpcCallResponse {
  success: boolean;
  error?: string;
  data?: GrpcResponseData;
  time?: number;
}

export async function handleGrpcCall(req: GrpcRequest): Promise<GrpcCallResponse> {
  const start = Date.now()
  const protobuf = getProtobuf()
  try {
    const metadata = new grpc.Metadata()
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (key && value) metadata.add(key, value)
    }

    const isSecure = req.host.startsWith('https://') || req.host.endsWith(':443') || req.host.includes(':443/');
    const cleanHost = req.host.replace(/^https?:\/\//, '').split('/')[0];

    if (req.insecure) {
      console.log(`[gRPC Backend] Request has insecure=true`)
    } else {
      console.log(`[gRPC Backend] Request has insecure=false`)
    }
    
    let credentials: grpc.ChannelCredentials
    if (isSecure && req.insecure) {
      console.log(`[gRPC Backend] Using SSL with hostname & trust verification bypass (insecure=true)`)
      // HTTPS host with SSL verification disabled: use SSL but skip hostname/cert check
      credentials = grpc.credentials.createSsl(
        null, null, null,
          { 
            checkServerIdentity: () => undefined,
            rejectUnauthorized: false, // Bypass trust verification for self-signed certs
            // @ts-expect-error - passing to underlying tls socket
            'grpc.ssl_target_name_override': cleanHost,
            'grpc.default_authority': cleanHost
          }
      )
    } else if (isSecure) {
      // HTTPS host or secure port: full SSL verification
      credentials = grpc.credentials.createSsl()
    } else {
      // Plain HTTP host: no TLS at all
      credentials = grpc.credentials.createInsecure()
    }

    const callOptions: grpc.CallOptions = {}
    const timeout = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : 60000
    callOptions.deadline = Date.now() + timeout

    let payload: any
    try {
      payload = JSON.parse(req.payload)
    } catch {
      return { success: false, error: 'Invalid JSON payload' }
    }

    // If proto path provided, use it directly
    if (req.protoPath) {
      const packageDefinition = protoLoader.loadSync(req.protoPath, {
        keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
      })
      const proto = grpc.loadPackageDefinition(packageDefinition)
      const serviceParts = req.service.split('.')
      let serviceConstructor: any = proto
      for (const part of serviceParts) {
        serviceConstructor = serviceConstructor[part]
      }
      if (!serviceConstructor) {
        return { success: false, error: `Service "${req.service}" not found in proto` }
      }
      const client = new serviceConstructor(cleanHost, credentials)
      return new Promise<GrpcCallResponse>((resolve) => {
        const methodFn = client[req.method]
        if (!methodFn) {
          resolve({ success: false, error: `Method "${req.method}" not found on service` })
          return
        }

        let responseHeaders = {}
        let responseTrailers = {}

        if (methodFn.responseStream) {
          const call = methodFn.call(client, payload, metadata, callOptions)
          call.on('metadata', (m: grpc.Metadata) => {
            responseHeaders = metadataToObject(m)
          })
          const responses: any[] = []
          
          let timeoutTimer: any
          const cleanup = () => {
            if (timeoutTimer) clearTimeout(timeoutTimer)
            client.close()
          }

          timeoutTimer = setTimeout(() => {
            resolve({ success: false, error: 'gRPC stream timeout (30s)' })
            cleanup()
          }, 30000)

          call.on('data', (response: any) => {
            responses.push(response)
          })
          call.on('error', (err: GrpcError) => {
            cleanup()
            const time = Date.now() - start
            const errorMsg = formatGrpcError(err)
            resolve({ 
              success: true, 
              data: { 
                type: 'GRPC',
                status: err.code || 2, 
                statusText: err.details || 'Stream Error', 
                headers: responseHeaders, 
                trailers: responseTrailers || metadataToObject(err.metadata || new grpc.Metadata()),
                body: errorMsg,
                time, 
                size: Buffer.byteLength(errorMsg, 'utf-8') 
              } 
            })
          })
          call.on('status', (status: grpc.StatusObject) => {
            responseTrailers = metadataToObject(status.metadata)
          })
          call.on('end', () => {
            cleanup()
            const time = Date.now() - start
            try {
              const body = JSON.stringify(responses, null, 2)
              resolve({ 
                success: true, 
                data: { 
                  type: 'GRPC',
                  status: 0, 
                  statusText: 'OK', 
                  headers: responseHeaders, 
                  trailers: responseTrailers,
                  body, 
                  time, 
                  size: Buffer.byteLength(body, 'utf-8') 
                } 
              })
            } catch (err: any) {
              resolve({ success: false, error: `Failed to serialize streaming responses: ${err.message}` })
            }
          })
        } else {
          const call = methodFn.call(client, payload, metadata, callOptions, (err: GrpcError | null, responseBody: unknown) => {
            const time = Date.now() - start
            if (err) {
              const errorMsg = formatGrpcError(err)
              resolve({ 
                success: true, 
                data: { 
                  type: 'GRPC',
                  status: err.code || 2, 
                  statusText: err.details || 'Error',
                  headers: responseHeaders, 
                  trailers: responseTrailers,
                  body: errorMsg,
                  time, 
                  size: Buffer.byteLength(errorMsg, 'utf-8') 
                } 
              })
            } else {
              const body = JSON.stringify(responseBody, null, 2)
              resolve({ 
                success: true, 
                data: { 
                  type: 'GRPC',
                  status: 0, 
                  statusText: 'OK', 
                  headers: responseHeaders, 
                  trailers: responseTrailers,
                  body, 
                  time, 
                  size: Buffer.byteLength(body, 'utf-8') 
                } 
              })
              client.close()
            }
          })
          call.on('metadata', (m: grpc.Metadata) => {
            responseHeaders = metadataToObject(m)
          })
          call.on('status', (s: grpc.StatusObject) => {
            responseTrailers = metadataToObject(s.metadata)
          })
          // Wire up abort signal
          if (req.abortSignal) {
            const abortHandler = () => { try { call.cancel() } catch {} }
            req.abortSignal.addEventListener('abort', abortHandler)
          }
        }
      })
    }

    // Server reflection call
    const reflectionClient = createReflectionClient(req.host, req.insecure)
    return new Promise<GrpcCallResponse>((resolve) => {
      const call = reflectionClient.ServerReflectionInfo(metadata)
      const descriptorBuffers: Buffer[] = []
      let resolved = false

      call.on('data', (response: any) => {
        if (response.file_descriptor_response) {
          for (const fd of response.file_descriptor_response.file_descriptor_proto) {
             descriptorBuffers.push(Buffer.isBuffer(fd) ? fd : Buffer.from(fd))
          }
        }
        if (response.error_response) {
          resolved = true; reflectionClient.close();
          resolve({ success: false, error: response.error_response.error_message })
        }
      })

      call.on('error', (err: GrpcError) => {
        if (resolved) return
        resolved = true; reflectionClient.close()
        resolve({ success: false, error: err.message || 'Reflection failed' })
      })

      call.on('end', async () => {
        if (resolved) return
        resolved = true; reflectionClient.close()

        if (descriptorBuffers.length === 0) {
          return resolve({ success: false, error: `No file descriptor found for service "${req.service}"` })
        }

        try {
          // Parse raw descriptors to find input/output types for the method
          let inputTypeName: string | null = null
          let outputTypeName: string | null = null
          let isServerStreaming = false
          const targetShortName = req.service.split('.').pop()

          for (const buf of descriptorBuffers) {
            const decoded = protobuf.descriptor.FileDescriptorProto.decode(buf)
            const pkg = decoded.package || ''
            if (decoded.service) {
              for (const svc of decoded.service) {
                const svcFullName = pkg ? `${pkg}.${svc.name}` : svc.name
                if (svcFullName === req.service || svc.name === targetShortName) {
                  if (svc.method) {
                    for (const m of svc.method) {
                      if (m.name === req.method) {
                        inputTypeName = m.inputType?.startsWith('.') ? m.inputType.slice(1) : m.inputType
                        outputTypeName = m.outputType?.startsWith('.') ? m.outputType.slice(1) : m.outputType
                        isServerStreaming = m.serverStreaming || false
                      }
                    }
                  }
                }
              }
            }
          }

          if (!inputTypeName || !outputTypeName) {
            return resolve({ success: false, error: `Method "${req.method}" not found on service "${req.service}"` })
          }

          // Build a Root for message types using FileDescriptorSet
          const decodedDescriptors = descriptorBuffers.map(buf =>
            protobuf.descriptor.FileDescriptorProto.decode(buf)
          )
          const descriptorSet = protobuf.descriptor.FileDescriptorSet.create({
            file: decodedDescriptors,
          })
          const root = protobuf.Root.fromDescriptor(descriptorSet)
          root.resolveAll()

          const requestType = root.lookupType(inputTypeName)
          const responseType = root.lookupType(outputTypeName)

          const fullMethodPath = `/${req.service}/${req.method}`
          const genericClient = new grpc.Client(cleanHost, credentials)

          let responseHeaders = {}
          let responseTrailers = {}

          if (isServerStreaming) {
            const call = genericClient.makeServerStreamRequest(
              fullMethodPath,
              (msg: any) => {
                const fixedPayload = parseMapsToArrays(requestType, msg)
                return Buffer.from(requestType.encode(requestType.fromObject(fixedPayload)).finish())
              },
              (buf: Buffer) => responseType.decode(buf),
              payload,
              metadata,
              callOptions
            )

            call.on('metadata', (m: grpc.Metadata) => {
              responseHeaders = metadataToObject(m)
            })

            const responses: any[] = []
            call.on('data', (response: any) => {
              const responseObj = responseType.toObject(response, { longs: String, enums: String, defaults: true, keepCase: true, bytes: String })
              responses.push(responseObj)
            })

            call.on('error', (err: any) => {
              const time = Date.now() - start
              genericClient.close()
              const errorMsg = formatGrpcError(err)
              resolve({
                success: true,
                data: { 
                  type: 'GRPC',
                  status: err.code, 
                  statusText: err.details || 'Stream Error', 
                  headers: responseHeaders, 
                  trailers: responseTrailers || metadataToObject(err.metadata),
                  body: errorMsg,
                  time, 
                  size: Buffer.byteLength(errorMsg, 'utf-8') 
                },
              })
            })

            call.on('status', (status: grpc.StatusObject) => {
              responseTrailers = metadataToObject(status.metadata)
            })

            call.on('end', () => {
              const time = Date.now() - start
              genericClient.close()
              const body = JSON.stringify(responses, null, 2)
              resolve({
                success: true,
                data: { 
                  type: 'GRPC',
                  status: 0, 
                  statusText: 'OK (Stream Finished)', 
                  headers: responseHeaders, 
                  trailers: responseTrailers,
                  body, 
                  time, 
                  size: Buffer.byteLength(body, 'utf-8') 
                },
              })
            })
          } else {
            const call = genericClient.makeUnaryRequest(
              fullMethodPath,
              (msg: any) => {
                const fixedPayload = parseMapsToArrays(requestType, msg)
                return Buffer.from(requestType.encode(requestType.fromObject(fixedPayload)).finish())
              },
              (buf: Buffer) => responseType.decode(buf),
              payload,
              metadata,
              callOptions,
              (err: any, responseBody: any) => {
                const time = Date.now() - start
                genericClient.close()
                if (err) {
                  const errorMsg = formatGrpcError(err)
                  resolve({
                    success: true,
                    data: { 
                      type: 'GRPC',
                      status: err.code, 
                      statusText: err.details || 'Error', 
                      headers: responseHeaders, 
                      trailers: responseTrailers,
                      body: errorMsg,
                      time, 
                      size: Buffer.byteLength(errorMsg, 'utf-8') 
                    },
                  })
                } else {
                  const responseObj = responseType.toObject(responseBody, { longs: String, enums: String, defaults: true, keepCase: true, bytes: String })
                  const body = JSON.stringify(responseObj, null, 2)
                  resolve({
                    success: true,
                    data: { 
                      type: 'GRPC',
                      status: 0, 
                      statusText: 'OK', 
                      headers: responseHeaders, 
                      trailers: responseTrailers,
                      body, 
                      time, 
                      size: Buffer.byteLength(body, 'utf-8') 
                    },
                  })
                }
              }
            )

            call.on('metadata', (m: grpc.Metadata) => {
              responseHeaders = metadataToObject(m)
            })
            call.on('status', (status: grpc.StatusObject) => {
              responseTrailers = metadataToObject(status.metadata)
            })
            // Wire up abort signal
            if (req.abortSignal) {
              const abortHandler = () => { try { call.cancel() } catch {} }
              req.abortSignal.addEventListener('abort', abortHandler)
            }
          }
        } catch (err: any) {
          resolve({ success: false, error: err.message || 'Call failed' })
        }
      })

      call.write({ file_containing_symbol: req.service })
      call.end()
    })
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Unknown error',
      time: Date.now() - start,
    }
  }
}

// ─── Reflection helper: one request → one Promise<Buffer[]> ──────────────────────────
// Sends a single ServerReflection request and returns all FileDescriptorProto buffers
// the server includes in the response. Errors resolve to empty array (logged).
function reflectionSingleRequest(
  client: any,
  metadata: grpc.Metadata,
  request: Record<string, any>,
  timeoutMs: number
): Promise<Buffer[]> {
  return new Promise<Buffer[]>((resolve) => {
    const buffers: Buffer[] = []
    let settled = false
    const settle = (bufs: Buffer[]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      logDep(`[ReflReq] settle → ${bufs.length} buffers | req=${JSON.stringify(request)}`)
      resolve(bufs)
    }

    const timer = setTimeout(() => {
      logDep(`[ReflReq] TIMEOUT ${timeoutMs}ms | req=${JSON.stringify(request)}`)
      settle(buffers)
    }, timeoutMs)
    const call = client.ServerReflectionInfo(metadata)

    call.on('data', (response: any) => {
      if (response.file_descriptor_response) {
        const fds = response.file_descriptor_response.file_descriptor_proto
        logDep(`[ReflReq] data → ${fds.length} fd_proto(s) | req=${JSON.stringify(request)}`)
        for (const fd of fds) {
          buffers.push(Buffer.isBuffer(fd) ? fd : Buffer.from(fd))
        }
      }
      if (response.error_response) {
        logDep(`[ReflReq] error_response: ${response.error_response.error_message} | req=${JSON.stringify(request)}`)
        settle(buffers)
      }
    })
    call.on('error', (e: any) => {
      logDep(`[ReflReq] stream error: ${e?.message} | req=${JSON.stringify(request)}`)
      settle(buffers)
    })
    call.on('end', () => settle(buffers))

    call.write(request)
    call.end()
  })
}

// Fetch all transitive file descriptor dependencies for a reflection client.
// Starting from buffers returned for one symbol, walks the dependency graph
// and fetches any files not already present, up to maxFiles to guard against runaway loops.
async function resolveTransitiveDeps(
  client: any,
  metadata: grpc.Metadata,
  initialBuffers: Buffer[],
  maxFiles = 60
): Promise<Buffer[]> {
  const protobuf = getProtobuf()
  const fetchedNames = new Set<string>()
  const allBuffers: Buffer[] = []
  const queue: string[] = []

  logDep(`[TransitiveDeps] START — ${initialBuffers.length} initial buffer(s)`)

  // Index initial batch and collect dependency filenames
  for (const buf of initialBuffers) {
    try {
      const decoded = protobuf.descriptor.FileDescriptorProto.decode(buf)
      logDep(`[TransitiveDeps] initial file: ${decoded.name} | pkg=${decoded.package||'-'} | msgs=[${(decoded.messageType||[]).map((m:any)=>m.name).join(',')}] | deps=[${(decoded.dependency||[]).join(', ')}]`)
      if (!fetchedNames.has(decoded.name)) {
        fetchedNames.add(decoded.name)
        allBuffers.push(buf)
        for (const dep of decoded.dependency || []) {
          if (!fetchedNames.has(dep)) queue.push(dep)
        }
      }
    } catch (e: any) {
      logDep(`[TransitiveDeps] decode error on initial: ${e?.message}`)
    }
  }

  logDep(`[TransitiveDeps] dep queue after initial: [${queue.join(', ')}]`)

  // BFS: fetch each missing dependency file
  while (queue.length > 0 && allBuffers.length < maxFiles) {
    const filename = queue.shift()!
    if (fetchedNames.has(filename)) { logDep(`[TransitiveDeps] SKIP (already seen): ${filename}`); continue }
    fetchedNames.add(filename) // mark early to avoid duplicates in queue

    if (filename.startsWith('google/')) {
      logDep(`[TransitiveDeps] SKIP (google/*): ${filename}`)
      continue
    }

    logDep(`[TransitiveDeps] fetching dep: ${filename}`)
    const depBufs = await reflectionSingleRequest(
      client, metadata, { file_by_filename: filename }, 3000
    )
    logDep(`[TransitiveDeps] dep ${filename} → ${depBufs.length} buffer(s)`)

    for (const buf of depBufs) {
      try {
        const decoded = protobuf.descriptor.FileDescriptorProto.decode(buf)
        logDep(`[TransitiveDeps] dep file: ${decoded.name} | pkg=${decoded.package||'-'} | msgs=[${(decoded.messageType||[]).map((m:any)=>m.name).join(',')}] | deps=[${(decoded.dependency||[]).join(', ')}]`)
        if (!fetchedNames.has(decoded.name)) {
          fetchedNames.add(decoded.name)
          allBuffers.push(buf)
          for (const dep of decoded.dependency || []) {
            if (!fetchedNames.has(dep) && !dep.startsWith('google/')) queue.push(dep)
          }
        } else {
          allBuffers.push(buf) // already known but keep for indexing completeness
        }
      } catch (e: any) {
        logDep(`[TransitiveDeps] decode error on dep ${filename}: ${e?.message}`)
      }
    }
  }

  logDep(`[TransitiveDeps] DONE — ${allBuffers.length} total files loaded`)
  return allBuffers
}

export function registerGrpcHandlers() {
  // ===== List services via reflection =====
  ipcMain.handle('grpc:reflect', async (_event, args: { host: string; insecure: boolean; headers: Record<string, string>; protoPath?: string }) => {
    try {
      if (args.protoPath) {
        try {
          const protobuf = getProtobuf()
          const root = new protobuf.Root()
          root.resolvePath = (origin: string, target: string) => {
             if (path.isAbsolute(target)) return target
             return path.join(path.dirname(args.protoPath!), target)
          }
          root.loadSync(args.protoPath, { keepCase: true })
          root.resolveAll()
          
          const services: string[] = []
          const traverse = (ns: any, prefix = '') => {
            if (ns.nestedArray) {
              for (const child of ns.nestedArray) {
                const fullName = prefix ? `${prefix}.${child.name}` : child.name
                if (child.constructor.name === 'Service') {
                  services.push(fullName)
                } else if (child.constructor.name === 'Namespace' || child.constructor.name === 'Type') {
                  traverse(child, fullName)
                }
              }
            }
          }
          traverse(root)
          return { success: true, services }
        } catch (err: any) {
          return { success: false, error: err.message || 'Failed to parse proto file' }
        }
      }

      const metadata = new grpc.Metadata()
      for (const [key, value] of Object.entries(args.headers || {})) {
        if (key && value) metadata.add(key, value)
      }

      const client = createReflectionClient(args.host, args.insecure)

      return await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          client.close()
          resolve({ success: false, error: 'Reflection timeout (5s)' })
        }, 5000)

        const call = client.ServerReflectionInfo(metadata)
        const services: string[] = []

        call.on('data', (response: any) => {
          if (response.list_services_response) {
            for (const svc of response.list_services_response.service) {
              services.push(svc.name)
            }
          }
        })

        call.on('error', (err: GrpcError) => {
          clearTimeout(timeout)
          resolve({ success: false, error: err.message || 'Reflection failed' })
        })

        call.on('end', () => {
          clearTimeout(timeout)
          resolve({ success: true, services })
        })

        // Send the list services request
        call.write({ list_services: '' })
        call.end()
      })
    } catch (err: any) {
      return { success: false, error: err.message || 'Unknown error' }
    }
  })

  // ===== Get methods for a service via reflection file descriptors =====
  ipcMain.handle('grpc:methods', async (_event, args: { host: string; insecure: boolean; headers: Record<string, string>; serviceName: string; protoPath?: string }) => {
    try {
      if (args.protoPath) {
        try {
          const protobuf = getProtobuf()
          const root = new protobuf.Root()
          root.resolvePath = (origin: string, target: string) => {
             if (path.isAbsolute(target)) return target
             return path.join(path.dirname(args.protoPath!), target)
          }
          root.loadSync(args.protoPath, { keepCase: true })
          root.resolveAll()

          const methods: { name: string; fullName: string; requestType: string; responseType: string; clientStreaming: boolean; serverStreaming: boolean; sampleBody: string }[] = []
          const targetShortName = args.serviceName.split('.').pop()
          
          const generateProtoSample = (type: any, visited: Set<string>): Record<string, any> => {
            if (!type || visited.has(type.fullName)) return {}
            visited.add(type.fullName)
            const result: Record<string, any> = {}

            for (const field of type.fieldsArray) {
              // Map support for protobufjs (MapField)
              if (field.map) {
                const sampleKey = field.keyType === 'string' ? 'sample_key' : '1'
                let sampleValue: any
                if (field.resolvedType) {
                  if (field.resolvedType.constructor.name === 'Enum') {
                    sampleValue = Object.keys(field.resolvedType.values)[0] || 0
                  } else {
                    sampleValue = generateProtoSample(field.resolvedType, visited)
                  }
                } else {
                  sampleValue = field.type === 'string' ? 'sample_value' : (field.type === 'bool' ? true : 1)
                }
                result[field.name] = { [sampleKey]: sampleValue }
                continue
              }

              let value: any
              if (field.resolvedType) {
                 if (field.resolvedType.constructor.name === 'Enum') {
                   // Use the first available enum constant name
                   value = Object.keys(field.resolvedType.values)[0] || 0
                 } else {
                   value = generateProtoSample(field.resolvedType, visited)
                 }
              } else {
                switch (field.type) {
                  case 'double': case 'float': value = 1.0; break;
                  case 'int32': case 'uint32': case 'sint32': case 'fixed32': case 'sfixed32': value = 1; break;
                  case 'int64': case 'uint64': case 'sint64': case 'fixed64': case 'sfixed64': value = '1'; break;
                  case 'bool': value = true; break;
                  case 'string': value = `${field.name}_sample`; break;
                  case 'bytes': value = 'YmFzZTY0'; break;
                  default: value = null;
                }
              }
              if (field.repeated) {
                result[field.name] = value !== null ? [value] : []
              } else {
                result[field.name] = value
              }
            }
            visited.delete(type.fullName)
            return result
          }

          const service = root.lookupService(args.serviceName) || root.lookupService(targetShortName!)
          if (service) {
            for (const mName of Object.keys(service.methods)) {
              const m = service.methods[mName]
              m.resolve()
              const inputType = root.lookupType(m.requestType)
              const outputType = root.lookupType(m.responseType)
              const sampleBody = generateProtoSample(inputType, new Set())
              const responseSampleBody = generateProtoSample(outputType, new Set())
              
              methods.push({
                name: mName,
                fullName: `${args.serviceName}/${mName}`,
                requestType: m.requestType,
                responseType: m.responseType,
                clientStreaming: m.requestStream || false,
                serverStreaming: m.responseStream || false,
                sampleBody: JSON.stringify(sampleBody, null, 2),
                responseSampleBody: JSON.stringify(responseSampleBody, null, 2),
              })
            }
          }
          return { success: true, methods }
        } catch (err: any) {
             return { success: false, error: err.message || 'Failed to parse proto file for methods' }
        }
      }

      // ── Reflection path for grpc:methods ─────────────────────────────────────
      const metadata = new grpc.Metadata()
      for (const [key, value] of Object.entries(args.headers || {})) {
        if (key && value) metadata.add(key, value)
      }

      const client = createReflectionClient(args.host, args.insecure)

      // Step 1: Get initial file descriptors for the service symbol
      const initialBufs = await reflectionSingleRequest(
        client, metadata, { file_containing_symbol: args.serviceName }, 5000
      )

      if (initialBufs.length === 0) {
        client.close()
        return { success: false, error: 'No file descriptors returned by reflection — server may not support it.' }
      }

      // Step 2: Resolve all transitive dependency files so nested message types are available
      const descriptorBuffers = await resolveTransitiveDeps(client, metadata, initialBufs)
      client.close()

      try {
        const protobuf = getProtobuf()
        const methods: { name: string; fullName: string; requestType: string; responseType: string; clientStreaming: boolean; serverStreaming: boolean; sampleBody: string; responseSampleBody: string }[] = []
        const targetShortName = args.serviceName.split('.').pop()

        // Pass 1: Index all types from all buffers (including deps)
        const messageTypes = new Map<string, any>()
        const enumTypes = new Map<string, any>()

        for (const buf of descriptorBuffers) {
          try {
            const decoded = protobuf.descriptor.FileDescriptorProto.decode(buf)
            const pkg = decoded.package || ''

            if (decoded.enumType) {
              for (const enm of decoded.enumType) {
                const fullName = pkg ? `${pkg}.${enm.name}` : enm.name
                enumTypes.set(fullName, enm)
                enumTypes.set(`.${fullName}`, enm)
              }
            }
            if (decoded.messageType) {
              for (const msg of decoded.messageType) {
                indexDescriptorTypes(pkg, msg, messageTypes, enumTypes)
              }
            }
          } catch { /* skip malformed */ }
        }

        // Pass 2: Find the service and generate methods
        for (const buf of descriptorBuffers) {
          try {
            const decoded = protobuf.descriptor.FileDescriptorProto.decode(buf)
            const pkg = decoded.package || ''

            if (decoded.service) {
              for (const svc of decoded.service) {
                const svcFullName = pkg ? `${pkg}.${svc.name}` : svc.name
                if (svcFullName === args.serviceName || svc.name === targetShortName) {
                  if (svc.method) {
                    for (const m of svc.method) {
                      const cleanType = (t: string) => t?.startsWith('.') ? t.slice(1) : (t || '')
                      const inputType = cleanType(m.inputType)

                      methods.push({
                        name: m.name,
                        fullName: `${svcFullName}/${m.name}`,
                        requestType: inputType,
                        responseType: cleanType(m.outputType),
                        clientStreaming: m.clientStreaming || false,
                        serverStreaming: m.serverStreaming || false,
                        sampleBody: JSON.stringify(
                          generateSampleBody(messageTypes, enumTypes, m.inputType, new Set()),
                          null, 2
                        ),
                        responseSampleBody: JSON.stringify(
                          generateSampleBody(messageTypes, enumTypes, m.outputType, new Set()),
                          null, 2
                        ),
                      })
                    }
                  }
                }
              }
            }
          } catch { /* skip malformed */ }
        }

        return { success: true, methods }
      } catch (parseErr: any) {
        return { success: false, error: `Failed to parse descriptors: ${parseErr.message}` }
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Unknown error' }
    }
  })


  // ===== Execute a gRPC unary call =====
  ipcMain.handle('grpc:call', async (_event, req: GrpcRequest) => {
    return handleGrpcCall(req)
  })
}
