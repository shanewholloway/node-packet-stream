import { connect, createServer } from 'tls';

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

export default tls_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXRscy5tanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvcGx1Z2lucy9uZXQvX3N0cmVhbV9jb21tb24uanN5IiwiLi4vY29kZS9wbHVnaW5zL25ldC9fbmV0X2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L3Rscy5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGRlZmF1bHQgYmluZFN0cmVhbUNoYW5uZWxcbmV4cG9ydCBmdW5jdGlvbiBiaW5kU3RyZWFtQ2hhbm5lbChyc3RyZWFtLCB3c3RyZWFtLCBhcGlfY2hhbm5lbCwgcHJvcHMpIDo6XG4gIGNvbnN0IGNoYW5uZWwgPSBhcGlfY2hhbm5lbC5iaW5kQ2hhbm5lbCBAIHNlbmRQa3RSYXcsIHByb3BzXG4gIGNvbm5lY3RQYWNrZXRTdHJlYW0gQCByc3RyZWFtLCBjaGFubmVsLCB0cnVlXG4gIHJldHVybiBjaGFubmVsXG5cbiAgZnVuY3Rpb24gc2VuZFBrdFJhdyhwa3QpIDo6XG4gICAgaWYgISBCdWZmZXIuaXNCdWZmZXIgQCBwa3QgOjpcbiAgICAgIGlmIHBrdC5fcmF3XyA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdC5fcmF3X1xuICAgICAgZWxzZSBpZiBwa3QuYnl0ZUxlbmd0aCA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdFxuICAgICAgZWxzZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYHNlbmRQa3RSYXcgZXhwZWN0ZWQgJ3BrdCcgYXMgYSBCdWZmZXIgb3IgYW4gb2JqZWN0IHdpdGggYSAnX3Jhd18nIEJ1ZmZlcmBcblxuICAgIGlmIG51bGwgPT09IHBrdCA6OlxuICAgICAgcmV0dXJuIHZvaWQgd3N0cmVhbS5lbmQoKVxuICAgIHJldHVybiB2b2lkIHdzdHJlYW0ud3JpdGUocGt0KVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBjb25uZWN0UGFja2V0U3RyZWFtKHJzdHJlYW0sIGNoYW5uZWwsIGVuZFN0cmVhbU9uU2h1dGRvd24pIDo6XG4gIGNvbnN0IHNodXRkb3duID0gbmV3IFByb21pc2UgQCBsaWZlY3ljbGVcbiAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIGNoYW5uZWwsICdzaHV0ZG93bicsIEA6IHZhbHVlOiBzaHV0ZG93blxuICBcbiAgZnVuY3Rpb24gbGlmZWN5Y2xlKHJlc29sdmUsIHJlamVjdCkgOjpcbiAgICBsZXQgcGt0RGlzcGF0Y2ggPSBjaGFubmVsLmJpbmREaXNwYXRjaFBhY2tldHMoKVxuXG4gICAgcnN0cmVhbS5vbiBAICdlcnJvcicsIHNodXRkb3duXG4gICAgcnN0cmVhbS5vbiBAICdjbG9zZScsIHNodXRkb3duXG4gICAgcnN0cmVhbS5vbiBAICdkYXRhJywgZnVuY3Rpb24gKGRhdGEpIDo6XG4gICAgICB0cnkgOjogcGt0RGlzcGF0Y2goZGF0YSlcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICByZXR1cm4gc2h1dGRvd24oZXJyKVxuXG4gICAgZnVuY3Rpb24gc2h1dGRvd24oZXJyKSA6OlxuICAgICAgaWYgdW5kZWZpbmVkID09PSBwa3REaXNwYXRjaCA6OiByZXR1cm5cbiAgICAgIHBrdERpc3BhdGNoID0gdW5kZWZpbmVkXG4gICAgICBpZiBlbmRTdHJlYW1PblNodXRkb3duIDo6XG4gICAgICAgIHJzdHJlYW0uZW5kKClcblxuICAgICAgZXJyID8gcmVqZWN0KGVycikgOiByZXNvbHZlKClcblxuIiwiaW1wb3J0IGJpbmRTdHJlYW1DaGFubmVsIGZyb20gJy4vX3N0cmVhbV9jb21tb24uanN5J1xuXG5uZXRfY29tbW9uLm5ldF9jb21tb24gPSBuZXRfY29tbW9uXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBuZXRfY29tbW9uKGh1YiwgYXNVUkwpIDo6XG4gIC8vIHNoYXJlZCBpbXBsZW1lbnRhdGlvbiBiZXR3ZWVuIG5ldC90Y3AgYW5kIHRscyBpbXBsZW1lbnRhdGlvbnNcbiAgcmV0dXJuIEA6XG4gICAgaW5pdF9zZXJ2ZXIoc3ZyKSA6OlxuICAgICAgc3ZyLmNvbm5faW5mbyA9IGZ1bmN0aW9uICgpIDo6XG4gICAgICAgIGNvbnN0IHthZGRyZXNzLCBwb3J0fSA9IHN2ci5hZGRyZXNzKClcbiAgICAgICAgcmV0dXJuIEB7fSBpcF9zZXJ2ZXI6IEB7fSBhZGRyZXNzLCBwb3J0LCBhc1VSTFxuICAgICAgcmV0dXJuIHN2clxuXG4gICAgYmluZE9uUGVlcihzdnIsIG9uUGVlcikgOjpcbiAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBvblBlZXIgOjpcbiAgICAgICAgcmV0dXJuIG9uUGVlclxuICAgICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBvblBlZXIgOjpcbiAgICAgICAgcmV0dXJuIGNoYW5uZWwgPT4gc3ZyLmVtaXQgQCBvblBlZXIsIGNoYW5uZWxcbiAgICAgIHJldHVybiAoKSA9PiBudWxsXG5cbiAgICBiaW5kQ2hhbm5lbChzb2NrKSA6OlxuICAgICAgY29uc3QgY2hhbm5lbCA9IGJpbmRTb2NrZXRDaGFubmVsIEBcbiAgICAgICAgc29jaywgaHViLl9hcGlfY2hhbm5lbCwgYXNVUkxcblxuICAgICAgY2hhbm5lbC5zZW5kUm91dGluZ0hhbmRzaGFrZSgpXG4gICAgICByZXR1cm4gY2hhbm5lbFxuXG4gICAgdW5wYWNrQ29ubmVjdEFyZ3MoYXJncykgOjpcbiAgICAgIGlmIDEgPT09IGFyZ3MubGVuZ3RoIDo6XG4gICAgICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgYXJnc1swXS5ocmVmIDo6XG4gICAgICAgICAgY29uc3Qge2hvc3RuYW1lOmhvc3QsIHBvcnR9ID0gYXJnc1swXVxuICAgICAgICAgIGFyZ3NbMF0gPSBAe30gaG9zdCwgcG9ydFxuICAgICAgcmV0dXJuIGFyZ3NcblxuXG5uZXRfY29tbW9uLmJpbmRTb2NrZXRDaGFubmVsID0gYmluZFNvY2tldENoYW5uZWxcbmZ1bmN0aW9uIGJpbmRTb2NrZXRDaGFubmVsKHNvY2ssIGFwaV9jaGFubmVsLCBhc1VSTCkgOjpcbiAgc29jay5zZXROb0RlbGF5KHRydWUpXG5cbiAgY29uc3QgY29ubl9pbmZvID0gKCkgPT4gQDpcbiAgICBpcF9yZW1vdGU6IEB7fSBhc1VSTCwgYWRkcmVzczogc29jay5yZW1vdGVBZGRyZXNzLCBwb3J0OiBzb2NrLnJlbW90ZVBvcnRcbiAgICBpcF9sb2NhbDogQHt9IGFzVVJMLCBhZGRyZXNzOiBzb2NrLmxvY2FsQWRkcmVzcywgcG9ydDogc29jay5sb2NhbFBvcnRcblxuICByZXR1cm4gYmluZFN0cmVhbUNoYW5uZWwgQCBzb2NrLCBzb2NrLCBhcGlfY2hhbm5lbFxuICAgIEA6IGNvbm5faW5mbzogQDogdmFsdWU6IGNvbm5faW5mb1xuXG4iLCJpbXBvcnQgeyBjcmVhdGVTZXJ2ZXIgYXMgX3Rsc19jcmVhdGVTZXJ2ZXIsIGNvbm5lY3QgYXMgX3Rsc19jb25uZWN0IH0gZnJvbSAndGxzJ1xuaW1wb3J0IG5ldF9jb21tb24gZnJvbSAnLi9fbmV0X2NvbW1vbi5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRsc19wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGZ1bmN0aW9uIGFzX3Rsc191cmwoKSA6OiByZXR1cm4gYHRsczovLyR7dGhpcy5hZGRyZXNzfToke3RoaXMucG9ydH1gXG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGh1YikgOjpcbiAgICBjb25zdCBfY29tbW9uXyA9IG5ldF9jb21tb24oaHViLCBhc190bHNfdXJsKVxuXG4gICAgY29uc3QgdGxzX3BsdWdpbiA9IEA6IGNvbm5lY3QsIGNyZWF0ZVNlcnZlclxuICAgICAgdXJsX29wdGlvbnM6IHBsdWdpbl9vcHRpb25zLnVybF9vcHRpb25zIHx8IHt9XG4gICAgICBvbl91cmxfY29ubmVjdDogcGx1Z2luX29wdGlvbnMub25fdXJsX2Nvbm5lY3QgfHwgQCBvcHRpb25zID0+IG9wdGlvbnNcblxuICAgIGh1Yi5yZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbCBAICd0bHM6JywgY29ubmVjdF91cmxcbiAgICByZXR1cm4gaHViLnRscyA9IHRsc19wbHVnaW5cblxuXG4gICAgZnVuY3Rpb24gY29ubmVjdCguLi5hcmdzKSA6OlxuICAgICAgYXJncyA9IF9jb21tb25fLnVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UgQCAocmVzb2x2ZSwgcmVqZWN0KSA9PiA6OlxuICAgICAgICBfdGxzX2Nvbm5lY3QgQCAuLi5hcmdzLCBmdW5jdGlvbiAoKSA6OlxuICAgICAgICAgIGNvbnN0IHNvY2sgPSB0aGlzLnVucmVmKCkuc2V0S2VlcEFsaXZlKHRydWUpXG4gICAgICAgICAgY29uc3QgY2hhbm5lbCA9IF9jb21tb25fLmJpbmRDaGFubmVsKHNvY2spXG4gICAgICAgICAgcmVzb2x2ZShjaGFubmVsKVxuICAgICAgICAub24gQCAnZXJyb3InLCByZWplY3RcblxuICAgIGZ1bmN0aW9uIGNyZWF0ZVNlcnZlcih0bHNfb3B0aW9ucywgb25QZWVyKSA6OlxuICAgICAgY29uc3Qgc3ZyID0gX3Rsc19jcmVhdGVTZXJ2ZXIgQCB0bHNfb3B0aW9ucywgc29jayA9PiA6OlxuICAgICAgICBzb2NrID0gc29jay51bnJlZigpLnNldEtlZXBBbGl2ZShmYWxzZSlcbiAgICAgICAgY29uc3QgY2hhbm5lbCA9IF9jb21tb25fLmJpbmRDaGFubmVsKHNvY2spXG4gICAgICAgIG9uX3BlZXIoY2hhbm5lbClcbiAgICAgIGNvbnN0IG9uX3BlZXIgPSBfY29tbW9uXy5iaW5kT25QZWVyKHN2ciwgb25QZWVyKVxuICAgICAgcmV0dXJuIF9jb21tb25fLmluaXRfc2VydmVyKHN2cilcblxuICAgIGZ1bmN0aW9uIGNvbm5lY3RfdXJsKHVybCkgOjpcbiAgICAgIGNvbnN0IHtob3N0bmFtZTpob3N0LCBwb3J0fSA9IHVybFxuICAgICAgbGV0IG9wdGlvbnMgPSBPYmplY3QuYXNzaWduIEAge2hvc3QsIHBvcnR9LCB0bHNfcGx1Z2luLnVybF9vcHRpb25zXG4gICAgICBvcHRpb25zID0gdGxzX3BsdWdpbi5vbl91cmxfY29ubmVjdChvcHRpb25zLCB1cmwpIHx8IG9wdGlvbnNcbiAgICAgIHJldHVybiBjb25uZWN0KG9wdGlvbnMpXG5cbiJdLCJuYW1lcyI6WyJiaW5kU3RyZWFtQ2hhbm5lbCIsInJzdHJlYW0iLCJ3c3RyZWFtIiwiYXBpX2NoYW5uZWwiLCJwcm9wcyIsImNoYW5uZWwiLCJiaW5kQ2hhbm5lbCIsInNlbmRQa3RSYXciLCJwa3QiLCJCdWZmZXIiLCJpc0J1ZmZlciIsIl9yYXdfIiwiZnJvbSIsImJ5dGVMZW5ndGgiLCJUeXBlRXJyb3IiLCJlbmQiLCJ3cml0ZSIsImNvbm5lY3RQYWNrZXRTdHJlYW0iLCJlbmRTdHJlYW1PblNodXRkb3duIiwic2h1dGRvd24iLCJQcm9taXNlIiwibGlmZWN5Y2xlIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJ2YWx1ZSIsInJlc29sdmUiLCJyZWplY3QiLCJwa3REaXNwYXRjaCIsImJpbmREaXNwYXRjaFBhY2tldHMiLCJvbiIsImRhdGEiLCJlcnIiLCJ1bmRlZmluZWQiLCJuZXRfY29tbW9uIiwiaHViIiwiYXNVUkwiLCJzdnIiLCJjb25uX2luZm8iLCJhZGRyZXNzIiwicG9ydCIsImlwX3NlcnZlciIsIm9uUGVlciIsImVtaXQiLCJzb2NrIiwiYmluZFNvY2tldENoYW5uZWwiLCJfYXBpX2NoYW5uZWwiLCJzZW5kUm91dGluZ0hhbmRzaGFrZSIsImFyZ3MiLCJsZW5ndGgiLCJocmVmIiwiaG9zdG5hbWUiLCJob3N0Iiwic2V0Tm9EZWxheSIsInJlbW90ZUFkZHJlc3MiLCJyZW1vdGVQb3J0IiwibG9jYWxBZGRyZXNzIiwibG9jYWxQb3J0IiwidGxzX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwiYXNfdGxzX3VybCIsIl9jb21tb25fIiwiY29ubmVjdCIsImNyZWF0ZVNlcnZlciIsInVybF9vcHRpb25zIiwib25fdXJsX2Nvbm5lY3QiLCJvcHRpb25zIiwicmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wiLCJjb25uZWN0X3VybCIsInRscyIsInVucGFja0Nvbm5lY3RBcmdzIiwidW5yZWYiLCJzZXRLZWVwQWxpdmUiLCJ0bHNfb3B0aW9ucyIsIl90bHNfY3JlYXRlU2VydmVyIiwib25fcGVlciIsImJpbmRPblBlZXIiLCJpbml0X3NlcnZlciIsInVybCIsImFzc2lnbiJdLCJtYXBwaW5ncyI6Ijs7QUFDTyxTQUFTQSxtQkFBVCxDQUEyQkMsT0FBM0IsRUFBb0NDLE9BQXBDLEVBQTZDQyxXQUE3QyxFQUEwREMsS0FBMUQsRUFBaUU7UUFDaEVDLFVBQVVGLFlBQVlHLFdBQVosQ0FBMEJDLFVBQTFCLEVBQXNDSCxLQUF0QyxDQUFoQjtzQkFDc0JILE9BQXRCLEVBQStCSSxPQUEvQixFQUF3QyxJQUF4QztTQUNPQSxPQUFQOztXQUVTRSxVQUFULENBQW9CQyxHQUFwQixFQUF5QjtRQUNwQixDQUFFQyxPQUFPQyxRQUFQLENBQWtCRixHQUFsQixDQUFMLEVBQTZCO1VBQ3hCQSxJQUFJRyxLQUFQLEVBQWU7Y0FDUEYsT0FBT0csSUFBUCxDQUFjSixJQUFJRyxLQUFsQixDQUFOO09BREYsTUFFSyxJQUFHSCxJQUFJSyxVQUFQLEVBQW9CO2NBQ2pCSixPQUFPRyxJQUFQLENBQWNKLEdBQWQsQ0FBTjtPQURHLE1BRUE7Y0FDRyxJQUFJTSxTQUFKLENBQWlCLDBFQUFqQixDQUFOOzs7O1FBRUQsU0FBU04sR0FBWixFQUFrQjthQUNULEtBQUtOLFFBQVFhLEdBQVIsRUFBWjs7V0FDSyxLQUFLYixRQUFRYyxLQUFSLENBQWNSLEdBQWQsQ0FBWjs7OztBQUdKLEFBQU8sU0FBU1MsbUJBQVQsQ0FBNkJoQixPQUE3QixFQUFzQ0ksT0FBdEMsRUFBK0NhLG1CQUEvQyxFQUFvRTtRQUNuRUMsV0FBVyxJQUFJQyxPQUFKLENBQWNDLFNBQWQsQ0FBakI7U0FDT0MsT0FBT0MsY0FBUCxDQUF3QmxCLE9BQXhCLEVBQWlDLFVBQWpDLEVBQStDLEVBQUNtQixPQUFPTCxRQUFSLEVBQS9DLENBQVA7O1dBRVNFLFNBQVQsQ0FBbUJJLE9BQW5CLEVBQTRCQyxNQUE1QixFQUFvQztRQUM5QkMsY0FBY3RCLFFBQVF1QixtQkFBUixFQUFsQjs7WUFFUUMsRUFBUixD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
