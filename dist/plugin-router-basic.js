'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var createPacketParser = _interopDefault(require('msg-fabric-packet-stream'));

function basic_router_plugin(plugin_options = {}) {
  const random_id_self = plugin_options.random_id_self || _random_id_self;
  return { order: -2, subclass(FabricHub_PI, bases) {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1iYXNpYy5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9iYXNpYy5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGNyZWF0ZVBhY2tldFBhcnNlciBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJhc2ljX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGNvbnN0IHJhbmRvbV9pZF9zZWxmID0gcGx1Z2luX29wdGlvbnMucmFuZG9tX2lkX3NlbGYgfHwgX3JhbmRvbV9pZF9zZWxmXG4gIHJldHVybiBAOiBvcmRlcjogLTIsIHN1YmNsYXNzKEZhYnJpY0h1Yl9QSSwgYmFzZXMpIDo6XG4gICAgT2JqZWN0LmFzc2lnbiBAIEZhYnJpY0h1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwYWNrZXRQYXJzZXI6IGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9pbml0X3JvdXRlcigpIDo6XG4gICAgICAgIGNvbnN0IGlkX3NlbGYgPSByYW5kb21faWRfc2VsZigpXG4gICAgICAgIGNvbnN0IHJvdXRlciA9IG5ldyBiYXNlcy5Sb3V0ZXIoaWRfc2VsZilcbiAgICAgICAgcm91dGVyLmFsbG93VW52ZXJpZmllZFJvdXRlcyA9IHRydWVcbiAgICAgICAgcmV0dXJuIHJvdXRlclxuXG5mdW5jdGlvbiBfcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gMCB8IE1hdGgucmFuZG9tKCkgKiAweGZmZmZmZmZmXG4iXSwibmFtZXMiOlsiYmFzaWNfcm91dGVyX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwicmFuZG9tX2lkX3NlbGYiLCJfcmFuZG9tX2lkX3NlbGYiLCJvcmRlciIsInN1YmNsYXNzIiwiRmFicmljSHViX1BJIiwiYmFzZXMiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJjcmVhdGVQYWNrZXRQYXJzZXIiLCJpZF9zZWxmIiwicm91dGVyIiwiUm91dGVyIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwiTWF0aCIsInJhbmRvbSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFFZSxTQUFTQSxtQkFBVCxDQUE2QkMsaUJBQWUsRUFBNUMsRUFBZ0Q7UUFDdkRDLGlCQUFpQkQsZUFBZUMsY0FBZixJQUFpQ0MsZUFBeEQ7U0FDUyxFQUFDQyxPQUFPLENBQUMsQ0FBVCxFQUFZQyxTQUFTQyxZQUFULEVBQXVCQyxLQUF2QixFQUE4QjthQUMxQ0MsTUFBUCxDQUFnQkYsYUFBYUcsU0FBN0IsRUFBMEM7c0JBQzFCQyxtQkFBcUJULGNBQXJCLENBRDBCOzt1QkFHekI7Z0JBQ1BVLFVBQVVULGdCQUFoQjtnQkFDTVUsU0FBUyxJQUFJTCxNQUFNTSxNQUFWLENBQWlCRixPQUFqQixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVBzQyxFQUExQztLQURPLEVBQVQ7OztBQVVGLFNBQVNULGVBQVQsR0FBMkI7U0FDbEIsSUFBSVksS0FBS0MsTUFBTCxLQUFnQixVQUEzQjs7Ozs7In0=
