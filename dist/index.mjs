const dispControlByType = {
  [0xf0]: recv_hello,
  [0xf1]: recv_olleh,
  [0xfe]: recv_pong,
  [0xff]: recv_ping };

function send_hello(channel) {
  const { ec_pub_id } = channel.hub.router;
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
  const { ec_pub_id } = channel.hub.router;
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

class Router {
  constructor(id_self) {
    this.routeDiscovery = [];
    this.targetDiscovery = [];
    this.targets = this._createTargetsMap();
    this.dispControlByType = Object.create(this.dispControlByType);

    if (id_self) {
      Object.defineProperties(this, { id_self: { value: id_self } });
    }
  }

  // --- Dispatch core ---

  initDispatch() {
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
    const dispatch_route = await this._firstRoute(id_router, this.routeDiscovery);
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
            return channel && channel.undeliverable(pkt, 'route');
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

  discoverTarget(query) {
    return this._firstTarget(query, this.targetDiscovery);
  }

  bindDispatchSelf() {
    const dispatchSelf = async (pkt, channel) => {
      const id_target = pkt.id_target;
      let target = this.targets.get(id_target);
      if (undefined === target) {
        return channel && channel.undeliverable(pkt, 'target');
      }

      if (false === (await target(pkt, this))) {
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

Object.assign(Router.prototype, {
  dispControlByType: Object.assign({}, dispControlByType),

  bindPromiseFirstResult,
  _firstRoute: bindPromiseFirstResult(),
  _firstTarget: bindPromiseFirstResult() });

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

function is_defined(e) {
  return undefined !== e;
}
function bindPromiseFirstResult(options = {}) {
  const test = options.test || is_defined;
  const on_error = options.on_error || console.error;
  const ifAbsent = options.absent || null;

  return (tip, lstFns) => new Promise(resolve => {
    const resolveIf = e => test(e) ? resolve(e) : e;
    tip = Promise.resolve(tip);
    Promise.all(Array.from(lstFns, fn => tip.then(fn).then(resolveIf, on_error))).then(absent, absent);

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
    return send_hello(this, this.hub.router.ec_pub_id);
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
    const rtr = pkt.id_router !== this.hub.router.id_self ? pkt.id_router : 'self';
    console.warn(`Undeliverable[${mode}]: ${pkt.id_target} of ${rtr}`);
  }

  static asAPI(hub, packRaw) {
    const self = new this();
    Object.defineProperties(self, {
      packRaw: { value: packRaw },
      hub: { value: hub },
      _root_: { value: self } });
    return self;
  }

  static asChannelAPI(hub, packetParser) {
    return this.asAPI(hub, packetParser.packPacket);
  }

  static asInternalAPI(hub, packetParser) {
    const self = this.asAPI(hub, packetParser.packPacketObj);
    self.bindInternalChannel = dispatch => bindInternalChannel(self, dispatch);
    return self;
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

function bindInternalChannel(channel, dispatch) {
  dispatch_pkt_obj.channel = channel;
  return Object.defineProperties(channel, {
    sendRaw: { value: dispatch_pkt_obj },
    bindChannel: { value: null } });

  function dispatch_pkt_obj(pkt) {
    if (undefined === pkt._raw_) {
      throw new TypeError(`Expected a parsed pkt_obj with valid '_raw_' buffer property`);
    }
    dispatch([pkt], channel);
    return true;
  }
}

function bindDispatchPackets(channel) {
  const dispatch = channel.hub.router.dispatch;
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
	bindInternalChannel: bindInternalChannel,
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
    const _api_channel = this._init_channelAPI(packetParser);
    const _api_internal = this._init_internalAPI(packetParser);
    router.initDispatch();
    _api_internal.bindInternalChannel(router.dispatch);

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

  _init_channelAPI(packetParser) {
    return Channel.asChannelAPI(this, packetParser);
  }
  _init_internalAPI(packetParser) {
    return Channel.asInternalAPI(this, packetParser);
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

  valueOf() {
    return this.router.id_self;
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
  bindRouteDispatch(channel, cache) {
    if (null == channel) {
      channel = this.connect_self();
    }

    const resolveRoute = id_router => {
      let route,
          disco = this.router.resolveRoute(id_router);
      return async pkt => {
        if (undefined === route) {
          route = disco = await disco;
        }
        return route(pkt, channel);
      };
    };

    return cache ? cacheResolveRoute : resolveRoute;

    function cacheResolveRoute(id_router) {
      let chan = cache.get(id_router);
      if (undefined === chan) {
        chan = resolveRoute(id_router);
        cache.set(id_router, chan);
      }
      return chan;
    }
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

export { channel, control_protocol, FabricHub$1 as FabricHub, applyPlugins, Router, promiseQueue, bindPromiseFirstResult };
export default FabricHub$1;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgubWpzIiwic291cmNlcyI6WyIuLi9jb2RlL2NvbnRyb2xfcHJvdG9jb2wuanN5IiwiLi4vY29kZS9yb3V0ZXIuanN5IiwiLi4vY29kZS9jaGFubmVsLmpzeSIsIi4uL2NvZGUvaHViLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY29uc3QgZGlzcENvbnRyb2xCeVR5cGUgPSBAe31cbiAgWzB4ZjBdOiByZWN2X2hlbGxvXG4gIFsweGYxXTogcmVjdl9vbGxlaFxuICBbMHhmZV06IHJlY3ZfcG9uZ1xuICBbMHhmZl06IHJlY3ZfcGluZ1xuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfaGVsbG8oY2hhbm5lbCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLmh1Yi5yb3V0ZXJcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IDB4ZjBcbiAgICBoZWFkZXI6IGVjX3B1Yl9pZFxuICAgIGJvZHk6IGNoYW5uZWwuaHViLmlkX3JvdXRlcl9zZWxmKClcblxuZnVuY3Rpb24gcmVjdl9oZWxsbyhyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgZWNfb3RoZXJfaWQgPSBwa3QuaGVhZGVyX2J1ZmZlcigpXG4gIGlmIDAgIT09IGVjX290aGVyX2lkLmxlbmd0aCAmJiByb3V0ZXIuZWNfaWRfaG1hYyA6OlxuICAgIGNvbnN0IGhtYWNfc2VjcmV0ID0gcm91dGVyLmVjX2lkX2htYWNcbiAgICAgID8gcm91dGVyLmVjX2lkX2htYWMoZWNfb3RoZXJfaWQpIDogbnVsbFxuICAgIHNlbmRfb2xsZWggQCBjaGFubmVsLCBobWFjX3NlY3JldFxuXG4gIGVsc2UgOjpcbiAgICBjb25zdCBpZF9yb3V0ZXIgPSBwa3QudW5wYWNrSWQocGt0LmJvZHlfYnVmZmVyKCksIDApXG4gICAgcm91dGVyLnVudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG5mdW5jdGlvbiBzZW5kX29sbGVoKGNoYW5uZWwsIGhtYWNfc2VjcmV0KSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwuaHViLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMVxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogaG1hY19zZWNyZXRcblxuZnVuY3Rpb24gcmVjdl9vbGxlaChyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgZWNfb3RoZXJfaWQgPSBwa3QuaGVhZGVyX2J1ZmZlcigpXG4gIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChlY19vdGhlcl9pZClcblxuICBjb25zdCBobWFjX3NlY3JldCA9IHJvdXRlci5lY19pZF9obWFjXG4gICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCwgdHJ1ZSkgOiBudWxsXG4gIGNvbnN0IHBlZXJfaG1hY19jbGFpbSA9IHBrdC5ib2R5X2J1ZmZlcigpXG4gIGlmIGhtYWNfc2VjcmV0ICYmIDAgPT09IGhtYWNfc2VjcmV0LmNvbXBhcmUgQCBwZWVyX2htYWNfY2xhaW0gOjpcbiAgICByb3V0ZXIudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcbiAgZWxzZSA6OlxuICAgIHJvdXRlci51bnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9waW5ncG9uZyhjaGFubmVsLCBwb25nKSA6OlxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogcG9uZyA/IDB4ZmUgOiAweGZmXG4gICAgYm9keTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbmZ1bmN0aW9uIHJlY3ZfcG9uZyhyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgdHJ5IDo6XG4gICAgY29uc3QgcmVtb3RlID0gbmV3IERhdGUgQCBwa3QuYm9keV9idWZmZXIoKS50b1N0cmluZygpXG4gICAgY29uc3QgZGVsdGEgPSByZW1vdGUgLSBsb2NhbFxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBkZWx0YSwgcmVtb3RlLCBsb2NhbFxuICBjYXRjaCBlcnIgOjpcbiAgICBjaGFubmVsLnRzX3BvbmcgPSBAe30gbG9jYWxcblxuZnVuY3Rpb24gcmVjdl9waW5nKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICBzZW5kX3Bpbmdwb25nIEAgY2hhbm5lbCwgdHJ1ZVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgcGt0LmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGxvY2FsXG5cbiIsImltcG9ydCB7ZGlzcENvbnRyb2xCeVR5cGV9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cbmV4cG9ydCBjbGFzcyBSb3V0ZXIgOjpcbiAgY29uc3RydWN0b3IoaWRfc2VsZikgOjpcbiAgICBpZiBpZF9zZWxmIDo6XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEA6IGlkX3NlbGY6IEA6IHZhbHVlOiBpZF9zZWxmXG5cbiAgLy8gLS0tIERpc3BhdGNoIGNvcmUgLS0tXG5cbiAgaW5pdERpc3BhdGNoKCkgOjpcbiAgICBjb25zdCByb3V0ZXMgPSB0aGlzLl9jcmVhdGVSb3V0ZXNNYXAoKVxuICAgIHJvdXRlcy5zZXQgQCAwLCB0aGlzLmJpbmREaXNwYXRjaENvbnRyb2woKVxuICAgIGlmIG51bGwgIT0gdGhpcy5pZF9zZWxmIDo6XG4gICAgICByb3V0ZXMuc2V0IEAgdGhpcy5pZF9zZWxmLCB0aGlzLmJpbmREaXNwYXRjaFNlbGYoKVxuXG4gICAgdGhpcy5iaW5kRGlzcGF0Y2hSb3V0ZXMocm91dGVzKVxuXG4gIG9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgcGt0KSA6OlxuICAgIGNvbnNvbGUuZXJyb3IgQCAnRXJyb3IgZHVyaW5nIHBhY2tldCBkaXNwYXRjaFxcbiAgcGt0OicsIHBrdCwgJ1xcbicsIGVyciwgJ1xcbidcblxuICBfY3JlYXRlUm91dGVzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byByb3V0ZSAtLS1cblxuICByb3V0ZURpc2NvdmVyeSA9IFtdXG4gIGFzeW5jIGRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlcikgOjpcbiAgICBjb25zdCBkaXNwYXRjaF9yb3V0ZSA9IGF3YWl0IHRoaXMuX2ZpcnN0Um91dGUgQCBpZF9yb3V0ZXIsIHRoaXMucm91dGVEaXNjb3ZlcnlcbiAgICBpZiBudWxsID09IGRpc3BhdGNoX3JvdXRlIDo6IHJldHVyblxuICAgIHRoaXMucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlKVxuICAgIHJldHVybiBkaXNwYXRjaF9yb3V0ZVxuXG4gIGJpbmREaXNwYXRjaFJvdXRlcyhyb3V0ZXMpIDo6XG4gICAgY29uc3QgcHF1ZXVlID0gcHJvbWlzZVF1ZXVlKClcbiAgICBmdW5jdGlvbiBkaXNwYXRjaChwa3RMaXN0LCBjaGFubmVsKSA6OlxuICAgICAgY29uc3QgcHEgPSBwcXVldWUoKSAvLyBwcSB3aWxsIGRpc3BhdGNoIGR1cmluZyBQcm9taXNlIHJlc29sdXRpb25zXG4gICAgICByZXR1cm4gcGt0TGlzdC5tYXAgQCBwa3QgPT5cbiAgICAgICAgcHEudGhlbiBAICgpID0+IGRpc3BhdGNoX29uZShwa3QsIGNoYW5uZWwpXG5cbiAgICBjb25zdCBkaXNwYXRjaF9vbmUgPSBhc3luYyAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgdHJ5IDo6XG4gICAgICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC5pZF9yb3V0ZXJcbiAgICAgICAgbGV0IGRpc3BhdGNoX3JvdXRlID0gcm91dGVzLmdldChpZF9yb3V0ZXIpXG4gICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgICBkaXNwYXRjaF9yb3V0ZSA9IGF3YWl0IHRoaXMuZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyKVxuICAgICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgICAgIHJldHVybiBjaGFubmVsICYmIGNoYW5uZWwudW5kZWxpdmVyYWJsZShwa3QsICdyb3V0ZScpXG5cbiAgICAgICAgaWYgZmFsc2UgPT09IGF3YWl0IGRpc3BhdGNoX3JvdXRlKHBrdCwgY2hhbm5lbCkgOjpcbiAgICAgICAgICB0aGlzLnVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpXG4gICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgdGhpcy5vbl9lcnJvcl9pbl9kaXNwYXRjaChlcnIsIHBrdCwgY2hhbm5lbClcblxuICAgIGNvbnN0IHJlc29sdmVSb3V0ZSA9IGlkX3JvdXRlciA9PlxuICAgICAgcm91dGVzLmdldChpZF9yb3V0ZXIpIHx8XG4gICAgICAgIHRoaXMuZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyKVxuXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOlxuICAgICAgcm91dGVzOiBAOiB2YWx1ZTogcm91dGVzXG4gICAgICBkaXNwYXRjaDogQDogdmFsdWU6IGRpc3BhdGNoXG4gICAgICByZXNvbHZlUm91dGU6IEA6IHZhbHVlOiByZXNvbHZlUm91dGVcbiAgICByZXR1cm4gZGlzcGF0Y2hcblxuICByZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICBpZiBudWxsICE9IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2Rpc3BhdGNoX3JvdXRlJyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgICAgZWxzZSByZXR1cm4gZmFsc2VcbiAgICBpZiB0aGlzLnJvdXRlcy5oYXMgQCBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgMCA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMuaWRfc2VsZiA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuXG4gICAgdGhpcy5yb3V0ZXMuc2V0IEAgaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZVxuICAgIHJldHVybiB0cnVlXG4gIHVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpIDo6XG4gICAgcmV0dXJuIHRoaXMucm91dGVzLmRlbGV0ZSBAIGlkX3JvdXRlclxuICByZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJSb3V0ZSBAIGlkX3JvdXRlciwgcGt0ID0+IDo6XG4gICAgICBpZiAwICE9PSBwa3QudHRsIDo6IGNoYW5uZWwuc2VuZFJhdyhwa3QpXG4gIHZlcmlmaWVkUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gIHVudmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIGlmIHRoaXMuYWxsb3dVbnZlcmlmaWVkUm91dGVzIHx8IGNoYW5uZWwuYWxsb3dVbnZlcmlmaWVkUm91dGVzIDo6XG4gICAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gICAgZWxzZSBjb25zb2xlLndhcm4gQCAnVW52ZXJpZmllZCBwZWVyIHJvdXRlIChpZ25vcmVkKTonLCBAOiBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byBsb2NhbCB0YXJnZXRcblxuICB0YXJnZXREaXNjb3ZlcnkgPSBbXVxuICBkaXNjb3ZlclRhcmdldChxdWVyeSkgOjpcbiAgICByZXR1cm4gdGhpcy5fZmlyc3RUYXJnZXQgQCBxdWVyeSwgdGhpcy50YXJnZXREaXNjb3ZlcnlcblxuICBiaW5kRGlzcGF0Y2hTZWxmKCkgOjpcbiAgICBjb25zdCBkaXNwYXRjaFNlbGYgPSBhc3luYyAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgY29uc3QgaWRfdGFyZ2V0ID0gcGt0LmlkX3RhcmdldFxuICAgICAgbGV0IHRhcmdldCA9IHRoaXMudGFyZ2V0cy5nZXQoaWRfdGFyZ2V0KVxuICAgICAgaWYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgICAgcmV0dXJuIGNoYW5uZWwgJiYgY2hhbm5lbC51bmRlbGl2ZXJhYmxlKHBrdCwgJ3RhcmdldCcpXG5cbiAgICAgIGlmIGZhbHNlID09PSBhd2FpdCB0YXJnZXQocGt0LCB0aGlzKSA6OlxuICAgICAgICB0aGlzLnVucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0KVxuXG4gICAgdGhpcy5kaXNwYXRjaFNlbGYgPSBkaXNwYXRjaFNlbGZcbiAgICByZXR1cm4gZGlzcGF0Y2hTZWxmXG5cbiAgX2NyZWF0ZVRhcmdldHNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG4gIHRhcmdldHMgPSB0aGlzLl9jcmVhdGVUYXJnZXRzTWFwKClcbiAgcmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0LCB0YXJnZXQpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGlkX3RhcmdldCAmJiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgdGFyZ2V0ID0gaWRfdGFyZ2V0XG4gICAgICBpZF90YXJnZXQgPSB0YXJnZXQuaWRfdGFyZ2V0IHx8IHRhcmdldC5pZFxuXG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHRhcmdldCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAndGFyZ2V0JyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgIGlmICEgTnVtYmVyLmlzU2FmZUludGVnZXIgQCBpZF90YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2lkX3RhcmdldCcgdG8gYmUgYW4gaW50ZWdlcmBcbiAgICBpZiB0aGlzLnRhcmdldHMuaGFzIEAgaWRfdGFyZ2V0IDo6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLnNldCBAIGlkX3RhcmdldCwgdGFyZ2V0XG4gIHVucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0KSA6OlxuICAgIHJldHVybiB0aGlzLnRhcmdldHMuZGVsZXRlIEAgaWRfdGFyZ2V0XG5cblxuXG4gIC8vIC0tLSBEaXNwYXRjaCBjb250cm9sIHBhY2tldHNcblxuICBiaW5kRGlzcGF0Y2hDb250cm9sKCkgOjpcbiAgICByZXR1cm4gKHBrdCwgY2hhbm5lbCkgPT4gOjpcbiAgICAgIGlmIDAgIT09IHBrdC5pZF90YXJnZXQgOjogLy8gY29ubmVjdGlvbi1kaXNwYXRjaGVkXG4gICAgICAgIHJldHVybiB0aGlzLmRpc3BhdGNoU2VsZihwa3QsIGNoYW5uZWwpXG5cbiAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLmRpc3BDb250cm9sQnlUeXBlW3BrdC50eXBlXVxuICAgICAgaWYgdW5kZWZpbmVkICE9PSBoYW5kbGVyIDo6XG4gICAgICAgIHJldHVybiBoYW5kbGVyKHRoaXMsIHBrdCwgY2hhbm5lbClcbiAgICAgIGVsc2UgOjpcbiAgICAgICAgcmV0dXJuIHRoaXMuZG51X2Rpc3BhdGNoX2NvbnRyb2wocGt0LCBjaGFubmVsKVxuXG4gIGRpc3BDb250cm9sQnlUeXBlID0gT2JqZWN0LmNyZWF0ZSBAIHRoaXMuZGlzcENvbnRyb2xCeVR5cGVcbiAgZG51X2Rpc3BhdGNoX2NvbnRyb2wocGt0LCBjaGFubmVsKSA6OlxuICAgIGNvbnNvbGUud2FybiBAICdkbnVfZGlzcGF0Y2hfY29udHJvbCcsIHBrdC50eXBlLCBwa3RcblxuXG5PYmplY3QuYXNzaWduIEAgUm91dGVyLnByb3RvdHlwZSwgQHt9XG4gIGRpc3BDb250cm9sQnlUeXBlOiBPYmplY3QuYXNzaWduIEAge31cbiAgICBkaXNwQ29udHJvbEJ5VHlwZVxuXG4gIGJpbmRQcm9taXNlRmlyc3RSZXN1bHRcbiAgX2ZpcnN0Um91dGU6IGJpbmRQcm9taXNlRmlyc3RSZXN1bHQoKVxuICBfZmlyc3RUYXJnZXQ6IGJpbmRQcm9taXNlRmlyc3RSZXN1bHQoKVxuXG5leHBvcnQgZGVmYXVsdCBSb3V0ZXJcblxuXG5leHBvcnQgZnVuY3Rpb24gcHJvbWlzZVF1ZXVlKCkgOjpcbiAgbGV0IHRpcCA9IG51bGxcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIDo6XG4gICAgaWYgbnVsbCA9PT0gdGlwIDo6XG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgdGlwLnRoZW4gQCBjbGVhcl90aXBcbiAgICByZXR1cm4gdGlwXG5cbiAgZnVuY3Rpb24gY2xlYXJfdGlwKCkgOjpcbiAgICB0aXAgPSBudWxsXG5cbmZ1bmN0aW9uIGlzX2RlZmluZWQoZSkgOjogcmV0dXJuIHVuZGVmaW5lZCAhPT0gZVxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRQcm9taXNlRmlyc3RSZXN1bHQob3B0aW9ucz17fSkgOjpcbiAgY29uc3QgdGVzdCA9IG9wdGlvbnMudGVzdCB8fCBpc19kZWZpbmVkXG4gIGNvbnN0IG9uX2Vycm9yID0gb3B0aW9ucy5vbl9lcnJvciB8fCBjb25zb2xlLmVycm9yXG4gIGNvbnN0IGlmQWJzZW50ID0gb3B0aW9ucy5hYnNlbnQgfHwgbnVsbFxuXG4gIHJldHVybiAodGlwLCBsc3RGbnMpID0+XG4gICAgbmV3IFByb21pc2UgQCByZXNvbHZlID0+IDo6XG4gICAgICBjb25zdCByZXNvbHZlSWYgPSBlID0+IHRlc3QoZSkgPyByZXNvbHZlKGUpIDogZVxuICAgICAgdGlwID0gUHJvbWlzZS5yZXNvbHZlKHRpcClcbiAgICAgIFByb21pc2UuYWxsIEBcbiAgICAgICAgQXJyYXkuZnJvbSBAIGxzdEZucywgZm4gPT5cbiAgICAgICAgICB0aXAudGhlbihmbikudGhlbihyZXNvbHZlSWYsIG9uX2Vycm9yKVxuICAgICAgLnRoZW4gQCBhYnNlbnQsIGFic2VudFxuXG4gICAgICBmdW5jdGlvbiBhYnNlbnQoKSA6OlxuICAgICAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaWZBYnNlbnQgOjpcbiAgICAgICAgICByZXNvbHZlIEAgaWZBYnNlbnQoKVxuICAgICAgICBlbHNlIHJlc29sdmUgQCBpZkFic2VudFxuIiwiaW1wb3J0IHtzZW5kX2hlbGxvLCBzZW5kX3Bpbmdwb25nfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5cbmV4cG9ydCBjbGFzcyBDaGFubmVsIDo6XG4gIHNlbmRSYXcoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgSW5zdGFuY2UgcmVzcG9uc2libGl0eWBcbiAgcGFja1JhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuXG4gIHBhY2tBbmRTZW5kUmF3KC4uLmFyZ3MpIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja1JhdyBAIC4uLmFyZ3NcblxuICBzZW5kSlNPTihwa3Rfb2JqKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tKU09OIEAgcGt0X29ialxuICBwYWNrSlNPTihwa3Rfb2JqKSA6OlxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcGt0X29iai5oZWFkZXIgOjpcbiAgICAgIHBrdF9vYmouaGVhZGVyID0gSlNPTi5zdHJpbmdpZnkgQCBwa3Rfb2JqLmhlYWRlclxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcGt0X29iai5ib2R5IDo6XG4gICAgICBwa3Rfb2JqLmJvZHkgPSBKU09OLnN0cmluZ2lmeSBAIHBrdF9vYmouYm9keVxuICAgIHJldHVybiB0aGlzLnBhY2tSYXcocGt0X29iailcblxuXG4gIC8vIC0tLSBDb250cm9sIG1lc3NhZ2UgdXRpbGl0aWVzXG5cbiAgc2VuZFJvdXRpbmdIYW5kc2hha2UoKSA6OlxuICAgIHJldHVybiBzZW5kX2hlbGxvKHRoaXMsIHRoaXMuaHViLnJvdXRlci5lY19wdWJfaWQpXG4gIHNlbmRQaW5nKCkgOjpcbiAgICByZXR1cm4gc2VuZF9waW5ncG9uZyh0aGlzKVxuXG5cbiAgY2xvbmUocHJvcHMsIC4uLmV4dHJhKSA6OlxuICAgIGNvbnN0IHNlbGYgPSBPYmplY3QuY3JlYXRlKHRoaXMsIHByb3BzKVxuICAgIHJldHVybiAwID09PSBleHRyYS5sZW5ndGggPyBzZWxmIDogT2JqZWN0LmFzc2lnbihzZWxmLCAuLi5leHRyYSlcbiAgYmluZENoYW5uZWwoc2VuZFJhdywgcHJvcHMpIDo6IHJldHVybiBiaW5kQ2hhbm5lbCh0aGlzLCBzZW5kUmF3LCBwcm9wcylcbiAgYmluZERpc3BhdGNoUGFja2V0cygpIDo6IHJldHVybiBiaW5kRGlzcGF0Y2hQYWNrZXRzKHRoaXMpXG5cbiAgdW5kZWxpdmVyYWJsZShwa3QsIG1vZGUpIDo6XG4gICAgY29uc3QgcnRyID0gcGt0LmlkX3JvdXRlciAhPT0gdGhpcy5odWIucm91dGVyLmlkX3NlbGYgPyBwa3QuaWRfcm91dGVyIDogJ3NlbGYnXG4gICAgY29uc29sZS53YXJuIEAgYFVuZGVsaXZlcmFibGVbJHttb2RlfV06ICR7cGt0LmlkX3RhcmdldH0gb2YgJHtydHJ9YFxuXG4gIHN0YXRpYyBhc0FQSShodWIsIHBhY2tSYXcpIDo6XG4gICAgY29uc3Qgc2VsZiA9IG5ldyB0aGlzKClcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHNlbGYsIEA6XG4gICAgICBwYWNrUmF3OiBAOiB2YWx1ZTogcGFja1Jhd1xuICAgICAgaHViOiBAOiB2YWx1ZTogaHViXG4gICAgICBfcm9vdF86IEA6IHZhbHVlOiBzZWxmXG4gICAgcmV0dXJuIHNlbGZcblxuICBzdGF0aWMgYXNDaGFubmVsQVBJKGh1YiwgcGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiB0aGlzLmFzQVBJIEAgaHViLCBwYWNrZXRQYXJzZXIucGFja1BhY2tldFxuXG4gIHN0YXRpYyBhc0ludGVybmFsQVBJKGh1YiwgcGFja2V0UGFyc2VyKSA6OlxuICAgIGNvbnN0IHNlbGYgPSB0aGlzLmFzQVBJIEAgaHViLCBwYWNrZXRQYXJzZXIucGFja1BhY2tldE9ialxuICAgIHNlbGYuYmluZEludGVybmFsQ2hhbm5lbCA9IGRpc3BhdGNoID0+IGJpbmRJbnRlcm5hbENoYW5uZWwoc2VsZiwgZGlzcGF0Y2gpXG4gICAgcmV0dXJuIHNlbGZcblxuXG5leHBvcnQgZGVmYXVsdCBDaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gYmluZENoYW5uZWwoY2hhbm5lbCwgc2VuZFJhdywgcHJvcHMpIDo6XG4gIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBzZW5kUmF3IDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBDaGFubmVsIGV4cGVjdHMgJ3NlbmRSYXcnIGZ1bmN0aW9uIHBhcmFtZXRlcmBcblxuICBjb25zdCBjb3JlX3Byb3BzID0gQDogc2VuZFJhdzogQHt9IHZhbHVlOiBzZW5kUmF3XG4gIHByb3BzID0gbnVsbCA9PSBwcm9wcyA/IGNvcmVfcHJvcHMgOiBPYmplY3QuYXNzaWduIEAgY29yZV9wcm9wcywgcHJvcHNcblxuICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSBAIGNoYW5uZWwsIHByb3BzXG4gIHJldHVybiBzZW5kUmF3LmNoYW5uZWwgPSBzZWxmXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kSW50ZXJuYWxDaGFubmVsKGNoYW5uZWwsIGRpc3BhdGNoKSA6OlxuICBkaXNwYXRjaF9wa3Rfb2JqLmNoYW5uZWwgPSBjaGFubmVsXG4gIHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIGNoYW5uZWwsIEB7fVxuICAgIHNlbmRSYXc6IEB7fSB2YWx1ZTogZGlzcGF0Y2hfcGt0X29ialxuICAgIGJpbmRDaGFubmVsOiBAe30gdmFsdWU6IG51bGxcblxuICBmdW5jdGlvbiBkaXNwYXRjaF9wa3Rfb2JqKHBrdCkgOjpcbiAgICBpZiB1bmRlZmluZWQgPT09IHBrdC5fcmF3XyA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCBhIHBhcnNlZCBwa3Rfb2JqIHdpdGggdmFsaWQgJ19yYXdfJyBidWZmZXIgcHJvcGVydHlgXG4gICAgZGlzcGF0Y2ggQCBbcGt0XSwgY2hhbm5lbFxuICAgIHJldHVybiB0cnVlXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kRGlzcGF0Y2hQYWNrZXRzKGNoYW5uZWwpIDo6XG4gIGNvbnN0IGRpc3BhdGNoID0gY2hhbm5lbC5odWIucm91dGVyLmRpc3BhdGNoXG4gIGNvbnN0IGZlZWQgPSBjaGFubmVsLmh1Yi5wYWNrZXRQYXJzZXIucGFja2V0U3RyZWFtKClcblxuICByZXR1cm4gZnVuY3Rpb24gb25fcmVjdl9kYXRhKGRhdGEpIDo6XG4gICAgY29uc3QgcGt0TGlzdCA9IGZlZWQoZGF0YSlcbiAgICBpZiAwIDwgcGt0TGlzdC5sZW5ndGggOjpcbiAgICAgIGRpc3BhdGNoIEAgcGt0TGlzdCwgY2hhbm5lbFxuIiwiaW1wb3J0IHtSb3V0ZXJ9IGZyb20gJy4vcm91dGVyLmpzeSdcbmltcG9ydCB7Q2hhbm5lbH0gZnJvbSAnLi9jaGFubmVsLmpzeSdcblxuZXhwb3J0IGNsYXNzIEZhYnJpY0h1YiA6OlxuICBjb25zdHJ1Y3RvcigpIDo6XG4gICAgYXBwbHlQbHVnaW5zIEAgJ3ByZScsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuXG4gICAgY29uc3QgcGFja2V0UGFyc2VyID0gdGhpcy5wYWNrZXRQYXJzZXJcbiAgICBpZiBudWxsPT1wYWNrZXRQYXJzZXIgfHwgISBwYWNrZXRQYXJzZXIuaXNQYWNrZXRQYXJzZXIoKSA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBJbnZhbGlkIGh1Yi5wYWNrZXRQYXJzZXJgXG5cbiAgICBjb25zdCByb3V0ZXIgPSB0aGlzLl9pbml0X3JvdXRlcigpXG4gICAgY29uc3QgX2FwaV9jaGFubmVsID0gdGhpcy5faW5pdF9jaGFubmVsQVBJKHBhY2tldFBhcnNlcilcbiAgICBjb25zdCBfYXBpX2ludGVybmFsID0gdGhpcy5faW5pdF9pbnRlcm5hbEFQSShwYWNrZXRQYXJzZXIpXG4gICAgcm91dGVyLmluaXREaXNwYXRjaCgpXG4gICAgX2FwaV9pbnRlcm5hbC5iaW5kSW50ZXJuYWxDaGFubmVsIEAgcm91dGVyLmRpc3BhdGNoXG5cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEB7fVxuICAgICAgcm91dGVyOiBAe30gdmFsdWU6IHJvdXRlclxuICAgICAgcGFja2V0UGFyc2VyOiBAe30gdmFsdWU6IHBhY2tldFBhcnNlclxuICAgICAgX2FwaV9jaGFubmVsOiBAe30gdmFsdWU6IF9hcGlfY2hhbm5lbFxuICAgICAgX2FwaV9pbnRlcm5hbDogQHt9IHZhbHVlOiBfYXBpX2ludGVybmFsXG5cbiAgICBhcHBseVBsdWdpbnMgQCBudWxsLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICBhcHBseVBsdWdpbnMgQCAncG9zdCcsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIHJldHVybiB0aGlzXG5cbiAgX2luaXRfcm91dGVyKCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYFBsdWdpbiByZXNwb25zaWJsaXR5YFxuXG4gIF9pbml0X2NoYW5uZWxBUEkocGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiBDaGFubmVsLmFzQ2hhbm5lbEFQSSBAIHRoaXMsIHBhY2tldFBhcnNlclxuICBfaW5pdF9pbnRlcm5hbEFQSShwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIENoYW5uZWwuYXNJbnRlcm5hbEFQSSBAIHRoaXMsIHBhY2tldFBhcnNlclxuXG5cbiAgc3RhdGljIHBsdWdpbiguLi5wbHVnaW5GdW5jdGlvbnMpIDo6XG4gICAgcmV0dXJuIHRoaXMucGx1Z2lucyguLi5wbHVnaW5GdW5jdGlvbnMpXG4gIHN0YXRpYyBwbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICBjb25zdCBwbHVnaW5MaXN0ID0gW10uY29uY2F0IEBcbiAgICAgIHRoaXMucHJvdG90eXBlLnBsdWdpbkxpc3QgfHwgW11cbiAgICAgIHBsdWdpbkZ1bmN0aW9uc1xuXG4gICAgcGx1Z2luTGlzdC5zb3J0IEAgKGEsIGIpID0+ICgwIHwgYS5vcmRlcikgLSAoMCB8IGIub3JkZXIpXG5cbiAgICBjb25zdCBCYXNlSHViID0gdGhpcy5fQmFzZUh1Yl8gfHwgdGhpc1xuICAgIGNsYXNzIEZhYnJpY0h1Yl9QSSBleHRlbmRzIEJhc2VIdWIgOjpcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIEZhYnJpY0h1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwbHVnaW5MaXN0OiBAe30gdmFsdWU6IE9iamVjdC5mcmVlemUgQCBwbHVnaW5MaXN0XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBGYWJyaWNIdWJfUEksIEA6XG4gICAgICBfQmFzZUh1Yl86IEB7fSB2YWx1ZTogQmFzZUh1YlxuXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3N1YmNsYXNzJywgcGx1Z2luTGlzdCwgRmFicmljSHViX1BJLCBAOiBSb3V0ZXIsIENoYW5uZWxcbiAgICByZXR1cm4gRmFicmljSHViX1BJXG5cblxuICB2YWx1ZU9mKCkgOjogcmV0dXJuIHRoaXMucm91dGVyLmlkX3NlbGZcbiAgZ2V0IGlkX3NlbGYoKSA6OiByZXR1cm4gdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBpZF9yb3V0ZXJfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMucGFja2V0UGFyc2VyLnBhY2tJZCBAXG4gICAgICB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGNvbm5lY3Rfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMuX2FwaV9pbnRlcm5hbC5jbG9uZSgpXG4gIGJpbmRSb3V0ZURpc3BhdGNoKGNoYW5uZWwsIGNhY2hlKSA6OlxuICAgIGlmIG51bGwgPT0gY2hhbm5lbCA6OiBjaGFubmVsID0gdGhpcy5jb25uZWN0X3NlbGYoKVxuXG4gICAgY29uc3QgcmVzb2x2ZVJvdXRlID0gaWRfcm91dGVyID0+IDo6XG4gICAgICBsZXQgcm91dGUsIGRpc2NvID0gdGhpcy5yb3V0ZXIucmVzb2x2ZVJvdXRlKGlkX3JvdXRlcilcbiAgICAgIHJldHVybiBhc3luYyBwa3QgPT4gOjpcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSByb3V0ZSA6OlxuICAgICAgICAgIHJvdXRlID0gZGlzY28gPSBhd2FpdCBkaXNjb1xuICAgICAgICByZXR1cm4gcm91dGUgQCBwa3QsIGNoYW5uZWxcblxuICAgIHJldHVybiBjYWNoZSA/IGNhY2hlUmVzb2x2ZVJvdXRlIDogcmVzb2x2ZVJvdXRlXG5cbiAgICBmdW5jdGlvbiBjYWNoZVJlc29sdmVSb3V0ZShpZF9yb3V0ZXIpIDo6XG4gICAgICBsZXQgY2hhbiA9IGNhY2hlLmdldChpZF9yb3V0ZXIpXG4gICAgICBpZiB1bmRlZmluZWQgPT09IGNoYW4gOjpcbiAgICAgICAgY2hhbiA9IHJlc29sdmVSb3V0ZShpZF9yb3V0ZXIpXG4gICAgICAgIGNhY2hlLnNldChpZF9yb3V0ZXIsIGNoYW4pXG4gICAgICByZXR1cm4gY2hhblxuXG5cbiAgY29ubmVjdChjb25uX3VybCkgOjpcbiAgICBpZiBudWxsID09IGNvbm5fdXJsIDo6XG4gICAgICByZXR1cm4gdGhpcy5jb25uZWN0X3NlbGYoKVxuXG4gICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBjb25uX3VybCA6OlxuICAgICAgY29ubl91cmwgPSB0aGlzLl9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpXG5cbiAgICBjb25zdCBjb25uZWN0ID0gdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xbY29ubl91cmwucHJvdG9jb2xdXG4gICAgaWYgISBjb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IgQCBgQ29ubmVjdGlvbiBwcm90b2NvbCBcIiR7Y29ubl91cmwucHJvdG9jb2x9XCIgbm90IHJlZ2lzdGVyZWQgZm9yIFwiJHtjb25uX3VybC50b1N0cmluZygpfVwiYFxuXG4gICAgcmV0dXJuIGNvbm5lY3QoY29ubl91cmwpXG5cbiAgcmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wocHJvdG9jb2wsIGNiX2Nvbm5lY3QpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNiX2Nvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2NiX2Nvbm5lY3QnIGZ1bmN0aW9uYFxuICAgIGNvbnN0IGJ5UHJvdG9jb2wgPSBPYmplY3QuYXNzaWduIEAge30sIHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sXG4gICAgYnlQcm90b2NvbFtwcm90b2NvbF0gPSBjYl9jb25uZWN0XG4gICAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIHRoaXMsICdfY29ubmVjdEJ5UHJvdG9jb2wnLFxuICAgICAgQDogdmFsdWU6IGJ5UHJvdG9jb2wsIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuXG4gIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgcmV0dXJuIG5ldyBVUkwoY29ubl91cmwpXG5cbmV4cG9ydCBkZWZhdWx0IEZhYnJpY0h1YlxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlQbHVnaW5zKGtleSwgcGx1Z2luTGlzdCwgLi4uYXJncykgOjpcbiAgaWYgISBrZXkgOjoga2V5ID0gbnVsbFxuICBmb3IgbGV0IHBsdWdpbiBvZiBwbHVnaW5MaXN0IDo6XG4gICAgaWYgbnVsbCAhPT0ga2V5IDo6IHBsdWdpbiA9IHBsdWdpbltrZXldXG4gICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIHBsdWdpbiA6OlxuICAgICAgcGx1Z2luKC4uLmFyZ3MpXG4iXSwibmFtZXMiOlsiZGlzcENvbnRyb2xCeVR5cGUiLCJyZWN2X2hlbGxvIiwicmVjdl9vbGxlaCIsInJlY3ZfcG9uZyIsInJlY3ZfcGluZyIsInNlbmRfaGVsbG8iLCJjaGFubmVsIiwiZWNfcHViX2lkIiwiaHViIiwicm91dGVyIiwicGFja0FuZFNlbmRSYXciLCJ0eXBlIiwiaWRfcm91dGVyX3NlbGYiLCJwa3QiLCJlY19vdGhlcl9pZCIsImhlYWRlcl9idWZmZXIiLCJsZW5ndGgiLCJlY19pZF9obWFjIiwiaG1hY19zZWNyZXQiLCJpZF9yb3V0ZXIiLCJ1bnBhY2tJZCIsImJvZHlfYnVmZmVyIiwidW52ZXJpZmllZFBlZXJSb3V0ZSIsInNlbmRfb2xsZWgiLCJwZWVyX2htYWNfY2xhaW0iLCJjb21wYXJlIiwidmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX3Bpbmdwb25nIiwicG9uZyIsIkRhdGUiLCJ0b0lTT1N0cmluZyIsImxvY2FsIiwicmVtb3RlIiwidG9TdHJpbmciLCJkZWx0YSIsInRzX3BvbmciLCJlcnIiLCJ0c19waW5nIiwiUm91dGVyIiwiaWRfc2VsZiIsInJvdXRlRGlzY292ZXJ5IiwidGFyZ2V0RGlzY292ZXJ5IiwidGFyZ2V0cyIsIl9jcmVhdGVUYXJnZXRzTWFwIiwiT2JqZWN0IiwiY3JlYXRlIiwiZGVmaW5lUHJvcGVydGllcyIsInZhbHVlIiwicm91dGVzIiwiX2NyZWF0ZVJvdXRlc01hcCIsInNldCIsImJpbmREaXNwYXRjaENvbnRyb2wiLCJiaW5kRGlzcGF0Y2hTZWxmIiwiYmluZERpc3BhdGNoUm91dGVzIiwiZXJyb3IiLCJNYXAiLCJkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZSIsImRpc3BhdGNoX3JvdXRlIiwiX2ZpcnN0Um91dGUiLCJyZWdpc3RlclJvdXRlIiwicHF1ZXVlIiwicHJvbWlzZVF1ZXVlIiwiZGlzcGF0Y2giLCJwa3RMaXN0IiwicHEiLCJtYXAiLCJ0aGVuIiwiZGlzcGF0Y2hfb25lIiwiZ2V0IiwidW5kZWZpbmVkIiwidW5kZWxpdmVyYWJsZSIsInVucmVnaXN0ZXJSb3V0ZSIsIm9uX2Vycm9yX2luX2Rpc3BhdGNoIiwicmVzb2x2ZVJvdXRlIiwiVHlwZUVycm9yIiwiaGFzIiwiZGVsZXRlIiwidHRsIiwic2VuZFJhdyIsInJlZ2lzdGVyUGVlclJvdXRlIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwiY29uc29sZSIsIndhcm4iLCJxdWVyeSIsIl9maXJzdFRhcmdldCIsImRpc3BhdGNoU2VsZiIsImlkX3RhcmdldCIsInRhcmdldCIsInVucmVnaXN0ZXJUYXJnZXQiLCJpZCIsIk51bWJlciIsImlzU2FmZUludGVnZXIiLCJoYW5kbGVyIiwiZG51X2Rpc3BhdGNoX2NvbnRyb2wiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJiaW5kUHJvbWlzZUZpcnN0UmVzdWx0IiwidGlwIiwiUHJvbWlzZSIsInJlc29sdmUiLCJjbGVhcl90aXAiLCJpc19kZWZpbmVkIiwiZSIsIm9wdGlvbnMiLCJ0ZXN0Iiwib25fZXJyb3IiLCJpZkFic2VudCIsImFic2VudCIsImxzdEZucyIsInJlc29sdmVJZiIsImFsbCIsIkFycmF5IiwiZnJvbSIsImZuIiwiQ2hhbm5lbCIsIkVycm9yIiwiYXJncyIsInBhY2tSYXciLCJwa3Rfb2JqIiwicGFja0pTT04iLCJoZWFkZXIiLCJKU09OIiwic3RyaW5naWZ5IiwiYm9keSIsInByb3BzIiwiZXh0cmEiLCJzZWxmIiwiYmluZENoYW5uZWwiLCJiaW5kRGlzcGF0Y2hQYWNrZXRzIiwibW9kZSIsInJ0ciIsImFzQVBJIiwiYXNDaGFubmVsQVBJIiwicGFja2V0UGFyc2VyIiwicGFja1BhY2tldCIsImFzSW50ZXJuYWxBUEkiLCJwYWNrUGFja2V0T2JqIiwiYmluZEludGVybmFsQ2hhbm5lbCIsImNvcmVfcHJvcHMiLCJkaXNwYXRjaF9wa3Rfb2JqIiwiX3Jhd18iLCJmZWVkIiwicGFja2V0U3RyZWFtIiwib25fcmVjdl9kYXRhIiwiZGF0YSIsIkZhYnJpY0h1YiIsInBsdWdpbkxpc3QiLCJpc1BhY2tldFBhcnNlciIsIl9pbml0X3JvdXRlciIsIl9hcGlfY2hhbm5lbCIsIl9pbml0X2NoYW5uZWxBUEkiLCJfYXBpX2ludGVybmFsIiwiX2luaXRfaW50ZXJuYWxBUEkiLCJpbml0RGlzcGF0Y2giLCJwbHVnaW4iLCJwbHVnaW5GdW5jdGlvbnMiLCJwbHVnaW5zIiwiY29uY2F0Iiwic29ydCIsImEiLCJiIiwib3JkZXIiLCJCYXNlSHViIiwiX0Jhc2VIdWJfIiwiRmFicmljSHViX1BJIiwiZnJlZXplIiwicGFja0lkIiwiY2xvbmUiLCJjYWNoZSIsImNvbm5lY3Rfc2VsZiIsInJvdXRlIiwiZGlzY28iLCJjYWNoZVJlc29sdmVSb3V0ZSIsImNoYW4iLCJjb25uX3VybCIsIl9wYXJzZUNvbm5lY3RVUkwiLCJjb25uZWN0IiwiX2Nvbm5lY3RCeVByb3RvY29sIiwicHJvdG9jb2wiLCJjYl9jb25uZWN0IiwiYnlQcm90b2NvbCIsImRlZmluZVByb3BlcnR5IiwiY29uZmlndXJhYmxlIiwiVVJMIiwiYXBwbHlQbHVnaW5zIiwia2V5Il0sIm1hcHBpbmdzIjoiQUFBTyxNQUFNQSxvQkFBb0I7R0FDOUIsSUFBRCxHQUFRQyxVQUR1QjtHQUU5QixJQUFELEdBQVFDLFVBRnVCO0dBRzlCLElBQUQsR0FBUUMsU0FIdUI7R0FJOUIsSUFBRCxHQUFRQyxTQUp1QixFQUExQjs7QUFRUCxBQUFPLFNBQVNDLFVBQVQsQ0FBb0JDLE9BQXBCLEVBQTZCO1FBQzVCLEVBQUNDLFNBQUQsS0FBY0QsUUFBUUUsR0FBUixDQUFZQyxNQUFoQztTQUNPSCxRQUFRSSxjQUFSLENBQXlCO2VBQ25CLENBRG1CLEVBQ2hCQyxNQUFNLElBRFU7WUFFdEJKLFNBRnNCO1VBR3hCRCxRQUFRRSxHQUFSLENBQVlJLGNBQVosRUFId0IsRUFBekIsQ0FBUDs7O0FBS0YsU0FBU1gsVUFBVCxDQUFvQlEsTUFBcEIsRUFBNEJJLEdBQTVCLEVBQWlDUCxPQUFqQyxFQUEwQztRQUNsQ1EsY0FBY0QsSUFBSUUsYUFBSixFQUFwQjtNQUNHLE1BQU1ELFlBQVlFLE1BQWxCLElBQTRCUCxPQUFPUSxVQUF0QyxFQUFtRDtVQUMzQ0MsY0FBY1QsT0FBT1EsVUFBUCxHQUNoQlIsT0FBT1EsVUFBUCxDQUFrQkgsV0FBbEIsQ0FEZ0IsR0FDaUIsSUFEckM7ZUFFYVIsT0FBYixFQUFzQlksV0FB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
