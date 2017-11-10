'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var createPacketParser = _interopDefault(require('msg-fabric-packet-stream'));

function basic_router_plugin(plugin_options = {}) {
  const random_id_self = plugin_options.random_id_self || _random_id_self;
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        packetParser: createPacketParser(plugin_options),

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

exports['default'] = basic_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1iYXNpYy5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9iYXNpYy5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGNyZWF0ZVBhY2tldFBhcnNlciBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJhc2ljX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGNvbnN0IHJhbmRvbV9pZF9zZWxmID0gcGx1Z2luX29wdGlvbnMucmFuZG9tX2lkX3NlbGYgfHwgX3JhbmRvbV9pZF9zZWxmXG4gIHJldHVybiBAOiBzdWJjbGFzcyhNZXNzYWdlSHViX1BJLCBiYXNlcykgOjpcbiAgICBPYmplY3QuYXNzaWduIEAgTWVzc2FnZUh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwYWNrZXRQYXJzZXI6IGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9pbml0X3JvdXRlcigpIDo6XG4gICAgICAgIGNvbnN0IGlkX3NlbGYgPSByYW5kb21faWRfc2VsZigpXG4gICAgICAgIGNvbnN0IHJvdXRlciA9IG5ldyBiYXNlcy5NZXNzYWdlUm91dGVyKGlkX3NlbGYpXG4gICAgICAgIHJvdXRlci5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgPSB0cnVlXG4gICAgICAgIHJldHVybiByb3V0ZXJcblxuZnVuY3Rpb24gX3JhbmRvbV9pZF9zZWxmKCkgOjpcbiAgcmV0dXJuIDAgfCBNYXRoLnJhbmRvbSgpICogMHhmZmZmZmZmZlxuIl0sIm5hbWVzIjpbImJhc2ljX3JvdXRlcl9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsInJhbmRvbV9pZF9zZWxmIiwiX3JhbmRvbV9pZF9zZWxmIiwic3ViY2xhc3MiLCJNZXNzYWdlSHViX1BJIiwiYmFzZXMiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJjcmVhdGVQYWNrZXRQYXJzZXIiLCJpZF9zZWxmIiwicm91dGVyIiwiTWVzc2FnZVJvdXRlciIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsIk1hdGgiLCJyYW5kb20iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBRWUsU0FBU0EsbUJBQVQsQ0FBNkJDLGlCQUFlLEVBQTVDLEVBQWdEO1FBQ3ZEQyxpQkFBaUJELGVBQWVDLGNBQWYsSUFBaUNDLGVBQXhEO1NBQ1MsRUFBQ0MsU0FBU0MsYUFBVCxFQUF3QkMsS0FBeEIsRUFBK0I7YUFDaENDLE1BQVAsQ0FBZ0JGLGNBQWNHLFNBQTlCLEVBQTJDO3NCQUMzQkMsbUJBQXFCUixjQUFyQixDQUQyQjs7dUJBRzFCO2dCQUNQUyxVQUFVUixnQkFBaEI7Z0JBQ01TLFNBQVMsSUFBSUwsTUFBTU0sYUFBVixDQUF3QkYsT0FBeEIsQ0FBZjtpQkFDT0cscUJBQVAsR0FBK0IsSUFBL0I7aUJBQ09GLE1BQVA7U0FQdUMsRUFBM0M7S0FETyxFQUFUOzs7QUFVRixTQUFTUixlQUFULEdBQTJCO1NBQ2xCLElBQUlXLEtBQUtDLE1BQUwsS0FBZ0IsVUFBM0I7Ozs7OyJ9
