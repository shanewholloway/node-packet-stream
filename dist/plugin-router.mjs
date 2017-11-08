import createPacketParser, { createBufferPacketParser, createDataViewPacketParser } from 'msg-fabric-packet-stream';
import { URL } from 'url';
import { randomBytes } from 'crypto';

function basic_router_plugin(plugin_options = {}) {
  const random_id_self = plugin_options.random_id_self || _random_id_self;
  return { subclass(MessageHub_PI, bases) {
      Object.assign(MessageHub_PI.prototype, {
        _init_packetParser() {
          return createPacketParser(plugin_options);
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
          return createDataViewPacketParser(plugin_options);
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
          return createBufferPacketParser(plugin_options);
        },

        _parseConnectURL(conn_url) {
          return new URL(conn_url);
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
  return randomBytes(4).readUInt32LE();
}

export { basic_router_plugin as basic, browser_router_plugin as browser, nodejs_router_plugin as node };
export default nodejs_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci5tanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvcGx1Z2lucy9yb3V0ZXIvYmFzaWMuanN5IiwiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9icm93c2VyLmpzeSIsIi4uL2NvZGUvcGx1Z2lucy9yb3V0ZXIvbm9kZS5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGNyZWF0ZVBhY2tldFBhcnNlciBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJhc2ljX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGNvbnN0IHJhbmRvbV9pZF9zZWxmID0gcGx1Z2luX29wdGlvbnMucmFuZG9tX2lkX3NlbGYgfHwgX3JhbmRvbV9pZF9zZWxmXG4gIHJldHVybiBAOiBzdWJjbGFzcyhNZXNzYWdlSHViX1BJLCBiYXNlcykgOjpcbiAgICBPYmplY3QuYXNzaWduIEAgTWVzc2FnZUh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBfaW5pdF9wYWNrZXRQYXJzZXIoKSA6OlxuICAgICAgICByZXR1cm4gY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX2luaXRfcm91dGVyKCkgOjpcbiAgICAgICAgY29uc3QgaWRfc2VsZiA9IHJhbmRvbV9pZF9zZWxmKClcbiAgICAgICAgY29uc3Qgcm91dGVyID0gbmV3IGJhc2VzLk1lc3NhZ2VSb3V0ZXIoaWRfc2VsZilcbiAgICAgICAgcm91dGVyLmFsbG93VW52ZXJpZmllZFJvdXRlcyA9IHRydWVcbiAgICAgICAgcmV0dXJuIHJvdXRlclxuXG5mdW5jdGlvbiBfcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gMCB8IE1hdGgucmFuZG9tKCkgKiAweDdmZmZmZmZmXG4iLCJpbXBvcnQge2NyZWF0ZURhdGFWaWV3UGFja2V0UGFyc2VyIGFzIGNyZWF0ZVBhY2tldFBhcnNlcn0gZnJvbSAnbXNnLWZhYnJpYy1wYWNrZXQtc3RyZWFtJ1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBicm93c2VyX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBAOiBzdWJjbGFzcyhNZXNzYWdlSHViX1BJLCBiYXNlcykgOjpcbiAgICBPYmplY3QuYXNzaWduIEAgTWVzc2FnZUh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBfaW5pdF9wYWNrZXRQYXJzZXIoKSA6OlxuICAgICAgICByZXR1cm4gY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX2luaXRfcm91dGVyKCkgOjpcbiAgICAgICAgY29uc3QgaWRfc2VsZiA9IHJhbmRvbV9pZF9zZWxmKClcbiAgICAgICAgY29uc3Qgcm91dGVyID0gbmV3IGJhc2VzLk1lc3NhZ2VSb3V0ZXIoaWRfc2VsZilcbiAgICAgICAgcm91dGVyLmFsbG93VW52ZXJpZmllZFJvdXRlcyA9IHRydWVcbiAgICAgICAgcmV0dXJuIHJvdXRlclxuXG5mdW5jdGlvbiByYW5kb21faWRfc2VsZigpIDo6XG4gIGNvbnN0IHVhID0gbmV3IEludDMyQXJyYXkoMSksIGR2ID0gbmV3IERhdGFWaWV3KHVhLmJ1ZmZlcilcbiAgaWYgJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiB3aW5kb3cgOjpcbiAgICB3aW5kb3cuY3J5cHRvLmdldFJhbmRvbVZhbHVlcyh1YSlcbiAgZWxzZSA6OlxuICAgIHVhWzBdID0gMHhmZmZmZmZmZiAqIE1hdGgucmFuZG9tKClcbiAgcmV0dXJuIGR2LmdldFVpbnQzMigwLCB0cnVlKVxuIiwiaW1wb3J0IHtVUkx9IGZyb20gJ3VybCdcbmltcG9ydCB7cmFuZG9tQnl0ZXN9IGZyb20gJ2NyeXB0bydcbmltcG9ydCB7Y3JlYXRlQnVmZmVyUGFja2V0UGFyc2VyIGFzIGNyZWF0ZVBhY2tldFBhcnNlcn0gZnJvbSAnbXNnLWZhYnJpYy1wYWNrZXQtc3RyZWFtJ1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBub2RlanNfcm91dGVyX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgcmV0dXJuIEA6IHN1YmNsYXNzKE1lc3NhZ2VIdWJfUEksIGJhc2VzKSA6OlxuICAgIE9iamVjdC5hc3NpZ24gQCBNZXNzYWdlSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIF9pbml0X3BhY2tldFBhcnNlcigpIDo6XG4gICAgICAgIHJldHVybiBjcmVhdGVQYWNrZXRQYXJzZXIgQCBwbHVnaW5fb3B0aW9uc1xuXG4gICAgICBfcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKSA6OlxuICAgICAgICByZXR1cm4gbmV3IFVSTChjb25uX3VybClcblxuICAgICAgX2luaXRfcm91dGVyKCkgOjpcbiAgICAgICAgY29uc3QgaWRfc2VsZiA9IHJhbmRvbV9pZF9zZWxmKClcbiAgICAgICAgY29uc3Qgcm91dGVyID0gbmV3IGJhc2VzLk1lc3NhZ2VSb3V0ZXIoaWRfc2VsZilcbiAgICAgICAgcm91dGVyLmFsbG93VW52ZXJpZmllZFJvdXRlcyA9IHRydWVcbiAgICAgICAgcmV0dXJuIHJvdXRlclxuXG5mdW5jdGlvbiByYW5kb21faWRfc2VsZigpIDo6XG4gIHJldHVybiByYW5kb21CeXRlcyg0KS5yZWFkVUludDMyTEUoKVxuIl0sIm5hbWVzIjpbImJhc2ljX3JvdXRlcl9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsInJhbmRvbV9pZF9zZWxmIiwiX3JhbmRvbV9pZF9zZWxmIiwic3ViY2xhc3MiLCJNZXNzYWdlSHViX1BJIiwiYmFzZXMiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJjcmVhdGVQYWNrZXRQYXJzZXIiLCJpZF9zZWxmIiwicm91dGVyIiwiTWVzc2FnZVJvdXRlciIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsIk1hdGgiLCJyYW5kb20iLCJicm93c2VyX3JvdXRlcl9wbHVnaW4iLCJ1YSIsIkludDMyQXJyYXkiLCJkdiIsIkRhdGFWaWV3IiwiYnVmZmVyIiwid2luZG93IiwiY3J5cHRvIiwiZ2V0UmFuZG9tVmFsdWVzIiwiZ2V0VWludDMyIiwibm9kZWpzX3JvdXRlcl9wbHVnaW4iLCJjb25uX3VybCIsIlVSTCIsInJhbmRvbUJ5dGVzIiwicmVhZFVJbnQzMkxFIl0sIm1hcHBpbmdzIjoiOzs7O0FBRWUsU0FBU0EsbUJBQVQsQ0FBNkJDLGlCQUFlLEVBQTVDLEVBQWdEO1FBQ3ZEQyxpQkFBaUJELGVBQWVDLGNBQWYsSUFBaUNDLGVBQXhEO1NBQ1MsRUFBQ0MsU0FBU0MsYUFBVCxFQUF3QkMsS0FBeEIsRUFBK0I7YUFDaENDLE1BQVAsQ0FBZ0JGLGNBQWNHLFNBQTlCLEVBQTJDOzZCQUNwQjtpQkFDWkMsbUJBQXFCUixjQUFyQixDQUFQO1NBRnVDOzt1QkFJMUI7Z0JBQ1BTLFVBQVVSLGdCQUFoQjtnQkFDTVMsU0FBUyxJQUFJTCxNQUFNTSxhQUFWLENBQXdCRixPQUF4QixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVJ1QyxFQUEzQztLQURPLEVBQVQ7OztBQVdGLFNBQVNSLGVBQVQsR0FBMkI7U0FDbEIsSUFBSVcsS0FBS0MsTUFBTCxLQUFnQixVQUEzQjs7O0FDZGEsU0FBU0MscUJBQVQsQ0FBK0JmLGlCQUFlLEVBQTlDLEVBQWtEO1NBQ3RELEVBQUNHLFNBQVNDLGFBQVQsRUFBd0JDLEtBQXhCLEVBQStCO2FBQ2hDQyxNQUFQLENBQWdCRixjQUFjRyxTQUE5QixFQUEyQzs2QkFDcEI7aUJBQ1pDLDJCQUFxQlIsY0FBckIsQ0FBUDtTQUZ1Qzs7dUJBSTFCO2dCQUNQUyxVQUFVUixnQkFBaEI7Z0JBQ01TLFNBQVMsSUFBSUwsTUFBTU0sYUFBVixDQUF3QkYsT0FBeEIsQ0FBZjtpQkFDT0cscUJBQVAsR0FBK0IsSUFBL0I7aUJBQ09GLE1BQVA7U0FSdUMsRUFBM0M7S0FETyxFQUFUOzs7QUFXRixTQUFTVCxjQUFULEdBQTBCO1FBQ2xCZSxLQUFLLElBQUlDLFVBQUosQ0FBZSxDQUFmLENBQVg7UUFBOEJDLEtBQUssSUFBSUMsUUFBSixDQUFhSCxHQUFHSSxNQUFoQixDQUFuQztNQUNHLGdCQUFnQixPQUFPQyxNQUExQixFQUFtQztXQUMxQkMsTUFBUCxDQUFjQyxlQUFkLENBQThCUCxFQUE5QjtHQURGLE1BRUs7T0FDQSxDQUFILElBQVEsYUFBYUgsS0FBS0MsTUFBTCxFQUFyQjs7U0FDS0ksR0FBR00sU0FBSCxDQUFhLENBQWIsRUFBZ0IsSUFBaEIsQ0FBUDs7O0FDaEJhLFNBQVNDLG9CQUFULENBQThCekIsaUJBQWUsRUFBN0MsRUFBaUQ7U0FDckQsRUFBQ0csU0FBU0MsYUFBVCxFQUF3QkMsS0FBeEIsRUFBK0I7YUFDaENDLE1BQVAsQ0FBZ0JGLGNBQWNHLFNBQTlCLEVBQTJDOzZCQUNwQjtpQkFDWkMseUJBQXFCUixjQUFyQixDQUFQO1NBRnVDOzt5QkFJeEIwQixRQUFqQixFQUEyQjtpQkFDbEIsSUFBSUMsR0FBSixDQUFRRCxRQUFSLENBQVA7U0FMdUM7O3VCQU8xQjtnQkFDUGpCLFVBQVVSLGtCQUFoQjtnQkFDTVMsU0FBUyxJQUFJTCxNQUFNTSxhQUFWLENBQXdCRixPQUF4QixDQUFmO2lCQUNPRyxxQkFBUCxHQUErQixJQUEvQjtpQkFDT0YsTUFBUDtTQVh1QyxFQUEzQztLQURPLEVBQVQ7OztBQWNGLFNBQVNULGdCQUFULEdBQTBCO1NBQ2pCMkIsWUFBWSxDQUFaLEVBQWVDLFlBQWYsRUFBUDs7Ozs7OyJ9
