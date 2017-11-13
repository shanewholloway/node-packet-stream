const dispControlByType = {
  [0xf0]: recv_hello,
  [0xf1]: recv_olleh,
  [0xfe]: recv_pong,
  [0xff]: recv_ping };

function send_hello(channel) {
  const { ec_pub_id } = channel.router;
  return channel.packAndSendRaw({
    id_router: 0, type: 0xf0,
    header: ec_pub_id,
    body: channel.hub.id_router_self() });
}

function recv_hello(router, pkt, channel) {
  const ec_other_id = pkt.header_buffer();
  if (0 !== ec_other_id.length && router.ec_id_hmac) {
    const hmac_secret = router.ec_id_hmac ? router.ec_id_hmac(ec_other_id) : null;
    send_olleh(channel, hmac_secret);
  } else {
    const id_router = pkt.unpackId(pkt.body_buffer(), 0);
    router.unverifiedPeerRoute(id_router, channel);
  }
}

function send_olleh(channel, hmac_secret) {
  const { ec_pub_id } = channel.router;
  return channel.packAndSendRaw({
    id_router: 0, type: 0xf1,
    header: ec_pub_id,
    body: hmac_secret });
}

function recv_olleh(router, pkt, channel) {
  const ec_other_id = pkt.header_buffer();
  const id_router = pkt.unpackId(ec_other_id);

  const hmac_secret = router.ec_id_hmac ? router.ec_id_hmac(ec_other_id, true) : null;
  const peer_hmac_claim = pkt.body_buffer();
  if (hmac_secret && 0 === hmac_secret.compare(peer_hmac_claim)) {
    router.verifiedPeerRoute(id_router, channel);
  } else {
    router.unverifiedPeerRoute(id_router, channel);
  }
}

function send_pingpong(channel, pong) {
  return channel.packAndSendRaw({
    id_router: 0, type: pong ? 0xfe : 0xff,
    body: new Date().toISOString() });
}

function recv_pong(router, pkt, channel) {
  const local = new Date();

  try {
    const remote = new Date(pkt.body_buffer().toString());
    const delta = remote - local;
    channel.ts_pong = { delta, remote, local };
  } catch (err) {
    channel.ts_pong = { local };
  }
}

function recv_ping(router, pkt, channel) {
  const local = new Date();

  send_pingpong(channel, true);

  try {
    const remote = new Date(pkt.body_buffer().toString());
    const delta = remote - local;
    channel.ts_ping = { delta, remote, local };
  } catch (err) {
    channel.ts_ping = { local };
  }
}

var control_protocol = Object.freeze({
	dispControlByType: dispControlByType,
	send_hello: send_hello,
	send_pingpong: send_pingpong
});

const firstAnswer = bindPromiseFirstResult();

class Router {
  constructor(id_self) {
    this.routeDiscovery = [];
    this.targetDiscovery = [];
    this.targets = this._createTargetsMap();
    this.dispControlByType = Object.create(this.dispControlByType);

    if (id_self) {
      Object.defineProperties(this, { id_self: { value: id_self } });
      this._initDispatch();
    }
  }

  // --- Dispatch core ---

  _initDispatch() {
    const routes = this._createRoutesMap();
    routes.set(0, this.bindDispatchControl());
    if (null != this.id_self) {
      routes.set(this.id_self, this.bindDispatchSelf());
    }

    this.bindDispatchRoutes(routes);
  }

  on_error_in_dispatch(err, pkt) {
    console.error('Error during packet dispatch\n  pkt:', pkt, '\n', err, '\n');
  }

  _createRoutesMap() {
    return new Map();
  }

  // --- Dispatch to route ---

  async dispatch_discover_route(id_router) {
    const dispatch_route = await firstAnswer(id_router, this.routeDiscovery);
    if (null == dispatch_route) {
      return;
    }
    this.registerRoute(id_router, dispatch_route);
    return dispatch_route;
  }

  bindDispatchRoutes(routes) {
    const pqueue = promiseQueue();
    function dispatch(pktList, channel) {
      const pq = pqueue(); // pq will dispatch during Promise resolutions
      return pktList.map(pkt => pq.then(() => dispatch_one(pkt, channel)));
    }

    const dispatch_one = async (pkt, channel) => {
      try {
        const id_router = pkt.id_router;
        let dispatch_route = routes.get(id_router);
        if (undefined === dispatch_route) {
          dispatch_route = await this.dispatch_discover_route(id_router);
          if (undefined === dispatch_route) {
            return channel.undeliverable(pkt, 'route');
          }
        }

        if (false === (await dispatch_route(pkt, channel))) {
          this.unregisterRoute(id_router);
        }
      } catch (err) {
        this.on_error_in_dispatch(err, pkt, channel);
      }
    };

    const resolveRoute = id_router => routes.get(id_router) || this.dispatch_discover_route(id_router);

    Object.defineProperties(this, {
      routes: { value: routes },
      dispatch: { value: dispatch },
      resolveRoute: { value: resolveRoute } });
    return dispatch;
  }

  registerRoute(id_router, dispatch_route) {
    if ('function' !== typeof dispatch_route) {
      if (null != dispatch_route) {
        throw new TypeError(`Expected 'dispatch_route' to be a function`);
      } else return false;
    }
    if (this.routes.has(id_router)) {
      return false;
    }
    if (0 === id_router) {
      return false;
    }
    if (this.id_self === id_router) {
      return false;
    }

    this.routes.set(id_router, dispatch_route);
    return true;
  }
  unregisterRoute(id_router) {
    return this.routes.delete(id_router);
  }
  registerPeerRoute(id_router, channel) {
    return this.registerRoute(id_router, pkt => {
      if (0 !== pkt.ttl) {
        channel.sendRaw(pkt);
      }
    });
  }
  verifiedPeerRoute(id_router, channel) {
    return this.registerPeerRoute(id_router, channel);
  }
  unverifiedPeerRoute(id_router, channel) {
    if (this.allowUnverifiedRoutes || channel.allowUnverifiedRoutes) {
      return this.registerPeerRoute(id_router, channel);
    } else console.warn('Unverified peer route (ignored):', { id_router, channel });
  }

  // --- Dispatch to local target

  dispatch_discover_target(id_target, pkt) {
    return firstAnswer(id_target, this.targetDiscovery);
  }

  bindDispatchSelf(pkt) {
    const dispatchSelf = async (pkt, channel) => {
      const id_target = pkt.id_target;
      let target = this.targets.get(id_target);
      if (undefined === target) {
        target = await this.dispatch_discover_target(pkt);
        if (null == target) {
          return channel.undeliverable(pkt, 'target');
        }
        //this.registerTarget(id_target, target)
      }if (false === (await target(pkt, this))) {
        this.unregisterTarget(id_target);
      }
    };

    this.dispatchSelf = dispatchSelf;
    return dispatchSelf;
  }

  _createTargetsMap() {
    return new Map();
  }
  registerTarget(id_target, target) {
    if ('function' === typeof id_target && undefined === target) {
      target = id_target;
      id_target = target.id_target || target.id;
    }

    if ('function' !== typeof target) {
      throw new TypeError(`Expected 'target' to be a function`);
    }
    if (!Number.isSafeInteger(id_target)) {
      throw new TypeError(`Expected 'id_target' to be an integer`);
    }
    if (this.targets.has(id_target)) {
      return false;
    }
    return this.targets.set(id_target, target);
  }
  unregisterTarget(id_target) {
    return this.targets.delete(id_target);
  }

  // --- Dispatch control packets

  bindDispatchControl() {
    return (pkt, channel) => {
      if (0 !== pkt.id_target) {
        // connection-dispatched
        return this.dispatchSelf(pkt, channel);
      }

      const handler = this.dispControlByType[pkt.type];
      if (undefined !== handler) {
        return handler(this, pkt, channel);
      } else {
        return this.dnu_dispatch_control(pkt, channel);
      }
    };
  }
  dnu_dispatch_control(pkt, channel) {
    console.warn('dnu_dispatch_control', pkt.type, pkt);
  }
}

Router.prototype.dispControlByType = Object.assign({}, dispControlByType);

function promiseQueue() {
  let tip = null;
  return function () {
    if (null === tip) {
      tip = Promise.resolve();
      tip.then(clear_tip);
    }
    return tip;
  };

  function clear_tip() {
    tip = null;
  }
}

function bindPromiseFirstResult(options = {}) {
  const on_error = options.on_error || console.error;
  const ifAbsent = options.absent || null;

  return (tip, lstFns) => new Promise(resolve => {
    tip = Promise.resolve(tip);
    Promise.all(Array.from(lstFns, fn => tip.then(fn).then(resolve, on_error))).then(absent, absent);

    function absent() {
      if ('function' === typeof ifAbsent) {
        resolve(ifAbsent());
      } else resolve(ifAbsent);
    }
  });
}

class Channel {
  sendRaw() {
    throw new Error(`Instance responsiblity`);
  }
  packRaw() {
    throw new Error(`Instance responsiblity`);
  }

  packAndSendRaw(...args) {
    return this.sendRaw(this.packRaw(...args));
  }

  sendJSON(pkt_obj) {
    return this.sendRaw(this.packJSON(pkt_obj));
  }
  packJSON(pkt_obj) {
    if (undefined !== pkt_obj.header) {
      pkt_obj.header = JSON.stringify(pkt_obj.header);
    }
    if (undefined !== pkt_obj.body) {
      pkt_obj.body = JSON.stringify(pkt_obj.body);
    }
    return this.packRaw(pkt_obj);
  }

  // --- Control message utilities

  sendRoutingHandshake() {
    return send_hello(this, this.router.ec_pub_id);
  }
  sendPing() {
    return send_pingpong(this);
  }

  clone(props, ...extra) {
    const self = Object.create(this, props);
    return 0 === extra.length ? self : Object.assign(self, ...extra);
  }
  bindChannel(sendRaw, props) {
    return bindChannel(this, sendRaw, props);
  }
  bindDispatchPackets() {
    return bindDispatchPackets(this);
  }

  undeliverable(pkt, mode) {
    console.warn('undeliverable:', pkt, mode);
  }

  static asAPI(hub, router, packRaw) {
    const self = new this();
    Object.defineProperties(self, {
      packRaw: { value: packRaw },
      router: { value: router },
      hub: { value: hub },
      _root_: { value: self } });
    return self;
  }

  static asChannelAPI(hub, router, packetParser) {
    const self = this.asAPI(hub, router, packetParser.packPacket);
    return self;
  }

  static asInternalAPI(hub, router, packetParser) {
    const self = this.asAPI(hub, router, packetParser.packPacketObj);
    return self.bindChannel(bindDispatchInternalPacket(router));
  }
}

function bindChannel(channel, sendRaw, props) {
  if ('function' !== typeof sendRaw) {
    throw new TypeError(`Channel expects 'sendRaw' function parameter`);
  }

  const core_props = { sendRaw: { value: sendRaw } };
  props = null == props ? core_props : Object.assign(core_props, props);

  const self = Object.create(channel, props);
  return sendRaw.channel = self;
}

function bindDispatchInternalPacket(router) {
  const dispatch = router.dispatch;
  return dispatch_pkt_obj;

  function dispatch_pkt_obj(pkt) {
    if (undefined === pkt._raw_) {
      throw new TypeError(`Expected a parsed pkt_obj with valid '_raw_' buffer property`);
    }
    dispatch([pkt], dispatch_pkt_obj.channel);
    return true;
  }
}

function bindDispatchPackets(channel) {
  const dispatch = channel.router.dispatch;
  const feed = channel.hub.packetParser.packetStream();

  return function on_recv_data(data) {
    const pktList = feed(data);
    if (0 < pktList.length) {
      dispatch(pktList, channel);
    }
  };
}

var channel = Object.freeze({
	Channel: Channel,
	default: Channel,
	bindChannel: bindChannel,
	bindDispatchInternalPacket: bindDispatchInternalPacket,
	bindDispatchPackets: bindDispatchPackets
});

class FabricHub$1 {
  constructor() {
    applyPlugins('pre', this.pluginList, this);

    const packetParser = this.packetParser;
    if (null == packetParser || !packetParser.isPacketParser()) {
      throw new TypeError(`Invalid hub.packetParser`);
    }

    const router = this._init_router();
    const _api_channel = this._init_channelAPI(router, packetParser);
    const _api_internal = this._init_internalAPI(router, packetParser);
    Object.defineProperties(this, {
      router: { value: router },
      packetParser: { value: packetParser },
      _api_channel: { value: _api_channel },
      _api_internal: { value: _api_internal } });

    applyPlugins(null, this.pluginList, this);
    applyPlugins('post', this.pluginList, this);
    return this;
  }

  _init_router() {
    throw new Error(`Plugin responsiblity`);
  }

  _init_channelAPI(router, packetParser) {
    return Channel.asChannelAPI(this, router, packetParser);
  }
  _init_internalAPI(router, packetParser) {
    return Channel.asInternalAPI(this, router, packetParser);
  }

  static plugin(...pluginFunctions) {
    return this.plugins(...pluginFunctions);
  }
  static plugins(...pluginFunctions) {
    const pluginList = [].concat(this.prototype.pluginList || [], pluginFunctions);

    pluginList.sort((a, b) => (0 | a.order) - (0 | b.order));

    const BaseHub = this._BaseHub_ || this;
    class FabricHub_PI extends BaseHub {}
    Object.defineProperties(FabricHub_PI.prototype, {
      pluginList: { value: Object.freeze(pluginList) } });
    Object.defineProperties(FabricHub_PI, {
      _BaseHub_: { value: BaseHub } });

    applyPlugins('subclass', pluginList, FabricHub_PI, { Router, Channel });
    return FabricHub_PI;
  }

  get id_self() {
    return this.router.id_self;
  }
  id_router_self() {
    return this.packetParser.packId(this.router.id_self);
  }
  connect_self() {
    return this._api_internal.clone();
  }

  connect(conn_url) {
    if (null == conn_url) {
      return this.connect_self();
    }

    if ('string' === typeof conn_url) {
      conn_url = this._parseConnectURL(conn_url);
    }

    const connect = this._connectByProtocol[conn_url.protocol];
    if (!connect) {
      throw new Error(`Connection protocol "${conn_url.protocol}" not registered for "${conn_url.toString()}"`);
    }

    return connect(conn_url);
  }

  registerConnectionProtocol(protocol, cb_connect) {
    if ('function' !== typeof cb_connect) {
      throw new TypeError(`Expected 'cb_connect' function`);
    }
    const byProtocol = Object.assign({}, this._connectByProtocol);
    byProtocol[protocol] = cb_connect;
    return Object.defineProperty(this, '_connectByProtocol', { value: byProtocol, configurable: true });
  }

  _parseConnectURL(conn_url) {
    return new URL(conn_url);
  }
}

function applyPlugins(key, pluginList, ...args) {
  if (!key) {
    key = null;
  }
  for (let plugin of pluginList) {
    if (null !== key) {
      plugin = plugin[key];
    }
    if ('function' === typeof plugin) {
      plugin(...args);
    }
  }
}

export { channel, control_protocol, FabricHub$1 as FabricHub, applyPlugins, Router };
export default FabricHub$1;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgubWpzIiwic291cmNlcyI6WyIuLi9jb2RlL2NvbnRyb2xfcHJvdG9jb2wuanN5IiwiLi4vY29kZS9yb3V0ZXIuanN5IiwiLi4vY29kZS9jaGFubmVsLmpzeSIsIi4uL2NvZGUvaHViLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY29uc3QgZGlzcENvbnRyb2xCeVR5cGUgPSBAe31cbiAgWzB4ZjBdOiByZWN2X2hlbGxvXG4gIFsweGYxXTogcmVjdl9vbGxlaFxuICBbMHhmZV06IHJlY3ZfcG9uZ1xuICBbMHhmZl06IHJlY3ZfcGluZ1xuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfaGVsbG8oY2hhbm5lbCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgaWYgMCAhPT0gZWNfb3RoZXJfaWQubGVuZ3RoICYmIHJvdXRlci5lY19pZF9obWFjIDo6XG4gICAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCkgOiBudWxsXG4gICAgc2VuZF9vbGxlaCBAIGNoYW5uZWwsIGhtYWNfc2VjcmV0XG5cbiAgZWxzZSA6OlxuICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChwa3QuYm9keV9idWZmZXIoKSwgMClcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbmZ1bmN0aW9uIHNlbmRfb2xsZWgoY2hhbm5lbCwgaG1hY19zZWNyZXQpIDo6XG4gIGNvbnN0IHtlY19wdWJfaWR9ID0gY2hhbm5lbC5yb3V0ZXJcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IDB4ZjFcbiAgICBoZWFkZXI6IGVjX3B1Yl9pZFxuICAgIGJvZHk6IGhtYWNfc2VjcmV0XG5cbmZ1bmN0aW9uIHJlY3Zfb2xsZWgocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gcGt0LmhlYWRlcl9idWZmZXIoKVxuICBjb25zdCBpZF9yb3V0ZXIgPSBwa3QudW5wYWNrSWQoZWNfb3RoZXJfaWQpXG5cbiAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgID8gcm91dGVyLmVjX2lkX2htYWMoZWNfb3RoZXJfaWQsIHRydWUpIDogbnVsbFxuICBjb25zdCBwZWVyX2htYWNfY2xhaW0gPSBwa3QuYm9keV9idWZmZXIoKVxuICBpZiBobWFjX3NlY3JldCAmJiAwID09PSBobWFjX3NlY3JldC5jb21wYXJlIEAgcGVlcl9obWFjX2NsYWltIDo6XG4gICAgcm91dGVyLnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG4gIGVsc2UgOjpcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfcGluZ3BvbmcoY2hhbm5lbCwgcG9uZykgOjpcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IHBvbmcgPyAweGZlIDogMHhmZlxuICAgIGJvZHk6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG5mdW5jdGlvbiByZWN2X3Bvbmcocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGxvY2FsID0gbmV3IERhdGUoKVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgcGt0LmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BvbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGxvY2FsXG5cbmZ1bmN0aW9uIHJlY3ZfcGluZyhyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgc2VuZF9waW5ncG9uZyBAIGNoYW5uZWwsIHRydWVcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIHBrdC5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBsb2NhbFxuXG4iLCJpbXBvcnQge2Rpc3BDb250cm9sQnlUeXBlfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5jb25zdCBmaXJzdEFuc3dlciA9IGJpbmRQcm9taXNlRmlyc3RSZXN1bHQoKVxuXG5leHBvcnQgY2xhc3MgUm91dGVyIDo6XG4gIGNvbnN0cnVjdG9yKGlkX3NlbGYpIDo6XG4gICAgaWYgaWRfc2VsZiA6OlxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOiBpZF9zZWxmOiBAOiB2YWx1ZTogaWRfc2VsZlxuICAgICAgdGhpcy5faW5pdERpc3BhdGNoKClcblxuICAvLyAtLS0gRGlzcGF0Y2ggY29yZSAtLS1cblxuICBfaW5pdERpc3BhdGNoKCkgOjpcbiAgICBjb25zdCByb3V0ZXMgPSB0aGlzLl9jcmVhdGVSb3V0ZXNNYXAoKVxuICAgIHJvdXRlcy5zZXQgQCAwLCB0aGlzLmJpbmREaXNwYXRjaENvbnRyb2woKVxuICAgIGlmIG51bGwgIT0gdGhpcy5pZF9zZWxmIDo6XG4gICAgICByb3V0ZXMuc2V0IEAgdGhpcy5pZF9zZWxmLCB0aGlzLmJpbmREaXNwYXRjaFNlbGYoKVxuXG4gICAgdGhpcy5iaW5kRGlzcGF0Y2hSb3V0ZXMocm91dGVzKVxuXG4gIG9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgcGt0KSA6OlxuICAgIGNvbnNvbGUuZXJyb3IgQCAnRXJyb3IgZHVyaW5nIHBhY2tldCBkaXNwYXRjaFxcbiAgcGt0OicsIHBrdCwgJ1xcbicsIGVyciwgJ1xcbidcblxuICBfY3JlYXRlUm91dGVzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byByb3V0ZSAtLS1cblxuICByb3V0ZURpc2NvdmVyeSA9IFtdXG4gIGFzeW5jIGRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlcikgOjpcbiAgICBjb25zdCBkaXNwYXRjaF9yb3V0ZSA9IGF3YWl0IGZpcnN0QW5zd2VyIEAgaWRfcm91dGVyLCB0aGlzLnJvdXRlRGlzY292ZXJ5XG4gICAgaWYgbnVsbCA9PSBkaXNwYXRjaF9yb3V0ZSA6OiByZXR1cm5cbiAgICB0aGlzLnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSlcbiAgICByZXR1cm4gZGlzcGF0Y2hfcm91dGVcblxuICBiaW5kRGlzcGF0Y2hSb3V0ZXMocm91dGVzKSA6OlxuICAgIGNvbnN0IHBxdWV1ZSA9IHByb21pc2VRdWV1ZSgpXG4gICAgZnVuY3Rpb24gZGlzcGF0Y2gocGt0TGlzdCwgY2hhbm5lbCkgOjpcbiAgICAgIGNvbnN0IHBxID0gcHF1ZXVlKCkgLy8gcHEgd2lsbCBkaXNwYXRjaCBkdXJpbmcgUHJvbWlzZSByZXNvbHV0aW9uc1xuICAgICAgcmV0dXJuIHBrdExpc3QubWFwIEAgcGt0ID0+XG4gICAgICAgIHBxLnRoZW4gQCAoKSA9PiBkaXNwYXRjaF9vbmUocGt0LCBjaGFubmVsKVxuXG4gICAgY29uc3QgZGlzcGF0Y2hfb25lID0gYXN5bmMgKHBrdCwgY2hhbm5lbCkgPT4gOjpcbiAgICAgIHRyeSA6OlxuICAgICAgICBjb25zdCBpZF9yb3V0ZXIgPSBwa3QuaWRfcm91dGVyXG4gICAgICAgIGxldCBkaXNwYXRjaF9yb3V0ZSA9IHJvdXRlcy5nZXQoaWRfcm91dGVyKVxuICAgICAgICBpZiB1bmRlZmluZWQgPT09IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgICAgZGlzcGF0Y2hfcm91dGUgPSBhd2FpdCB0aGlzLmRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlcilcbiAgICAgICAgICBpZiB1bmRlZmluZWQgPT09IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgICAgICByZXR1cm4gY2hhbm5lbC51bmRlbGl2ZXJhYmxlKHBrdCwgJ3JvdXRlJylcblxuICAgICAgICBpZiBmYWxzZSA9PT0gYXdhaXQgZGlzcGF0Y2hfcm91dGUocGt0LCBjaGFubmVsKSA6OlxuICAgICAgICAgIHRoaXMudW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcilcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICB0aGlzLm9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgcGt0LCBjaGFubmVsKVxuXG4gICAgY29uc3QgcmVzb2x2ZVJvdXRlID0gKGlkX3JvdXRlcikgPT5cbiAgICAgIHJvdXRlcy5nZXQoaWRfcm91dGVyKSB8fFxuICAgICAgICB0aGlzLmRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlcilcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDpcbiAgICAgIHJvdXRlczogQDogdmFsdWU6IHJvdXRlc1xuICAgICAgZGlzcGF0Y2g6IEA6IHZhbHVlOiBkaXNwYXRjaFxuICAgICAgcmVzb2x2ZVJvdXRlOiBAOiB2YWx1ZTogcmVzb2x2ZVJvdXRlXG4gICAgcmV0dXJuIGRpc3BhdGNoXG5cbiAgcmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlKSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgaWYgbnVsbCAhPSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdkaXNwYXRjaF9yb3V0ZScgdG8gYmUgYSBmdW5jdGlvbmBcbiAgICAgIGVsc2UgcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5yb3V0ZXMuaGFzIEAgaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuICAgIGlmIDAgPT09IGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiB0aGlzLmlkX3NlbGYgPT09IGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcblxuICAgIHRoaXMucm91dGVzLnNldCBAIGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGVcbiAgICByZXR1cm4gdHJ1ZVxuICB1bnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyKSA6OlxuICAgIHJldHVybiB0aGlzLnJvdXRlcy5kZWxldGUgQCBpZF9yb3V0ZXJcbiAgcmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUm91dGUgQCBpZF9yb3V0ZXIsIHBrdCA9PiA6OlxuICAgICAgaWYgMCAhPT0gcGt0LnR0bCA6OiBjaGFubmVsLnNlbmRSYXcocGt0KVxuICB2ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKVxuICB1bnZlcmlmaWVkUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICBpZiB0aGlzLmFsbG93VW52ZXJpZmllZFJvdXRlcyB8fCBjaGFubmVsLmFsbG93VW52ZXJpZmllZFJvdXRlcyA6OlxuICAgICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKVxuICAgIGVsc2UgY29uc29sZS53YXJuIEAgJ1VudmVyaWZpZWQgcGVlciByb3V0ZSAoaWdub3JlZCk6JywgQDogaWRfcm91dGVyLCBjaGFubmVsXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggdG8gbG9jYWwgdGFyZ2V0XG5cbiAgdGFyZ2V0RGlzY292ZXJ5ID0gW11cbiAgZGlzcGF0Y2hfZGlzY292ZXJfdGFyZ2V0KGlkX3RhcmdldCwgcGt0KSA6OlxuICAgIHJldHVybiBmaXJzdEFuc3dlciBAIGlkX3RhcmdldCwgdGhpcy50YXJnZXREaXNjb3ZlcnlcblxuICBiaW5kRGlzcGF0Y2hTZWxmKHBrdCkgOjpcbiAgICBjb25zdCBkaXNwYXRjaFNlbGYgPSBhc3luYyAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgY29uc3QgaWRfdGFyZ2V0ID0gcGt0LmlkX3RhcmdldFxuICAgICAgbGV0IHRhcmdldCA9IHRoaXMudGFyZ2V0cy5nZXQoaWRfdGFyZ2V0KVxuICAgICAgaWYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgICAgdGFyZ2V0ID0gYXdhaXQgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl90YXJnZXQocGt0KVxuICAgICAgICBpZiBudWxsID09IHRhcmdldCA6OlxuICAgICAgICAgIHJldHVybiBjaGFubmVsLnVuZGVsaXZlcmFibGUocGt0LCAndGFyZ2V0JylcbiAgICAgICAgLy90aGlzLnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCwgdGFyZ2V0KVxuXG4gICAgICBpZiBmYWxzZSA9PT0gYXdhaXQgdGFyZ2V0KHBrdCwgdGhpcykgOjpcbiAgICAgICAgdGhpcy51bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldClcblxuICAgIHRoaXMuZGlzcGF0Y2hTZWxmID0gZGlzcGF0Y2hTZWxmXG4gICAgcmV0dXJuIGRpc3BhdGNoU2VsZlxuXG4gIF9jcmVhdGVUYXJnZXRzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuICB0YXJnZXRzID0gdGhpcy5fY3JlYXRlVGFyZ2V0c01hcCgpXG4gIHJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCwgdGFyZ2V0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpZF90YXJnZXQgJiYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgIHRhcmdldCA9IGlkX3RhcmdldFxuICAgICAgaWRfdGFyZ2V0ID0gdGFyZ2V0LmlkX3RhcmdldCB8fCB0YXJnZXQuaWRcblxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiB0YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ3RhcmdldCcgdG8gYmUgYSBmdW5jdGlvbmBcbiAgICBpZiAhIE51bWJlci5pc1NhZmVJbnRlZ2VyIEAgaWRfdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdpZF90YXJnZXQnIHRvIGJlIGFuIGludGVnZXJgXG4gICAgaWYgdGhpcy50YXJnZXRzLmhhcyBAIGlkX3RhcmdldCA6OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5zZXQgQCBpZF90YXJnZXQsIHRhcmdldFxuICB1bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCkgOjpcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLmRlbGV0ZSBAIGlkX3RhcmdldFxuXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggY29udHJvbCBwYWNrZXRzXG5cbiAgYmluZERpc3BhdGNoQ29udHJvbCgpIDo6XG4gICAgcmV0dXJuIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICBpZiAwICE9PSBwa3QuaWRfdGFyZ2V0IDo6IC8vIGNvbm5lY3Rpb24tZGlzcGF0Y2hlZFxuICAgICAgICByZXR1cm4gdGhpcy5kaXNwYXRjaFNlbGYocGt0LCBjaGFubmVsKVxuXG4gICAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVtwa3QudHlwZV1cbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gaGFuZGxlciA6OlxuICAgICAgICByZXR1cm4gaGFuZGxlcih0aGlzLCBwa3QsIGNoYW5uZWwpXG4gICAgICBlbHNlIDo6XG4gICAgICAgIHJldHVybiB0aGlzLmRudV9kaXNwYXRjaF9jb250cm9sKHBrdCwgY2hhbm5lbClcblxuICBkaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5jcmVhdGUgQCB0aGlzLmRpc3BDb250cm9sQnlUeXBlXG4gIGRudV9kaXNwYXRjaF9jb250cm9sKHBrdCwgY2hhbm5lbCkgOjpcbiAgICBjb25zb2xlLndhcm4gQCAnZG51X2Rpc3BhdGNoX2NvbnRyb2wnLCBwa3QudHlwZSwgcGt0XG5cblxuUm91dGVyLnByb3RvdHlwZS5kaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5hc3NpZ24gQCB7fVxuICBkaXNwQ29udHJvbEJ5VHlwZVxuXG5leHBvcnQgZGVmYXVsdCBSb3V0ZXJcblxuXG5mdW5jdGlvbiBwcm9taXNlUXVldWUoKSA6OlxuICBsZXQgdGlwID0gbnVsbFxuICByZXR1cm4gZnVuY3Rpb24gKCkgOjpcbiAgICBpZiBudWxsID09PSB0aXAgOjpcbiAgICAgIHRpcCA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICB0aXAudGhlbiBAIGNsZWFyX3RpcFxuICAgIHJldHVybiB0aXBcblxuICBmdW5jdGlvbiBjbGVhcl90aXAoKSA6OlxuICAgIHRpcCA9IG51bGxcblxuZnVuY3Rpb24gYmluZFByb21pc2VGaXJzdFJlc3VsdChvcHRpb25zPXt9KSA6OlxuICBjb25zdCBvbl9lcnJvciA9IG9wdGlvbnMub25fZXJyb3IgfHwgY29uc29sZS5lcnJvclxuICBjb25zdCBpZkFic2VudCA9IG9wdGlvbnMuYWJzZW50IHx8IG51bGxcblxuICByZXR1cm4gKHRpcCwgbHN0Rm5zKSA9PlxuICAgIG5ldyBQcm9taXNlIEAgcmVzb2x2ZSA9Pjo6XG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUodGlwKVxuICAgICAgUHJvbWlzZS5hbGwgQFxuICAgICAgICBBcnJheS5mcm9tIEAgbHN0Rm5zLCBmbiA9PlxuICAgICAgICAgIHRpcC50aGVuKGZuKS50aGVuKHJlc29sdmUsIG9uX2Vycm9yKVxuICAgICAgLnRoZW4gQCBhYnNlbnQsIGFic2VudFxuXG4gICAgICBmdW5jdGlvbiBhYnNlbnQoKSA6OlxuICAgICAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaWZBYnNlbnQgOjpcbiAgICAgICAgICByZXNvbHZlIEAgaWZBYnNlbnQoKVxuICAgICAgICBlbHNlIHJlc29sdmUgQCBpZkFic2VudFxuIiwiaW1wb3J0IHtzZW5kX2hlbGxvLCBzZW5kX3Bpbmdwb25nfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5cbmV4cG9ydCBjbGFzcyBDaGFubmVsIDo6XG4gIHNlbmRSYXcoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgSW5zdGFuY2UgcmVzcG9uc2libGl0eWBcbiAgcGFja1JhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuXG4gIHBhY2tBbmRTZW5kUmF3KC4uLmFyZ3MpIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja1JhdyBAIC4uLmFyZ3NcblxuICBzZW5kSlNPTihwa3Rfb2JqKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tKU09OIEAgcGt0X29ialxuICBwYWNrSlNPTihwa3Rfb2JqKSA6OlxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcGt0X29iai5oZWFkZXIgOjpcbiAgICAgIHBrdF9vYmouaGVhZGVyID0gSlNPTi5zdHJpbmdpZnkgQCBwa3Rfb2JqLmhlYWRlclxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcGt0X29iai5ib2R5IDo6XG4gICAgICBwa3Rfb2JqLmJvZHkgPSBKU09OLnN0cmluZ2lmeSBAIHBrdF9vYmouYm9keVxuICAgIHJldHVybiB0aGlzLnBhY2tSYXcocGt0X29iailcblxuXG4gIC8vIC0tLSBDb250cm9sIG1lc3NhZ2UgdXRpbGl0aWVzXG5cbiAgc2VuZFJvdXRpbmdIYW5kc2hha2UoKSA6OlxuICAgIHJldHVybiBzZW5kX2hlbGxvKHRoaXMsIHRoaXMucm91dGVyLmVjX3B1Yl9pZClcbiAgc2VuZFBpbmcoKSA6OlxuICAgIHJldHVybiBzZW5kX3Bpbmdwb25nKHRoaXMpXG5cblxuICBjbG9uZShwcm9wcywgLi4uZXh0cmEpIDo6XG4gICAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUodGhpcywgcHJvcHMpXG4gICAgcmV0dXJuIDAgPT09IGV4dHJhLmxlbmd0aCA/IHNlbGYgOiBPYmplY3QuYXNzaWduKHNlbGYsIC4uLmV4dHJhKVxuICBiaW5kQ2hhbm5lbChzZW5kUmF3LCBwcm9wcykgOjogcmV0dXJuIGJpbmRDaGFubmVsKHRoaXMsIHNlbmRSYXcsIHByb3BzKVxuICBiaW5kRGlzcGF0Y2hQYWNrZXRzKCkgOjogcmV0dXJuIGJpbmREaXNwYXRjaFBhY2tldHModGhpcylcblxuICB1bmRlbGl2ZXJhYmxlKHBrdCwgbW9kZSkgOjpcbiAgICBjb25zb2xlLndhcm4gQCAndW5kZWxpdmVyYWJsZTonLCBwa3QsIG1vZGVcblxuICBzdGF0aWMgYXNBUEkoaHViLCByb3V0ZXIsIHBhY2tSYXcpIDo6XG4gICAgY29uc3Qgc2VsZiA9IG5ldyB0aGlzKClcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHNlbGYsIEA6XG4gICAgICBwYWNrUmF3OiBAOiB2YWx1ZTogcGFja1Jhd1xuICAgICAgcm91dGVyOiBAOiB2YWx1ZTogcm91dGVyXG4gICAgICBodWI6IEA6IHZhbHVlOiBodWJcbiAgICAgIF9yb290XzogQDogdmFsdWU6IHNlbGZcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0NoYW5uZWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja1BhY2tldFxuICAgIHJldHVybiBzZWxmXG5cbiAgc3RhdGljIGFzSW50ZXJuYWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja1BhY2tldE9ialxuICAgIHJldHVybiBzZWxmLmJpbmRDaGFubmVsIEAgYmluZERpc3BhdGNoSW50ZXJuYWxQYWNrZXQocm91dGVyKVxuXG5leHBvcnQgZGVmYXVsdCBDaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gYmluZENoYW5uZWwoY2hhbm5lbCwgc2VuZFJhdywgcHJvcHMpIDo6XG4gIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBzZW5kUmF3IDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBDaGFubmVsIGV4cGVjdHMgJ3NlbmRSYXcnIGZ1bmN0aW9uIHBhcmFtZXRlcmBcblxuICBjb25zdCBjb3JlX3Byb3BzID0gQDogc2VuZFJhdzogQHt9IHZhbHVlOiBzZW5kUmF3XG4gIHByb3BzID0gbnVsbCA9PSBwcm9wcyA/IGNvcmVfcHJvcHMgOiBPYmplY3QuYXNzaWduIEAgY29yZV9wcm9wcywgcHJvcHNcblxuICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSBAIGNoYW5uZWwsIHByb3BzXG4gIHJldHVybiBzZW5kUmF3LmNoYW5uZWwgPSBzZWxmXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaEludGVybmFsUGFja2V0KHJvdXRlcikgOjpcbiAgY29uc3QgZGlzcGF0Y2ggPSByb3V0ZXIuZGlzcGF0Y2hcbiAgcmV0dXJuIGRpc3BhdGNoX3BrdF9vYmpcblxuICBmdW5jdGlvbiBkaXNwYXRjaF9wa3Rfb2JqKHBrdCkgOjpcbiAgICBpZiB1bmRlZmluZWQgPT09IHBrdC5fcmF3XyA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCBhIHBhcnNlZCBwa3Rfb2JqIHdpdGggdmFsaWQgJ19yYXdfJyBidWZmZXIgcHJvcGVydHlgXG4gICAgZGlzcGF0Y2ggQCBbcGt0XSwgZGlzcGF0Y2hfcGt0X29iai5jaGFubmVsXG4gICAgcmV0dXJuIHRydWVcblxuXG5leHBvcnQgZnVuY3Rpb24gYmluZERpc3BhdGNoUGFja2V0cyhjaGFubmVsKSA6OlxuICBjb25zdCBkaXNwYXRjaCA9IGNoYW5uZWwucm91dGVyLmRpc3BhdGNoXG4gIGNvbnN0IGZlZWQgPSBjaGFubmVsLmh1Yi5wYWNrZXRQYXJzZXIucGFja2V0U3RyZWFtKClcblxuICByZXR1cm4gZnVuY3Rpb24gb25fcmVjdl9kYXRhKGRhdGEpIDo6XG4gICAgY29uc3QgcGt0TGlzdCA9IGZlZWQoZGF0YSlcbiAgICBpZiAwIDwgcGt0TGlzdC5sZW5ndGggOjpcbiAgICAgIGRpc3BhdGNoIEAgcGt0TGlzdCwgY2hhbm5lbFxuIiwiaW1wb3J0IHtSb3V0ZXJ9IGZyb20gJy4vcm91dGVyLmpzeSdcbmltcG9ydCB7Q2hhbm5lbH0gZnJvbSAnLi9jaGFubmVsLmpzeSdcblxuZXhwb3J0IGNsYXNzIEZhYnJpY0h1YiA6OlxuICBjb25zdHJ1Y3RvcigpIDo6XG4gICAgYXBwbHlQbHVnaW5zIEAgJ3ByZScsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuXG4gICAgY29uc3QgcGFja2V0UGFyc2VyID0gdGhpcy5wYWNrZXRQYXJzZXJcbiAgICBpZiBudWxsPT1wYWNrZXRQYXJzZXIgfHwgISBwYWNrZXRQYXJzZXIuaXNQYWNrZXRQYXJzZXIoKSA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBJbnZhbGlkIGh1Yi5wYWNrZXRQYXJzZXJgXG5cbiAgICBjb25zdCByb3V0ZXIgPSB0aGlzLl9pbml0X3JvdXRlcigpXG4gICAgY29uc3QgX2FwaV9jaGFubmVsID0gdGhpcy5faW5pdF9jaGFubmVsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKVxuICAgIGNvbnN0IF9hcGlfaW50ZXJuYWwgPSB0aGlzLl9pbml0X2ludGVybmFsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQHt9XG4gICAgICByb3V0ZXI6IEB7fSB2YWx1ZTogcm91dGVyXG4gICAgICBwYWNrZXRQYXJzZXI6IEB7fSB2YWx1ZTogcGFja2V0UGFyc2VyXG4gICAgICBfYXBpX2NoYW5uZWw6IEB7fSB2YWx1ZTogX2FwaV9jaGFubmVsXG4gICAgICBfYXBpX2ludGVybmFsOiBAe30gdmFsdWU6IF9hcGlfaW50ZXJuYWxcblxuICAgIGFwcGx5UGx1Z2lucyBAIG51bGwsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIGFwcGx5UGx1Z2lucyBAICdwb3N0JywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgcmV0dXJuIHRoaXNcblxuICBfaW5pdF9yb3V0ZXIoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgUGx1Z2luIHJlc3BvbnNpYmxpdHlgXG5cbiAgX2luaXRfY2hhbm5lbEFQSShyb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gQ2hhbm5lbC5hc0NoYW5uZWxBUEkgQFxuICAgICAgdGhpcywgcm91dGVyLCBwYWNrZXRQYXJzZXJcbiAgX2luaXRfaW50ZXJuYWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIENoYW5uZWwuYXNJbnRlcm5hbEFQSSBAXG4gICAgICB0aGlzLCByb3V0ZXIsIHBhY2tldFBhcnNlclxuXG5cbiAgc3RhdGljIHBsdWdpbiguLi5wbHVnaW5GdW5jdGlvbnMpIDo6XG4gICAgcmV0dXJuIHRoaXMucGx1Z2lucyguLi5wbHVnaW5GdW5jdGlvbnMpXG4gIHN0YXRpYyBwbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICBjb25zdCBwbHVnaW5MaXN0ID0gW10uY29uY2F0IEBcbiAgICAgIHRoaXMucHJvdG90eXBlLnBsdWdpbkxpc3QgfHwgW11cbiAgICAgIHBsdWdpbkZ1bmN0aW9uc1xuXG4gICAgcGx1Z2luTGlzdC5zb3J0IEAgKGEsIGIpID0+ICgwIHwgYS5vcmRlcikgLSAoMCB8IGIub3JkZXIpXG5cbiAgICBjb25zdCBCYXNlSHViID0gdGhpcy5fQmFzZUh1Yl8gfHwgdGhpc1xuICAgIGNsYXNzIEZhYnJpY0h1Yl9QSSBleHRlbmRzIEJhc2VIdWIgOjpcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIEZhYnJpY0h1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwbHVnaW5MaXN0OiBAe30gdmFsdWU6IE9iamVjdC5mcmVlemUgQCBwbHVnaW5MaXN0XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBGYWJyaWNIdWJfUEksIEA6XG4gICAgICBfQmFzZUh1Yl86IEB7fSB2YWx1ZTogQmFzZUh1YlxuXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3N1YmNsYXNzJywgcGx1Z2luTGlzdCwgRmFicmljSHViX1BJLCBAOiBSb3V0ZXIsIENoYW5uZWxcbiAgICByZXR1cm4gRmFicmljSHViX1BJXG5cblxuICBnZXQgaWRfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMucm91dGVyLmlkX3NlbGZcbiAgaWRfcm91dGVyX3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLnBhY2tldFBhcnNlci5wYWNrSWQgQFxuICAgICAgdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBjb25uZWN0X3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLl9hcGlfaW50ZXJuYWwuY2xvbmUoKVxuXG4gIGNvbm5lY3QoY29ubl91cmwpIDo6XG4gICAgaWYgbnVsbCA9PSBjb25uX3VybCA6OlxuICAgICAgcmV0dXJuIHRoaXMuY29ubmVjdF9zZWxmKClcblxuICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgY29ubl91cmwgOjpcbiAgICAgIGNvbm5fdXJsID0gdGhpcy5fcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKVxuXG4gICAgY29uc3QgY29ubmVjdCA9IHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sW2Nvbm5fdXJsLnByb3RvY29sXVxuICAgIGlmICEgY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYENvbm5lY3Rpb24gcHJvdG9jb2wgXCIke2Nvbm5fdXJsLnByb3RvY29sfVwiIG5vdCByZWdpc3RlcmVkIGZvciBcIiR7Y29ubl91cmwudG9TdHJpbmcoKX1cImBcblxuICAgIHJldHVybiBjb25uZWN0KGNvbm5fdXJsKVxuXG4gIHJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sKHByb3RvY29sLCBjYl9jb25uZWN0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYl9jb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdjYl9jb25uZWN0JyBmdW5jdGlvbmBcbiAgICBjb25zdCBieVByb3RvY29sID0gT2JqZWN0LmFzc2lnbiBAIHt9LCB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFxuICAgIGJ5UHJvdG9jb2xbcHJvdG9jb2xdID0gY2JfY29ubmVjdFxuICAgIHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydHkgQCB0aGlzLCAnX2Nvbm5lY3RCeVByb3RvY29sJyxcbiAgICAgIEA6IHZhbHVlOiBieVByb3RvY29sLCBjb25maWd1cmFibGU6IHRydWVcblxuICBfcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKSA6OlxuICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG5leHBvcnQgZGVmYXVsdCBGYWJyaWNIdWJcblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGx1Z2lucyhrZXksIHBsdWdpbkxpc3QsIC4uLmFyZ3MpIDo6XG4gIGlmICEga2V5IDo6IGtleSA9IG51bGxcbiAgZm9yIGxldCBwbHVnaW4gb2YgcGx1Z2luTGlzdCA6OlxuICAgIGlmIG51bGwgIT09IGtleSA6OiBwbHVnaW4gPSBwbHVnaW5ba2V5XVxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBwbHVnaW4gOjpcbiAgICAgIHBsdWdpbiguLi5hcmdzKVxuIl0sIm5hbWVzIjpbImRpc3BDb250cm9sQnlUeXBlIiwicmVjdl9oZWxsbyIsInJlY3Zfb2xsZWgiLCJyZWN2X3BvbmciLCJyZWN2X3BpbmciLCJzZW5kX2hlbGxvIiwiY2hhbm5lbCIsImVjX3B1Yl9pZCIsInJvdXRlciIsInBhY2tBbmRTZW5kUmF3IiwidHlwZSIsImh1YiIsImlkX3JvdXRlcl9zZWxmIiwicGt0IiwiZWNfb3RoZXJfaWQiLCJoZWFkZXJfYnVmZmVyIiwibGVuZ3RoIiwiZWNfaWRfaG1hYyIsImhtYWNfc2VjcmV0IiwiaWRfcm91dGVyIiwidW5wYWNrSWQiLCJib2R5X2J1ZmZlciIsInVudmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX29sbGVoIiwicGVlcl9obWFjX2NsYWltIiwiY29tcGFyZSIsInZlcmlmaWVkUGVlclJvdXRlIiwic2VuZF9waW5ncG9uZyIsInBvbmciLCJEYXRlIiwidG9JU09TdHJpbmciLCJsb2NhbCIsInJlbW90ZSIsInRvU3RyaW5nIiwiZGVsdGEiLCJ0c19wb25nIiwiZXJyIiwidHNfcGluZyIsImZpcnN0QW5zd2VyIiwiYmluZFByb21pc2VGaXJzdFJlc3VsdCIsIlJvdXRlciIsImlkX3NlbGYiLCJyb3V0ZURpc2NvdmVyeSIsInRhcmdldERpc2NvdmVyeSIsInRhcmdldHMiLCJfY3JlYXRlVGFyZ2V0c01hcCIsIk9iamVjdCIsImNyZWF0ZSIsImRlZmluZVByb3BlcnRpZXMiLCJ2YWx1ZSIsIl9pbml0RGlzcGF0Y2giLCJyb3V0ZXMiLCJfY3JlYXRlUm91dGVzTWFwIiwic2V0IiwiYmluZERpc3BhdGNoQ29udHJvbCIsImJpbmREaXNwYXRjaFNlbGYiLCJiaW5kRGlzcGF0Y2hSb3V0ZXMiLCJlcnJvciIsIk1hcCIsImRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlIiwiZGlzcGF0Y2hfcm91dGUiLCJyZWdpc3RlclJvdXRlIiwicHF1ZXVlIiwicHJvbWlzZVF1ZXVlIiwiZGlzcGF0Y2giLCJwa3RMaXN0IiwicHEiLCJtYXAiLCJ0aGVuIiwiZGlzcGF0Y2hfb25lIiwiZ2V0IiwidW5kZWZpbmVkIiwidW5kZWxpdmVyYWJsZSIsInVucmVnaXN0ZXJSb3V0ZSIsIm9uX2Vycm9yX2luX2Rpc3BhdGNoIiwicmVzb2x2ZVJvdXRlIiwiVHlwZUVycm9yIiwiaGFzIiwiZGVsZXRlIiwidHRsIiwic2VuZFJhdyIsInJlZ2lzdGVyUGVlclJvdXRlIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwiY29uc29sZSIsIndhcm4iLCJpZF90YXJnZXQiLCJkaXNwYXRjaFNlbGYiLCJ0YXJnZXQiLCJkaXNwYXRjaF9kaXNjb3Zlcl90YXJnZXQiLCJ1bnJlZ2lzdGVyVGFyZ2V0IiwiaWQiLCJOdW1iZXIiLCJpc1NhZmVJbnRlZ2VyIiwiaGFuZGxlciIsImRudV9kaXNwYXRjaF9jb250cm9sIiwicHJvdG90eXBlIiwiYXNzaWduIiwidGlwIiwiUHJvbWlzZSIsInJlc29sdmUiLCJjbGVhcl90aXAiLCJvcHRpb25zIiwib25fZXJyb3IiLCJpZkFic2VudCIsImFic2VudCIsImxzdEZucyIsImFsbCIsIkFycmF5IiwiZnJvbSIsImZuIiwiQ2hhbm5lbCIsIkVycm9yIiwiYXJncyIsInBhY2tSYXciLCJwa3Rfb2JqIiwicGFja0pTT04iLCJoZWFkZXIiLCJKU09OIiwic3RyaW5naWZ5IiwiYm9keSIsInByb3BzIiwiZXh0cmEiLCJzZWxmIiwiYmluZENoYW5uZWwiLCJiaW5kRGlzcGF0Y2hQYWNrZXRzIiwibW9kZSIsImFzQVBJIiwiYXNDaGFubmVsQVBJIiwicGFja2V0UGFyc2VyIiwicGFja1BhY2tldCIsImFzSW50ZXJuYWxBUEkiLCJwYWNrUGFja2V0T2JqIiwiYmluZERpc3BhdGNoSW50ZXJuYWxQYWNrZXQiLCJjb3JlX3Byb3BzIiwiZGlzcGF0Y2hfcGt0X29iaiIsIl9yYXdfIiwiZmVlZCIsInBhY2tldFN0cmVhbSIsIm9uX3JlY3ZfZGF0YSIsImRhdGEiLCJGYWJyaWNIdWIiLCJwbHVnaW5MaXN0IiwiaXNQYWNrZXRQYXJzZXIiLCJfaW5pdF9yb3V0ZXIiLCJfYXBpX2NoYW5uZWwiLCJfaW5pdF9jaGFubmVsQVBJIiwiX2FwaV9pbnRlcm5hbCIsIl9pbml0X2ludGVybmFsQVBJIiwicGx1Z2luIiwicGx1Z2luRnVuY3Rpb25zIiwicGx1Z2lucyIsImNvbmNhdCIsInNvcnQiLCJhIiwiYiIsIm9yZGVyIiwiQmFzZUh1YiIsIl9CYXNlSHViXyIsIkZhYnJpY0h1Yl9QSSIsImZyZWV6ZSIsInBhY2tJZCIsImNsb25lIiwiY29ubl91cmwiLCJjb25uZWN0X3NlbGYiLCJfcGFyc2VDb25uZWN0VVJMIiwiY29ubmVjdCIsIl9jb25uZWN0QnlQcm90b2NvbCIsInByb3RvY29sIiwiY2JfY29ubmVjdCIsImJ5UHJvdG9jb2wiLCJkZWZpbmVQcm9wZXJ0eSIsImNvbmZpZ3VyYWJsZSIsIlVSTCIsImFwcGx5UGx1Z2lucyIsImtleSJdLCJtYXBwaW5ncyI6IkFBQU8sTUFBTUEsb0JBQW9CO0dBQzlCLElBQUQsR0FBUUMsVUFEdUI7R0FFOUIsSUFBRCxHQUFRQyxVQUZ1QjtHQUc5QixJQUFELEdBQVFDLFNBSHVCO0dBSTlCLElBQUQsR0FBUUMsU0FKdUIsRUFBMUI7O0FBUVAsQUFBTyxTQUFTQyxVQUFULENBQW9CQyxPQUFwQixFQUE2QjtRQUM1QixFQUFDQyxTQUFELEtBQWNELFFBQVFFLE1BQTVCO1NBQ09GLFFBQVFHLGNBQVIsQ0FBeUI7ZUFDbkIsQ0FEbUIsRUFDaEJDLE1BQU0sSUFEVTtZQUV0QkgsU0FGc0I7VUFHeEJELFFBQVFLLEdBQVIsQ0FBWUMsY0FBWixFQUh3QixFQUF6QixDQUFQOzs7QUFLRixTQUFTWCxVQUFULENBQW9CTyxNQUFwQixFQUE0QkssR0FBNUIsRUFBaUNQLE9BQWpDLEVBQTBDO1FBQ2xDUSxjQUFjRCxJQUFJRSxhQUFKLEVBQXBCO01BQ0csTUFBTUQsWUFBWUUsTUFBbEIsSUFBNEJSLE9BQU9TLFVBQXRDLEVBQW1EO1VBQzNDQyxjQUFjVixPQUFPUyxVQUFQLEdBQ2hCVCxPQUFPUyxVQUFQLENBQWtCSCxXQUFsQixDQURnQixHQUNpQixJQURyQztlQUVhUixPQUFiLEVBQXNCWSxXQUF0QjtHQUhGLE1BS0s7VUFDR0MsWUFBWU4sSUFBSU8sUUFBSixDQUFhUCxJQUFJUSxXQUFKLEVBQWIsRUFBZ0MsQ0FBaEMsQ0FBbEI7V0FDT0MsbUJBQVAsQ0FBNkJILFNBQTdCLEVB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
