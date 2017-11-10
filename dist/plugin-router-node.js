'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var url = require('url');
var crypto = require('crypto');
var msgFabricPacketStream = require('msg-fabric-packet-stream');

function nodejs_router_plugin(plugin_options = {}) {
  return { subclass(FabricHub_PI, bases) {
      Object.assign(FabricHub_PI.prototype, {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1ub2RlLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL25vZGUuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7VVJMfSBmcm9tICd1cmwnXG5pbXBvcnQge3JhbmRvbUJ5dGVzfSBmcm9tICdjcnlwdG8nXG5pbXBvcnQge2NyZWF0ZUJ1ZmZlclBhY2tldFBhcnNlciBhcyBjcmVhdGVQYWNrZXRQYXJzZXJ9IGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbm9kZWpzX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBAOiBzdWJjbGFzcyhGYWJyaWNIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBGYWJyaWNIdWJfUEkucHJvdG90eXBlLCBAOlxuICAgICAgcGFja2V0UGFyc2VyOiBjcmVhdGVQYWNrZXRQYXJzZXIgQCBwbHVnaW5fb3B0aW9uc1xuXG4gICAgICBfcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKSA6OlxuICAgICAgICByZXR1cm4gbmV3IFVSTChjb25uX3VybClcblxuICAgICAgX2luaXRfcm91dGVyKCkgOjpcbiAgICAgICAgY29uc3QgaWRfc2VsZiA9IHJhbmRvbV9pZF9zZWxmKClcbiAgICAgICAgY29uc3Qgcm91dGVyID0gbmV3IGJhc2VzLlJvdXRlcihpZF9zZWxmKVxuICAgICAgICByb3V0ZXIuYWxsb3dVbnZlcmlmaWVkUm91dGVzID0gdHJ1ZVxuICAgICAgICByZXR1cm4gcm91dGVyXG5cbmZ1bmN0aW9uIHJhbmRvbV9pZF9zZWxmKCkgOjpcbiAgcmV0dXJuIHJhbmRvbUJ5dGVzKDQpLnJlYWRJbnQzMkxFKClcbiJdLCJuYW1lcyI6WyJub2RlanNfcm91dGVyX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwic3ViY2xhc3MiLCJGYWJyaWNIdWJfUEkiLCJiYXNlcyIsImFzc2lnbiIsInByb3RvdHlwZSIsImNyZWF0ZVBhY2tldFBhcnNlciIsImNvbm5fdXJsIiwiVVJMIiwiaWRfc2VsZiIsInJhbmRvbV9pZF9zZWxmIiwicm91dGVyIiwiUm91dGVyIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwicmFuZG9tQnl0ZXMiLCJyZWFkSW50MzJMRSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFJZSxTQUFTQSxvQkFBVCxDQUE4QkMsaUJBQWUsRUFBN0MsRUFBaUQ7U0FDckQsRUFBQ0MsU0FBU0MsWUFBVCxFQUF1QkMsS0FBdkIsRUFBOEI7YUFDL0JDLE1BQVAsQ0FBZ0JGLGFBQWFHLFNBQTdCLEVBQTBDO3NCQUMxQkMsK0NBQXFCTixjQUFyQixDQUQwQjs7eUJBR3ZCTyxRQUFqQixFQUEyQjtpQkFDbEIsSUFBSUMsT0FBSixDQUFRRCxRQUFSLENBQVA7U0FKc0M7O3VCQU16QjtnQkFDUEUsVUFBVUMsZ0JBQWhCO2dCQUNNQyxTQUFTLElBQUlSLE1BQU1TLE1BQVYsQ0FBaUJILE9BQWpCLENBQWY7aUJBQ09JLHFCQUFQLEdBQStCLElBQS9CO2lCQUNPRixNQUFQO1NBVnNDLEVBQTFDO0tBRE8sRUFBVDs7O0FBYUYsU0FBU0QsY0FBVCxHQUEwQjtTQUNqQkksbUJBQVksQ0FBWixFQUFlQyxXQUFmLEVBQVA7Ozs7OyJ9
