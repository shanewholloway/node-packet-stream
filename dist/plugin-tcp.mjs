import { createConnection, createServer } from 'net';

function bindStreamChannel(stream, api_channel, props) {
  const channel = api_channel.bindChannel(sendPktRaw, props);
  connectPacketStream(stream, channel, true);
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
      return void stream.end();
    }
    return void stream.write(pkt);
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

tcp_plugin.tcp_plugin = tcp_plugin;
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
        createConnection(...args, function () {
          const sock = this.unref().setKeepAlive(true);
          const channel = _common_.bindChannel(sock);
          resolve(channel);
        }).on('error', reject);
      });
    }

    function createServer$$1(onPeer) {
      const svr = createServer(function (sock) {
        sock = sock.unref().setKeepAlive(false);
        const channel = _common_.bindChannel(sock);
        on_peer(channel);
      });
      const on_peer = _common_.bindOnPeer(svr, onPeer);
      return _common_.init_server(svr);
    }
  };
}

export default tcp_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXRjcC5tanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvcGx1Z2lucy9uZXQvX3N0cmVhbV9jb21tb24uanN5IiwiLi4vY29kZS9wbHVnaW5zL25ldC9fbmV0X2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L3RjcC5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIGJpbmRTdHJlYW1DaGFubmVsKHN0cmVhbSwgYXBpX2NoYW5uZWwsIHByb3BzKSA6OlxuICBjb25zdCBjaGFubmVsID0gYXBpX2NoYW5uZWwuYmluZENoYW5uZWwgQCBzZW5kUGt0UmF3LCBwcm9wc1xuICBjb25uZWN0UGFja2V0U3RyZWFtIEAgc3RyZWFtLCBjaGFubmVsLCB0cnVlXG4gIHJldHVybiBjaGFubmVsXG5cbiAgZnVuY3Rpb24gc2VuZFBrdFJhdyhwa3QpIDo6XG4gICAgaWYgISBCdWZmZXIuaXNCdWZmZXIgQCBwa3QgOjpcbiAgICAgIGlmIHBrdC5fcmF3XyA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdC5fcmF3X1xuICAgICAgZWxzZSBpZiBwa3QuYnl0ZUxlbmd0aCA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdFxuICAgICAgZWxzZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYHNlbmRQa3RSYXcgZXhwZWN0ZWQgJ3BrdCcgYXMgYSBCdWZmZXIgb3IgYW4gb2JqZWN0IHdpdGggYSAnX3Jhd18nIEJ1ZmZlcmBcblxuICAgIGlmIG51bGwgPT09IHBrdCA6OlxuICAgICAgcmV0dXJuIHZvaWQgc3RyZWFtLmVuZCgpXG4gICAgcmV0dXJuIHZvaWQgc3RyZWFtLndyaXRlKHBrdClcblxuXG5leHBvcnQgZnVuY3Rpb24gY29ubmVjdFBhY2tldFN0cmVhbShzdHJlYW0sIGNoYW5uZWwsIGVuZFN0cmVhbU9uU2h1dGRvd24pIDo6XG4gIGNvbnN0IHNodXRkb3duID0gbmV3IFByb21pc2UgQCBsaWZlY3ljbGVcbiAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIGNoYW5uZWwsICdzaHV0ZG93bicsIEA6IHZhbHVlOiBzaHV0ZG93blxuICBcbiAgZnVuY3Rpb24gbGlmZWN5Y2xlKHJlc29sdmUsIHJlamVjdCkgOjpcbiAgICBsZXQgcGt0RGlzcGF0Y2ggPSBjaGFubmVsLmJpbmREaXNwYXRjaFBhY2tldHMoKVxuXG4gICAgc3RyZWFtLm9uIEAgJ2Vycm9yJywgc2h1dGRvd25cbiAgICBzdHJlYW0ub24gQCAnY2xvc2UnLCBzaHV0ZG93blxuICAgIHN0cmVhbS5vbiBAICdkYXRhJywgZnVuY3Rpb24gKGRhdGEpIDo6XG4gICAgICB0cnkgOjogcGt0RGlzcGF0Y2goZGF0YSlcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICByZXR1cm4gc2h1dGRvd24oZXJyKVxuXG4gICAgZnVuY3Rpb24gc2h1dGRvd24oZXJyKSA6OlxuICAgICAgaWYgdW5kZWZpbmVkID09PSBwa3REaXNwYXRjaCA6OiByZXR1cm5cbiAgICAgIHBrdERpc3BhdGNoID0gdW5kZWZpbmVkXG4gICAgICBpZiBlbmRTdHJlYW1PblNodXRkb3duIDo6XG4gICAgICAgIHN0cmVhbS5lbmQoKVxuXG4gICAgICBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKVxuXG4iLCJpbXBvcnQge2JpbmRTdHJlYW1DaGFubmVsfSBmcm9tICcuL19zdHJlYW1fY29tbW9uLmpzeSdcblxubmV0X2NvbW1vbi5uZXRfY29tbW9uID0gbmV0X2NvbW1vblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbmV0X2NvbW1vbihodWIsIGFzVVJMKSA6OlxuICAvLyBzaGFyZWQgaW1wbGVtZW50YXRpb24gYmV0d2VlbiBuZXQvdGNwIGFuZCB0bHMgaW1wbGVtZW50YXRpb25zXG4gIHJldHVybiBAOlxuICAgIGluaXRfc2VydmVyKHN2cikgOjpcbiAgICAgIHN2ci5jb25uX2luZm8gPSBmdW5jdGlvbiAoKSA6OlxuICAgICAgICBjb25zdCB7YWRkcmVzcywgcG9ydH0gPSBzdnIuYWRkcmVzcygpXG4gICAgICAgIHJldHVybiBAe30gaXBfc2VydmVyOiBAe30gYWRkcmVzcywgcG9ydCwgYXNVUkxcbiAgICAgIHJldHVybiBzdnJcblxuICAgIGJpbmRPblBlZXIoc3ZyLCBvblBlZXIpIDo6XG4gICAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2Ygb25QZWVyIDo6XG4gICAgICAgIHJldHVybiBvblBlZXJcbiAgICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2Ygb25QZWVyIDo6XG4gICAgICAgIHJldHVybiBjaGFubmVsID0+IHN2ci5lbWl0IEAgb25QZWVyLCBjaGFubmVsXG4gICAgICByZXR1cm4gKCkgPT4gbnVsbFxuXG4gICAgYmluZENoYW5uZWwoc29jaykgOjpcbiAgICAgIGNvbnN0IGNoYW5uZWwgPSBiaW5kU29ja2V0Q2hhbm5lbCBAXG4gICAgICAgIHNvY2ssIGh1Yi5fYXBpX2NoYW5uZWwsIGFzVVJMXG5cbiAgICAgIGNoYW5uZWwuc2VuZFJvdXRpbmdIYW5kc2hha2UoKVxuICAgICAgcmV0dXJuIGNoYW5uZWxcblxuICAgIHVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpIDo6XG4gICAgICBpZiAxID09PSBhcmdzLmxlbmd0aCA6OlxuICAgICAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGFyZ3NbMF0uaHJlZiA6OlxuICAgICAgICAgIGNvbnN0IHtob3N0bmFtZTpob3N0LCBwb3J0fSA9IGFyZ3NbMF1cbiAgICAgICAgICBhcmdzWzBdID0gQHt9IGhvc3QsIHBvcnRcbiAgICAgIHJldHVybiBhcmdzXG5cblxubmV0X2NvbW1vbi5iaW5kU29ja2V0Q2hhbm5lbCA9IGJpbmRTb2NrZXRDaGFubmVsXG5mdW5jdGlvbiBiaW5kU29ja2V0Q2hhbm5lbChzb2NrLCBhcGlfY2hhbm5lbCwgYXNVUkwpIDo6XG4gIHNvY2suc2V0Tm9EZWxheSh0cnVlKVxuXG4gIGNvbnN0IGNvbm5faW5mbyA9ICgpID0+IEA6XG4gICAgaXBfcmVtb3RlOiBAe30gYXNVUkwsIGFkZHJlc3M6IHNvY2sucmVtb3RlQWRkcmVzcywgcG9ydDogc29jay5yZW1vdGVQb3J0XG4gICAgaXBfbG9jYWw6IEB7fSBhc1VSTCwgYWRkcmVzczogc29jay5sb2NhbEFkZHJlc3MsIHBvcnQ6IHNvY2subG9jYWxQb3J0XG5cbiAgcmV0dXJuIGJpbmRTdHJlYW1DaGFubmVsIEAgc29jaywgYXBpX2NoYW5uZWxcbiAgICBAOiBjb25uX2luZm86IEA6IHZhbHVlOiBjb25uX2luZm9cblxuIiwiaW1wb3J0IHsgY3JlYXRlU2VydmVyIGFzIF90Y3BfY3JlYXRlU2VydmVyLCBjcmVhdGVDb25uZWN0aW9uIGFzIF90Y3BfY3JlYXRlQ29ubmVjdGlvbiB9IGZyb20gJ25ldCdcbmltcG9ydCBuZXRfY29tbW9uIGZyb20gJy4vX25ldF9jb21tb24uanN5J1xuXG50Y3BfcGx1Z2luLnRjcF9wbHVnaW4gPSB0Y3BfcGx1Z2luXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB0Y3BfcGx1Z2luKHBsdWdpbl9vcHRpb25zPXt9KSA6OlxuICBmdW5jdGlvbiBhc190Y3BfdXJsKCkgOjogcmV0dXJuIGB0Y3A6Ly8ke3RoaXMuYWRkcmVzc306JHt0aGlzLnBvcnR9YFxuXG4gIHJldHVybiBmdW5jdGlvbihodWIpIDo6XG4gICAgY29uc3QgX2NvbW1vbl8gPSBuZXRfY29tbW9uKGh1YiwgYXNfdGNwX3VybClcblxuICAgIGh1Yi5yZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCBAICd0Y3A6JywgY29ubmVjdFxuICAgIHJldHVybiBodWIudGNwID0gQDogY29ubmVjdCwgY3JlYXRlU2VydmVyXG5cblxuICAgIGZ1bmN0aW9uIGNvbm5lY3QoLi4uYXJncykgOjpcbiAgICAgIGFyZ3MgPSBfY29tbW9uXy51bnBhY2tDb25uZWN0QXJncyhhcmdzKVxuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlIEAgKHJlc29sdmUsIHJlamVjdCkgPT4gOjpcbiAgICAgICAgX3RjcF9jcmVhdGVDb25uZWN0aW9uIEAgLi4uYXJncywgZnVuY3Rpb24oKSA6OlxuICAgICAgICAgIGNvbnN0IHNvY2sgPSB0aGlzLnVucmVmKCkuc2V0S2VlcEFsaXZlKHRydWUpXG4gICAgICAgICAgY29uc3QgY2hhbm5lbCA9IF9jb21tb25fLmJpbmRDaGFubmVsKHNvY2spXG4gICAgICAgICAgcmVzb2x2ZShjaGFubmVsKVxuICAgICAgICAub24gQCAnZXJyb3InLCByZWplY3RcblxuICAgIGZ1bmN0aW9uIGNyZWF0ZVNlcnZlcihvblBlZXIpIDo6XG4gICAgICBjb25zdCBzdnIgPSBfdGNwX2NyZWF0ZVNlcnZlciBAIGZ1bmN0aW9uIChzb2NrKSA6OlxuICAgICAgICBzb2NrID0gc29jay51bnJlZigpLnNldEtlZXBBbGl2ZShmYWxzZSlcbiAgICAgICAgY29uc3QgY2hhbm5lbCA9IF9jb21tb25fLmJpbmRDaGFubmVsKHNvY2spXG4gICAgICAgIG9uX3BlZXIoY2hhbm5lbClcbiAgICAgIGNvbnN0IG9uX3BlZXIgPSBfY29tbW9uXy5iaW5kT25QZWVyKHN2ciwgb25QZWVyKVxuICAgICAgcmV0dXJuIF9jb21tb25fLmluaXRfc2VydmVyKHN2cilcblxuIl0sIm5hbWVzIjpbImJpbmRTdHJlYW1DaGFubmVsIiwic3RyZWFtIiwiYXBpX2NoYW5uZWwiLCJwcm9wcyIsImNoYW5uZWwiLCJiaW5kQ2hhbm5lbCIsInNlbmRQa3RSYXciLCJwa3QiLCJCdWZmZXIiLCJpc0J1ZmZlciIsIl9yYXdfIiwiZnJvbSIsImJ5dGVMZW5ndGgiLCJUeXBlRXJyb3IiLCJlbmQiLCJ3cml0ZSIsImNvbm5lY3RQYWNrZXRTdHJlYW0iLCJlbmRTdHJlYW1PblNodXRkb3duIiwic2h1dGRvd24iLCJQcm9taXNlIiwibGlmZWN5Y2xlIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJ2YWx1ZSIsInJlc29sdmUiLCJyZWplY3QiLCJwa3REaXNwYXRjaCIsImJpbmREaXNwYXRjaFBhY2tldHMiLCJvbiIsImRhdGEiLCJlcnIiLCJ1bmRlZmluZWQiLCJuZXRfY29tbW9uIiwiaHViIiwiYXNVUkwiLCJzdnIiLCJjb25uX2luZm8iLCJhZGRyZXNzIiwicG9ydCIsImlwX3NlcnZlciIsIm9uUGVlciIsImVtaXQiLCJzb2NrIiwiYmluZFNvY2tldENoYW5uZWwiLCJfYXBpX2NoYW5uZWwiLCJzZW5kUm91dGluZ0hhbmRzaGFrZSIsImFyZ3MiLCJsZW5ndGgiLCJocmVmIiwiaG9zdG5hbWUiLCJob3N0Iiwic2V0Tm9EZWxheSIsInJlbW90ZUFkZHJlc3MiLCJyZW1vdGVQb3J0IiwibG9jYWxBZGRyZXNzIiwibG9jYWxQb3J0IiwidGNwX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwiYXNfdGNwX3VybCIsIl9jb21tb25fIiwicmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wiLCJjb25uZWN0IiwidGNwIiwiY3JlYXRlU2VydmVyIiwidW5wYWNrQ29ubmVjdEFyZ3MiLCJ1bnJlZiIsInNldEtlZXBBbGl2ZSIsIl90Y3BfY3JlYXRlU2VydmVyIiwib25fcGVlciIsImJpbmRPblBlZXIiLCJpbml0X3NlcnZlciJdLCJtYXBwaW5ncyI6Ijs7QUFBTyxTQUFTQSxpQkFBVCxDQUEyQkMsTUFBM0IsRUFBbUNDLFdBQW5DLEVBQWdEQyxLQUFoRCxFQUF1RDtRQUN0REMsVUFBVUYsWUFBWUcsV0FBWixDQUEwQkMsVUFBMUIsRUFBc0NILEtBQXRDLENBQWhCO3NCQUNzQkYsTUFBdEIsRUFBOEJHLE9BQTlCLEVBQXVDLElBQXZDO1NBQ09BLE9BQVA7O1dBRVNFLFVBQVQsQ0FBb0JDLEdBQXBCLEVBQXlCO1FBQ3BCLENBQUVDLE9BQU9DLFFBQVAsQ0FBa0JGLEdBQWxCLENBQUwsRUFBNkI7VUFDeEJBLElBQUlHLEtBQVAsRUFBZTtjQUNQRixPQUFPRyxJQUFQLENBQWNKLElBQUlHLEtBQWxCLENBQU47T0FERixNQUVLLElBQUdILElBQUlLLFVBQVAsRUFBb0I7Y0FDakJKLE9BQU9HLElBQVAsQ0FBY0osR0FBZCxDQUFOO09BREcsTUFFQTtjQUNHLElBQUlNLFNBQUosQ0FBaUIsMEVBQWpCLENBQU47Ozs7UUFFRCxTQUFT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
