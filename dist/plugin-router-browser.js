'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var msgFabricPacketStream = require('msg-fabric-packet-stream');

function browser_router_plugin(plugin_options = {}) {
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        packetParser: msgFabricPacketStream.createDataViewPacketParser(plugin_options),

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

exports['default'] = browser_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1icm93c2VyLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL3BsdWdpbnMvcm91dGVyL2Jyb3dzZXIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7Y3JlYXRlRGF0YVZpZXdQYWNrZXRQYXJzZXIgYXMgY3JlYXRlUGFja2V0UGFyc2VyfSBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJyb3dzZXJfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgcmV0dXJuIEA6IHN1YmNsYXNzKE1lc3NhZ2VIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBNZXNzYWdlSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBhY2tldFBhcnNlcjogY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX2luaXRfcm91dGVyKCkgOjpcbiAgICAgICAgY29uc3QgaWRfc2VsZiA9IHJhbmRvbV9pZF9zZWxmKClcbiAgICAgICAgY29uc3Qgcm91dGVyID0gbmV3IGJhc2VzLk1lc3NhZ2VSb3V0ZXIoaWRfc2VsZilcbiAgICAgICAgcm91dGVyLmFsbG93VW52ZXJpZmllZFJvdXRlcyA9IHRydWVcbiAgICAgICAgcmV0dXJuIHJvdXRlclxuXG5mdW5jdGlvbiByYW5kb21faWRfc2VsZigpIDo6XG4gIGNvbnN0IHVhID0gbmV3IEludDMyQXJyYXkoMSksIGR2ID0gbmV3IERhdGFWaWV3KHVhLmJ1ZmZlcilcbiAgaWYgJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiB3aW5kb3cgOjpcbiAgICB3aW5kb3cuY3J5cHRvLmdldFJhbmRvbVZhbHVlcyh1YSlcbiAgZWxzZSA6OlxuICAgIHVhWzBdID0gMHhmZmZmZmZmZiAqIE1hdGgucmFuZG9tKClcbiAgcmV0dXJuIGR2LmdldEludDMyKDAsIHRydWUpXG4iXSwibmFtZXMiOlsiYnJvd3Nlcl9yb3V0ZXJfcGx1Z2luIiwicGx1Z2luX29wdGlvbnMiLCJzdWJjbGFzcyIsIk1lc3NhZ2VIdWJfUEkiLCJiYXNlcyIsImFzc2lnbiIsInByb3RvdHlwZSIsImNyZWF0ZVBhY2tldFBhcnNlciIsImlkX3NlbGYiLCJyYW5kb21faWRfc2VsZiIsInJvdXRlciIsIk1lc3NhZ2VSb3V0ZXIiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJ1YSIsIkludDMyQXJyYXkiLCJkdiIsIkRhdGFWaWV3IiwiYnVmZmVyIiwid2luZG93IiwiY3J5cHRvIiwiZ2V0UmFuZG9tVmFsdWVzIiwiTWF0aCIsInJhbmRvbSIsImdldEludDMyIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFFZSxTQUFTQSxxQkFBVCxDQUErQkMsaUJBQWUsRUFBOUMsRUFBa0Q7U0FDdEQsRUFBQ0MsU0FBU0MsYUFBVCxFQUF3QkMsS0FBeEIsRUFBK0I7YUFDaENDLE1BQVAsQ0FBZ0JGLGNBQWNHLFNBQTlCLEVBQTJDO3NCQUMzQkMsaURBQXFCTixjQUFyQixDQUQyQjs7dUJBRzFCO2dCQUNQTyxVQUFVQyxnQkFBaEI7Z0JBQ01DLFNBQVMsSUFBSU4sTUFBTU8sYUFBVixDQUF3QkgsT0FBeEIsQ0FBZjtpQkFDT0kscUJBQVAsR0FBK0IsSUFBL0I7aUJBQ09GLE1BQVA7U0FQdUMsRUFBM0M7S0FETyxFQUFUOzs7QUFVRixTQUFTRCxjQUFULEdBQTBCO1FBQ2xCSSxLQUFLLElBQUlDLFVBQUosQ0FBZSxDQUFmLENBQVg7UUFBOEJDLEtBQUssSUFBSUMsUUFBSixDQUFhSCxHQUFHSSxNQUFoQixDQUFuQztNQUNHLGdCQUFnQixPQUFPQyxNQUExQixFQUFtQztXQUMxQkMsTUFBUCxDQUFjQyxlQUFkLENBQThCUCxFQUE5QjtHQURGLE1BRUs7T0FDQSxDQUFILElBQVEsYUFBYVEsS0FBS0MsTUFBTCxFQUFyQjs7U0FDS1AsR0FBR1EsUUFBSCxDQUFZLENBQVosRUFBZSxJQUFmLENBQVA7Ozs7OyJ9