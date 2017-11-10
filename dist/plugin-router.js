'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var createPacketParser = require('msg-fabric-packet-stream');
var createPacketParser__default = _interopDefault(createPacketParser);
var url = require('url');
var crypto = require('crypto');

function basic_router_plugin(plugin_options = {}) {
  const random_id_self = plugin_options.random_id_self || _random_id_self;
  return { subclass(FiberHub_PI, bases) {
      Object.assign(FiberHub_PI.prototype, {
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
  return { subclass(FiberHub_PI, bases) {
      Object.assign(FiberHub_PI.prototype, {
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
  return { subclass(FiberHub_PI, bases) {
      Object.assign(FiberHub_PI.prototype, {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9iYXNpYy5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL2Jyb3dzZXIuanN5IiwiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9ub2RlLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgY3JlYXRlUGFja2V0UGFyc2VyIGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYmFzaWNfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgY29uc3QgcmFuZG9tX2lkX3NlbGYgPSBwbHVnaW5fb3B0aW9ucy5yYW5kb21faWRfc2VsZiB8fCBfcmFuZG9tX2lkX3NlbGZcbiAgcmV0dXJuIEA6IHN1YmNsYXNzKEZpYmVySHViX1BJLCBiYXNlcykgOjpcbiAgICBPYmplY3QuYXNzaWduIEAgRmliZXJIdWJfUEkucHJvdG90eXBlLCBAOlxuICAgICAgcGFja2V0UGFyc2VyOiBjcmVhdGVQYWNrZXRQYXJzZXIgQCBwbHVnaW5fb3B0aW9uc1xuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gX3JhbmRvbV9pZF9zZWxmKCkgOjpcbiAgcmV0dXJuIDAgfCBNYXRoLnJhbmRvbSgpICogMHhmZmZmZmZmZlxuIiwiaW1wb3J0IHtjcmVhdGVEYXRhVmlld1BhY2tldFBhcnNlciBhcyBjcmVhdGVQYWNrZXRQYXJzZXJ9IGZyb20gJ21zZy1mYWJyaWMtcGFja2V0LXN0cmVhbSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYnJvd3Nlcl9yb3V0ZXJfcGx1Z2luKHBsdWdpbl9vcHRpb25zPXt9KSA6OlxuICByZXR1cm4gQDogc3ViY2xhc3MoRmliZXJIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBGaWJlckh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwYWNrZXRQYXJzZXI6IGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9pbml0X3JvdXRlcigpIDo6XG4gICAgICAgIGNvbnN0IGlkX3NlbGYgPSByYW5kb21faWRfc2VsZigpXG4gICAgICAgIGNvbnN0IHJvdXRlciA9IG5ldyBiYXNlcy5Sb3V0ZXIoaWRfc2VsZilcbiAgICAgICAgcm91dGVyLmFsbG93VW52ZXJpZmllZFJvdXRlcyA9IHRydWVcbiAgICAgICAgcmV0dXJuIHJvdXRlclxuXG5mdW5jdGlvbiByYW5kb21faWRfc2VsZigpIDo6XG4gIGNvbnN0IHVhID0gbmV3IEludDMyQXJyYXkoMSksIGR2ID0gbmV3IERhdGFWaWV3KHVhLmJ1ZmZlcilcbiAgaWYgJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiB3aW5kb3cgOjpcbiAgICB3aW5kb3cuY3J5cHRvLmdldFJhbmRvbVZhbHVlcyh1YSlcbiAgZWxzZSA6OlxuICAgIHVhWzBdID0gMHhmZmZmZmZmZiAqIE1hdGgucmFuZG9tKClcbiAgcmV0dXJuIGR2LmdldEludDMyKDAsIHRydWUpXG4iLCJpbXBvcnQge1VSTH0gZnJvbSAndXJsJ1xuaW1wb3J0IHtyYW5kb21CeXRlc30gZnJvbSAnY3J5cHRvJ1xuaW1wb3J0IHtjcmVhdGVCdWZmZXJQYWNrZXRQYXJzZXIgYXMgY3JlYXRlUGFja2V0UGFyc2VyfSBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG5vZGVqc19yb3V0ZXJfcGx1Z2luKHBsdWdpbl9vcHRpb25zPXt9KSA6OlxuICByZXR1cm4gQDogc3ViY2xhc3MoRmliZXJIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBGaWJlckh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwYWNrZXRQYXJzZXI6IGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gcmFuZG9tQnl0ZXMoNCkucmVhZEludDMyTEUoKVxuIl0sIm5hbWVzIjpbImJhc2ljX3JvdXRlcl9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsInJhbmRvbV9pZF9zZWxmIiwiX3JhbmRvbV9pZF9zZWxmIiwic3ViY2xhc3MiLCJGaWJlckh1Yl9QSSIsImJhc2VzIiwiYXNzaWduIiwicHJvdG90eXBlIiwiY3JlYXRlUGFja2V0UGFyc2VyIiwiaWRfc2VsZiIsInJvdXRlciIsIlJvdXRlciIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsIk1hdGgiLCJyYW5kb20iLCJicm93c2VyX3JvdXRlcl9wbHVnaW4iLCJ1YSIsIkludDMyQXJyYXkiLCJkdiIsIkRhdGFWaWV3IiwiYnVmZmVyIiwid2luZG93IiwiY3J5cHRvIiwiZ2V0UmFuZG9tVmFsdWVzIiwiZ2V0SW50MzIiLCJub2RlanNfcm91dGVyX3BsdWdpbiIsImNvbm5fdXJsIiwiVVJMIiwicmFuZG9tQnl0ZXMiLCJyZWFkSW50MzJMRSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFFZSxTQUFTQSxtQkFBVCxDQUE2QkMsaUJBQWUsRUFBNUMsRUFBZ0Q7UUFDdkRDLGlCQUFpQkQsZUFBZUMsY0FBZixJQUFpQ0MsZUFBeEQ7U0FDUyxFQUFDQyxTQUFTQyxXQUFULEVBQXNCQyxLQUF0QixFQUE2QjthQUM5QkMsTUFBUCxDQUFnQkYsWUFBWUcsU0FBNUIsRUFBeUM7c0JBQ3pCQyw0QkFBcUJSLGNBQXJCLENBRHlCOzt1QkFHeEI7Z0JBQ1BTLFVBQVVSLGdCQUFoQjtnQkFDTVMsU0FBUyxJQUFJTCxNQUFNTSxNQUFWLENBQWlCRixPQUFqQixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVBxQyxFQUF6QztLQURPLEVBQVQ7OztBQVVGLFNBQVNSLGVBQVQsR0FBMkI7U0FDbEIsSUFBSVcsS0FBS0MsTUFBTCxLQUFnQixVQUEzQjs7O0FDYmEsU0FBU0MscUJBQVQsQ0FBK0JmLGlCQUFlLEVBQTlDLEVBQWtEO1NBQ3RELEVBQUNHLFNBQVNDLFdBQVQsRUFBc0JDLEtBQXRCLEVBQTZCO2FBQzlCQyxNQUFQLENBQWdCRixZQUFZRyxTQUE1QixFQUF5QztzQkFDekJDLDhDQUFxQlIsY0FBckIsQ0FEeUI7O3VCQUd4QjtnQkFDUFMsVUFBVVIsZ0JBQWhCO2dCQUNNUyxTQUFTLElBQUlMLE1BQU1NLE1BQVYsQ0FBaUJGLE9BQWpCLENBQWY7aUJBQ09HLHFCQUFQLEdBQStCLElBQS9CO2lCQUNPRixNQUFQO1NBUHFDLEVBQXpDO0tBRE8sRUFBVDs7O0FBVUYsU0FBU1QsY0FBVCxHQUEwQjtRQUNsQmUsS0FBSyxJQUFJQyxVQUFKLENBQWUsQ0FBZixDQUFYO1FBQThCQyxLQUFLLElBQUlDLFFBQUosQ0FBYUgsR0FBR0ksTUFBaEIsQ0FBbkM7TUFDRyxnQkFBZ0IsT0FBT0MsTUFBMUIsRUFBbUM7V0FDMUJDLE1BQVAsQ0FBY0MsZUFBZCxDQUE4QlAsRUFBOUI7R0FERixNQUVLO09BQ0EsQ0FBSCxJQUFRLGFBQWFILEtBQUtDLE1BQUwsRUFBckI7O1NBQ0tJLEdBQUdNLFFBQUgsQ0FBWSxDQUFaLEVBQWUsSUFBZixDQUFQOzs7QUNmYSxTQUFTQyxvQkFBVCxDQUE4QnpCLGlCQUFlLEVBQTdDLEVBQWlEO1NBQ3JELEVBQUNHLFNBQVNDLFdBQVQsRUFBc0JDLEtBQXRCLEVBQTZCO2FBQzlCQyxNQUFQLENBQWdCRixZQUFZRyxTQUE1QixFQUF5QztzQkFDekJDLDRDQUFxQlIsY0FBckIsQ0FEeUI7O3lCQUd0QjBCLFFBQWpCLEVBQTJCO2lCQUNsQixJQUFJQyxPQUFKLENBQVFELFFBQVIsQ0FBUDtTQUpxQzs7dUJBTXhCO2dCQUNQakIsVUFBVVIsa0JBQWhCO2dCQUNNUyxTQUFTLElBQUlMLE1BQU1NLE1BQVYsQ0FBaUJGLE9BQWpCLENBQWY7aUJBQ09HLHFCQUFQLEdBQStCLElBQS9CO2lCQUNPRixNQUFQO1NBVnFDLEVBQXpDO0tBRE8sRUFBVDs7O0FBYUYsU0FBU1QsZ0JBQVQsR0FBMEI7U0FDakIyQixtQkFBWSxDQUFaLEVBQWVDLFdBQWYsRUFBUDs7Ozs7Ozs7In0=
