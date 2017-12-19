var mininet = require('../')
var mn = mininet()

var s1 = mn.createSwitch()
var h1 = mn.createHost()
var h2 = mn.createHost()

h1.link(s1)
h2.link(s1)

mn.on('start', function () {
  console.log('mininet started')
})

h1.spawn('node server.js')

h1.on('message:listening', function () {
  h2.spawn('curl --silent ' + h1.ip + ':10000')
})

h1.on('stdout', function (data) {
  process.stdout.write('h1 ' + data)
})

h2.on('stdout', function (data) {
  process.stdout.write('h2 ' + data)
})

process.on('SIGINT', function () {
  mn.stop()
})
