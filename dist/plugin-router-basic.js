'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var createPacketParser = _interopDefault(require('msg-fabric-packet-stream'));

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

exports['default'] = basic_router_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXJvdXRlci1iYXNpYy5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL3JvdXRlci9iYXNpYy5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGNyZWF0ZVBhY2tldFBhcnNlciBmcm9tICdtc2ctZmFicmljLXBhY2tldC1zdHJlYW0nXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIGJhc2ljX3JvdXRlcl9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGNvbnN0IHJhbmRvbV9pZF9zZWxmID0gcGx1Z2luX29wdGlvbnMucmFuZG9tX2lkX3NlbGYgfHwgX3JhbmRvbV9pZF9zZWxmXG4gIHJldHVybiBAOiBzdWJjbGFzcyhNZXNzYWdlSHViX1BJLCBiYXNlcykgOjpcbiAgICBPYmplY3QuYXNzaWduIEAgTWVzc2FnZUh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBfaW5pdF9wYWNrZXRQYXJzZXIoKSA6OlxuICAgICAgICByZXR1cm4gY3JlYXRlUGFja2V0UGFyc2VyIEAgcGx1Z2luX29wdGlvbnNcblxuICAgICAgX2luaXRfcm91dGVyKCkgOjpcbiAgICAgICAgY29uc3QgaWRfc2VsZiA9IHJhbmRvbV9pZF9zZWxmKClcbiAgICAgICAgY29uc3Qgcm91dGVyID0gbmV3IGJhc2VzLk1lc3NhZ2VSb3V0ZXIoaWRfc2VsZilcbiAgICAgICAgcm91dGVyLmFsbG93VW52ZXJpZmllZFJvdXRlcyA9IHRydWVcbiAgICAgICAgcmV0dXJuIHJvdXRlclxuXG5mdW5jdGlvbiBfcmFuZG9tX2lkX3NlbGYoKSA6OlxuICByZXR1cm4gMCB8IE1hdGgucmFuZG9tKCkgKiAweDdmZmZmZmZmXG4iXSwibmFtZXMiOlsiYmFzaWNfcm91dGVyX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwicmFuZG9tX2lkX3NlbGYiLCJfcmFuZG9tX2lkX3NlbGYiLCJzdWJjbGFzcyIsIk1lc3NhZ2VIdWJfUEkiLCJiYXNlcyIsImFzc2lnbiIsInByb3RvdHlwZSIsImNyZWF0ZVBhY2tldFBhcnNlciIsImlkX3NlbGYiLCJyb3V0ZXIiLCJNZXNzYWdlUm91dGVyIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwiTWF0aCIsInJhbmRvbSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFFZSxTQUFTQSxtQkFBVCxDQUE2QkMsaUJBQWUsRUFBNUMsRUFBZ0Q7UUFDdkRDLGlCQUFpQkQsZUFBZUMsY0FBZixJQUFpQ0MsZUFBeEQ7U0FDUyxFQUFDQyxTQUFTQyxhQUFULEVBQXdCQyxLQUF4QixFQUErQjthQUNoQ0MsTUFBUCxDQUFnQkYsY0FBY0csU0FBOUIsRUFBMkM7NkJBQ3BCO2lCQUNaQyxtQkFBcUJSLGNBQXJCLENBQVA7U0FGdUM7O3VCQUkxQjtnQkFDUFMsVUFBVVIsZ0JBQWhCO2dCQUNNUyxTQUFTLElBQUlMLE1BQU1NLGFBQVYsQ0FBd0JGLE9BQXhCLENBQWY7aUJBQ09HLHFCQUFQLEdBQStCLElBQS9CO2lCQUNPRixNQUFQO1NBUnVDLEVBQTNDO0tBRE8sRUFBVDs7O0FBV0YsU0FBU1IsZUFBVCxHQUEyQjtTQUNsQixJQUFJVyxLQUFLQyxNQUFMLEtBQWdCLFVBQTNCOzs7OzsifQ==
