'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var url = require('url');
var crypto = require('crypto');
var msgFabricPacketStream = require('msg-fabric-packet-stream');

function nodejs_router_plugin(plugin_options = {}) {
  return { subclass(FiberHub_PI, bases) {
      Object.assign(FiberHub_PI.prototype, {
        packetParser: msgFabricPacketStream.createBufferPacketParser(plugin_options),

        _parseConnectURL(conn_url) {
          return new url.URL(conn_url);
        },

        _init_router() {
          const id_self = random_id_self();
          const router = new bases.Router(id_self);
          router.allowUnverifiedRoutes = true;
          return router;
        } });
    } };
}

function random_id_self() {
  return crypto.randomBytes(4).readInt32LE();
}

exports['default'] = nodejs_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1ub2RlLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL25vZGUuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7VVJMfSBmcm9tICd1cmwnXG5pbXBvcnQge3JhbmRvbUJ5dGVzfSBmcm9tICdjcnlwdG8nXG5pbXBvcnQge2NyZWF0ZUJ1ZmZlclBhY2tldFBhcnNlciBhcyBjcmVhdGVQYWNrZXRQYXJzZXJ9IGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbm9kZWpzX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBAOiBzdWJjbGFzcyhGaWJlckh1Yl9QSSwgYmFzZXMpIDo6XG4gICAgT2JqZWN0LmFzc2lnbiBAIEZpYmVySHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBhY2tldFBhcnNlcjogY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybCkgOjpcbiAgICAgICAgcmV0dXJuIG5ldyBVUkwoY29ubl91cmwpXG5cbiAgICAgIF9pbml0X3JvdXRlcigpIDo6XG4gICAgICAgIGNvbnN0IGlkX3NlbGYgPSByYW5kb21faWRfc2VsZigpXG4gICAgICAgIGNvbnN0IHJvdXRlciA9IG5ldyBiYXNlcy5Sb3V0ZXIoaWRfc2VsZilcbiAgICAgICAgcm91dGVyLmFsbG93VW52ZXJpZmllZFJvdXRlcyA9IHRydWVcbiAgICAgICAgcmV0dXJuIHJvdXRlclxuXG5mdW5jdGlvbiByYW5kb21faWRfc2VsZigpIDo6XG4gIHJldHVybiByYW5kb21CeXRlcyg0KS5yZWFkSW50MzJMRSgpXG4iXSwibmFtZXMiOlsibm9kZWpzX3JvdXRlcl9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsInN1YmNsYXNzIiwiRmliZXJIdWJfUEkiLCJiYXNlcyIsImFzc2lnbiIsInByb3RvdHlwZSIsImNyZWF0ZVBhY2tldFBhcnNlciIsImNvbm5fdXJsIiwiVVJMIiwiaWRfc2VsZiIsInJhbmRvbV9pZF9zZWxmIiwicm91dGVyIiwiUm91dGVyIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwicmFuZG9tQnl0ZXMiLCJyZWFkSW50MzJMRSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFJZSxTQUFTQSxvQkFBVCxDQUE4QkMsaUJBQWUsRUFBN0MsRUFBaUQ7U0FDckQsRUFBQ0MsU0FBU0MsV0FBVCxFQUFzQkMsS0FBdEIsRUFBNkI7YUFDOUJDLE1BQVAsQ0FBZ0JGLFlBQVlHLFNBQTVCLEVBQXlDO3NCQUN6QkMsK0NBQXFCTixjQUFyQixDQUR5Qjs7eUJBR3RCTyxRQUFqQixFQUEyQjtpQkFDbEIsSUFBSUMsT0FBSixDQUFRRCxRQUFSLENBQVA7U0FKcUM7O3VCQU14QjtnQkFDUEUsVUFBVUMsZ0JBQWhCO2dCQUNNQyxTQUFTLElBQUlSLE1BQU1TLE1BQVYsQ0FBaUJILE9BQWpCLENBQWY7aUJBQ09JLHFCQUFQLEdBQStCLElBQS9CO2lCQUNPRixNQUFQO1NBVnFDLEVBQXpDO0tBRE8sRUFBVDs7O0FBYUYsU0FBU0QsY0FBVCxHQUEwQjtTQUNqQkksbUJBQVksQ0FBWixFQUFlQyxXQUFmLEVBQVA7Ozs7OyJ9
