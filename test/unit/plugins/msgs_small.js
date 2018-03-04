import { Hub, expect, sleep, newLog } from '../_setup'

export default function(setup_msgs_test) ::
  let ns
  beforeEach @=>> ::
    ns = await setup_msgs_test()
    expect(ns.log.calls).to.be.empty


  describe @ 'datagram encoding', @=> ::
    for const alias of ['send', 'post', 'dg_send', 'dg_post'] ::

      it @ `anon().${alias}`, @=>> ::
        const ts = new Date()
        ns.c_anon[alias] @: hello: ts

        await ns.log.expectOneLogOf @
          '_recv_ json', ['-'], {kind: 'datagram'}, 
          @{} hello: ts.toJSON()


      it @ `to().${alias}`, @=>> ::
        const ts = new Date()
        ns.c_from[alias] @: hello: ts

        await ns.log.expectOneLogOf @
          '_recv_ json'
          @[] '@', '$cr$', '$client$'
          @{} kind: 'datagram'
              from: true, from_route: '$cr$', from_target: '$client$'
          @{} hello: ts.toJSON()


      if ! /send/.test @ alias ::
        it @ `reply().${alias}`, @=>> ::
          const ts = new Date()
          ns.c_reply[alias] @: hello: ts

          await ns.log.expectOneLogOf @
            '_recv_ json'
            @[] '@', '$cr$', '$client$'
            @{} kind: 'datagram'
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} hello: ts.toJSON()


      if ! /send/.test @ alias ::
        it @ `reply_anon().${alias}`, @=>> ::
          const ts = new Date()
          ns.c_reply_anon[alias] @: hello: ts

          await ns.log.expectOneLogOf @
            '_recv_ json', ['-'], {kind: 'datagram'}, 
            @{} hello: ts.toJSON()


  describe @ 'direct encoding', @=> ::
    for const alias of ['query', 'answer', 'dg_query', 'dg_answer', 'send', 'dg_send'] ::

      if ! /send/.test @ alias ::
        it @ `anon().${alias}`, @=>> ::
          const ts = new Date()
          ns.c_anon[alias] @: hello: ts

          await ns.log.expectOneLogOf @
            '_recv_ json'
            @[] 'E', '1001'
            @{} kind: 'direct', token: '1001'
            @{} hello: ts.toJSON()


      if ! /send/.test @ alias ::
        it @ `to().${alias}`, @=>> ::
          const ts = new Date()
          ns.c_from[alias] @: hello: ts

          await ns.log.expectOneLogOf @
            '_recv_ json'
            @[] 'D', '$cr$', '$client$', '1001'
            @{} kind: 'direct', token: '1001'
                from: true, from_route: '$cr$', from_target: '$client$'
            @{} hello: ts.toJSON()


      it @ `reply().${alias}`, @=>> ::
        const ts = new Date()
        ns.c_reply[alias] @: hello: ts

        await ns.log.expectOneLogOf @
          '_recv_ json'
          @[] 'd', '$cr$', '$client$', 'test_token'
          @{} kind: 'direct', msgid: 'test_token'
              from: true, from_route: '$cr$', from_target: '$client$'
          @{} hello: ts.toJSON()


      it @ `reply_anon().${alias}`, @=>> ::
        const ts = new Date()
        ns.c_reply_anon[alias] @: hello: ts

        await ns.log.expectOneLogOf @
          '_recv_ json'
          @[] 'e', 'test_token'
          @{} kind: 'direct'
              msgid: 'test_token'
          @{} hello: ts.toJSON()

