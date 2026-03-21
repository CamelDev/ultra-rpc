import http from 'http';
import https from 'https';

export interface HttpsOptions {
  key: string;
  cert: string;
}

export class MockRestServer {
  private server: http.Server | https.Server | null = null;
  private port: number;
  private httpsOptions?: HttpsOptions;

  constructor(port: number = 3000, httpsOptions?: HttpsOptions) {
    this.port = port;
    this.httpsOptions = httpsOptions;
  }

  start(): Promise<number> {
    return new Promise((resolve) => {
      const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
        // Log for debugging
        console.log(`[MockServer] ${req.method} ${req.url}`);

        if (req.url === '/data' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'success',
            message: 'Hello from mock server!',
            timestamp: new Date().toISOString()
          }));
          return;
        }

        if (req.url === '/headers') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            headers: req.headers,
            method: req.method
          }));
          return;
        }

        if (req.url === '/echo' && (req.method === 'POST' || req.method === 'PUT')) {
          let body = '';
          req.on('data', chunk => body += chunk.toString());
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              echoed: body.startsWith('{') ? JSON.parse(body) : body,
              headers: req.headers,
              received_at: new Date().toISOString()
            }));
          });
          return;
        }

        if (req.url === '/method-test') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            method: req.method,
            success: true
          }));
          return;
        }

        if (req.url?.startsWith('/slow')) {
          const url = new URL(req.url, 'http://localhost');
          const delay = parseInt(url.searchParams.get('delay') || '2000');
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, delayed: delay }));
          }, delay);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      };

      if (this.httpsOptions) {
        this.server = https.createServer(this.httpsOptions, handler);
      } else {
        this.server = http.createServer(handler);
      }

      this.server.on('error', (err) => {
        console.error(`[MockServer] Server error on port ${this.port}:`, err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address && typeof address === 'object' && 'port' in address) {
          this.port = address.port; // Update port if 0 was used
        }
        const protocol = this.httpsOptions ? 'https' : 'http';
        console.log(`[MockServer] Running at ${protocol}://127.0.0.1:${this.port}`);
        resolve(this.port); // Resolve with the actual port
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        // Force close all active connections
        if (typeof (this.server as any).closeAllConnections === 'function') {
          (this.server as any).closeAllConnections();
        }
        
        this.server.close((err) => {
          if (err) return reject(err);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getPort(): number {
    return this.port;
  }

  get url() {
    const protocol = this.httpsOptions ? 'https' : 'http';
    return `${protocol}://127.0.0.1:${this.port}`;
  }
}
