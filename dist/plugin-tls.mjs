import { connect, createServer } from 'tls';

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

export default tls_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXRscy5tanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvcGx1Z2lucy9uZXQvX3N0cmVhbV9jb21tb24uanN5IiwiLi4vY29kZS9wbHVnaW5zL25ldC9fbmV0X2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L3Rscy5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIGJpbmRTdHJlYW1DaGFubmVsKHN0cmVhbSwgYXBpX2NoYW5uZWwsIHByb3BzKSA6OlxuICBjb25zdCBjaGFubmVsID0gYXBpX2NoYW5uZWwuYmluZENoYW5uZWwgQCBzZW5kUGt0UmF3LCBwcm9wc1xuICBjb25uZWN0UGFja2V0U3RyZWFtIEAgc3RyZWFtLCBjaGFubmVsLCB0cnVlXG4gIHJldHVybiBjaGFubmVsXG5cbiAgZnVuY3Rpb24gc2VuZFBrdFJhdyhwa3QpIDo6XG4gICAgaWYgISBCdWZmZXIuaXNCdWZmZXIgQCBwa3QgOjpcbiAgICAgIGlmIHBrdC5fcmF3XyA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdC5fcmF3X1xuICAgICAgZWxzZSBpZiBwa3QuYnl0ZUxlbmd0aCA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdFxuICAgICAgZWxzZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYHNlbmRQa3RSYXcgZXhwZWN0ZWQgJ3BrdCcgYXMgYSBCdWZmZXIgb3IgYW4gb2JqZWN0IHdpdGggYSAnX3Jhd18nIEJ1ZmZlcmBcblxuICAgIGlmIG51bGwgPT09IHBrdCA6OlxuICAgICAgcmV0dXJuIHZvaWQgc3RyZWFtLmVuZCgpXG4gICAgcmV0dXJuIHZvaWQgc3RyZWFtLndyaXRlKHBrdClcblxuXG5leHBvcnQgZnVuY3Rpb24gY29ubmVjdFBhY2tldFN0cmVhbShzdHJlYW0sIGNoYW5uZWwsIGVuZFN0cmVhbU9uU2h1dGRvd24pIDo6XG4gIGNvbnN0IHNodXRkb3duID0gbmV3IFByb21pc2UgQCBsaWZlY3ljbGVcbiAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIGNoYW5uZWwsICdzaHV0ZG93bicsIEA6IHZhbHVlOiBzaHV0ZG93blxuICBcbiAgZnVuY3Rpb24gbGlmZWN5Y2xlKHJlc29sdmUsIHJlamVjdCkgOjpcbiAgICBsZXQgcGt0RGlzcGF0Y2ggPSBjaGFubmVsLmJpbmREaXNwYXRjaFBhY2tldHMoKVxuXG4gICAgc3RyZWFtLm9uIEAgJ2Vycm9yJywgc2h1dGRvd25cbiAgICBzdHJlYW0ub24gQCAnY2xvc2UnLCBzaHV0ZG93blxuICAgIHN0cmVhbS5vbiBAICdkYXRhJywgZnVuY3Rpb24gKGRhdGEpIDo6XG4gICAgICB0cnkgOjogcGt0RGlzcGF0Y2goZGF0YSlcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICByZXR1cm4gc2h1dGRvd24oZXJyKVxuXG4gICAgZnVuY3Rpb24gc2h1dGRvd24oZXJyKSA6OlxuICAgICAgaWYgdW5kZWZpbmVkID09PSBwa3REaXNwYXRjaCA6OiByZXR1cm5cbiAgICAgIHBrdERpc3BhdGNoID0gdW5kZWZpbmVkXG4gICAgICBpZiBlbmRTdHJlYW1PblNodXRkb3duIDo6XG4gICAgICAgIHN0cmVhbS5lbmQoKVxuXG4gICAgICBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKVxuXG4iLCJpbXBvcnQge2JpbmRTdHJlYW1DaGFubmVsfSBmcm9tICcuL19zdHJlYW1fY29tbW9uLmpzeSdcblxubmV0X2NvbW1vbi5uZXRfY29tbW9uID0gbmV0X2NvbW1vblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gbmV0X2NvbW1vbihodWIsIGFzVVJMKSA6OlxuICAvLyBzaGFyZWQgaW1wbGVtZW50YXRpb24gYmV0d2VlbiBuZXQvdGNwIGFuZCB0bHMgaW1wbGVtZW50YXRpb25zXG4gIHJldHVybiBAOlxuICAgIGluaXRfc2VydmVyKHN2cikgOjpcbiAgICAgIHN2ci5jb25uX2luZm8gPSBmdW5jdGlvbiAoKSA6OlxuICAgICAgICBjb25zdCB7YWRkcmVzcywgcG9ydH0gPSBzdnIuYWRkcmVzcygpXG4gICAgICAgIHJldHVybiBAe30gaXBfc2VydmVyOiBAe30gYWRkcmVzcywgcG9ydCwgYXNVUkxcbiAgICAgIHJldHVybiBzdnJcblxuICAgIGJpbmRPblBlZXIoc3ZyLCBvblBlZXIpIDo6XG4gICAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2Ygb25QZWVyIDo6XG4gICAgICAgIHJldHVybiBvblBlZXJcbiAgICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2Ygb25QZWVyIDo6XG4gICAgICAgIHJldHVybiBjaGFubmVsID0+IHN2ci5lbWl0IEAgb25QZWVyLCBjaGFubmVsXG4gICAgICByZXR1cm4gKCkgPT4gbnVsbFxuXG4gICAgYmluZENoYW5uZWwoc29jaykgOjpcbiAgICAgIGNvbnN0IGNoYW5uZWwgPSBiaW5kU29ja2V0Q2hhbm5lbCBAXG4gICAgICAgIHNvY2ssIGh1Yi5fYXBpX2NoYW5uZWwsIGFzVVJMXG5cbiAgICAgIGNoYW5uZWwuc2VuZFJvdXRpbmdIYW5kc2hha2UoKVxuICAgICAgcmV0dXJuIGNoYW5uZWxcblxuICAgIHVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpIDo6XG4gICAgICBpZiAxID09PSBhcmdzLmxlbmd0aCA6OlxuICAgICAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGFyZ3NbMF0uaHJlZiA6OlxuICAgICAgICAgIGNvbnN0IHtob3N0bmFtZTpob3N0LCBwb3J0fSA9IGFyZ3NbMF1cbiAgICAgICAgICBhcmdzWzBdID0gQHt9IGhvc3QsIHBvcnRcbiAgICAgIHJldHVybiBhcmdzXG5cblxubmV0X2NvbW1vbi5iaW5kU29ja2V0Q2hhbm5lbCA9IGJpbmRTb2NrZXRDaGFubmVsXG5mdW5jdGlvbiBiaW5kU29ja2V0Q2hhbm5lbChzb2NrLCBhcGlfY2hhbm5lbCwgYXNVUkwpIDo6XG4gIHNvY2suc2V0Tm9EZWxheSh0cnVlKVxuXG4gIGNvbnN0IGNvbm5faW5mbyA9ICgpID0+IEA6XG4gICAgaXBfcmVtb3RlOiBAe30gYXNVUkwsIGFkZHJlc3M6IHNvY2sucmVtb3RlQWRkcmVzcywgcG9ydDogc29jay5yZW1vdGVQb3J0XG4gICAgaXBfbG9jYWw6IEB7fSBhc1VSTCwgYWRkcmVzczogc29jay5sb2NhbEFkZHJlc3MsIHBvcnQ6IHNvY2subG9jYWxQb3J0XG5cbiAgcmV0dXJuIGJpbmRTdHJlYW1DaGFubmVsIEAgc29jaywgYXBpX2NoYW5uZWxcbiAgICBAOiBjb25uX2luZm86IEA6IHZhbHVlOiBjb25uX2luZm9cblxuIiwiaW1wb3J0IHsgY3JlYXRlU2VydmVyIGFzIF90bHNfY3JlYXRlU2VydmVyLCBjb25uZWN0IGFzIF90bHNfY29ubmVjdCB9IGZyb20gJ3RscydcbmltcG9ydCBuZXRfY29tbW9uIGZyb20gJy4vX25ldF9jb21tb24uanN5J1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB0bHNfcGx1Z2luKHBsdWdpbl9vcHRpb25zPXt9KSA6OlxuICBmdW5jdGlvbiBhc190bHNfdXJsKCkgOjogcmV0dXJuIGB0bHM6Ly8ke3RoaXMuYWRkcmVzc306JHt0aGlzLnBvcnR9YFxuXG4gIHJldHVybiBmdW5jdGlvbihodWIpIDo6XG4gICAgY29uc3QgX2NvbW1vbl8gPSBuZXRfY29tbW9uKGh1YiwgYXNfdGxzX3VybClcblxuICAgIGh1Yi5yZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCBAICd0bHM6JywgY29ubmVjdFxuICAgIHJldHVybiBodWIudGxzID0gQDogY29ubmVjdCwgY3JlYXRlU2VydmVyXG5cblxuICAgIGZ1bmN0aW9uIGNvbm5lY3QoLi4uYXJncykgOjpcbiAgICAgIGFyZ3MgPSBfY29tbW9uXy51bnBhY2tDb25uZWN0QXJncyhhcmdzKVxuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlIEAgKHJlc29sdmUsIHJlamVjdCkgPT4gOjpcbiAgICAgICAgX3Rsc19jb25uZWN0IEAgLi4uYXJncywgZnVuY3Rpb24gKCkgOjpcbiAgICAgICAgICBjb25zdCBzb2NrID0gdGhpcy51bnJlZigpLnNldEtlZXBBbGl2ZSh0cnVlKVxuICAgICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICAgIHJlc29sdmUoY2hhbm5lbClcbiAgICAgICAgLm9uIEAgJ2Vycm9yJywgcmVqZWN0XG5cbiAgICBmdW5jdGlvbiBjcmVhdGVTZXJ2ZXIob3B0aW9ucywgb25QZWVyKSA6OlxuICAgICAgY29uc3Qgc3ZyID0gX3Rsc19jcmVhdGVTZXJ2ZXIgQCBvcHRpb25zLCBzb2NrID0+IDo6XG4gICAgICAgIHNvY2sgPSBzb2NrLnVucmVmKCkuc2V0S2VlcEFsaXZlKGZhbHNlKVxuICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgb25fcGVlcihjaGFubmVsKVxuICAgICAgY29uc3Qgb25fcGVlciA9IF9jb21tb25fLmJpbmRPblBlZXIoc3ZyLCBvblBlZXIpXG4gICAgICByZXR1cm4gc3ZyXG4iXSwibmFtZXMiOlsiYmluZFN0cmVhbUNoYW5uZWwiLCJzdHJlYW0iLCJhcGlfY2hhbm5lbCIsInByb3BzIiwiY2hhbm5lbCIsImJpbmRDaGFubmVsIiwic2VuZFBrdFJhdyIsInBrdCIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiX3Jhd18iLCJmcm9tIiwiYnl0ZUxlbmd0aCIsIlR5cGVFcnJvciIsImVuZCIsIndyaXRlIiwiY29ubmVjdFBhY2tldFN0cmVhbSIsImVuZFN0cmVhbU9uU2h1dGRvd24iLCJzaHV0ZG93biIsIlByb21pc2UiLCJsaWZlY3ljbGUiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsInZhbHVlIiwicmVzb2x2ZSIsInJlamVjdCIsInBrdERpc3BhdGNoIiwiYmluZERpc3BhdGNoUGFja2V0cyIsIm9uIiwiZGF0YSIsImVyciIsInVuZGVmaW5lZCIsIm5ldF9jb21tb24iLCJodWIiLCJhc1VSTCIsInN2ciIsImNvbm5faW5mbyIsImFkZHJlc3MiLCJwb3J0IiwiaXBfc2VydmVyIiwib25QZWVyIiwiZW1pdCIsInNvY2siLCJiaW5kU29ja2V0Q2hhbm5lbCIsIl9hcGlfY2hhbm5lbCIsInNlbmRSb3V0aW5nSGFuZHNoYWtlIiwiYXJncyIsImxlbmd0aCIsImhyZWYiLCJob3N0bmFtZSIsImhvc3QiLCJzZXROb0RlbGF5IiwicmVtb3RlQWRkcmVzcyIsInJlbW90ZVBvcnQiLCJsb2NhbEFkZHJlc3MiLCJsb2NhbFBvcnQiLCJ0bHNfcGx1Z2luIiwicGx1Z2luX29wdGlvbnMiLCJhc190bHNfdXJsIiwiX2NvbW1vbl8iLCJyZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCIsImNvbm5lY3QiLCJ0bHMiLCJjcmVhdGVTZXJ2ZXIiLCJ1bnBhY2tDb25uZWN0QXJncyIsInVucmVmIiwic2V0S2VlcEFsaXZlIiwib3B0aW9ucyIsIl90bHNfY3JlYXRlU2VydmVyIiwib25fcGVlciIsImJpbmRPblBlZXIiXSwibWFwcGluZ3MiOiI7O0FBQU8sU0FBU0EsaUJBQVQsQ0FBMkJDLE1BQTNCLEVBQW1DQyxXQUFuQyxFQUFnREMsS0FBaEQsRUFBdUQ7UUFDdERDLFVBQVVGLFlBQVlHLFdBQVosQ0FBMEJDLFVBQTFCLEVBQXNDSCxLQUF0QyxDQUFoQjtzQkFDc0JGLE1BQXRCLEVBQThCRyxPQUE5QixFQUF1QyxJQUF2QztTQUNPQSxPQUFQOztXQUVTRSxVQUFULENBQW9CQyxHQUFwQixFQUF5QjtRQUNwQixDQUFFQyxPQUFPQyxRQUFQLENBQWtCRixHQUFsQixDQUFMLEVBQTZCO1VBQ3hCQSxJQUFJRyxLQUFQLEVBQWU7Y0FDUEYsT0FBT0csSUFBUCxDQUFjSixJQUFJRyxLQUFsQixDQUFOO09BREYsTUFFSyxJQUFHSCxJQUFJSyxVQUFQLEVBQW9CO2NBQ2pCSixPQUFPRyxJQUFQLENBQWNKLEdBQWQsQ0FBTjtPQURHLE1BRUE7Y0FDRyxJQUFJTSxTQUFKLENBQWlCLDBFQUFqQixDQUFOOzs7O1FBRUQsU0FBU04sR0FBWixFQUFrQjthQUNULEtBQUtOLE9BQU9hLEdBQVAsRUFBWjs7V0FDSyxLQUFLYixPQUFPYyxLQUFQLENBQWFSLEdBQWIsQ0FBWjs7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
