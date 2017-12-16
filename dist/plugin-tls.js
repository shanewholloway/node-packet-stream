'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var tls = require('tls');

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

exports['default'] = tls_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXRscy5qcyIsInNvdXJjZXMiOlsiLi4vY29kZS9wbHVnaW5zL25ldC9fc3RyZWFtX2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L19uZXRfY29tbW9uLmpzeSIsIi4uL2NvZGUvcGx1Z2lucy9uZXQvdGxzLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgZGVmYXVsdCBiaW5kU3RyZWFtQ2hhbm5lbFxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRTdHJlYW1DaGFubmVsKHJzdHJlYW0sIHdzdHJlYW0sIGFwaV9jaGFubmVsLCBwcm9wcykgOjpcbiAgY29uc3QgY2hhbm5lbCA9IGFwaV9jaGFubmVsLmJpbmRDaGFubmVsIEAgc2VuZFBrdFJhdywgcHJvcHNcbiAgY29ubmVjdFBhY2tldFN0cmVhbSBAIHJzdHJlYW0sIGNoYW5uZWwsIHRydWVcbiAgcmV0dXJuIGNoYW5uZWxcblxuICBmdW5jdGlvbiBzZW5kUGt0UmF3KHBrdCkgOjpcbiAgICBpZiAhIEJ1ZmZlci5pc0J1ZmZlciBAIHBrdCA6OlxuICAgICAgaWYgcGt0Ll9yYXdfIDo6XG4gICAgICAgIHBrdCA9IEJ1ZmZlci5mcm9tIEAgcGt0Ll9yYXdfXG4gICAgICBlbHNlIGlmIHBrdC5ieXRlTGVuZ3RoIDo6XG4gICAgICAgIHBrdCA9IEJ1ZmZlci5mcm9tIEAgcGt0XG4gICAgICBlbHNlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgc2VuZFBrdFJhdyBleHBlY3RlZCAncGt0JyBhcyBhIEJ1ZmZlciBvciBhbiBvYmplY3Qgd2l0aCBhICdfcmF3XycgQnVmZmVyYFxuXG4gICAgaWYgbnVsbCA9PT0gcGt0IDo6XG4gICAgICByZXR1cm4gdm9pZCB3c3RyZWFtLmVuZCgpXG4gICAgcmV0dXJuIHZvaWQgd3N0cmVhbS53cml0ZShwa3QpXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbm5lY3RQYWNrZXRTdHJlYW0ocnN0cmVhbSwgY2hhbm5lbCwgZW5kU3RyZWFtT25TaHV0ZG93bikgOjpcbiAgY29uc3Qgc2h1dGRvd24gPSBuZXcgUHJvbWlzZSBAIGxpZmVjeWNsZVxuICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgY2hhbm5lbCwgJ3NodXRkb3duJywgQDogdmFsdWU6IHNodXRkb3duXG4gIFxuICBmdW5jdGlvbiBsaWZlY3ljbGUocmVzb2x2ZSwgcmVqZWN0KSA6OlxuICAgIGxldCBwa3REaXNwYXRjaCA9IGNoYW5uZWwuYmluZERpc3BhdGNoUGFja2V0cygpXG5cbiAgICByc3RyZWFtLm9uIEAgJ2Vycm9yJywgc2h1dGRvd25cbiAgICByc3RyZWFtLm9uIEAgJ2Nsb3NlJywgc2h1dGRvd25cbiAgICByc3RyZWFtLm9uIEAgJ2RhdGEnLCBmdW5jdGlvbiAoZGF0YSkgOjpcbiAgICAgIHRyeSA6OiBwa3REaXNwYXRjaChkYXRhKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHJldHVybiBzaHV0ZG93bihlcnIpXG5cbiAgICBmdW5jdGlvbiBzaHV0ZG93bihlcnIpIDo6XG4gICAgICBpZiB1bmRlZmluZWQgPT09IHBrdERpc3BhdGNoIDo6IHJldHVyblxuICAgICAgcGt0RGlzcGF0Y2ggPSB1bmRlZmluZWRcbiAgICAgIGlmIGVuZFN0cmVhbU9uU2h1dGRvd24gOjpcbiAgICAgICAgcnN0cmVhbS5lbmQoKVxuXG4gICAgICBlcnIgPyByZWplY3QoZXJyKSA6IHJlc29sdmUoKVxuXG4iLCJpbXBvcnQgYmluZFN0cmVhbUNoYW5uZWwgZnJvbSAnLi9fc3RyZWFtX2NvbW1vbi5qc3knXG5cbm5ldF9jb21tb24ubmV0X2NvbW1vbiA9IG5ldF9jb21tb25cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG5ldF9jb21tb24oaHViLCBhc1VSTCkgOjpcbiAgLy8gc2hhcmVkIGltcGxlbWVudGF0aW9uIGJldHdlZW4gbmV0L3RjcCBhbmQgdGxzIGltcGxlbWVudGF0aW9uc1xuICByZXR1cm4gQDpcbiAgICBpbml0X3NlcnZlcihzdnIpIDo6XG4gICAgICBzdnIuY29ubl9pbmZvID0gZnVuY3Rpb24gKCkgOjpcbiAgICAgICAgY29uc3Qge2FkZHJlc3MsIHBvcnR9ID0gc3ZyLmFkZHJlc3MoKVxuICAgICAgICByZXR1cm4gQHt9IGlwX3NlcnZlcjogQHt9IGFkZHJlc3MsIHBvcnQsIGFzVVJMXG4gICAgICByZXR1cm4gc3ZyXG5cbiAgICBiaW5kT25QZWVyKHN2ciwgb25QZWVyKSA6OlxuICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIG9uUGVlciA6OlxuICAgICAgICByZXR1cm4gb25QZWVyXG4gICAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIG9uUGVlciA6OlxuICAgICAgICByZXR1cm4gY2hhbm5lbCA9PiBzdnIuZW1pdCBAIG9uUGVlciwgY2hhbm5lbFxuICAgICAgcmV0dXJuICgpID0+IG51bGxcblxuICAgIGJpbmRDaGFubmVsKHNvY2spIDo6XG4gICAgICBjb25zdCBjaGFubmVsID0gYmluZFNvY2tldENoYW5uZWwgQFxuICAgICAgICBzb2NrLCBodWIuX2FwaV9jaGFubmVsLCBhc1VSTFxuXG4gICAgICBjaGFubmVsLnNlbmRSb3V0aW5nSGFuZHNoYWtlKClcbiAgICAgIHJldHVybiBjaGFubmVsXG5cbiAgICB1bnBhY2tDb25uZWN0QXJncyhhcmdzKSA6OlxuICAgICAgaWYgMSA9PT0gYXJncy5sZW5ndGggOjpcbiAgICAgICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBhcmdzWzBdLmhyZWYgOjpcbiAgICAgICAgICBjb25zdCB7aG9zdG5hbWU6aG9zdCwgcG9ydH0gPSBhcmdzWzBdXG4gICAgICAgICAgYXJnc1swXSA9IEB7fSBob3N0LCBwb3J0XG4gICAgICByZXR1cm4gYXJnc1xuXG5cbm5ldF9jb21tb24uYmluZFNvY2tldENoYW5uZWwgPSBiaW5kU29ja2V0Q2hhbm5lbFxuZnVuY3Rpb24gYmluZFNvY2tldENoYW5uZWwoc29jaywgYXBpX2NoYW5uZWwsIGFzVVJMKSA6OlxuICBzb2NrLnNldE5vRGVsYXkodHJ1ZSlcblxuICBjb25zdCBjb25uX2luZm8gPSAoKSA9PiBAOlxuICAgIGlwX3JlbW90ZTogQHt9IGFzVVJMLCBhZGRyZXNzOiBzb2NrLnJlbW90ZUFkZHJlc3MsIHBvcnQ6IHNvY2sucmVtb3RlUG9ydFxuICAgIGlwX2xvY2FsOiBAe30gYXNVUkwsIGFkZHJlc3M6IHNvY2subG9jYWxBZGRyZXNzLCBwb3J0OiBzb2NrLmxvY2FsUG9ydFxuXG4gIHJldHVybiBiaW5kU3RyZWFtQ2hhbm5lbCBAIHNvY2ssIHNvY2ssIGFwaV9jaGFubmVsXG4gICAgQDogY29ubl9pbmZvOiBAOiB2YWx1ZTogY29ubl9pbmZvXG5cbiIsImltcG9ydCB7IGNyZWF0ZVNlcnZlciBhcyBfdGxzX2NyZWF0ZVNlcnZlciwgY29ubmVjdCBhcyBfdGxzX2Nvbm5lY3QgfSBmcm9tICd0bHMnXG5pbXBvcnQgbmV0X2NvbW1vbiBmcm9tICcuL19uZXRfY29tbW9uLmpzeSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gdGxzX3BsdWdpbihwbHVnaW5fb3B0aW9ucz17fSkgOjpcbiAgZnVuY3Rpb24gYXNfdGxzX3VybCgpIDo6IHJldHVybiBgdGxzOi8vJHt0aGlzLmFkZHJlc3N9OiR7dGhpcy5wb3J0fWBcblxuICByZXR1cm4gZnVuY3Rpb24oaHViKSA6OlxuICAgIGNvbnN0IF9jb21tb25fID0gbmV0X2NvbW1vbihodWIsIGFzX3Rsc191cmwpXG5cbiAgICBjb25zdCB0bHNfcGx1Z2luID0gQDogY29ubmVjdCwgY3JlYXRlU2VydmVyXG4gICAgICB1cmxfb3B0aW9uczogcGx1Z2luX29wdGlvbnMudXJsX29wdGlvbnMgfHwge31cbiAgICAgIG9uX3VybF9jb25uZWN0OiBwbHVnaW5fb3B0aW9ucy5vbl91cmxfY29ubmVjdCB8fCBAIG9wdGlvbnMgPT4gb3B0aW9uc1xuXG4gICAgaHViLnJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sIEAgJ3RsczonLCBjb25uZWN0X3VybFxuICAgIHJldHVybiBodWIudGxzID0gdGxzX3BsdWdpblxuXG5cbiAgICBmdW5jdGlvbiBjb25uZWN0KC4uLmFyZ3MpIDo6XG4gICAgICBhcmdzID0gX2NvbW1vbl8udW5wYWNrQ29ubmVjdEFyZ3MoYXJncylcbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZSBAIChyZXNvbHZlLCByZWplY3QpID0+IDo6XG4gICAgICAgIF90bHNfY29ubmVjdCBAIC4uLmFyZ3MsIGZ1bmN0aW9uICgpIDo6XG4gICAgICAgICAgY29uc3Qgc29jayA9IHRoaXMudW5yZWYoKS5zZXRLZWVwQWxpdmUodHJ1ZSlcbiAgICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgICByZXNvbHZlKGNoYW5uZWwpXG4gICAgICAgIC5vbiBAICdlcnJvcicsIHJlamVjdFxuXG4gICAgZnVuY3Rpb24gY3JlYXRlU2VydmVyKHRsc19vcHRpb25zLCBvblBlZXIpIDo6XG4gICAgICBjb25zdCBzdnIgPSBfdGxzX2NyZWF0ZVNlcnZlciBAIHRsc19vcHRpb25zLCBzb2NrID0+IDo6XG4gICAgICAgIHNvY2sgPSBzb2NrLnVucmVmKCkuc2V0S2VlcEFsaXZlKGZhbHNlKVxuICAgICAgICBjb25zdCBjaGFubmVsID0gX2NvbW1vbl8uYmluZENoYW5uZWwoc29jaylcbiAgICAgICAgb25fcGVlcihjaGFubmVsKVxuICAgICAgY29uc3Qgb25fcGVlciA9IF9jb21tb25fLmJpbmRPblBlZXIoc3ZyLCBvblBlZXIpXG4gICAgICByZXR1cm4gX2NvbW1vbl8uaW5pdF9zZXJ2ZXIoc3ZyKVxuXG4gICAgZnVuY3Rpb24gY29ubmVjdF91cmwodXJsKSA6OlxuICAgICAgY29uc3Qge2hvc3RuYW1lOmhvc3QsIHBvcnR9ID0gdXJsXG4gICAgICBsZXQgb3B0aW9ucyA9IE9iamVjdC5hc3NpZ24gQCB7aG9zdCwgcG9ydH0sIHRsc19wbHVnaW4udXJsX29wdGlvbnNcbiAgICAgIG9wdGlvbnMgPSB0bHNfcGx1Z2luLm9uX3VybF9jb25uZWN0KG9wdGlvbnMsIHVybCkgfHwgb3B0aW9uc1xuICAgICAgcmV0dXJuIGNvbm5lY3Qob3B0aW9ucylcblxuIl0sIm5hbWVzIjpbImJpbmRTdHJlYW1DaGFubmVsIiwicnN0cmVhbSIsIndzdHJlYW0iLCJhcGlfY2hhbm5lbCIsInByb3BzIiwiY2hhbm5lbCIsImJpbmRDaGFubmVsIiwic2VuZFBrdFJhdyIsInBrdCIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiX3Jhd18iLCJmcm9tIiwiYnl0ZUxlbmd0aCIsIlR5cGVFcnJvciIsImVuZCIsIndyaXRlIiwiY29ubmVjdFBhY2tldFN0cmVhbSIsImVuZFN0cmVhbU9uU2h1dGRvd24iLCJzaHV0ZG93biIsIlByb21pc2UiLCJsaWZlY3ljbGUiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsInZhbHVlIiwicmVzb2x2ZSIsInJlamVjdCIsInBrdERpc3BhdGNoIiwiYmluZERpc3BhdGNoUGFja2V0cyIsIm9uIiwiZGF0YSIsImVyciIsInVuZGVmaW5lZCIsIm5ldF9jb21tb24iLCJodWIiLCJhc1VSTCIsInN2ciIsImNvbm5faW5mbyIsImFkZHJlc3MiLCJwb3J0IiwiaXBfc2VydmVyIiwib25QZWVyIiwiZW1pdCIsInNvY2siLCJiaW5kU29ja2V0Q2hhbm5lbCIsIl9hcGlfY2hhbm5lbCIsInNlbmRSb3V0aW5nSGFuZHNoYWtlIiwiYXJncyIsImxlbmd0aCIsImhyZWYiLCJob3N0bmFtZSIsImhvc3QiLCJzZXROb0RlbGF5IiwicmVtb3RlQWRkcmVzcyIsInJlbW90ZVBvcnQiLCJsb2NhbEFkZHJlc3MiLCJsb2NhbFBvcnQiLCJ0bHNfcGx1Z2luIiwicGx1Z2luX29wdGlvbnMiLCJhc190bHNfdXJsIiwiX2NvbW1vbl8iLCJjb25uZWN0IiwiY3JlYXRlU2VydmVyIiwidXJsX29wdGlvbnMiLCJvbl91cmxfY29ubmVjdCIsIm9wdGlvbnMiLCJyZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCIsImNvbm5lY3RfdXJsIiwidGxzIiwidW5wYWNrQ29ubmVjdEFyZ3MiLCJ1bnJlZiIsInNldEtlZXBBbGl2ZSIsInRsc19vcHRpb25zIiwiX3Rsc19jcmVhdGVTZXJ2ZXIiLCJvbl9wZWVyIiwiYmluZE9uUGVlciIsImluaXRfc2VydmVyIiwidXJsIiwiYXNzaWduIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDTyxTQUFTQSxtQkFBVCxDQUEyQkMsT0FBM0IsRUFBb0NDLE9BQXBDLEVBQTZDQyxXQUE3QyxFQUEwREMsS0FBMUQsRUFBaUU7UUFDaEVDLFVBQVVGLFlBQVlHLFdBQVosQ0FBMEJDLFVBQTFCLEVBQXNDSCxLQUF0QyxDQUFoQjtzQkFDc0JILE9BQXRCLEVBQStCSSxPQUEvQixFQUF3QyxJQUF4QztTQUNPQSxPQUFQOztXQUVTRSxVQUFULENBQW9CQyxHQUFwQixFQUF5QjtRQUNwQixDQUFFQyxPQUFPQyxRQUFQLENBQWtCRixHQUFsQixDQUFMLEVBQTZCO1VBQ3hCQSxJQUFJRyxLQUFQLEVBQWU7Y0FDUEYsT0FBT0csSUFBUCxDQUFjSixJQUFJRyxLQUFsQixDQUFOO09BREYsTUFFSyxJQUFHSCxJQUFJSyxVQUFQLEVBQW9CO2NBQ2pCSixPQUFPRyxJQUFQLENBQWNKLEdBQWQsQ0FBTjtPQURHLE1BRUE7Y0FDRyxJQUFJTSxTQUFKLENBQWlCLDBFQUFqQixDQUFOOzs7O1FBRUQsU0FBU04sR0FBWixFQUFrQjthQUNULEtBQUtOLFFBQVFhLEdBQVIsRUFBWjs7V0FDSyxLQUFLYixRQUFRYyxLQUFSLENBQWNSLEdBQWQsQ0FBWjs7OztBQUdKLEFBQU8sU0FBU1MsbUJBQVQsQ0FBNkJoQixPQUE3QixFQUFzQ0ksT0FBdEMsRUFBK0NhLG1CQUEvQyxFQUFvRTtRQUNuRUMsV0FBVyxJQUFJQyxPQUFKLENBQWNDLFNBQWQsQ0FBakI7U0FDT0MsT0FBT0MsY0FBUCxDQUF3QmxCLE9BQXhCLEVBQWlDLFVBQWpDLEVBQStDLEVBQUNtQixPQUFPTCxRQUFSLEVBQS9DLENBQVA7O1dBRVNFLFNBQVQsQ0FBbUJJLE9BQW5CLEVBQTRCQyxNQUE1QixFQUFvQztRQUM5QkMsY0FBY3RCLFFBQVF1QixtQkFBUixFQUFsQjs7WUFFUUMsRUFB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
