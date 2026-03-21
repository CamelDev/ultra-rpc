/* eslint-disable @typescript-eslint/no-explicit-any */
import { ipcMain } from 'electron'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import fs from 'fs'
import path from 'path'
import os from 'os'

// protobufjs is kept external to avoid bundling issues in ESM.
// We use a lazy initializer to ensure globalThis.require is available (initialized in main.ts).
let protobufInstance: any = null
function getProtobuf() {
  if (protobufInstance) return protobufInstance
  // @ts-expect-error
  protobufInstance = globalThis.require('protobufjs')
  // @ts-expect-error
  globalThis.require('protobufjs/ext/descriptor')
  return protobufInstance
}

interface GrpcRequest {
  host: string
  insecure: boolean
  headers: Record<string, string>
  service: string
  method: string
  payload: string
  protoPath?: string // Optional: use proto file instead of reflection
  timeoutMs?: number // Optional: deadline timeout in milliseconds
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
function generateSampleBody(messageTypes: Map<string, any>, typeName: string, visited: Set<string>): Record<string, any> {
  const msg = messageTypes.get(typeName)
  if (!msg || !msg.field) return {}

  // Prevent infinite recursion with self-referencing types
  if (visited.has(typeName)) return {}
  visited.add(typeName)

  const result: Record<string, any> = {}

  for (const field of msg.field) {
    const name = field.jsonName || field.name
    let value: any

    // field.type is a number from FieldDescriptorProto.Type enum
    switch (field.type) {
      case 1: // TYPE_DOUBLE
      case 2: // TYPE_FLOAT
        value = 0.0; break
      case 3: // TYPE_INT64
      case 4: // TYPE_UINT64
      case 18: // TYPE_SINT64
      case 16: // TYPE_SFIXED64
      case 6: // TYPE_FIXED64
        value = '0'; break // Strings for 64-bit in JSON
      case 5: // TYPE_INT32
      case 13: // TYPE_UINT32
      case 15: // TYPE_SFIXED32
      case 7: // TYPE_FIXED32
      case 14: // TYPE_ENUM
      case 17: // TYPE_SINT32
        value = 0; break
      case 8: // TYPE_BOOL
        value = false; break
      case 9: // TYPE_STRING
        value = ''; break
      case 12: // TYPE_BYTES
        value = ''; break
      case 11: // TYPE_MESSAGE
        value = generateSampleBody(messageTypes, field.typeName, new Set(visited)); break
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

  visited.delete(typeName)
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

export function registerGrpcHandlers() {
  // ===== List services via reflection =====
  ipcMain.handle('grpc:reflect', async (_event, args: { host: string; insecure: boolean; headers: Record<string, string> }) => {
    try {
      const metadata = new grpc.Metadata()
      for (const [key, value] of Object.entries(args.headers || {})) {
        if (key && value) metadata.add(key, value)
      }

      const client = createReflectionClient(args.host, args.insecure)

      return await new Promise((resolve) => {
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
          resolve({ success: false, error: err.message || 'Reflection failed' })
        })

        call.on('end', () => {
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
  ipcMain.handle('grpc:methods', async (_event, args: { host: string; insecure: boolean; headers: Record<string, string>; serviceName: string }) => {
    try {
      const metadata = new grpc.Metadata()
      for (const [key, value] of Object.entries(args.headers || {})) {
        if (key && value) metadata.add(key, value)
      }

      const client = createReflectionClient(args.host, args.insecure)

      return new Promise((resolve) => {
        const call = client.ServerReflectionInfo(metadata)
        const descriptorBuffers: Buffer[] = []

        call.on('data', (response: any) => {
          if (response.file_descriptor_response) {
            for (const fd of response.file_descriptor_response.file_descriptor_proto) {
              descriptorBuffers.push(Buffer.isBuffer(fd) ? fd : Buffer.from(fd))
            }
          }
          if (response.error_response) {
            resolve({ success: false, error: response.error_response.error_message })
          }
        })

          call.on('error', (err: GrpcError) => {
          resolve({ success: false, error: err.message || 'Describe failed' })
        })

        call.on('end', () => {
          try {
            // Parse file descriptors using protobufjs
            const protobuf = getProtobuf()
            const methods: { name: string; fullName: string; requestType: string; responseType: string; clientStreaming: boolean; serverStreaming: boolean; sampleBody: string }[] = []

            const targetShortName = args.serviceName.split('.').pop()

            // Collect all message types for sample body generation
            const messageTypes = new Map<string, any>()

            for (const buf of descriptorBuffers) {
              const decoded = protobuf.descriptor.FileDescriptorProto.decode(buf)
              const pkg = decoded.package || ''

              // Index all message types
              if (decoded.messageType) {
                for (const msg of decoded.messageType) {
                  const fullName = pkg ? `${pkg}.${msg.name}` : msg.name
                  messageTypes.set(fullName, msg)
                  messageTypes.set(`.${fullName}`, msg)
                }
              }

              if (decoded.service) {
                for (const svc of decoded.service) {
                  const svcFullName = pkg ? `${pkg}.${svc.name}` : svc.name
                  if (svcFullName === args.serviceName || svc.name === targetShortName) {
                    if (svc.method) {
                      for (const m of svc.method) {
                        const cleanType = (t: string) => t?.startsWith('.') ? t.slice(1) : (t || '')
                        const inputType = cleanType(m.inputType)

                        // Generate sample body from message fields
                        const sampleBody = generateSampleBody(messageTypes, m.inputType, new Set())

                        methods.push({
                          name: m.name,
                          fullName: `${svcFullName}/${m.name}`,
                          requestType: inputType,
                          responseType: cleanType(m.outputType),
                          clientStreaming: m.clientStreaming || false,
                          serverStreaming: m.serverStreaming || false,
                          sampleBody: JSON.stringify(sampleBody, null, 2),
                        })
                      }
                    }
                  }
                }
              }
            }

            resolve({ success: true, methods })
          } catch (parseErr: any) {
            resolve({ success: false, error: `Failed to parse descriptors: ${parseErr.message}` })
          }
        })

        // Request file descriptor for the service symbol
        call.write({ file_containing_symbol: args.serviceName })
        call.end()
      })
    } catch (err: any) {
      return { success: false, error: err.message || 'Unknown error' }
    }
  })

  // ===== Execute a gRPC unary call =====
    ipcMain.handle('grpc:call', async (_event, req: GrpcRequest) => {
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
        return new Promise((resolve) => {
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
            call.on('data', (response: any) => responses.push(response))
            call.on('error', (err: GrpcError) => {
              const time = Date.now() - start
              const errorMsg = formatGrpcError(err)
              resolve({ 
                success: true, 
                data: { 
                  type: 'GRPC',
                  status: err.code, 
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
              const time = Date.now() - start
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
                } 
              })
            })
          } else {
            const call = methodFn.call(client, payload, metadata, callOptions, (err: GrpcError | null, responseBody: unknown) => {
              const time = Date.now() - start
              if (err) {
                console.log(`[gRPC Backend] Unary call error: ${err.message}. Capturing metadata/trailers.`)
                setTimeout(() => {
                  const errorMsg = formatGrpcError(err)
                  resolve({ 
                    success: true, 
                    data: { 
                      type: 'GRPC',
                      status: err.code, 
                      statusText: err.details || 'Error', // statusText from gRPC
                      headers: responseHeaders, 
                      trailers: responseTrailers,
                      body: errorMsg,
                      time, 
                      size: Buffer.byteLength(errorMsg, 'utf-8') 
                    } 
                  })
                }, 10)
              } else {
                console.log(`[gRPC Backend] Unary call success. Waiting for status for trailers.`)
                // Use a small delay to ensure 'status' event is processed if it fires in same tick
                setTimeout(() => {
                  const body = JSON.stringify(responseBody, null, 2)
                  console.log(`[gRPC Backend] Resolving unary call with trailers:`, JSON.stringify(responseTrailers))
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
                }, 10)
              }
            })
            call.on('metadata', (m: grpc.Metadata) => {
              responseHeaders = metadataToObject(m)
              console.log(`[gRPC Backend] Captured metadata (headers):`, JSON.stringify(responseHeaders))
            })
            call.on('status', (status: grpc.StatusObject) => {
              responseTrailers = metadataToObject(status.metadata)
              console.log(`[gRPC Backend] Captured status (trailers):`, JSON.stringify(responseTrailers))
            })
          }
        })
      }

      // ===== Reflection-based call =====
      // Step 1: Get file descriptor for the service
      const reflClient = createReflectionClient(req.host, req.insecure)

      const descriptorBuffers: Buffer[] = await new Promise((resolve, reject) => {
        const call = reflClient.ServerReflectionInfo(metadata)
        const bufs: Buffer[] = []

        call.on('data', (response: any) => {
          if (response.file_descriptor_response) {
            for (const fd of response.file_descriptor_response.file_descriptor_proto) {
              bufs.push(Buffer.isBuffer(fd) ? fd : Buffer.from(fd))
            }
          }
          if (response.error_response) {
            reject(new Error(response.error_response.error_message))
          }
        })
        call.on('error', (err: GrpcError) => reject(err))
        call.on('end', () => resolve(bufs))
        call.write({ file_containing_symbol: req.service })
        call.end()
      })

      if (descriptorBuffers.length === 0) {
        return { success: false, error: `No file descriptor found for service "${req.service}"` }
      }

      // Step 2: Parse raw descriptors to find input/output types for the method

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
        return { success: false, error: `Method "${req.method}" not found on service "${req.service}"` }
      }

      // Step 3: Build a Root for message types using FileDescriptorSet
      // (Root.fromDescriptor needs a FileDescriptorSet, not individual FileDescriptorProto)
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

      // Step 4: Make the call using a generic gRPC client
      const fullMethodPath = `/${req.service}/${req.method}`
      const genericClient = new grpc.Client(cleanHost, credentials)

      return new Promise((resolve) => {
        let responseHeaders = {}
        let responseTrailers = {}

        if (isServerStreaming) {
          const call = genericClient.makeServerStreamRequest(
            fullMethodPath,
            (msg: any) => {
              const fixedPayload = parseMapsToArrays(requestType, msg)
              console.log(`[gRPC Backend] Final payload for ${fullMethodPath}:`, JSON.stringify(fixedPayload, null, 2))
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
            const responseObj = responseType.toObject(response, { longs: String, enums: String, defaults: true, oneofs: true, keepCase: true, bytes: String })
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
                console.log(`[gRPC Backend] Generic unary call error: ${err.message}. Capturing metadata/trailers.`)
                setTimeout(() => {
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
                }, 10)
              } else {
                console.log(`[gRPC Backend] Generic unary call success. Waiting for status for trailers.`)
                setTimeout(() => {
                  const responseObj = responseType.toObject(responseBody, { longs: String, enums: String, defaults: true, oneofs: true, keepCase: true, bytes: String })
                  const body = JSON.stringify(responseObj, null, 2)
                  console.log(`[gRPC Backend] Resolving generic unary call with trailers:`, JSON.stringify(responseTrailers))
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
                }, 10)
              }
            }
          )

          call.on('metadata', (m: grpc.Metadata) => {
            responseHeaders = metadataToObject(m)
            console.log(`[gRPC Backend] Captured generic metadata (headers):`, JSON.stringify(responseHeaders))
          })
          call.on('status', (status: grpc.StatusObject) => {
            responseTrailers = metadataToObject(status.metadata)
            console.log(`[gRPC Backend] Captured generic status (trailers):`, JSON.stringify(responseTrailers))
          })
        }
      })
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Unknown error',
        time: Date.now() - start,
      }
    }
  })
}
