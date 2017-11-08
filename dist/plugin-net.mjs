import { connect, createServer } from 'tls';
import { createConnection, createServer as createServer$1 } from 'net';

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

    hub.registerConnectionProtocol('tls:', connect$$1);
    return hub.tls = { connect: connect$$1, createServer: createServer$$1 };

    function connect$$1(...args) {
      args = _common_.unpackConnectArgs(args);
      return new Promise((resolve, reject) => {
        connect(...args, function () {
          const sock = this.unref().setKeepAlive(true);
          const channel = _common_.bindChannel(sock);
          resolve(channel);
        }).on('error', reject);
      });
    }

    function createServer$$1(options, onPeer) {
      const svr = createServer(options, sock => {
        sock = sock.unref().setKeepAlive(false);
        const channel = _common_.bindChannel(sock);
        on_peer(channel);
      });
      const on_peer = _common_.bindOnPeer(svr, onPeer);
      return svr;
    }
  };
}

tcp_plugin.tcp_plugin = tcp_plugin;
function tcp_plugin(plugin_options = {}) {
  function as_tcp_url() {
    return `tcp://${this.address}:${this.port}`;
  }

  return function (hub) {
    const _common_ = net_common(hub, as_tcp_url);

    hub.registerConnectionProtocol('tcp:', connect$$1);
    return hub.tcp = { connect: connect$$1, createServer: createServer$$1 };

    function connect$$1(...args) {
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
      const svr = createServer$1(function (sock) {
        sock = sock.unref().setKeepAlive(false);
        const channel = _common_.bindChannel(sock);
        on_peer(channel);
      });
      const on_peer = _common_.bindOnPeer(svr, onPeer);
      return _common_.init_server(svr);
    }
  };
}

export { tls_plugin as tls, tcp_plugin as tcp, bindStreamChannel, connectPacketStream };
export default tcp_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLW5ldC5tanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvcGx1Z2lucy9uZXQvX3N0cmVhbV9jb21tb24uanN5IiwiLi4vY29kZS9wbHVnaW5zL25ldC9fbmV0X2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L3Rscy5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L3RjcC5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIGJpbmRTdHJlYW1DaGFubmVsKHN0cmVhbSwgYXBpX2NoYW5uZWwsIHByb3BzKSA6OlxuICBjb25zdCBjaGFubmVsID0gYXBpX2NoYW5uZWwuYmluZENoYW5uZWwgQCBzZW5kTXNnUmF3LCBwcm9wc1xuICBjb25uZWN0UGFja2V0U3RyZWFtIEAgc3RyZWFtLCBjaGFubmVsLCB0cnVlXG4gIHJldHVybiBjaGFubmVsXG5cbiAgZnVuY3Rpb24gc2VuZE1zZ1Jhdyhtc2cpIDo6XG4gICAgaWYgISBCdWZmZXIuaXNCdWZmZXIgQCBtc2cgOjpcbiAgICAgIGlmIG1zZy5fcmF3XyA6OlxuICAgICAgICBtc2cgPSBCdWZmZXIuZnJvbSBAIG1zZy5fcmF3X1xuICAgICAgZWxzZSBpZiBtc2cuYnl0ZUxlbmd0aCA6OlxuICAgICAgICBtc2cgPSBCdWZmZXIuZnJvbSBAIG1zZ1xuICAgICAgZWxzZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYHNlbmRNc2dSYXcgZXhwZWN0ZWQgJ21zZycgYXMgYSBCdWZmZXIgb3IgYW4gb2JqZWN0IHdpdGggYSAnX3Jhd18nIEJ1ZmZlcmBcblxuICAgIGlmIG51bGwgPT09IG1zZyA6OlxuICAgICAgcmV0dXJuIHZvaWQgc3RyZWFtLmVuZCgpXG4gICAgcmV0dXJuIHZvaWQgc3RyZWFtLndyaXRlKG1zZylcblxuXG5leHBvcnQgZnVuY3Rpb24gY29ubmVjdFBhY2tldFN0cmVhbShzdHJlYW0sIGNoYW5uZWwsIGVuZFN0cmVhbU9uU2h1dGRvd24pIDo6XG4gIGNvbnN0IHNodXRkb3duID0gbmV3IFByb21pc2UgQCBsaWZlY3ljbGVcbiAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIGNoYW5uZWwsICdzaHV0ZG93bicsIEA6IHZhbHVlOiBzaHV0ZG93blxuICBcbiAgZnVuY3Rpb24gbGlmZWN5Y2xlKHJlc29sdmUsIHJlamVjdCkgOjpcbiAgICBsZXQgcGt0RGlzcGF0Y2ggPSBjaGFubmVsLmJpbmREaXNwYXRjaFBhY2tldHMoKVxuXG4gICAgc3RyZWFtLm9uIEAgJ2Vycm9yJywgc2h1dGRvd25cbiAgICBzdHJlYW0ub24gQCAnY2xvc2UnLCBzaHV0ZG93blxuICAgIHN0cmVhbS5vbiBAICdkYXRhJywgZnVuY3Rpb24gKGRhdGEpIDo6XG4gICAgICB0cnkgOjogcGt0RGlzcGF0Y2goZGF0YSlcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICByZXR1cm4gc2h1dGRvd24oZXJyKVxuXG4gICAgZnVuY3Rpb24gc2h1dGRvd24oZXJyKSA6OlxuICAgICAgaWYgdW5kZWZpbmVkID09PSBwa3REaXNwYXRjaCA6OiByZXR1cm5cbiAgICAgIHBrdERpc3BhdGNoID0gdW5kZWZpbmVkXG4gICAgICBpZiBlbmRTdHJlYW1PblNodXRkb3duIDo6XG4gICAgICAgIHN0cmVhbS5lbmQoKVxuXG4gICAgICBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKVxuXG4iLCJpbXBvcnQge2JpbmRTdHJlYW1DaGFubmVsfSBmcm9tICcuL19zdHJlYW1fY29tbW9uLmpzeSdcblxubmV0X2NvbW1vbi5uZXRfY29tbW9uID0gbmV0X2NvbW1vblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbmV0X2NvbW1vbihodWIsIGFzVVJMKSA6OlxuICAvLyBzaGFyZWQgaW1wbGVtZW50YXRpb24gYmV0d2VlbiBuZXQvdGNwIGFuZCB0bHMgaW1wbGVtZW50YXRpb25zXG4gIHJldHVybiBAOlxuICAgIGluaXRfc2VydmVyKHN2cikgOjpcbiAgICAgIHN2ci5jb25uX2luZm8gPSBmdW5jdGlvbiAoKSA6OlxuICAgICAgICBjb25zdCB7YWRkcmVzcywgcG9ydH0gPSBzdnIuYWRkcmVzcygpXG4gICAgICAgIHJldHVybiBAe30gaXBfc2VydmVyOiBAe30gYWRkcmVzcywgcG9ydCwgYXNVUkxcbiAgICAgIHJldHVybiBzdnJcblxuICAgIGJpbmRPblBlZXIoc3ZyLCBvblBlZXIpIDo6XG4gICAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2Ygb25QZWVyIDo6XG4gICAgICAgIHJldHVybiBvblBlZXJcbiAgICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2Ygb25QZWVyIDo6XG4gICAgICAgIHJldHVybiBjaGFubmVsID0+IHN2ci5lbWl0IEAgb25QZWVyLCBjaGFubmVsXG4gICAgICByZXR1cm4gKCkgPT4gbnVsbFxuXG4gICAgYmluZENoYW5uZWwoc29jaykgOjpcbiAgICAgIGNvbnN0IGNoYW5uZWwgPSBiaW5kU29ja2V0Q2hhbm5lbCBAXG4gICAgICAgIHNvY2ssIGh1Yi5fYXBpX2NoYW5uZWwsIGFzVVJMXG5cbiAgICAgIGNoYW5uZWwuc2VuZFJvdXRpbmdIYW5kc2hha2UoKVxuICAgICAgcmV0dXJuIGNoYW5uZWxcblxuICAgIHVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpIDo6XG4gICAgICBpZiAxID09PSBhcmdzLmxlbmd0aCA6OlxuICAgICAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGFyZ3NbMF0uaHJlZiA6OlxuICAgICAgICAgIGNvbnN0IHtob3N0bmFtZTpob3N0LCBwb3J0fSA9IGFyZ3NbMF1cbiAgICAgICAgICBhcmdzWzBdID0gQHt9IGhvc3QsIHBvcnRcbiAgICAgIHJldHVybiBhcmdzXG5cblxubmV0X2NvbW1vbi5iaW5kU29ja2V0Q2hhbm5lbCA9IGJpbmRTb2NrZXRDaGFubmVsXG5mdW5jdGlvbiBiaW5kU29ja2V0Q2hhbm5lbChzb2NrLCBhcGlfY2hhbm5lbCwgYXNVUkwpIDo6XG4gIHNvY2suc2V0Tm9EZWxheSh0cnVlKVxuXG4gIGNvbnN0IGNvbm5faW5mbyA9ICgpID0+IEA6XG4gICAgaXBfcmVtb3RlOiBAe30gYXNVUkwsIGFkZHJlc3M6IHNvY2sucmVtb3RlQWRkcmVzcywgcG9ydDogc29jay5yZW1vdGVQb3J0XG4gICAgaXBfbG9jYWw6IEB7fSBhc1VSTCwgYWRkcmVzczogc29jay5sb2NhbEFkZHJlc3MsIHBvcnQ6IHNvY2subG9jYWxQb3J0XG5cbiAgcmV0dXJuIGJpbmRTdHJlYW1DaGFubmVsIEAgc29jaywgYXBpX2NoYW5uZWxcbiAgICBAOiBjb25uX2luZm86IEA6IHZhbHVlOiBjb25uX2luZm9cblxuIiwiaW1wb3J0IHsgY3JlYXRlU2VydmVyIGFzIF90bHNfY3JlYXRlU2VydmVyLCBjb25uZWN0IGFzIF90bHNfY29ubmVjdCB9IGZyb20gJ3RscydcbmltcG9ydCBuZXRfY29tbW9uIGZyb20gJy4vX25ldF9jb21tb24uanN5J1xuXG50bHNfcGx1Z2luLnRsc19wbHVnaW4gPSB0bHNfcGx1Z2luXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB0bHNfcGx1Z2luKHBsdWdpbl9vcHRpb25zPXt9KSA6OlxuICBmdW5jdGlvbiBhc190bHNfdXJsKCkgOjogcmV0dXJuIGB0bHM6Ly8ke3RoaXMuYWRkcmVzc306JHt0aGlzLnBvcnR9YFxuXG4gIHJldHVybiBmdW5jdGlvbihodWIpIDo6XG4gICAgY29uc3QgX2NvbW1vbl8gPSBuZXRfY29tbW9uKGh1YiwgYXNfdGxzX3VybClcblxuICAgIGh1Yi5yZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCBAICd0bHM6JywgY29ubmVjdFxuICAgIHJldHVybiBodWIudGxzID0gQDogY29ubmVjdCwgY3JlYXRlU2VydmVyXG5cblxuICAgIGZ1bmN0aW9uIGNvbm5lY3QoLi4uYXJncykgOjpcbiAgICAgIGFyZ3MgPSBfY29tbW9uXy51bnBhY2tDb25uZWN0QXJncyhhcmdzKVxuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlIEAgKHJlc29sdmUsIHJlamVjdCkgPT4gOjpcbiAgICAgICAgX3Rsc19jb25uZWN0IEAgLi4uYXJncywgZnVuY3Rpb24gKCkgOjpcbiAgICAgICAgICBjb25zdCBzb2NrID0gdGhpcy51bnJlZigpLnNldEtlZXBBbGl2ZSh0cnVlKVxuICAgICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICAgIHJlc29sdmUoY2hhbm5lbClcbiAgICAgICAgLm9uIEAgJ2Vycm9yJywgcmVqZWN0XG5cbiAgICBmdW5jdGlvbiBjcmVhdGVTZXJ2ZXIob3B0aW9ucywgb25QZWVyKSA6OlxuICAgICAgY29uc3Qgc3ZyID0gX3Rsc19jcmVhdGVTZXJ2ZXIgQCBvcHRpb25zLCBzb2NrID0+IDo6XG4gICAgICAgIHNvY2sgPSBzb2NrLnVucmVmKCkuc2V0S2VlcEFsaXZlKGZhbHNlKVxuICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgb25fcGVlcihjaGFubmVsKVxuICAgICAgY29uc3Qgb25fcGVlciA9IF9jb21tb25fLmJpbmRPblBlZXIoc3ZyLCBvblBlZXIpXG4gICAgICByZXR1cm4gc3ZyXG4iLCJpbXBvcnQgeyBjcmVhdGVTZXJ2ZXIgYXMgX3RjcF9jcmVhdGVTZXJ2ZXIsIGNyZWF0ZUNvbm5lY3Rpb24gYXMgX3RjcF9jcmVhdGVDb25uZWN0aW9uIH0gZnJvbSAnbmV0J1xuaW1wb3J0IG5ldF9jb21tb24gZnJvbSAnLi9fbmV0X2NvbW1vbi5qc3knXG5cbnRjcF9wbHVnaW4udGNwX3BsdWdpbiA9IHRjcF9wbHVnaW5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRjcF9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGZ1bmN0aW9uIGFzX3RjcF91cmwoKSA6OiByZXR1cm4gYHRjcDovLyR7dGhpcy5hZGRyZXNzfToke3RoaXMucG9ydH1gXG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGh1YikgOjpcbiAgICBjb25zdCBfY29tbW9uXyA9IG5ldF9jb21tb24oaHViLCBhc190Y3BfdXJsKVxuXG4gICAgaHViLnJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sIEAgJ3RjcDonLCBjb25uZWN0XG4gICAgcmV0dXJuIGh1Yi50Y3AgPSBAOiBjb25uZWN0LCBjcmVhdGVTZXJ2ZXJcblxuXG4gICAgZnVuY3Rpb24gY29ubmVjdCguLi5hcmdzKSA6OlxuICAgICAgYXJncyA9IF9jb21tb25fLnVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UgQCAocmVzb2x2ZSwgcmVqZWN0KSA9PiA6OlxuICAgICAgICBfdGNwX2NyZWF0ZUNvbm5lY3Rpb24gQCAuLi5hcmdzLCBmdW5jdGlvbigpIDo6XG4gICAgICAgICAgY29uc3Qgc29jayA9IHRoaXMudW5yZWYoKS5zZXRLZWVwQWxpdmUodHJ1ZSlcbiAgICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgICByZXNvbHZlKGNoYW5uZWwpXG4gICAgICAgIC5vbiBAICdlcnJvcicsIHJlamVjdFxuXG4gICAgZnVuY3Rpb24gY3JlYXRlU2VydmVyKG9uUGVlcikgOjpcbiAgICAgIGNvbnN0IHN2ciA9IF90Y3BfY3JlYXRlU2VydmVyIEAgZnVuY3Rpb24gKHNvY2spIDo6XG4gICAgICAgIHNvY2sgPSBzb2NrLnVucmVmKCkuc2V0S2VlcEFsaXZlKGZhbHNlKVxuICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgb25fcGVlcihjaGFubmVsKVxuICAgICAgY29uc3Qgb25fcGVlciA9IF9jb21tb25fLmJpbmRPblBlZXIoc3ZyLCBvblBlZXIpXG4gICAgICByZXR1cm4gX2NvbW1vbl8uaW5pdF9zZXJ2ZXIoc3ZyKVxuXG4iXSwibmFtZXMiOlsiYmluZFN0cmVhbUNoYW5uZWwiLCJzdHJlYW0iLCJhcGlfY2hhbm5lbCIsInByb3BzIiwiY2hhbm5lbCIsImJpbmRDaGFubmVsIiwic2VuZE1zZ1JhdyIsIm1zZyIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiX3Jhd18iLCJmcm9tIiwiYnl0ZUxlbmd0aCIsIlR5cGVFcnJvciIsImVuZCIsIndyaXRlIiwiY29ubmVjdFBhY2tldFN0cmVhbSIsImVuZFN0cmVhbU9uU2h1dGRvd24iLCJzaHV0ZG93biIsIlByb21pc2UiLCJsaWZlY3ljbGUiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsInZhbHVlIiwicmVzb2x2ZSIsInJlamVjdCIsInBrdERpc3BhdGNoIiwiYmluZERpc3BhdGNoUGFja2V0cyIsIm9uIiwiZGF0YSIsImVyciIsInVuZGVmaW5lZCIsIm5ldF9jb21tb24iLCJodWIiLCJhc1VSTCIsInN2ciIsImNvbm5faW5mbyIsImFkZHJlc3MiLCJwb3J0IiwiaXBfc2VydmVyIiwib25QZWVyIiwiZW1pdCIsInNvY2siLCJiaW5kU29ja2V0Q2hhbm5lbCIsIl9hcGlfY2hhbm5lbCIsInNlbmRSb3V0aW5nSGFuZHNoYWtlIiwiYXJncyIsImxlbmd0aCIsImhyZWYiLCJob3N0bmFtZSIsImhvc3QiLCJzZXROb0RlbGF5IiwicmVtb3RlQWRkcmVzcyIsInJlbW90ZVBvcnQiLCJsb2NhbEFkZHJlc3MiLCJsb2NhbFBvcnQiLCJ0bHNfcGx1Z2luIiwicGx1Z2luX29wdGlvbnMiLCJhc190bHNfdXJsIiwiX2NvbW1vbl8iLCJyZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCIsImNvbm5lY3QiLCJ0bHMiLCJjcmVhdGVTZXJ2ZXIiLCJ1bnBhY2tDb25uZWN0QXJncyIsInVucmVmIiwic2V0S2VlcEFsaXZlIiwib3B0aW9ucyIsIl90bHNfY3JlYXRlU2VydmVyIiwib25fcGVlciIsImJpbmRPblBlZXIiLCJ0Y3BfcGx1Z2luIiwiYXNfdGNwX3VybCIsInRjcCIsIl90Y3BfY3JlYXRlU2VydmVyIiwiaW5pdF9zZXJ2ZXIiXSwibWFwcGluZ3MiOiI7OztBQUFPLFNBQVNBLGlCQUFULENBQTJCQyxNQUEzQixFQUFtQ0MsV0FBbkMsRUFBZ0RDLEtBQWhELEVBQXVEO1FBQ3REQyxVQUFVRixZQUFZRyxXQUFaLENBQTBCQyxVQUEx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
