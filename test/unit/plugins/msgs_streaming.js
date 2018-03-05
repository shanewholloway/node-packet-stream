import { Hub, expect, sleep, newLog } from '../_setup'

export default function(setup_msgs_test) ::
  let ns
  beforeEach @=>> ::
    ns = await setup_msgs_test()
    expect(ns.log.calls).to.be.empty


  for const [variant, do_writeVariant] of Object.entries @ variant_3pkts ::
    describe @ `using ${variant}`, @=> ::

      it @ `anon().stream() using ${variant}`, @=>> ::
        const msg_stream = ns.c_anon.stream()
        await do_writeVariant(msg_stream)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json', @[] 'R', '1001', '0'
            @{} kind: 'stream', token: '1001', seq: 0
            @{} one: 'first'
          @[] '_recv_ json', @[] 'R', '1001', '1'
            @{} kind: 'stream', token: '1001', seq: 1
            @{} two: 'second'
          @[] '_recv_ json', @[] 'R', '1001', '-2'
            @{} kind: 'stream', token: '1001', seq: -2
            @{} three: 'last'


      it @ `to().stream() using ${variant}`, @=>> ::
        const msg_stream = ns.c_from.stream()
        await do_writeVariant(msg_stream)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json'
            @[] 'S', '$cr$', '$client$', '1001', '0'
            @{} kind: 'stream', token: '1001', seq: 0
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 'S', '$cr$', '$client$', '1001', '1'
            @{} kind: 'stream', token: '1001', seq: 1
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 'S', '$cr$', '$client$', '1001', '-2'
            @{} kind: 'stream', token: '1001', seq: -2
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} three: 'last'


      it @ `reply().stream() using ${variant}`, @=>> ::
        const msg_stream = ns.c_reply.stream()
        await do_writeVariant(msg_stream)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json',
            @[] 's', '$cr$', '$client$', 'test_token', '0'
            @{} kind: 'stream', msgid: 'test_token', seq: 0
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 's', '$cr$', '$client$', 'test_token', '1'
            @{} kind: 'stream', msgid: 'test_token', seq: 1
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 's', '$cr$', '$client$', 'test_token', '-2'
            @{} kind: 'stream', msgid: 'test_token', seq: -2
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} three: 'last'


      it @ `reply_anon().stream() using ${variant}`, @=>> ::
        const msg_stream = ns.c_reply_anon.stream()
        await do_writeVariant(msg_stream)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json'
            @[] 'r', 'test_token', '0'
            @{} kind: 'stream', msgid: 'test_token', seq: 0
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 'r', 'test_token', '1'
            @{} kind: 'stream', msgid: 'test_token', seq: 1
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 'r', 'test_token', '-2'
            @{} kind: 'stream', msgid: 'test_token', seq: -2
            @{} three: 'last'





  for const [variant, do_writeVariant] of Object.entries @ variant_4pkts ::
    describe @ `using ${variant}`, @=> ::

      it @ `anon().stream() using ${variant}`, @=>> ::
        const msg_stream = ns.c_anon.stream()
        await do_writeVariant(msg_stream)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json', @[] 'R', '1001', '0'
            @{} kind: 'stream', token: '1001', seq: 0
            @{} one: 'first'
          @[] '_recv_ json', @[] 'R', '1001', '1'
            @{} kind: 'stream', token: '1001', seq: 1
            @{} two: 'second'
          @[] '_recv_ json', @[] 'R', '1001', '2'
            @{} kind: 'stream', token: '1001', seq: 2
            @{} three: 'last'
          @[] '_recv_ json', @[] 'R', '1001', '-3'
            @{} kind: 'stream', token: '1001', seq: -3
            undefined


      it @ `to().stream() using ${variant}`, @=>> ::
        const msg_stream = ns.c_from.stream()
        await do_writeVariant(msg_stream)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json'
            @[] 'S', '$cr$', '$client$', '1001', '0'
            @{} kind: 'stream', token: '1001', seq: 0
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 'S', '$cr$', '$client$', '1001', '1'
            @{} kind: 'stream', token: '1001', seq: 1
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 'S', '$cr$', '$client$', '1001', '2'
            @{} kind: 'stream', token: '1001', seq: 2
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} three: 'last'
          @[] '_recv_ json',
            @[] 'S', '$cr$', '$client$', '1001', '-3'
            @{} kind: 'stream', token: '1001', seq: -3
                from: true, from_route: '$cr$', from_target: '$client$'
            undefined


      it @ `reply().stream() using ${variant}`, @=>> ::
        const msg_stream = ns.c_reply.stream()
        await do_writeVariant(msg_stream)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json',
            @[] 's', '$cr$', '$client$', 'test_token', '0'
            @{} kind: 'stream', msgid: 'test_token', seq: 0
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 's', '$cr$', '$client$', 'test_token', '1'
            @{} kind: 'stream', msgid: 'test_token', seq: 1
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 's', '$cr$', '$client$', 'test_token', '2'
            @{} kind: 'stream', msgid: 'test_token', seq: 2
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} three: 'last'
          @[] '_recv_ json'
            @[] 's', '$cr$', '$client$', 'test_token', '-3'
            @{} kind: 'stream', msgid: 'test_token', seq: -3
                from: true, from_route: '$cr$', from_target: '$client$'
            undefined


      it @ `reply_anon().stream() using ${variant}`, @=>> ::
        const msg_stream = ns.c_reply_anon.stream()
        await do_writeVariant(msg_stream)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json'
            @[] 'r', 'test_token', '0'
            @{} kind: 'stream', msgid: 'test_token', seq: 0
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 'r', 'test_token', '1'
            @{} kind: 'stream', msgid: 'test_token', seq: 1
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 'r', 'test_token', '2'
            @{} kind: 'stream', msgid: 'test_token', seq: 2
            @{} three: 'last'
          @[] '_recv_ json'
            @[] 'r', 'test_token', '-3'
            @{} kind: 'stream', msgid: 'test_token', seq: -3
            undefined


const variant_3pkts = @{}
  async writeWriteEnd(msg_stream) ::
    await msg_stream.write @: one: 'first'
    await msg_stream.write @: two: 'second'
    await msg_stream.end @: three: 'last'

  async writeAllEnd(msg_stream) ::
    await msg_stream.writeAllEnd @#
      @{} one: 'first'
      @{} two: 'second'
      @{} three: 'last'

const variant_4pkts = @{}
  async writeEmptyEnd(msg_stream) ::
    await msg_stream.write @: one: 'first'
    await msg_stream.write @: two: 'second'
    await msg_stream.write @: three: 'last'
    await msg_stream.end()

  async writeAll(msg_stream) ::
    await msg_stream.writeAll @#
      @{} one: 'first'
      @{} two: 'second'
      @{} three: 'last'
    await msg_stream.end()

