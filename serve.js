// Piccolo server locale per provare l'app: node serve.js  ->  http://localhost:8080
const http = require('http'), fs = require('fs'), path = require('path');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(__dirname, path.normalize(p));
  if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Non trovato'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8080, () => console.log('MyNbaPrediction su http://localhost:8080'));
