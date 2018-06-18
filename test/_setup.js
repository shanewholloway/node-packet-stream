require('source-map-support').install()

const {URL} = require('url')
const {TextEncoder, TextDecoder} = require('util')
Object.assign(global, {URL, TextDecoder, TextEncoder})

const BasicHub = require('..')

const tcp = require('../cjs/plugin-net-tcp')
const tls = require('../cjs/plugin-shadow')

const TestNetHub = BasicHub.plugin( tcp(), tls() )

module.exports = exports = BasicHub
Object.assign(exports, {
  default: BasicHub,
  BasicHub,
  TestNetHub,
})
