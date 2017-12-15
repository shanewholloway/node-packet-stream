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

export default tls_plugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLXRscy5tanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvcGx1Z2lucy9uZXQvX3N0cmVhbV9jb21tb24uanN5IiwiLi4vY29kZS9wbHVnaW5zL25ldC9fbmV0X2NvbW1vbi5qc3kiLCIuLi9jb2RlL3BsdWdpbnMvbmV0L3Rscy5qc3kiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGRlZmF1bHQgYmluZFN0cmVhbUNoYW5uZWxcbmV4cG9ydCBmdW5jdGlvbiBiaW5kU3RyZWFtQ2hhbm5lbChyc3RyZWFtLCB3c3RyZWFtLCBhcGlfY2hhbm5lbCwgcHJvcHMpIDo6XG4gIGNvbnN0IGNoYW5uZWwgPSBhcGlfY2hhbm5lbC5iaW5kQ2hhbm5lbCBAIHNlbmRQa3RSYXcsIHByb3BzXG4gIGNvbm5lY3RQYWNrZXRTdHJlYW0gQCByc3RyZWFtLCBjaGFubmVsLCB0cnVlXG4gIHJldHVybiBjaGFubmVsXG5cbiAgZnVuY3Rpb24gc2VuZFBrdFJhdyhwa3QpIDo6XG4gICAgaWYgISBCdWZmZXIuaXNCdWZmZXIgQCBwa3QgOjpcbiAgICAgIGlmIHBrdC5fcmF3XyA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdC5fcmF3X1xuICAgICAgZWxzZSBpZiBwa3QuYnl0ZUxlbmd0aCA6OlxuICAgICAgICBwa3QgPSBCdWZmZXIuZnJvbSBAIHBrdFxuICAgICAgZWxzZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYHNlbmRQa3RSYXcgZXhwZWN0ZWQgJ3BrdCcgYXMgYSBCdWZmZXIgb3IgYW4gb2JqZWN0IHdpdGggYSAnX3Jhd18nIEJ1ZmZlcmBcblxuICAgIGlmIG51bGwgPT09IHBrdCA6OlxuICAgICAgcmV0dXJuIHZvaWQgd3N0cmVhbS5lbmQoKVxuICAgIHJldHVybiB2b2lkIHdzdHJlYW0ud3JpdGUocGt0KVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBjb25uZWN0UGFja2V0U3RyZWFtKHJzdHJlYW0sIGNoYW5uZWwsIGVuZFN0cmVhbU9uU2h1dGRvd24pIDo6XG4gIGNvbnN0IHNodXRkb3duID0gbmV3IFByb21pc2UgQCBsaWZlY3ljbGVcbiAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIGNoYW5uZWwsICdzaHV0ZG93bicsIEA6IHZhbHVlOiBzaHV0ZG93blxuICBcbiAgZnVuY3Rpb24gbGlmZWN5Y2xlKHJlc29sdmUsIHJlamVjdCkgOjpcbiAgICBsZXQgcGt0RGlzcGF0Y2ggPSBjaGFubmVsLmJpbmREaXNwYXRjaFBhY2tldHMoKVxuXG4gICAgcnN0cmVhbS5vbiBAICdlcnJvcicsIHNodXRkb3duXG4gICAgcnN0cmVhbS5vbiBAICdjbG9zZScsIHNodXRkb3duXG4gICAgcnN0cmVhbS5vbiBAICdkYXRhJywgZnVuY3Rpb24gKGRhdGEpIDo6XG4gICAgICB0cnkgOjogcGt0RGlzcGF0Y2goZGF0YSlcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICByZXR1cm4gc2h1dGRvd24oZXJyKVxuXG4gICAgZnVuY3Rpb24gc2h1dGRvd24oZXJyKSA6OlxuICAgICAgaWYgdW5kZWZpbmVkID09PSBwa3REaXNwYXRjaCA6OiByZXR1cm5cbiAgICAgIHBrdERpc3BhdGNoID0gdW5kZWZpbmVkXG4gICAgICBpZiBlbmRTdHJlYW1PblNodXRkb3duIDo6XG4gICAgICAgIHJzdHJlYW0uZW5kKClcblxuICAgICAgZXJyID8gcmVqZWN0KGVycikgOiByZXNvbHZlKClcblxuIiwiaW1wb3J0IGJpbmRTdHJlYW1DaGFubmVsIGZyb20gJy4vX3N0cmVhbV9jb21tb24uanN5J1xuXG5uZXRfY29tbW9uLm5ldF9jb21tb24gPSBuZXRfY29tbW9uXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBuZXRfY29tbW9uKGh1YiwgYXNVUkwpIDo6XG4gIC8vIHNoYXJlZCBpbXBsZW1lbnRhdGlvbiBiZXR3ZWVuIG5ldC90Y3AgYW5kIHRscyBpbXBsZW1lbnRhdGlvbnNcbiAgcmV0dXJuIEA6XG4gICAgaW5pdF9zZXJ2ZXIoc3ZyKSA6OlxuICAgICAgc3ZyLmNvbm5faW5mbyA9IGZ1bmN0aW9uICgpIDo6XG4gICAgICAgIGNvbnN0IHthZGRyZXNzLCBwb3J0fSA9IHN2ci5hZGRyZXNzKClcbiAgICAgICAgcmV0dXJuIEB7fSBpcF9zZXJ2ZXI6IEB7fSBhZGRyZXNzLCBwb3J0LCBhc1VSTFxuICAgICAgcmV0dXJuIHN2clxuXG4gICAgYmluZE9uUGVlcihzdnIsIG9uUGVlcikgOjpcbiAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBvblBlZXIgOjpcbiAgICAgICAgcmV0dXJuIG9uUGVlclxuICAgICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBvblBlZXIgOjpcbiAgICAgICAgcmV0dXJuIGNoYW5uZWwgPT4gc3ZyLmVtaXQgQCBvblBlZXIsIGNoYW5uZWxcbiAgICAgIHJldHVybiAoKSA9PiBudWxsXG5cbiAgICBiaW5kQ2hhbm5lbChzb2NrKSA6OlxuICAgICAgY29uc3QgY2hhbm5lbCA9IGJpbmRTb2NrZXRDaGFubmVsIEBcbiAgICAgICAgc29jaywgaHViLl9hcGlfY2hhbm5lbCwgYXNVUkxcblxuICAgICAgY2hhbm5lbC5zZW5kUm91dGluZ0hhbmRzaGFrZSgpXG4gICAgICByZXR1cm4gY2hhbm5lbFxuXG4gICAgdW5wYWNrQ29ubmVjdEFyZ3MoYXJncykgOjpcbiAgICAgIGlmIDEgPT09IGFyZ3MubGVuZ3RoIDo6XG4gICAgICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgYXJnc1swXS5ocmVmIDo6XG4gICAgICAgICAgY29uc3Qge2hvc3RuYW1lOmhvc3QsIHBvcnR9ID0gYXJnc1swXVxuICAgICAgICAgIGFyZ3NbMF0gPSBAe30gaG9zdCwgcG9ydFxuICAgICAgcmV0dXJuIGFyZ3NcblxuXG5uZXRfY29tbW9uLmJpbmRTb2NrZXRDaGFubmVsID0gYmluZFNvY2tldENoYW5uZWxcbmZ1bmN0aW9uIGJpbmRTb2NrZXRDaGFubmVsKHNvY2ssIGFwaV9jaGFubmVsLCBhc1VSTCkgOjpcbiAgc29jay5zZXROb0RlbGF5KHRydWUpXG5cbiAgY29uc3QgY29ubl9pbmZvID0gKCkgPT4gQDpcbiAgICBpcF9yZW1vdGU6IEB7fSBhc1VSTCwgYWRkcmVzczogc29jay5yZW1vdGVBZGRyZXNzLCBwb3J0OiBzb2NrLnJlbW90ZVBvcnRcbiAgICBpcF9sb2NhbDogQHt9IGFzVVJMLCBhZGRyZXNzOiBzb2NrLmxvY2FsQWRkcmVzcywgcG9ydDogc29jay5sb2NhbFBvcnRcblxuICByZXR1cm4gYmluZFN0cmVhbUNoYW5uZWwgQCBzb2NrLCBzb2NrLCBhcGlfY2hhbm5lbFxuICAgIEA6IGNvbm5faW5mbzogQDogdmFsdWU6IGNvbm5faW5mb1xuXG4iLCJpbXBvcnQgeyBjcmVhdGVTZXJ2ZXIgYXMgX3Rsc19jcmVhdGVTZXJ2ZXIsIGNvbm5lY3QgYXMgX3Rsc19jb25uZWN0IH0gZnJvbSAndGxzJ1xuaW1wb3J0IG5ldF9jb21tb24gZnJvbSAnLi9fbmV0X2NvbW1vbi5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHRsc19wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIGZ1bmN0aW9uIGFzX3Rsc191cmwoKSA6OiByZXR1cm4gYHRsczovLyR7dGhpcy5hZGRyZXNzfToke3RoaXMucG9ydH1gXG5cbiAgcmV0dXJuIGZ1bmN0aW9uKGh1YikgOjpcbiAgICBjb25zdCBfY29tbW9uXyA9IG5ldF9jb21tb24oaHViLCBhc190bHNfdXJsKVxuXG4gICAgaHViLnJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sIEAgJ3RsczonLCBjb25uZWN0XG4gICAgcmV0dXJuIGh1Yi50bHMgPSBAOiBjb25uZWN0LCBjcmVhdGVTZXJ2ZXJcblxuXG4gICAgZnVuY3Rpb24gY29ubmVjdCguLi5hcmdzKSA6OlxuICAgICAgYXJncyA9IF9jb21tb25fLnVucGFja0Nvbm5lY3RBcmdzKGFyZ3MpXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UgQCAocmVzb2x2ZSwgcmVqZWN0KSA9PiA6OlxuICAgICAgICBfdGxzX2Nvbm5lY3QgQCAuLi5hcmdzLCBmdW5jdGlvbiAoKSA6OlxuICAgICAgICAgIGNvbnN0IHNvY2sgPSB0aGlzLnVucmVmKCkuc2V0S2VlcEFsaXZlKHRydWUpXG4gICAgICAgICAgY29uc3QgY2hhbm5lbCA9IF9jb21tb25fLmJpbmRDaGFubmVsKHNvY2spXG4gICAgICAgICAgcmVzb2x2ZShjaGFubmVsKVxuICAgICAgICAub24gQCAnZXJyb3InLCByZWplY3RcblxuICAgIGZ1bmN0aW9uIGNyZWF0ZVNlcnZlcihvcHRpb25zLCBvblBlZXIpIDo6XG4gICAgICBjb25zdCBzdnIgPSBfdGxzX2NyZWF0ZVNlcnZlciBAIG9wdGlvbnMsIHNvY2sgPT4gOjpcbiAgICAgICAgc29jayA9IHNvY2sudW5yZWYoKS5zZXRLZWVwQWxpdmUoZmFsc2UpXG4gICAgICAgIGNvbnN0IGNoYW5uZWwgPSBfY29tbW9uXy5iaW5kQ2hhbm5lbChzb2NrKVxuICAgICAgICBvbl9wZWVyKGNoYW5uZWwpXG4gICAgICBjb25zdCBvbl9wZWVyID0gX2NvbW1vbl8uYmluZE9uUGVlcihzdnIsIG9uUGVlcilcbiAgICAgIHJldHVybiBfY29tbW9uXy5pbml0X3NlcnZlcihzdnIpXG5cbiJdLCJuYW1lcyI6WyJiaW5kU3RyZWFtQ2hhbm5lbCIsInJzdHJlYW0iLCJ3c3RyZWFtIiwiYXBpX2NoYW5uZWwiLCJwcm9wcyIsImNoYW5uZWwiLCJiaW5kQ2hhbm5lbCIsInNlbmRQa3RSYXciLCJwa3QiLCJCdWZmZXIiLCJpc0J1ZmZlciIsIl9yYXdfIiwiZnJvbSIsImJ5dGVMZW5ndGgiLCJUeXBlRXJyb3IiLCJlbmQiLCJ3cml0ZSIsImNvbm5lY3RQYWNrZXRTdHJlYW0iLCJlbmRTdHJlYW1PblNodXRkb3duIiwic2h1dGRvd24iLCJQcm9taXNlIiwibGlmZWN5Y2xlIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJ2YWx1ZSIsInJlc29sdmUiLCJyZWplY3QiLCJwa3REaXNwYXRjaCIsImJpbmREaXNwYXRjaFBhY2tldHMiLCJvbiIsImRhdGEiLCJlcnIiLCJ1bmRlZmluZWQiLCJuZXRfY29tbW9uIiwiaHViIiwiYXNVUkwiLCJzdnIiLCJjb25uX2luZm8iLCJhZGRyZXNzIiwicG9ydCIsImlwX3NlcnZlciIsIm9uUGVlciIsImVtaXQiLCJzb2NrIiwiYmluZFNvY2tldENoYW5uZWwiLCJfYXBpX2NoYW5uZWwiLCJzZW5kUm91dGluZ0hhbmRzaGFrZSIsImFyZ3MiLCJsZW5ndGgiLCJocmVmIiwiaG9zdG5hbWUiLCJob3N0Iiwic2V0Tm9EZWxheSIsInJlbW90ZUFkZHJlc3MiLCJyZW1vdGVQb3J0IiwibG9jYWxBZGRyZXNzIiwibG9jYWxQb3J0IiwidGxzX3BsdWdpbiIsInBsdWdpbl9vcHRpb25zIiwiYXNfdGxzX3VybCIsIl9jb21tb25fIiwicmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wiLCJjb25uZWN0IiwidGxzIiwiY3JlYXRlU2VydmVyIiwidW5wYWNrQ29ubmVjdEFyZ3MiLCJ1bnJlZiIsInNldEtlZXBBbGl2ZSIsIm9wdGlvbnMiLCJfdGxzX2NyZWF0ZVNlcnZlciIsIm9uX3BlZXIiLCJiaW5kT25QZWVyIiwiaW5pdF9zZXJ2ZXIiXSwibWFwcGluZ3MiOiI7O0FBQ08sU0FBU0EsbUJBQVQsQ0FBMkJDLE9BQTNCLEVBQW9DQyxPQUFwQyxFQUE2Q0MsV0FBN0MsRUFBMERDLEtBQTFELEVBQWlFO1FBQ2hFQyxVQUFVRixZQUFZRyxXQUFaLENBQTBCQyxVQUExQixFQUFzQ0gsS0FBdEMsQ0FBaEI7c0JBQ3NCSCxPQUF0QixFQUErQkksT0FBL0IsRUFBd0MsSUFBeEM7U0FDT0EsT0FBUDs7V0FFU0UsVUFBVCxDQUFvQkMsR0FBcEIsRUFBeUI7UUFDcEIsQ0FBRUMsT0FBT0MsUUFBUCxDQUFrQkYsR0FBbEIsQ0FBTCxFQUE2QjtVQUN4QkEsSUFBSUcsS0FBUCxFQUFlO2NBQ1BGLE9BQU9HLElBQVAsQ0FBY0osSUFBSUcsS0FBbEIsQ0FBTjtPQURGLE1BRUssSUFBR0gsSUFBSUssVUFBUCxFQUFvQjtjQUNqQkosT0FBT0csSUFBUCxDQUFjSixHQUFkLENBQU47T0FERyxNQUVBO2NBQ0csSUFB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
