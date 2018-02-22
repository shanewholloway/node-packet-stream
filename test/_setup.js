require('source-map-support').install()

const {URL} = require('url')
const {TextEncoder, TextDecoder} = require('util')
Object.assign(global, {URL, TextDecoder, TextEncoder})

const BasicHub = require('..')

const tcp = require('../cjs/plugin-net-tcp')
const tls = require('../cjs/plugin-net-tls')
const direct = require('../cjs/plugin-net-direct')

const TestDirectHub = BasicHub.plugin( direct() )
const TestNetHub = BasicHub.plugin( tcp(), tls() )

module.exports = exports = BasicHub
Object.assign(exports, {
  default: BasicHub,
  BasicHub,
  TestDirectHub,
  TestNetHub,
})
