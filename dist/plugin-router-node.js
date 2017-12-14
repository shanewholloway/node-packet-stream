'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var url = require('url');
var crypto = require('crypto');
var msgFabricPacketStream = require('msg-fabric-packet-stream');

function nodejs_router_plugin(plugin_options = {}) {
  return { order: -2, subclass(FabricHub_PI, bases) {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1ub2RlLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL25vZGUuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7VVJMfSBmcm9tICd1cmwnXG5pbXBvcnQge3JhbmRvbUJ5dGVzfSBmcm9tICdjcnlwdG8nXG5pbXBvcnQge2NyZWF0ZUJ1ZmZlclBhY2tldFBhcnNlciBhcyBjcmVhdGVQYWNrZXRQYXJzZXJ9IGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbm9kZWpzX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBAOiBvcmRlcjogLTIsIHN1YmNsYXNzKEZhYnJpY0h1Yl9QSSwgYmFzZXMpIDo6XG4gICAgT2JqZWN0LmFzc2lnbiBAIEZhYnJpY0h1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwYWNrZXRQYXJzZXI6IGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gcmFuZG9tQnl0ZXMoNCkucmVhZEludDMyTEUoKVxuIl0sIm5hbWVzIjpbIm5vZGVqc19yb3V0ZXJfcGx1Z2luIiwicGx1Z2luX29wdGlvbnMiLCJvcmRlciIsInN1YmNsYXNzIiwiRmFicmljSHViX1BJIiwiYmFzZXMiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJjcmVhdGVQYWNrZXRQYXJzZXIiLCJjb25uX3VybCIsIlVSTCIsImlkX3NlbGYiLCJyYW5kb21faWRfc2VsZiIsInJvdXRlciIsIlJvdXRlciIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsInJhbmRvbUJ5dGVzIiwicmVhZEludDMyTEUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBSWUsU0FBU0Esb0JBQVQsQ0FBOEJDLGlCQUFlLEVBQTdDLEVBQWlEO1NBQ3JELEVBQUNDLE9BQU8sQ0FBQyxDQUFULEVBQVlDLFNBQVNDLFlBQVQsRUFBdUJDLEtBQXZCLEVBQThCO2FBQzFDQyxNQUFQLENBQWdCRixhQUFhRyxTQUE3QixFQUEwQztzQkFDMUJDLCtDQUFxQlAsY0FBckIsQ0FEMEI7O3lCQUd2QlEsUUFBakIsRUFBMkI7aUJBQ2xCLElBQUlDLE9BQUosQ0FBUUQsUUFBUixDQUFQO1NBSnNDOzt1QkFNekI7Z0JBQ1BFLFVBQVVDLGdCQUFoQjtnQkFDTUMsU0FBUyxJQUFJUixNQUFNUyxNQUFWLENBQWlCSCxPQUFqQixDQUFmO2lCQUNPSSxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVZzQyxFQUExQztLQURPLEVBQVQ7OztBQWFGLFNBQVNELGNBQVQsR0FBMEI7U0FDakJJLG1CQUFZLENBQVosRUFBZUMsV0FBZixFQUFQOzs7OzsifQ==
