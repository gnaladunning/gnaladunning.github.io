/**
 * server.js
 * Simple local development proxy for CORS and SSE.
 *
 * Endpoints:
 *  - GET /proxy?url=<targetUrl>  -> forwards a GET request and streams response (adds CORS)
 *  - GET /sse?url=<targetUrl>    -> opens a long-lived request to target and relays SSE chunks
 *
 * Usage:
 *   npm install
 *   node server.js
 *
 * Notes:
 * - Node 18+ recommended (global fetch available). If using older Node, install node-fetch.
 * - This is intended for local development only. Do NOT expose publicly without auth/rate-limiting.
 */

import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Optional allowlist: comma-separated hostnames (no protocol). If empty, allow all.
const ALLOWED_HOSTS = process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',').map(s => s.trim()).filter(Boolean) : [];

// Simple check to prevent open proxy abuse
function isHostAllowed(targetUrl) {
  if (!ALLOWED_HOSTS || ALLOWED_HOSTS.length === 0) return true;
  try {
    const u = new URL(targetUrl);
    return ALLOWED_HOSTS.includes(u.hostname);
  } catch (e) {
    return false;
  }
}

// Dev-friendly CORS for local usage
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Health
app.get('/ping', (req, res) => res.send('ok'));

// Generic proxy: GET and stream response
app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('missing url query param');
  if (!isHostAllowed(target)) return res.status(403).send('host not allowed');

  try {
    const remote = await fetch(target, { method: 'GET', cache: 'no-store' });

    // Forward status and a safe subset of headers
    res.status(remote.status);
    const hopByHop = new Set([
      'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
      'te', 'trailers', 'transfer-encoding', 'upgrade'
    ]);
    remote.headers.forEach((v, k) => {
      if (!hopByHop.has(k.toLowerCase())) res.setHeader(k, v);
    });

    // Ensure browser can read it and disable caching
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    // If no streaming body, send text
    if (!remote.body) {
      const t = await remote.text();
      res.send(t);
      return;
    }

    // Pipe readable stream to express response.
    // In Node 18+, remote.body is a WHATWG ReadableStream; convert to Node stream.
    const reader = remote.body.getReader();

    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.writableEnded) res.write(Buffer.from(value));
          else break;
        }
      } catch (err) {
        console.error('proxy pump error', err);
      } finally {
        try { res.end(); } catch (_) {}
      }
    };
    pump();

    // If client disconnects, cancel reading remote
    req.on('close', () => {
      try { reader.cancel(); } catch (_) {}
    });
  } catch (err) {
    console.error('proxy error', err);
    res.status(502).send('bad gateway: ' + String(err));
  }
});

// SSE proxy: keep connection open and forward chunks raw
app.get('/sse', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('missing url query param');
  if (!isHostAllowed(target)) return res.status(403).send('host not allowed');

  try {
    const remote = await fetch(target, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      // If the target requires cookies/auth, you can pass credentials here (careful).
    });

    if (!remote.ok) {
      res.status(remote.status);
      const txt = await remote.text();
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(txt);
      return;
    }

    // Relay SSE headers to client
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!remote.body) {
      res.end();
      return;
    }

    const reader = remote.body.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.writableEnded) {
            res.write(Buffer.from(value));
          } else break;
        }
      } catch (err) {
        console.error('sse pump error', err);
      } finally {
        try { res.end(); } catch (_) {}
      }
    };
    pump();

    req.on('close', () => {
      try { reader.cancel(); } catch (_) {}
    });
  } catch (err) {
    console.error('sse error', err);
    res.status(502).send('bad gateway: ' + String(err));
  }
});

app.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT}`);
  if (ALLOWED_HOSTS.length) console.log('Allowed hosts:', ALLOWED_HOSTS.join(', '));
});
````markdown name=README.md
```markdown
# Local dev proxy for gnaladunning.github.io

This repository includes a small local proxy (server.js) used during development to:
- Add CORS headers for cross-origin fetches
- Expose remote SSE (text/event-stream) to browsers via a localhost endpoint
- Avoid mixed-content issues when your page is served over HTTPS (localhost is a secure context)

Quickstart
1. Ensure Node 18+ is installed.
2. From the repository root:
   npm install
3. Start the proxy:
   node server.js
4. Example usage from your page:
   - SSE (forwarded): `http://localhost:3000/sse?url=http://rs.local/sse`
   - Generic fetch: `http://localhost:3000/proxy?url=http://rs.local/data.json`

Security notes
- This proxy is intended for local development only. Do NOT run it exposed to the internet without adding authentication, logging, and rate limiting.
- To limit which hosts can be proxied, set the ALLOWED_HOSTS environment variable to a comma-separated list of hostnames:
  ALLOWED_HOSTS=rs.local,node.example.com node server.js
- If you need HTTPS on the proxy, put it behind a reverse proxy that terminates TLS or generate a local certificate (mkcert) and run an HTTPS server.

Files added
- server.js — proxy implementation (requires package.json already added)
- package.json — defines dependency on express (already added to repo)
- README.md — this file
