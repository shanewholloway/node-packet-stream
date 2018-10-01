# `direct` plugin for msg-fabric-core 

### Installation

###### Built-in

```javascript
import FabricHub from 'msg-fabric-core'

const hub = FabricHub.create()
const hub_b = FabricHub.create()
hub.direct.connect(hub_b)
```

### Plugin API

```javascript
hub.direct = {
  connect(peer) {}, // => connectDirectPair(peer)[0]
  pair(peer) {}, // => Promise.all(connectDirectPair(peer))
  connectDirectPair(peer) {}, // => [Promise(channel_self), Promise(channel_peer)]
  connectDirectChannel(send, channel_id, no_hello) {}, // => [recv function, Promise(channel)]
}
```

