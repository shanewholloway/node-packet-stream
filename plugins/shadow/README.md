# `shadow` plugin for msg-fabric-core 

(alpha)

### Installation

###### Built-in

```javascript
import FabricHubBase from 'msg-fabric-core'
import shadow from 'msg-fabric-core/esm/plugin-shadow'

const FabricHub = FabricHubBase.plugin(
  shadow({
    shadow_id(id_target) {
      if (/^[a-z]-/.test( id_target ))
        return `zzz::${id_target}`
    },

    encode(pkt, ua8, id_shadow) {
      return {
        op: ['enc_key', pub_key],
        body: encrypt_buffer(ua8, priv_key)
      }
    },

    decode(enc_pkt, ua8, id_shadow) {
      const priv_key = get_private_key_somehow(enc_pkt)
      return decrypt_buffer(ua8, priv_key)
    },

  }))

const hub = FabricHub.create()

hub.local.registerTargetObj(
  hub.shadow('a-hidden_target_id', (pkt, pktctx) => {
    // handler
  } ))

```

### Plugin API

See source code for this alpha-release plugin.
