import { Hub, expect, newLog, createTestHub } from './_setup'

describe @ 'P2P Target Router', @=> ::
  it @ 'basics', @=>> :: 
    const hub = Hub.create('$one$')
    expect(hub.p2p.id_route).to.equal('')
    expect(hub.p2p.public_routes).to.deep.equal @# '$one$'

  it @ 'hello via direct', @=>> :: 
    const hub_one = createTestHub @ 'one'
    const hub_two = createTestHub @ 'two'

    const chan = await hub_one.direct @ hub_two
    const peer_info = await chan.peer_info
    expect(peer_info).to.deep.equal @:
      routes: @[] '$two$'

