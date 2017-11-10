'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var createPacketParser = require('msg-fabric-packet-stream');
var createPacketParser__default = _interopDefault(createPacketParser);
var url = require('url');
var crypto = require('crypto');

function basic_router_plugin(plugin_options = {}) {
  const random_id_self = plugin_options.random_id_self || _random_id_self;
  return { subclass(FabricHub_PI, bases) {
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
  return { subclass(FabricHub_PI, bases) {
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
  return { subclass(FabricHub_PI, bases) {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9iYXNpYy5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL2Jyb3dzZXIuanN5IiwiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9ub2RlLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgY3JlYXRlUGFja2V0UGFyc2VyIGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYmFzaWNfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgY29uc3QgcmFuZG9tX2lkX3NlbGYgPSBwbHVnaW5fb3B0aW9ucy5yYW5kb21faWRfc2VsZiB8fCBfcmFuZG9tX2lkX3NlbGZcbiAgcmV0dXJuIEA6IHN1YmNsYXNzKEZhYnJpY0h1Yl9QSSwgYmFzZXMpIDo6XG4gICAgT2JqZWN0LmFzc2lnbiBAIEZhYnJpY0h1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwYWNrZXRQYXJzZXI6IGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9pbml0X3JvdXRlcigpIDo6XG4gICAgICAgIGNvbnN0IGlkX3NlbGYgPSByYW5kb21faWRfc2VsZigpXG4gICAgICAgIGNvbnN0IHJvdXRlciA9IG5ldyBiYXNlcy5Sb3V0ZXIoaWRfc2VsZilcbiAgICAgICAgcm91dGVyLmFsbG93VW52ZXJpZmllZFJvdXRlcyA9IHRydWVcbiAgICAgICAgcmV0dXJuIHJvdXRlclxuXG5mdW5jdGlvbiBfcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gMCB8IE1hdGgucmFuZG9tKCkgKiAweGZmZmZmZmZmXG4iLCJpbXBvcnQge2NyZWF0ZURhdGFWaWV3UGFja2V0UGFyc2VyIGFzIGNyZWF0ZVBhY2tldFBhcnNlcn0gZnJvbSAnbXNnLWZhYnJpYy1wYWNrZXQtc3RyZWFtJ1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBicm93c2VyX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBAOiBzdWJjbGFzcyhGYWJyaWNIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBGYWJyaWNIdWJfUEkucHJvdG90eXBlLCBAOlxuICAgICAgcGFja2V0UGFyc2VyOiBjcmVhdGVQYWNrZXRQYXJzZXIgQCBwbHVnaW5fb3B0aW9uc1xuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gcmFuZG9tX2lkX3NlbGYoKSA6OlxuICBjb25zdCB1YSA9IG5ldyBJbnQzMkFycmF5KDEpLCBkdiA9IG5ldyBEYXRhVmlldyh1YS5idWZmZXIpXG4gIGlmICd1bmRlZmluZWQnICE9PSB0eXBlb2Ygd2luZG93IDo6XG4gICAgd2luZG93LmNyeXB0by5nZXRSYW5kb21WYWx1ZXModWEpXG4gIGVsc2UgOjpcbiAgICB1YVswXSA9IDB4ZmZmZmZmZmYgKiBNYXRoLnJhbmRvbSgpXG4gIHJldHVybiBkdi5nZXRJbnQzMigwLCB0cnVlKVxuIiwiaW1wb3J0IHtVUkx9IGZyb20gJ3VybCdcbmltcG9ydCB7cmFuZG9tQnl0ZXN9IGZyb20gJ2NyeXB0bydcbmltcG9ydCB7Y3JlYXRlQnVmZmVyUGFja2V0UGFyc2VyIGFzIGNyZWF0ZVBhY2tldFBhcnNlcn0gZnJvbSAnbXNnLWZhYnJpYy1wYWNrZXQtc3RyZWFtJ1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBub2RlanNfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgcmV0dXJuIEA6IHN1YmNsYXNzKEZhYnJpY0h1Yl9QSSwgYmFzZXMpIDo6XG4gICAgT2JqZWN0LmFzc2lnbiBAIEZhYnJpY0h1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwYWNrZXRQYXJzZXI6IGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gcmFuZG9tQnl0ZXMoNCkucmVhZEludDMyTEUoKVxuIl0sIm5hbWVzIjpbImJhc2ljX3JvdXRlcl9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsInJhbmRvbV9pZF9zZWxmIiwiX3JhbmRvbV9pZF9zZWxmIiwic3ViY2xhc3MiLCJGYWJyaWNIdWJfUEkiLCJiYXNlcyIsImFzc2lnbiIsInByb3RvdHlwZSIsImNyZWF0ZVBhY2tldFBhcnNlciIsImlkX3NlbGYiLCJyb3V0ZXIiLCJSb3V0ZXIiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJNYXRoIiwicmFuZG9tIiwiYnJvd3Nlcl9yb3V0ZXJfcGx1Z2luIiwidWEiLCJJbnQzMkFycmF5IiwiZHYiLCJEYXRhVmlldyIsImJ1ZmZlciIsIndpbmRvdyIsImNyeXB0byIsImdldFJhbmRvbVZhbHVlcyIsImdldEludDMyIiwibm9kZWpzX3JvdXRlcl9wbHVnaW4iLCJjb25uX3VybCIsIlVSTCIsInJhbmRvbUJ5dGVzIiwicmVhZEludDMyTEUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O0FBRWUsU0FBU0EsbUJBQVQsQ0FBNkJDLGlCQUFlLEVBQTVDLEVBQWdEO1FBQ3ZEQyxpQkFBaUJELGVBQWVDLGNBQWYsSUFBaUNDLGVBQXhEO1NBQ1MsRUFBQ0MsU0FBU0MsWUFBVCxFQUF1QkMsS0FBdkIsRUFBOEI7YUFDL0JDLE1BQVAsQ0FBZ0JGLGFBQWFHLFNBQTdCLEVBQTBDO3NCQUMxQkMsNEJBQXFCUixjQUFyQixDQUQwQjs7dUJBR3pCO2dCQUNQUyxVQUFVUixnQkFBaEI7Z0JBQ01TLFNBQVMsSUFBSUwsTUFBTU0sTUFBVixDQUFpQkYsT0FBakIsQ0FBZjtpQkFDT0cscUJBQVAsR0FBK0IsSUFBL0I7aUJBQ09GLE1BQVA7U0FQc0MsRUFBMUM7S0FETyxFQUFUOzs7QUFVRixTQUFTUixlQUFULEdBQTJCO1NBQ2xCLElBQUlXLEtBQUtDLE1BQUwsS0FBZ0IsVUFBM0I7OztBQ2JhLFNBQVNDLHFCQUFULENBQStCZixpQkFBZSxFQUE5QyxFQUFrRDtTQUN0RCxFQUFDRyxTQUFTQyxZQUFULEVBQXVCQyxLQUF2QixFQUE4QjthQUMvQkMsTUFBUCxDQUFnQkYsYUFBYUcsU0FBN0IsRUFBMEM7c0JBQzFCQyw4Q0FBcUJSLGNBQXJCLENBRDBCOzt1QkFHekI7Z0JBQ1BTLFVBQVVSLGdCQUFoQjtnQkFDTVMsU0FBUyxJQUFJTCxNQUFNTSxNQUFWLENBQWlCRixPQUFqQixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVBzQyxFQUExQztLQURPLEVBQVQ7OztBQVVGLFNBQVNULGNBQVQsR0FBMEI7UUFDbEJlLEtBQUssSUFBSUMsVUFBSixDQUFlLENBQWYsQ0FBWDtRQUE4QkMsS0FBSyxJQUFJQyxRQUFKLENBQWFILEdBQUdJLE1BQWhCLENBQW5DO01BQ0csZ0JBQWdCLE9BQU9DLE1BQTFCLEVBQW1DO1dBQzFCQyxNQUFQLENBQWNDLGVBQWQsQ0FBOEJQLEVBQTlCO0dBREYsTUFFSztPQUNBLENBQUgsSUFBUSxhQUFhSCxLQUFLQyxNQUFMLEVBQXJCOztTQUNLSSxHQUFHTSxRQUFILENBQVksQ0FBWixFQUFlLElBQWYsQ0FBUDs7O0FDZmEsU0FBU0Msb0JBQVQsQ0FBOEJ6QixpQkFBZSxFQUE3QyxFQUFpRDtTQUNyRCxFQUFDRyxTQUFTQyxZQUFULEVBQXVCQyxLQUF2QixFQUE4QjthQUMvQkMsTUFBUCxDQUFnQkYsYUFBYUcsU0FBN0IsRUFBMEM7c0JBQzFCQyw0Q0FBcUJSLGNBQXJCLENBRDBCOzt5QkFHdkIwQixRQUFqQixFQUEyQjtpQkFDbEIsSUFBSUMsT0FBSixDQUFRRCxRQUFSLENBQVA7U0FKc0M7O3VCQU16QjtnQkFDUGpCLFVBQVVSLGtCQUFoQjtnQkFDTVMsU0FBUyxJQUFJTCxNQUFNTSxNQUFWLENBQWlCRixPQUFqQixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVZzQyxFQUExQztLQURPLEVBQVQ7OztBQWFGLFNBQVNULGdCQUFULEdBQTBCO1NBQ2pCMkIsbUJBQVksQ0FBWixFQUFlQyxXQUFmLEVBQVA7Ozs7Ozs7OyJ9
