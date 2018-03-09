
const express = require('express')
const app = express()

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost');
    next();
});

app.use('/', express.static(__dirname));

app.listen(3000)

// var http = require('http');
// http.createServer(function (req, res) {
//   res.writeHead(200, {'Content-Type': 'text/plain'});
//   setTimeout(function() {
//     res.end('Hello World\n');
//   }, 65000);
  
// }).listen(3000, "localhost");


console.log('Running at http://localhost:3000/');