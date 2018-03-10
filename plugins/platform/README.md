# `platform` plugin for msg-fabric-core 

### Installation

###### Built-in

```javascript
import FabricHub from 'msg-fabric-core'

const hub = FabricHub.create()
hub.data_utils
```

###### Ground-up

```javascript
import FabricHubBase from 'msg-fabric-core/esm/'
import fhpi_platform from 'msg-fabric-core/esm/plugin-platform-node'
import fhpi_pkts from 'msg-fabric-core/esm/plugin-pkt-node'

const FabricHub = FabricHubBase
  .plugin(fhpi_platform(), fhpi_pkts())

const hub = FabricHub.create()
hub.data_utils
```


### Plugin API

```javascript
// on NodeJS, bytes is a Buffer; otherwise bytes is a Uint8Array

hub.data_utils = {
  _global_, // => global (node) or window (browser) or self (webworker)
  random(n) {}, // => n bytes from a cryptographically random source
  random_base64(n) {}, // => pack_base64(random(n))
  parse_url(url) {}, // => new URL(url)
  pack_base64(data) {}, // => Base 64 encoded string
  unpack_base64(str_b64) {}, // => bytes
  decode_utf8(u8) {}, // => string
  encode_utf8(str) {}, // => bytes
  as_data(data) {}, // => bytes
  concat_data(parts) {}, // => bytes
}
```
