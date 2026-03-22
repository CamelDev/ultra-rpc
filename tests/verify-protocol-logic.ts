import http from 'http';
import https from 'https';
import http2 from 'http2';
import { URL } from 'url';

async function sendRequest(req: any) {
    const start = Date.now();
    const { method, url, headers, body, insecure, protocol } = req;
    const parsedUrl = new URL(url);

    if (protocol === 'http2') {
        return new Promise((resolve, reject) => {
            const client = http2.connect(parsedUrl.origin, {
                rejectUnauthorized: !insecure,
            });

            client.on('error', reject);

            const h2Headers = {
                ...headers,
                ':method': method,
                ':path': parsedUrl.pathname + parsedUrl.search,
            };
            delete h2Headers['host'];
            delete h2Headers['connection'];

            const request = client.request(h2Headers);
            const chunks: any[] = [];
            let responseHeaders: any = {};

            request.on('response', (h) => {
                responseHeaders = h;
            });
            request.on('data', (chunk) => chunks.push(chunk));
            request.on('end', () => {
                const resBody = Buffer.concat(chunks).toString();
                client.close();
                resolve({
                    protocol: 'HTTP/2',
                    status: responseHeaders[':status'],
                    headers: responseHeaders,
                    body: resBody
                });
            });
            if (body) request.write(body);
            request.end();
        });
    } else {
        const transport = parsedUrl.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) => {
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + parsedUrl.search,
                method,
                headers,
                rejectUnauthorized: !insecure,
            };
            const request = transport.request(options, (res) => {
                const chunks: any[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        protocol: 'HTTP/1.1',
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString()
                    });
                });
            });
            request.on('error', reject);
            if (body) request.write(body);
            request.end();
        });
    }
}

async function runTests() {
    const testUrl = 'https://localhost:3443/data';
    console.log('--- Testing HTTP/1.1 selection ---');
    try {
        const res1 = await sendRequest({
            method: 'GET',
            url: testUrl,
            insecure: true,
            protocol: 'http1'
        }) as any;
        console.log('Detected Protocol:', res1.headers['x-protocol-used'] || 'Unknown');
        console.log('Response Body:', res1.body);
    } catch (e: any) {
        console.error('HTTP/1.1 Test Failed:', e.message);
    }

    console.log('\n--- Testing HTTP/2 selection ---');
    try {
        const res2 = await sendRequest({
            method: 'GET',
            url: testUrl,
            insecure: true,
            protocol: 'http2'
        }) as any;
        console.log('Detected Protocol:', res2.headers['x-protocol-used'] || 'Unknown');
        console.log('Response Body:', res2.body);
    } catch (e: any) {
        console.error('HTTP/2 Test Failed:', e.message);
    }
}

runTests();
