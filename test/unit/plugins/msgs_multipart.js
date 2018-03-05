import { Hub, expect, sleep, newLog } from '../_setup'

export default function(setup_msgs_test) ::
  let ns
  beforeEach @=>> ::
    ns = await setup_msgs_test()
    expect(ns.log.calls).to.be.empty


  for const [variant, do_writeVariant] of Object.entries @ variant_3pkts ::
    describe @ `using ${variant}`, @=> ::

      it @ `anon().multipart() using ${variant}`, @=>> ::
        const msg_mp = ns.c_anon.multipart()
        await do_writeVariant(msg_mp)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json', @[] 'U', '1001', '0'
            @{} kind: 'multipart', token: '1001', seq: 0
            @{} one: 'first'
          @[] '_recv_ json', @[] 'U', '1001', '1'
            @{} kind: 'multipart', token: '1001', seq: 1
            @{} two: 'second'
          @[] '_recv_ json', @[] 'U', '1001', '-2'
            @{} kind: 'multipart', token: '1001', seq: -2
            @{} three: 'last'


      it @ `to().multipart() using ${variant}`, @=>> ::
        const msg_mp = ns.c_from.multipart()
        await do_writeVariant(msg_mp)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json'
            @[] 'M', '$cr$', '$client$', '1001', '0'
            @{} kind: 'multipart', token: '1001', seq: 0
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 'M', '$cr$', '$client$', '1001', '1'
            @{} kind: 'multipart', token: '1001', seq: 1
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 'M', '$cr$', '$client$', '1001', '-2'
            @{} kind: 'multipart', token: '1001', seq: -2
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} three: 'last'


      it @ `reply().multipart() using ${variant}`, @=>> ::
        const msg_mp = ns.c_reply.multipart()
        await do_writeVariant(msg_mp)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json',
            @[] 'm', '$cr$', '$client$', 'test_token', '0'
            @{} kind: 'multipart', msgid: 'test_token', seq: 0
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 'm', '$cr$', '$client$', 'test_token', '1'
            @{} kind: 'multipart', msgid: 'test_token', seq: 1
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 'm', '$cr$', '$client$', 'test_token', '-2'
            @{} kind: 'multipart', msgid: 'test_token', seq: -2
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} three: 'last'


      it @ `reply_anon().multipart() using ${variant}`, @=>> ::
        const msg_mp = ns.c_reply_anon.multipart()
        await do_writeVariant(msg_mp)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json'
            @[] 'u', 'test_token', '0'
            @{} kind: 'multipart', msgid: 'test_token', seq: 0
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 'u', 'test_token', '1'
            @{} kind: 'multipart', msgid: 'test_token', seq: 1
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 'u', 'test_token', '-2'
            @{} kind: 'multipart', msgid: 'test_token', seq: -2
            @{} three: 'last'





  for const [variant, do_writeVariant] of Object.entries @ variant_4pkts ::
    describe @ `using ${variant}`, @=> ::
      it @ `anon().multipart() using ${variant}`, @=>> ::
        const msg_mp = ns.c_anon.multipart()
        await do_writeVariant(msg_mp)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json', @[] 'U', '1001', '0'
            @{} kind: 'multipart', token: '1001', seq: 0
            @{} one: 'first'
          @[] '_recv_ json', @[] 'U', '1001', '1'
            @{} kind: 'multipart', token: '1001', seq: 1
            @{} two: 'second'
          @[] '_recv_ json', @[] 'U', '1001', '2'
            @{} kind: 'multipart', token: '1001', seq: 2
            @{} three: 'last'
          @[] '_recv_ json', @[] 'U', '1001', '-3'
            @{} kind: 'multipart', token: '1001', seq: -3
            undefined


      it @ `to().multipart() using ${variant}`, @=>> ::
        const msg_mp = ns.c_from.multipart()
        await do_writeVariant(msg_mp)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json'
            @[] 'M', '$cr$', '$client$', '1001', '0'
            @{} kind: 'multipart', token: '1001', seq: 0
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 'M', '$cr$', '$client$', '1001', '1'
            @{} kind: 'multipart', token: '1001', seq: 1
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 'M', '$cr$', '$client$', '1001', '2'
            @{} kind: 'multipart', token: '1001', seq: 2
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} three: 'last'
          @[] '_recv_ json',
            @[] 'M', '$cr$', '$client$', '1001', '-3'
            @{} kind: 'multipart', token: '1001', seq: -3
                from: true, from_route: '$cr$', from_target: '$client$'
            undefined


      it @ `reply().multipart() using ${variant}`, @=>> ::
        const msg_mp = ns.c_reply.multipart()
        await do_writeVariant(msg_mp)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json',
            @[] 'm', '$cr$', '$client$', 'test_token', '0'
            @{} kind: 'multipart', msgid: 'test_token', seq: 0
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 'm', '$cr$', '$client$', 'test_token', '1'
            @{} kind: 'multipart', msgid: 'test_token', seq: 1
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 'm', '$cr$', '$client$', 'test_token', '2'
            @{} kind: 'multipart', msgid: 'test_token', seq: 2
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} three: 'last'
          @[] '_recv_ json'
            @[] 'm', '$cr$', '$client$', 'test_token', '-3'
            @{} kind: 'multipart', msgid: 'test_token', seq: -3
                from: true, from_route: '$cr$', from_target: '$client$'
            undefined


      it @ `reply_anon().multipart() using ${variant}`, @=>> ::
        const msg_mp = ns.c_reply_anon.multipart()
        await do_writeVariant(msg_mp)

        await sleep(1)
        expect(ns.log.calls).to.deep.equal @#
          @[] '_recv_ json'
            @[] 'u', 'test_token', '0'
            @{} kind: 'multipart', msgid: 'test_token', seq: 0
            @{} one: 'first'
          @[] '_recv_ json'
            @[] 'u', 'test_token', '1'
            @{} kind: 'multipart', msgid: 'test_token', seq: 1
            @{} two: 'second'
          @[] '_recv_ json'
            @[] 'u', 'test_token', '2'
            @{} kind: 'multipart', msgid: 'test_token', seq: 2
            @{} three: 'last'
          @[] '_recv_ json'
            @[] 'u', 'test_token', '-3'
            @{} kind: 'multipart', msgid: 'test_token', seq: -3
            undefined



const variant_3pkts = @{}
  async writeWriteEnd(msg_mp) ::
    await msg_mp.write @: one: 'first'
    await msg_mp.write @: two: 'second'
    await msg_mp.end @: three: 'last'

  async writeAllEnd(msg_stream) ::
    await msg_stream.writeAllEnd @#
      @{} one: 'first'
      @{} two: 'second'
      @{} three: 'last'

const variant_4pkts = @{}
  async writeEmptyEnd(msg_mp) ::
    await msg_mp.write @: one: 'first'
    await msg_mp.write @: two: 'second'
    await msg_mp.write @: three: 'last'
    await msg_mp.end()

  async writeAll(msg_mp) ::
    await msg_mp.writeAll @#
      @{} one: 'first'
      @{} two: 'second'
      @{} three: 'last'
    await msg_mp.end()

