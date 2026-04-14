import { ipcMain } from 'electron'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { 
  indexDescriptorTypes, 
  generateSampleBody, 
  parseMapsToArrays, 
  processDescriptorBuffers,
  MethodInfo,
  SampleVariant
} from './lib/grpc-discovery-utils'

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



// Helper to recursively convert JSON objects meant for gRPC maps into arrays of {key, value} entries.
// Necessary because protobuf.js (under reflection) treats maps as repeated entry messages.

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
          const decodedDescriptors = descriptorBuffers.map(buf => {
            return (protobuf as any).descriptor.FileDescriptorProto.decode(buf);
          })
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

          const methods: MethodInfo[] = []
          const targetShortName = args.serviceName.split('.').pop()
          
          const generateProtoSample = (type: any, visited: Set<string>, options: { oneofSelection?: Record<string, string> } = {}): Record<string, any> => {
            if (!type || visited.has(type.fullName)) return {}
            visited.add(type.fullName)
            const result: Record<string, any> = {}

            // Pre-calculate fields to include for oneof consistency
            const fieldsToInclude = new Set<string>()
            const processedOneofs = new Set<string>()

            for (const field of type.fieldsArray) {
              if (field.partOf) {
                if (processedOneofs.has(field.partOf.name)) continue
                const selectedFieldName = options.oneofSelection?.[field.partOf.name]
                if (selectedFieldName) {
                  fieldsToInclude.add(selectedFieldName)
                } else {
                  fieldsToInclude.add(field.name) // Default: first field
                }
                processedOneofs.add(field.partOf.name)
              } else {
                fieldsToInclude.add(field.name)
              }
            }

            for (const field of type.fieldsArray) {
              if (!fieldsToInclude.has(field.name)) continue
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

                  const getVariants = (type: any) => {
                    const variants: SampleVariant[] = []
                    
                    // Detect top-level oneofs that have more than 1 field (actual choices)
                    if (type.oneofsArray && type.oneofsArray.length > 0) {
                      for (const oneof of type.oneofsArray) {
                        // Skip synthetic oneofs for proto3 optional (usually start with underscore)
                        if (oneof.name.startsWith('_')) continue

                        if (oneof.fieldsArray.length > 1) {
                          for (const field of oneof.fieldsArray) {
                            const body = JSON.stringify(generateProtoSample(type, new Set(), { 
                              oneofSelection: { [oneof.name]: field.name } 
                            }), null, 2)
                            variants.push({ name: field.name, oneofName: oneof.name, body })
                          }
                        }
                      }
                    }
                    
                    // If no multi-field oneofs found, provide a Default variant
                    if (variants.length === 0) {
                      variants.push({ name: 'Default', body: JSON.stringify(generateProtoSample(type, new Set()), null, 2) })
                    }
                    return variants
                  }

                  const requestVariants = getVariants(inputType)
                  const responseVariants = getVariants(outputType)
                  
                  methods.push({
                    name: mName,
                    fullName: `${args.serviceName}/${mName}`,
                    requestType: m.requestType,
                    responseType: m.responseType,
                    clientStreaming: m.requestStream || false,
                    serverStreaming: m.responseStream || false,
                    sampleBody: requestVariants[0]?.body || '{}',
                    responseSampleBody: responseVariants[0]?.body || '{}',
                    requestVariants,
                    responseVariants,
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
        const methods = processDescriptorBuffers(descriptorBuffers, args.serviceName)
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
