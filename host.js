var net = require('net')
var split = require('split2')
var events = require('events')

var sock = net.connect(process.env.MN_SOCK)

sock.write(process.env.MN_HEADER + '\n')
sock.pipe(split()).on('data', function (data) {
  try {
    data = JSON.parse(data)
  } catch (err) {
    return
  }
  var opts = {from: data.from}
  exports.emit('message', data.name, data.data, opts)
  exports.emit('message:' + data.name, data.data, opts)
})

exports = module.exports = new events.EventEmitter()

exports.send = function (name, data, opts) {
  if (!opts) opts = {}
  sock.write(JSON.stringify({name: name, data: data, to: opts.to}) + '\n')
}

exports.sendTo = function (host, name, data) {
  exports.send(name, data, {to: host})
}

exports.broadcast = function (name, data) {
  exports.send(name, data, {to: '*'})
}
