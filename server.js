var http = require('http')

var server = http.createServer(function (req, res) {
  res.end('Hello, World!\n')
})

server.listen(10000, function () {
  console.log('Server is listening on %d', server.address().port)
})

process.on('exit', function () {
  console.log('onexit')
})

process.on('SIGINT', function () {
  console.log('onsigint')
  process.exit(1)
})

process.on('SIGTERM', function () {
  console.log('onsigterm')
  process.exit(1)
})
