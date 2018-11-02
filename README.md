# msg-fabric-core

Inspired by:

- Alan Kay's vision of messaging between objects in [Smalltalk](https://en.wikipedia.org/wiki/Smalltalk#Messages)
- [Erlang](http://erlang.org/doc/reference_manual/distributed.html)'s distributed messaging
- Uber's [Ringpop](https://github.com/uber-node/ringpop-node) and [TChannel](https://github.com/uber/tchannel-node)
- [PouchDB](https://pouchdb.com/custom.html)'s excellent plugin model


## Examples

##### Creating a new hub
```javascript
import FabricHub from 'msg-fabric-core' 

const hub = FabricHub.create()
// or
const hub = new FabricHub()
```


##### Browser hub connections

```javascript
hub.connect('ws://«host»:«port»')
hub.connect('wss://«host»:«port»')

hub.web.connect( a_message_channel.port1 )
hub.web.connect( a_web_worker || self )
hub.web.connect( an_iframe )

hub.web.connectWS( a_websocket )
hub.web.connectStream( an_rtc_data_channel )
```


##### NodeJS hub connections

See [plugins/net](plugins/net/README.md)

```javascript
hub.connect('tcp://«host»:«port»')
hub.connect('tls://«host»:«port»')

hub.tcp.createServer()
hub.tcp.connect({ host, port })

hub.tls.createServer( tls_options )
hub.tls.connect({ host, port })

hub.direct_stream.connect( hub_other )

// WebSockets also work server-side
hub.web.connectWS( a_websocket )
```


##### Same-process hub connections

See [plugins/direct](plugins/net/README.md)

```javascript
hub.direct.connect( hub_other )
```


#### Messaging API

##### Add a Target

```javascript
const tgt_addr = hub.local.addTarget(pkt => {
  console.log('pkt target received pkt:', pkt)

  if (pkt.body.id_reply) {
    console.log('replying to:', pkt.body.id_reply)
    hub.send( pkt.body.id_reply, { ts: new Date, echo: pkt.body })
  }
})
```

##### Send a Message

```javascript
hub.send(tgt_addr,
  { msg: 'hello readme example (addr, body)' })

// or
hub.send(tgt_addr.id_route, tgt_addr.id_target,
  { msg: 'hello readme example (id_route, id_target, body)' })

// or
const { id_route, id_target } = tgt_addr
hub.send({
  id_route,
  id_target,
  meta: {
    ts: new Date
  },
  body: {
    msg: 'hello readme example ({ id_route, id_target, meta, body })'
  }
})

```

##### Send and await a Reply

```javascript
const reply = hub.addReply()
hub.send(tgt_addr,
  { msg: 'hello readme example with reply',
    id_reply: reply.id
  })

reply.then(ans => console.log('Received reply', ans) )

## License

[2-Clause BSD](https://github.com/shanewholloway/msg-fabric-core/blob/master/LICENSE)

