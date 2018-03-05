const { generate: generateEC } = require('ec-pem')
const { createSelfSignedCertificate } = require('ec-pem/cert')

import { expect } from '../_setup'
import { testChannelConnection } from './_chan_tests'

export default function() ::
  var tls_test_api

  before @=>> ::
    const tls_opt = await createSelfSignedCertificate @
      'localhost', @{} altNames: @[] 'localhost', '127.0.0.1'
      generateEC('prime256v1')

    tls_test_api = @{}
      sleep: 2

      async init_a(hub_a) ::
        const svr = hub_a.tls.createServer(tls_opt)
        Object.defineProperties @ this, @{} svr_a: {value: svr}

        svr.listen @: port: 0, host: '127.0.0.1'

        const conn_info = await svr.conn_info(true)
        ::
          this.conn_url = conn_info.asURL()
          expect(this.conn_url).to.be.a('string')
          expect(this.conn_url).to.equal(conn_info+'')

        ::
          const {address, port} = conn_info

          this.a_conn_info = Object.assign @ {}, conn_info

          expect(this.a_conn_info)
          .to.be.deep.equal @:
            address, port

          this.a_conn_info.ca = @[] tls_opt.cert
          
      async init_b(hub_b) ::
        hub_b.tls.with_url_options @:
          ca: this.a_conn_info.ca

      async after() ::
        this.svr_a.unref().close()

      connect(hub_a, hub_b) ::
        return hub_b.tls @ this.a_conn_info

      channel(chan) ::
        expect(chan.when_closed).to.be.a('promise')


  it @ 'hub.tls is a channel', @=>> ::
    await testChannelConnection @:
      __proto__: tls_test_api
      connect(hub_a, hub_b) ::
        return hub_b.tls @ this.a_conn_info, 

  it @ 'hub.tls.connect is a channel', @=>> ::
    await testChannelConnection @:
      __proto__: tls_test_api
      connect(hub_a, hub_b) ::
        return hub_b.tls.connect @ this.a_conn_info

  it @ 'hub.connect("tls://127.0.0.1:«port»") is a channel', @=>> ::
    await testChannelConnection @:
      __proto__: tls_test_api
      connect(hub_a, hub_b) ::
        expect(this.conn_url)
        .to.be.a('string')
        .to.have.string('tls://127.0.0.1:')

        return hub_b.connect(this.conn_url)

