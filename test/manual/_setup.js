require('source-map-support').install()

const { URL } = require('url')
const { TextEncoder, TextDecoder } = require('util')
Object.assign(global, { URL, TextDecoder, TextEncoder })

const BasicHub = require('msg-fabric-core')

const tcp = require('msg-fabric-core/cjs/plugin-net-tcp')
const tls = require('msg-fabric-core/cjs/plugin-net-tls')
// const shadow = require('msg-fabric-core/cjs/plugin-shadow')

const TestNetHub = BasicHub.plugin( tcp(), tls() )

module.exports = exports = BasicHub
Object.assign(exports, {
  default: BasicHub,
  Hub: BasicHub,
  BasicHub,
  TestNetHub,
})
