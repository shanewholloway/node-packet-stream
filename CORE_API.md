
```javascript
import FabricHub from 'msg-fabric-core' 

const hub = FabricHub.create()
// or
const hub = new FabricHub()
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
const reply = hub.local.addReply()
hub.send(tgt_addr,
  { msg: 'hello readme example with reply',
    id_reply: reply.id
  })

reply.then( ans => {
  console.log('Received reply', ans) 
})
```
