require('source-map-support').install()
const {MessageHub} = require('packet-stream/dist/hub')
const tcp_plugin = require('packet-stream/dist/plugins/tcp')
const swim_plugin = require('packet-stream/dist/plugins/swim_discovery')

const Hub = MessageHub.plugin( tcp_plugin(), swim_plugin() )

const demo_utils = require('./demo_utils')

async function main_service_two() {
  const hub = new Hub()

  hub.router.registerTarget(0, (msg, router) => {
    const header = JSON.parse(msg.sliceHeader().toString() || 'null')
    const body = JSON.parse(msg.sliceBody().toString() || 'null')
    console.log('SERVICE TWO got message!', {header, body})
  })

  const service_address = await
    hub.tcp.connect({port: 3020, host: process.env.SWIM_PEERS})
      .then(chan => chan.conn_info().ip_local.address)

  const svr = hub.tcp.createServer()
  svr.on('error', console.error)

  console.log({service_address});
  svr.listen(3020, service_address, async function () {
    const swimDisco = hub.createSWIM({
      host: `${service_address}:2700`,
      channel: svr,
      meta: {
        topics: ['service_two', 'common']
      }})

    demo_utils.logSWIMEvents(swimDisco)

    swimDisco.bootstrap(process.env.SWIM_PEERS || [], 2700)
    swimDisco.registerRouterDiscovery()
    main_demo(hub, swimDisco)
  })
}

function main_demo(hub, swimDisco) {
  const channel = hub.connect_self()
  setInterval(pingAtRandom, 1000).unref()
  return

  function pingAtRandom() {
    const {byId} = swimDisco
    for (const [id_router, entry] of byId.entries()) {
      if ('dead' === entry.swim_status)
        byId.delete(id_router)
    }
      
    const lst = Array.from(byId.values())
    const selected = lst[0 | (Math.random() * lst.length)]

    channel.sendJSON({
      id_router: selected.id_router,
      body: {msg: 'hello from SERVICE TWO'}
    })
  }
}

if (module === require.main) {
  main_service_two()
    .catch(console.error)
}
