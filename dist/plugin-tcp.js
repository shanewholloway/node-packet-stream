'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var net = require('net');

function bindStreamChannel$1(rstream, wstream, api_channel, props) {
  const channel = api_channel.bindChannel(sendPktRaw, props);
  connectPacketStream(rstream, channel, true);
  return channel;

  function sendPktRaw(pkt) {
    if (!Buffer.isBuffer(pkt)) {
      if (pkt._raw_) {
        pkt = Buffer.from(pkt._raw_);
      } else if (pkt.byteLength) {
        pkt = Buffer.from(pkt);
      } else {
        throw new TypeError(`sendPktRaw expected 'pkt' as a Buffer or an object with a '_raw_' Buffer`);
      }
    }

    if (null === pkt) {
      return void wstream.end();
    }
    return void wstream.write(pkt);
  }
}

function connectPacketStream(rstream, channel, endStreamOnShutdown) {
  const shutdown = new Promise(lifecycle);
  return Object.defineProperty(channel, 'shutdown', { value: shutdown });

  function lifecycle(resolve, reject) {
    let pktDispatch = channel.bindDispatchPackets();

    rstream.on('error', shutdown);
    rstream.on('close', shutdown);
    rstream.on('data', function (data) {
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
        rstream.end();
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

  return bindStreamChannel$1(sock, sock, api_channel, { conn_info: { value: conn_info } });
}

function tcp_plugin(plugin_options = {}) {
  function as_tcp_url() {
    return `tcp://${this.address}:${this.port}`;
  }

  return function (hub) {
    const _common_ = net_common(hub, as_tcp_url);

    hub.registerConnectionProtocol('tcp:', connect);
    return hub.tcp = { connect, createServer: createServer$$1 };

    function connect(...args) {
      args = _common_.unpackConnectArgs(args);
      return new Promise((resolve, reject) => {
        net.createConnection(...args, function () {
          const sock = this.unref().setKeepAlive(true);
          const channel = _common_.bindChannel(sock);
          resolve(channel);
        }).on('error', reject);
      });
    }

    function createServer$$1(onPeer) {
      const svr = net.createServer(function (sock) {
        sock = sock.unref().setKeepAlive(false);
        const channel = _common_.bindChannel(sock);
        on_peer(channel);
      });
      const on_peer = _common_.bindOnPeer(svr, onPeer);
      return _common_.init_server(svr);
    }
  };
}

exports['default'] = tcp_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXRjcC5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL25ldC9fc3RyZWFtX2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L19uZXRfY29tbW9uLmpzeSIsIi4uL2NvZGUvcGx1Z2lucy9uZXQvdGNwLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZGVmYXVsdCBiaW5kU3RyZWFtQ2hhbm5lbFxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRTdHJlYW1DaGFubmVsKHJzdHJlYW0sIHdzdHJlYW0sIGFwaV9jaGFubmVsLCBwcm9wcykgOjpcbiAgY29uc3QgY2hhbm5lbCA9IGFwaV9jaGFubmVsLmJpbmRDaGFubmVsIEAgc2VuZFBrdFJhdywgcHJvcHNcbiAgY29ubmVjdFBhY2tldFN0cmVhbSBAIHJzdHJlYW0sIGNoYW5uZWwsIHRydWVcbiAgcmV0dXJuIGNoYW5uZWxcblxuICBmdW5jdGlvbiBzZW5kUGt0UmF3KHBrdCkgOjpcbiAgICBpZiAhIEJ1ZmZlci5pc0J1ZmZlciBAIHBrdCA6OlxuICAgICAgaWYgcGt0Ll9yYXdfIDo6XG4gICAgICAgIHBrdCA9IEJ1ZmZlci5mcm9tIEAgcGt0Ll9yYXdfXG4gICAgICBlbHNlIGlmIHBrdC5ieXRlTGVuZ3RoIDo6XG4gICAgICAgIHBrdCA9IEJ1ZmZlci5mcm9tIEAgcGt0XG4gICAgICBlbHNlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgc2VuZFBrdFJhdyBleHBlY3RlZCAncGt0JyBhcyBhIEJ1ZmZlciBvciBhbiBvYmplY3Qgd2l0aCBhICdfcmF3XycgQnVmZmVyYFxuXG4gICAgaWYgbnVsbCA9PT0gcGt0IDo6XG4gICAgICByZXR1cm4gdm9pZCB3c3RyZWFtLmVuZCgpXG4gICAgcmV0dXJuIHZvaWQgd3N0cmVhbS53cml0ZShwa3QpXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbm5lY3RQYWNrZXRTdHJlYW0ocnN0cmVhbSwgY2hhbm5lbCwgZW5kU3RyZWFtT25TaHV0ZG93bikgOjpcbiAgY29uc3Qgc2h1dGRvd24gPSBuZXcgUHJvbWlzZSBAIGxpZmVjeWNsZVxuICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgY2hhbm5lbCwgJ3NodXRkb3duJywgQDogdmFsdWU6IHNodXRkb3duXG4gIFxuICBmdW5jdGlvbiBsaWZlY3ljbGUocmVzb2x2ZSwgcmVqZWN0KSA6OlxuICAgIGxldCBwa3REaXNwYXRjaCA9IGNoYW5uZWwuYmluZERpc3BhdGNoUGFja2V0cygpXG5cbiAgICByc3RyZWFtLm9uIEAgJ2Vycm9yJywgc2h1dGRvd25cbiAgICByc3RyZWFtLm9uIEAgJ2Nsb3NlJywgc2h1dGRvd25cbiAgICByc3RyZWFtLm9uIEAgJ2RhdGEnLCBmdW5jdGlvbiAoZGF0YSkgOjpcbiAgICAgIHRyeSA6OiBwa3REaXNwYXRjaChkYXRhKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHJldHVybiBzaHV0ZG93bihlcnIpXG5cbiAgICBmdW5jdGlvbiBzaHV0ZG93bihlcnIpIDo6XG4gICAgICBpZiB1bmRlZmluZWQgPT09IHBrdERpc3BhdGNoIDo6IHJldHVyblxuICAgICAgcGt0RGlzcGF0Y2ggPSB1bmRlZmluZWRcbiAgICAgIGlmIGVuZFN0cmVhbU9uU2h1dGRvd24gOjpcbiAgICAgICAgcnN0cmVhbS5lbmQoKVxuXG4gICAgICBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKVxuXG4iLCJpbXBvcnQgYmluZFN0cmVhbUNoYW5uZWwgZnJvbSAnLi9fc3RyZWFtX2NvbW1vbi5qc3knXG5cbm5ldF9jb21tb24ubmV0X2NvbW1vbiA9IG5ldF9jb21tb25cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG5ldF9jb21tb24oaHViLCBhc1VSTCkgOjpcbiAgLy8gc2hhcmVkIGltcGxlbWVudGF0aW9uIGJldHdlZW4gbmV0L3RjcCBhbmQgdGxzIGltcGxlbWVudGF0aW9uc1xuICByZXR1cm4gQDpcbiAgICBpbml0X3NlcnZlcihzdnIpIDo6XG4gICAgICBzdnIuY29ubl9pbmZvID0gZnVuY3Rpb24gKCkgOjpcbiAgICAgICAgY29uc3Qge2FkZHJlc3MsIHBvcnR9ID0gc3ZyLmFkZHJlc3MoKVxuICAgICAgICByZXR1cm4gQHt9IGlwX3NlcnZlcjogQHt9IGFkZHJlc3MsIHBvcnQsIGFzVVJMXG4gICAgICByZXR1cm4gc3ZyXG5cbiAgICBiaW5kT25QZWVyKHN2ciwgb25QZWVyKSA6OlxuICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIG9uUGVlciA6OlxuICAgICAgICByZXR1cm4gb25QZWVyXG4gICAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIG9uUGVlciA6OlxuICAgICAgICByZXR1cm4gY2hhbm5lbCA9PiBzdnIuZW1pdCBAIG9uUGVlciwgY2hhbm5lbFxuICAgICAgcmV0dXJuICgpID0+IG51bGxcblxuICAgIGJpbmRDaGFubmVsKHNvY2spIDo6XG4gICAgICBjb25zdCBjaGFubmVsID0gYmluZFNvY2tldENoYW5uZWwgQFxuICAgICAgICBzb2NrLCBodWIuX2FwaV9jaGFubmVsLCBhc1VSTFxuXG4gICAgICBjaGFubmVsLnNlbmRSb3V0aW5nSGFuZHNoYWtlKClcbiAgICAgIHJldHVybiBjaGFubmVsXG5cbiAgICB1bnBhY2tDb25uZWN0QXJncyhhcmdzKSA6OlxuICAgICAgaWYgMSA9PT0gYXJncy5sZW5ndGggOjpcbiAgICAgICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBhcmdzWzBdLmhyZWYgOjpcbiAgICAgICAgICBjb25zdCB7aG9zdG5hbWU6aG9zdCwgcG9ydH0gPSBhcmdzWzBdXG4gICAgICAgICAgYXJnc1swXSA9IEB7fSBob3N0LCBwb3J0XG4gICAgICByZXR1cm4gYXJnc1xuXG5cbm5ldF9jb21tb24uYmluZFNvY2tldENoYW5uZWwgPSBiaW5kU29ja2V0Q2hhbm5lbFxuZnVuY3Rpb24gYmluZFNvY2tldENoYW5uZWwoc29jaywgYXBpX2NoYW5uZWwsIGFzVVJMKSA6OlxuICBzb2NrLnNldE5vRGVsYXkodHJ1ZSlcblxuICBjb25zdCBjb25uX2luZm8gPSAoKSA9PiBAOlxuICAgIGlwX3JlbW90ZTogQHt9IGFzVVJMLCBhZGRyZXNzOiBzb2NrLnJlbW90ZUFkZHJlc3MsIHBvcnQ6IHNvY2sucmVtb3RlUG9ydFxuICAgIGlwX2xvY2FsOiBAe30gYXNVUkwsIGFkZHJlc3M6IHNvY2subG9jYWxBZGRyZXNzLCBwb3J0OiBzb2NrLmxvY2FsUG9ydFxuXG4gIHJldHVybiBiaW5kU3RyZWFtQ2hhbm5lbCBAIHNvY2ssIHNvY2ssIGFwaV9jaGFubmVsXG4gICAgQDogY29ubl9pbmZvOiBAOiB2YWx1ZTogY29ubl9pbmZvXG5cbiIsImltcG9ydCB7IGNyZWF0ZVNlcnZlciBhcyBfdGNwX2NyZWF0ZVNlcnZlciwgY3JlYXRlQ29ubmVjdGlvbiBhcyBfdGNwX2NyZWF0ZUNvbm5lY3Rpb24gfSBmcm9tICduZXQnXG5pbXBvcnQgbmV0X2NvbW1vbiBmcm9tICcuL19uZXRfY29tbW9uLmpzeSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdGNwX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgZnVuY3Rpb24gYXNfdGNwX3VybCgpIDo6IHJldHVybiBgdGNwOi8vJHt0aGlzLmFkZHJlc3N9OiR7dGhpcy5wb3J0fWBcblxuICByZXR1cm4gZnVuY3Rpb24oaHViKSA6OlxuICAgIGNvbnN0IF9jb21tb25fID0gbmV0X2NvbW1vbihodWIsIGFzX3RjcF91cmwpXG5cbiAgICBodWIucmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wgQCAndGNwOicsIGNvbm5lY3RcbiAgICByZXR1cm4gaHViLnRjcCA9IEA6IGNvbm5lY3QsIGNyZWF0ZVNlcnZlclxuXG5cbiAgICBmdW5jdGlvbiBjb25uZWN0KC4uLmFyZ3MpIDo6XG4gICAgICBhcmdzID0gX2NvbW1vbl8udW5wYWNrQ29ubmVjdEFyZ3MoYXJncylcbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZSBAIChyZXNvbHZlLCByZWplY3QpID0+IDo6XG4gICAgICAgIF90Y3BfY3JlYXRlQ29ubmVjdGlvbiBAIC4uLmFyZ3MsIGZ1bmN0aW9uKCkgOjpcbiAgICAgICAgICBjb25zdCBzb2NrID0gdGhpcy51bnJlZigpLnNldEtlZXBBbGl2ZSh0cnVlKVxuICAgICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICAgIHJlc29sdmUoY2hhbm5lbClcbiAgICAgICAgLm9uIEAgJ2Vycm9yJywgcmVqZWN0XG5cbiAgICBmdW5jdGlvbiBjcmVhdGVTZXJ2ZXIob25QZWVyKSA6OlxuICAgICAgY29uc3Qgc3ZyID0gX3RjcF9jcmVhdGVTZXJ2ZXIgQCBmdW5jdGlvbiAoc29jaykgOjpcbiAgICAgICAgc29jayA9IHNvY2sudW5yZWYoKS5zZXRLZWVwQWxpdmUoZmFsc2UpXG4gICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICBvbl9wZWVyKGNoYW5uZWwpXG4gICAgICBjb25zdCBvbl9wZWVyID0gX2NvbW1vbl8uYmluZE9uUGVlcihzdnIsIG9uUGVlcilcbiAgICAgIHJldHVybiBfY29tbW9uXy5pbml0X3NlcnZlcihzdnIpXG5cbiJdLCJuYW1lcyI6WyJiaW5kU3RyZWFtQ2hhbm5lbCIsInJzdHJlYW0iLCJ3c3RyZWFtIiwiYXBpX2NoYW5uZWwiLCJwcm9wcyIsImNoYW5uZWwiLCJiaW5kQ2hhbm5lbCIsInNlbmRQa3RSYXciLCJwa3QiLCJCdWZmZXIiLCJpc0J1ZmZlciIsIl9yYXdfIiwiZnJvbSIsImJ5dGVMZW5ndGgiLCJUeXBlRXJyb3IiLCJlbmQiLCJ3cml0ZSIsImNvbm5lY3RQYWNrZXRTdHJlYW0iLCJlbmRTdHJlYW1PblNodXRkb3duIiwic2h1dGRvd24iLCJQcm9taXNlIiwibGlmZWN5Y2xlIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJ2YWx1ZSIsInJlc29sdmUiLCJyZWplY3QiLCJwa3REaXNwYXRjaCIsImJpbmREaXNwYXRjaFBhY2tldHMiLCJvbiIsImRhdGEiLCJlcnIiLCJ1bmRlZmluZWQiLCJuZXRfY29tbW9uIiwiaHViIiwiYXNVUkwiLCJzdnIiLCJjb25uX2luZm8iLCJhZGRyZXNzIiwicG9ydCIsImlwX3NlcnZlciIsIm9uUGVlciIsImVtaXQiLCJzb2NrIiwiYmluZFNvY2tldENoYW5uZWwiLCJfYXBpX2NoYW5uZWwiLCJzZW5kUm91dGluZ0hhbmRzaGFrZSIsImFyZ3MiLCJsZW5ndGgiLCJocmVmIiwiaG9zdG5hbWUiLCJob3N0Iiwic2V0Tm9EZWxheSIsInJlbW90ZUFkZHJlc3MiLCJyZW1vdGVQb3J0IiwibG9jYWxBZGRyZXNzIiwibG9jYWxQb3J0IiwidGNwX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwiYXNfdGNwX3VybCIsIl9jb21tb25fIiwicmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wiLCJjb25uZWN0IiwidGNwIiwiY3JlYXRlU2VydmVyIiwidW5wYWNrQ29ubmVjdEFyZ3MiLCJ1bnJlZiIsInNldEtlZXBBbGl2ZSIsIl90Y3BfY3JlYXRlU2VydmVyIiwib25fcGVlciIsImJpbmRPblBlZXIiLCJpbml0X3NlcnZlciJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQ08sU0FBU0EsbUJBQVQsQ0FBMkJDLE9BQTNCLEVBQW9DQyxPQUFwQyxFQUE2Q0MsV0FBN0MsRUFBMERDLEtBQTFELEVBQWlFO1FBQ2hFQyxVQUFVRixZQUFZRyxXQUFaLENBQTBCQyxVQUExQixFQUFzQ0gsS0FBdEMsQ0FBaEI7c0JBQ3NCSCxPQUF0QixFQUErQkksT0FBL0IsRUFBd0MsSUFBeEM7U0FDT0EsT0FBUDs7V0FFU0UsVUFBVCxDQUFvQkMsR0FBcEIsRUFBeUI7UUFDcEIsQ0FBRUMsT0FBT0MsUUFBUCxDQUFrQkYsR0FBbEIsQ0FBTCxFQUE2QjtVQUN4QkEsSUFBSUcsS0FBUCxFQUFlO2NBQ1BGLE9BQU9HLElBQVAsQ0FBY0osSUFBSUcsS0FBbEIsQ0FBTjtPQURGLE1BRUssSUFBR0gsSUFBSUssVUFBUCxFQUFvQjtjQUNqQkosT0FBT0csSUFBUCxDQUFjSixHQUFkLENBQU47T0FERyxNQUVB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
