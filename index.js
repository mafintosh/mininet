var proc = require('child_process')
var net = require('net')
var split = require('split2')
var events = require('events')
var util = require('util')
var fs = require('fs')
var path = require('path')

var STDIO_SOCK = '/tmp/mn.stdio.sock'
var CLEAN_AND_MN = path.join(__dirname, 'clean-and-mn.sh')

module.exports = Mininet

function Mininet (opts) {
  if (!(this instanceof Mininet)) return new Mininet(opts)
  if (!opts) opts =  {}

  var prog = opts.clean ? CLEAN_AND_MN : 'mn'
  var topo = [].concat(opts.topo || opts.topology || []).join(',')
  var args = opts.args || []

  if (topo) args.push('--topo', topo)

  this._mn = proc.spawn(prog, args)
  this._io = net.createServer(this._onstdio.bind(this))
  this._mn.stderr.pipe(split()).on('data', this._parse.bind(this))
  this._mn.on('exit', this._onexit.bind(this))
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

Mininet.prototype._onexit = function () {
  this.emit('close')
}

Mininet.prototype.destroy = function () {
  this._mn.stdin.end()
}

Mininet.prototype._parse = function (data) {
  // console.error('parse', data)
  if (/^Exception:/.test(data)) {
    this.emit('error', new Error(data.slice(11)))
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
      var index = parseInt(o.slice(1), 10) - 1
      if (o[0] === 'h') this.hosts[index] = new Host(o, this)
      if (o[0] === 's') this.switches[index] = o
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

function Host (id, mn) {
  events.EventEmitter.call(this)

  this.id = id
  this.index = parseInt(id.slice(1), 10) - 1

  this._stdio = null
  this._rpc = null
  this._mn = mn
}

util.inherits(Host, events.EventEmitter)

Host.prototype._onspawn = function (sock) {
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

Host.prototype.spawn = function (cmd, onspawn) {
  if (onspawn) this.once('spawn', onspawn)
  if (Array.isArray(cmd)) cmd = cmd.map(stringify).join(' ')
  cmd = '(echo \'' + this.id + '\' ' + this.id + ' && ' + cmd + ')'
  cmd += ' 2>&1 | nc -U ' + STDIO_SOCK
  this._mn._mn.stdin.write('\n' + this.id + ' ' + cmd + ' &\n')
}

Host.prototype.send = function () {

}

function stringify (cmd) {
  return JSON.stringify(cmd)
}
