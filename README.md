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

// start the network
mn.start()

// run a server in node
var proc = h1.spawn('node server.js')

proc.on('message:listening', function () {
  // when h1 signals it is listening, run curl
  var proc2 = h2.spawn('curl --silent ' + h1.ip + ':10000')

  proc2.on('stdout', function (data) {
    process.stdout.write('h2 ' + data)
    mn.stop() // stop when h2 messages
  })
})

proc.on('stdout', function (data) {
  process.stdout.write('h1 ' + data)
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

## API

#### `var mn = mininet([options])`

Create a new mininet instance. Options include

``` js
{
  clean: false,         // if true run mn -c first
  sudo: true,           // use sudo if needed 
  sock: '/tmp/mn.sock', // explictly set the .sock file used
  debug: false,         // set to true to enable debug output
  stdio: null,          // passed to host.spawn as a default option
  prefixStdio: false    // passed to host.spawn as a default option
}
```

If for some reason your mininet instance stops working
you probably wanna try using `clean: true`.

#### `mn.start([callback])`

Start the mininet network. Usually you call this
after defining your hosts, switches and links.

After the network has fully started `start` is emitted.

#### `mn.stop([callback])`

Stop the mininet network. You should not call
any other methods after this.

After the network has fully stopped `stop` is emitted.

#### `mn.switches`

Array of all created switches.

#### `mn.hosts`

Array of all created hosts.

#### `var sw = mn.createSwitch()`

Create a new switch

#### `sw.link(other, [options])`

Link the switch with another switch or host.
Options include:

``` js
{
  bandwidth: 10,  // use 10mbit link
  delay: '100ms', // 100ms delay
  loss: 10,       // 10% package loss
  htb: true       // use htb
}
```

#### `var host = mn.createHost()`

Create an new host

#### `host.ip`

The IP address of the host. Populated after the network is started.

#### `host.mac`

The MAC address of the host. Populated after the network is started.

#### `host.link(other, [options])`

Link the host with another host or switch.
Takes the same options as `sw.link`.

#### `host.exec(cmd, [callback])`

Execute a command and buffer the output and return it in the callback.

#### `var proc = host.spawn(cmd, [options])`

Spawn a new process to run the in background of the host.
Options include:

``` js
{
  stdio: 'inherit', // set this to forward stdio
  prefixStdio: 'some-prefix' // all stdio is prefixed with this
}
```

If you set `prefixStdio: true` it will be converted to `{host.id}.{process.id}`.
When debugging it can be useful to set both `{stdio: 'inherit', prefixStdio: true}`.

#### `var proc = host.spawnNode(programSource, [options])`

Helper that spawns a Node.js source inside the host. Useful when using multiline strings

``` js
host.spawnNode(`
  console.log('starting timer...')
  setInterval(() => console.log('Time is', Date.now()))
`, {
  stdio: 'inherit',
  prefixStdio: true
})
```

#### `proc.id`

Unique string id of the process

#### `proc.kill([signal])`

Kill the process.

#### `proc.send(type, data)`

Send a message to the process.

#### `proc.on('stdout', data)`

Emitted when the process has output.

#### `proc.on('message', type, data)`

Emitted when the process received a message.

#### `proc.on('message:{type}', data)`

Same as above but with the type as part of the event name
for convenience.

#### `proc.on('exit')`

Emitted when the process exits.

## Messaging

If you are spawning a node process you can require `mininet/host`
to communicate with the host.

#### `var host = require('mininet/host')`

Require this in a spawned process.

#### `host.send(type, data)`

Send a message to the host.

#### `host.sendTo(processId, type, data)`

Send a message to another process.

#### `host.broadcast(type, data)`

Send a message to all processes.

#### `host.on('message', type, data, metadata)`

Emitted when a message is received from the host.
The metadata argument contains the following data

``` js
{
  from: 'some-process-id-or-host' // who sent this message
}
```

#### `host.on('message:{type}', data, metadata)`

Same as above but with the type as part of the event name
for convenience.

## License

MIT
