'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var url = require('url');
var crypto = require('crypto');
var msgFabricPacketStream = require('msg-fabric-packet-stream');

function nodejs_router_plugin(plugin_options = {}) {
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        _init_packetParser() {
          return msgFabricPacketStream.createBufferPacketParser(plugin_options);
        },

        _parseConnectURL(conn_url) {
          return new url.URL(conn_url);
        },

        _init_router() {
          const id_self = random_id_self();
          const router = new bases.MessageRouter(id_self);
          router.allowUnverifiedRoutes = true;
          return router;
        } });
    } };
}

function random_id_self() {
  return crypto.randomBytes(4).readUInt32LE();
}

exports['default'] = nodejs_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1ub2RlLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL25vZGUuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7VVJMfSBmcm9tICd1cmwnXG5pbXBvcnQge3JhbmRvbUJ5dGVzfSBmcm9tICdjcnlwdG8nXG5pbXBvcnQge2NyZWF0ZUJ1ZmZlclBhY2tldFBhcnNlciBhcyBjcmVhdGVQYWNrZXRQYXJzZXJ9IGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbm9kZWpzX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBAOiBzdWJjbGFzcyhNZXNzYWdlSHViX1BJLCBiYXNlcykgOjpcbiAgICBPYmplY3QuYXNzaWduIEAgTWVzc2FnZUh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBfaW5pdF9wYWNrZXRQYXJzZXIoKSA6OlxuICAgICAgICByZXR1cm4gY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybCkgOjpcbiAgICAgICAgcmV0dXJuIG5ldyBVUkwoY29ubl91cmwpXG5cbiAgICAgIF9pbml0X3JvdXRlcigpIDo6XG4gICAgICAgIGNvbnN0IGlkX3NlbGYgPSByYW5kb21faWRfc2VsZigpXG4gICAgICAgIGNvbnN0IHJvdXRlciA9IG5ldyBiYXNlcy5NZXNzYWdlUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gcmFuZG9tQnl0ZXMoNCkucmVhZFVJbnQzMkxFKClcbiJdLCJuYW1lcyI6WyJub2RlanNfcm91dGVyX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwic3ViY2xhc3MiLCJNZXNzYWdlSHViX1BJIiwiYmFzZXMiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJjcmVhdGVQYWNrZXRQYXJzZXIiLCJjb25uX3VybCIsIlVSTCIsImlkX3NlbGYiLCJyYW5kb21faWRfc2VsZiIsInJvdXRlciIsIk1lc3NhZ2VSb3V0ZXIiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJyYW5kb21CeXRlcyIsInJlYWRVSW50MzJMRSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFJZSxTQUFTQSxvQkFBVCxDQUE4QkMsaUJBQWUsRUFBN0MsRUFBaUQ7U0FDckQsRUFBQ0MsU0FBU0MsYUFBVCxFQUF3QkMsS0FBeEIsRUFBK0I7YUFDaENDLE1BQVAsQ0FBZ0JGLGNBQWNHLFNBQTlCLEVBQTJDOzZCQUNwQjtpQkFDWkMsK0NBQXFCTixjQUFyQixDQUFQO1NBRnVDOzt5QkFJeEJPLFFBQWpCLEVBQTJCO2lCQUNsQixJQUFJQyxPQUFKLENBQVFELFFBQVIsQ0FBUDtTQUx1Qzs7dUJBTzFCO2dCQUNQRSxVQUFVQyxnQkFBaEI7Z0JBQ01DLFNBQVMsSUFBSVIsTUFBTVMsYUFBVixDQUF3QkgsT0FBeEIsQ0FBZjtpQkFDT0kscUJBQVAsR0FBK0IsSUFBL0I7aUJBQ09GLE1BQVA7U0FYdUMsRUFBM0M7S0FETyxFQUFUOzs7QUFjRixTQUFTRCxjQUFULEdBQTBCO1NBQ2pCSSxtQkFBWSxDQUFaLEVBQWVDLFlBQWYsRUFBUDs7Ozs7In0=
