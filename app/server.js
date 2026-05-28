const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Hello from Node.js app!');
}).listen(3000);
