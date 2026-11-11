import { createServer, request as httpRequest } from 'node:http';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const listenPort = Number(process.env.PROXY_PORT || 8791);
const targetHost = process.env.PROXY_TARGET_HOST || '127.0.0.1';
const targetPort = Number(process.env.PROXY_TARGET_PORT || 8790);
const logPath = process.env.PROXY_LOG || 'tools/verify/.proxy-requests.jsonl';
mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, '');

function log(entry) { appendFileSync(logPath, JSON.stringify(entry) + '\n'); }

const server = createServer((req, res) => {
  const started = Date.now();
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers };
    const entry = {
      at: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers,
      bodyPreview: body.toString('utf8').slice(0, 2000),
      bodyBytes: body.length,
    };
    const upstream = httpRequest({
      host: targetHost,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: { ...headers, host: targetHost + ':' + targetPort },
    }, (up) => {
      entry.status = up.statusCode;
      entry.responseHeaders = up.headers;
      const responseChunks = [];
      let responseBytes = 0;
      up.on('data', (chunk) => {
        responseBytes += chunk.length;
        if (responseChunks.length < 64 && responseBytes <= 4000) responseChunks.push(chunk);
      });
      up.on('end', () => {
        entry.responseBytes = responseBytes;
        entry.responseBodyPreview = Buffer.concat(responseChunks).toString('utf8').slice(0, 4000);
        log(entry);
      });
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (error) => {
      entry.error = String(error && error.message ? error.message : error);
      log(entry);
      if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); }
      res.end(JSON.stringify({ error: { code: 'internal', message: 'proxy: ' + entry.error } }));
    });
    if (body.length > 0) upstream.write(body);
    upstream.end();
    res.on('close', () => { if (entry.status === undefined) { entry.abortedAt = new Date().toISOString(); log(entry); } });
  });
});
server.listen(listenPort, '127.0.0.1', () => console.log('PROXY_READY http://127.0.0.1:' + listenPort + ' -> ' + targetHost + ':' + targetPort + ' log=' + logPath));
