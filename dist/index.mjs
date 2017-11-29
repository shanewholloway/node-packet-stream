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

  get id_self() {
    return this.router.id_self;
  }
  id_router_self() {
    return this.packetParser.packId(this.router.id_self);
  }
  connect_self() {
    return this._api_internal.clone();
  }
  bindRouteDispatch(channel) {
    if (null == channel) {
      channel = this.connect_self();
    }
    return id_router => {
      let route,
          disco = this.router.resolveRoute(id_router);
      return async pkt => {
        if (undefined === route) {
          route = disco = await disco;
        }
        return route(pkt, channel);
      };
    };
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgubWpzIiwic291cmNlcyI6WyIuLi9jb2RlL2NvbnRyb2xfcHJvdG9jb2wuanN5IiwiLi4vY29kZS9yb3V0ZXIuanN5IiwiLi4vY29kZS9jaGFubmVsLmpzeSIsIi4uL2NvZGUvaHViLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY29uc3QgZGlzcENvbnRyb2xCeVR5cGUgPSBAe31cbiAgWzB4ZjBdOiByZWN2X2hlbGxvXG4gIFsweGYxXTogcmVjdl9vbGxlaFxuICBbMHhmZV06IHJlY3ZfcG9uZ1xuICBbMHhmZl06IHJlY3ZfcGluZ1xuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfaGVsbG8oY2hhbm5lbCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLmh1Yi5yb3V0ZXJcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IDB4ZjBcbiAgICBoZWFkZXI6IGVjX3B1Yl9pZFxuICAgIGJvZHk6IGNoYW5uZWwuaHViLmlkX3JvdXRlcl9zZWxmKClcblxuZnVuY3Rpb24gcmVjdl9oZWxsbyhyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgZWNfb3RoZXJfaWQgPSBwa3QuaGVhZGVyX2J1ZmZlcigpXG4gIGlmIDAgIT09IGVjX290aGVyX2lkLmxlbmd0aCAmJiByb3V0ZXIuZWNfaWRfaG1hYyA6OlxuICAgIGNvbnN0IGhtYWNfc2VjcmV0ID0gcm91dGVyLmVjX2lkX2htYWNcbiAgICAgID8gcm91dGVyLmVjX2lkX2htYWMoZWNfb3RoZXJfaWQpIDogbnVsbFxuICAgIHNlbmRfb2xsZWggQCBjaGFubmVsLCBobWFjX3NlY3JldFxuXG4gIGVsc2UgOjpcbiAgICBjb25zdCBpZF9yb3V0ZXIgPSBwa3QudW5wYWNrSWQocGt0LmJvZHlfYnVmZmVyKCksIDApXG4gICAgcm91dGVyLnVudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG5mdW5jdGlvbiBzZW5kX29sbGVoKGNoYW5uZWwsIGhtYWNfc2VjcmV0KSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwuaHViLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMVxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogaG1hY19zZWNyZXRcblxuZnVuY3Rpb24gcmVjdl9vbGxlaChyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgZWNfb3RoZXJfaWQgPSBwa3QuaGVhZGVyX2J1ZmZlcigpXG4gIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChlY19vdGhlcl9pZClcblxuICBjb25zdCBobWFjX3NlY3JldCA9IHJvdXRlci5lY19pZF9obWFjXG4gICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCwgdHJ1ZSkgOiBudWxsXG4gIGNvbnN0IHBlZXJfaG1hY19jbGFpbSA9IHBrdC5ib2R5X2J1ZmZlcigpXG4gIGlmIGhtYWNfc2VjcmV0ICYmIDAgPT09IGhtYWNfc2VjcmV0LmNvbXBhcmUgQCBwZWVyX2htYWNfY2xhaW0gOjpcbiAgICByb3V0ZXIudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcbiAgZWxzZSA6OlxuICAgIHJvdXRlci51bnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9waW5ncG9uZyhjaGFubmVsLCBwb25nKSA6OlxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogcG9uZyA/IDB4ZmUgOiAweGZmXG4gICAgYm9keTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbmZ1bmN0aW9uIHJlY3ZfcG9uZyhyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgdHJ5IDo6XG4gICAgY29uc3QgcmVtb3RlID0gbmV3IERhdGUgQCBwa3QuYm9keV9idWZmZXIoKS50b1N0cmluZygpXG4gICAgY29uc3QgZGVsdGEgPSByZW1vdGUgLSBsb2NhbFxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBkZWx0YSwgcmVtb3RlLCBsb2NhbFxuICBjYXRjaCBlcnIgOjpcbiAgICBjaGFubmVsLnRzX3BvbmcgPSBAe30gbG9jYWxcblxuZnVuY3Rpb24gcmVjdl9waW5nKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICBzZW5kX3Bpbmdwb25nIEAgY2hhbm5lbCwgdHJ1ZVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgcGt0LmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGxvY2FsXG5cbiIsImltcG9ydCB7ZGlzcENvbnRyb2xCeVR5cGV9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cbmV4cG9ydCBjbGFzcyBSb3V0ZXIgOjpcbiAgY29uc3RydWN0b3IoaWRfc2VsZikgOjpcbiAgICBpZiBpZF9zZWxmIDo6XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEA6IGlkX3NlbGY6IEA6IHZhbHVlOiBpZF9zZWxmXG5cbiAgLy8gLS0tIERpc3BhdGNoIGNvcmUgLS0tXG5cbiAgaW5pdERpc3BhdGNoKCkgOjpcbiAgICBjb25zdCByb3V0ZXMgPSB0aGlzLl9jcmVhdGVSb3V0ZXNNYXAoKVxuICAgIHJvdXRlcy5zZXQgQCAwLCB0aGlzLmJpbmREaXNwYXRjaENvbnRyb2woKVxuICAgIGlmIG51bGwgIT0gdGhpcy5pZF9zZWxmIDo6XG4gICAgICByb3V0ZXMuc2V0IEAgdGhpcy5pZF9zZWxmLCB0aGlzLmJpbmREaXNwYXRjaFNlbGYoKVxuXG4gICAgdGhpcy5iaW5kRGlzcGF0Y2hSb3V0ZXMocm91dGVzKVxuXG4gIG9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgcGt0KSA6OlxuICAgIGNvbnNvbGUuZXJyb3IgQCAnRXJyb3IgZHVyaW5nIHBhY2tldCBkaXNwYXRjaFxcbiAgcGt0OicsIHBrdCwgJ1xcbicsIGVyciwgJ1xcbidcblxuICBfY3JlYXRlUm91dGVzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byByb3V0ZSAtLS1cblxuICByb3V0ZURpc2NvdmVyeSA9IFtdXG4gIGFzeW5jIGRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlcikgOjpcbiAgICBjb25zdCBkaXNwYXRjaF9yb3V0ZSA9IGF3YWl0IHRoaXMuX2ZpcnN0Um91dGUgQCBpZF9yb3V0ZXIsIHRoaXMucm91dGVEaXNjb3ZlcnlcbiAgICBpZiBudWxsID09IGRpc3BhdGNoX3JvdXRlIDo6IHJldHVyblxuICAgIHRoaXMucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlKVxuICAgIHJldHVybiBkaXNwYXRjaF9yb3V0ZVxuXG4gIGJpbmREaXNwYXRjaFJvdXRlcyhyb3V0ZXMpIDo6XG4gICAgY29uc3QgcHF1ZXVlID0gcHJvbWlzZVF1ZXVlKClcbiAgICBmdW5jdGlvbiBkaXNwYXRjaChwa3RMaXN0LCBjaGFubmVsKSA6OlxuICAgICAgY29uc3QgcHEgPSBwcXVldWUoKSAvLyBwcSB3aWxsIGRpc3BhdGNoIGR1cmluZyBQcm9taXNlIHJlc29sdXRpb25zXG4gICAgICByZXR1cm4gcGt0TGlzdC5tYXAgQCBwa3QgPT5cbiAgICAgICAgcHEudGhlbiBAICgpID0+IGRpc3BhdGNoX29uZShwa3QsIGNoYW5uZWwpXG5cbiAgICBjb25zdCBkaXNwYXRjaF9vbmUgPSBhc3luYyAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgdHJ5IDo6XG4gICAgICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC5pZF9yb3V0ZXJcbiAgICAgICAgbGV0IGRpc3BhdGNoX3JvdXRlID0gcm91dGVzLmdldChpZF9yb3V0ZXIpXG4gICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgICBkaXNwYXRjaF9yb3V0ZSA9IGF3YWl0IHRoaXMuZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyKVxuICAgICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgICAgIHJldHVybiBjaGFubmVsICYmIGNoYW5uZWwudW5kZWxpdmVyYWJsZShwa3QsICdyb3V0ZScpXG5cbiAgICAgICAgaWYgZmFsc2UgPT09IGF3YWl0IGRpc3BhdGNoX3JvdXRlKHBrdCwgY2hhbm5lbCkgOjpcbiAgICAgICAgICB0aGlzLnVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpXG4gICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgdGhpcy5vbl9lcnJvcl9pbl9kaXNwYXRjaChlcnIsIHBrdCwgY2hhbm5lbClcblxuICAgIGNvbnN0IHJlc29sdmVSb3V0ZSA9IGlkX3JvdXRlciA9PlxuICAgICAgcm91dGVzLmdldChpZF9yb3V0ZXIpIHx8XG4gICAgICAgIHRoaXMuZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyKVxuXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOlxuICAgICAgcm91dGVzOiBAOiB2YWx1ZTogcm91dGVzXG4gICAgICBkaXNwYXRjaDogQDogdmFsdWU6IGRpc3BhdGNoXG4gICAgICByZXNvbHZlUm91dGU6IEA6IHZhbHVlOiByZXNvbHZlUm91dGVcbiAgICByZXR1cm4gZGlzcGF0Y2hcblxuICByZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICBpZiBudWxsICE9IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2Rpc3BhdGNoX3JvdXRlJyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgICAgZWxzZSByZXR1cm4gZmFsc2VcbiAgICBpZiB0aGlzLnJvdXRlcy5oYXMgQCBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgMCA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMuaWRfc2VsZiA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuXG4gICAgdGhpcy5yb3V0ZXMuc2V0IEAgaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZVxuICAgIHJldHVybiB0cnVlXG4gIHVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpIDo6XG4gICAgcmV0dXJuIHRoaXMucm91dGVzLmRlbGV0ZSBAIGlkX3JvdXRlclxuICByZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJSb3V0ZSBAIGlkX3JvdXRlciwgcGt0ID0+IDo6XG4gICAgICBpZiAwICE9PSBwa3QudHRsIDo6IGNoYW5uZWwuc2VuZFJhdyhwa3QpXG4gIHZlcmlmaWVkUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gIHVudmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIGlmIHRoaXMuYWxsb3dVbnZlcmlmaWVkUm91dGVzIHx8IGNoYW5uZWwuYWxsb3dVbnZlcmlmaWVkUm91dGVzIDo6XG4gICAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gICAgZWxzZSBjb25zb2xlLndhcm4gQCAnVW52ZXJpZmllZCBwZWVyIHJvdXRlIChpZ25vcmVkKTonLCBAOiBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byBsb2NhbCB0YXJnZXRcblxuICB0YXJnZXREaXNjb3ZlcnkgPSBbXVxuICBkaXNjb3ZlclRhcmdldChxdWVyeSkgOjpcbiAgICByZXR1cm4gdGhpcy5fZmlyc3RUYXJnZXQgQCBxdWVyeSwgdGhpcy50YXJnZXREaXNjb3ZlcnlcblxuICBiaW5kRGlzcGF0Y2hTZWxmKCkgOjpcbiAgICBjb25zdCBkaXNwYXRjaFNlbGYgPSBhc3luYyAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgY29uc3QgaWRfdGFyZ2V0ID0gcGt0LmlkX3RhcmdldFxuICAgICAgbGV0IHRhcmdldCA9IHRoaXMudGFyZ2V0cy5nZXQoaWRfdGFyZ2V0KVxuICAgICAgaWYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgICAgcmV0dXJuIGNoYW5uZWwgJiYgY2hhbm5lbC51bmRlbGl2ZXJhYmxlKHBrdCwgJ3RhcmdldCcpXG5cbiAgICAgIGlmIGZhbHNlID09PSBhd2FpdCB0YXJnZXQocGt0LCB0aGlzKSA6OlxuICAgICAgICB0aGlzLnVucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0KVxuXG4gICAgdGhpcy5kaXNwYXRjaFNlbGYgPSBkaXNwYXRjaFNlbGZcbiAgICByZXR1cm4gZGlzcGF0Y2hTZWxmXG5cbiAgX2NyZWF0ZVRhcmdldHNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG4gIHRhcmdldHMgPSB0aGlzLl9jcmVhdGVUYXJnZXRzTWFwKClcbiAgcmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0LCB0YXJnZXQpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGlkX3RhcmdldCAmJiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgdGFyZ2V0ID0gaWRfdGFyZ2V0XG4gICAgICBpZF90YXJnZXQgPSB0YXJnZXQuaWRfdGFyZ2V0IHx8IHRhcmdldC5pZFxuXG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHRhcmdldCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAndGFyZ2V0JyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgIGlmICEgTnVtYmVyLmlzU2FmZUludGVnZXIgQCBpZF90YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2lkX3RhcmdldCcgdG8gYmUgYW4gaW50ZWdlcmBcbiAgICBpZiB0aGlzLnRhcmdldHMuaGFzIEAgaWRfdGFyZ2V0IDo6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLnNldCBAIGlkX3RhcmdldCwgdGFyZ2V0XG4gIHVucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0KSA6OlxuICAgIHJldHVybiB0aGlzLnRhcmdldHMuZGVsZXRlIEAgaWRfdGFyZ2V0XG5cblxuXG4gIC8vIC0tLSBEaXNwYXRjaCBjb250cm9sIHBhY2tldHNcblxuICBiaW5kRGlzcGF0Y2hDb250cm9sKCkgOjpcbiAgICByZXR1cm4gKHBrdCwgY2hhbm5lbCkgPT4gOjpcbiAgICAgIGlmIDAgIT09IHBrdC5pZF90YXJnZXQgOjogLy8gY29ubmVjdGlvbi1kaXNwYXRjaGVkXG4gICAgICAgIHJldHVybiB0aGlzLmRpc3BhdGNoU2VsZihwa3QsIGNoYW5uZWwpXG5cbiAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLmRpc3BDb250cm9sQnlUeXBlW3BrdC50eXBlXVxuICAgICAgaWYgdW5kZWZpbmVkICE9PSBoYW5kbGVyIDo6XG4gICAgICAgIHJldHVybiBoYW5kbGVyKHRoaXMsIHBrdCwgY2hhbm5lbClcbiAgICAgIGVsc2UgOjpcbiAgICAgICAgcmV0dXJuIHRoaXMuZG51X2Rpc3BhdGNoX2NvbnRyb2wocGt0LCBjaGFubmVsKVxuXG4gIGRpc3BDb250cm9sQnlUeXBlID0gT2JqZWN0LmNyZWF0ZSBAIHRoaXMuZGlzcENvbnRyb2xCeVR5cGVcbiAgZG51X2Rpc3BhdGNoX2NvbnRyb2wocGt0LCBjaGFubmVsKSA6OlxuICAgIGNvbnNvbGUud2FybiBAICdkbnVfZGlzcGF0Y2hfY29udHJvbCcsIHBrdC50eXBlLCBwa3RcblxuXG5PYmplY3QuYXNzaWduIEAgUm91dGVyLnByb3RvdHlwZSwgQHt9XG4gIGRpc3BDb250cm9sQnlUeXBlOiBPYmplY3QuYXNzaWduIEAge31cbiAgICBkaXNwQ29udHJvbEJ5VHlwZVxuXG4gIGJpbmRQcm9taXNlRmlyc3RSZXN1bHRcbiAgX2ZpcnN0Um91dGU6IGJpbmRQcm9taXNlRmlyc3RSZXN1bHQoKVxuICBfZmlyc3RUYXJnZXQ6IGJpbmRQcm9taXNlRmlyc3RSZXN1bHQoKVxuXG5leHBvcnQgZGVmYXVsdCBSb3V0ZXJcblxuXG5leHBvcnQgZnVuY3Rpb24gcHJvbWlzZVF1ZXVlKCkgOjpcbiAgbGV0IHRpcCA9IG51bGxcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIDo6XG4gICAgaWYgbnVsbCA9PT0gdGlwIDo6XG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgdGlwLnRoZW4gQCBjbGVhcl90aXBcbiAgICByZXR1cm4gdGlwXG5cbiAgZnVuY3Rpb24gY2xlYXJfdGlwKCkgOjpcbiAgICB0aXAgPSBudWxsXG5cbmZ1bmN0aW9uIGlzX2RlZmluZWQoZSkgOjogcmV0dXJuIHVuZGVmaW5lZCAhPT0gZVxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRQcm9taXNlRmlyc3RSZXN1bHQob3B0aW9ucz17fSkgOjpcbiAgY29uc3QgdGVzdCA9IG9wdGlvbnMudGVzdCB8fCBpc19kZWZpbmVkXG4gIGNvbnN0IG9uX2Vycm9yID0gb3B0aW9ucy5vbl9lcnJvciB8fCBjb25zb2xlLmVycm9yXG4gIGNvbnN0IGlmQWJzZW50ID0gb3B0aW9ucy5hYnNlbnQgfHwgbnVsbFxuXG4gIHJldHVybiAodGlwLCBsc3RGbnMpID0+XG4gICAgbmV3IFByb21pc2UgQCByZXNvbHZlID0+IDo6XG4gICAgICBjb25zdCByZXNvbHZlSWYgPSBlID0+IHRlc3QoZSkgPyByZXNvbHZlKGUpIDogZVxuICAgICAgdGlwID0gUHJvbWlzZS5yZXNvbHZlKHRpcClcbiAgICAgIFByb21pc2UuYWxsIEBcbiAgICAgICAgQXJyYXkuZnJvbSBAIGxzdEZucywgZm4gPT5cbiAgICAgICAgICB0aXAudGhlbihmbikudGhlbihyZXNvbHZlSWYsIG9uX2Vycm9yKVxuICAgICAgLnRoZW4gQCBhYnNlbnQsIGFic2VudFxuXG4gICAgICBmdW5jdGlvbiBhYnNlbnQoKSA6OlxuICAgICAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaWZBYnNlbnQgOjpcbiAgICAgICAgICByZXNvbHZlIEAgaWZBYnNlbnQoKVxuICAgICAgICBlbHNlIHJlc29sdmUgQCBpZkFic2VudFxuIiwiaW1wb3J0IHtzZW5kX2hlbGxvLCBzZW5kX3Bpbmdwb25nfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5cbmV4cG9ydCBjbGFzcyBDaGFubmVsIDo6XG4gIHNlbmRSYXcoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgSW5zdGFuY2UgcmVzcG9uc2libGl0eWBcbiAgcGFja1JhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuXG4gIHBhY2tBbmRTZW5kUmF3KC4uLmFyZ3MpIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja1JhdyBAIC4uLmFyZ3NcblxuICBzZW5kSlNPTihwa3Rfb2JqKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tKU09OIEAgcGt0X29ialxuICBwYWNrSlNPTihwa3Rfb2JqKSA6OlxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcGt0X29iai5oZWFkZXIgOjpcbiAgICAgIHBrdF9vYmouaGVhZGVyID0gSlNPTi5zdHJpbmdpZnkgQCBwa3Rfb2JqLmhlYWRlclxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcGt0X29iai5ib2R5IDo6XG4gICAgICBwa3Rfb2JqLmJvZHkgPSBKU09OLnN0cmluZ2lmeSBAIHBrdF9vYmouYm9keVxuICAgIHJldHVybiB0aGlzLnBhY2tSYXcocGt0X29iailcblxuXG4gIC8vIC0tLSBDb250cm9sIG1lc3NhZ2UgdXRpbGl0aWVzXG5cbiAgc2VuZFJvdXRpbmdIYW5kc2hha2UoKSA6OlxuICAgIHJldHVybiBzZW5kX2hlbGxvKHRoaXMsIHRoaXMuaHViLnJvdXRlci5lY19wdWJfaWQpXG4gIHNlbmRQaW5nKCkgOjpcbiAgICByZXR1cm4gc2VuZF9waW5ncG9uZyh0aGlzKVxuXG5cbiAgY2xvbmUocHJvcHMsIC4uLmV4dHJhKSA6OlxuICAgIGNvbnN0IHNlbGYgPSBPYmplY3QuY3JlYXRlKHRoaXMsIHByb3BzKVxuICAgIHJldHVybiAwID09PSBleHRyYS5sZW5ndGggPyBzZWxmIDogT2JqZWN0LmFzc2lnbihzZWxmLCAuLi5leHRyYSlcbiAgYmluZENoYW5uZWwoc2VuZFJhdywgcHJvcHMpIDo6IHJldHVybiBiaW5kQ2hhbm5lbCh0aGlzLCBzZW5kUmF3LCBwcm9wcylcbiAgYmluZERpc3BhdGNoUGFja2V0cygpIDo6IHJldHVybiBiaW5kRGlzcGF0Y2hQYWNrZXRzKHRoaXMpXG5cbiAgdW5kZWxpdmVyYWJsZShwa3QsIG1vZGUpIDo6XG4gICAgY29uc3QgcnRyID0gcGt0LmlkX3JvdXRlciAhPT0gdGhpcy5odWIucm91dGVyLmlkX3NlbGYgPyBwa3QuaWRfcm91dGVyIDogJ3NlbGYnXG4gICAgY29uc29sZS53YXJuIEAgYFVuZGVsaXZlcmFibGVbJHttb2RlfV06ICR7cGt0LmlkX3RhcmdldH0gb2YgJHtydHJ9YFxuXG4gIHN0YXRpYyBhc0FQSShodWIsIHBhY2tSYXcpIDo6XG4gICAgY29uc3Qgc2VsZiA9IG5ldyB0aGlzKClcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHNlbGYsIEA6XG4gICAgICBwYWNrUmF3OiBAOiB2YWx1ZTogcGFja1Jhd1xuICAgICAgaHViOiBAOiB2YWx1ZTogaHViXG4gICAgICBfcm9vdF86IEA6IHZhbHVlOiBzZWxmXG4gICAgcmV0dXJuIHNlbGZcblxuICBzdGF0aWMgYXNDaGFubmVsQVBJKGh1YiwgcGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiB0aGlzLmFzQVBJIEAgaHViLCBwYWNrZXRQYXJzZXIucGFja1BhY2tldFxuXG4gIHN0YXRpYyBhc0ludGVybmFsQVBJKGh1YiwgcGFja2V0UGFyc2VyKSA6OlxuICAgIGNvbnN0IHNlbGYgPSB0aGlzLmFzQVBJIEAgaHViLCBwYWNrZXRQYXJzZXIucGFja1BhY2tldE9ialxuICAgIHNlbGYuYmluZEludGVybmFsQ2hhbm5lbCA9IGRpc3BhdGNoID0+IGJpbmRJbnRlcm5hbENoYW5uZWwoc2VsZiwgZGlzcGF0Y2gpXG4gICAgcmV0dXJuIHNlbGZcblxuXG5leHBvcnQgZGVmYXVsdCBDaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gYmluZENoYW5uZWwoY2hhbm5lbCwgc2VuZFJhdywgcHJvcHMpIDo6XG4gIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBzZW5kUmF3IDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBDaGFubmVsIGV4cGVjdHMgJ3NlbmRSYXcnIGZ1bmN0aW9uIHBhcmFtZXRlcmBcblxuICBjb25zdCBjb3JlX3Byb3BzID0gQDogc2VuZFJhdzogQHt9IHZhbHVlOiBzZW5kUmF3XG4gIHByb3BzID0gbnVsbCA9PSBwcm9wcyA/IGNvcmVfcHJvcHMgOiBPYmplY3QuYXNzaWduIEAgY29yZV9wcm9wcywgcHJvcHNcblxuICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSBAIGNoYW5uZWwsIHByb3BzXG4gIHJldHVybiBzZW5kUmF3LmNoYW5uZWwgPSBzZWxmXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kSW50ZXJuYWxDaGFubmVsKGNoYW5uZWwsIGRpc3BhdGNoKSA6OlxuICBkaXNwYXRjaF9wa3Rfb2JqLmNoYW5uZWwgPSBjaGFubmVsXG4gIHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIGNoYW5uZWwsIEB7fVxuICAgIHNlbmRSYXc6IEB7fSB2YWx1ZTogZGlzcGF0Y2hfcGt0X29ialxuICAgIGJpbmRDaGFubmVsOiBAe30gdmFsdWU6IG51bGxcblxuICBmdW5jdGlvbiBkaXNwYXRjaF9wa3Rfb2JqKHBrdCkgOjpcbiAgICBpZiB1bmRlZmluZWQgPT09IHBrdC5fcmF3XyA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCBhIHBhcnNlZCBwa3Rfb2JqIHdpdGggdmFsaWQgJ19yYXdfJyBidWZmZXIgcHJvcGVydHlgXG4gICAgZGlzcGF0Y2ggQCBbcGt0XSwgY2hhbm5lbFxuICAgIHJldHVybiB0cnVlXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kRGlzcGF0Y2hQYWNrZXRzKGNoYW5uZWwpIDo6XG4gIGNvbnN0IGRpc3BhdGNoID0gY2hhbm5lbC5odWIucm91dGVyLmRpc3BhdGNoXG4gIGNvbnN0IGZlZWQgPSBjaGFubmVsLmh1Yi5wYWNrZXRQYXJzZXIucGFja2V0U3RyZWFtKClcblxuICByZXR1cm4gZnVuY3Rpb24gb25fcmVjdl9kYXRhKGRhdGEpIDo6XG4gICAgY29uc3QgcGt0TGlzdCA9IGZlZWQoZGF0YSlcbiAgICBpZiAwIDwgcGt0TGlzdC5sZW5ndGggOjpcbiAgICAgIGRpc3BhdGNoIEAgcGt0TGlzdCwgY2hhbm5lbFxuIiwiaW1wb3J0IHtSb3V0ZXJ9IGZyb20gJy4vcm91dGVyLmpzeSdcbmltcG9ydCB7Q2hhbm5lbH0gZnJvbSAnLi9jaGFubmVsLmpzeSdcblxuZXhwb3J0IGNsYXNzIEZhYnJpY0h1YiA6OlxuICBjb25zdHJ1Y3RvcigpIDo6XG4gICAgYXBwbHlQbHVnaW5zIEAgJ3ByZScsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuXG4gICAgY29uc3QgcGFja2V0UGFyc2VyID0gdGhpcy5wYWNrZXRQYXJzZXJcbiAgICBpZiBudWxsPT1wYWNrZXRQYXJzZXIgfHwgISBwYWNrZXRQYXJzZXIuaXNQYWNrZXRQYXJzZXIoKSA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBJbnZhbGlkIGh1Yi5wYWNrZXRQYXJzZXJgXG5cbiAgICBjb25zdCByb3V0ZXIgPSB0aGlzLl9pbml0X3JvdXRlcigpXG4gICAgY29uc3QgX2FwaV9jaGFubmVsID0gdGhpcy5faW5pdF9jaGFubmVsQVBJKHBhY2tldFBhcnNlcilcbiAgICBjb25zdCBfYXBpX2ludGVybmFsID0gdGhpcy5faW5pdF9pbnRlcm5hbEFQSShwYWNrZXRQYXJzZXIpXG4gICAgcm91dGVyLmluaXREaXNwYXRjaCgpXG4gICAgX2FwaV9pbnRlcm5hbC5iaW5kSW50ZXJuYWxDaGFubmVsIEAgcm91dGVyLmRpc3BhdGNoXG5cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEB7fVxuICAgICAgcm91dGVyOiBAe30gdmFsdWU6IHJvdXRlclxuICAgICAgcGFja2V0UGFyc2VyOiBAe30gdmFsdWU6IHBhY2tldFBhcnNlclxuICAgICAgX2FwaV9jaGFubmVsOiBAe30gdmFsdWU6IF9hcGlfY2hhbm5lbFxuICAgICAgX2FwaV9pbnRlcm5hbDogQHt9IHZhbHVlOiBfYXBpX2ludGVybmFsXG5cbiAgICBhcHBseVBsdWdpbnMgQCBudWxsLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICBhcHBseVBsdWdpbnMgQCAncG9zdCcsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIHJldHVybiB0aGlzXG5cbiAgX2luaXRfcm91dGVyKCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYFBsdWdpbiByZXNwb25zaWJsaXR5YFxuXG4gIF9pbml0X2NoYW5uZWxBUEkocGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiBDaGFubmVsLmFzQ2hhbm5lbEFQSSBAIHRoaXMsIHBhY2tldFBhcnNlclxuICBfaW5pdF9pbnRlcm5hbEFQSShwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIENoYW5uZWwuYXNJbnRlcm5hbEFQSSBAIHRoaXMsIHBhY2tldFBhcnNlclxuXG5cbiAgc3RhdGljIHBsdWdpbiguLi5wbHVnaW5GdW5jdGlvbnMpIDo6XG4gICAgcmV0dXJuIHRoaXMucGx1Z2lucyguLi5wbHVnaW5GdW5jdGlvbnMpXG4gIHN0YXRpYyBwbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICBjb25zdCBwbHVnaW5MaXN0ID0gW10uY29uY2F0IEBcbiAgICAgIHRoaXMucHJvdG90eXBlLnBsdWdpbkxpc3QgfHwgW11cbiAgICAgIHBsdWdpbkZ1bmN0aW9uc1xuXG4gICAgcGx1Z2luTGlzdC5zb3J0IEAgKGEsIGIpID0+ICgwIHwgYS5vcmRlcikgLSAoMCB8IGIub3JkZXIpXG5cbiAgICBjb25zdCBCYXNlSHViID0gdGhpcy5fQmFzZUh1Yl8gfHwgdGhpc1xuICAgIGNsYXNzIEZhYnJpY0h1Yl9QSSBleHRlbmRzIEJhc2VIdWIgOjpcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIEZhYnJpY0h1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwbHVnaW5MaXN0OiBAe30gdmFsdWU6IE9iamVjdC5mcmVlemUgQCBwbHVnaW5MaXN0XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBGYWJyaWNIdWJfUEksIEA6XG4gICAgICBfQmFzZUh1Yl86IEB7fSB2YWx1ZTogQmFzZUh1YlxuXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3N1YmNsYXNzJywgcGx1Z2luTGlzdCwgRmFicmljSHViX1BJLCBAOiBSb3V0ZXIsIENoYW5uZWxcbiAgICByZXR1cm4gRmFicmljSHViX1BJXG5cblxuICBnZXQgaWRfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMucm91dGVyLmlkX3NlbGZcbiAgaWRfcm91dGVyX3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLnBhY2tldFBhcnNlci5wYWNrSWQgQFxuICAgICAgdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBjb25uZWN0X3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLl9hcGlfaW50ZXJuYWwuY2xvbmUoKVxuICBiaW5kUm91dGVEaXNwYXRjaChjaGFubmVsKSA6OlxuICAgIGlmIG51bGwgPT0gY2hhbm5lbCA6OiBjaGFubmVsID0gdGhpcy5jb25uZWN0X3NlbGYoKVxuICAgIHJldHVybiBpZF9yb3V0ZXIgPT4gOjpcbiAgICAgIGxldCByb3V0ZSwgZGlzY28gPSB0aGlzLnJvdXRlci5yZXNvbHZlUm91dGUoaWRfcm91dGVyKVxuICAgICAgcmV0dXJuIGFzeW5jIHBrdCA9PiA6OlxuICAgICAgICBpZiB1bmRlZmluZWQgPT09IHJvdXRlIDo6XG4gICAgICAgICAgcm91dGUgPSBkaXNjbyA9IGF3YWl0IGRpc2NvXG4gICAgICAgIHJldHVybiByb3V0ZSBAIHBrdCwgY2hhbm5lbFxuXG4gIGNvbm5lY3QoY29ubl91cmwpIDo6XG4gICAgaWYgbnVsbCA9PSBjb25uX3VybCA6OlxuICAgICAgcmV0dXJuIHRoaXMuY29ubmVjdF9zZWxmKClcblxuICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgY29ubl91cmwgOjpcbiAgICAgIGNvbm5fdXJsID0gdGhpcy5fcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKVxuXG4gICAgY29uc3QgY29ubmVjdCA9IHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sW2Nvbm5fdXJsLnByb3RvY29sXVxuICAgIGlmICEgY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYENvbm5lY3Rpb24gcHJvdG9jb2wgXCIke2Nvbm5fdXJsLnByb3RvY29sfVwiIG5vdCByZWdpc3RlcmVkIGZvciBcIiR7Y29ubl91cmwudG9TdHJpbmcoKX1cImBcblxuICAgIHJldHVybiBjb25uZWN0KGNvbm5fdXJsKVxuXG4gIHJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sKHByb3RvY29sLCBjYl9jb25uZWN0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYl9jb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdjYl9jb25uZWN0JyBmdW5jdGlvbmBcbiAgICBjb25zdCBieVByb3RvY29sID0gT2JqZWN0LmFzc2lnbiBAIHt9LCB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFxuICAgIGJ5UHJvdG9jb2xbcHJvdG9jb2xdID0gY2JfY29ubmVjdFxuICAgIHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydHkgQCB0aGlzLCAnX2Nvbm5lY3RCeVByb3RvY29sJyxcbiAgICAgIEA6IHZhbHVlOiBieVByb3RvY29sLCBjb25maWd1cmFibGU6IHRydWVcblxuICBfcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKSA6OlxuICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG5leHBvcnQgZGVmYXVsdCBGYWJyaWNIdWJcblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGx1Z2lucyhrZXksIHBsdWdpbkxpc3QsIC4uLmFyZ3MpIDo6XG4gIGlmICEga2V5IDo6IGtleSA9IG51bGxcbiAgZm9yIGxldCBwbHVnaW4gb2YgcGx1Z2luTGlzdCA6OlxuICAgIGlmIG51bGwgIT09IGtleSA6OiBwbHVnaW4gPSBwbHVnaW5ba2V5XVxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBwbHVnaW4gOjpcbiAgICAgIHBsdWdpbiguLi5hcmdzKVxuIl0sIm5hbWVzIjpbImRpc3BDb250cm9sQnlUeXBlIiwicmVjdl9oZWxsbyIsInJlY3Zfb2xsZWgiLCJyZWN2X3BvbmciLCJyZWN2X3BpbmciLCJzZW5kX2hlbGxvIiwiY2hhbm5lbCIsImVjX3B1Yl9pZCIsImh1YiIsInJvdXRlciIsInBhY2tBbmRTZW5kUmF3IiwidHlwZSIsImlkX3JvdXRlcl9zZWxmIiwicGt0IiwiZWNfb3RoZXJfaWQiLCJoZWFkZXJfYnVmZmVyIiwibGVuZ3RoIiwiZWNfaWRfaG1hYyIsImhtYWNfc2VjcmV0IiwiaWRfcm91dGVyIiwidW5wYWNrSWQiLCJib2R5X2J1ZmZlciIsInVudmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX29sbGVoIiwicGVlcl9obWFjX2NsYWltIiwiY29tcGFyZSIsInZlcmlmaWVkUGVlclJvdXRlIiwic2VuZF9waW5ncG9uZyIsInBvbmciLCJEYXRlIiwidG9JU09TdHJpbmciLCJsb2NhbCIsInJlbW90ZSIsInRvU3RyaW5nIiwiZGVsdGEiLCJ0c19wb25nIiwiZXJyIiwidHNfcGluZyIsIlJvdXRlciIsImlkX3NlbGYiLCJyb3V0ZURpc2NvdmVyeSIsInRhcmdldERpc2NvdmVyeSIsInRhcmdldHMiLCJfY3JlYXRlVGFyZ2V0c01hcCIsIk9iamVjdCIsImNyZWF0ZSIsImRlZmluZVByb3BlcnRpZXMiLCJ2YWx1ZSIsInJvdXRlcyIsIl9jcmVhdGVSb3V0ZXNNYXAiLCJzZXQiLCJiaW5kRGlzcGF0Y2hDb250cm9sIiwiYmluZERpc3BhdGNoU2VsZiIsImJpbmREaXNwYXRjaFJvdXRlcyIsImVycm9yIiwiTWFwIiwiZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUiLCJkaXNwYXRjaF9yb3V0ZSIsIl9maXJzdFJvdXRlIiwicmVnaXN0ZXJSb3V0ZSIsInBxdWV1ZSIsInByb21pc2VRdWV1ZSIsImRpc3BhdGNoIiwicGt0TGlzdCIsInBxIiwibWFwIiwidGhlbiIsImRpc3BhdGNoX29uZSIsImdldCIsInVuZGVmaW5lZCIsInVuZGVsaXZlcmFibGUiLCJ1bnJlZ2lzdGVyUm91dGUiLCJvbl9lcnJvcl9pbl9kaXNwYXRjaCIsInJlc29sdmVSb3V0ZSIsIlR5cGVFcnJvciIsImhhcyIsImRlbGV0ZSIsInR0bCIsInNlbmRSYXciLCJyZWdpc3RlclBlZXJSb3V0ZSIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsImNvbnNvbGUiLCJ3YXJuIiwicXVlcnkiLCJfZmlyc3RUYXJnZXQiLCJkaXNwYXRjaFNlbGYiLCJpZF90YXJnZXQiLCJ0YXJnZXQiLCJ1bnJlZ2lzdGVyVGFyZ2V0IiwiaWQiLCJOdW1iZXIiLCJpc1NhZmVJbnRlZ2VyIiwiaGFuZGxlciIsImRudV9kaXNwYXRjaF9jb250cm9sIiwiYXNzaWduIiwicHJvdG90eXBlIiwiYmluZFByb21pc2VGaXJzdFJlc3VsdCIsInRpcCIsIlByb21pc2UiLCJyZXNvbHZlIiwiY2xlYXJfdGlwIiwiaXNfZGVmaW5lZCIsImUiLCJvcHRpb25zIiwidGVzdCIsIm9uX2Vycm9yIiwiaWZBYnNlbnQiLCJhYnNlbnQiLCJsc3RGbnMiLCJyZXNvbHZlSWYiLCJhbGwiLCJBcnJheSIsImZyb20iLCJmbiIsIkNoYW5uZWwiLCJFcnJvciIsImFyZ3MiLCJwYWNrUmF3IiwicGt0X29iaiIsInBhY2tKU09OIiwiaGVhZGVyIiwiSlNPTiIsInN0cmluZ2lmeSIsImJvZHkiLCJwcm9wcyIsImV4dHJhIiwic2VsZiIsImJpbmRDaGFubmVsIiwiYmluZERpc3BhdGNoUGFja2V0cyIsIm1vZGUiLCJydHIiLCJhc0FQSSIsImFzQ2hhbm5lbEFQSSIsInBhY2tldFBhcnNlciIsInBhY2tQYWNrZXQiLCJhc0ludGVybmFsQVBJIiwicGFja1BhY2tldE9iaiIsImJpbmRJbnRlcm5hbENoYW5uZWwiLCJjb3JlX3Byb3BzIiwiZGlzcGF0Y2hfcGt0X29iaiIsIl9yYXdfIiwiZmVlZCIsInBhY2tldFN0cmVhbSIsIm9uX3JlY3ZfZGF0YSIsImRhdGEiLCJGYWJyaWNIdWIiLCJwbHVnaW5MaXN0IiwiaXNQYWNrZXRQYXJzZXIiLCJfaW5pdF9yb3V0ZXIiLCJfYXBpX2NoYW5uZWwiLCJfaW5pdF9jaGFubmVsQVBJIiwiX2FwaV9pbnRlcm5hbCIsIl9pbml0X2ludGVybmFsQVBJIiwiaW5pdERpc3BhdGNoIiwicGx1Z2luIiwicGx1Z2luRnVuY3Rpb25zIiwicGx1Z2lucyIsImNvbmNhdCIsInNvcnQiLCJhIiwiYiIsIm9yZGVyIiwiQmFzZUh1YiIsIl9CYXNlSHViXyIsIkZhYnJpY0h1Yl9QSSIsImZyZWV6ZSIsInBhY2tJZCIsImNsb25lIiwiY29ubmVjdF9zZWxmIiwicm91dGUiLCJkaXNjbyIsImNvbm5fdXJsIiwiX3BhcnNlQ29ubmVjdFVSTCIsImNvbm5lY3QiLCJfY29ubmVjdEJ5UHJvdG9jb2wiLCJwcm90b2NvbCIsImNiX2Nvbm5lY3QiLCJieVByb3RvY29sIiwiZGVmaW5lUHJvcGVydHkiLCJjb25maWd1cmFibGUiLCJVUkwiLCJhcHBseVBsdWdpbnMiLCJrZXkiXSwibWFwcGluZ3MiOiJBQUFPLE1BQU1BLG9CQUFv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
