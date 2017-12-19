# mininet

> Spin up and interact with virtual networks using
> [Mininet](http://mininet.org/) and Node.js

```
npm install mininet
```

## Usage

``` js
var mininet = require('mininet')

var mn = mininet()

// create a switch
var s1 = mn.createSwitch()

// create some hosts
var h1 = mn.createHost()
var h2 = mn.createHost()

// link them to the switch
h1.link(s1)
h2.link(s1)

// run a server in node
h1.spawn('node server.js')

h1.on('message:listening', function () {
  // when h1 signals it is listening, run curl
  h2.spawn('curl --silent ' + h1.ip + ':10000')
})

h1.on('stdout', function (data) {
  process.stdout.write('h1 ' + data)
})

h2.on('stdout', function (data) {
  process.stdout.write('h2 ' + data)
  mn.destroy() // stop when h2 messages
})
```

Assuming server.js looks like this

``` js
var http = require('http')
var mn = require('mininet/host')

var server = http.createServer(function (req, res) {
  console.log('Server responding')
  res.end('hello from server\n')
})

server.listen(10000, function () {
  console.log('Server listening on', this.address().port)
  mn.send('listening') // msg the host
})
```

## License

MIT
