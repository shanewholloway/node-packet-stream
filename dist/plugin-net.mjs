import { PassThrough } from 'stream';
import { connect, createServer } from 'tls';
import { createConnection, createServer as createServer$1 } from 'net';

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

function stream_plugin(plugin_options = {}) {
  return function (hub) {
    return hub.direct = Object.assign(connect$$1, {
      connect: connect$$1, connectDirect, createDirectChannel });

    function connect$$1(peer) {
      return connectDirect(peer)[0];
    }

    function connectDirect(peer) {
      if (peer.direct && 'function' === typeof peer.direct.createDirectChannel) {
        peer = peer.direct;
      }

      const streams = [new PassThrough(), new PassThrough()];
      return [createDirectChannel(streams[0], streams[1]), peer.createDirectChannel(streams[1], streams[0])];
    }

    function createDirectChannel(rstream, wstream) {
      const channel = bindStreamChannel$1(rstream, wstream, hub._api_channel);

      channel.sendRoutingHandshake();
      return channel;
    }
  };
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
      return _common_.init_server(svr);
    }
  };
}

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

export { stream_plugin as direct, tls_plugin as tls, tcp_plugin as tcp, bindStreamChannel$1 as bindStreamChannel, connectPacketStream };
export default tcp_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLW5ldC5tanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvcGx1Z2lucy9uZXQvX3N0cmVhbV9jb21tb24uanN5IiwiLi4vY29kZS9wbHVnaW5zL25ldC9fbmV0X2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L2RpcmVjdC5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L3Rscy5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L3RjcC5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGRlZmF1bHQgYmluZFN0cmVhbUNoYW5uZWxcbmV4cG9ydCBmdW5jdGlvbiBiaW5kU3RyZWFtQ2hhbm5lbChyc3RyZWFtLCB3c3RyZWFtLCBhcGlfY2hhbm5lbCwgcHJvcHMpIDo6XG4gIGNvbnN0IGNoYW5uZWwgPSBhcGlfY2hhbm5lbC5iaW5kQ2hhbm5lbCBAIHNlbmRQa3RSYXcsIHByb3BzXG4gIGNvbm5lY3RQYWNrZXRTdHJlYW0gQCByc3RyZWFtLCBjaGFubmVsLCB0cnVlXG4gIHJldHVybiBjaGFubmVsXG5cbiAgZnVuY3Rpb24gc2VuZFBrdFJhdyhwa3QpIDo6XG4gICAgaWYgISBCdWZmZXIuaXNCdWZmZXIgQCBwa3QgOjpcbiAgICAgIGlmIHBrdC5fcmF3XyA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdC5fcmF3X1xuICAgICAgZWxzZSBpZiBwa3QuYnl0ZUxlbmd0aCA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdFxuICAgICAgZWxzZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYHNlbmRQa3RSYXcgZXhwZWN0ZWQgJ3BrdCcgYXMgYSBCdWZmZXIgb3IgYW4gb2JqZWN0IHdpdGggYSAnX3Jhd18nIEJ1ZmZlcmBcblxuICAgIGlmIG51bGwgPT09IHBrdCA6OlxuICAgICAgcmV0dXJuIHZvaWQgd3N0cmVhbS5lbmQoKVxuICAgIHJldHVybiB2b2lkIHdzdHJlYW0ud3JpdGUocGt0KVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBjb25uZWN0UGFja2V0U3RyZWFtKHJzdHJlYW0sIGNoYW5uZWwsIGVuZFN0cmVhbU9uU2h1dGRvd24pIDo6XG4gIGNvbnN0IHNodXRkb3duID0gbmV3IFByb21pc2UgQCBsaWZlY3ljbGVcbiAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIGNoYW5uZWwsICdzaHV0ZG93bicsIEA6IHZhbHVlOiBzaHV0ZG93blxuICBcbiAgZnVuY3Rpb24gbGlmZWN5Y2xlKHJlc29sdmUsIHJlamVjdCkgOjpcbiAgICBsZXQgcGt0RGlzcGF0Y2ggPSBjaGFubmVsLmJpbmREaXNwYXRjaFBhY2tldHMoKVxuXG4gICAgcnN0cmVhbS5vbiBAICdlcnJvcicsIHNodXRkb3duXG4gICAgcnN0cmVhbS5vbiBAICdjbG9zZScsIHNodXRkb3duXG4gICAgcnN0cmVhbS5vbiBAICdkYXRhJywgZnVuY3Rpb24gKGRhdGEpIDo6XG4gICAgICB0cnkgOjogcGt0RGlzcGF0Y2goZGF0YSlcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICByZXR1cm4gc2h1dGRvd24oZXJyKVxuXG4gICAgZnVuY3Rpb24gc2h1dGRvd24oZXJyKSA6OlxuICAgICAgaWYgdW5kZWZpbmVkID09PSBwa3REaXNwYXRjaCA6OiByZXR1cm5cbiAgICAgIHBrdERpc3BhdGNoID0gdW5kZWZpbmVkXG4gICAgICBpZiBlbmRTdHJlYW1PblNodXRkb3duIDo6XG4gICAgICAgIHJzdHJlYW0uZW5kKClcblxuICAgICAgZXJyID8gcmVqZWN0KGVycikgOiByZXNvbHZlKClcblxuIiwiaW1wb3J0IGJpbmRTdHJlYW1DaGFubmVsIGZyb20gJy4vX3N0cmVhbV9jb21tb24uanN5J1xuXG5uZXRfY29tbW9uLm5ldF9jb21tb24gPSBuZXRfY29tbW9uXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBuZXRfY29tbW9uKGh1YiwgYXNVUkwpIDo6XG4gIC8vIHNoYXJlZCBpbXBsZW1lbnRhdGlvbiBiZXR3ZWVuIG5ldC90Y3AgYW5kIHRscyBpbXBsZW1lbnRhdGlvbnNcbiAgcmV0dXJuIEA6XG4gICAgaW5pdF9zZXJ2ZXIoc3ZyKSA6OlxuICAgICAgc3ZyLmNvbm5faW5mbyA9IGZ1bmN0aW9uICgpIDo6XG4gICAgICAgIGNvbnN0IHthZGRyZXNzLCBwb3J0fSA9IHN2ci5hZGRyZXNzKClcbiAgICAgICAgcmV0dXJuIEB7fSBpcF9zZXJ2ZXI6IEB7fSBhZGRyZXNzLCBwb3J0LCBhc1VSTFxuICAgICAgcmV0dXJuIHN2clxuXG4gICAgYmluZE9uUGVlcihzdnIsIG9uUGVlcikgOjpcbiAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBvblBlZXIgOjpcbiAgICAgICAgcmV0dXJuIG9uUGVlclxuICAgICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBvblBlZXIgOjpcbiAgICAgICAgcmV0dXJuIGNoYW5uZWwgPT4gc3ZyLmVtaXQgQCBvblBlZXIsIGNoYW5uZWxcbiAgICAgIHJldHVybiAoKSA9PiBudWxsXG5cbiAgICBiaW5kQ2hhbm5lbChzb2NrKSA6OlxuICAgICAgY29uc3QgY2hhbm5lbCA9IGJpbmRTb2NrZXRDaGFubmVsIEBcbiAgICAgICAgc29jaywgaHViLl9hcGlfY2hhbm5lbCwgYXNVUkxcblxuICAgICAgY2hhbm5lbC5zZW5kUm91dGluZ0hhbmRzaGFrZSgpXG4gICAgICByZXR1cm4gY2hhbm5lbFxuXG4gICAgdW5wYWNrQ29ubmVjdEFyZ3MoYXJncykgOjpcbiAgICAgIGlmIDEgPT09IGFyZ3MubGVuZ3RoIDo6XG4gICAgICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgYXJnc1swXS5ocmVmIDo6XG4gICAgICAgICAgY29uc3Qge2hvc3RuYW1lOmhvc3QsIHBvcnR9ID0gYXJnc1swXVxuICAgICAgICAgIGFyZ3NbMF0gPSBAe30gaG9zdCwgcG9ydFxuICAgICAgcmV0dXJuIGFyZ3NcblxuXG5uZXRfY29tbW9uLmJpbmRTb2NrZXRDaGFubmVsID0gYmluZFNvY2tldENoYW5uZWxcbmZ1bmN0aW9uIGJpbmRTb2NrZXRDaGFubmVsKHNvY2ssIGFwaV9jaGFubmVsLCBhc1VSTCkgOjpcbiAgc29jay5zZXROb0RlbGF5KHRydWUpXG5cbiAgY29uc3QgY29ubl9pbmZvID0gKCkgPT4gQDpcbiAgICBpcF9yZW1vdGU6IEB7fSBhc1VSTCwgYWRkcmVzczogc29jay5yZW1vdGVBZGRyZXNzLCBwb3J0OiBzb2NrLnJlbW90ZVBvcnRcbiAgICBpcF9sb2NhbDogQHt9IGFzVVJMLCBhZGRyZXNzOiBzb2NrLmxvY2FsQWRkcmVzcywgcG9ydDogc29jay5sb2NhbFBvcnRcblxuICByZXR1cm4gYmluZFN0cmVhbUNoYW5uZWwgQCBzb2NrLCBzb2NrLCBhcGlfY2hhbm5lbFxuICAgIEA6IGNvbm5faW5mbzogQDogdmFsdWU6IGNvbm5faW5mb1xuXG4iLCJpbXBvcnQge1Bhc3NUaHJvdWdofSBmcm9tICdzdHJlYW0nXG5pbXBvcnQgYmluZFN0cmVhbUNoYW5uZWwgZnJvbSAnLi9fc3RyZWFtX2NvbW1vbi5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHN0cmVhbV9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBmdW5jdGlvbihodWIpIDo6XG4gICAgcmV0dXJuIGh1Yi5kaXJlY3QgPSBPYmplY3QuYXNzaWduIEAgY29ubmVjdCwgQHt9XG4gICAgICBjb25uZWN0LCBjb25uZWN0RGlyZWN0LCBjcmVhdGVEaXJlY3RDaGFubmVsXG5cbiAgICBmdW5jdGlvbiBjb25uZWN0KHBlZXIpIDo6XG4gICAgICByZXR1cm4gY29ubmVjdERpcmVjdChwZWVyKVswXVxuXG4gICAgZnVuY3Rpb24gY29ubmVjdERpcmVjdChwZWVyKSA6OlxuICAgICAgaWYgcGVlci5kaXJlY3QgJiYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIHBlZXIuZGlyZWN0LmNyZWF0ZURpcmVjdENoYW5uZWwgOjpcbiAgICAgICAgcGVlciA9IHBlZXIuZGlyZWN0XG5cbiAgICAgIGNvbnN0IHN0cmVhbXMgPSBAW10gbmV3IFBhc3NUaHJvdWdoKCksIG5ldyBQYXNzVGhyb3VnaCgpXG4gICAgICByZXR1cm4gQFtdXG4gICAgICAgIGNyZWF0ZURpcmVjdENoYW5uZWwgQCBzdHJlYW1zWzBdLCBzdHJlYW1zWzFdXG4gICAgICAgIHBlZXIuY3JlYXRlRGlyZWN0Q2hhbm5lbCBAIHN0cmVhbXNbMV0sIHN0cmVhbXNbMF1cblxuICAgIGZ1bmN0aW9uIGNyZWF0ZURpcmVjdENoYW5uZWwocnN0cmVhbSwgd3N0cmVhbSkgOjpcbiAgICAgIGNvbnN0IGNoYW5uZWwgPSBiaW5kU3RyZWFtQ2hhbm5lbCBAXG4gICAgICAgIHJzdHJlYW0sIHdzdHJlYW0sIGh1Yi5fYXBpX2NoYW5uZWxcblxuICAgICAgY2hhbm5lbC5zZW5kUm91dGluZ0hhbmRzaGFrZSgpXG4gICAgICByZXR1cm4gY2hhbm5lbFxuIiwiaW1wb3J0IHsgY3JlYXRlU2VydmVyIGFzIF90bHNfY3JlYXRlU2VydmVyLCBjb25uZWN0IGFzIF90bHNfY29ubmVjdCB9IGZyb20gJ3RscydcbmltcG9ydCBuZXRfY29tbW9uIGZyb20gJy4vX25ldF9jb21tb24uanN5J1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB0bHNfcGx1Z2luKHBsdWdpbl9vcHRpb25zPXt9KSA6OlxuICBmdW5jdGlvbiBhc190bHNfdXJsKCkgOjogcmV0dXJuIGB0bHM6Ly8ke3RoaXMuYWRkcmVzc306JHt0aGlzLnBvcnR9YFxuXG4gIHJldHVybiBmdW5jdGlvbihodWIpIDo6XG4gICAgY29uc3QgX2NvbW1vbl8gPSBuZXRfY29tbW9uKGh1YiwgYXNfdGxzX3VybClcblxuICAgIGh1Yi5yZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCBAICd0bHM6JywgY29ubmVjdFxuICAgIHJldHVybiBodWIudGxzID0gQDogY29ubmVjdCwgY3JlYXRlU2VydmVyXG5cblxuICAgIGZ1bmN0aW9uIGNvbm5lY3QoLi4uYXJncykgOjpcbiAgICAgIGFyZ3MgPSBfY29tbW9uXy51bnBhY2tDb25uZWN0QXJncyhhcmdzKVxuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlIEAgKHJlc29sdmUsIHJlamVjdCkgPT4gOjpcbiAgICAgICAgX3Rsc19jb25uZWN0IEAgLi4uYXJncywgZnVuY3Rpb24gKCkgOjpcbiAgICAgICAgICBjb25zdCBzb2NrID0gdGhpcy51bnJlZigpLnNldEtlZXBBbGl2ZSh0cnVlKVxuICAgICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICAgIHJlc29sdmUoY2hhbm5lbClcbiAgICAgICAgLm9uIEAgJ2Vycm9yJywgcmVqZWN0XG5cbiAgICBmdW5jdGlvbiBjcmVhdGVTZXJ2ZXIob3B0aW9ucywgb25QZWVyKSA6OlxuICAgICAgY29uc3Qgc3ZyID0gX3Rsc19jcmVhdGVTZXJ2ZXIgQCBvcHRpb25zLCBzb2NrID0+IDo6XG4gICAgICAgIHNvY2sgPSBzb2NrLnVucmVmKCkuc2V0S2VlcEFsaXZlKGZhbHNlKVxuICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgb25fcGVlcihjaGFubmVsKVxuICAgICAgY29uc3Qgb25fcGVlciA9IF9jb21tb25fLmJpbmRPblBlZXIoc3ZyLCBvblBlZXIpXG4gICAgICByZXR1cm4gX2NvbW1vbl8uaW5pdF9zZXJ2ZXIoc3ZyKVxuXG4iLCJpbXBvcnQgeyBjcmVhdGVTZXJ2ZXIgYXMgX3RjcF9jcmVhdGVTZXJ2ZXIsIGNyZWF0ZUNvbm5lY3Rpb24gYXMgX3RjcF9jcmVhdGVDb25uZWN0aW9uIH0gZnJvbSAnbmV0J1xuaW1wb3J0IG5ldF9jb21tb24gZnJvbSAnLi9fbmV0X2NvbW1vbi5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRjcF9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGZ1bmN0aW9uIGFzX3RjcF91cmwoKSA6OiByZXR1cm4gYHRjcDovLyR7dGhpcy5hZGRyZXNzfToke3RoaXMucG9ydH1gXG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGh1YikgOjpcbiAgICBjb25zdCBfY29tbW9uXyA9IG5ldF9jb21tb24oaHViLCBhc190Y3BfdXJsKVxuXG4gICAgaHViLnJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sIEAgJ3RjcDonLCBjb25uZWN0XG4gICAgcmV0dXJuIGh1Yi50Y3AgPSBAOiBjb25uZWN0LCBjcmVhdGVTZXJ2ZXJcblxuXG4gICAgZnVuY3Rpb24gY29ubmVjdCguLi5hcmdzKSA6OlxuICAgICAgYXJncyA9IF9jb21tb25fLnVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UgQCAocmVzb2x2ZSwgcmVqZWN0KSA9PiA6OlxuICAgICAgICBfdGNwX2NyZWF0ZUNvbm5lY3Rpb24gQCAuLi5hcmdzLCBmdW5jdGlvbigpIDo6XG4gICAgICAgICAgY29uc3Qgc29jayA9IHRoaXMudW5yZWYoKS5zZXRLZWVwQWxpdmUodHJ1ZSlcbiAgICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgICByZXNvbHZlKGNoYW5uZWwpXG4gICAgICAgIC5vbiBAICdlcnJvcicsIHJlamVjdFxuXG4gICAgZnVuY3Rpb24gY3JlYXRlU2VydmVyKG9uUGVlcikgOjpcbiAgICAgIGNvbnN0IHN2ciA9IF90Y3BfY3JlYXRlU2VydmVyIEAgZnVuY3Rpb24gKHNvY2spIDo6XG4gICAgICAgIHNvY2sgPSBzb2NrLnVucmVmKCkuc2V0S2VlcEFsaXZlKGZhbHNlKVxuICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgb25fcGVlcihjaGFubmVsKVxuICAgICAgY29uc3Qgb25fcGVlciA9IF9jb21tb25fLmJpbmRPblBlZXIoc3ZyLCBvblBlZXIpXG4gICAgICByZXR1cm4gX2NvbW1vbl8uaW5pdF9zZXJ2ZXIoc3ZyKVxuXG4iXSwibmFtZXMiOlsiYmluZFN0cmVhbUNoYW5uZWwiLCJyc3RyZWFtIiwid3N0cmVhbSIsImFwaV9jaGFubmVsIiwicHJvcHMiLCJjaGFubmVsIiwiYmluZENoYW5uZWwiLCJzZW5kUGt0UmF3IiwicGt0IiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJfcmF3XyIsImZyb20iLCJieXRlTGVuZ3RoIiwiVHlwZUVycm9yIiwiZW5kIiwid3JpdGUiLCJjb25uZWN0UGFja2V0U3RyZWFtIiwiZW5kU3RyZWFtT25TaHV0ZG93biIsInNodXRkb3duIiwiUHJvbWlzZSIsImxpZmVjeWNsZSIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwidmFsdWUiLCJyZXNvbHZlIiwicmVqZWN0IiwicGt0RGlzcGF0Y2giLCJiaW5kRGlzcGF0Y2hQYWNrZXRzIiwib24iLCJkYXRhIiwiZXJyIiwidW5kZWZpbmVkIiwibmV0X2NvbW1vbiIsImh1YiIsImFzVVJMIiwic3ZyIiwiY29ubl9pbmZvIiwiYWRkcmVzcyIsInBvcnQiLCJpcF9zZXJ2ZXIiLCJvblBlZXIiLCJlbWl0Iiwic29jayIsImJpbmRTb2NrZXRDaGFubmVsIiwiX2FwaV9jaGFubmVsIiwic2VuZFJvdXRpbmdIYW5kc2hha2UiLCJhcmdzIiwibGVuZ3RoIiwiaHJlZiIsImhvc3RuYW1lIiwiaG9zdCIsInNldE5vRGVsYXkiLCJyZW1vdGVBZGRyZXNzIiwicmVtb3RlUG9ydCIsImxvY2FsQWRkcmVzcyIsImxvY2FsUG9ydCIsInN0cmVhbV9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsImRpcmVjdCIsImFzc2lnbiIsImNvbm5lY3QiLCJjb25uZWN0RGlyZWN0IiwiY3JlYXRlRGlyZWN0Q2hhbm5lbCIsInBlZXIiLCJzdHJlYW1zIiwiUGFzc1Rocm91Z2giLCJ0bHNfcGx1Z2luIiwiYXNfdGxzX3VybCIsIl9jb21tb25fIiwicmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wiLCJ0bHMiLCJjcmVhdGVTZXJ2ZXIiLCJ1bnBhY2tDb25uZWN0QXJncyIsInVucmVmIiwic2V0S2VlcEFsaXZlIiwib3B0aW9ucyIsIl90bHNfY3JlYXRlU2VydmVyIiwib25fcGVlciIsImJpbmRPblBlZXIiLCJpbml0X3NlcnZlciIs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
