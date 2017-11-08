import { URL } from 'url';
import { randomBytes } from 'crypto';
import { createBufferPacketParser } from 'msg-fabric-packet-stream';

function nodejs_router_plugin(plugin_options = {}) {
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        _init_packetParser() {
          return createBufferPacketParser(plugin_options);
        },

        _parseConnectURL(conn_url) {
          return new URL(conn_url);
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
  return randomBytes(4).readUInt32LE();
}

export default nodejs_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1ub2RlLm1qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9ub2RlLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1VSTH0gZnJvbSAndXJsJ1xuaW1wb3J0IHtyYW5kb21CeXRlc30gZnJvbSAnY3J5cHRvJ1xuaW1wb3J0IHtjcmVhdGVCdWZmZXJQYWNrZXRQYXJzZXIgYXMgY3JlYXRlUGFja2V0UGFyc2VyfSBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG5vZGVqc19yb3V0ZXJfcGx1Z2luKHBsdWdpbl9vcHRpb25zPXt9KSA6OlxuICByZXR1cm4gQDogc3ViY2xhc3MoTWVzc2FnZUh1Yl9QSSwgYmFzZXMpIDo6XG4gICAgT2JqZWN0LmFzc2lnbiBAIE1lc3NhZ2VIdWJfUEkucHJvdG90eXBlLCBAOlxuICAgICAgX2luaXRfcGFja2V0UGFyc2VyKCkgOjpcbiAgICAgICAgcmV0dXJuIGNyZWF0ZVBhY2tldFBhcnNlciBAIHBsdWdpbl9vcHRpb25zXG5cbiAgICAgIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG4gICAgICBfaW5pdF9yb3V0ZXIoKSA6OlxuICAgICAgICBjb25zdCBpZF9zZWxmID0gcmFuZG9tX2lkX3NlbGYoKVxuICAgICAgICBjb25zdCByb3V0ZXIgPSBuZXcgYmFzZXMuTWVzc2FnZVJvdXRlcihpZF9zZWxmKVxuICAgICAgICByb3V0ZXIuYWxsb3dVbnZlcmlmaWVkUm91dGVzID0gdHJ1ZVxuICAgICAgICByZXR1cm4gcm91dGVyXG5cbmZ1bmN0aW9uIHJhbmRvbV9pZF9zZWxmKCkgOjpcbiAgcmV0dXJuIHJhbmRvbUJ5dGVzKDQpLnJlYWRVSW50MzJMRSgpXG4iXSwibmFtZXMiOlsibm9kZWpzX3JvdXRlcl9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsInN1YmNsYXNzIiwiTWVzc2FnZUh1Yl9QSSIsImJhc2VzIiwiYXNzaWduIiwicHJvdG90eXBlIiwiY3JlYXRlUGFja2V0UGFyc2VyIiwiY29ubl91cmwiLCJVUkwiLCJpZF9zZWxmIiwicmFuZG9tX2lkX3NlbGYiLCJyb3V0ZXIiLCJNZXNzYWdlUm91dGVyIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwicmFuZG9tQnl0ZXMiLCJyZWFkVUludDMyTEUiXSwibWFwcGluZ3MiOiI7Ozs7QUFJZSxTQUFTQSxvQkFBVCxDQUE4QkMsaUJBQWUsRUFBN0MsRUFBaUQ7U0FDckQsRUFBQ0MsU0FBU0MsYUFBVCxFQUF3QkMsS0FBeEIsRUFBK0I7YUFDaENDLE1BQVAsQ0FBZ0JGLGNBQWNHLFNBQTlCLEVBQTJDOzZCQUNwQjtpQkFDWkMseUJBQXFCTixjQUFyQixDQUFQO1NBRnVDOzt5QkFJeEJPLFFBQWpCLEVBQTJCO2lCQUNsQixJQUFJQyxHQUFKLENBQVFELFFBQVIsQ0FBUDtTQUx1Qzs7dUJBTzFCO2dCQUNQRSxVQUFVQyxnQkFBaEI7Z0JBQ01DLFNBQVMsSUFBSVIsTUFBTVMsYUFBVixDQUF3QkgsT0FBeEIsQ0FBZjtpQkFDT0kscUJBQVAsR0FBK0IsSUFBL0I7aUJBQ09GLE1BQVA7U0FYdUMsRUFBM0M7S0FETyxFQUFUOzs7QUFjRixTQUFTRCxjQUFULEdBQTBCO1NBQ2pCSSxZQUFZLENBQVosRUFBZUMsWUFBZixFQUFQOzs7OzsifQ==
