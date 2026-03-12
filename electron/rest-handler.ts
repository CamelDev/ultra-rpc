import { ipcMain } from 'electron'
import http from 'http'
import https from 'https'
import { URL } from 'url'

interface RestRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export function registerRestHandlers() {
  ipcMain.handle('rest:send', async (_event, req: RestRequest) => {
    const start = Date.now()

    try {
      const parsedUrl = new URL(req.url)
      const isHttps = parsedUrl.protocol === 'https:'
      const transport = isHttps ? https : http

      const result = await new Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string }>((resolve, reject) => {
        const options: http.RequestOptions = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: req.method,
          headers: req.headers,
        }

        const request = transport.request(options, (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
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
          response.on('error', reject)
        })

        request.on('error', reject)

        if (req.body && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
          request.write(req.body)
        }
        request.end()
      })

      const time = Date.now() - start
      return {
        success: true,
        data: {
          ...result,
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
  })
}
