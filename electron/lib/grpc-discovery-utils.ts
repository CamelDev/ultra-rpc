import * as path from 'path';

// protobufjs is kept external to avoid bundling issues in ESM.
// We use a lazy initializer to ensure it works in both Electron and Bun tests.
let protobufInstance: any = null;

export function getProtobuf() {
  if (protobufInstance) return protobufInstance;

  if (typeof globalThis.require === 'function') {
    // Electron environment
    protobufInstance = globalThis.require('protobufjs');
    globalThis.require('protobufjs/ext/descriptor');
  } else {
    // Bun / Test environment - will be injected or imported
    // For tests, we'll manually set this or use a different approach
    throw new Error('ProtobufJS must be initialized before use in this environment');
  }
  return protobufInstance;
}

// For unit tests to inject the instance
export function setProtobuf(instance: any) {
  protobufInstance = instance;
}

export interface SampleVariant {
  name: string;
  body: string;
  oneofName?: string;
}

/** Metadata for a single proto message field, used for type tag display in the UI */
export interface FieldInfo {
  name: string;
  /** Human-readable scalar type label, e.g. "string", "int32", "bool", "message", "enum", "bytes" */
  typeLabel: string;
  /** Full proto type name for message/enum fields, e.g. "google.protobuf.Timestamp" */
  typeName?: string;
  /** Enum value names for tooltip display */
  enumValues?: string[];
  repeated: boolean;
  optional: boolean;
  oneofName?: string;
}

export interface MethodInfo {
  name: string;
  fullName: string;
  requestType: string;
  responseType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  sampleBody?: string;
  responseSampleBody?: string;
  requestVariants?: SampleVariant[];
  responseVariants?: SampleVariant[];
  /** Field-level metadata for the request message type */
  requestFields?: FieldInfo[];
  /** Field-level metadata for the response message type */
  responseFields?: FieldInfo[];
  /** Flattened map of json path / field name -> structured type info for CodeMirror hints */
  requestTypeAnnotations?: Record<string, { type: string; enumValues?: string[]; optional?: boolean }>;
  responseTypeAnnotations?: Record<string, { type: string; enumValues?: string[]; optional?: boolean }>;
}

/**
 * Recursively index all message and enum types from descriptors
 */
export function indexDescriptorTypes(
  pkg: string,
  msg: any,
  messageTypes: Map<string, any>,
  enumTypes: Map<string, any>
) {
  const name = msg.name;
  const fullName = pkg ? `${pkg}.${name}` : name;

  messageTypes.set(fullName, msg);
  messageTypes.set(`.${fullName}`, msg);

  if (msg.nestedType) {
    for (const nested of msg.nestedType) {
      indexDescriptorTypes(fullName, nested, messageTypes, enumTypes);
    }
  }

  if (msg.enumType) {
    for (const enm of msg.enumType) {
      const enmFullName = `${fullName}.${enm.name}`;
      enumTypes.set(enmFullName, enm);
      enumTypes.set(`.${enmFullName}`, enm);
    }
  }
}

/** Map proto field type number to a human-readable label */
const PROTO_TYPE_LABELS: Record<number, string> = {
  1: 'double',
  2: 'float',
  3: 'int64',
  4: 'uint64',
  5: 'int32',
  6: 'fixed64',
  7: 'fixed32',
  8: 'bool',
  9: 'string',
  10: 'group',
  11: 'message',
  12: 'bytes',
  13: 'uint32',
  14: 'enum',
  15: 'sfixed32',
  16: 'sfixed64',
  17: 'sint32',
  18: 'sint64',
}

/**
 * Extract FieldInfo metadata from a proto message descriptor.
 * Returns top-level fields only (not nested), making the data suitable for
 * the discovery UI's field type tag display.
 */
export function extractFields(
  typeName: string,
  messageTypes: Map<string, any>,
  enumTypes: Map<string, any>
): FieldInfo[] {
  const getMsg = (name: string) =>
    messageTypes.get(name) || messageTypes.get(`.${name}`) ||
    (name.startsWith('.') ? messageTypes.get(name.slice(1)) : null)

  const msg = getMsg(typeName)
  if (!msg || !msg.field) return []

  // Build oneof index → name map
  const oneofNames: Record<number, string> = {}
  if (msg.oneofDecl) {
    msg.oneofDecl.forEach((o: any, i: number) => {
      oneofNames[i] = o?.name || `oneof_${i}`
    })
  }

  const fields: FieldInfo[] = []

  for (const field of (msg.field || [])) {
    const typeNum: number = field.type ?? 0
    const typeLabel = PROTO_TYPE_LABELS[typeNum] ?? 'unknown'
    const repeated = field.label === 3 // LABEL_REPEATED
    const isOptional = !!(field.proto3Optional || field.proto3_optional)

    // Resolve oneof membership (skip synthetic proto3 optional oneofs)
    const oIdx = field.oneofIndex !== undefined ? field.oneofIndex : field.oneof_index
    const hasOneof = (Object.prototype.hasOwnProperty.call(field, 'oneofIndex') ||
                      Object.prototype.hasOwnProperty.call(field, 'oneof_index')) &&
                     oIdx !== undefined && oIdx !== null && !isOptional
    const oneofName = hasOneof ? oneofNames[oIdx] : undefined

    const fi: FieldInfo = {
      name: field.jsonName || field.name,
      typeLabel,
      repeated,
      optional: isOptional,
      oneofName,
    }

    // For message/enum fields, include the type name too
    if (typeNum === 11 || typeNum === 14) {
      const rawName: string = field.typeName || ''
      fi.typeName = rawName.startsWith('.') ? rawName.slice(1) : rawName
    }

    // For enum fields, fetch value names for the tooltip
    if (typeNum === 14 && field.typeName) {
      const enm = enumTypes.get(field.typeName) || enumTypes.get(field.typeName.replace(/^\./, ''))
      if (enm?.value) {
        fi.enumValues = (enm.value as any[]).map((v: any) => v.name as string)
      }
    }

    fields.push(fi)
  }

  return fields
}

/**
 * Builds a flat map of propertyName -> typeLabel to be used as inline CodeMirror hints
 */
export function flattenFieldTypeAnnotations(
  typeName: string,
  messageTypes: Map<string, any>,
  enumTypes: Map<string, any>,
  visited = new Set<string>(),
  annotations: Record<string, { type: string; enumValues?: string[]; optional?: boolean }> = {}
): Record<string, { type: string; enumValues?: string[]; optional?: boolean }> {
  const getMsg = (name: string) =>
    messageTypes.get(name) || messageTypes.get(`.${name}`) ||
    (name.startsWith('.') ? messageTypes.get(name.slice(1)) : null)
  
  const msg = getMsg(typeName)
  if (!msg || !msg.field || visited.has(typeName)) return annotations
  visited.add(typeName)

  for (const field of (msg.field || [])) {
    const typeNum: number = field.type ?? 0
    const typeLabel = PROTO_TYPE_LABELS[typeNum] ?? 'unknown'
    const name = field.jsonName || field.name
    const isOptional = !!(field.proto3Optional || field.proto3_optional)

    if (typeNum === 11 || typeNum === 14) {
      let shortName = field.typeName || ''
      shortName = shortName.split('.').pop() || shortName
      // Check if map entry (we want to show the type of the value)
      if (typeNum === 11) {
        const nestedMsg = getMsg(field.typeName)
        if (nestedMsg?.options?.mapEntry || nestedMsg?.options?.map_entry) {
          const valField = nestedMsg.field?.find((f: any) => f.number === 2)
          if (valField) {
            let valShortName = valField.typeName || ''
            valShortName = valShortName.split('.').pop() || valShortName
            const valLabel = PROTO_TYPE_LABELS[valField.type ?? 0] ?? 'unknown'
            const annotation: any = { type: `map<string, ${valShortName || valLabel}>` };
            if (isOptional) annotation.optional = true;
            annotations[name] = annotation;
            
            if (valField.type === 11 && valField.typeName) {
               flattenFieldTypeAnnotations(valField.typeName, messageTypes, enumTypes, visited, annotations)
            }
            continue
          }
        }
      }

      let enumValues: string[] | undefined
      if (typeNum === 14 && field.typeName) {
        const enm = enumTypes.get(field.typeName) || enumTypes.get(field.typeName.replace(/^\./, ''))
        if (enm?.value) {
          enumValues = (enm.value as any[]).map((v: any) => v.name as string)
        }
      }

      const annotation: any = { type: shortName };
      if (enumValues) annotation.enumValues = enumValues;
      if (isOptional) annotation.optional = true;
      annotations[name] = annotation;

      if (typeNum === 11 && field.typeName) {
        flattenFieldTypeAnnotations(field.typeName, messageTypes, enumTypes, visited, annotations)
      }
    } else {
      const annotation: any = { type: typeLabel };
      if (isOptional) annotation.optional = true;
      annotations[name] = annotation;
    }
  }

  // Remove visited so it can be traversed again from a different path if there's no cycle
  visited.delete(typeName)
  return annotations
}

/**
 * Protobuf field type numbers → default values for sample body generation
 * See: https://protobuf.dev/programming-guides/proto3/#scalar
 */
export function generateSampleBody(
  messageTypes: Map<string, any>,
  enumTypes: Map<string, any>,
  typeName: string,
  visited: Set<string>,
  options: { oneofSelection?: Record<number, string> } = {}
): Record<string, any> {
  const getMsg = (name: string) => {
    if (!name) return null;
    return (
      messageTypes.get(name) ||
      messageTypes.get(`.${name}`) ||
      (name.startsWith('.') ? messageTypes.get(name.slice(1)) : null)
    );
  };

  const msg = getMsg(typeName);
  if (!msg || !msg.field) return {};

  const canonicalName = typeName.startsWith('.') ? typeName : `.${typeName}`;
  if (visited.has(canonicalName)) return {};
  visited.add(canonicalName);

  const result: Record<string, any> = {};
  const fieldsToInclude = new Set<any>();
  const processedOneofs = new Set<number>();
  const sortedFields = [...(msg.field || [])].sort((a, b) => {
    const aNum = a.number !== undefined ? a.number : 0;
    const bNum = b.number !== undefined ? b.number : 0;
    return aNum - bNum;
  });

  for (const field of sortedFields) {
    const oIndex = (field.oneofIndex !== undefined && field.oneofIndex !== null) ? field.oneofIndex : field.oneof_index;
    const hasOneofIndex = Object.prototype.hasOwnProperty.call(field, 'oneofIndex') || Object.prototype.hasOwnProperty.call(field, 'oneof_index');
    const isOptional = field.proto3Optional || field.proto3_optional;
    
    if (hasOneofIndex && oIndex !== undefined && oIndex !== null && !isOptional) {
      if (processedOneofs.has(oIndex)) continue;

      const selection = options.oneofSelection?.[oIndex];
      if (selection) {
        if (field.name === selection) {
          fieldsToInclude.add(field);
          processedOneofs.add(oIndex);
        }
      } else {
        fieldsToInclude.add(field);
        processedOneofs.add(oIndex);
      }
    } else {
      fieldsToInclude.add(field);
    }
  }

  for (const field of sortedFields) {
    if (!fieldsToInclude.has(field)) continue;

    const name = field.jsonName || field.name;
    let value: any;

    // Check if it's a map entry
    if (field.type === 11 && field.label === 3) {
      // LABEL_REPEATED && TYPE_MESSAGE
      const fieldType = messageTypes.get(field.typeName);
      if (fieldType && fieldType.options && (fieldType.options.mapEntry || fieldType.options.map_entry)) {
        const keyField = fieldType.field.find((f: any) => f.number === 1);
        const valField = fieldType.field.find((f: any) => f.number === 2);

        const sampleKey = keyField && keyField.type === 9 ? 'sample_key' : '1';
        let sampleVal: any;
        if (valField.type === 11) {
          sampleVal = generateSampleBody(messageTypes, enumTypes, valField.typeName, visited);
        } else if (valField.type === 14) {
          const enm = enumTypes.get(valField.typeName);
          sampleVal = enm && enm.value && enm.value.length > 0 ? enm.value[0].name : 0;
        } else {
          sampleVal = valField.type === 9 ? 'sample_value' : valField.type === 8 ? true : 1;
        }
        result[name] = { [sampleKey]: sampleVal };
        continue;
      }
    }

    switch (field.type) {
      case 1: // TYPE_DOUBLE
      case 2: // TYPE_FLOAT
        value = 1.0;
        break;
      case 3: // TYPE_INT64
      case 4: // TYPE_UINT64
      case 18: // TYPE_SINT64
      case 16: // TYPE_SFIXED64
      case 6: // TYPE_FIXED64
        value = '1';
        break;
      case 5: // TYPE_INT32
      case 13: // TYPE_UINT32
      case 15: // TYPE_SFIXED32
      case 7: // TYPE_FIXED32
      case 17: // TYPE_SINT32
        value = 1;
        break;
      case 14: // TYPE_ENUM
        {
          const enm = enumTypes.get(field.typeName);
          if (enm && enm.value && enm.value.length > 0) {
            value = enm.value[0].name;
          } else {
            value = 0;
          }
        }
        break;
      case 8: // TYPE_BOOL
        value = true;
        break;
      case 9: // TYPE_STRING
        value = `${field.name}_sample`;
        break;
      case 12: // TYPE_BYTES
        value = 'YmFzZTY0';
        break;
      case 11: // TYPE_MESSAGE
        value = generateSampleBody(messageTypes, enumTypes, field.typeName, visited);
        break;
      default:
        value = null;
    }

    if (field.label === 3) {
      // LABEL_REPEATED
      result[name] = value !== null ? [value] : [];
    } else {
      result[name] = value;
    }
  }

  visited.delete(canonicalName);
  return result;
}

/**
 * Recursively convert JSON objects meant for gRPC maps into arrays of {key, value} entries.
 */
export function parseMapsToArrays(type: any, payload: any): any {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (!type || !type.fields) return payload;

  const result = { ...payload };
  const payloadKeys = Object.keys(result);

  for (const [fieldName, field] of Object.entries(type.fields) as [string, any]) {
    const normalize = (s: string) => s.toLowerCase().replace(/_/g, '');
    const targetNames = [fieldName];
    if (field.jsonName) targetNames.push(field.jsonName);
    
    const normalizedTargets = targetNames.map(normalize);
    const keyInPayload = payloadKeys.find(pkg => 
      targetNames.includes(pkg) || normalizedTargets.includes(normalize(pkg))
    );

    if (keyInPayload) {
      let val = result[keyInPayload];
      
      if (field.resolvedType) {
        const isWrapper = field.resolvedType.fullName && 
                          field.resolvedType.fullName.startsWith('.google.protobuf.') && 
                          field.resolvedType.fullName.endsWith('Value');
        
        if (isWrapper && val !== null && typeof val !== 'object') {
          val = { value: val };
          result[keyInPayload] = val;
        }

        if (field.resolvedType.fullName === '.google.protobuf.Timestamp' && typeof val === 'string') {
          const date = new Date(val);
          if (!isNaN(date.getTime())) {
            const seconds = Math.floor(date.getTime() / 1000);
            const nanos = (date.getTime() % 1000) * 1e6;
            val = { seconds, nanos };
            result[keyInPayload] = val;
          }
        }

        if (field.resolvedType.fullName === '.google.protobuf.Duration' && typeof val === 'string') {
          const match = val.match(/^(\d+(\.\d+)?)s?$/);
          if (match) {
            const totalSeconds = parseFloat(match[1]);
            const seconds = Math.floor(totalSeconds);
            const nanos = Math.floor((totalSeconds % 1) * 1e9);
            val = { seconds, nanos };
            result[keyInPayload] = val;
          }
        }

        const isMapEntry = field.map || (
          field.repeated && 
          field.resolvedType && 
          field.resolvedType.options && 
          (field.resolvedType.options.mapEntry || field.resolvedType.options.map_entry)
        );

        if (isMapEntry && val && typeof val === 'object' && !Array.isArray(val)) {
          const arr = [];
          for (const [k, v] of Object.entries(val)) {
            const valueField = field.resolvedType.fields['value'];
            arr.push({
              key: k,
              value: (valueField && valueField.resolvedType) ? parseMapsToArrays(valueField.resolvedType, v) : v
            });
          }
          result[keyInPayload] = arr;
        } else if (field.repeated && Array.isArray(val)) {
          result[keyInPayload] = val.map((item: any) => parseMapsToArrays(field.resolvedType, item));
        } else {
          result[keyInPayload] = parseMapsToArrays(field.resolvedType, val);
        }
      }

      if (keyInPayload !== fieldName) {
        result[fieldName] = result[keyInPayload];
        delete result[keyInPayload];
      }
    }
  }

  return result;
}

/**
 * Process raw descriptor buffers to extract services and methods
 */
export function processDescriptorBuffers(
  descriptorBuffers: Buffer[],
  targetServiceName: string
): MethodInfo[] {
  const protobuf = getProtobuf();
  const methods: MethodInfo[] = [];
  const targetShortName = targetServiceName.split('.').pop();

  // Index all types from all buffers
  const messageTypes = new Map<string, any>();
  const enumTypes = new Map<string, any>();

  for (const buf of descriptorBuffers) {
    try {
      const decoded = protobuf.descriptor.FileDescriptorProto.decode(buf);
      const pkg = decoded.package || '';

      if (decoded.enumType) {
        for (const enm of decoded.enumType) {
          const fullName = pkg ? `${pkg}.${enm.name}` : enm.name;
          enumTypes.set(fullName, enm);
          enumTypes.set(`.${fullName}`, enm);
        }
      }
      if (decoded.messageType) {
        for (const msg of decoded.messageType) {
          indexDescriptorTypes(pkg, msg, messageTypes, enumTypes);
        }
      }
    } catch { /* skip malformed */ }
  }

  // Find the service and generate methods
  for (const buf of descriptorBuffers) {
    try {
      const decoded = protobuf.descriptor.FileDescriptorProto.decode(buf);
      const pkg = decoded.package || '';

      if (decoded.service) {
        for (const svc of decoded.service) {
          const svcFullName = pkg ? `${pkg}.${svc.name}` : svc.name;
          if (svcFullName === targetServiceName || svc.name === targetShortName) {
            if (svc.method) {
              for (const m of svc.method) {
                const cleanType = (t: string) => t?.startsWith('.') ? t.slice(1) : (t || '');
                
                const getVariants = (typeName: string) => {
                  const variants: SampleVariant[] = [];
                  const msg = messageTypes.get(typeName) || messageTypes.get(`.${typeName}`);
                  
                  if (msg && msg.oneofDecl && msg.oneofDecl.length > 0) {
                    for (let i = 0; i < msg.oneofDecl.length; i++) {
                      const oneofName = msg.oneofDecl[i]?.name || `index_${i}`;
                      if (oneofName.startsWith('_')) continue;

                      const oneofFields = (msg.field || []).filter((f: any) => {
                        const hasOneofIndex = Object.prototype.hasOwnProperty.call(f, 'oneofIndex') || Object.prototype.hasOwnProperty.call(f, 'oneof_index');
                        const fi = (f.oneofIndex !== undefined) ? f.oneofIndex : f.oneof_index;
                        return hasOneofIndex && fi === i && !f.proto3Optional && !f.proto3_optional;
                      });

                      if (oneofFields.length > 1) {
                        for (const f of oneofFields) {
                          const body = JSON.stringify(generateSampleBody(messageTypes, enumTypes, typeName, new Set(), {
                            oneofSelection: { [i]: f.name }
                          }), null, 2);
                          variants.push({ name: f.name, oneofName, body });
                        }
                      }
                    }
                  }

                  if (variants.length === 0) {
                    variants.push({ 
                      name: 'Default', 
                      body: JSON.stringify(generateSampleBody(messageTypes, enumTypes, typeName, new Set()), null, 2) 
                    });
                  }
                  return variants;
                };

                const requestVariants = getVariants(m.inputType);
                const responseVariants = getVariants(m.outputType);

                const reqTypeName = cleanType(m.inputType);
                const resTypeName = cleanType(m.outputType);

                methods.push({
                  name: m.name,
                  fullName: `${svcFullName}/${m.name}`,
                  requestType: reqTypeName,
                  responseType: resTypeName,
                  clientStreaming: m.clientStreaming || false,
                  serverStreaming: m.serverStreaming || false,
                  sampleBody: requestVariants[0]?.body || '{}',
                  responseSampleBody: responseVariants[0]?.body || '{}',
                  requestVariants,
                  responseVariants,
                  requestFields: extractFields(reqTypeName, messageTypes, enumTypes),
                  responseFields: extractFields(resTypeName, messageTypes, enumTypes),
                  requestTypeAnnotations: flattenFieldTypeAnnotations(reqTypeName, messageTypes, enumTypes),
                  responseTypeAnnotations: flattenFieldTypeAnnotations(resTypeName, messageTypes, enumTypes),
                });
              }
            }
          }
        }
      }
    } catch { /* skip malformed */ }
  }

  return methods;
}
