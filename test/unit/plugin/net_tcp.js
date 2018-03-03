import { expect } from '../_setup'
import { testChannelConnection } from './_chan_tests'

export default function() ::
  const tcp_test_api = @{}
    sleep: 2

    async init_a(hub_a) ::
      const svr = hub_a.tcp.createServer()
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
        
    async shutdown() ::
      this.svr_a.unref().close()

    connect(hub_a, hub_b) ::
      return hub_b.tcp @ this.a_conn_info

  it @ 'hub.tcp is a channel', @=>> ::
    await testChannelConnection @:
      __proto__: tcp_test_api
      connect(hub_a, hub_b) ::
        return hub_b.tcp @ this.a_conn_info

  it @ 'hub.tcp.connect is a channel', @=>> ::
    await testChannelConnection @:
      __proto__: tcp_test_api
      connect(hub_a, hub_b) ::
        return hub_b.tcp.connect @ this.a_conn_info

  it @ 'hub.connect("tcp://127.0.0.1:«port»") is a channel', @=>> ::
    await testChannelConnection @:
      __proto__: tcp_test_api
      connect(hub_a, hub_b) ::
        expect(this.conn_url)
        .to.be.a('string')
        .to.have.string('tcp://127.0.0.1:')

        return hub_b.connect(this.conn_url)

