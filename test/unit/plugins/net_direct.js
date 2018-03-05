import { expect } from '../_setup'
import { testChannelConnection } from './_chan_tests'

export default function() ::
    it @ 'hub.direct_stream is a channel', @=>> ::
      await testChannelConnection @:
        channel(chan) :: expect(chan.when_closed).to.be.a('promise')
        connect(hub_a, hub_b) ::
          return hub_b.direct_stream @ hub_a

    it @ 'hub.direct_stream is a channel', @=>> ::
      await testChannelConnection @:
        channel(chan) :: expect(chan.when_closed).to.be.a('promise')
        connect(hub_a, hub_b) ::
          return hub_b.direct_stream.connect @ hub_a


    it @ 'hub.direct_stream.connect is a channel', @=>> ::
      await testChannelConnection @:
        channel(chan) :: expect(chan.when_closed).to.be.a('promise')
        connect(hub_a, hub_b) ::
          return hub_b.direct_stream.connect @ hub_a

    it @ 'hub.direct_stream.connect is a channel (2)', @=>> ::
      await testChannelConnection @:
        channel(chan) :: expect(chan.when_closed).to.be.a('promise')
        connect(hub_a, hub_b) ::
          return hub_a.direct_stream.connect @ hub_b.direct_stream


    it @ 'hub.direct_stream.connectDirectPair is a [channel, channel]', @=>> ::
      await testChannelConnection @:
        channel(chan) :: expect(chan.when_closed).to.be.a('promise')
        connect(hub_a, hub_b) ::
          const pair = hub_b.direct_stream.connectDirectPair @ hub_a
          expect(pair).to.be.an('array')
          expect(pair).to.have.lengthOf(2)
          expect(pair[0]).to.be.a('promise')
          expect(pair[1]).to.be.a('promise')
          return pair[1]

    it @ 'hub.direct_stream.connectDirectPair is a [channel, channel] (2)', @=>> ::
      await testChannelConnection @:
        channel(chan) :: expect(chan.when_closed).to.be.a('promise')
        connect(hub_a, hub_b) ::
          const pair = hub_a.direct_stream.connectDirectPair @ hub_b.direct_stream
          expect(pair).to.be.an('array')
          expect(pair).to.have.lengthOf(2)
          expect(pair[0]).to.be.a('promise')
          expect(pair[1]).to.be.a('promise')
          return pair[1]



