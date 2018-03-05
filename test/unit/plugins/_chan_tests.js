import { sleep, expect, newLog, createTestHub } from '../_setup'

export const testChannelConnection = testDoubleSidedChannelConnection
export async function testDoubleSidedChannelConnection(test_api) ::
  const log = newLog()

  const hub_a = createTestHub @ 'one', log
  if test_api.init :: 
    await test_api.init(hub_a)
  if test_api.init_a :: 
    await test_api.init_a(hub_a)

  const hub_b = createTestHub @ 'two', log
  if test_api.init :: 
    await test_api.init(hub_b)
  if test_api.init_b :: 
    await test_api.init_b(hub_b)

  if test_api.before ::
    await test_api.before(hub_a, hub_b)

  const p_chan = test_api.connect(hub_a, hub_b)
  expect(p_chan).to.be.a('promise')

  const chan = await p_chan
  if null == chan.peer_info ::
    console.warn @ 'Null peer_info'
    expect(chan.peer_info).to.be.a('promise')

  else ::
    expect(chan.peer_info).to.be.a('promise')

    const peer_info = await chan.peer_info
    expect(peer_info).to.have.property('routes')
    expect(peer_info.routes).to.have.lengthOf(1)
    expect(peer_info.routes[0]).to.be.oneOf @# '$one$', '$two$'


  expect(log.calls).to.be.empty

  if test_api.during ::
    await test_api.during(hub_a, hub_b)

  await hub_b.send @:
    id_route: '$one$'
    id_target: 'tgt_one'
    body: @{} msg: 'hello one'
    on_sent() :: log @ 'on_sent one'

  await sleep @ test_api.sleep || 0

  expect(log.calls).to.deep.equal @#
    'on_sent one'
    @[] 'recv [$one$ tgt_one]', @{} msg: 'hello one'

  await hub_a.send @:
    id_route: '$two$'
    id_target: 'tgt_two'
    body: @{} msg: 'hello two'
    on_sent() :: log @ 'on_sent two'

  await sleep @ test_api.sleep || 0

  expect(log.calls).to.deep.equal @#
    'on_sent one'
    @[] 'recv [$one$ tgt_one]', @{} msg: 'hello one'
    'on_sent two'
    @[] 'recv [$two$ tgt_two]', @{} msg: 'hello two'


  await test_api.done
  if test_api.after :: 
    await test_api.after(hub_a, hub_b)


export async function testSingleSidedChannelConnection(test_api) ::
  const log = newLog()

  const hub = createTestHub @ 'one', log
  if test_api.init :: 
    await test_api.init(hub)

  if test_api.before ::
    await test_api.before(hub)

  const p_chan = test_api.connect(hub)
  expect(p_chan).to.be.a('promise')

  const chan = await p_chan
  if null == chan.peer_info ::
    console.warn @ 'Null peer_info'
    expect(chan.peer_info).to.be.a('promise')

  else ::
    expect(chan.peer_info).to.be.a('promise')

    const peer_info = await chan.peer_info
    expect(peer_info).to.have.property('routes')
    expect(peer_info.routes).to.have.lengthOf(1)
    expect(peer_info.routes[0]).to.equal('$remote$')


  expect(log.calls).to.be.empty

  if test_api.during ::
    await test_api.during(hub)

  await hub.send @:
    id_route: '$remote$'
    id_target: 'tgt_remote'
    body: @{} msg: 'hello remote'
    on_sent() :: log @ 'on_sent'

  await sleep @ test_api.sleep || 0

  expect(log.calls).to.deep.equal @#
    'on_sent'
    @[] 'recv [$one$ tgt_one]', @{}
      from: test_api.from_tag
      pkt_hdr: @[] '$remote$', 'tgt_remote'
      echo: @{} msg: 'hello remote'

  await test_api.done
  if test_api.after :: 
    await test_api.after(hub)

