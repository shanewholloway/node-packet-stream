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
    return hub.direct = { connect: connect$$1, connectDirect, createDirectChannel };

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

    hub.registerConnectionProtocol('tls:', connect$$1);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLW5ldC5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL25ldC9fc3RyZWFtX2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L19uZXRfY29tbW9uLmpzeSIsIi4uL2NvZGUvcGx1Z2lucy9uZXQvZGlyZWN0LmpzeSIsIi4uL2NvZGUvcGx1Z2lucy9uZXQvdGxzLmpzeSIsIi4uL2NvZGUvcGx1Z2lucy9uZXQvdGNwLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZGVmYXVsdCBiaW5kU3RyZWFtQ2hhbm5lbFxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRTdHJlYW1DaGFubmVsKHJzdHJlYW0sIHdzdHJlYW0sIGFwaV9jaGFubmVsLCBwcm9wcykgOjpcbiAgY29uc3QgY2hhbm5lbCA9IGFwaV9jaGFubmVsLmJpbmRDaGFubmVsIEAgc2VuZFBrdFJhdywgcHJvcHNcbiAgY29ubmVjdFBhY2tldFN0cmVhbSBAIHJzdHJlYW0sIGNoYW5uZWwsIHRydWVcbiAgcmV0dXJuIGNoYW5uZWxcblxuICBmdW5jdGlvbiBzZW5kUGt0UmF3KHBrdCkgOjpcbiAgICBpZiAhIEJ1ZmZlci5pc0J1ZmZlciBAIHBrdCA6OlxuICAgICAgaWYgcGt0Ll9yYXdfIDo6XG4gICAgICAgIHBrdCA9IEJ1ZmZlci5mcm9tIEAgcGt0Ll9yYXdfXG4gICAgICBlbHNlIGlmIHBrdC5ieXRlTGVuZ3RoIDo6XG4gICAgICAgIHBrdCA9IEJ1ZmZlci5mcm9tIEAgcGt0XG4gICAgICBlbHNlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgc2VuZFBrdFJhdyBleHBlY3RlZCAncGt0JyBhcyBhIEJ1ZmZlciBvciBhbiBvYmplY3Qgd2l0aCBhICdfcmF3XycgQnVmZmVyYFxuXG4gICAgaWYgbnVsbCA9PT0gcGt0IDo6XG4gICAgICByZXR1cm4gdm9pZCB3c3RyZWFtLmVuZCgpXG4gICAgcmV0dXJuIHZvaWQgd3N0cmVhbS53cml0ZShwa3QpXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbm5lY3RQYWNrZXRTdHJlYW0ocnN0cmVhbSwgY2hhbm5lbCwgZW5kU3RyZWFtT25TaHV0ZG93bikgOjpcbiAgY29uc3Qgc2h1dGRvd24gPSBuZXcgUHJvbWlzZSBAIGxpZmVjeWNsZVxuICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgY2hhbm5lbCwgJ3NodXRkb3duJywgQDogdmFsdWU6IHNodXRkb3duXG4gIFxuICBmdW5jdGlvbiBsaWZlY3ljbGUocmVzb2x2ZSwgcmVqZWN0KSA6OlxuICAgIGxldCBwa3REaXNwYXRjaCA9IGNoYW5uZWwuYmluZERpc3BhdGNoUGFja2V0cygpXG5cbiAgICByc3RyZWFtLm9uIEAgJ2Vycm9yJywgc2h1dGRvd25cbiAgICByc3RyZWFtLm9uIEAgJ2Nsb3NlJywgc2h1dGRvd25cbiAgICByc3RyZWFtLm9uIEAgJ2RhdGEnLCBmdW5jdGlvbiAoZGF0YSkgOjpcbiAgICAgIHRyeSA6OiBwa3REaXNwYXRjaChkYXRhKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHJldHVybiBzaHV0ZG93bihlcnIpXG5cbiAgICBmdW5jdGlvbiBzaHV0ZG93bihlcnIpIDo6XG4gICAgICBpZiB1bmRlZmluZWQgPT09IHBrdERpc3BhdGNoIDo6IHJldHVyblxuICAgICAgcGt0RGlzcGF0Y2ggPSB1bmRlZmluZWRcbiAgICAgIGlmIGVuZFN0cmVhbU9uU2h1dGRvd24gOjpcbiAgICAgICAgcnN0cmVhbS5lbmQoKVxuXG4gICAgICBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKVxuXG4iLCJpbXBvcnQgYmluZFN0cmVhbUNoYW5uZWwgZnJvbSAnLi9fc3RyZWFtX2NvbW1vbi5qc3knXG5cbm5ldF9jb21tb24ubmV0X2NvbW1vbiA9IG5ldF9jb21tb25cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG5ldF9jb21tb24oaHViLCBhc1VSTCkgOjpcbiAgLy8gc2hhcmVkIGltcGxlbWVudGF0aW9uIGJldHdlZW4gbmV0L3RjcCBhbmQgdGxzIGltcGxlbWVudGF0aW9uc1xuICByZXR1cm4gQDpcbiAgICBpbml0X3NlcnZlcihzdnIpIDo6XG4gICAgICBzdnIuY29ubl9pbmZvID0gZnVuY3Rpb24gKCkgOjpcbiAgICAgICAgY29uc3Qge2FkZHJlc3MsIHBvcnR9ID0gc3ZyLmFkZHJlc3MoKVxuICAgICAgICByZXR1cm4gQHt9IGlwX3NlcnZlcjogQHt9IGFkZHJlc3MsIHBvcnQsIGFzVVJMXG4gICAgICByZXR1cm4gc3ZyXG5cbiAgICBiaW5kT25QZWVyKHN2ciwgb25QZWVyKSA6OlxuICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIG9uUGVlciA6OlxuICAgICAgICByZXR1cm4gb25QZWVyXG4gICAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIG9uUGVlciA6OlxuICAgICAgICByZXR1cm4gY2hhbm5lbCA9PiBzdnIuZW1pdCBAIG9uUGVlciwgY2hhbm5lbFxuICAgICAgcmV0dXJuICgpID0+IG51bGxcblxuICAgIGJpbmRDaGFubmVsKHNvY2spIDo6XG4gICAgICBjb25zdCBjaGFubmVsID0gYmluZFNvY2tldENoYW5uZWwgQFxuICAgICAgICBzb2NrLCBodWIuX2FwaV9jaGFubmVsLCBhc1VSTFxuXG4gICAgICBjaGFubmVsLnNlbmRSb3V0aW5nSGFuZHNoYWtlKClcbiAgICAgIHJldHVybiBjaGFubmVsXG5cbiAgICB1bnBhY2tDb25uZWN0QXJncyhhcmdzKSA6OlxuICAgICAgaWYgMSA9PT0gYXJncy5sZW5ndGggOjpcbiAgICAgICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBhcmdzWzBdLmhyZWYgOjpcbiAgICAgICAgICBjb25zdCB7aG9zdG5hbWU6aG9zdCwgcG9ydH0gPSBhcmdzWzBdXG4gICAgICAgICAgYXJnc1swXSA9IEB7fSBob3N0LCBwb3J0XG4gICAgICByZXR1cm4gYXJnc1xuXG5cbm5ldF9jb21tb24uYmluZFNvY2tldENoYW5uZWwgPSBiaW5kU29ja2V0Q2hhbm5lbFxuZnVuY3Rpb24gYmluZFNvY2tldENoYW5uZWwoc29jaywgYXBpX2NoYW5uZWwsIGFzVVJMKSA6OlxuICBzb2NrLnNldE5vRGVsYXkodHJ1ZSlcblxuICBjb25zdCBjb25uX2luZm8gPSAoKSA9PiBAOlxuICAgIGlwX3JlbW90ZTogQHt9IGFzVVJMLCBhZGRyZXNzOiBzb2NrLnJlbW90ZUFkZHJlc3MsIHBvcnQ6IHNvY2sucmVtb3RlUG9ydFxuICAgIGlwX2xvY2FsOiBAe30gYXNVUkwsIGFkZHJlc3M6IHNvY2subG9jYWxBZGRyZXNzLCBwb3J0OiBzb2NrLmxvY2FsUG9ydFxuXG4gIHJldHVybiBiaW5kU3RyZWFtQ2hhbm5lbCBAIHNvY2ssIHNvY2ssIGFwaV9jaGFubmVsXG4gICAgQDogY29ubl9pbmZvOiBAOiB2YWx1ZTogY29ubl9pbmZvXG5cbiIsImltcG9ydCB7UGFzc1Rocm91Z2h9IGZyb20gJ3N0cmVhbSdcbmltcG9ydCBiaW5kU3RyZWFtQ2hhbm5lbCBmcm9tICcuL19zdHJlYW1fY29tbW9uLmpzeSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gc3RyZWFtX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgcmV0dXJuIGZ1bmN0aW9uKGh1YikgOjpcbiAgICByZXR1cm4gaHViLmRpcmVjdCA9IEA6IGNvbm5lY3QsIGNvbm5lY3REaXJlY3QsIGNyZWF0ZURpcmVjdENoYW5uZWxcblxuICAgIGZ1bmN0aW9uIGNvbm5lY3QocGVlcikgOjpcbiAgICAgIHJldHVybiBjb25uZWN0RGlyZWN0KHBlZXIpWzBdXG5cbiAgICBmdW5jdGlvbiBjb25uZWN0RGlyZWN0KHBlZXIpIDo6XG4gICAgICBpZiBwZWVyLmRpcmVjdCAmJiAnZnVuY3Rpb24nID09PSB0eXBlb2YgcGVlci5kaXJlY3QuY3JlYXRlRGlyZWN0Q2hhbm5lbCA6OlxuICAgICAgICBwZWVyID0gcGVlci5kaXJlY3RcblxuICAgICAgY29uc3Qgc3RyZWFtcyA9IEBbXSBuZXcgUGFzc1Rocm91Z2goKSwgbmV3IFBhc3NUaHJvdWdoKClcbiAgICAgIHJldHVybiBAW11cbiAgICAgICAgY3JlYXRlRGlyZWN0Q2hhbm5lbCBAIHN0cmVhbXNbMF0sIHN0cmVhbXNbMV1cbiAgICAgICAgcGVlci5jcmVhdGVEaXJlY3RDaGFubmVsIEAgc3RyZWFtc1sxXSwgc3RyZWFtc1swXVxuXG4gICAgZnVuY3Rpb24gY3JlYXRlRGlyZWN0Q2hhbm5lbChyc3RyZWFtLCB3c3RyZWFtKSA6OlxuICAgICAgY29uc3QgY2hhbm5lbCA9IGJpbmRTdHJlYW1DaGFubmVsIEBcbiAgICAgICAgcnN0cmVhbSwgd3N0cmVhbSwgaHViLl9hcGlfY2hhbm5lbFxuXG4gICAgICBjaGFubmVsLnNlbmRSb3V0aW5nSGFuZHNoYWtlKClcbiAgICAgIHJldHVybiBjaGFubmVsXG4iLCJpbXBvcnQgeyBjcmVhdGVTZXJ2ZXIgYXMgX3Rsc19jcmVhdGVTZXJ2ZXIsIGNvbm5lY3QgYXMgX3Rsc19jb25uZWN0IH0gZnJvbSAndGxzJ1xuaW1wb3J0IG5ldF9jb21tb24gZnJvbSAnLi9fbmV0X2NvbW1vbi5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRsc19wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGZ1bmN0aW9uIGFzX3Rsc191cmwoKSA6OiByZXR1cm4gYHRsczovLyR7dGhpcy5hZGRyZXNzfToke3RoaXMucG9ydH1gXG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGh1YikgOjpcbiAgICBjb25zdCBfY29tbW9uXyA9IG5ldF9jb21tb24oaHViLCBhc190bHNfdXJsKVxuXG4gICAgaHViLnJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sIEAgJ3RsczonLCBjb25uZWN0XG4gICAgcmV0dXJuIGh1Yi50bHMgPSBAOiBjb25uZWN0LCBjcmVhdGVTZXJ2ZXJcblxuXG4gICAgZnVuY3Rpb24gY29ubmVjdCguLi5hcmdzKSA6OlxuICAgICAgYXJncyA9IF9jb21tb25fLnVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UgQCAocmVzb2x2ZSwgcmVqZWN0KSA9PiA6OlxuICAgICAgICBfdGxzX2Nvbm5lY3QgQCAuLi5hcmdzLCBmdW5jdGlvbiAoKSA6OlxuICAgICAgICAgIGNvbnN0IHNvY2sgPSB0aGlzLnVucmVmKCkuc2V0S2VlcEFsaXZlKHRydWUpXG4gICAgICAgICAgY29uc3QgY2hhbm5lbCA9IF9jb21tb25fLmJpbmRDaGFubmVsKHNvY2spXG4gICAgICAgICAgcmVzb2x2ZShjaGFubmVsKVxuICAgICAgICAub24gQCAnZXJyb3InLCByZWplY3RcblxuICAgIGZ1bmN0aW9uIGNyZWF0ZVNlcnZlcihvcHRpb25zLCBvblBlZXIpIDo6XG4gICAgICBjb25zdCBzdnIgPSBfdGxzX2NyZWF0ZVNlcnZlciBAIG9wdGlvbnMsIHNvY2sgPT4gOjpcbiAgICAgICAgc29jayA9IHNvY2sudW5yZWYoKS5zZXRLZWVwQWxpdmUoZmFsc2UpXG4gICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICBvbl9wZWVyKGNoYW5uZWwpXG4gICAgICBjb25zdCBvbl9wZWVyID0gX2NvbW1vbl8uYmluZE9uUGVlcihzdnIsIG9uUGVlcilcbiAgICAgIHJldHVybiBzdnJcbiIsImltcG9ydCB7IGNyZWF0ZVNlcnZlciBhcyBfdGNwX2NyZWF0ZVNlcnZlciwgY3JlYXRlQ29ubmVjdGlvbiBhcyBfdGNwX2NyZWF0ZUNvbm5lY3Rpb24gfSBmcm9tICduZXQnXG5pbXBvcnQgbmV0X2NvbW1vbiBmcm9tICcuL19uZXRfY29tbW9uLmpzeSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdGNwX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgZnVuY3Rpb24gYXNfdGNwX3VybCgpIDo6IHJldHVybiBgdGNwOi8vJHt0aGlzLmFkZHJlc3N9OiR7dGhpcy5wb3J0fWBcblxuICByZXR1cm4gZnVuY3Rpb24oaHViKSA6OlxuICAgIGNvbnN0IF9jb21tb25fID0gbmV0X2NvbW1vbihodWIsIGFzX3RjcF91cmwpXG5cbiAgICBodWIucmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wgQCAndGNwOicsIGNvbm5lY3RcbiAgICByZXR1cm4gaHViLnRjcCA9IEA6IGNvbm5lY3QsIGNyZWF0ZVNlcnZlclxuXG5cbiAgICBmdW5jdGlvbiBjb25uZWN0KC4uLmFyZ3MpIDo6XG4gICAgICBhcmdzID0gX2NvbW1vbl8udW5wYWNrQ29ubmVjdEFyZ3MoYXJncylcbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZSBAIChyZXNvbHZlLCByZWplY3QpID0+IDo6XG4gICAgICAgIF90Y3BfY3JlYXRlQ29ubmVjdGlvbiBAIC4uLmFyZ3MsIGZ1bmN0aW9uKCkgOjpcbiAgICAgICAgICBjb25zdCBzb2NrID0gdGhpcy51bnJlZigpLnNldEtlZXBBbGl2ZSh0cnVlKVxuICAgICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICAgIHJlc29sdmUoY2hhbm5lbClcbiAgICAgICAgLm9uIEAgJ2Vycm9yJywgcmVqZWN0XG5cbiAgICBmdW5jdGlvbiBjcmVhdGVTZXJ2ZXIob25QZWVyKSA6OlxuICAgICAgY29uc3Qgc3ZyID0gX3RjcF9jcmVhdGVTZXJ2ZXIgQCBmdW5jdGlvbiAoc29jaykgOjpcbiAgICAgICAgc29jayA9IHNvY2sudW5yZWYoKS5zZXRLZWVwQWxpdmUoZmFsc2UpXG4gICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICBvbl9wZWVyKGNoYW5uZWwpXG4gICAgICBjb25zdCBvbl9wZWVyID0gX2NvbW1vbl8uYmluZE9uUGVlcihzdnIsIG9uUGVlcilcbiAgICAgIHJldHVybiBfY29tbW9uXy5pbml0X3NlcnZlcihzdnIpXG5cbiJdLCJuYW1lcyI6WyJiaW5kU3RyZWFtQ2hhbm5lbCIsInJzdHJlYW0iLCJ3c3RyZWFtIiwiYXBpX2NoYW5uZWwiLCJwcm9wcyIsImNoYW5uZWwiLCJiaW5kQ2hhbm5lbCIsInNlbmRQa3RSYXciLCJwa3QiLCJCdWZmZXIiLCJpc0J1ZmZlciIsIl9yYXdfIiwiZnJvbSIsImJ5dGVMZW5ndGgiLCJUeXBlRXJyb3IiLCJlbmQiLCJ3cml0ZSIsImNvbm5lY3RQYWNrZXRTdHJlYW0iLCJlbmRTdHJlYW1PblNodXRkb3duIiwic2h1dGRvd24iLCJQcm9taXNlIiwibGlmZWN5Y2xlIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJ2YWx1ZSIsInJlc29sdmUiLCJyZWplY3QiLCJwa3REaXNwYXRjaCIsImJpbmREaXNwYXRjaFBhY2tldHMiLCJvbiIsImRhdGEiLCJlcnIiLCJ1bmRlZmluZWQiLCJuZXRfY29tbW9uIiwiaHViIiwiYXNVUkwiLCJzdnIiLCJjb25uX2luZm8iLCJhZGRyZXNzIiwicG9ydCIsImlwX3NlcnZlciIsIm9uUGVlciIsImVtaXQiLCJzb2NrIiwiYmluZFNvY2tldENoYW5uZWwiLCJfYXBpX2NoYW5uZWwiLCJzZW5kUm91dGluZ0hhbmRzaGFrZSIsImFyZ3MiLCJsZW5ndGgiLCJocmVmIiwiaG9zdG5hbWUiLCJob3N0Iiwic2V0Tm9EZWxheSIsInJlbW90ZUFkZHJlc3MiLCJyZW1vdGVQb3J0IiwibG9jYWxBZGRyZXNzIiwibG9jYWxQb3J0Iiwic3RyZWFtX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwiZGlyZWN0IiwiY29ubmVjdCIsImNvbm5lY3REaXJlY3QiLCJjcmVhdGVEaXJlY3RDaGFubmVsIiwicGVlciIsInN0cmVhbXMiLCJQYXNzVGhyb3VnaCIsInRsc19wbHVnaW4iLCJhc190bHNfdXJsIiwiX2NvbW1vbl8iLCJyZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCIsInRscyIsImNyZWF0ZVNlcnZlciIsInVucGFja0Nvbm5lY3RBcmdzIiwidW5yZWYiLCJzZXRLZWVwQWxpdmUiLCJvcHRpb25zIiwiX3Rsc19jcmVhdGVTZXJ2ZXIiLCJvbl9wZWVyIiwiYmluZE9uUGVlciIsInRjcF9wbHVnaW4iLCJhc190Y3BfdXJsIiwidGNwIiwiX3RjcF9jcmVhdGVTZXJ2ZXIiLCJpbml0X3NlcnZlciJdLCJtYXBwaW5ncyI6Ijs7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
