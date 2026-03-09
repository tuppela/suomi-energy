const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const API_KEY = process.env.FINGRID_API_KEY;
const PORT = process.env.PORT || 3001;
const CACHE_TTL = 5 * 60 * 1000;
const FETCH_INTERVAL = 5 * 60 * 1000;
const DATASET_IDS = [193, 74, 188, 75, 191, 248, 201, 202, 194, 87, 89, 90];
const DELAY_MS = 7000;

const cache = {
  data: {},
  updatedAt: null,
  fetching: false,
};

function fetchFromFingrid(datasetId, start, end) {
  return new Promise((resolve, reject) => {
    const query = `startTime=${start}&endTime=${end}&pageSize=5000&sortOrder=asc`;
    const fingridUrl = `https://data.fingrid.fi/api/datasets/${datasetId}/data?${query}`;

    https.get(fingridUrl, { headers: { 'x-api-key': API_KEY } }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 429) {
          reject(new Error(`Rate limited on dataset ${datasetId}`));
          return;
        }
        try {
          const json = JSON.parse(body);
          resolve((json.data || []).map(d => ({ t: d.startTime, v: d.value })));
        } catch (e) {
          reject(new Error(`Parse error on dataset ${datasetId}`));
        }
      });
    }).on('error', reject);
  });
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function refreshCache() {
  if (cache.fetching) return;
  cache.fetching = true;

  const now = new Date();
  const end = now.toISOString().replace('.000', '');
  const start = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString().replace('.000', '');

  console.log(`[${new Date().toLocaleTimeString()}] Refreshing cache...`);

  for (let i = 0; i < DATASET_IDS.length; i++) {
    const id = DATASET_IDS[i];
    try {
      cache.data[id] = await fetchFromFingrid(id, start, end);
      console.log(`  Dataset ${id}: ${cache.data[id].length} records`);
    } catch (err) {
      console.error(`  Dataset ${id} failed: ${err.message}`);
    }
    if (i < DATASET_IDS.length - 1) await delay(DELAY_MS);
  }

  cache.updatedAt = new Date();
  cache.fetching = false;
  console.log(`Cache refreshed at ${cache.updatedAt.toLocaleTimeString()}`);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (parsed.pathname === '/cache-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      updatedAt: cache.updatedAt,
      fetching: cache.fetching,
      datasets: Object.fromEntries(DATASET_IDS.map(id => [id, cache.data[id]?.length ?? 0]))
    }));
    return;
  }

  const match = parsed.pathname.match(/^\/api\/datasets\/(\d+)\/data$/);
  if (match) {
    const id = parseInt(match[1]);
    if (!DATASET_IDS.includes(id)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Dataset not available' }));
      return;
    }
    if (!cache.data[id]) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cache warming up, try again in a moment' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Cache-Updated': cache.updatedAt?.toISOString() || 'unknown',
    });
    res.end(JSON.stringify({ data: cache.data[id].map(d => ({ startTime: d.t, value: d.v })) }));
    return;
  }

  const htmlPath = path.join(__dirname, 'index.html');
  fs.readFile(htmlPath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

server.listen(PORT, async () => {
  console.log(`Suomi Energy Grid running on port ${PORT}`);
  await refreshCache();
  setInterval(refreshCache, FETCH_INTERVAL);
});
