# msg-fabric-core

Inspired by:

- Alan Kay's vision of messaging between objects in [Smalltalk](https://en.wikipedia.org/wiki/Smalltalk#Messages)
- [Erlang](http://erlang.org/doc/reference_manual/distributed.html)'s distributed messaging
- Uber's [Ringpop](https://github.com/uber-node/ringpop-node) and [TChannel](https://github.com/uber/tchannel-node)
- [PouchDB](https://pouchdb.com/custom.html)'s excellent plugin model

### Ecosystem

- Foundational
  - [msg-fabric][msgfab-top]
  - [msg-fabric-core][msgfab-core]
  - [msg-fabric-endpoint][msgfab-ep]

- Plugins
  - [msg-fabric-plugin-swim-discovery][msgfab-swim]
    - **SWIM:** Scalable Weakly-consistent Infection-style Process Group Membership Protocol [PDF](http://www.cs.cornell.edu/~asdas/research/dsn02-SWIM.pdf)
  - [msg-fabric-plugin-ec-target-router][msgfab-ectgt]

[msgfab-top]: https://www.npmjs.com/package/msg-fabric
[msgfab-core]: https://www.npmjs.com/package/msg-fabric-core
[msgfab-ep]: https://www.npmjs.com/package/msg-fabric-endpoint
[msgfab-swim]: https://npmjs.com/packages/msg-fabric-plugin-swim-discovery
[msgfab-ectgt]: https://npmjs.com/packages/msg-fabric-plugin-ec-target-router

## Examples

##### Creating a new hub
```javascript
import FabricHub from 'msg-fabric-core' 

const hub = FabricHub.create()
// or
const hub = new FabricHub()
```

##### Connecting a hub to another from NodeJS

```javascript
hub.connect('tcp://«host»:«port»')
hub.connect('tls://«host»:«port»')

hub.direct.connect(hub_other)

hub.tcp.createServer()
hub.tcp.connect({ host, port })

hub.tls.createServer( tls_options )
hub.tls.connect({ host, port })

hub.web.connectWS( a_websocket )
hub.direct_stream.connect( hub_other )
```

##### Connecting a hub to another from the Browser

```javascript
hub.connect('ws://«host»:«port»')
hub.connect('wss://«host»:«port»')

hub.direct.connect(hub_other)

hub.web.connectWS( a_websocket )

hub.web.connectSend( an_rtc_data_channel )

hub.web.connectPostMessage( a_message_channel.port1 )
hub.web.connectPostMessage( a_web_worker || self )
hub.web.connectPostMessage( an_iframe )
```


#### Low-level packet API use

##### Registering a new target

```javascript
const tgt_addr = {
  id_route: hub.local.id_route,
  id_target: 'a_pkt_target_id' }

hub.local.registerTarget(tgt_addr.id_target, pkt => {
  console.log('pkt target received pkt:', pkt)
})
```

##### Sending to target using the raw `channel.send()` api

```javascript
hub.send({
  id_route: tgt_addr.id_route,
  id_target: tgt_addr.id_target,
  body: { msg: 'hello readme hub.send example!' }
})
```



#### Mid-level messages API use via `hub.msgs` plugin

##### Sending to target using the `hub.msgs` api

```javascript
const client = hub.msgs.anon({
  id_route: tgt_addr.id_route,
  id_target: tgt_addr.id_target })

client.send({ msg: 'hello readme msg.send example!' })
```

##### Registering a new target using `hub.msgs.as()` api

```javascript
const source = hub.msgs.as({
  id_route: hub.local.id_route,
  id_target: 'a_msg_target_id' })

source.send({ msg: 'hello readme msg.send example!' })
hub.local.registerTarget(source.id_target, pkt => {
  const rpkt = source._recv_(pkt)
  console.log('msg target received pkt:', rpkt, rpkt.op)
})
```



#### High-level [endpoint][msgfab-ep] API use

See [msg-fabric-endpoint][msgfab-ep]




## License

[2-Clause BSD](https://github.com/shanewholloway/msg-fabric-core/blob/master/LICENSE)

