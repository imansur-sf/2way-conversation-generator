const http = require('node:http');
const { createReadStream, stat } = require('node:fs');
const path = require('node:path');

const port = Number(process.env.PORT) || 3000;
const root = __dirname;
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function sendFile(file, response) {
  stat(file, (error, details) => {
    if (error || !details.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600'
    });
    createReadStream(file).pipe(response);
  });
}

http.createServer((request, response) => {
  const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;
  const relativePath = requestPath === '/' ? 'interactive-simulator-builder.html' : decodeURIComponent(requestPath).replace(/^\/+/, '');
  const file = path.resolve(root, relativePath);

  if (!file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Invalid path');
    return;
  }

  sendFile(file, response);
}).listen(port, () => {
  console.log(`Two-Way Experience Studio is running on port ${port}`);
});
