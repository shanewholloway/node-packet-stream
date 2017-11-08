'use strict';

var tls = require('tls');

function bindStreamChannel(stream, api_channel, props) {
  const channel = api_channel.bindChannel(sendMsgRaw, props);
  connectPacketStream(stream, channel, true);
  return channel;

  function sendMsgRaw(msg) {
    if (!Buffer.isBuffer(msg)) {
      if (msg._raw_) {
        msg = Buffer.from(msg._raw_);
      } else if (msg.byteLength) {
        msg = Buffer.from(msg);
      } else {
        throw new TypeError(`sendMsgRaw expected 'msg' as a Buffer or an object with a '_raw_' Buffer`);
      }
    }

    if (null === msg) {
      return void stream.end();
    }
    return void stream.write(msg);
  }
}

function connectPacketStream(stream, channel, endStreamOnShutdown) {
  const shutdown = new Promise(lifecycle);
  return Object.defineProperty(channel, 'shutdown', { value: shutdown });

  function lifecycle(resolve, reject) {
    let pktDispatch = channel.bindDispatchPackets();

    stream.on('error', shutdown);
    stream.on('close', shutdown);
    stream.on('data', function (data) {
      try {
        pktDispatch(data);
      } catch (err) {
        return shutdown(err);
      }
    });

    function shutdown(err) {
      if (undefined === pktDispatch) {
        return;
      }
      pktDispatch = undefined;
      if (endStreamOnShutdown) {
        stream.end();
      }

      err ? reject(err) : resolve();
    }
  }
}

net_common.net_common = net_common;
function net_common(hub, asURL) {
  // shared implementation between net/tcp and tls implementations
  return {
    init_server(svr) {
      svr.conn_info = function () {
        const { address, port } = svr.address();
        return { ip_server: { address, port, asURL } };
      };
      return svr;
    },

    bindOnPeer(svr, onPeer) {
      if ('function' === typeof onPeer) {
        return onPeer;
      }
      if ('string' === typeof onPeer) {
        return channel => svr.emit(onPeer, channel);
      }
      return () => null;
    },

    bindChannel(sock) {
      const channel = bindSocketChannel(sock, hub._api_channel, asURL);

      channel.sendRoutingHandshake();
      return channel;
    },

    unpackConnectArgs(args) {
      if (1 === args.length) {
        if ('string' === typeof args[0].href) {
          const { hostname: host, port } = args[0];
          args[0] = { host, port };
        }
      }
      return args;
    } };
}

net_common.bindSocketChannel = bindSocketChannel;
function bindSocketChannel(sock, api_channel, asURL) {
  sock.setNoDelay(true);

  const conn_info = () => ({
    ip_remote: { asURL, address: sock.remoteAddress, port: sock.remotePort },
    ip_local: { asURL, address: sock.localAddress, port: sock.localPort } });

  return bindStreamChannel(sock, api_channel, { conn_info: { value: conn_info } });
}

tls_plugin.tls_plugin = tls_plugin;
function tls_plugin(plugin_options = {}) {
  function as_tls_url() {
    return `tls://${this.address}:${this.port}`;
  }

  return function (hub) {
    const _common_ = net_common(hub, as_tls_url);

    hub.registerConnectionProtocol('tcp:', connect$$1);
    return hub.tls = { connect: connect$$1, createServer: createServer$$1 };

    function connect$$1(...args) {
      args = _common_.unpackConnectArgs(args);
      return new Promise((resolve, reject) => {
        tls.connect(...args, function () {
          const sock = this.unref().setKeepAlive(true);
          const channel = _common_.bindChannel(sock);
          resolve(channel);
        }).on('error', reject);
      });
    }

    function createServer$$1(options, onPeer) {
      const svr = tls.createServer(options, sock => {
        sock = sock.unref().setKeepAlive(false);
        const channel = _common_.bindChannel(sock);
        on_peer(channel);
      });
      const on_peer = _common_.bindOnPeer(svr, onPeer);
      return svr;
    }
  };
}

module.exports = tls_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXRscy5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL25ldC9fc3RyZWFtX2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L19uZXRfY29tbW9uLmpzeSIsIi4uL2NvZGUvcGx1Z2lucy9uZXQvdGxzLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZnVuY3Rpb24gYmluZFN0cmVhbUNoYW5uZWwoc3RyZWFtLCBhcGlfY2hhbm5lbCwgcHJvcHMpIDo6XG4gIGNvbnN0IGNoYW5uZWwgPSBhcGlfY2hhbm5lbC5iaW5kQ2hhbm5lbCBAIHNlbmRNc2dSYXcsIHByb3BzXG4gIGNvbm5lY3RQYWNrZXRTdHJlYW0gQCBzdHJlYW0sIGNoYW5uZWwsIHRydWVcbiAgcmV0dXJuIGNoYW5uZWxcblxuICBmdW5jdGlvbiBzZW5kTXNnUmF3KG1zZykgOjpcbiAgICBpZiAhIEJ1ZmZlci5pc0J1ZmZlciBAIG1zZyA6OlxuICAgICAgaWYgbXNnLl9yYXdfIDo6XG4gICAgICAgIG1zZyA9IEJ1ZmZlci5mcm9tIEAgbXNnLl9yYXdfXG4gICAgICBlbHNlIGlmIG1zZy5ieXRlTGVuZ3RoIDo6XG4gICAgICAgIG1zZyA9IEJ1ZmZlci5mcm9tIEAgbXNnXG4gICAgICBlbHNlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgc2VuZE1zZ1JhdyBleHBlY3RlZCAnbXNnJyBhcyBhIEJ1ZmZlciBvciBhbiBvYmplY3Qgd2l0aCBhICdfcmF3XycgQnVmZmVyYFxuXG4gICAgaWYgbnVsbCA9PT0gbXNnIDo6XG4gICAgICByZXR1cm4gdm9pZCBzdHJlYW0uZW5kKClcbiAgICByZXR1cm4gdm9pZCBzdHJlYW0ud3JpdGUobXNnKVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBjb25uZWN0UGFja2V0U3RyZWFtKHN0cmVhbSwgY2hhbm5lbCwgZW5kU3RyZWFtT25TaHV0ZG93bikgOjpcbiAgY29uc3Qgc2h1dGRvd24gPSBuZXcgUHJvbWlzZSBAIGxpZmVjeWNsZVxuICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgY2hhbm5lbCwgJ3NodXRkb3duJywgQDogdmFsdWU6IHNodXRkb3duXG4gIFxuICBmdW5jdGlvbiBsaWZlY3ljbGUocmVzb2x2ZSwgcmVqZWN0KSA6OlxuICAgIGxldCBwa3REaXNwYXRjaCA9IGNoYW5uZWwuYmluZERpc3BhdGNoUGFja2V0cygpXG5cbiAgICBzdHJlYW0ub24gQCAnZXJyb3InLCBzaHV0ZG93blxuICAgIHN0cmVhbS5vbiBAICdjbG9zZScsIHNodXRkb3duXG4gICAgc3RyZWFtLm9uIEAgJ2RhdGEnLCBmdW5jdGlvbiAoZGF0YSkgOjpcbiAgICAgIHRyeSA6OiBwa3REaXNwYXRjaChkYXRhKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHJldHVybiBzaHV0ZG93bihlcnIpXG5cbiAgICBmdW5jdGlvbiBzaHV0ZG93bihlcnIpIDo6XG4gICAgICBpZiB1bmRlZmluZWQgPT09IHBrdERpc3BhdGNoIDo6IHJldHVyblxuICAgICAgcGt0RGlzcGF0Y2ggPSB1bmRlZmluZWRcbiAgICAgIGlmIGVuZFN0cmVhbU9uU2h1dGRvd24gOjpcbiAgICAgICAgc3RyZWFtLmVuZCgpXG5cbiAgICAgIGVyciA/IHJlamVjdChlcnIpIDogcmVzb2x2ZSgpXG5cbiIsImltcG9ydCB7YmluZFN0cmVhbUNoYW5uZWx9IGZyb20gJy4vX3N0cmVhbV9jb21tb24uanN5J1xuXG5uZXRfY29tbW9uLm5ldF9jb21tb24gPSBuZXRfY29tbW9uXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBuZXRfY29tbW9uKGh1YiwgYXNVUkwpIDo6XG4gIC8vIHNoYXJlZCBpbXBsZW1lbnRhdGlvbiBiZXR3ZWVuIG5ldC90Y3AgYW5kIHRscyBpbXBsZW1lbnRhdGlvbnNcbiAgcmV0dXJuIEA6XG4gICAgaW5pdF9zZXJ2ZXIoc3ZyKSA6OlxuICAgICAgc3ZyLmNvbm5faW5mbyA9IGZ1bmN0aW9uICgpIDo6XG4gICAgICAgIGNvbnN0IHthZGRyZXNzLCBwb3J0fSA9IHN2ci5hZGRyZXNzKClcbiAgICAgICAgcmV0dXJuIEB7fSBpcF9zZXJ2ZXI6IEB7fSBhZGRyZXNzLCBwb3J0LCBhc1VSTFxuICAgICAgcmV0dXJuIHN2clxuXG4gICAgYmluZE9uUGVlcihzdnIsIG9uUGVlcikgOjpcbiAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBvblBlZXIgOjpcbiAgICAgICAgcmV0dXJuIG9uUGVlclxuICAgICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBvblBlZXIgOjpcbiAgICAgICAgcmV0dXJuIGNoYW5uZWwgPT4gc3ZyLmVtaXQgQCBvblBlZXIsIGNoYW5uZWxcbiAgICAgIHJldHVybiAoKSA9PiBudWxsXG5cbiAgICBiaW5kQ2hhbm5lbChzb2NrKSA6OlxuICAgICAgY29uc3QgY2hhbm5lbCA9IGJpbmRTb2NrZXRDaGFubmVsIEBcbiAgICAgICAgc29jaywgaHViLl9hcGlfY2hhbm5lbCwgYXNVUkxcblxuICAgICAgY2hhbm5lbC5zZW5kUm91dGluZ0hhbmRzaGFrZSgpXG4gICAgICByZXR1cm4gY2hhbm5lbFxuXG4gICAgdW5wYWNrQ29ubmVjdEFyZ3MoYXJncykgOjpcbiAgICAgIGlmIDEgPT09IGFyZ3MubGVuZ3RoIDo6XG4gICAgICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgYXJnc1swXS5ocmVmIDo6XG4gICAgICAgICAgY29uc3Qge2hvc3RuYW1lOmhvc3QsIHBvcnR9ID0gYXJnc1swXVxuICAgICAgICAgIGFyZ3NbMF0gPSBAe30gaG9zdCwgcG9ydFxuICAgICAgcmV0dXJuIGFyZ3NcblxuXG5uZXRfY29tbW9uLmJpbmRTb2NrZXRDaGFubmVsID0gYmluZFNvY2tldENoYW5uZWxcbmZ1bmN0aW9uIGJpbmRTb2NrZXRDaGFubmVsKHNvY2ssIGFwaV9jaGFubmVsLCBhc1VSTCkgOjpcbiAgc29jay5zZXROb0RlbGF5KHRydWUpXG5cbiAgY29uc3QgY29ubl9pbmZvID0gKCkgPT4gQDpcbiAgICBpcF9yZW1vdGU6IEB7fSBhc1VSTCwgYWRkcmVzczogc29jay5yZW1vdGVBZGRyZXNzLCBwb3J0OiBzb2NrLnJlbW90ZVBvcnRcbiAgICBpcF9sb2NhbDogQHt9IGFzVVJMLCBhZGRyZXNzOiBzb2NrLmxvY2FsQWRkcmVzcywgcG9ydDogc29jay5sb2NhbFBvcnRcblxuICByZXR1cm4gYmluZFN0cmVhbUNoYW5uZWwgQCBzb2NrLCBhcGlfY2hhbm5lbFxuICAgIEA6IGNvbm5faW5mbzogQDogdmFsdWU6IGNvbm5faW5mb1xuXG4iLCJpbXBvcnQgeyBjcmVhdGVTZXJ2ZXIgYXMgX3Rsc19jcmVhdGVTZXJ2ZXIsIGNvbm5lY3QgYXMgX3Rsc19jb25uZWN0IH0gZnJvbSAndGxzJ1xuaW1wb3J0IG5ldF9jb21tb24gZnJvbSAnLi9fbmV0X2NvbW1vbi5qc3knXG5cbnRsc19wbHVnaW4udGxzX3BsdWdpbiA9IHRsc19wbHVnaW5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRsc19wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGZ1bmN0aW9uIGFzX3Rsc191cmwoKSA6OiByZXR1cm4gYHRsczovLyR7dGhpcy5hZGRyZXNzfToke3RoaXMucG9ydH1gXG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGh1YikgOjpcbiAgICBjb25zdCBfY29tbW9uXyA9IG5ldF9jb21tb24oaHViLCBhc190bHNfdXJsKVxuXG4gICAgaHViLnJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sIEAgJ3RjcDonLCBjb25uZWN0XG4gICAgcmV0dXJuIGh1Yi50bHMgPSBAOiBjb25uZWN0LCBjcmVhdGVTZXJ2ZXJcblxuXG4gICAgZnVuY3Rpb24gY29ubmVjdCguLi5hcmdzKSA6OlxuICAgICAgYXJncyA9IF9jb21tb25fLnVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UgQCAocmVzb2x2ZSwgcmVqZWN0KSA9PiA6OlxuICAgICAgICBfdGxzX2Nvbm5lY3QgQCAuLi5hcmdzLCBmdW5jdGlvbiAoKSA6OlxuICAgICAgICAgIGNvbnN0IHNvY2sgPSB0aGlzLnVucmVmKCkuc2V0S2VlcEFsaXZlKHRydWUpXG4gICAgICAgICAgY29uc3QgY2hhbm5lbCA9IF9jb21tb25fLmJpbmRDaGFubmVsKHNvY2spXG4gICAgICAgICAgcmVzb2x2ZShjaGFubmVsKVxuICAgICAgICAub24gQCAnZXJyb3InLCByZWplY3RcblxuICAgIGZ1bmN0aW9uIGNyZWF0ZVNlcnZlcihvcHRpb25zLCBvblBlZXIpIDo6XG4gICAgICBjb25zdCBzdnIgPSBfdGxzX2NyZWF0ZVNlcnZlciBAIG9wdGlvbnMsIHNvY2sgPT4gOjpcbiAgICAgICAgc29jayA9IHNvY2sudW5yZWYoKS5zZXRLZWVwQWxpdmUoZmFsc2UpXG4gICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICBvbl9wZWVyKGNoYW5uZWwpXG4gICAgICBjb25zdCBvbl9wZWVyID0gX2NvbW1vbl8uYmluZE9uUGVlcihzdnIsIG9uUGVlcilcbiAgICAgIHJldHVybiBzdnJcbiJdLCJuYW1lcyI6WyJiaW5kU3RyZWFtQ2hhbm5lbCIsInN0cmVhbSIsImFwaV9jaGFubmVsIiwicHJvcHMiLCJjaGFubmVsIiwiYmluZENoYW5uZWwiLCJzZW5kTXNnUmF3IiwibXNnIiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJfcmF3XyIsImZyb20iLCJieXRlTGVuZ3RoIiwiVHlwZUVycm9yIiwiZW5kIiwid3JpdGUiLCJjb25uZWN0UGFja2V0U3RyZWFtIiwiZW5kU3RyZWFtT25TaHV0ZG93biIsInNodXRkb3duIiwiUHJvbWlzZSIsImxpZmVjeWNsZSIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwidmFsdWUiLCJyZXNvbHZlIiwicmVqZWN0IiwicGt0RGlzcGF0Y2giLCJiaW5kRGlzcGF0Y2hQYWNrZXRzIiwib24iLCJkYXRhIiwiZXJyIiwidW5kZWZpbmVkIiwibmV0X2NvbW1vbiIsImh1YiIsImFzVVJMIiwic3ZyIiwiY29ubl9pbmZvIiwiYWRkcmVzcyIsInBvcnQiLCJpcF9zZXJ2ZXIiLCJvblBlZXIiLCJlbWl0Iiwic29jayIsImJpbmRTb2NrZXRDaGFubmVsIiwiX2FwaV9jaGFubmVsIiwic2VuZFJvdXRpbmdIYW5kc2hha2UiLCJhcmdzIiwibGVuZ3RoIiwiaHJlZiIsImhvc3RuYW1lIiwiaG9zdCIsInNldE5vRGVsYXkiLCJyZW1vdGVBZGRyZXNzIiwicmVtb3RlUG9ydCIsImxvY2FsQWRkcmVzcyIsImxvY2FsUG9ydCIsInRsc19wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsImFzX3Rsc191cmwiLCJfY29tbW9uXyIsInJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sIiwiY29ubmVjdCIsInRscyIsImNyZWF0ZVNlcnZlciIsInVucGFja0Nvbm5lY3RBcmdzIiwidW5yZWYiLCJzZXRLZWVwQWxpdmUiLCJvcHRpb25zIiwiX3Rsc19jcmVhdGVTZXJ2ZXIiLCJvbl9wZWVyIiwiYmluZE9uUGVlciJdLCJtYXBwaW5ncyI6Ijs7OztBQUFPLFNBQVNBLGlCQUFULENBQTJCQyxNQUEzQixFQUFtQ0MsV0FBbkMsRUFBZ0RDLEtBQWhELEVBQXVEO1FBQ3REQyxVQUFVRixZQUFZRyxXQUFaLENBQTBCQyxVQUExQixFQUFzQ0gsS0FBdEMsQ0FBaEI7c0JBQ3NCRixNQUF0QixFQUE4QkcsT0FBOUIsRUFBdUMsSUFBdkM7U0FDT0EsT0FBUDs7V0FFU0UsVUFBVCxDQUFvQkMsR0FBcEIsRUFBeUI7UUFDcEIsQ0FBRUMsT0FBT0MsUUFBUCxDQUFrQkYsR0FBbEIsQ0FBTCxFQUE2QjtVQUN4QkEsSUFBSUcsS0FBUCxFQUFlO2NBQ1BGLE9BQU9HLElBQVAsQ0FBY0osSUFBSUcsS0FBbEIsQ0FBTjtPQURGLE1BRUssSUFBR0gsSUFBSUssVUFBUCxFQUFvQjtjQUNqQkosT0FBT0csSUFBUCxDQUFjSixHQUFkLENBQU47T0FERyxNQUVBO2NBQ0csSUFBSU0sU0FBSixDQUFpQiwwRUFBakIsQ0FBTjs7OztRQUVELFNBQVNOLEdBQVosRUFBa0I7YUFDVCxLQUFLTixPQUFPYSxHQUFQLEVBQVo7O1dB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
