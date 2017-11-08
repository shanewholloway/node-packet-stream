'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var createPacketParser = require('msg-fabric-packet-stream');
var createPacketParser__default = _interopDefault(createPacketParser);
var url = require('url');
var crypto = require('crypto');

function basic_router_plugin(plugin_options = {}) {
  const random_id_self = plugin_options.random_id_self || _random_id_self;
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        _init_packetParser() {
          return createPacketParser__default(plugin_options);
        },

        _init_router() {
          const id_self = random_id_self();
          const router = new bases.MessageRouter(id_self);
          router.allowUnverifiedRoutes = true;
          return router;
        } });
    } };
}

function _random_id_self() {
  return 0 | Math.random() * 0x7fffffff;
}

function browser_router_plugin(plugin_options = {}) {
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        _init_packetParser() {
          return createPacketParser.createDataViewPacketParser(plugin_options);
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
  const ua = new Int32Array(1),
        dv = new DataView(ua.buffer);
  if ('undefined' !== typeof window) {
    window.crypto.getRandomValues(ua);
  } else {
    ua[0] = 0xffffffff * Math.random();
  }
  return dv.getUint32(0, true);
}

function nodejs_router_plugin(plugin_options = {}) {
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        _init_packetParser() {
          return createPacketParser.createBufferPacketParser(plugin_options);
        },

        _parseConnectURL(conn_url) {
          return new url.URL(conn_url);
        },

        _init_router() {
          const id_self = random_id_self$1();
          const router = new bases.MessageRouter(id_self);
          router.allowUnverifiedRoutes = true;
          return router;
        } });
    } };
}

function random_id_self$1() {
  return crypto.randomBytes(4).readUInt32LE();
}

exports.basic = basic_router_plugin;
exports.browser = browser_router_plugin;
exports.node = nodejs_router_plugin;
exports['default'] = nodejs_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9iYXNpYy5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL2Jyb3dzZXIuanN5IiwiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9ub2RlLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgY3JlYXRlUGFja2V0UGFyc2VyIGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYmFzaWNfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgY29uc3QgcmFuZG9tX2lkX3NlbGYgPSBwbHVnaW5fb3B0aW9ucy5yYW5kb21faWRfc2VsZiB8fCBfcmFuZG9tX2lkX3NlbGZcbiAgcmV0dXJuIEA6IHN1YmNsYXNzKE1lc3NhZ2VIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBNZXNzYWdlSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIF9pbml0X3BhY2tldFBhcnNlcigpIDo6XG4gICAgICAgIHJldHVybiBjcmVhdGVQYWNrZXRQYXJzZXIgQCBwbHVnaW5fb3B0aW9uc1xuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuTWVzc2FnZVJvdXRlcihpZF9zZWxmKVxuICAgICAgICByb3V0ZXIuYWxsb3dVbnZlcmlmaWVkUm91dGVzID0gdHJ1ZVxuICAgICAgICByZXR1cm4gcm91dGVyXG5cbmZ1bmN0aW9uIF9yYW5kb21faWRfc2VsZigpIDo6XG4gIHJldHVybiAwIHwgTWF0aC5yYW5kb20oKSAqIDB4N2ZmZmZmZmZcbiIsImltcG9ydCB7Y3JlYXRlRGF0YVZpZXdQYWNrZXRQYXJzZXIgYXMgY3JlYXRlUGFja2V0UGFyc2VyfSBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJyb3dzZXJfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgcmV0dXJuIEA6IHN1YmNsYXNzKE1lc3NhZ2VIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBNZXNzYWdlSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIF9pbml0X3BhY2tldFBhcnNlcigpIDo6XG4gICAgICAgIHJldHVybiBjcmVhdGVQYWNrZXRQYXJzZXIgQCBwbHVnaW5fb3B0aW9uc1xuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuTWVzc2FnZVJvdXRlcihpZF9zZWxmKVxuICAgICAgICByb3V0ZXIuYWxsb3dVbnZlcmlmaWVkUm91dGVzID0gdHJ1ZVxuICAgICAgICByZXR1cm4gcm91dGVyXG5cbmZ1bmN0aW9uIHJhbmRvbV9pZF9zZWxmKCkgOjpcbiAgY29uc3QgdWEgPSBuZXcgSW50MzJBcnJheSgxKSwgZHYgPSBuZXcgRGF0YVZpZXcodWEuYnVmZmVyKVxuICBpZiAndW5kZWZpbmVkJyAhPT0gdHlwZW9mIHdpbmRvdyA6OlxuICAgIHdpbmRvdy5jcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKHVhKVxuICBlbHNlIDo6XG4gICAgdWFbMF0gPSAweGZmZmZmZmZmICogTWF0aC5yYW5kb20oKVxuICByZXR1cm4gZHYuZ2V0VWludDMyKDAsIHRydWUpXG4iLCJpbXBvcnQge1VSTH0gZnJvbSAndXJsJ1xuaW1wb3J0IHtyYW5kb21CeXRlc30gZnJvbSAnY3J5cHRvJ1xuaW1wb3J0IHtjcmVhdGVCdWZmZXJQYWNrZXRQYXJzZXIgYXMgY3JlYXRlUGFja2V0UGFyc2VyfSBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG5vZGVqc19yb3V0ZXJfcGx1Z2luKHBsdWdpbl9vcHRpb25zPXt9KSA6OlxuICByZXR1cm4gQDogc3ViY2xhc3MoTWVzc2FnZUh1Yl9QSSwgYmFzZXMpIDo6XG4gICAgT2JqZWN0LmFzc2lnbiBAIE1lc3NhZ2VIdWJfUEkucHJvdG90eXBlLCBAOlxuICAgICAgX2luaXRfcGFja2V0UGFyc2VyKCkgOjpcbiAgICAgICAgcmV0dXJuIGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuTWVzc2FnZVJvdXRlcihpZF9zZWxmKVxuICAgICAgICByb3V0ZXIuYWxsb3dVbnZlcmlmaWVkUm91dGVzID0gdHJ1ZVxuICAgICAgICByZXR1cm4gcm91dGVyXG5cbmZ1bmN0aW9uIHJhbmRvbV9pZF9zZWxmKCkgOjpcbiAgcmV0dXJuIHJhbmRvbUJ5dGVzKDQpLnJlYWRVSW50MzJMRSgpXG4iXSwibmFtZXMiOlsiYmFzaWNfcm91dGVyX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwicmFuZG9tX2lkX3NlbGYiLCJfcmFuZG9tX2lkX3NlbGYiLCJzdWJjbGFzcyIsIk1lc3NhZ2VIdWJfUEkiLCJiYXNlcyIsImFzc2lnbiIsInByb3RvdHlwZSIsImNyZWF0ZVBhY2tldFBhcnNlciIsImlkX3NlbGYiLCJyb3V0ZXIiLCJNZXNzYWdlUm91dGVyIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwiTWF0aCIsInJhbmRvbSIsImJyb3dzZXJfcm91dGVyX3BsdWdpbiIsInVhIiwiSW50MzJBcnJheSIsImR2IiwiRGF0YVZpZXciLCJidWZmZXIiLCJ3aW5kb3ciLCJjcnlwdG8iLCJnZXRSYW5kb21WYWx1ZXMiLCJnZXRVaW50MzIiLCJub2RlanNfcm91dGVyX3BsdWdpbiIsImNvbm5fdXJsIiwiVVJMIiwicmFuZG9tQnl0ZXMiLCJyZWFkVUludDMyTEUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O0FBRWUsU0FBU0EsbUJBQVQsQ0FBNkJDLGlCQUFlLEVBQTVDLEVBQWdEO1FBQ3ZEQyxpQkFBaUJELGVBQWVDLGNBQWYsSUFBaUNDLGVBQXhEO1NBQ1MsRUFBQ0MsU0FBU0MsYUFBVCxFQUF3QkMsS0FBeEIsRUFBK0I7YUFDaENDLE1BQVAsQ0FBZ0JGLGNBQWNHLFNBQTlCLEVBQTJDOzZCQUNwQjtpQkFDWkMsNEJBQXFCUixjQUFyQixDQUFQO1NBRnVDOzt1QkFJMUI7Z0JBQ1BTLFVBQVVSLGdCQUFoQjtnQkFDTVMsU0FBUyxJQUFJTCxNQUFNTSxhQUFWLENBQXdCRixPQUF4QixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVJ1QyxFQUEzQztLQURPLEVBQVQ7OztBQVdGLFNBQVNSLGVBQVQsR0FBMkI7U0FDbEIsSUFBSVcsS0FBS0MsTUFBTCxLQUFnQixVQUEzQjs7O0FDZGEsU0FBU0MscUJBQVQsQ0FBK0JmLGlCQUFlLEVBQTlDLEVBQWtEO1NBQ3RELEVBQUNHLFNBQVNDLGFBQVQsRUFBd0JDLEtBQXhCLEVBQStCO2FBQ2hDQyxNQUFQLENBQWdCRixjQUFjRyxTQUE5QixFQUEyQzs2QkFDcEI7aUJBQ1pDLDhDQUFxQlIsY0FBckIsQ0FBUDtTQUZ1Qzs7dUJBSTFCO2dCQUNQUyxVQUFVUixnQkFBaEI7Z0JBQ01TLFNBQVMsSUFBSUwsTUFBTU0sYUFBVixDQUF3QkYsT0FBeEIsQ0FBZjtpQkFDT0cscUJBQVAsR0FBK0IsSUFBL0I7aUJBQ09GLE1BQVA7U0FSdUMsRUFBM0M7S0FETyxFQUFUOzs7QUFXRixTQUFTVCxjQUFULEdBQTBCO1FBQ2xCZSxLQUFLLElBQUlDLFVBQUosQ0FBZSxDQUFmLENBQVg7UUFBOEJDLEtBQUssSUFBSUMsUUFBSixDQUFhSCxHQUFHSSxNQUFoQixDQUFuQztNQUNHLGdCQUFnQixPQUFPQyxNQUExQixFQUFtQztXQUMxQkMsTUFBUCxDQUFjQyxlQUFkLENBQThCUCxFQUE5QjtHQURGLE1BRUs7T0FDQSxDQUFILElBQVEsYUFBYUgsS0FBS0MsTUFBTCxFQUFyQjs7U0FDS0ksR0FBR00sU0FBSCxDQUFhLENBQWIsRUFBZ0IsSUFBaEIsQ0FBUDs7O0FDaEJhLFNBQVNDLG9CQUFULENBQThCekIsaUJBQWUsRUFBN0MsRUFBaUQ7U0FDckQsRUFBQ0csU0FBU0MsYUFBVCxFQUF3QkMsS0FBeEIsRUFBK0I7YUFDaENDLE1BQVAsQ0FBZ0JGLGNBQWNHLFNBQTlCLEVBQTJDOzZCQUNwQjtpQkFDWkMsNENBQXFCUixjQUFyQixDQUFQO1NBRnVDOzt5QkFJeEIwQixRQUFqQixFQUEyQjtpQkFDbEIsSUFBSUMsT0FBSixDQUFRRCxRQUFSLENBQVA7U0FMdUM7O3VCQU8xQjtnQkFDUGpCLFVBQVVSLGtCQUFoQjtnQkFDTVMsU0FBUyxJQUFJTCxNQUFNTSxhQUFWLENBQXdCRixPQUF4QixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVh1QyxFQUEzQztLQURPLEVBQVQ7OztBQWNGLFNBQVNULGdCQUFULEdBQTBCO1NBQ2pCMkIsbUJBQVksQ0FBWixFQUFlQyxZQUFmLEVBQVA7Ozs7Ozs7OyJ9
