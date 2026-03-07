const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const API_KEY = process.env.FINGRID_API_KEY || '48e32957c4f84f5faaacb1ecf357bd62';
const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Proxy API requests to Fingrid
  if (parsed.pathname.startsWith('/api/')) {
    const fingridUrl = `https://data.fingrid.fi${req.url}`;
    console.log(`Proxying: ${fingridUrl}`);

    https.get(fingridUrl, { headers: { 'x-api-key': API_KEY } }, (fingridRes) => {
      res.writeHead(fingridRes.statusCode, { 'Content-Type': 'application/json' });
      fingridRes.pipe(res);
    }).on('error', (err) => {
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // Serve the dashboard for all other routes
  const htmlPath = path.join(__dirname, 'index.html');
  fs.readFile(htmlPath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Suomi Energy Grid running on port ${PORT}`);
});
