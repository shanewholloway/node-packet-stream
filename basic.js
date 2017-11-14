const {FabricHub} = require('./dist/index.js')
const {default: fpi_router} = require('./dist/plugin-router-basic.js')

module.exports = exports =
  FabricHub.plugins( fpi_router() )

