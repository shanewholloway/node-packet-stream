import { Hub, expect, sleep, newLog } from '../_setup'

export default function(setup_msgs_test) ::
  let ns
  beforeEach @=>> ::
    ns = await setup_msgs_test()
    expect(ns.log.calls).to.be.empty


  it @ `anon().stream() using writeWriteEnd`, @=>> ::
    const msg_stream = ns.c_anon.stream()
    do_writeWriteEnd(msg_stream)

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

  it @ `anon().stream() using writeEmptyEnd`, @=>> ::
    const msg_stream = ns.c_anon.stream()
    do_writeEmptyEnd(msg_stream)

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

  it @ `anon().stream() using writeAll`, @=>> ::
    const msg_stream = ns.c_anon.stream()
    do_writeAll(msg_stream)

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




  it @ `to().stream() using writeWriteEnd`, @=>> ::
    const msg_stream = ns.c_from.stream()
    do_writeWriteEnd(msg_stream)

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

  it @ `to().stream() using writeEmptyEnd`, @=>> ::
    const msg_stream = ns.c_from.stream()
    do_writeEmptyEnd(msg_stream)

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

  it @ `to().stream() using writeAll`, @=>> ::
    const msg_stream = ns.c_from.stream()
    do_writeAll(msg_stream)

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



  it @ `reply().stream() using writeWriteEnd`, @=>> ::
    const msg_stream = ns.c_reply.stream()
    do_writeWriteEnd(msg_stream)

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

  it @ `reply().stream() using writeEmptyEnd`, @=>> ::
    const msg_stream = ns.c_reply.stream()
    do_writeEmptyEnd(msg_stream)

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

  it @ `reply().stream() using writeAll`, @=>> ::
    const msg_stream = ns.c_reply.stream()
    do_writeAll(msg_stream)

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


  it @ `reply_anon().stream() using writeWriteEnd`, @=>> ::
    const msg_stream = ns.c_reply_anon.stream()
    do_writeWriteEnd(msg_stream)

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

  it @ `reply_anon().stream() using writeEmptyEnd`, @=>> ::
    const msg_stream = ns.c_reply_anon.stream()
    do_writeEmptyEnd(msg_stream)

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

  it @ `reply_anon().stream() using writeAll`, @=>> ::
    const msg_stream = ns.c_reply_anon.stream()
    do_writeAll(msg_stream)

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


function do_writeWriteEnd(msg_stream) ::
  msg_stream.write @: one: 'first'
  msg_stream.write @: two: 'second'
  msg_stream.end @: three: 'last'
  return msg_stream

function do_writeEmptyEnd(msg_stream) ::
  msg_stream.write @: one: 'first'
  msg_stream.write @: two: 'second'
  msg_stream.write @: three: 'last'
  msg_stream.end()
  return msg_stream

function do_writeAll(msg_stream) ::
  msg_stream.writeAll @#
    @{} one: 'first'
    @{} two: 'second'
    @{} three: 'last'
  msg_stream.end()
  return msg_stream

