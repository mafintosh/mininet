var net = require('net')
var ndjson = require('ndjson')
var pump = require('pump')
var events = require('events')

var sock = net.connect(process.env.MN_SOCK)
var inp = ndjson.parse()
var out = ndjson.stringify()

var header = 'rpc ' + process.env.MN_INDEX
while (header.length < 31) header += ' '
sock.write(header + '\n')

pump(out, sock, inp)
exports = module.exports = new events.EventEmitter()

inp.on('data', function (data) {
  exports.emit('message', data.name, data.data)
  exports.emit('message:' + data.name, data.data)
})

exports.send = function (name, data) {
  out.write({name: name, data: data})
}
