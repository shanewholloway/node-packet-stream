'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var createPacketParser = _interopDefault(require('msg-fabric-packet-stream'));

function basic_router_plugin(plugin_options = {}) {
  const random_id_self = plugin_options.random_id_self || _random_id_self;
  return { subclass(FabricHub_PI, bases) {
      Object.assign(FabricHub_PI.prototype, {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1iYXNpYy5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9iYXNpYy5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGNyZWF0ZVBhY2tldFBhcnNlciBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJhc2ljX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGNvbnN0IHJhbmRvbV9pZF9zZWxmID0gcGx1Z2luX29wdGlvbnMucmFuZG9tX2lkX3NlbGYgfHwgX3JhbmRvbV9pZF9zZWxmXG4gIHJldHVybiBAOiBzdWJjbGFzcyhGYWJyaWNIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBGYWJyaWNIdWJfUEkucHJvdG90eXBlLCBAOlxuICAgICAgcGFja2V0UGFyc2VyOiBjcmVhdGVQYWNrZXRQYXJzZXIgQCBwbHVnaW5fb3B0aW9uc1xuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gX3JhbmRvbV9pZF9zZWxmKCkgOjpcbiAgcmV0dXJuIDAgfCBNYXRoLnJhbmRvbSgpICogMHhmZmZmZmZmZlxuIl0sIm5hbWVzIjpbImJhc2ljX3JvdXRlcl9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsInJhbmRvbV9pZF9zZWxmIiwiX3JhbmRvbV9pZF9zZWxmIiwic3ViY2xhc3MiLCJGYWJyaWNIdWJfUEkiLCJiYXNlcyIsImFzc2lnbiIsInByb3RvdHlwZSIsImNyZWF0ZVBhY2tldFBhcnNlciIsImlkX3NlbGYiLCJyb3V0ZXIiLCJSb3V0ZXIiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJNYXRoIiwicmFuZG9tIl0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUVlLFNBQVNBLG1CQUFULENBQTZCQyxpQkFBZSxFQUE1QyxFQUFnRDtRQUN2REMsaUJBQWlCRCxlQUFlQyxjQUFmLElBQWlDQyxlQUF4RDtTQUNTLEVBQUNDLFNBQVNDLFlBQVQsRUFBdUJDLEtBQXZCLEVBQThCO2FBQy9CQyxNQUFQLENBQWdCRixhQUFhRyxTQUE3QixFQUEwQztzQkFDMUJDLG1CQUFxQlIsY0FBckIsQ0FEMEI7O3VCQUd6QjtnQkFDUFMsVUFBVVIsZ0JBQWhCO2dCQUNNUyxTQUFTLElBQUlMLE1BQU1NLE1BQVYsQ0FBaUJGLE9BQWpCLENBQWY7aUJBQ09HLHFCQUFQLEdBQStCLElBQS9CO2lCQUNPRixNQUFQO1NBUHNDLEVBQTFDO0tBRE8sRUFBVDs7O0FBVUYsU0FBU1IsZUFBVCxHQUEyQjtTQUNsQixJQUFJVyxLQUFLQyxNQUFMLEtBQWdCLFVBQTNCOzs7OzsifQ==
