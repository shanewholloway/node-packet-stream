require('source-map-support').install()
const MessageHub = require('packet-stream/dist')
const tcp_plugin = require('packet-stream/dist/plugins/tcp')
const swim_plugin = require('packet-stream/dist/plugins/swim_discovery')

const Hub = MessageHub.plugin( tcp_plugin(), swim_plugin() )

const demo_utils = require('./demo_utils')

async function main_swim_core() {
  const hub = new Hub()

  hub.router.registerTarget(0, (msg, router) => {
    const header = JSON.parse(msg.sliceHeader().toString() || 'null')
    const body = JSON.parse(msg.sliceBody().toString() || 'null')
    console.log('CORE got message!', {header, body})
  })


  const svr = hub.tcp.createServer()
  svr.on('error', console.error)

  const service_address =
    await new Promise((resolve, reject) =>
      svr.listen(3020, '0.0.0.0', async function () {
        await demo_utils.sleep(100)
        hub.tcp.connect({port: 3020, host: process.env.SWIM_PEERS})
          .then(chan => chan.conn_info().ip_local.address)
          .then(resolve, reject)
      }))

  svr.close()

  console.log({service_address});
  svr.listen(3020, service_address, async function () {
    const swimDisco = hub.createSWIM({
      host: `${service_address}:2700`,
      channel: svr,
      meta: {
        topics: ['swim-core']
      }})

    demo_utils.logSWIMEvents(swimDisco)

    swimDisco.bootstrap(process.env.SWIM_PEERS || [], 2700)
  })
}

if (module === require.main) {
  main_swim_core()
    .catch(console.error)
}
