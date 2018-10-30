# `_pkt_` plugin for msg-fabric-core 

### Installation

###### Built-in

```javascript
import FabricHub from 'msg-fabric-core'

const hub = FabricHub.create()
hub._pkts_
```

###### Ground-up

```javascript
import FabricHubBase from 'msg-fabric-core/esm/'
import fhpi_platform from 'msg-fabric-core/esm/plugin-platform-node'
import fhpi_pkts from 'msg-fabric-core/esm/plugin-pkt-node'

const FabricHub = FabricHubBase
  .plugin(fhpi_platform(), fhpi_pkts())

const hub = FabricHub.create()
hub._pkts_
```


### Plugin API

```javascript
hub._pkts_ = {
  bin_call, // a binary_pkts_api instance or undefined
  line, // a line_pkts_api instance or undefined

  splitBody(body, meta) {}, // => array of pkt
  joinPackets(pktList) {}, // => MultiPkt
}

Object.assign(hub._pkts_, defaultFrom(bin_call, line))
```


```javascript
const common_pkts_api = {
  fromObjPacket(obj_pkt) {}, // => pkt
  packPacket(obj_pkt) {}, // => bytes
  unpackPacket(bytes) {}, // => pkt

  createChannel(dispatch, send_packed, channel_base) {}, // => bound channel
}
```

```javascript
const binary_pkts_api = {
  __proto__: common_pkts_api,

  fromObjPacket(obj) {}, // alias for fromObjBinaryPacket
  fromObjBinaryPacket(obj) {}, // => pkt

  packPacket(obj_pkt) {}, // alias for packBinaryPacket
  unpackPacket(pkt_buf) {}, // alias for packBinaryPacket

  packBinaryPacket(pkt) {}, // => bytes
  unpackBinaryPacket(pkt_buf) {}, // => pkt
}
```

```javascript
const line_pkts_api = {
  __proto__: common_pkts_api,

  fromObjPacket(obj) {}, // alias for fromObjLinePacket
  fromObjLinePacket(obj_pkt) {}, // => pkt

  packPacket(obj_pkt) {}, // alias for packLinePacket
  unpackPacket(pkt_str) {}, // alias for unpackLinePacket

  packLinePacket(obj_pkt) {}, // => str
  unpackLinePacket(pkt_str) {}, // => pkt
}

```

#### Packet API

```javascript
const pkt_common_proto = {
  __proto__: null,
  is_pkt: true,

  get id_route() {}, // => string
  get id_target() {}, // => string

  meta() {}, // => json-based object

  repack_pkt(repack) {}, // => visitor based repacking
}
```

```javascript
const pkt_json_proto = {
  __proto__: pkt_common_proto,
  is_pkt_json: true,
  pkt_kind: 'json',

  text() {}, // => string
  json() {}, // => json-based object (or thrown error if unsuccessful)
  buffer() {}, // => Uint8Array or NodeJS Buffer instance
  base64() {}, // => base64 encoded string of buffer 
}
```

```javascript
const pkt_data_proto = {
  __proto__: pkt_common_proto,
  is_pkt_data: true,
  pkt_kind: 'data',

  text() {}, // => string (or thrown error if decode_utf8 is unsuccessful)
  json() {}, // => json-based object (or thrown error if unsuccessful)
  buffer() {}, // => Uint8Array or NodeJS Buffer instance
  base64() {}, // => base64 encoded string of buffer 
}
```

```javascript
const pkt_split_json_proto = {
  __proto__: pkt_common_proto,
  is_pkt_split: true,
  pkt_kind: 'split_json',
}

const pkt_split_data_proto = {
  __proto__: pkt_common_proto,
  is_pkt_split: true,
  pkt_kind: 'split_data',
}

const pkt_split_data_proto = {
  __proto__: pkt_common_proto,
  is_pkt_split: true,
  pkt_kind: 'split_b64',
}
```

