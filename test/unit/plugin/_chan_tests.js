import { sleep, expect, newLog, createTestHub } from '../_setup'

export async function testChannelConnection(test_api) ::
  const log = newLog()

  const hub_a = createTestHub @ 'one', log
  if test_api.init_a :: 
    await test_api.init_a(hub_a)
  else if test_api.init :: 
    await test_api.init(hub_a)

  const hub_b = createTestHub @ 'two', log
  if test_api.init_b :: 
    await test_api.init_b(hub_b)
  else if test_api.init :: 
    await test_api.init(hub_b)

  const p_chan = test_api.connect(hub_a, hub_b)
  expect(p_chan).to.be.a('promise')
  await expect(p_chan).to.be.fulfilled

  const chan = await p_chan
  expect(chan.peer_info).to.be.a('promise')
  await expect(chan.peer_info).to.be.fulfilled


  expect(log.calls).to.be.empty

  await hub_b.send @:
    id_route: '$one$'
    id_target: 'tgt_one'
    body: 'hello one'

  await sleep @ test_api.sleep || 0

  expect(log.calls).to.deep.equal @#
    'recv [$one$ tgt_one]'

  await hub_a.send @:
    id_route: '$two$'
    id_target: 'tgt_two'
    body: 'hello two'

  await sleep @ test_api.sleep || 0

  expect(log.calls).to.deep.equal @#
    'recv [$one$ tgt_one]'
    'recv [$two$ tgt_two]'


  if test_api.shutdown :: 
    await test_api.shutdown(hub_a, hub_b)

