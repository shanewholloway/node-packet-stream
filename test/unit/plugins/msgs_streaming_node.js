import { createGzip } from 'zlib'
import { createHash } from 'crypto'
import { Writable } from 'stream'
import { Hub, expect, sleep, newLog } from '../_setup'

export default function(setup_msgs_test) ::

  it @ 'Can use Node Object streams', @=>> ::
    const {c_anon, log} = await setup_msgs_stream_test()

    const stream = c_anon.stream()
      .asNodeStream({objectMode: true})

    stream.write @: one: 'first'
    stream.write @: two: 'second'
    stream.end @: three: 'last'

    await sleep(1)
    expect(log.calls).to.deep.equal @#
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


  it @ 'Can use Node Buffer streams', @=>> ::
    const {c_anon, log} = await setup_msgs_stream_test()

    const stream = c_anon.stream().asNodeStream()

    stream.write @ "one: 'first'"
    stream.write @ "two: 'second'"
    stream.end @ "three: 'last'"

    await sleep(1)
    expect(log.calls).to.deep.equal @#
      @[] '_recv_ data'
        @[] 'R', '1001', '0'
        @{} kind: 'stream', token: '1001', seq: 0
        @{} len: 12, hash: 'UPF4v1s5z'
      @[] '_recv_ data'
        @[] 'R', '1001', '1'
        @{} kind: 'stream', token: '1001', seq: 1
        @{} len: 13, hash: 'S7sF4gZFx'
      @[] '_recv_ data'
        @[] 'R', '1001', '2'
        @{} kind: 'stream', token: '1001', seq: 2
        @{} len: 13, hash: 'P2X8Vds3m'
      @[] '_recv_ json'
        @[] 'R', '1001', '-3'
        @{} kind: 'stream', token: '1001', seq: -3
        undefined


  it @ 'Can pipe from Node streams (Gzip)', @=>> ::
    const {c_anon, log} = await setup_msgs_stream_test()

    const tip_stream = createGzip()
      .pipe @ c_anon.stream().asNodeStream()

    tip_stream.write @ "one: 'first'"
    tip_stream.write @ "two: 'second'"
    tip_stream.end @ "three: 'last'"

    await sleep(1)
    expect(log.calls).to.deep.equal @#
      @[] '_recv_ data'
        @[] 'R', '1001', '0'
        @{} kind: 'stream', token: '1001', seq: 0
        @{} len: 12, hash: 'UPF4v1s5z'
      @[] '_recv_ data'
        @[] 'R', '1001', '1'
        @{} kind: 'stream', token: '1001', seq: 1
        @{} len: 13, hash: 'S7sF4gZFx'
      @[] '_recv_ data'
        @[] 'R', '1001', '2'
        @{} kind: 'stream', token: '1001', seq: 2
        @{} len: 13, hash: 'P2X8Vds3m'
      @[] '_recv_ json'
        @[] 'R', '1001', '-3'
        @{} kind: 'stream', token: '1001', seq: -3
        undefined



async function setup_msgs_stream_test() ::
  const log = newLog()
  const hub = Hub.create('$unit$')


  let _token_counter = 1000
  const pi_msgs = hub.msgs.createMsgsPlugin @:
    newToken() :: return ( ++ _token_counter )+''

  const src_addr = @{}
    id_route: hub.local.id_route
    id_target: '$src$'

  const c_anon = pi_msgs.to(src_addr)
  const src = pi_msgs.as(src_addr)

  hub.local.registerTarget @ '$src$', pkt => ::
    const rpkt = src._recv_ @ pkt
    if null != rpkt ::
      log @ `_recv_ ${rpkt.pkt_kind}`
        rpkt._hdr_ ? rpkt._hdr_.slice(2) : null
        Object.assign({}, rpkt.op)
        rpkt.is_pkt_json
          ? rpkt.json()
          : describe_buf(rpkt.buffer())

    else log @ `_recv_ null`, pkt._hdr_.slice(0,3)

  return @{} log, hub, src, c_anon

function describe_buf(buf) ::
  return @{}
    len: buf.byteLength
    hash: sha256(buf)

function sha256(bytes) ::
  return createHash('sha256')
    .update(bytes)
    .digest('base64')
    .slice(0, 9)
