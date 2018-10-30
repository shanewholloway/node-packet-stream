# `msgs` plugin for msg-fabric-core 

### Installation

###### Built-in

```javascript
import FabricHub from 'msg-fabric-core'

const hub = FabricHub.create()
hub.msgs
```

###### Ground-up

```javascript
import FabricHubBase from 'msg-fabric-core/esm/'
import fhpi_platform from 'msg-fabric-core/esm/plugin-platform-node'
import fhpi_pkts from 'msg-fabric-core/esm/plugin-pkt-node'
import fhpi_msgs from 'msg-fabric-core/esm/plugin-msgs-node'

const FabricHub = FabricHubBase
  .plugin(fhpi_platform(), fhpi_pkts(), fhpi_msgs())

const hub = FabricHub.create()
hub.msgs
```


### Plugin API

```javascript
hub.msgs = {
  as(id) {}, // => Source_API
  to(id) {}, // => Send_Anon_API
  anon(id) {}, // => Send_Anon_API
}
```


#### Messaging API

```javascript
const msg_api = {
  toJSON() {}, // => ({'Ϡ': '«id_route» «id_target»'})

  post(body) {},
  query(body) {},
  answer(body) {},

  dg_post(body) {},
  dg_query(body) {},
  dg_answer(body) {},

  stream({meta}) {},
  multipart({meta}) {},
  ctrl(body, {meta}) {},
}
```

###### Sender Mode API
```javascript
const send_msg_api = {
  ... msg_api,
  send: msg_api.post,
  dg_send: msg_api.dg_post,
}
```

###### Reply Mode API

```javascript
const reply_msg_api = {
  ... msg_api,
  send: msg_api.answer,
  dg_send: msg_api.dg_answer,
  replyExpected: true,
}
```


#### Source API

```javascript
const source_api = {
  _recv_pkt_(pkt) {}, // => rpkt
  _send_pkt_(pkt) {}, // => rpkt
  toJSON() {}, // => ({'Ϡ': '«id_route» «id_target»'})

  anon(id) {}, // => Send_Anon_API in Sender_Mode
  to(id) {}, // => Send_From_API in Sender_Mode

  reply_anon(id) {}, // => Send_Anon_API in Reply_Mode
  reply(id) {}, // => Send_From_API in Reply_Mode
}

// `_recv_pkt_` is for using with `addTarget`
hub.local.addTarget( id, pkt => {
  const rpkt = _recv_pkt_(pkt)
})
```

##### Send Anon API

The `Send_Anon_API` is an instance of `Messaging_API` **without** return routing information in either `Sender_Mode` or `Reply_Mode`.

##### Send From API

The `Send_From_API` is an instance of `Messaging_API` **bound with** return routing information in either `Sender_Mode` or `Reply_Mode`.

Additionally, a `.anon()` method returns a `Send_Anon_API` in the same `Sender_Mode` or `Reply_Mode`.
