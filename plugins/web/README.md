# `web` plugin for msg-fabric-core 

### Installation

#### Browser-side

```javascript
import FabricHub from 'msg-fabric-core'
const hub = FabricHub.create()

// Web Apis with .postMessage() or .send()  using builtin Structured Clone

hub.web.connect( a_message_channel.port1 )
hub.web.connect( a_web_worker || self )
hub.web.connect( an_iframe )

// Web Apis with .postMessage() or .send() using a Codec

hub.web.connectStream( an_rtc_data_channel )


// WebSocket using a Codec:

hub.connect('ws://«host»:«port»')
hub.connect('wss://«host»:«port»')

hub.web.connectWS( a_websocket )
```

#### WebSocket Server: `ws` library

```javascript
const http = require('http')
const server = http.createServer()

const WebSocket = require('ws')
const wss = new WebSocket.Server({server})
wss.on('connection', (ws, request) => {
  const channel = hub.web.connectWS(ws, request.url)
})

server.listen(8000, '127.0.0.1', () => 
  console.log('Listening', server.address()) )
```

#### WebSocket Server: `faye-websocket` library

```javascript
const http = require('http')
const server = http.createServer()

const WebSocket = require('faye-websocket')
server.on('upgrade', (request, socket, body) => {
  if ( WebSocket.isWebSocket(request) ) {
    const ws = new WebSocket(request, socket, body)
    const channel = hub.web.connectWS(ws, request.url)
  }
})

server.listen(8000, '127.0.0.1', () => 
  console.log('Listening', server.address()) )
```

### Plugin API

##### `hub.web.connect(tgt, options)`

Uses `hub.web.createChannel(tgt, options)` and returns a `Promise` for the channel.

##### `hub.web.createChannel(tgt, options)`

Creates a channel around standard `.postMessage()` or `.send()` Web APIs that
provide `'message'` events.

If `tgt` is an array, it is unpacked into `[tgt_send, tgt_recv]`; otherwise
the same `tgt` is used for both `tgt_send`, `tgt_recv`.

Options:
 - `options.accept` – provided a function that returns `true` to allow handling of the packet.
 - `options.codec` – use specified codec. See `plugins/standard/json_codec` for details.
 - `options.channel_id` – use a specific channel id (for debugging)


##### `hub.web.connectStream(tgt, options)`

Uses `hub.web.createStreamChannel(tgt, options)` and returns a `Promise` for the channel.

##### `hub.web.createStreamChannel(tgt, options)`

If `options.codec` is not explicitly provided, uses `hub.web.codec || hub.stream_codec`.
Returns result of `hub.web.createChannel(tgt, options)` with set `options.codec`.


#### WebSocket API

##### `hub.web.connectWS(url, options)` or `hub.web.connectWS(websock, options)`

If provided a url string, creates a `websock` using `hub.web.createWS(url)`.
Uses `hub.web.createWSChannel(websock)` and returns a `Promise` for the channel.


##### `hub.web.createWSChannel(websock, options)`

Creates a channel around `websock` using `hub.web.createStreamChannel` and
adds WebSocket specific event handling.


##### `hub.web.createWS(url)`

Override to change how a `WebSocket` is instantiated and configured from a
`"ws://"` or `"wss://"` url.

##### `hub.web.WebSocket`

Allows using a different WebSocket class for connection.


#### Common Channel APIs

##### `hub.web.codec`, default `null`

Use the specified `codec` from the `options` parameter or
the `hub.web.p2p` option. If falsy, `hub.stream_codec`
instance is used.

##### `hub.web.p2p`, default `null`

Allows using a different P2P peering behavior for created channels.

If p2p is falsy, the shared `hub.p2p` instance is used.

