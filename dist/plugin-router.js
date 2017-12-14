'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var createPacketParser = require('msg-fabric-packet-stream');
var createPacketParser__default = _interopDefault(createPacketParser);
var url = require('url');
var crypto = require('crypto');

function basic_router_plugin(plugin_options = {}) {
  const random_id_self = plugin_options.random_id_self || _random_id_self;
  return { order: -2, subclass(FabricHub_PI, bases) {
      Object.assign(FabricHub_PI.prototype, {
        packetParser: createPacketParser__default(plugin_options),

        _init_router() {
          const id_self = random_id_self();
          const router = new bases.Router(id_self);
          router.allowUnverifiedRoutes = true;
          return router;
        } });
    } };
}

function _random_id_self() {
  return 0 | Math.random() * 0xffffffff;
}

function browser_router_plugin(plugin_options = {}) {
  return { order: -2, subclass(FabricHub_PI, bases) {
      Object.assign(FabricHub_PI.prototype, {
        packetParser: createPacketParser.createDataViewPacketParser(plugin_options),

        _init_router() {
          const id_self = random_id_self();
          const router = new bases.Router(id_self);
          router.allowUnverifiedRoutes = true;
          return router;
        } });
    } };
}

function random_id_self() {
  const ua = new Int32Array(1),
        dv = new DataView(ua.buffer);
  if ('undefined' !== typeof window) {
    window.crypto.getRandomValues(ua);
  } else {
    ua[0] = 0xffffffff * Math.random();
  }
  return dv.getInt32(0, true);
}

function nodejs_router_plugin(plugin_options = {}) {
  return { order: -2, subclass(FabricHub_PI, bases) {
      Object.assign(FabricHub_PI.prototype, {
        packetParser: createPacketParser.createBufferPacketParser(plugin_options),

        _parseConnectURL(conn_url) {
          return new url.URL(conn_url);
        },

        _init_router() {
          const id_self = random_id_self$1();
          const router = new bases.Router(id_self);
          router.allowUnverifiedRoutes = true;
          return router;
        } });
    } };
}

function random_id_self$1() {
  return crypto.randomBytes(4).readInt32LE();
}

exports.basic = basic_router_plugin;
exports.browser = browser_router_plugin;
exports.node = nodejs_router_plugin;
exports['default'] = nodejs_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9iYXNpYy5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL2Jyb3dzZXIuanN5IiwiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9ub2RlLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgY3JlYXRlUGFja2V0UGFyc2VyIGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYmFzaWNfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgY29uc3QgcmFuZG9tX2lkX3NlbGYgPSBwbHVnaW5fb3B0aW9ucy5yYW5kb21faWRfc2VsZiB8fCBfcmFuZG9tX2lkX3NlbGZcbiAgcmV0dXJuIEA6IG9yZGVyOiAtMiwgc3ViY2xhc3MoRmFicmljSHViX1BJLCBiYXNlcykgOjpcbiAgICBPYmplY3QuYXNzaWduIEAgRmFicmljSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBhY2tldFBhcnNlcjogY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX2luaXRfcm91dGVyKCkgOjpcbiAgICAgICAgY29uc3QgaWRfc2VsZiA9IHJhbmRvbV9pZF9zZWxmKClcbiAgICAgICAgY29uc3Qgcm91dGVyID0gbmV3IGJhc2VzLlJvdXRlcihpZF9zZWxmKVxuICAgICAgICByb3V0ZXIuYWxsb3dVbnZlcmlmaWVkUm91dGVzID0gdHJ1ZVxuICAgICAgICByZXR1cm4gcm91dGVyXG5cbmZ1bmN0aW9uIF9yYW5kb21faWRfc2VsZigpIDo6XG4gIHJldHVybiAwIHwgTWF0aC5yYW5kb20oKSAqIDB4ZmZmZmZmZmZcbiIsImltcG9ydCB7Y3JlYXRlRGF0YVZpZXdQYWNrZXRQYXJzZXIgYXMgY3JlYXRlUGFja2V0UGFyc2VyfSBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJyb3dzZXJfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgcmV0dXJuIEA6IG9yZGVyOiAtMiwgc3ViY2xhc3MoRmFicmljSHViX1BJLCBiYXNlcykgOjpcbiAgICBPYmplY3QuYXNzaWduIEAgRmFicmljSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBhY2tldFBhcnNlcjogY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX2luaXRfcm91dGVyKCkgOjpcbiAgICAgICAgY29uc3QgaWRfc2VsZiA9IHJhbmRvbV9pZF9zZWxmKClcbiAgICAgICAgY29uc3Qgcm91dGVyID0gbmV3IGJhc2VzLlJvdXRlcihpZF9zZWxmKVxuICAgICAgICByb3V0ZXIuYWxsb3dVbnZlcmlmaWVkUm91dGVzID0gdHJ1ZVxuICAgICAgICByZXR1cm4gcm91dGVyXG5cbmZ1bmN0aW9uIHJhbmRvbV9pZF9zZWxmKCkgOjpcbiAgY29uc3QgdWEgPSBuZXcgSW50MzJBcnJheSgxKSwgZHYgPSBuZXcgRGF0YVZpZXcodWEuYnVmZmVyKVxuICBpZiAndW5kZWZpbmVkJyAhPT0gdHlwZW9mIHdpbmRvdyA6OlxuICAgIHdpbmRvdy5jcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKHVhKVxuICBlbHNlIDo6XG4gICAgdWFbMF0gPSAweGZmZmZmZmZmICogTWF0aC5yYW5kb20oKVxuICByZXR1cm4gZHYuZ2V0SW50MzIoMCwgdHJ1ZSlcbiIsImltcG9ydCB7VVJMfSBmcm9tICd1cmwnXG5pbXBvcnQge3JhbmRvbUJ5dGVzfSBmcm9tICdjcnlwdG8nXG5pbXBvcnQge2NyZWF0ZUJ1ZmZlclBhY2tldFBhcnNlciBhcyBjcmVhdGVQYWNrZXRQYXJzZXJ9IGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbm9kZWpzX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBAOiBvcmRlcjogLTIsIHN1YmNsYXNzKEZhYnJpY0h1Yl9QSSwgYmFzZXMpIDo6XG4gICAgT2JqZWN0LmFzc2lnbiBAIEZhYnJpY0h1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwYWNrZXRQYXJzZXI6IGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gcmFuZG9tQnl0ZXMoNCkucmVhZEludDMyTEUoKVxuIl0sIm5hbWVzIjpbImJhc2ljX3JvdXRlcl9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsInJhbmRvbV9pZF9zZWxmIiwiX3JhbmRvbV9pZF9zZWxmIiwib3JkZXIiLCJzdWJjbGFzcyIsIkZhYnJpY0h1Yl9QSSIsImJhc2VzIiwiYXNzaWduIiwicHJvdG90eXBlIiwiY3JlYXRlUGFja2V0UGFyc2VyIiwiaWRfc2VsZiIsInJvdXRlciIsIlJvdXRlciIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsIk1hdGgiLCJyYW5kb20iLCJicm93c2VyX3JvdXRlcl9wbHVnaW4iLCJ1YSIsIkludDMyQXJyYXkiLCJkdiIsIkRhdGFWaWV3IiwiYnVmZmVyIiwid2luZG93IiwiY3J5cHRvIiwiZ2V0UmFuZG9tVmFsdWVzIiwiZ2V0SW50MzIiLCJub2RlanNfcm91dGVyX3BsdWdpbiIsImNvbm5fdXJsIiwiVVJMIiwicmFuZG9tQnl0ZXMiLCJyZWFkSW50MzJMRSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFFZSxTQUFTQSxtQkFBVCxDQUE2QkMsaUJBQWUsRUFBNUMsRUFBZ0Q7UUFDdkRDLGlCQUFpQkQsZUFBZUMsY0FBZixJQUFpQ0MsZUFBeEQ7U0FDUyxFQUFDQyxPQUFPLENBQUMsQ0FBVCxFQUFZQyxTQUFTQyxZQUFULEVBQXVCQyxLQUF2QixFQUE4QjthQUMxQ0MsTUFBUCxDQUFnQkYsYUFBYUcsU0FBN0IsRUFBMEM7c0JBQzFCQyw0QkFBcUJULGNBQXJCLENBRDBCOzt1QkFHekI7Z0JBQ1BVLFVBQVVULGdCQUFoQjtnQkFDTVUsU0FBUyxJQUFJTCxNQUFNTSxNQUFWLENBQWlCRixPQUFqQixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVBzQyxFQUExQztLQURPLEVBQVQ7OztBQVVGLFNBQVNULGVBQVQsR0FBMkI7U0FDbEIsSUFBSVksS0FBS0MsTUFBTCxLQUFnQixVQUEzQjs7O0FDYmEsU0FBU0MscUJBQVQsQ0FBK0JoQixpQkFBZSxFQUE5QyxFQUFrRDtTQUN0RCxFQUFDRyxPQUFPLENBQUMsQ0FBVCxFQUFZQyxTQUFTQyxZQUFULEVBQXVCQyxLQUF2QixFQUE4QjthQUMxQ0MsTUFBUCxDQUFnQkYsYUFBYUcsU0FBN0IsRUFBMEM7c0JBQzFCQyw4Q0FBcUJULGNBQXJCLENBRDBCOzt1QkFHekI7Z0JBQ1BVLFVBQVVULGdCQUFoQjtnQkFDTVUsU0FBUyxJQUFJTCxNQUFNTSxNQUFWLENBQWlCRixPQUFqQixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVBzQyxFQUExQztLQURPLEVBQVQ7OztBQVVGLFNBQVNWLGNBQVQsR0FBMEI7UUFDbEJnQixLQUFLLElBQUlDLFVBQUosQ0FBZSxDQUFmLENBQVg7UUFBOEJDLEtBQUssSUFBSUMsUUFBSixDQUFhSCxHQUFHSSxNQUFoQixDQUFuQztNQUNHLGdCQUFnQixPQUFPQyxNQUExQixFQUFtQztXQUMxQkMsTUFBUCxDQUFjQyxlQUFkLENBQThCUCxFQUE5QjtHQURGLE1BRUs7T0FDQSxDQUFILElBQVEsYUFBYUgsS0FBS0MsTUFBTCxFQUFyQjs7U0FDS0ksR0FBR00sUUFBSCxDQUFZLENBQVosRUFBZSxJQUFmLENBQVA7OztBQ2ZhLFNBQVNDLG9CQUFULENBQThCMUIsaUJBQWUsRUFBN0MsRUFBaUQ7U0FDckQsRUFBQ0csT0FBTyxDQUFDLENBQVQsRUFBWUMsU0FBU0MsWUFBVCxFQUF1QkMsS0FBdkIsRUFBOEI7YUFDMUNDLE1BQVAsQ0FBZ0JGLGFBQWFHLFNBQTdCLEVBQTBDO3NCQUMxQkMsNENBQXFCVCxjQUFyQixDQUQwQjs7eUJBR3ZCMkIsUUFBakIsRUFBMkI7aUJBQ2xCLElBQUlDLE9BQUosQ0FBUUQsUUFBUixDQUFQO1NBSnNDOzt1QkFNekI7Z0JBQ1BqQixVQUFVVCxrQkFBaEI7Z0JBQ01VLFNBQVMsSUFBSUwsTUFBTU0sTUFBVixDQUFpQkYsT0FBakIsQ0FBZjtpQkFDT0cscUJBQVAsR0FBK0IsSUFBL0I7aUJBQ09GLE1BQVA7U0FWc0MsRUFBMUM7S0FETyxFQUFUOzs7QUFhRixTQUFTVixnQkFBVCxHQUEwQjtTQUNqQjRCLG1CQUFZLENBQVosRUFBZUMsV0FBZixFQUFQOzs7Ozs7OzsifQ==
