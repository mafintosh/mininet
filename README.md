# mininet

> Spin up and interact with virtual networks using
> [Mininet](http://mininet.org/) and Node.js

WIP - nothing to see here

```
npm install mininet
```

## Usage

``` js
var mininet = require('mininet')

var mn = mininet()

mn.on('ready', function () {
  console.log('available hosts', mn.hosts.length)

  var h = mn.hosts[0]
  h.spawn(['node', 'some-app.js'], function () {
    console.log('app is running, virtual ip is', h.ip)
  })
})
```

## License

MIT
