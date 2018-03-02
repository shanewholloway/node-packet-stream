import { Hub, expect, newLog } from './_setup'

describe @ 'P2P Target Router', @=> ::
  var log, test_chan
  beforeEach @=>> ::
    log = newLog()


  it @ 'hello via direct', @=>> :: 
    const hub_one = Hub.create('$one$')
    const hub_two = Hub.create('$two$')

    const chan = await hub_one.direct @ hub_two

    const peer_info = await chan.peer_info
    expect(peer_info)
    .to.deep.equal @:
      routes: @[] '$two$'

