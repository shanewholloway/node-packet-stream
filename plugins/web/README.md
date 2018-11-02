# `web` plugin for msg-fabric-core 

### Installation

###### Browser-side

```javascript
import FabricHub from 'msg-fabric-core'

const hub = FabricHub.create()
hub.connect('ws://«host»:«port»')
hub.connect('wss://«host»:«port»')

hub.web.connectWS( a_websocket )

hub.web.connect( an_rtc_data_channel )

hub.web.connect( a_message_channel.port1 )
hub.web.connect( a_web_worker || self )
hub.web.connect( an_iframe )
```

###### NodeJS-side

```javascript
import FabricHubBase from 'msg-fabric-core'
import web from 'msg-fabric-core/esm/plugin-web'

const FabricHub = FabricHubBase.plugin(web())
const hub = FabricHub.create()

// client:
hub.connect('ws://«host»:«port»')
hub.connect('wss://«host»:«port»')
hub.web.connectWS( a_websocket )
```

###### Server: `ws` library

```javascript
const http = require('http')
const server = http.createServer()

const WebSocket = require('ws')
const wss = new WebSocket.Server({server})
wss.on('connection', (ws, request) => {
  const channel = hub.web.connectWS(ws, [ false, request.url ])
})

server.listen(8000, '127.0.0.1', () => 
  console.log('Listening', server.address()) )
```

###### Server: `faye-websocket` library

```javascript
const http = require('http')
const server = http.createServer()

const WebSocket = require('faye-websocket')
server.on('upgrade', (request, socket, body) => {
  if ( WebSocket.isWebSocket(request) ) {
    const ws = new WebSocket(request, socket, body)
    const channel = hub.web.connectWS(ws, [ false, request.url ])
  }
})

server.listen(8000, '127.0.0.1', () => 
  console.log('Listening', server.address()) )
```

### Plugin API

