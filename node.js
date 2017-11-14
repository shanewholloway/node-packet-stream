const {FabricHub} = require('./dist/index.js')
const {default: fpi_router} = require('./dist/plugin-router-node.js')
const {default: fpi_tcp} = require('./dist/plugin-router-node.js')

module.exports = exports =
  FabricHub.plugins( fpi_router(), fpi_tcp() )

