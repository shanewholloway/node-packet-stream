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
        packetParser: createPacketParser__default(plugin_options),

        _init_router() {
          const id_self = random_id_self();
          const router = new bases.MessageRouter(id_self);
          router.allowUnverifiedRoutes = true;
          return router;
        } });
    } };
}

function _random_id_self() {
  return 0 | Math.random() * 0xffffffff;
}

function browser_router_plugin(plugin_options = {}) {
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        packetParser: createPacketParser.createDataViewPacketParser(plugin_options),

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
  return dv.getInt32(0, true);
}

function nodejs_router_plugin(plugin_options = {}) {
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        packetParser: createPacketParser.createBufferPacketParser(plugin_options),

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
  return crypto.randomBytes(4).readInt32LE();
}

exports.basic = basic_router_plugin;
exports.browser = browser_router_plugin;
exports.node = nodejs_router_plugin;
exports['default'] = nodejs_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9iYXNpYy5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL2Jyb3dzZXIuanN5IiwiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9ub2RlLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgY3JlYXRlUGFja2V0UGFyc2VyIGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYmFzaWNfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgY29uc3QgcmFuZG9tX2lkX3NlbGYgPSBwbHVnaW5fb3B0aW9ucy5yYW5kb21faWRfc2VsZiB8fCBfcmFuZG9tX2lkX3NlbGZcbiAgcmV0dXJuIEA6IHN1YmNsYXNzKE1lc3NhZ2VIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBNZXNzYWdlSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBhY2tldFBhcnNlcjogY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX2luaXRfcm91dGVyKCkgOjpcbiAgICAgICAgY29uc3QgaWRfc2VsZiA9IHJhbmRvbV9pZF9zZWxmKClcbiAgICAgICAgY29uc3Qgcm91dGVyID0gbmV3IGJhc2VzLk1lc3NhZ2VSb3V0ZXIoaWRfc2VsZilcbiAgICAgICAgcm91dGVyLmFsbG93VW52ZXJpZmllZFJvdXRlcyA9IHRydWVcbiAgICAgICAgcmV0dXJuIHJvdXRlclxuXG5mdW5jdGlvbiBfcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gMCB8IE1hdGgucmFuZG9tKCkgKiAweGZmZmZmZmZmXG4iLCJpbXBvcnQge2NyZWF0ZURhdGFWaWV3UGFja2V0UGFyc2VyIGFzIGNyZWF0ZVBhY2tldFBhcnNlcn0gZnJvbSAnbXNnLWZhYnJpYy1wYWNrZXQtc3RyZWFtJ1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBicm93c2VyX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBAOiBzdWJjbGFzcyhNZXNzYWdlSHViX1BJLCBiYXNlcykgOjpcbiAgICBPYmplY3QuYXNzaWduIEAgTWVzc2FnZUh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwYWNrZXRQYXJzZXI6IGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9pbml0X3JvdXRlcigpIDo6XG4gICAgICAgIGNvbnN0IGlkX3NlbGYgPSByYW5kb21faWRfc2VsZigpXG4gICAgICAgIGNvbnN0IHJvdXRlciA9IG5ldyBiYXNlcy5NZXNzYWdlUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gcmFuZG9tX2lkX3NlbGYoKSA6OlxuICBjb25zdCB1YSA9IG5ldyBJbnQzMkFycmF5KDEpLCBkdiA9IG5ldyBEYXRhVmlldyh1YS5idWZmZXIpXG4gIGlmICd1bmRlZmluZWQnICE9PSB0eXBlb2Ygd2luZG93IDo6XG4gICAgd2luZG93LmNyeXB0by5nZXRSYW5kb21WYWx1ZXModWEpXG4gIGVsc2UgOjpcbiAgICB1YVswXSA9IDB4ZmZmZmZmZmYgKiBNYXRoLnJhbmRvbSgpXG4gIHJldHVybiBkdi5nZXRJbnQzMigwLCB0cnVlKVxuIiwiaW1wb3J0IHtVUkx9IGZyb20gJ3VybCdcbmltcG9ydCB7cmFuZG9tQnl0ZXN9IGZyb20gJ2NyeXB0bydcbmltcG9ydCB7Y3JlYXRlQnVmZmVyUGFja2V0UGFyc2VyIGFzIGNyZWF0ZVBhY2tldFBhcnNlcn0gZnJvbSAnbXNnLWZhYnJpYy1wYWNrZXQtc3RyZWFtJ1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBub2RlanNfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgcmV0dXJuIEA6IHN1YmNsYXNzKE1lc3NhZ2VIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBNZXNzYWdlSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBhY2tldFBhcnNlcjogY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybCkgOjpcbiAgICAgICAgcmV0dXJuIG5ldyBVUkwoY29ubl91cmwpXG5cbiAgICAgIF9pbml0X3JvdXRlcigpIDo6XG4gICAgICAgIGNvbnN0IGlkX3NlbGYgPSByYW5kb21faWRfc2VsZigpXG4gICAgICAgIGNvbnN0IHJvdXRlciA9IG5ldyBiYXNlcy5NZXNzYWdlUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gcmFuZG9tQnl0ZXMoNCkucmVhZEludDMyTEUoKVxuIl0sIm5hbWVzIjpbImJhc2ljX3JvdXRlcl9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsInJhbmRvbV9pZF9zZWxmIiwiX3JhbmRvbV9pZF9zZWxmIiwic3ViY2xhc3MiLCJNZXNzYWdlSHViX1BJIiwiYmFzZXMiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJjcmVhdGVQYWNrZXRQYXJzZXIiLCJpZF9zZWxmIiwicm91dGVyIiwiTWVzc2FnZVJvdXRlciIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsIk1hdGgiLCJyYW5kb20iLCJicm93c2VyX3JvdXRlcl9wbHVnaW4iLCJ1YSIsIkludDMyQXJyYXkiLCJkdiIsIkRhdGFWaWV3IiwiYnVmZmVyIiwid2luZG93IiwiY3J5cHRvIiwiZ2V0UmFuZG9tVmFsdWVzIiwiZ2V0SW50MzIiLCJub2RlanNfcm91dGVyX3BsdWdpbiIsImNvbm5fdXJsIiwiVVJMIiwicmFuZG9tQnl0ZXMiLCJyZWFkSW50MzJMRSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFFZSxTQUFTQSxtQkFBVCxDQUE2QkMsaUJBQWUsRUFBNUMsRUFBZ0Q7UUFDdkRDLGlCQUFpQkQsZUFBZUMsY0FBZixJQUFpQ0MsZUFBeEQ7U0FDUyxFQUFDQyxTQUFTQyxhQUFULEVBQXdCQyxLQUF4QixFQUErQjthQUNoQ0MsTUFBUCxDQUFnQkYsY0FBY0csU0FBOUIsRUFBMkM7c0JBQzNCQyw0QkFBcUJSLGNBQXJCLENBRDJCOzt1QkFHMUI7Z0JBQ1BTLFVBQVVSLGdCQUFoQjtnQkFDTVMsU0FBUyxJQUFJTCxNQUFNTSxhQUFWLENBQXdCRixPQUF4QixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVB1QyxFQUEzQztLQURPLEVBQVQ7OztBQVVGLFNBQVNSLGVBQVQsR0FBMkI7U0FDbEIsSUFBSVcsS0FBS0MsTUFBTCxLQUFnQixVQUEzQjs7O0FDYmEsU0FBU0MscUJBQVQsQ0FBK0JmLGlCQUFlLEVBQTlDLEVBQWtEO1NBQ3RELEVBQUNHLFNBQVNDLGFBQVQsRUFBd0JDLEtBQXhCLEVBQStCO2FBQ2hDQyxNQUFQLENBQWdCRixjQUFjRyxTQUE5QixFQUEyQztzQkFDM0JDLDhDQUFxQlIsY0FBckIsQ0FEMkI7O3VCQUcxQjtnQkFDUFMsVUFBVVIsZ0JBQWhCO2dCQUNNUyxTQUFTLElBQUlMLE1BQU1NLGFBQVYsQ0FBd0JGLE9BQXhCLENBQWY7aUJBQ09HLHFCQUFQLEdBQStCLElBQS9CO2lCQUNPRixNQUFQO1NBUHVDLEVBQTNDO0tBRE8sRUFBVDs7O0FBVUYsU0FBU1QsY0FBVCxHQUEwQjtRQUNsQmUsS0FBSyxJQUFJQyxVQUFKLENBQWUsQ0FBZixDQUFYO1FBQThCQyxLQUFLLElBQUlDLFFBQUosQ0FBYUgsR0FBR0ksTUFBaEIsQ0FBbkM7TUFDRyxnQkFBZ0IsT0FBT0MsTUFBMUIsRUFBbUM7V0FDMUJDLE1BQVAsQ0FBY0MsZUFBZCxDQUE4QlAsRUFBOUI7R0FERixNQUVLO09BQ0EsQ0FBSCxJQUFRLGFBQWFILEtBQUtDLE1BQUwsRUFBckI7O1NBQ0tJLEdBQUdNLFFBQUgsQ0FBWSxDQUFaLEVBQWUsSUFBZixDQUFQOzs7QUNmYSxTQUFTQyxvQkFBVCxDQUE4QnpCLGlCQUFlLEVBQTdDLEVBQWlEO1NBQ3JELEVBQUNHLFNBQVNDLGFBQVQsRUFBd0JDLEtBQXhCLEVBQStCO2FBQ2hDQyxNQUFQLENBQWdCRixjQUFjRyxTQUE5QixFQUEyQztzQkFDM0JDLDRDQUFxQlIsY0FBckIsQ0FEMkI7O3lCQUd4QjBCLFFBQWpCLEVBQTJCO2lCQUNsQixJQUFJQyxPQUFKLENBQVFELFFBQVIsQ0FBUDtTQUp1Qzs7dUJBTTFCO2dCQUNQakIsVUFBVVIsa0JBQWhCO2dCQUNNUyxTQUFTLElBQUlMLE1BQU1NLGFBQVYsQ0FBd0JGLE9BQXhCLENBQWY7aUJBQ09HLHFCQUFQLEdBQStCLElBQS9CO2lCQUNPRixNQUFQO1NBVnVDLEVBQTNDO0tBRE8sRUFBVDs7O0FBYUYsU0FBU1QsZ0JBQVQsR0FBMEI7U0FDakIyQixtQkFBWSxDQUFaLEVBQWVDLFdBQWYsRUFBUDs7Ozs7Ozs7In0=
