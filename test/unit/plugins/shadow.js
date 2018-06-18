import { Hub, expect, newLog } from '../_setup'
import pi_shadow from 'msg-fabric-core/esm/plugin-shadow'

const xor_shadow = @{}


describe @ 'Plugin shadow', @=> ::
  var hub, log, g_mask
  beforeEach @=>> ::
    g_mask = 0xa5
    log = newLog()
    const TestHub = Hub.plugin @
      pi_shadow @:
        shadow_id(id_target) ::
          if /^[a-z]-/.test @ id_target ::
            return `zzz::${id_target}`

        encode(pkt, ua8, id_shadow) ::
          const mask = g_mask
          log @ 'shadow_encode', ua8.length, mask
          return @{}
            op: @[] 'xor', mask.toString(16)
            body: ua8.map @ v => v ^ mask

        decode(enc_pkt, ua8, id_shadow) ::
          const mask = parseInt(enc_pkt._hdr_[3], 16)
          log @ 'shadow_decode', ua8.length, mask
          return ua8.map @ v => v ^ mask

    hub = TestHub.create('$unit$')



  it @ 'simple shadow message send', @=>> ::
    hub.local.registerTargetObj @ 
      hub.shadow @ 'a-tgt', (pkt, pktctx) => ::
        const {id_route, id_target} = pkt
        log @ 'tgt recv', @{} id_route, id_target, body: pkt.json()

    ::
      const ts = new Date()
      await hub.send @:
        id_route: '$unit$'
        id_target: 'a-tgt'
        body: @{} msg: 'a message', ts

      expect(log.calls).to.be.deep.equal @#
        @[] 'shadow_encode', 55, g_mask
        @[] 'shadow_decode', 55, g_mask
        @[] 'tgt recv', @{} id_route: '$unit$', id_target: 'a-tgt', body: @{} msg: 'a message', ts: ts.toJSON()



  it @ 'intercept shadow message', @=>> ::
    g_mask = 0x03 // use a simple mask for easy-to-see verification

    const real_tgt = hub.shadow @ 'a-tgt', (pkt, pktctx) => ::
      const {id_route, id_target} = pkt
      log @ 'tgt recv', @{} id_route, id_target, body: pkt.json()

    hub.local.registerTarget @ 
      'zzz::a-tgt', (pkt, pktctx) => ::
        const {id_route, id_target} = pkt
        const op = pkt._hdr_.slice(2)
        log @ 'tgt intercept', @{} id_route, id_target, op, body: pkt.text()
        return real_tgt @ pkt, pktctx

    ::
      await hub.send @:
        id_route: '$unit$'
        id_target: 'a-tgt'
        body: @{} msg: 'short'

      expect(log.calls).to.be.deep.equal @#
        @[] 'shadow_encode', 19, g_mask
        @[] 'tgt intercept', @{}
            id_route: '$unit$', id_target: 'zzz::a-tgt'
            op: ['xor', g_mask.toString(16)]
            body: '#\nC\nx!npd!9!pklqw!~'
        @[] 'shadow_decode', 19, g_mask
        @[] 'tgt recv', @{} id_route: '$unit$', id_target: 'a-tgt', body: @{} msg: 'short'


