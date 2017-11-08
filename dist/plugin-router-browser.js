'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var msgFabricPacketStream = require('msg-fabric-packet-stream');

function browser_router_plugin(plugin_options = {}) {
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        _init_packetParser() {
          return msgFabricPacketStream.createDataViewPacketParser(plugin_options);
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

exports['default'] = browser_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1icm93c2VyLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL2Jyb3dzZXIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7Y3JlYXRlRGF0YVZpZXdQYWNrZXRQYXJzZXIgYXMgY3JlYXRlUGFja2V0UGFyc2VyfSBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJyb3dzZXJfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgcmV0dXJuIEA6IHN1YmNsYXNzKE1lc3NhZ2VIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBNZXNzYWdlSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIF9pbml0X3BhY2tldFBhcnNlcigpIDo6XG4gICAgICAgIHJldHVybiBjcmVhdGVQYWNrZXRQYXJzZXIgQCBwbHVnaW5fb3B0aW9uc1xuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuTWVzc2FnZVJvdXRlcihpZF9zZWxmKVxuICAgICAgICByb3V0ZXIuYWxsb3dVbnZlcmlmaWVkUm91dGVzID0gdHJ1ZVxuICAgICAgICByZXR1cm4gcm91dGVyXG5cbmZ1bmN0aW9uIHJhbmRvbV9pZF9zZWxmKCkgOjpcbiAgY29uc3QgdWEgPSBuZXcgSW50MzJBcnJheSgxKSwgZHYgPSBuZXcgRGF0YVZpZXcodWEuYnVmZmVyKVxuICBpZiAndW5kZWZpbmVkJyAhPT0gdHlwZW9mIHdpbmRvdyA6OlxuICAgIHdpbmRvdy5jcnlwdG8uZ2V0UmFuZG9tVmFsdWVzKHVhKVxuICBlbHNlIDo6XG4gICAgdWFbMF0gPSAweGZmZmZmZmZmICogTWF0aC5yYW5kb20oKVxuICByZXR1cm4gZHYuZ2V0VWludDMyKDAsIHRydWUpXG4iXSwibmFtZXMiOlsiYnJvd3Nlcl9yb3V0ZXJfcGx1Z2luIiwicGx1Z2luX29wdGlvbnMiLCJzdWJjbGFzcyIsIk1lc3NhZ2VIdWJfUEkiLCJiYXNlcyIsImFzc2lnbiIsInByb3RvdHlwZSIsImNyZWF0ZVBhY2tldFBhcnNlciIsImlkX3NlbGYiLCJyYW5kb21faWRfc2VsZiIsInJvdXRlciIsIk1lc3NhZ2VSb3V0ZXIiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJ1YSIsIkludDMyQXJyYXkiLCJkdiIsIkRhdGFWaWV3IiwiYnVmZmVyIiwid2luZG93IiwiY3J5cHRvIiwiZ2V0UmFuZG9tVmFsdWVzIiwiTWF0aCIsInJhbmRvbSIsImdldFVpbnQzMiJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBRWUsU0FBU0EscUJBQVQsQ0FBK0JDLGlCQUFlLEVBQTlDLEVBQWtEO1NBQ3RELEVBQUNDLFNBQVNDLGFBQVQsRUFBd0JDLEtBQXhCLEVBQStCO2FBQ2hDQyxNQUFQLENBQWdCRixjQUFjRyxTQUE5QixFQUEyQzs2QkFDcEI7aUJBQ1pDLGlEQUFxQk4sY0FBckIsQ0FBUDtTQUZ1Qzs7dUJBSTFCO2dCQUNQTyxVQUFVQyxnQkFBaEI7Z0JBQ01DLFNBQVMsSUFBSU4sTUFBTU8sYUFBVixDQUF3QkgsT0FBeEIsQ0FBZjtpQkFDT0kscUJBQVAsR0FBK0IsSUFBL0I7aUJBQ09GLE1BQVA7U0FSdUMsRUFBM0M7S0FETyxFQUFUOzs7QUFXRixTQUFTRCxjQUFULEdBQTBCO1FBQ2xCSSxLQUFLLElBQUlDLFVBQUosQ0FBZSxDQUFmLENBQVg7UUFBOEJDLEtBQUssSUFBSUMsUUFBSixDQUFhSCxHQUFHSSxNQUFoQixDQUFuQztNQUNHLGdCQUFnQixPQUFPQyxNQUExQixFQUFtQztXQUMxQkMsTUFBUCxDQUFjQyxlQUFkLENBQThCUCxFQUE5QjtHQURGLE1BRUs7T0FDQSxDQUFILElBQVEsYUFBYVEsS0FBS0MsTUFBTCxFQUFyQjs7U0FDS1AsR0FBR1EsU0FBSCxDQUFhLENBQWIsRUFBZ0IsSUFBaEIsQ0FBUDs7Ozs7In0=
