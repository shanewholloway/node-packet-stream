import { Hub, expect, sleep, newLog } from '../_setup'

export default function(setup_msgs_test) ::
  let ns, body, huge_body 
  before @=> ::
    const sz64 = '0123456789.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '
    body = @{} lines: Array(256).fill(sz64)
    huge_body = @{} lines: Array(1024).fill(sz64)

  beforeEach @=>> ::
    ns = await setup_msgs_test()
    expect(ns.log.calls).to.be.empty

    ns.log.expectSplitLogEntriesOf = expectSplitLogEntriesOf



  describe @ 'multipart encoding', @=> ::
    for const alias of ['send', 'post'] ::

      it @ `anon().${alias}`, @=>> ::
        ns.c_anon[alias] @ body

        await ns.log.expectSplitLogEntriesOf @
          '_recv_ null', @[] '$unit$', '$src$', 'A'
        await ns.log.expectLastLogOf @
          '_recv_ json', null
          @{} kind: 'split_datagram', seq: 0, token: '1001'


      it @ `to().${alias}`, @=>> ::
        ns.c_from[alias] @ body

        await ns.log.expectSplitLogEntriesOf @
          '_recv_ null', @[] '$unit$', '$src$', 'B'
        await ns.log.expectLastLogOf @
          '_recv_ json', null
          @{} kind: 'split_datagram', seq: 0, token: '1001'
              from: true, from_route: '$cr$', from_target: '$client$'


      if ! /send/.test @ alias ::
        it @ `reply().${alias}`, @=>> ::
          ns.c_reply[alias] @ body

          await ns.log.expectSplitLogEntriesOf @
            '_recv_ null', @[] '$unit$', '$src$', 'b'
          await ns.log.expectLastLogOf @
            '_recv_ json', null
            @{} kind: 'split_datagram', seq: 0, msgid: 'test_token'
                from: true, from_route: '$cr$', from_target: '$client$'
                

      if ! /send/.test @ alias ::
        it @ `reply_anon().${alias}`, @=>> ::
          ns.c_reply_anon[alias] @ body

          await ns.log.expectSplitLogEntriesOf @
            '_recv_ null', @[] '$unit$', '$src$', 'a'
          await ns.log.expectLastLogOf @
            '_recv_ json', null
            @{} kind: 'split_datagram', seq: 0, msgid: 'test_token'


    for const alias of ['query', 'answer', 'send'] ::

      if ! /send/.test @ alias ::
        it @ `anon().${alias}`, @=>> ::
          ns.c_anon[alias] @ body

          await ns.log.expectSplitLogEntriesOf @
            '_recv_ null', @[] '$unit$', '$src$', 'F'
          await ns.log.expectLastLogOf @
            '_recv_ json', null
            @{} kind: 'split_direct', seq: 0, token: '1001'


      if ! /send/.test @ alias ::
        it @ `to().${alias}`, @=>> ::
          ns.c_from[alias] @ body

          await ns.log.expectSplitLogEntriesOf @
            '_recv_ null', @[] '$unit$', '$src$', 'G'
          await ns.log.expectLastLogOf @
            '_recv_ json', null
            @{} kind: 'split_direct', seq: 0, token: '1001'
                from: true, from_route: '$cr$', from_target: '$client$'


      it @ `reply().${alias}`, @=>> ::
        ns.c_reply[alias] @ body

        await ns.log.expectSplitLogEntriesOf @
            '_recv_ null', @[] '$unit$', '$src$', 'g'
        await ns.log.expectLastLogOf @
          '_recv_ json', null
          @{} kind: 'split_direct', seq: 0, msgid: 'test_token'
              from: true, from_route: '$cr$', from_target: '$client$'


      it @ `reply_anon().${alias}`, @=>> ::
        ns.c_reply_anon[alias] @ body

        await ns.log.expectSplitLogEntriesOf @
            '_recv_ null', @[] '$unit$', '$src$', 'f'
        await ns.log.expectLastLogOf @
          '_recv_ json', null
          @{} kind: 'split_direct', seq: 0, msgid: 'test_token'


  describe @ 'invalid encoding', @=> ::
    it @ 'hube body is larger than 64k', @=>> ::
      expect(JSON.stringify(huge_body).length).to.above(65535)

    for const alias of ['dg_send', 'dg_post', 'dg_query', 'dg_answer'] ::
      it @ `anon().${alias}`, @=>> ::
        expect @=> ns.c_anon[alias] @ huge_body
        .to.throw @ /Packet body too large/

      it @ `to().${alias}`, @=>> ::
        expect @=> ns.c_from[alias] @ huge_body
        .to.throw @ /Packet body too large/

      it @ `reply().${alias}`, @=>> ::
        expect @=> ns.c_reply[alias] @ huge_body
        .to.throw @ /Packet body too large/

      it @ `reply_anon().${alias}`, @=>> ::
        expect @=> ns.c_reply_anon[alias] @ huge_body
        .to.throw @ /Packet body too large/


async function expectSplitLogEntriesOf(...args) ::
  await sleep(1)
  
  const calls = this.calls
  for let i = 0; i < calls.length - 1; i++ ::
    expect(calls[i]).to.deep.equal @ args

