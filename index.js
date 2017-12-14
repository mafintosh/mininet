var proc = require('child_process')
var net = require('net')
var split = require('split2')
var events = require('events')
var util = require('util')
var fs = require('fs')

var STDIO_SOCK = '/tmp/mn.stdio.sock'

module.exports = Mininet

function Mininet () {
  if (!(this instanceof Mininet)) return new Mininet()

  this._mn = proc.spawn('mn')
  this._io = net.createServer(this._onstdio.bind(this))
  this._mn.stderr.pipe(split()).on('data', this._parse.bind(this))
  this._missing = -1
  this._lines = []

  this.hosts = []
  this.switches = []

  listen(this._io, STDIO_SOCK)

  events.EventEmitter.call(this)
}

util.inherits(Mininet, events.EventEmitter)

Mininet.prototype._onstdio = function (socket) {
  var self = this

  socket.once('data', function (data) {
    var header = data.toString().trim() 
    var i = Number(header.split(' ')[0].slice(1)) - 1
    var ip = header.split(' ')[1]
    var host = self.hosts[i]

    host.ip = ip
    host._onspawn(socket)
  })
}

Mininet.prototype._parse = function (data) {
  if (/^Exception:/.test(data)) {
    throw new Error(data.slice(11))
    return
  }

  if (this._cmd) {
    this._lines.push(data)
    if (--this._missing) return
    var cmd = this._cmd
    var lines = this._lines
    this._lines = []
    this._cmd = null
    this._done(cmd, lines)
    return
  }

  if (data === '*** Starting CLI:') {
    this._start()
    return
  }
}

Mininet.prototype._done = function (cmd, lines) {
  if (cmd === 'nodes') {
    var output = lines[1].split(/\s+/)
    for (var i = 0; i < output.length; i++) {
      var o = output[i]
      if (o[0] === 'h') this.hosts.push(new Node(o, this))
      if (o[0] === 's') this.switches.push(o)
    }
    this.emit('ready')
    return
  }
}

Mininet.prototype._start = function () {
  this._cmd = 'nodes'
  this._missing = 2
  this._mn.stdin.write(this._cmd + '\n')
}

function listen (server, sock) {
  server.unref()
  fs.unlink(sock, function () {
    server.listen(sock)
  })
}

function pipe (to) {
  return function (socket) {
    socket.pipe(to)
  }
}

function Node (id, mn) {
  events.EventEmitter.call(this)

  this.id = id
  this._stdio = null
  this._rpc = null
  this._mn = mn
}

util.inherits(Node, events.EventEmitter)

Node.prototype._onspawn = function (sock) {
console.log('her')
  var self = this

  this._stdio = sock

  sock.on('error', sock.destroy)
  sock.on('data', function (data) {
    self.emit('stdout', data)
  })
  sock.on('close', function () {
    self.emit('close')
  })

  this.emit('spawn')
}

Node.prototype.spawn = function (cmd, onspawn) {
  if (onspawn) this.once('spawn', onspawn)
  if (Array.isArray(cmd)) cmd = cmd.map(stringify).join(' ')
  cmd = '(echo \'' + this.id + '\' ' + this.id + ' && ' + cmd + ')'
  cmd += ' 2>&1 | nc -U ' + STDIO_SOCK
  this._mn._mn.stdin.write(this.id + ' ' + cmd + '\n')
}

Node.prototype.send = function () {

}

function stringify (cmd) {
  return JSON.stringify(cmd)
}
