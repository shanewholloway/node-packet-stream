// this module provides `window.url_msg_fabric_hub` for Web Worker testing
import MsgFabricBase from 'msg-fabric-core/esm/web/index.js'
import pi_web from 'msg-fabric-core/esm/web/plugin-web.js'
export default MsgFabricBase.plugin(pi_web())
