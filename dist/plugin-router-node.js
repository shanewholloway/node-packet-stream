'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var url = require('url');
var crypto = require('crypto');
var msgFabricPacketStream = require('msg-fabric-packet-stream');

function nodejs_router_plugin(plugin_options = {}) {
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        packetParser: msgFabricPacketStream.createBufferPacketParser(plugin_options),

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
  return crypto.randomBytes(4).readInt32LE();
}

exports['default'] = nodejs_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1ub2RlLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL25vZGUuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7VVJMfSBmcm9tICd1cmwnXG5pbXBvcnQge3JhbmRvbUJ5dGVzfSBmcm9tICdjcnlwdG8nXG5pbXBvcnQge2NyZWF0ZUJ1ZmZlclBhY2tldFBhcnNlciBhcyBjcmVhdGVQYWNrZXRQYXJzZXJ9IGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbm9kZWpzX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBAOiBzdWJjbGFzcyhNZXNzYWdlSHViX1BJLCBiYXNlcykgOjpcbiAgICBPYmplY3QuYXNzaWduIEAgTWVzc2FnZUh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwYWNrZXRQYXJzZXI6IGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuTWVzc2FnZVJvdXRlcihpZF9zZWxmKVxuICAgICAgICByb3V0ZXIuYWxsb3dVbnZlcmlmaWVkUm91dGVzID0gdHJ1ZVxuICAgICAgICByZXR1cm4gcm91dGVyXG5cbmZ1bmN0aW9uIHJhbmRvbV9pZF9zZWxmKCkgOjpcbiAgcmV0dXJuIHJhbmRvbUJ5dGVzKDQpLnJlYWRJbnQzMkxFKClcbiJdLCJuYW1lcyI6WyJub2RlanNfcm91dGVyX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwic3ViY2xhc3MiLCJNZXNzYWdlSHViX1BJIiwiYmFzZXMiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJjcmVhdGVQYWNrZXRQYXJzZXIiLCJjb25uX3VybCIsIlVSTCIsImlkX3NlbGYiLCJyYW5kb21faWRfc2VsZiIsInJvdXRlciIsIk1lc3NhZ2VSb3V0ZXIiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJyYW5kb21CeXRlcyIsInJlYWRJbnQzMkxFIl0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUllLFNBQVNBLG9CQUFULENBQThCQyxpQkFBZSxFQUE3QyxFQUFpRDtTQUNyRCxFQUFDQyxTQUFTQyxhQUFULEVBQXdCQyxLQUF4QixFQUErQjthQUNoQ0MsTUFBUCxDQUFnQkYsY0FBY0csU0FBOUIsRUFBMkM7c0JBQzNCQywrQ0FBcUJOLGNBQXJCLENBRDJCOzt5QkFHeEJPLFFBQWpCLEVBQTJCO2lCQUNsQixJQUFJQyxPQUFKLENBQVFELFFBQVIsQ0FBUDtTQUp1Qzs7dUJBTTFCO2dCQUNQRSxVQUFVQyxnQkFBaEI7Z0JBQ01DLFNBQVMsSUFBSVIsTUFBTVMsYUFBVixDQUF3QkgsT0FBeEIsQ0FBZjtpQkFDT0kscUJBQVAsR0FBK0IsSUFBL0I7aUJBQ09GLE1BQVA7U0FWdUMsRUFBM0M7S0FETyxFQUFUOzs7QUFhRixTQUFTRCxjQUFULEdBQTBCO1NBQ2pCSSxtQkFBWSxDQUFaLEVBQWVDLFdBQWYsRUFBUDs7Ozs7In0=
