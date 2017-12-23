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
  exports.emit('message', data.name, data.data)
  exports.emit('message:' + data.name, data.data)
})

exports = module.exports = new events.EventEmitter()

exports.send = function (name, data) {
  sock.write(JSON.stringify({name: name, data: data}) + '\n')
}
