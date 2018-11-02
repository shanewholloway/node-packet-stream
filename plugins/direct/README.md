# `direct` plugin for msg-fabric-core 

Allows for connecting multiple in-process `MsgFabricHub` instances. This is
useful to allow for architectural isolation, unit-testing, or simplifying
distributed architecture prototyping.


### Installation

###### Built-in

```javascript
import FabricHub from 'msg-fabric-core'

const hub = FabricHub.create()
const hub_peer = FabricHub.create()
hub.direct.connect(hub_peer)
```

### Plugin API

##### `hub.direct.connect(peer)`

Uses `hub.direct.connectPair(peer)` and returns a `Promise` for the outbound channel sending from `hub` to `peer`.


##### `hub.direct.pair(peer)`

Uses `hub.direct.connectPair(peer)` and returns a `Promise.all` over both channels.


##### `hub.direct.connectPair(peer)`

Uses `hub.direct.createChanel()` to create a channel on `hub` and on `peer` for duplex communication.

Returns a list of two promises: the first sending from `hub` to `peer`, the second sending from `peer` to `hub`.


##### `hub.direct.createChanel(dispatch, channel_id)`

Creates and initializes a new channel using `dispatch` function for transport.


##### `hub.direct.p2p`, default `null`

Allows using a different P2P peering behavior for created channels.

If p2p is falsy, the shared `hub.p2p` instance is used.

