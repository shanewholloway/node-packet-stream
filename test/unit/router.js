import { Hub, expect, newLog } from './_setup'

describe @ 'Router', @=> ::
  var hub, log, test_chan
  beforeEach @=>> ::
    log = newLog()
    hub = Hub.create('$unit$')

    test_chan = @{}
      undeliverable({id_route, id_target}, mode) ::
        log @ 'undeliverable', @{} mode, id_route, id_target

      send(obj) ::
        const pkt = hub._fromObjPacket(obj)
        return hub.dispatch @ pkt, this


  describe @ 'messages to targets', @=> ::

    it @ 'should call handler if target does exist', @=>> ::
      hub.local.registerTarget @ 'a-tgt', (pkt, pktctx) => ::
        const {id_route, id_target} = pkt
        log @ 'tgt recv', @{} id_route, id_target, body: pkt.json()

      await test_chan.send @:
        id_route: '$unit$'
        id_target: 'a-tgt'
        body: @{} msg: 'a message'

      expect(log.calls).to.be.deep.equal @#
        @[] 'tgt recv', @{} id_route: '$unit$', id_target: 'a-tgt', body: @{} msg: 'a message'


    it @ 'should be able to lookup logical routes and targets', @=>> ::
      const tgt_id = new Date().toISOString()
      const logical = @{}
        'a-logical-tgt': @{} id_route: '$unit$', id_target: tgt_id

      hub.router.registerRoute @ '$dynamic$', async (pkt, pktctx) => ::
        const dyn = logical[pkt.id_target]
        log @ 'dynamic route', pkt.id_target, dyn.id_target
        pkt._hdr_[0] = dyn.id_route
        pkt._hdr_[1] = dyn.id_target
        await pktctx.redispatch(pkt, pktctx)

      hub.local.registerTarget @ tgt_id, (pkt, pktctx) => ::
        const {id_route, id_target} = pkt
        log @ 'tgt recv', @{} id_route, id_target, body: pkt.json()

      await test_chan.send @:
        id_route: '$dynamic$', id_target: 'a-logical-tgt'
        body: @{} msg: 'a logical message'

      expect(log.calls).to.be.deep.equal @#
        @[] 'dynamic route', 'a-logical-tgt', tgt_id
        @[] 'tgt recv', @{} id_route: '$unit$', id_target: tgt_id, body: @{} msg: 'a logical message'


  describe @ 'handles undeliverables', @=> ::
    it @ 'should call channel.undeliverable if route does not exist', @=>> ::
      await test_chan.send @:
        id_route: 'dne-route'
        id_target: 'dne-tgt'
        body: @{} msg: 'a message'

      expect(log.calls).to.be.deep.equal @#
        @[] 'undeliverable', @{} mode: 'route', id_route: 'dne-route', id_target: 'dne-tgt'


    it @ 'should call channel.undeliverable if target does not exist', @=>> ::
      await test_chan.send @:
        id_route: '$unit$'
        id_target: 'dne-tgt'
        body: @{} msg: 'a message'

      expect(log.calls).to.be.deep.equal @#
        @[] 'undeliverable', @{} mode: 'target', id_route: '$unit$', id_target: 'dne-tgt'


  describe @ 'discovery', @=> ::

    it @ 'should call router.routeDiscovery if route does not exist', @=>> ::
      hub.router.routeDiscovery.push @
        ({id_route, key}) => ::
          log @ 'discovery', @{} key, id_route
          return null

      await test_chan.send @:
        id_route: 'dne-route'
        id_target: 'dne-tgt'
        body: @{} msg: 'a message'

      expect(log.calls).to.be.deep.equal @#
        @[] 'discovery', @{} key: 'dne-route', id_route: 'dne-route'
        @[] 'undeliverable', @{} mode: 'route', id_route: 'dne-route', id_target: 'dne-tgt'


    it @ 'should use router.routeDiscovery channel answer if route found', @=>> ::
      hub.router.routeDiscovery.push @
        ({id_route, key}) => ::
          log @ 'discovery', @{} key, id_route
          return @{} send({id_route, id_target}) ::
            log @ 'sent pkt', @{} id_route, id_target

      await test_chan.send @:
        id_route: 'dne-route'
        id_target: 'dne-tgt'
        body: @{} msg: 'a message'

      expect(log.calls).to.be.deep.equal @#
        @[] 'discovery', @{} key: 'dne-route', id_route: 'dne-route'
        @[] 'sent pkt', @{} id_route: 'dne-route', id_target: 'dne-tgt'


    it @ 'should use router.routeDiscovery function answer if route found', @=>> ::
      hub.router.routeDiscovery.push @
        ({id_route, key}) => ::
          log @ 'discovery', @{} key, id_route
          return ({id_route, id_target}) => ::
            log @ 'route pkt', @{} id_route, id_target

      await test_chan.send @:
        id_route: 'dne-route'
        id_target: 'dne-tgt'
        body: @{} msg: 'a message'

      expect(log.calls).to.be.deep.equal @#
        @[] 'discovery', @{} key: 'dne-route', id_route: 'dne-route'
        @[] 'route pkt', @{} id_route: 'dne-route', id_target: 'dne-tgt'


    it @ 'should timeout router.routeDiscovery if no response', @=>> ::
      hub.router._discoveryTimeout = () => ::
        log @ 'createDiscoveryTimeout'
        return ({id_route, key}) => ::
          log @ 'discoveryTimeout', @{} key, id_route
          return new Promise @ resolve => ::
            setTimeout @ resolve, 10

      hub.router.routeDiscovery.push @
        ({id_route, key}) => ::
          log @ 'discovery, no return', @{} key, id_route

      await test_chan.send @:
        id_route: 'dne-route'
        id_target: 'dne-tgt'
        body: @{} msg: 'a message'

      expect(log.calls).to.be.deep.equal @#
        'createDiscoveryTimeout'
        @[] 'discovery, no return', @{} key: 'dne-route', id_route: 'dne-route'
        @[] 'discoveryTimeout', @{} key: 'dne-route', id_route: 'dne-route'
        @[] 'undeliverable', @{} mode: 'route', id_route: 'dne-route', id_target: 'dne-tgt'


