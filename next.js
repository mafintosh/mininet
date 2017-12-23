var split = require('split2')
var pump = require('pump')
var proc = require('child_process')
var util = require('util')
var fs = require('fs')
var path = require('path')
var net = require('net')
var events = require('events')
var os = require('os')

function Mininet (opts) {
  if (!(this instanceof Mininet)) return new Mininet(opts)
  if (!opts) opts = {}

  events.EventEmitter.call(this)

  this.hosts = []
  this.switches = []
  this.controllers = []
  this.started = false
  this.stopped = false

  this._queue = []
  this._python = null
  this._sock = path.join(os.tmpdir(), 'mn.' + Math.random() + 'sock')
  this._server = null
  this._args = ['python', '-i']
  if (opts.clean) this._args.unshift(path.join(__dirname, 'clean.sh'))
  if (process.getuid() && opts.sudo !== false) {
    this._args.unshift('sudo')
  }

  this._listen()
}

util.inherits(Mininet, events.EventEmitter)

Mininet.prototype._listen = function () {
  var self = this

  this._server = net.createServer(onsocket)
  this._server.unref()
  fs.unlink(this._sock, onready)

  function onsocket (socket) {
    socket.unref()
    socket.on('error', function () {
      socket.destroy()
    })
    socket.once('readable', function onreadable () {
      var header = socket.read(32)
      if (!header) return socket.once('readable', onreadable)
      header = header.toString().trim().split(' ')
      var host = self.hosts[Number(header[0])]
      if (!host) return socket.destroy()
      if (header[2] === 'stdio') host._onstdio(Number(header[1]), socket)
    })
  }

  function onready () {
    if (self.stopped) return
    self._server.listen(self._sock)
  }
}

Mininet.prototype._onexit = function (code) {
  if (code === 10) {
    this.emit('error', new Error('Mininet not installed'))
  }

  this.emit('close')
}

Mininet.prototype._exec = function (cmd) {
  var self = this

  if (!this._python) {
    this._python = proc.spawn(this._args[0], this._args.slice(1))
    this._python.on('exit', this._onexit.bind(this))
    this._python.stderr.resume()
    this._python.stdout.pipe(split()).on('data', this._parse.bind(this))
    this._python.stdin.write(trim(`
      try:
        import json
        from mininet.topo import Topo
        from mininet.net import Mininet
        from mininet.node import findController
        from mininet.node import OVSBridge
        from mininet.link import Link, TCLink, OVSLink
      except:
        exit(10)

      def print_host(h):
        try:
          print "ack", json.dumps({'name': h.name, 'ip': h.IP(), 'mac': h.MAC()})
        except:
          print "err", "host info failed"

      def net_start():
        try:
          net.start()
          result = []
          for h in net.hosts:
            result.append({'name': h.name, 'ip': h.IP(), 'mac': h.MAC()})
          print "ack", json.dumps(result)
        except:
          print "err", "start failed"

      net = Mininet(link=TCLink, switch=OVSBridge, controller=findController())
    `))
  }

  this._python.stdin.write(trim(cmd))
}

Mininet.prototype.stop = function (cb) {
  if (!cb) cb = noop

  if (this.stopped) {
    process.nextTick(cb)
    return
  }

  this.stopped = true
  this._python.stdin.write('net.stop()\n')
  this._python.stdin.end(cb)
  fs.unlink(this._sock, noop)
}

Mininet.prototype.start = function (cb) {
  if (!cb) cb = noop
 
  if (this.stopped) {
    process.nextTick(cb, new Error('Mininet stopped'))
    return
  }

  if (this.started) {
    this._queue.push(cb)
    this._exec(`print "ack"`)
    return
  }

  var self = this

  this.started = true
  this._queue.push(onstart)
  this._exec(`
    net_start()
  `)

  function onstart (err, info) {
    if (err) return cb(err)

    for (var i = 0; i < info.length; i++) {
      var inf = info[i]
      var index = Number(inf.name.slice(1)) - 1
      var host = self.hosts[index]
      host.ip = inf.ip
      host.mac = inf.mac
      host.emit('network')
    }

    self.emit('start')
    cb(null)
  }
}

Mininet.prototype.createController = function () {
  var controller = new Controller(this.controllers.length, this)
  this.controllers.push(controller)
  return controller
}

Mininet.prototype.createHost = function () {
  var host = new Host(this.hosts.length, this)
  this.hosts.push(host)
  return host
}

Mininet.prototype.createSwitch = function () {
  var sw = new Switch(this.switches.length, this)
  this.switches.push(sw)
  return sw
}

Mininet.prototype._parse = function (line) {
  var i = line.indexOf(' ')
  var type = line.slice(0, i)
  var data = line.slice(i + 1)

  if (type === 'ack') {
    this._queue.shift()(null, JSON.parse(data))
    return
  }
  if (type === 'err') {
    this._queue.shift()(new Error(JSON.parse(data)))
    return
  }
  if (type === 'critical') {
    this.emit('error', new Error(JSON.parse(data)))
    return
  }
}

function Controller (index, mn) {
  this.index = index
  this.id = 'c' + (index + 1)
  this._mn = mn
  this._mn._exec(`
    ${this.id} = net.addController("${this.id}")
  `)
}

function Switch (index, mn) {
  this.index = index
  this.id = 's' + (index + 1)
  this._mn = mn
  this._mn._exec(`
    try:
      ${this.id} = net.addSwitch("${this.id}")
    except:
      print "critical", "add switch failed"
  `)
}

function Host (index, mn) {
  events.EventEmitter.call(this)
  this.index = index
  this.id = 'h' + (index + 1)
  this.ip = null
  this.mac = null
  this.processes = []
  this._ids = 0
  this._mn = mn
  this._mn._exec(`
    try:
      ${this.id} = net.addHost("${this.id}")
    except:
      print "critical", "add host failed"
  `)
}

util.inherits(Host, events.EventEmitter)

Host.prototype._onstdio = function (id, socket) {
  var self = this
  for (var i = 0; i < this.processes.length; i++) {
    var proc = this.processes[i]
    if (proc.id !== id) continue

    proc.socket = socket

    socket.on('data', function (data) {
      proc.emit('stdout', data)
    })
    
    socket.on('close', function () {
      self._onclose(proc, null)
    })
    break
  }
}

Host.prototype.update = function (cb) {
  if (!cb) cb = noop

  var self = this
  
  this._queue.push(onupdate)
  this._mn._exec(`
    print_host(${this.id})
  `)

  function onupdate (err, info) {
    if (err) return cb(err)

    self.ip = info.ip
    self.mac = info.mac

    cb(null, info)
  }
}

Host.prototype.link =
Switch.prototype.link = function (to, opts) {
  if (!opts) opts = {}

  var line = ''
  if (opts.bandwidth) opts.bw = opts.bandwidth
  if (opts.bw !== undefined) line += ', bw=' + opts.bw
  if (opts.delay !== undefined) line += ', delay=' + JSON.stringify(opts.delay)
  if (opts.loss !== undefined) line += ', loss=' + opts.loss
  if (opts.htb || opts.useHtb) line += ', use_htb=True'

  this._mn._exec(`
    try:
      net.addLink(${this.id}, ${to.id} ${line})
    except:
      print "critical", "add link failed"
  `)

  return to
}

Host.prototype.spawn = function (cmd, opts) {
  if (!opts) opts = {}

  var proc = new events.EventEmitter()
  var self = this

  proc.command = cmd
  proc.socket = null
  proc.id = this._ids++
  proc.pid = 0
  proc.kill = kill
  proc.killed = false

  this.processes.push(proc)
  this.exec(fork(this.index, proc.id, cmd, this._mn._sock), onspawn)

  if (opts.stdio === 'inherit') {
    proc.on('stdout', data => process.stdout.write(data))
  }

  return proc

  function kill (sig) {
    if (proc.killed) return
    proc.killed = true
    if (!sig) sig = 'SIGTERM'
    if (proc.pid) pkill()
    else proc.once('spawn', pkill)

    function pkill () {
      var ppid = `$(ps -o ppid,pid | grep '^[ ]*${proc.pid}' | awk '{print $2}' | head -n 1)`
      self.exec(`pkill -P ${ppid} --signal ${sig}`)
    }
  }

  function onspawn (err, data) {
    if (err) return self._onclose(proc, err)
    var pid = Number(data.trim().split('\n').pop())
    proc.pid = pid
    proc.emit('spawn')
  }  
}

Host.prototype._onclose = function (proc, err) {
  var i = this.processes.indexOf(proc)
  if (i > -1) this.processes.splice(i, 1)
  if (err) proc.emit('error', err)
  proc.emit('close')
  proc.emit('exit')
}


Host.prototype.exec = function (cmd, cb) {
  this._mn._queue.push(cb || noop)
  this._mn._exec(`
    res = ${this.id}.cmd(${JSON.stringify(cmd)})
    print "ack", json.dumps(res)
  `)
}

function header (index, id, type) {
  var str = index + ' ' + id + ' ' + type
  while (str.length < 31) str += ' '
  return str
}

function fork (host, id, cmd, sock) {
  var h = header(host, id, 'stdio')
  return `((echo "${h}" && (${cmd})) 2>&1 | nc -U "${sock}") & echo $!`
}

function noop () {}

function trim (s) {
  var indent = (s.match(/\n([ ]+)/m) || [])[1] || ''
  s = indent + s.trim()
  return s.split('\n')
    .map(l => l.replace(indent, ''))
    .join('\n') + '\n\n'
}

var mn = Mininet()
var h1 = mn.createHost()
var h2 = mn.createHost()
var s1 = mn.createSwitch()
var s2 = mn.createSwitch()

h1.link(s1)
s1.link(s2, {delay: '100ms', loss: 25})
h2.link(s2)

mn.start(function () {
  var proc = h1.spawn('node server.js', {stdio: 'inherit'})
  // h1.spawn('ping ' + h1.ip, {stdio: 'inherit'})
  h1.spawn('ping ' + h2.ip, {stdio: 'inherit'})

  proc.once('stdout', function () {
    h2.exec(`curl ${h1.ip}:10000`, console.log)
  })

  setTimeout(function () {
    proc.once('exit', function () {
      console.log('exited...')
      mn.stop()
    })
    proc.kill()
  }, 10000)
})

