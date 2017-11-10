'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var createPacketParser = _interopDefault(require('msg-fabric-packet-stream'));

function basic_router_plugin(plugin_options = {}) {
  const random_id_self = plugin_options.random_id_self || _random_id_self;
  return { subclass(FiberHub_PI, bases) {
      Object.assign(FiberHub_PI.prototype, {
        packetParser: createPacketParser(plugin_options),

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

exports['default'] = basic_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1iYXNpYy5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9iYXNpYy5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGNyZWF0ZVBhY2tldFBhcnNlciBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJhc2ljX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGNvbnN0IHJhbmRvbV9pZF9zZWxmID0gcGx1Z2luX29wdGlvbnMucmFuZG9tX2lkX3NlbGYgfHwgX3JhbmRvbV9pZF9zZWxmXG4gIHJldHVybiBAOiBzdWJjbGFzcyhGaWJlckh1Yl9QSSwgYmFzZXMpIDo6XG4gICAgT2JqZWN0LmFzc2lnbiBAIEZpYmVySHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBhY2tldFBhcnNlcjogY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX2luaXRfcm91dGVyKCkgOjpcbiAgICAgICAgY29uc3QgaWRfc2VsZiA9IHJhbmRvbV9pZF9zZWxmKClcbiAgICAgICAgY29uc3Qgcm91dGVyID0gbmV3IGJhc2VzLlJvdXRlcihpZF9zZWxmKVxuICAgICAgICByb3V0ZXIuYWxsb3dVbnZlcmlmaWVkUm91dGVzID0gdHJ1ZVxuICAgICAgICByZXR1cm4gcm91dGVyXG5cbmZ1bmN0aW9uIF9yYW5kb21faWRfc2VsZigpIDo6XG4gIHJldHVybiAwIHwgTWF0aC5yYW5kb20oKSAqIDB4ZmZmZmZmZmZcbiJdLCJuYW1lcyI6WyJiYXNpY19yb3V0ZXJfcGx1Z2luIiwicGx1Z2luX29wdGlvbnMiLCJyYW5kb21faWRfc2VsZiIsIl9yYW5kb21faWRfc2VsZiIsInN1YmNsYXNzIiwiRmliZXJIdWJfUEkiLCJiYXNlcyIsImFzc2lnbiIsInByb3RvdHlwZSIsImNyZWF0ZVBhY2tldFBhcnNlciIsImlkX3NlbGYiLCJyb3V0ZXIiLCJSb3V0ZXIiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJNYXRoIiwicmFuZG9tIl0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUVlLFNBQVNBLG1CQUFULENBQTZCQyxpQkFBZSxFQUE1QyxFQUFnRDtRQUN2REMsaUJBQWlCRCxlQUFlQyxjQUFmLElBQWlDQyxlQUF4RDtTQUNTLEVBQUNDLFNBQVNDLFdBQVQsRUFBc0JDLEtBQXRCLEVBQTZCO2FBQzlCQyxNQUFQLENBQWdCRixZQUFZRyxTQUE1QixFQUF5QztzQkFDekJDLG1CQUFxQlIsY0FBckIsQ0FEeUI7O3VCQUd4QjtnQkFDUFMsVUFBVVIsZ0JBQWhCO2dCQUNNUyxTQUFTLElBQUlMLE1BQU1NLE1BQVYsQ0FBaUJGLE9BQWpCLENBQWY7aUJBQ09HLHFCQUFQLEdBQStCLElBQS9CO2lCQUNPRixNQUFQO1NBUHFDLEVBQXpDO0tBRE8sRUFBVDs7O0FBVUYsU0FBU1IsZUFBVCxHQUEyQjtTQUNsQixJQUFJVyxLQUFLQyxNQUFMLEtBQWdCLFVBQTNCOzs7OzsifQ==
