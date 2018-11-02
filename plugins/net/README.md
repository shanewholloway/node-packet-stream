# `net` plugin for msg-fabric-core 

### Installation

##### TCP

```javascript
import FabricHubBase from 'msg-fabric-core'
import tcp from 'msg-fabric-core/esm/plugin-net-tcp'
// or: import { tcp } from 'msg-fabric-core/esm/plugin-net-all'

const FabricHub = FabricHubBase.plugin( tcp() )
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
// or: import { tls } from 'msg-fabric-core/esm/plugin-net-all'

const FabricHub = FabricHubBase.plugin( tls() )
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
// or: import { direct_stream } from 'msg-fabric-core/esm/plugin-net-all'

const FabricHub = FabricHubBase.plugin( direct_stream() )

const hub = FabricHub.create()
const hub_peer = FabricHub.create()
hub.direct_stream.connect(hub_peer)
```

### Plugin API

#### TCP Channel API

##### `hub.tcp.connect(...args)`

Creates a TCP client connection and returns a `Promise` for the channel
wrapping it. `args` are passed to `require('net').createConnection(...args)

##### `hub.tcp.createServer(onPeer)`

Creates a TCP server using `require('net').createServer`.
A new channel is created for each new TCP client connection.
If provided, `onPeer(channel)` or `srv.emit(onPeer, channel)` is called.



#### TLS Channel API

##### `hub.tls.connect(...args)`

Creates a TLS client connection and returns a `Promise` for the channel
wrapping it. `args` are passed to `require('net').createConnection(...args)

##### `hub.tls.createServer(tls_options, onPeer)`

Creates a TLS server using `require('tls').createServer`.
A new channel is created for each new TLS client connection.
If provided, `onPeer(channel)` or `srv.emit(onPeer, channel)` is called.




#### (NodeJS) Stream Channel API

##### `hub.direct_stream.connect(peer)`

Uses `hub.direct_stream.connectPair(peer)` and returns a `Promise` for the outbound channel sending from `hub` to `peer`.


##### `hub.direct_stream.pair(peer)`

Uses `hub.direct_stream.connectPair(peer)` and returns a `Promise.all` over both channels.


##### `hub.direct_stream.connectPair(peer)`

Uses `hub.direct_stream.createChanel()` to create a channel on `hub` and on `peer` for duplex communication.

Returns a list of two promises: the first sending from `hub` to `peer`, the second sending from `peer` to `hub`.


##### `hub.direct_stream.createChanel(dispatch, channel_id)`

Creates and initializes a new channel using `dispatch` function for transport.



#### Common Channel APIs

##### `hub.« tcp | tls ».with_url_options(options)`

Updates defaults connection options used when `hub.connect('tcp://«host»:«port»')` (or `'tls://'`) is called.


##### `hub.« tcp | tls ».on_url_connect`

An optional hook called when `hub.connect('tcp://«host»:«port»')` (or `'tls://'`) is used.

Provide a function of the form `(options, url) => options` to override.


##### `hub.« tcp | tls | direct_stream ».codec`

Use the specified `codec` if provided. If falsy, `hub.stream_codec` instance is used.


##### `hub.« tcp | tls | direct_stream ».p2p`, default `null`

Allows using a different P2P peering behavior for created channels.

If p2p is falsy, the shared `hub.p2p` instance is used.

