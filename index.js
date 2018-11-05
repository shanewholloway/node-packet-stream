const MsgFabricBase = require('./cjs/index.js')
const mfpi_net = require('./cjs/plugin-net.js')

const MsgFabric = MsgFabricBase.plugin( mfpi_net() )
module.exports = exports = MsgFabric
