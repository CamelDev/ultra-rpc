import { ipcMain } from 'electron'
import http from 'http'
import https from 'https'
import http2 from 'http2'
import { URL } from 'url'

interface RestRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  insecure?: boolean
  protocol?: 'auto' | 'http1' | 'http2'
  timeoutMs?: number
  abortSignal?: AbortSignal
}

export async function handleRestRequest(req: RestRequest) {
  const start = Date.now()
  const insecure = req.insecure === true
  const protocol = req.protocol || 'auto'

  try {
    const parsedUrl = new URL(req.url)
    const isHttps = parsedUrl.protocol === 'https:'

    // Handle HTTP/2
    if (protocol === 'http2') {
      return await new Promise((resolve, reject) => {
        if (req.abortSignal?.aborted) {
          return reject(new DOMException('Request aborted', 'AbortError'))
        }

        const client = http2.connect(parsedUrl.origin, {
          rejectUnauthorized: !insecure,
        })

        client.on('error', (err) => {
          client.destroy()
          reject(err)
        })

        const headers = {
          ...req.headers,
          ':method': req.method,
          ':path': parsedUrl.pathname + parsedUrl.search,
        }

        // Node http2 module requires special handling for pseudo-headers and case sensitivity
        // Remove any headers that might conflict or are invalid in H2
        delete (headers as any)['host']
        delete (headers as any)['connection']
        delete (headers as any)['upgrade']
        delete (headers as any)['keep-alive']
        delete (headers as any)['proxy-connection']
        delete (headers as any)['transfer-encoding']

        const request = client.request(headers)
        const chunks: Buffer[] = []
        let responseStatus = 0
        let responseHeaders: Record<string, string> = {}

        const abortHandler = () => {
          request.destroy(new DOMException('Request aborted', 'AbortError'))
          client.destroy()
          reject(new DOMException('Request aborted', 'AbortError'))
        }
        req.abortSignal?.addEventListener('abort', abortHandler)

        request.on('response', (headers) => {
          responseStatus = Number(headers[':status']) || 0
          for (const [key, val] of Object.entries(headers)) {
            if (key.startsWith(':')) continue
            responseHeaders[key] = Array.isArray(val) ? val.join(', ') : val || ''
          }
        })

        request.on('data', (chunk: Buffer) => chunks.push(chunk))
        request.on('end', () => {
          req.abortSignal?.removeEventListener('abort', abortHandler)
          const body = Buffer.concat(chunks).toString('utf-8')
          const time = Date.now() - start
          client.close()
          resolve({
            success: true,
            data: {
              status: responseStatus,
              statusText: '', // H2 doesn't have status text
              headers: responseHeaders,
              body,
              type: 'REST' as const,
              time,
              size: Buffer.byteLength(body, 'utf-8'),
            },
          })
        })

        request.on('error', (err) => {
          req.abortSignal?.removeEventListener('abort', abortHandler)
          client.destroy()
          reject(err)
        })

        if (req.body && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
          request.write(req.body)
        }

        const timeout = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : 60000
        request.setTimeout(timeout, () => {
          request.destroy(new Error(`Request timed out after ${timeout}ms`))
          client.destroy()
        })

        request.end()
      }).catch((err: any) => ({
        success: false,
        error: err.message || 'Unknown HTTP/2 error',
        time: Date.now() - start,
      }))
    }

    // Handle HTTP/1.1 (or default)
    if (req.abortSignal?.aborted) {
      return { success: false, error: 'Request aborted', time: Date.now() - start }
    }
    const transport = isHttps ? https : http
    const result = await new Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string }>((resolve, reject) => {
      const options: any = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method,
        headers: req.headers,
        rejectUnauthorized: !insecure, // Respect environment setting
        agent: false, // Disable connection pooling to allow clean exit
      }

      const request = transport.request(options as any, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          req.abortSignal?.removeEventListener('abort', abortHandler)
          const body = Buffer.concat(chunks).toString('utf-8')
          const headers: Record<string, string> = {}
          for (const [key, val] of Object.entries(response.headers)) {
            headers[key] = Array.isArray(val) ? val.join(', ') : val || ''
          }
          resolve({
            status: response.statusCode || 0,
            statusText: response.statusMessage || '',
            headers,
            body,
          })
        })
        response.on('error', (err) => {
          req.abortSignal?.removeEventListener('abort', abortHandler)
          reject(err)
        })
      })

      const abortHandler = () => {
        request.destroy(new Error('Request aborted'))
        reject(new Error('Request aborted'))
      }
      req.abortSignal?.addEventListener('abort', abortHandler)

      request.on('error', (err) => {
        req.abortSignal?.removeEventListener('abort', abortHandler)
        reject(err)
      })

      if (req.body && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
        request.write(req.body)
      }

      const timeout = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : 60000
      request.setTimeout(timeout, () => {
        request.destroy(new Error(`Request timed out after ${timeout}ms`))
      })

      request.end()
    })

    const time = Date.now() - start
    return {
      success: true,
      data: {
        ...result,
        type: 'REST' as const,
        time,
        size: Buffer.byteLength(result.body, 'utf-8'),
      },
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Unknown error',
      time: Date.now() - start,
    }
  }
}

export function registerRestHandlers() {
  ipcMain.handle('rest:send', async (_event, req: RestRequest) => {
    return handleRestRequest(req)
  })
}
