/**
 * Simple Node.js proxy that polls a remote URL and exposes a Server-Sent Events
 * stream at /sse?url=<encoded_remote_url>&interval=200
 *
 * Purpose: bypass CORS when the remote site (e.g., dataview.raspberryshake.org) blocks client-side requests.
 *
 * Usage:
 *   1. Install dependencies:
 *        npm init -y
 *        npm install express node-fetch@2 cors
 *
 *   2. Run:
 *        node server.js
 *
 *   3. Open the web page and use:
 *        http://localhost:3000/sse?url=<ENCODED_REMOTE_URL>&interval=200
 *
 * This proxy performs simple polling and extracts numbers from the remote response text using a regex.
 * You should adapt the parser function if the remote endpoint returns structured JSON/HDF or needs authentication.
 */

const express = require('express');
const fetch = require('node-fetch'); // v2
const cors = require('cors');
const { URL } = require('url');

const app = express();
app.use(cors()); // allow requests from localhost page
const PORT = process.env.PORT || 3000;

function parseTextToNumbers(text) {
  // Extract floats from arbitrary text (basic method).
  // Modify this to suit the remote data format.
  const re = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(parseFloat(m[0]));
  }
  return out;
}

app.get('/sse', async (req, res) => {
  const remote = req.query.url;
  if (!remote) {
    res.status(400).send('Missing url parameter. Example: /sse?url=https://example.com/data');
    return;
  }
  let interval = parseInt(req.query.interval) || 200;
  // Basic validation
  try {
    new URL(remote);
  } catch (err) {
    res.status(400).send('Invalid url parameter');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  let stopped = false;
  req.on('close', () => {
    stopped = true;
  });

  // Poll loop
  async function pollLoop() {
    while (!stopped) {
      try {
        const r = await fetch(remote, { timeout: 5000 });
        if (!r.ok) {
          // send an SSE comment to indicate non-OK
          res.write(`: remote status ${r.status}\\n\\n`);
        } else {
          const ct = r.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await r.json();
            // Basic attempt: if it's an array, send it; otherwise stringify and parse numbers
            if (Array.isArray(j)) {
              res.write(`data: ${JSON.stringify(j)}\\n\\n`);
            } else if (j.samples && Array.isArray(j.samples)) {
              res.write(`data: ${JSON.stringify(j.samples)}\\n\\n`);
            } else {
              const num = parseTextToNumbers(JSON.stringify(j));
              res.write(`data: ${JSON.stringify(num)}\\n\\n`);
            }
          } else {
            const txt = await r.text();
            const nums = parseTextToNumbers(txt);
            // If no numbers extracted, forward raw text as base64 (client can adapt)
            if (nums.length === 0) {
              const b64 = Buffer.from(txt).toString('base64');
              res.write(`data: {"b64": "${b64}"}\\n\\n`);
            } else {
              res.write(`data: ${JSON.stringify(nums)}\\n\\n`);
            }
          }
        }
      } catch (err) {
        console.error('Poll error', err && err.message);
        res.write(`: poll error ${err && err.message}\\n\\n`);
      }
      // sleep for interval ms or exit earlier if stopped
      const start = Date.now();
      while (!stopped && Date.now() - start < interval) {
        await new Promise(r => setTimeout(r, 50));
      }
    }
    try { res.end(); } catch(e) {}
  }

  pollLoop();
});

app.get('/', (req, res) => {
  res.send('SSE proxy. Use /sse?url=<remote>&interval=200');
});

app.listen(PORT, () => {
  console.log(`SSE proxy listening on http://localhost:${PORT}`);
});