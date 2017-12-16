'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var stream = require('stream');
var tls = require('tls');
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

      const streams = [new stream.PassThrough(), new stream.PassThrough()];
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
        tls.connect(...args, function () {
          const sock = this.unref().setKeepAlive(true);
          const channel = _common_.bindChannel(sock);
          resolve(channel);
        }).on('error', reject);
      });
    }

    function createServer$$1(tls_options, onPeer) {
      const svr = tls.createServer(tls_options, sock => {
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

exports.direct = stream_plugin;
exports.tls = tls_plugin;
exports.tcp = tcp_plugin;
exports['default'] = tcp_plugin;
exports.bindStreamChannel = bindStreamChannel$1;
exports.connectPacketStream = connectPacketStream;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLW5ldC5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL25ldC9fc3RyZWFtX2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L19uZXRfY29tbW9uLmpzeSIsIi4uL2NvZGUvcGx1Z2lucy9uZXQvZGlyZWN0LmpzeSIsIi4uL2NvZGUvcGx1Z2lucy9uZXQvdGxzLmpzeSIsIi4uL2NvZGUvcGx1Z2lucy9uZXQvdGNwLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZGVmYXVsdCBiaW5kU3RyZWFtQ2hhbm5lbFxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRTdHJlYW1DaGFubmVsKHJzdHJlYW0sIHdzdHJlYW0sIGFwaV9jaGFubmVsLCBwcm9wcykgOjpcbiAgY29uc3QgY2hhbm5lbCA9IGFwaV9jaGFubmVsLmJpbmRDaGFubmVsIEAgc2VuZFBrdFJhdywgcHJvcHNcbiAgY29ubmVjdFBhY2tldFN0cmVhbSBAIHJzdHJlYW0sIGNoYW5uZWwsIHRydWVcbiAgcmV0dXJuIGNoYW5uZWxcblxuICBmdW5jdGlvbiBzZW5kUGt0UmF3KHBrdCkgOjpcbiAgICBpZiAhIEJ1ZmZlci5pc0J1ZmZlciBAIHBrdCA6OlxuICAgICAgaWYgcGt0Ll9yYXdfIDo6XG4gICAgICAgIHBrdCA9IEJ1ZmZlci5mcm9tIEAgcGt0Ll9yYXdfXG4gICAgICBlbHNlIGlmIHBrdC5ieXRlTGVuZ3RoIDo6XG4gICAgICAgIHBrdCA9IEJ1ZmZlci5mcm9tIEAgcGt0XG4gICAgICBlbHNlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgc2VuZFBrdFJhdyBleHBlY3RlZCAncGt0JyBhcyBhIEJ1ZmZlciBvciBhbiBvYmplY3Qgd2l0aCBhICdfcmF3XycgQnVmZmVyYFxuXG4gICAgaWYgbnVsbCA9PT0gcGt0IDo6XG4gICAgICByZXR1cm4gdm9pZCB3c3RyZWFtLmVuZCgpXG4gICAgcmV0dXJuIHZvaWQgd3N0cmVhbS53cml0ZShwa3QpXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbm5lY3RQYWNrZXRTdHJlYW0ocnN0cmVhbSwgY2hhbm5lbCwgZW5kU3RyZWFtT25TaHV0ZG93bikgOjpcbiAgY29uc3Qgc2h1dGRvd24gPSBuZXcgUHJvbWlzZSBAIGxpZmVjeWNsZVxuICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgY2hhbm5lbCwgJ3NodXRkb3duJywgQDogdmFsdWU6IHNodXRkb3duXG4gIFxuICBmdW5jdGlvbiBsaWZlY3ljbGUocmVzb2x2ZSwgcmVqZWN0KSA6OlxuICAgIGxldCBwa3REaXNwYXRjaCA9IGNoYW5uZWwuYmluZERpc3BhdGNoUGFja2V0cygpXG5cbiAgICByc3RyZWFtLm9uIEAgJ2Vycm9yJywgc2h1dGRvd25cbiAgICByc3RyZWFtLm9uIEAgJ2Nsb3NlJywgc2h1dGRvd25cbiAgICByc3RyZWFtLm9uIEAgJ2RhdGEnLCBmdW5jdGlvbiAoZGF0YSkgOjpcbiAgICAgIHRyeSA6OiBwa3REaXNwYXRjaChkYXRhKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHJldHVybiBzaHV0ZG93bihlcnIpXG5cbiAgICBmdW5jdGlvbiBzaHV0ZG93bihlcnIpIDo6XG4gICAgICBpZiB1bmRlZmluZWQgPT09IHBrdERpc3BhdGNoIDo6IHJldHVyblxuICAgICAgcGt0RGlzcGF0Y2ggPSB1bmRlZmluZWRcbiAgICAgIGlmIGVuZFN0cmVhbU9uU2h1dGRvd24gOjpcbiAgICAgICAgcnN0cmVhbS5lbmQoKVxuXG4gICAgICBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKVxuXG4iLCJpbXBvcnQgYmluZFN0cmVhbUNoYW5uZWwgZnJvbSAnLi9fc3RyZWFtX2NvbW1vbi5qc3knXG5cbm5ldF9jb21tb24ubmV0X2NvbW1vbiA9IG5ldF9jb21tb25cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG5ldF9jb21tb24oaHViLCBhc1VSTCkgOjpcbiAgLy8gc2hhcmVkIGltcGxlbWVudGF0aW9uIGJldHdlZW4gbmV0L3RjcCBhbmQgdGxzIGltcGxlbWVudGF0aW9uc1xuICByZXR1cm4gQDpcbiAgICBpbml0X3NlcnZlcihzdnIpIDo6XG4gICAgICBzdnIuY29ubl9pbmZvID0gZnVuY3Rpb24gKCkgOjpcbiAgICAgICAgY29uc3Qge2FkZHJlc3MsIHBvcnR9ID0gc3ZyLmFkZHJlc3MoKVxuICAgICAgICByZXR1cm4gQHt9IGlwX3NlcnZlcjogQHt9IGFkZHJlc3MsIHBvcnQsIGFzVVJMXG4gICAgICByZXR1cm4gc3ZyXG5cbiAgICBiaW5kT25QZWVyKHN2ciwgb25QZWVyKSA6OlxuICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIG9uUGVlciA6OlxuICAgICAgICByZXR1cm4gb25QZWVyXG4gICAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIG9uUGVlciA6OlxuICAgICAgICByZXR1cm4gY2hhbm5lbCA9PiBzdnIuZW1pdCBAIG9uUGVlciwgY2hhbm5lbFxuICAgICAgcmV0dXJuICgpID0+IG51bGxcblxuICAgIGJpbmRDaGFubmVsKHNvY2spIDo6XG4gICAgICBjb25zdCBjaGFubmVsID0gYmluZFNvY2tldENoYW5uZWwgQFxuICAgICAgICBzb2NrLCBodWIuX2FwaV9jaGFubmVsLCBhc1VSTFxuXG4gICAgICBjaGFubmVsLnNlbmRSb3V0aW5nSGFuZHNoYWtlKClcbiAgICAgIHJldHVybiBjaGFubmVsXG5cbiAgICB1bnBhY2tDb25uZWN0QXJncyhhcmdzKSA6OlxuICAgICAgaWYgMSA9PT0gYXJncy5sZW5ndGggOjpcbiAgICAgICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBhcmdzWzBdLmhyZWYgOjpcbiAgICAgICAgICBjb25zdCB7aG9zdG5hbWU6aG9zdCwgcG9ydH0gPSBhcmdzWzBdXG4gICAgICAgICAgYXJnc1swXSA9IEB7fSBob3N0LCBwb3J0XG4gICAgICByZXR1cm4gYXJnc1xuXG5cbm5ldF9jb21tb24uYmluZFNvY2tldENoYW5uZWwgPSBiaW5kU29ja2V0Q2hhbm5lbFxuZnVuY3Rpb24gYmluZFNvY2tldENoYW5uZWwoc29jaywgYXBpX2NoYW5uZWwsIGFzVVJMKSA6OlxuICBzb2NrLnNldE5vRGVsYXkodHJ1ZSlcblxuICBjb25zdCBjb25uX2luZm8gPSAoKSA9PiBAOlxuICAgIGlwX3JlbW90ZTogQHt9IGFzVVJMLCBhZGRyZXNzOiBzb2NrLnJlbW90ZUFkZHJlc3MsIHBvcnQ6IHNvY2sucmVtb3RlUG9ydFxuICAgIGlwX2xvY2FsOiBAe30gYXNVUkwsIGFkZHJlc3M6IHNvY2subG9jYWxBZGRyZXNzLCBwb3J0OiBzb2NrLmxvY2FsUG9ydFxuXG4gIHJldHVybiBiaW5kU3RyZWFtQ2hhbm5lbCBAIHNvY2ssIHNvY2ssIGFwaV9jaGFubmVsXG4gICAgQDogY29ubl9pbmZvOiBAOiB2YWx1ZTogY29ubl9pbmZvXG5cbiIsImltcG9ydCB7UGFzc1Rocm91Z2h9IGZyb20gJ3N0cmVhbSdcbmltcG9ydCBiaW5kU3RyZWFtQ2hhbm5lbCBmcm9tICcuL19zdHJlYW1fY29tbW9uLmpzeSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gc3RyZWFtX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgcmV0dXJuIGZ1bmN0aW9uKGh1YikgOjpcbiAgICByZXR1cm4gaHViLmRpcmVjdCA9IE9iamVjdC5hc3NpZ24gQCBjb25uZWN0LCBAe31cbiAgICAgIGNvbm5lY3QsIGNvbm5lY3REaXJlY3QsIGNyZWF0ZURpcmVjdENoYW5uZWxcblxuICAgIGZ1bmN0aW9uIGNvbm5lY3QocGVlcikgOjpcbiAgICAgIHJldHVybiBjb25uZWN0RGlyZWN0KHBlZXIpWzBdXG5cbiAgICBmdW5jdGlvbiBjb25uZWN0RGlyZWN0KHBlZXIpIDo6XG4gICAgICBpZiBwZWVyLmRpcmVjdCAmJiAnZnVuY3Rpb24nID09PSB0eXBlb2YgcGVlci5kaXJlY3QuY3JlYXRlRGlyZWN0Q2hhbm5lbCA6OlxuICAgICAgICBwZWVyID0gcGVlci5kaXJlY3RcblxuICAgICAgY29uc3Qgc3RyZWFtcyA9IEBbXSBuZXcgUGFzc1Rocm91Z2goKSwgbmV3IFBhc3NUaHJvdWdoKClcbiAgICAgIHJldHVybiBAW11cbiAgICAgICAgY3JlYXRlRGlyZWN0Q2hhbm5lbCBAIHN0cmVhbXNbMF0sIHN0cmVhbXNbMV1cbiAgICAgICAgcGVlci5jcmVhdGVEaXJlY3RDaGFubmVsIEAgc3RyZWFtc1sxXSwgc3RyZWFtc1swXVxuXG4gICAgZnVuY3Rpb24gY3JlYXRlRGlyZWN0Q2hhbm5lbChyc3RyZWFtLCB3c3RyZWFtKSA6OlxuICAgICAgY29uc3QgY2hhbm5lbCA9IGJpbmRTdHJlYW1DaGFubmVsIEBcbiAgICAgICAgcnN0cmVhbSwgd3N0cmVhbSwgaHViLl9hcGlfY2hhbm5lbFxuXG4gICAgICBjaGFubmVsLnNlbmRSb3V0aW5nSGFuZHNoYWtlKClcbiAgICAgIHJldHVybiBjaGFubmVsXG4iLCJpbXBvcnQgeyBjcmVhdGVTZXJ2ZXIgYXMgX3Rsc19jcmVhdGVTZXJ2ZXIsIGNvbm5lY3QgYXMgX3Rsc19jb25uZWN0IH0gZnJvbSAndGxzJ1xuaW1wb3J0IG5ldF9jb21tb24gZnJvbSAnLi9fbmV0X2NvbW1vbi5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRsc19wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGZ1bmN0aW9uIGFzX3Rsc191cmwoKSA6OiByZXR1cm4gYHRsczovLyR7dGhpcy5hZGRyZXNzfToke3RoaXMucG9ydH1gXG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGh1YikgOjpcbiAgICBjb25zdCBfY29tbW9uXyA9IG5ldF9jb21tb24oaHViLCBhc190bHNfdXJsKVxuXG4gICAgY29uc3QgdGxzX3BsdWdpbiA9IEA6IGNvbm5lY3QsIGNyZWF0ZVNlcnZlclxuICAgICAgdXJsX29wdGlvbnM6IHBsdWdpbl9vcHRpb25zLnVybF9vcHRpb25zIHx8IHt9XG4gICAgICBvbl91cmxfY29ubmVjdDogcGx1Z2luX29wdGlvbnMub25fdXJsX2Nvbm5lY3QgfHwgQCBvcHRpb25zID0+IG9wdGlvbnNcblxuICAgIGh1Yi5yZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCBAICd0bHM6JywgY29ubmVjdF91cmxcbiAgICByZXR1cm4gaHViLnRscyA9IHRsc19wbHVnaW5cblxuXG4gICAgZnVuY3Rpb24gY29ubmVjdCguLi5hcmdzKSA6OlxuICAgICAgYXJncyA9IF9jb21tb25fLnVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UgQCAocmVzb2x2ZSwgcmVqZWN0KSA9PiA6OlxuICAgICAgICBfdGxzX2Nvbm5lY3QgQCAuLi5hcmdzLCBmdW5jdGlvbiAoKSA6OlxuICAgICAgICAgIGNvbnN0IHNvY2sgPSB0aGlzLnVucmVmKCkuc2V0S2VlcEFsaXZlKHRydWUpXG4gICAgICAgICAgY29uc3QgY2hhbm5lbCA9IF9jb21tb25fLmJpbmRDaGFubmVsKHNvY2spXG4gICAgICAgICAgcmVzb2x2ZShjaGFubmVsKVxuICAgICAgICAub24gQCAnZXJyb3InLCByZWplY3RcblxuICAgIGZ1bmN0aW9uIGNyZWF0ZVNlcnZlcih0bHNfb3B0aW9ucywgb25QZWVyKSA6OlxuICAgICAgY29uc3Qgc3ZyID0gX3Rsc19jcmVhdGVTZXJ2ZXIgQCB0bHNfb3B0aW9ucywgc29jayA9PiA6OlxuICAgICAgICBzb2NrID0gc29jay51bnJlZigpLnNldEtlZXBBbGl2ZShmYWxzZSlcbiAgICAgICAgY29uc3QgY2hhbm5lbCA9IF9jb21tb25fLmJpbmRDaGFubmVsKHNvY2spXG4gICAgICAgIG9uX3BlZXIoY2hhbm5lbClcbiAgICAgIGNvbnN0IG9uX3BlZXIgPSBfY29tbW9uXy5iaW5kT25QZWVyKHN2ciwgb25QZWVyKVxuICAgICAgcmV0dXJuIF9jb21tb25fLmluaXRfc2VydmVyKHN2cilcblxuICAgIGZ1bmN0aW9uIGNvbm5lY3RfdXJsKHVybCkgOjpcbiAgICAgIGNvbnN0IHtob3N0bmFtZTpob3N0LCBwb3J0fSA9IHVybFxuICAgICAgbGV0IG9wdGlvbnMgPSBPYmplY3QuYXNzaWduIEAge2hvc3QsIHBvcnR9LCB0bHNfcGx1Z2luLnVybF9vcHRpb25zXG4gICAgICBvcHRpb25zID0gdGxzX3BsdWdpbi5vbl91cmxfY29ubmVjdChvcHRpb25zLCB1cmwpIHx8IG9wdGlvbnNcbiAgICAgIHJldHVybiBjb25uZWN0KG9wdGlvbnMpXG5cbiIsImltcG9ydCB7IGNyZWF0ZVNlcnZlciBhcyBfdGNwX2NyZWF0ZVNlcnZlciwgY3JlYXRlQ29ubmVjdGlvbiBhcyBfdGNwX2NyZWF0ZUNvbm5lY3Rpb24gfSBmcm9tICduZXQnXG5pbXBvcnQgbmV0X2NvbW1vbiBmcm9tICcuL19uZXRfY29tbW9uLmpzeSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdGNwX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgZnVuY3Rpb24gYXNfdGNwX3VybCgpIDo6IHJldHVybiBgdGNwOi8vJHt0aGlzLmFkZHJlc3N9OiR7dGhpcy5wb3J0fWBcblxuICByZXR1cm4gZnVuY3Rpb24oaHViKSA6OlxuICAgIGNvbnN0IF9jb21tb25fID0gbmV0X2NvbW1vbihodWIsIGFzX3RjcF91cmwpXG5cbiAgICBodWIucmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wgQCAndGNwOicsIGNvbm5lY3RcbiAgICByZXR1cm4gaHViLnRjcCA9IEA6IGNvbm5lY3QsIGNyZWF0ZVNlcnZlclxuXG5cbiAgICBmdW5jdGlvbiBjb25uZWN0KC4uLmFyZ3MpIDo6XG4gICAgICBhcmdzID0gX2NvbW1vbl8udW5wYWNrQ29ubmVjdEFyZ3MoYXJncylcbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZSBAIChyZXNvbHZlLCByZWplY3QpID0+IDo6XG4gICAgICAgIF90Y3BfY3JlYXRlQ29ubmVjdGlvbiBAIC4uLmFyZ3MsIGZ1bmN0aW9uKCkgOjpcbiAgICAgICAgICBjb25zdCBzb2NrID0gdGhpcy51bnJlZigpLnNldEtlZXBBbGl2ZSh0cnVlKVxuICAgICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICAgIHJlc29sdmUoY2hhbm5lbClcbiAgICAgICAgLm9uIEAgJ2Vycm9yJywgcmVqZWN0XG5cbiAgICBmdW5jdGlvbiBjcmVhdGVTZXJ2ZXIob25QZWVyKSA6OlxuICAgICAgY29uc3Qgc3ZyID0gX3RjcF9jcmVhdGVTZXJ2ZXIgQCBmdW5jdGlvbiAoc29jaykgOjpcbiAgICAgICAgc29jayA9IHNvY2sudW5yZWYoKS5zZXRLZWVwQWxpdmUoZmFsc2UpXG4gICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICBvbl9wZWVyKGNoYW5uZWwpXG4gICAgICBjb25zdCBvbl9wZWVyID0gX2NvbW1vbl8uYmluZE9uUGVlcihzdnIsIG9uUGVlcilcbiAgICAgIHJldHVybiBfY29tbW9uXy5pbml0X3NlcnZlcihzdnIpXG5cbiJdLCJuYW1lcyI6WyJiaW5kU3RyZWFtQ2hhbm5lbCIsInJzdHJlYW0iLCJ3c3RyZWFtIiwiYXBpX2NoYW5uZWwiLCJwcm9wcyIsImNoYW5uZWwiLCJiaW5kQ2hhbm5lbCIsInNlbmRQa3RSYXciLCJwa3QiLCJCdWZmZXIiLCJpc0J1ZmZlciIsIl9yYXdfIiwiZnJvbSIsImJ5dGVMZW5ndGgiLCJUeXBlRXJyb3IiLCJlbmQiLCJ3cml0ZSIsImNvbm5lY3RQYWNrZXRTdHJlYW0iLCJlbmRTdHJlYW1PblNodXRkb3duIiwic2h1dGRvd24iLCJQcm9taXNlIiwibGlmZWN5Y2xlIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJ2YWx1ZSIsInJlc29sdmUiLCJyZWplY3QiLCJwa3REaXNwYXRjaCIsImJpbmREaXNwYXRjaFBhY2tldHMiLCJvbiIsImRhdGEiLCJlcnIiLCJ1bmRlZmluZWQiLCJuZXRfY29tbW9uIiwiaHViIiwiYXNVUkwiLCJzdnIiLCJjb25uX2luZm8iLCJhZGRyZXNzIiwicG9ydCIsImlwX3NlcnZlciIsIm9uUGVlciIsImVtaXQiLCJzb2NrIiwiYmluZFNvY2tldENoYW5uZWwiLCJfYXBpX2NoYW5uZWwiLCJzZW5kUm91dGluZ0hhbmRzaGFrZSIsImFyZ3MiLCJsZW5ndGgiLCJocmVmIiwiaG9zdG5hbWUiLCJob3N0Iiwic2V0Tm9EZWxheSIsInJlbW90ZUFkZHJlc3MiLCJyZW1vdGVQb3J0IiwibG9jYWxBZGRyZXNzIiwibG9jYWxQb3J0Iiwic3RyZWFtX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwiZGlyZWN0IiwiYXNzaWduIiwiY29ubmVjdCIsImNvbm5lY3REaXJlY3QiLCJjcmVhdGVEaXJlY3RDaGFubmVsIiwicGVlciIsInN0cmVhbXMiLCJQYXNzVGhyb3VnaCIsInRsc19wbHVnaW4iLCJhc190bHNfdXJsIiwiX2NvbW1vbl8iLCJjcmVhdGVTZXJ2ZXIiLCJ1cmxfb3B0aW9ucyIsIm9uX3VybF9jb25uZWN0Iiwib3B0aW9ucyIsInJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sIiwiY29ubmVjdF91cmwiLCJ0bHMiLCJ1bnBhY2tDb25uZWN0QXJncyIsInVucmVmIiwic2V0S2VlcEFsaXZlIiwidGxzX29wdGlvbnMiLCJfdGxzX2NyZWF0ZVNlcnZlciIsIm9uX3BlZXIiLCJiaW5kT25QZWVyIiwiaW5pdF9zZXJ2ZXIiLCJ1cmwiLCJ0Y3BfcGx1Z2luIiwiYXNfdGNwX3VybCIsInRjcCIsIl90Y3BfY3JlYXRlU2VydmVyIl0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUNPLFNBQVNBLG1CQUFULENBQTJCQyxPQUEzQixFQUFvQ0MsT0FBcEMsRUFBNkNDLFdBQTdDLEVBQTBEQyxLQUExRCxFQUFpRTtRQUNoRUMsVUFBVUYsWUFBWUcsV0FBWixDQUEwQkMsVUFBMUIsRUFBc0NILEtBQXRDLENBQWhCO3NCQUNzQkgsT0FBdEIsRUFBK0JJLE9BQS9CLEVBQXdDLElBQXhDO1NBQ09BLE9BQVA7O1dBRVNFLFVBQVQsQ0FBb0JDLEdBQXBCLEVBQXlCO1FBQ3BCLENBQUVDLE9BQU9DLFFBQVAsQ0FBa0JGLEdBQWxCLENBQUwsRUFBNkI7VUFDeEJBLElBQUlHLEtBQVAsRUFBZTtjQUNQRixPQUFPRyxJQUFQLENBQWNKLElBQUlHLEtBQWxCLENBQU47T0FERixNQUVLLElB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
