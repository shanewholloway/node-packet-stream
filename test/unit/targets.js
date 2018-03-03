import { Hub, expect, newLog } from './_setup'

describe @ 'Target Router', @=> ::
  var hub, log
  beforeEach @=>> ::
    log = newLog()
    hub = Hub.create('$unit$')

  it @ 'simple message send', @=>> ::
    hub.local.registerTarget @ 'a-tgt', (pkt, pktctx) => ::
      const {id_route, id_target} = pkt
      log @ 'tgt recv', @{} id_route, id_target, body: pkt.json()

    ::
      const ts = new Date()
      await hub.send @:
        id_route: '$unit$'
        id_target: 'a-tgt'
        body: @{} msg: 'a message', ts

      expect(log.calls).to.be.deep.equal @#
        @[] 'tgt recv', @{} id_route: '$unit$', id_target: 'a-tgt', body: @{} msg: 'a message', ts: ts.toJSON()