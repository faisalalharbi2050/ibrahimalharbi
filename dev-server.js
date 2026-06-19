const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const host = '127.0.0.1';
const requestedPort = Number(process.env.PORT || 4173);
let port = requestedPort;
const watched = ['site/index.html', 'admin/index.html', 'package.json', 'dev-server.js'];

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

function version() {
  return String(Math.max(...watched.map(file => {
    try {
      return fs.statSync(path.join(root, file)).mtimeMs;
    } catch {
      return 0;
    }
  })));
}

function liveReloadSnippet() {
  return `<script>
(() => {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;
  let current = '';
  async function check() {
    try {
      const next = await fetch('/__version', { cache: 'no-store' }).then(r => r.text());
      if (!current) current = next;
      else if (next !== current) location.reload();
    } catch {}
  }
  setInterval(check, 900);
  check();
})();
</script>`;
}

function injectLiveReload(html) {
  const closeTag = '</body>';
  const idx = html.toLowerCase().lastIndexOf(closeTag);
  if (idx === -1) return html + liveReloadSnippet();
  return html.slice(0, idx) + liveReloadSnippet() + html.slice(idx);
}

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const target = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  if (target === 'admin') return path.resolve(root, 'admin/index.html');
  if (target.startsWith('admin/')) return path.resolve(root, target);
  const resolved = path.resolve(root, 'site', target);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/__version')) {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(version());
    return;
  }

  const file = safePath(req.url);
  if (!file) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    let body = data;
    if (ext === '.html') {
      body = Buffer.from(injectLiveReload(data.toString('utf8')));
    }
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  });
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE' && !process.env.PORT && port < requestedPort + 20) {
    port += 1;
    server.listen(port, host);
    return;
  }
  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`http://${host}:${port}/`);
});
