var proc = require('child_process')
var split = require('split2')
var net = require('net')
var fs = require('fs')
var path = require('path')
var util = require('util')
var events = require('events')
var pump = require('pump')
var ndjson = require('ndjson')
var os = require('os')

module.exports = Mininet

function Switch (index) {
  this.index = index
  this.id = 's' + (this.index + 1)
  this.links = []
}

Switch.prototype.link = function (to) {
  this.links.push(to)
  return to
}

function Host (index, mn) {
  events.EventEmitter.call(this)

  this.index = index
  this.id = 'h' + (this.index + 1)
  this.ip = null
  this.mac = null
  this.links = []

  this._cmd = null
  this._mn = mn
  this._input = ndjson.stringify()
  this._output = ndjson.parse()

  var self = this

  this._output.on('data', function (data) {
    self.emit('message', data.name, data.data)
    self.emit('message:' + data.name, data.data)
  })
}

util.inherits(Host, events.EventEmitter)

Host.prototype.spawn = function (cmd, onspawn) {
  if (onspawn) this.once('spawn', onspawn)

  this._cmd = Array.isArray(cmd) ? cmd.map(stringify).join(' ') : cmd
  this._mn.start()

  var echo = 'stdio ' + this.index
  while (echo.length < 31) echo += ' '

  var sock = JSON.stringify(this._mn._sock)
  var env = 'MN_INDEX=' + this.index + ' MN_SOCK=' + sock
  var inner = '(echo "' + echo + '" && ' + env + ' ' + this._cmd + ')'
  var forked = '(' + inner + ' 2>&1 | nc -U ' + this._mn._sock + ') &'
  var inp = 'v = net.hosts[' + this.index + '].cmd(' + JSON.stringify(forked) + ')\n'

  this._mn._python.stdin.write(inp)
}

Host.prototype.link = function (to) {
  this.links.push(to)
  return to
}

Host.prototype.send = function (name, data) {
  this._input.write({name: name, data: data})
}

Host.prototype._onrpc = function (socket) {
  pump(this._input, socket, this._output)
}

Host.prototype._onspawn = function (socket) {
  var self = this

  socket.on('data', function (data) {
    self.emit('stdout', data)
  })

  socket.on('close', function () {
    self.emit('close')
  })

  this.emit('spawn')
}

function Mininet (opts) {
  if (!(this instanceof Mininet)) return new Mininet(opts)
  if (!opts) opts = {}

  events.EventEmitter.call(this)

  this._python = null
  this._sock = opts.sock || path.join(os.tmpdir(), 'mn.' + Math.random() + 'sock')
  this._args = ['python', '-i']

  if (opts.clean) {
    this._args.unshift(path.join(__dirname, 'clean.sh'))
  }

  if (opts.sudo || (opts.sudo !== false && process.getuid())) {
    this._args.unshift('sudo')
  }

  this.switches = []
  this.hosts = []
  this.started = false
  this.stopped = false
}

util.inherits(Mininet, events.EventEmitter)

Mininet.prototype.createSwitch = function () {
  if (this.started) throw new Error('Cannot create a switch after start')
  var sw = new Switch(this.switches.length, this)
  this.switches.push(sw)
  return sw
}

Mininet.prototype.createHost = function () {
  if (this.started) throw new Error('Cannot create a host after start')
  var host = new Host(this.hosts.length, this)
  this.hosts.push(host)
  return host
}

Mininet.prototype.start = function () {
  if (this.started) return
  this.started = true

  this._startServer()

  this._python = proc.spawn(this._args.shift(), this._args)
  this._python.stdout.pipe(split()).on('data', this._parse.bind(this))
  // this._python.stderr.pipe(process.stderr)
  this._python.stderr.resume()
  this._python.stdin.write(
    'from mininet.topo import Topo\n' +
    'from mininet.net import Mininet\n' +
    'from mininet.node import findController\n' +
    'from mininet.node import OVSBridge\n' +
    'def print_host(h):\n' +
    '  print "print_host", h.name, h.IP(), h.MAC()\n' +
    '\n'
  )
  this._python.stdin.write(this._generateTopology())
  this._python.stdin.write(
    'topo = GeneratedTopo()\n' +
    'net = Mininet(topo, controller=findController(), switch=OVSBridge)\n' +
    'for h in net.hosts:\n' +
    '  print_host(h)\n' +
    '\n' +
    'net.start()\n' +
    'print "ready"\n'
  )
}

Mininet.prototype._startServer = function () {
  var self = this
  fs.unlink(this._sock, function () {
    if (self.stopped) return

    var server = net.createServer(function (socket) {
      socket.on('error', function () {
        socket.destroy()
      })

      socket.once('readable', function parse () {
        var handshake = socket.read(32)
        if (!handshake) return socket.once('readable', parse)
        handshake = handshake.toString().trim().split(' ')

        var index = Number(handshake[1])
        var host = self.hosts[index]
        if (!host) return socket.destroy()

        socket.unref()

        switch (handshake[0]) {
          case 'stdio': return host._onspawn(socket)
          case 'rpc': return host._onrpc(socket)
        }

        socket.destroy()
      })
    })

    self._server = server
    server.unref()
    server.listen(self._sock)
  })
}

Mininet.prototype.destroy =
Mininet.prototype.stop = function () {
  if (this.stopped) return
  this.stopped = true
  if (this._server) this._server.close()
  fs.unlink(this._sock, noop)
  this._python.stdin.write('net.stop()\n')
  this._python.stdin.end()
}

Mininet.prototype._parse = function (line) {
  var parts = line.split(' ')
  var type = parts[0]

  switch (type) {
    case 'print_host': return this._onhost(parts)
    case 'ready': return this.emit('start')
  }

  this.emit('unknown-output', line)
}

Mininet.prototype._onhost = function (parts) {
  var id = parts[1]
  var index = Number(id.slice(1)) - 1
  var host = this.hosts[index]

  host.ip = parts[2]
  host.mac = parts[3]
  host.emit('ip')
}

Mininet.prototype._generateTopology = function () {
  var str = 'class GeneratedTopo(Topo):\n'
  str += '  def build(self):\n'
  this.switches.forEach(declare('addSwitch'))
  this.hosts.forEach(declare('addHost'))
  this.switches.forEach(link)
  this.hosts.forEach(link)
  return str + '\n'

  function declare (method) {
    return function (n) {
      str += '    ' + n.id + ' = self.' + method + '("' + n.id + '")\n'
    }
  }

  function link (n) {
    n.links.forEach(function (l) {
      str += '    self.addLink(' + n.id + ', ' + l.id + ')\n'
    })
  }
}

function stringify (v) {
  return JSON.stringify(v)
}

function noop () {}
