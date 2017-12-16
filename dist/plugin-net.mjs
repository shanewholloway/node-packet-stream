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

    const tls_plugin = { connect: connect$$1, createServer: createServer$$1,
      url_options: plugin_options.url_options || {},
      on_url_connect: plugin_options.on_url_connect || (options => options) };

    hub.registerConnectionProtocol('tls:', connect_url);
    return hub.tls = tls_plugin;

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

    function createServer$$1(tls_options, onPeer) {
      const svr = createServer(tls_options, sock => {
        sock = sock.unref().setKeepAlive(false);
        const channel = _common_.bindChannel(sock);
        on_peer(channel);
      });
      const on_peer = _common_.bindOnPeer(svr, onPeer);
      return _common_.init_server(svr);
    }

    function connect_url(url) {
      const { hostname: host, port } = url;
      let options = Object.assign({ host, port }, tls_plugin.url_options);
      options = tls_plugin.on_url_connect(options, url) || options;
      return connect$$1(options);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLW5ldC5tanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvcGx1Z2lucy9uZXQvX3N0cmVhbV9jb21tb24uanN5IiwiLi4vY29kZS9wbHVnaW5zL25ldC9fbmV0X2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L2RpcmVjdC5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L3Rscy5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L3RjcC5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGRlZmF1bHQgYmluZFN0cmVhbUNoYW5uZWxcbmV4cG9ydCBmdW5jdGlvbiBiaW5kU3RyZWFtQ2hhbm5lbChyc3RyZWFtLCB3c3RyZWFtLCBhcGlfY2hhbm5lbCwgcHJvcHMpIDo6XG4gIGNvbnN0IGNoYW5uZWwgPSBhcGlfY2hhbm5lbC5iaW5kQ2hhbm5lbCBAIHNlbmRQa3RSYXcsIHByb3BzXG4gIGNvbm5lY3RQYWNrZXRTdHJlYW0gQCByc3RyZWFtLCBjaGFubmVsLCB0cnVlXG4gIHJldHVybiBjaGFubmVsXG5cbiAgZnVuY3Rpb24gc2VuZFBrdFJhdyhwa3QpIDo6XG4gICAgaWYgISBCdWZmZXIuaXNCdWZmZXIgQCBwa3QgOjpcbiAgICAgIGlmIHBrdC5fcmF3XyA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdC5fcmF3X1xuICAgICAgZWxzZSBpZiBwa3QuYnl0ZUxlbmd0aCA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdFxuICAgICAgZWxzZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYHNlbmRQa3RSYXcgZXhwZWN0ZWQgJ3BrdCcgYXMgYSBCdWZmZXIgb3IgYW4gb2JqZWN0IHdpdGggYSAnX3Jhd18nIEJ1ZmZlcmBcblxuICAgIGlmIG51bGwgPT09IHBrdCA6OlxuICAgICAgcmV0dXJuIHZvaWQgd3N0cmVhbS5lbmQoKVxuICAgIHJldHVybiB2b2lkIHdzdHJlYW0ud3JpdGUocGt0KVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBjb25uZWN0UGFja2V0U3RyZWFtKHJzdHJlYW0sIGNoYW5uZWwsIGVuZFN0cmVhbU9uU2h1dGRvd24pIDo6XG4gIGNvbnN0IHNodXRkb3duID0gbmV3IFByb21pc2UgQCBsaWZlY3ljbGVcbiAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIGNoYW5uZWwsICdzaHV0ZG93bicsIEA6IHZhbHVlOiBzaHV0ZG93blxuICBcbiAgZnVuY3Rpb24gbGlmZWN5Y2xlKHJlc29sdmUsIHJlamVjdCkgOjpcbiAgICBsZXQgcGt0RGlzcGF0Y2ggPSBjaGFubmVsLmJpbmREaXNwYXRjaFBhY2tldHMoKVxuXG4gICAgcnN0cmVhbS5vbiBAICdlcnJvcicsIHNodXRkb3duXG4gICAgcnN0cmVhbS5vbiBAICdjbG9zZScsIHNodXRkb3duXG4gICAgcnN0cmVhbS5vbiBAICdkYXRhJywgZnVuY3Rpb24gKGRhdGEpIDo6XG4gICAgICB0cnkgOjogcGt0RGlzcGF0Y2goZGF0YSlcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICByZXR1cm4gc2h1dGRvd24oZXJyKVxuXG4gICAgZnVuY3Rpb24gc2h1dGRvd24oZXJyKSA6OlxuICAgICAgaWYgdW5kZWZpbmVkID09PSBwa3REaXNwYXRjaCA6OiByZXR1cm5cbiAgICAgIHBrdERpc3BhdGNoID0gdW5kZWZpbmVkXG4gICAgICBpZiBlbmRTdHJlYW1PblNodXRkb3duIDo6XG4gICAgICAgIHJzdHJlYW0uZW5kKClcblxuICAgICAgZXJyID8gcmVqZWN0KGVycikgOiByZXNvbHZlKClcblxuIiwiaW1wb3J0IGJpbmRTdHJlYW1DaGFubmVsIGZyb20gJy4vX3N0cmVhbV9jb21tb24uanN5J1xuXG5uZXRfY29tbW9uLm5ldF9jb21tb24gPSBuZXRfY29tbW9uXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBuZXRfY29tbW9uKGh1YiwgYXNVUkwpIDo6XG4gIC8vIHNoYXJlZCBpbXBsZW1lbnRhdGlvbiBiZXR3ZWVuIG5ldC90Y3AgYW5kIHRscyBpbXBsZW1lbnRhdGlvbnNcbiAgcmV0dXJuIEA6XG4gICAgaW5pdF9zZXJ2ZXIoc3ZyKSA6OlxuICAgICAgc3ZyLmNvbm5faW5mbyA9IGZ1bmN0aW9uICgpIDo6XG4gICAgICAgIGNvbnN0IHthZGRyZXNzLCBwb3J0fSA9IHN2ci5hZGRyZXNzKClcbiAgICAgICAgcmV0dXJuIEB7fSBpcF9zZXJ2ZXI6IEB7fSBhZGRyZXNzLCBwb3J0LCBhc1VSTFxuICAgICAgcmV0dXJuIHN2clxuXG4gICAgYmluZE9uUGVlcihzdnIsIG9uUGVlcikgOjpcbiAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBvblBlZXIgOjpcbiAgICAgICAgcmV0dXJuIG9uUGVlclxuICAgICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBvblBlZXIgOjpcbiAgICAgICAgcmV0dXJuIGNoYW5uZWwgPT4gc3ZyLmVtaXQgQCBvblBlZXIsIGNoYW5uZWxcbiAgICAgIHJldHVybiAoKSA9PiBudWxsXG5cbiAgICBiaW5kQ2hhbm5lbChzb2NrKSA6OlxuICAgICAgY29uc3QgY2hhbm5lbCA9IGJpbmRTb2NrZXRDaGFubmVsIEBcbiAgICAgICAgc29jaywgaHViLl9hcGlfY2hhbm5lbCwgYXNVUkxcblxuICAgICAgY2hhbm5lbC5zZW5kUm91dGluZ0hhbmRzaGFrZSgpXG4gICAgICByZXR1cm4gY2hhbm5lbFxuXG4gICAgdW5wYWNrQ29ubmVjdEFyZ3MoYXJncykgOjpcbiAgICAgIGlmIDEgPT09IGFyZ3MubGVuZ3RoIDo6XG4gICAgICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgYXJnc1swXS5ocmVmIDo6XG4gICAgICAgICAgY29uc3Qge2hvc3RuYW1lOmhvc3QsIHBvcnR9ID0gYXJnc1swXVxuICAgICAgICAgIGFyZ3NbMF0gPSBAe30gaG9zdCwgcG9ydFxuICAgICAgcmV0dXJuIGFyZ3NcblxuXG5uZXRfY29tbW9uLmJpbmRTb2NrZXRDaGFubmVsID0gYmluZFNvY2tldENoYW5uZWxcbmZ1bmN0aW9uIGJpbmRTb2NrZXRDaGFubmVsKHNvY2ssIGFwaV9jaGFubmVsLCBhc1VSTCkgOjpcbiAgc29jay5zZXROb0RlbGF5KHRydWUpXG5cbiAgY29uc3QgY29ubl9pbmZvID0gKCkgPT4gQDpcbiAgICBpcF9yZW1vdGU6IEB7fSBhc1VSTCwgYWRkcmVzczogc29jay5yZW1vdGVBZGRyZXNzLCBwb3J0OiBzb2NrLnJlbW90ZVBvcnRcbiAgICBpcF9sb2NhbDogQHt9IGFzVVJMLCBhZGRyZXNzOiBzb2NrLmxvY2FsQWRkcmVzcywgcG9ydDogc29jay5sb2NhbFBvcnRcblxuICByZXR1cm4gYmluZFN0cmVhbUNoYW5uZWwgQCBzb2NrLCBzb2NrLCBhcGlfY2hhbm5lbFxuICAgIEA6IGNvbm5faW5mbzogQDogdmFsdWU6IGNvbm5faW5mb1xuXG4iLCJpbXBvcnQge1Bhc3NUaHJvdWdofSBmcm9tICdzdHJlYW0nXG5pbXBvcnQgYmluZFN0cmVhbUNoYW5uZWwgZnJvbSAnLi9fc3RyZWFtX2NvbW1vbi5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHN0cmVhbV9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBmdW5jdGlvbihodWIpIDo6XG4gICAgcmV0dXJuIGh1Yi5kaXJlY3QgPSBPYmplY3QuYXNzaWduIEAgY29ubmVjdCwgQHt9XG4gICAgICBjb25uZWN0LCBjb25uZWN0RGlyZWN0LCBjcmVhdGVEaXJlY3RDaGFubmVsXG5cbiAgICBmdW5jdGlvbiBjb25uZWN0KHBlZXIpIDo6XG4gICAgICByZXR1cm4gY29ubmVjdERpcmVjdChwZWVyKVswXVxuXG4gICAgZnVuY3Rpb24gY29ubmVjdERpcmVjdChwZWVyKSA6OlxuICAgICAgaWYgcGVlci5kaXJlY3QgJiYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIHBlZXIuZGlyZWN0LmNyZWF0ZURpcmVjdENoYW5uZWwgOjpcbiAgICAgICAgcGVlciA9IHBlZXIuZGlyZWN0XG5cbiAgICAgIGNvbnN0IHN0cmVhbXMgPSBAW10gbmV3IFBhc3NUaHJvdWdoKCksIG5ldyBQYXNzVGhyb3VnaCgpXG4gICAgICByZXR1cm4gQFtdXG4gICAgICAgIGNyZWF0ZURpcmVjdENoYW5uZWwgQCBzdHJlYW1zWzBdLCBzdHJlYW1zWzFdXG4gICAgICAgIHBlZXIuY3JlYXRlRGlyZWN0Q2hhbm5lbCBAIHN0cmVhbXNbMV0sIHN0cmVhbXNbMF1cblxuICAgIGZ1bmN0aW9uIGNyZWF0ZURpcmVjdENoYW5uZWwocnN0cmVhbSwgd3N0cmVhbSkgOjpcbiAgICAgIGNvbnN0IGNoYW5uZWwgPSBiaW5kU3RyZWFtQ2hhbm5lbCBAXG4gICAgICAgIHJzdHJlYW0sIHdzdHJlYW0sIGh1Yi5fYXBpX2NoYW5uZWxcblxuICAgICAgY2hhbm5lbC5zZW5kUm91dGluZ0hhbmRzaGFrZSgpXG4gICAgICByZXR1cm4gY2hhbm5lbFxuIiwiaW1wb3J0IHsgY3JlYXRlU2VydmVyIGFzIF90bHNfY3JlYXRlU2VydmVyLCBjb25uZWN0IGFzIF90bHNfY29ubmVjdCB9IGZyb20gJ3RscydcbmltcG9ydCBuZXRfY29tbW9uIGZyb20gJy4vX25ldF9jb21tb24uanN5J1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB0bHNfcGx1Z2luKHBsdWdpbl9vcHRpb25zPXt9KSA6OlxuICBmdW5jdGlvbiBhc190bHNfdXJsKCkgOjogcmV0dXJuIGB0bHM6Ly8ke3RoaXMuYWRkcmVzc306JHt0aGlzLnBvcnR9YFxuXG4gIHJldHVybiBmdW5jdGlvbihodWIpIDo6XG4gICAgY29uc3QgX2NvbW1vbl8gPSBuZXRfY29tbW9uKGh1YiwgYXNfdGxzX3VybClcblxuICAgIGNvbnN0IHRsc19wbHVnaW4gPSBAOiBjb25uZWN0LCBjcmVhdGVTZXJ2ZXJcbiAgICAgIHVybF9vcHRpb25zOiBwbHVnaW5fb3B0aW9ucy51cmxfb3B0aW9ucyB8fCB7fVxuICAgICAgb25fdXJsX2Nvbm5lY3Q6IHBsdWdpbl9vcHRpb25zLm9uX3VybF9jb25uZWN0IHx8IEAgb3B0aW9ucyA9PiBvcHRpb25zXG5cbiAgICBodWIucmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wgQCAndGxzOicsIGNvbm5lY3RfdXJsXG4gICAgcmV0dXJuIGh1Yi50bHMgPSB0bHNfcGx1Z2luXG5cblxuICAgIGZ1bmN0aW9uIGNvbm5lY3QoLi4uYXJncykgOjpcbiAgICAgIGFyZ3MgPSBfY29tbW9uXy51bnBhY2tDb25uZWN0QXJncyhhcmdzKVxuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlIEAgKHJlc29sdmUsIHJlamVjdCkgPT4gOjpcbiAgICAgICAgX3Rsc19jb25uZWN0IEAgLi4uYXJncywgZnVuY3Rpb24gKCkgOjpcbiAgICAgICAgICBjb25zdCBzb2NrID0gdGhpcy51bnJlZigpLnNldEtlZXBBbGl2ZSh0cnVlKVxuICAgICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICAgIHJlc29sdmUoY2hhbm5lbClcbiAgICAgICAgLm9uIEAgJ2Vycm9yJywgcmVqZWN0XG5cbiAgICBmdW5jdGlvbiBjcmVhdGVTZXJ2ZXIodGxzX29wdGlvbnMsIG9uUGVlcikgOjpcbiAgICAgIGNvbnN0IHN2ciA9IF90bHNfY3JlYXRlU2VydmVyIEAgdGxzX29wdGlvbnMsIHNvY2sgPT4gOjpcbiAgICAgICAgc29jayA9IHNvY2sudW5yZWYoKS5zZXRLZWVwQWxpdmUoZmFsc2UpXG4gICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICBvbl9wZWVyKGNoYW5uZWwpXG4gICAgICBjb25zdCBvbl9wZWVyID0gX2NvbW1vbl8uYmluZE9uUGVlcihzdnIsIG9uUGVlcilcbiAgICAgIHJldHVybiBfY29tbW9uXy5pbml0X3NlcnZlcihzdnIpXG5cbiAgICBmdW5jdGlvbiBjb25uZWN0X3VybCh1cmwpIDo6XG4gICAgICBjb25zdCB7aG9zdG5hbWU6aG9zdCwgcG9ydH0gPSB1cmxcbiAgICAgIGxldCBvcHRpb25zID0gT2JqZWN0LmFzc2lnbiBAIHtob3N0LCBwb3J0fSwgdGxzX3BsdWdpbi51cmxfb3B0aW9uc1xuICAgICAgb3B0aW9ucyA9IHRsc19wbHVnaW4ub25fdXJsX2Nvbm5lY3Qob3B0aW9ucywgdXJsKSB8fCBvcHRpb25zXG4gICAgICByZXR1cm4gY29ubmVjdChvcHRpb25zKVxuXG4iLCJpbXBvcnQgeyBjcmVhdGVTZXJ2ZXIgYXMgX3RjcF9jcmVhdGVTZXJ2ZXIsIGNyZWF0ZUNvbm5lY3Rpb24gYXMgX3RjcF9jcmVhdGVDb25uZWN0aW9uIH0gZnJvbSAnbmV0J1xuaW1wb3J0IG5ldF9jb21tb24gZnJvbSAnLi9fbmV0X2NvbW1vbi5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRjcF9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGZ1bmN0aW9uIGFzX3RjcF91cmwoKSA6OiByZXR1cm4gYHRjcDovLyR7dGhpcy5hZGRyZXNzfToke3RoaXMucG9ydH1gXG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGh1YikgOjpcbiAgICBjb25zdCBfY29tbW9uXyA9IG5ldF9jb21tb24oaHViLCBhc190Y3BfdXJsKVxuXG4gICAgaHViLnJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sIEAgJ3RjcDonLCBjb25uZWN0XG4gICAgcmV0dXJuIGh1Yi50Y3AgPSBAOiBjb25uZWN0LCBjcmVhdGVTZXJ2ZXJcblxuXG4gICAgZnVuY3Rpb24gY29ubmVjdCguLi5hcmdzKSA6OlxuICAgICAgYXJncyA9IF9jb21tb25fLnVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UgQCAocmVzb2x2ZSwgcmVqZWN0KSA9PiA6OlxuICAgICAgICBfdGNwX2NyZWF0ZUNvbm5lY3Rpb24gQCAuLi5hcmdzLCBmdW5jdGlvbigpIDo6XG4gICAgICAgICAgY29uc3Qgc29jayA9IHRoaXMudW5yZWYoKS5zZXRLZWVwQWxpdmUodHJ1ZSlcbiAgICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgICByZXNvbHZlKGNoYW5uZWwpXG4gICAgICAgIC5vbiBAICdlcnJvcicsIHJlamVjdFxuXG4gICAgZnVuY3Rpb24gY3JlYXRlU2VydmVyKG9uUGVlcikgOjpcbiAgICAgIGNvbnN0IHN2ciA9IF90Y3BfY3JlYXRlU2VydmVyIEAgZnVuY3Rpb24gKHNvY2spIDo6XG4gICAgICAgIHNvY2sgPSBzb2NrLnVucmVmKCkuc2V0S2VlcEFsaXZlKGZhbHNlKVxuICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgb25fcGVlcihjaGFubmVsKVxuICAgICAgY29uc3Qgb25fcGVlciA9IF9jb21tb25fLmJpbmRPblBlZXIoc3ZyLCBvblBlZXIpXG4gICAgICByZXR1cm4gX2NvbW1vbl8uaW5pdF9zZXJ2ZXIoc3ZyKVxuXG4iXSwibmFtZXMiOlsiYmluZFN0cmVhbUNoYW5uZWwiLCJyc3RyZWFtIiwid3N0cmVhbSIsImFwaV9jaGFubmVsIiwicHJvcHMiLCJjaGFubmVsIiwiYmluZENoYW5uZWwiLCJzZW5kUGt0UmF3IiwicGt0IiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJfcmF3XyIsImZyb20iLCJieXRlTGVuZ3RoIiwiVHlwZUVycm9yIiwiZW5kIiwid3JpdGUiLCJjb25uZWN0UGFja2V0U3RyZWFtIiwiZW5kU3RyZWFtT25TaHV0ZG93biIsInNodXRkb3duIiwiUHJvbWlzZSIsImxpZmVjeWNsZSIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwidmFsdWUiLCJyZXNvbHZlIiwicmVqZWN0IiwicGt0RGlzcGF0Y2giLCJiaW5kRGlzcGF0Y2hQYWNrZXRzIiwib24iLCJkYXRhIiwiZXJyIiwidW5kZWZpbmVkIiwibmV0X2NvbW1vbiIsImh1YiIsImFzVVJMIiwic3ZyIiwiY29ubl9pbmZvIiwiYWRkcmVzcyIsInBvcnQiLCJpcF9zZXJ2ZXIiLCJvblBlZXIiLCJlbWl0Iiwic29jayIsImJpbmRTb2NrZXRDaGFubmVsIiwiX2FwaV9jaGFubmVsIiwic2VuZFJvdXRpbmdIYW5kc2hha2UiLCJhcmdzIiwibGVuZ3RoIiwiaHJlZiIsImhvc3RuYW1lIiwiaG9zdCIsInNldE5vRGVsYXkiLCJyZW1vdGVBZGRyZXNzIiwicmVtb3RlUG9ydCIsImxvY2FsQWRkcmVzcyIsImxvY2FsUG9ydCIsInN0cmVhbV9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsImRpcmVjdCIsImFzc2lnbiIsImNvbm5lY3QiLCJjb25uZWN0RGlyZWN0IiwiY3JlYXRlRGlyZWN0Q2hhbm5lbCIsInBlZXIiLCJzdHJlYW1zIiwiUGFzc1Rocm91Z2giLCJ0bHNfcGx1Z2luIiwiYXNfdGxzX3VybCIsIl9jb21tb25fIiwiY3JlYXRlU2VydmVyIiwidXJsX29wdGlvbnMiLCJvbl91cmxfY29ubmVjdCIsIm9wdGlvbnMiLCJyZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCIsImNvbm5lY3RfdXJsIiwidGxzIiwidW5wYWNrQ29ubmVjdEFyZ3MiLCJ1bnJlZiIsInNldEtlZXBBbGl2ZSIsInRsc19vcHRpb25zIiwiX3Rsc19jcmVhdGVTZXJ2ZXIiLCJvbl9wZWVyIiwiYmluZE9uUGVlciIsImluaXRfc2VydmVyIiwidXJsIiwidGNwX3BsdWdpbiIsImFzX3RjcF91cmwiLCJ0Y3AiLCJfdGNwX2NyZWF0ZVNlcnZlciJdLCJtYXBwaW5ncyI6Ijs7OztBQUNPLFNBQVNBLG1CQUFULENBQTJCQyxPQUEzQixFQUFvQ0MsT0FBcEMsRUFBNkNDLFdBQTdDLEVBQTBEQyxLQUExRCxFQUFpRTtRQUNoRUMsVUFBVUYsWUFBWUcsV0FBWixDQUEwQkMsVUFBMUIsRUFBc0NILEtBQXRDLENBQWhCO3NCQUNzQkgsT0FBdEIsRUFBK0JJLE9BQS9CLEVBQXdDLElBQXhDO1NBQ09BLE9BQVA7O1dBRVNFLFVBQVQsQ0FBb0JDLEdBQXBCLEVBQXlCO1FBQ3BCLENBQUVDLE9BQU9DLFFBQVAsQ0FBa0JGLEdBQWxCLENBQUwsRUFBNkI7VUFDeEJBLElBQUlHLEtBQVAsRUFBZTtjQUNQRixPQUFPRyxJQUFQLENBQWNKLElBQUlHLEtBQWxCLENBQU47T0FERixNQUVLLElBQUdI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
