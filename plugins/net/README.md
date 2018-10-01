# `net` plugin for msg-fabric-core 

### Installation

##### TCP

```javascript
import FabricHubBase from 'msg-fabric-core'
import tcp from 'msg-fabric-core/esm/plugin-net-tcp'
// or: import {tcp} from 'msg-fabric-core/esm/plugin-net-all'

const FabricHub = FabricHubBase.plugin(tcp())
const hub = FabricHub.create()

// client:
hub.connect('tcp://«host»:«port»')
hub.tcp.connect({ host, port })

// server:
hub.tcp.createServer()
  .listen(port)
```

##### TLS

```javascript
import FabricHubBase from 'msg-fabric-core'
import tls from 'msg-fabric-core/esm/plugin-net-tls'
// or: import {tls} from 'msg-fabric-core/esm/plugin-net-all'

const FabricHub = FabricHubBase.plugin(tls())
const hub = FabricHub.create()

// client:
hub.connect('tls://«host»:«port»')
hub.tls.connect({ host, port })

// server:
hub.tls.createServer(tls_options)
  .listen(port)

hub.tls.with_url_options({ca: certificate_authority})

```

##### Direct Stream

```javascript
import FabricHubBase from 'msg-fabric-core'

import direct_stream from 'msg-fabric-core/esm/plugin-net-direct'
// or: import {direct_stream} from 'msg-fabric-core/esm/plugin-net-all'

const FabricHub = FabricHubBase.plugin(direct_stream())

const hub = FabricHub.create()
const hub_b = FabricHub.create()
hub.direct_stream.connect(hub_b)
```

### Plugin API

```javascript
hub.tcp = {
  connect(channel_id, ... tcp_connect_options), // => Promise(channel)
  createServer(onPeer), // => tcp.createServer result
  with_url_options(options), // => update internal url_options with merged object
}

hub.tls = {
  connect(channel_id, ... tls_connect_options), // => Promise(channel)
  createServer(tls_options, onPeer), // => tls.createServer result
  with_url_options(options), // => update internal url_options with merged object
}

hub.direct_stream = {
  connect(peer) {}, // => connectDirectPair(peer)[0]
  connectDirectPair(peer, channel_id) {}, // => [Promise(channel_self), Promise(channel_peer)]
  connectDirectChannel(rstream, wstream, channel_id) {}, // => Promise(channel)
}
```
