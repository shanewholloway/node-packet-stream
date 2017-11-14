'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

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

  discoverTarget(query) {
    return this._firstTarget(query, this.targetDiscovery);
  }

  bindDispatchSelf(pkt) {
    const dispatchSelf = async (pkt, channel) => {
      const id_target = pkt.id_target;
      let target = this.targets.get(id_target);
      if (undefined === target) {
        return channel.undeliverable(pkt, 'target');
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

exports.channel = channel;
exports.control_protocol = control_protocol;
exports['default'] = FabricHub$1;
exports.FabricHub = FabricHub$1;
exports.applyPlugins = applyPlugins;
exports.Router = Router;
exports.promiseQueue = promiseQueue;
exports.bindPromiseFirstResult = bindPromiseFirstResult;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvY29udHJvbF9wcm90b2NvbC5qc3kiLCIuLi9jb2RlL3JvdXRlci5qc3kiLCIuLi9jb2RlL2NoYW5uZWwuanN5IiwiLi4vY29kZS9odWIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBkaXNwQ29udHJvbEJ5VHlwZSA9IEB7fVxuICBbMHhmMF06IHJlY3ZfaGVsbG9cbiAgWzB4ZjFdOiByZWN2X29sbGVoXG4gIFsweGZlXTogcmVjdl9wb25nXG4gIFsweGZmXTogcmVjdl9waW5nXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9oZWxsbyhjaGFubmVsKSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYwXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBjaGFubmVsLmh1Yi5pZF9yb3V0ZXJfc2VsZigpXG5cbmZ1bmN0aW9uIHJlY3ZfaGVsbG8ocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gcGt0LmhlYWRlcl9idWZmZXIoKVxuICBpZiAwICE9PSBlY19vdGhlcl9pZC5sZW5ndGggJiYgcm91dGVyLmVjX2lkX2htYWMgOjpcbiAgICBjb25zdCBobWFjX3NlY3JldCA9IHJvdXRlci5lY19pZF9obWFjXG4gICAgICA/IHJvdXRlci5lY19pZF9obWFjKGVjX290aGVyX2lkKSA6IG51bGxcbiAgICBzZW5kX29sbGVoIEAgY2hhbm5lbCwgaG1hY19zZWNyZXRcblxuICBlbHNlIDo6XG4gICAgY29uc3QgaWRfcm91dGVyID0gcGt0LnVucGFja0lkKHBrdC5ib2R5X2J1ZmZlcigpLCAwKVxuICAgIHJvdXRlci51bnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG5cblxuZnVuY3Rpb24gc2VuZF9vbGxlaChjaGFubmVsLCBobWFjX3NlY3JldCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMVxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogaG1hY19zZWNyZXRcblxuZnVuY3Rpb24gcmVjdl9vbGxlaChyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgZWNfb3RoZXJfaWQgPSBwa3QuaGVhZGVyX2J1ZmZlcigpXG4gIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChlY19vdGhlcl9pZClcblxuICBjb25zdCBobWFjX3NlY3JldCA9IHJvdXRlci5lY19pZF9obWFjXG4gICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCwgdHJ1ZSkgOiBudWxsXG4gIGNvbnN0IHBlZXJfaG1hY19jbGFpbSA9IHBrdC5ib2R5X2J1ZmZlcigpXG4gIGlmIGhtYWNfc2VjcmV0ICYmIDAgPT09IGhtYWNfc2VjcmV0LmNvbXBhcmUgQCBwZWVyX2htYWNfY2xhaW0gOjpcbiAgICByb3V0ZXIudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcbiAgZWxzZSA6OlxuICAgIHJvdXRlci51bnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9waW5ncG9uZyhjaGFubmVsLCBwb25nKSA6OlxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogcG9uZyA/IDB4ZmUgOiAweGZmXG4gICAgYm9keTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbmZ1bmN0aW9uIHJlY3ZfcG9uZyhyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgdHJ5IDo6XG4gICAgY29uc3QgcmVtb3RlID0gbmV3IERhdGUgQCBwa3QuYm9keV9idWZmZXIoKS50b1N0cmluZygpXG4gICAgY29uc3QgZGVsdGEgPSByZW1vdGUgLSBsb2NhbFxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBkZWx0YSwgcmVtb3RlLCBsb2NhbFxuICBjYXRjaCBlcnIgOjpcbiAgICBjaGFubmVsLnRzX3BvbmcgPSBAe30gbG9jYWxcblxuZnVuY3Rpb24gcmVjdl9waW5nKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICBzZW5kX3Bpbmdwb25nIEAgY2hhbm5lbCwgdHJ1ZVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgcGt0LmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGxvY2FsXG5cbiIsImltcG9ydCB7ZGlzcENvbnRyb2xCeVR5cGV9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cbmV4cG9ydCBjbGFzcyBSb3V0ZXIgOjpcbiAgY29uc3RydWN0b3IoaWRfc2VsZikgOjpcbiAgICBpZiBpZF9zZWxmIDo6XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEA6IGlkX3NlbGY6IEA6IHZhbHVlOiBpZF9zZWxmXG4gICAgICB0aGlzLl9pbml0RGlzcGF0Y2goKVxuXG4gIC8vIC0tLSBEaXNwYXRjaCBjb3JlIC0tLVxuXG4gIF9pbml0RGlzcGF0Y2goKSA6OlxuICAgIGNvbnN0IHJvdXRlcyA9IHRoaXMuX2NyZWF0ZVJvdXRlc01hcCgpXG4gICAgcm91dGVzLnNldCBAIDAsIHRoaXMuYmluZERpc3BhdGNoQ29udHJvbCgpXG4gICAgaWYgbnVsbCAhPSB0aGlzLmlkX3NlbGYgOjpcbiAgICAgIHJvdXRlcy5zZXQgQCB0aGlzLmlkX3NlbGYsIHRoaXMuYmluZERpc3BhdGNoU2VsZigpXG5cbiAgICB0aGlzLmJpbmREaXNwYXRjaFJvdXRlcyhyb3V0ZXMpXG5cbiAgb25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBwa3QpIDo6XG4gICAgY29uc29sZS5lcnJvciBAICdFcnJvciBkdXJpbmcgcGFja2V0IGRpc3BhdGNoXFxuICBwa3Q6JywgcGt0LCAnXFxuJywgZXJyLCAnXFxuJ1xuXG4gIF9jcmVhdGVSb3V0ZXNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIHJvdXRlIC0tLVxuXG4gIHJvdXRlRGlzY292ZXJ5ID0gW11cbiAgYXN5bmMgZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyKSA6OlxuICAgIGNvbnN0IGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5fZmlyc3RSb3V0ZSBAIGlkX3JvdXRlciwgdGhpcy5yb3V0ZURpc2NvdmVyeVxuICAgIGlmIG51bGwgPT0gZGlzcGF0Y2hfcm91dGUgOjogcmV0dXJuXG4gICAgdGhpcy5yZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpXG4gICAgcmV0dXJuIGRpc3BhdGNoX3JvdXRlXG5cbiAgYmluZERpc3BhdGNoUm91dGVzKHJvdXRlcykgOjpcbiAgICBjb25zdCBwcXVldWUgPSBwcm9taXNlUXVldWUoKVxuICAgIGZ1bmN0aW9uIGRpc3BhdGNoKHBrdExpc3QsIGNoYW5uZWwpIDo6XG4gICAgICBjb25zdCBwcSA9IHBxdWV1ZSgpIC8vIHBxIHdpbGwgZGlzcGF0Y2ggZHVyaW5nIFByb21pc2UgcmVzb2x1dGlvbnNcbiAgICAgIHJldHVybiBwa3RMaXN0Lm1hcCBAIHBrdCA9PlxuICAgICAgICBwcS50aGVuIEAgKCkgPT4gZGlzcGF0Y2hfb25lKHBrdCwgY2hhbm5lbClcblxuICAgIGNvbnN0IGRpc3BhdGNoX29uZSA9IGFzeW5jIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICB0cnkgOjpcbiAgICAgICAgY29uc3QgaWRfcm91dGVyID0gcGt0LmlkX3JvdXRlclxuICAgICAgICBsZXQgZGlzcGF0Y2hfcm91dGUgPSByb3V0ZXMuZ2V0KGlkX3JvdXRlcilcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgIGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIpXG4gICAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgICAgcmV0dXJuIGNoYW5uZWwudW5kZWxpdmVyYWJsZShwa3QsICdyb3V0ZScpXG5cbiAgICAgICAgaWYgZmFsc2UgPT09IGF3YWl0IGRpc3BhdGNoX3JvdXRlKHBrdCwgY2hhbm5lbCkgOjpcbiAgICAgICAgICB0aGlzLnVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpXG4gICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgdGhpcy5vbl9lcnJvcl9pbl9kaXNwYXRjaChlcnIsIHBrdCwgY2hhbm5lbClcblxuICAgIGNvbnN0IHJlc29sdmVSb3V0ZSA9IChpZF9yb3V0ZXIpID0+XG4gICAgICByb3V0ZXMuZ2V0KGlkX3JvdXRlcikgfHxcbiAgICAgICAgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIpXG5cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEA6XG4gICAgICByb3V0ZXM6IEA6IHZhbHVlOiByb3V0ZXNcbiAgICAgIGRpc3BhdGNoOiBAOiB2YWx1ZTogZGlzcGF0Y2hcbiAgICAgIHJlc29sdmVSb3V0ZTogQDogdmFsdWU6IHJlc29sdmVSb3V0ZVxuICAgIHJldHVybiBkaXNwYXRjaFxuXG4gIHJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgIGlmIG51bGwgIT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnZGlzcGF0Y2hfcm91dGUnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgICBlbHNlIHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMucm91dGVzLmhhcyBAIGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiAwID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5pZF9zZWxmID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG5cbiAgICB0aGlzLnJvdXRlcy5zZXQgQCBpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlXG4gICAgcmV0dXJuIHRydWVcbiAgdW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcikgOjpcbiAgICByZXR1cm4gdGhpcy5yb3V0ZXMuZGVsZXRlIEAgaWRfcm91dGVyXG4gIHJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclJvdXRlIEAgaWRfcm91dGVyLCBwa3QgPT4gOjpcbiAgICAgIGlmIDAgIT09IHBrdC50dGwgOjogY2hhbm5lbC5zZW5kUmF3KHBrdClcbiAgdmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgdW52ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgaWYgdGhpcy5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgfHwgY2hhbm5lbC5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgOjpcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgICBlbHNlIGNvbnNvbGUud2FybiBAICdVbnZlcmlmaWVkIHBlZXIgcm91dGUgKGlnbm9yZWQpOicsIEA6IGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIGxvY2FsIHRhcmdldFxuXG4gIHRhcmdldERpc2NvdmVyeSA9IFtdXG4gIGRpc2NvdmVyVGFyZ2V0KHF1ZXJ5KSA6OlxuICAgIHJldHVybiB0aGlzLl9maXJzdFRhcmdldCBAIHF1ZXJ5LCB0aGlzLnRhcmdldERpc2NvdmVyeVxuXG4gIGJpbmREaXNwYXRjaFNlbGYocGt0KSA6OlxuICAgIGNvbnN0IGRpc3BhdGNoU2VsZiA9IGFzeW5jIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICBjb25zdCBpZF90YXJnZXQgPSBwa3QuaWRfdGFyZ2V0XG4gICAgICBsZXQgdGFyZ2V0ID0gdGhpcy50YXJnZXRzLmdldChpZF90YXJnZXQpXG4gICAgICBpZiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgICByZXR1cm4gY2hhbm5lbC51bmRlbGl2ZXJhYmxlKHBrdCwgJ3RhcmdldCcpXG5cbiAgICAgIGlmIGZhbHNlID09PSBhd2FpdCB0YXJnZXQocGt0LCB0aGlzKSA6OlxuICAgICAgICB0aGlzLnVucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0KVxuXG4gICAgdGhpcy5kaXNwYXRjaFNlbGYgPSBkaXNwYXRjaFNlbGZcbiAgICByZXR1cm4gZGlzcGF0Y2hTZWxmXG5cbiAgX2NyZWF0ZVRhcmdldHNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG4gIHRhcmdldHMgPSB0aGlzLl9jcmVhdGVUYXJnZXRzTWFwKClcbiAgcmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0LCB0YXJnZXQpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGlkX3RhcmdldCAmJiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgdGFyZ2V0ID0gaWRfdGFyZ2V0XG4gICAgICBpZF90YXJnZXQgPSB0YXJnZXQuaWRfdGFyZ2V0IHx8IHRhcmdldC5pZFxuXG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHRhcmdldCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAndGFyZ2V0JyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgIGlmICEgTnVtYmVyLmlzU2FmZUludGVnZXIgQCBpZF90YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2lkX3RhcmdldCcgdG8gYmUgYW4gaW50ZWdlcmBcbiAgICBpZiB0aGlzLnRhcmdldHMuaGFzIEAgaWRfdGFyZ2V0IDo6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLnNldCBAIGlkX3RhcmdldCwgdGFyZ2V0XG4gIHVucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0KSA6OlxuICAgIHJldHVybiB0aGlzLnRhcmdldHMuZGVsZXRlIEAgaWRfdGFyZ2V0XG5cblxuXG4gIC8vIC0tLSBEaXNwYXRjaCBjb250cm9sIHBhY2tldHNcblxuICBiaW5kRGlzcGF0Y2hDb250cm9sKCkgOjpcbiAgICByZXR1cm4gKHBrdCwgY2hhbm5lbCkgPT4gOjpcbiAgICAgIGlmIDAgIT09IHBrdC5pZF90YXJnZXQgOjogLy8gY29ubmVjdGlvbi1kaXNwYXRjaGVkXG4gICAgICAgIHJldHVybiB0aGlzLmRpc3BhdGNoU2VsZihwa3QsIGNoYW5uZWwpXG5cbiAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLmRpc3BDb250cm9sQnlUeXBlW3BrdC50eXBlXVxuICAgICAgaWYgdW5kZWZpbmVkICE9PSBoYW5kbGVyIDo6XG4gICAgICAgIHJldHVybiBoYW5kbGVyKHRoaXMsIHBrdCwgY2hhbm5lbClcbiAgICAgIGVsc2UgOjpcbiAgICAgICAgcmV0dXJuIHRoaXMuZG51X2Rpc3BhdGNoX2NvbnRyb2wocGt0LCBjaGFubmVsKVxuXG4gIGRpc3BDb250cm9sQnlUeXBlID0gT2JqZWN0LmNyZWF0ZSBAIHRoaXMuZGlzcENvbnRyb2xCeVR5cGVcbiAgZG51X2Rpc3BhdGNoX2NvbnRyb2wocGt0LCBjaGFubmVsKSA6OlxuICAgIGNvbnNvbGUud2FybiBAICdkbnVfZGlzcGF0Y2hfY29udHJvbCcsIHBrdC50eXBlLCBwa3RcblxuXG5PYmplY3QuYXNzaWduIEAgUm91dGVyLnByb3RvdHlwZSwgQHt9XG4gIGRpc3BDb250cm9sQnlUeXBlOiBPYmplY3QuYXNzaWduIEAge31cbiAgICBkaXNwQ29udHJvbEJ5VHlwZVxuXG4gIGJpbmRQcm9taXNlRmlyc3RSZXN1bHRcbiAgX2ZpcnN0Um91dGU6IGJpbmRQcm9taXNlRmlyc3RSZXN1bHQoKVxuICBfZmlyc3RUYXJnZXQ6IGJpbmRQcm9taXNlRmlyc3RSZXN1bHQoKVxuXG5leHBvcnQgZGVmYXVsdCBSb3V0ZXJcblxuXG5leHBvcnQgZnVuY3Rpb24gcHJvbWlzZVF1ZXVlKCkgOjpcbiAgbGV0IHRpcCA9IG51bGxcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIDo6XG4gICAgaWYgbnVsbCA9PT0gdGlwIDo6XG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgdGlwLnRoZW4gQCBjbGVhcl90aXBcbiAgICByZXR1cm4gdGlwXG5cbiAgZnVuY3Rpb24gY2xlYXJfdGlwKCkgOjpcbiAgICB0aXAgPSBudWxsXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0KG9wdGlvbnM9e30pIDo6XG4gIGNvbnN0IG9uX2Vycm9yID0gb3B0aW9ucy5vbl9lcnJvciB8fCBjb25zb2xlLmVycm9yXG4gIGNvbnN0IGlmQWJzZW50ID0gb3B0aW9ucy5hYnNlbnQgfHwgbnVsbFxuXG4gIHJldHVybiAodGlwLCBsc3RGbnMpID0+XG4gICAgbmV3IFByb21pc2UgQCByZXNvbHZlID0+OjpcbiAgICAgIHRpcCA9IFByb21pc2UucmVzb2x2ZSh0aXApXG4gICAgICBQcm9taXNlLmFsbCBAXG4gICAgICAgIEFycmF5LmZyb20gQCBsc3RGbnMsIGZuID0+XG4gICAgICAgICAgdGlwLnRoZW4oZm4pLnRoZW4ocmVzb2x2ZSwgb25fZXJyb3IpXG4gICAgICAudGhlbiBAIGFic2VudCwgYWJzZW50XG5cbiAgICAgIGZ1bmN0aW9uIGFic2VudCgpIDo6XG4gICAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpZkFic2VudCA6OlxuICAgICAgICAgIHJlc29sdmUgQCBpZkFic2VudCgpXG4gICAgICAgIGVsc2UgcmVzb2x2ZSBAIGlmQWJzZW50XG4iLCJpbXBvcnQge3NlbmRfaGVsbG8sIHNlbmRfcGluZ3Bvbmd9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cblxuZXhwb3J0IGNsYXNzIENoYW5uZWwgOjpcbiAgc2VuZFJhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuICBwYWNrUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG5cbiAgcGFja0FuZFNlbmRSYXcoLi4uYXJncykgOjpcbiAgICByZXR1cm4gdGhpcy5zZW5kUmF3IEAgdGhpcy5wYWNrUmF3IEAgLi4uYXJnc1xuXG4gIHNlbmRKU09OKHBrdF9vYmopIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja0pTT04gQCBwa3Rfb2JqXG4gIHBhY2tKU09OKHBrdF9vYmopIDo6XG4gICAgaWYgdW5kZWZpbmVkICE9PSBwa3Rfb2JqLmhlYWRlciA6OlxuICAgICAgcGt0X29iai5oZWFkZXIgPSBKU09OLnN0cmluZ2lmeSBAIHBrdF9vYmouaGVhZGVyXG4gICAgaWYgdW5kZWZpbmVkICE9PSBwa3Rfb2JqLmJvZHkgOjpcbiAgICAgIHBrdF9vYmouYm9keSA9IEpTT04uc3RyaW5naWZ5IEAgcGt0X29iai5ib2R5XG4gICAgcmV0dXJuIHRoaXMucGFja1Jhdyhwa3Rfb2JqKVxuXG5cbiAgLy8gLS0tIENvbnRyb2wgbWVzc2FnZSB1dGlsaXRpZXNcblxuICBzZW5kUm91dGluZ0hhbmRzaGFrZSgpIDo6XG4gICAgcmV0dXJuIHNlbmRfaGVsbG8odGhpcywgdGhpcy5yb3V0ZXIuZWNfcHViX2lkKVxuICBzZW5kUGluZygpIDo6XG4gICAgcmV0dXJuIHNlbmRfcGluZ3BvbmcodGhpcylcblxuXG4gIGNsb25lKHByb3BzLCAuLi5leHRyYSkgOjpcbiAgICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSh0aGlzLCBwcm9wcylcbiAgICByZXR1cm4gMCA9PT0gZXh0cmEubGVuZ3RoID8gc2VsZiA6IE9iamVjdC5hc3NpZ24oc2VsZiwgLi4uZXh0cmEpXG4gIGJpbmRDaGFubmVsKHNlbmRSYXcsIHByb3BzKSA6OiByZXR1cm4gYmluZENoYW5uZWwodGhpcywgc2VuZFJhdywgcHJvcHMpXG4gIGJpbmREaXNwYXRjaFBhY2tldHMoKSA6OiByZXR1cm4gYmluZERpc3BhdGNoUGFja2V0cyh0aGlzKVxuXG4gIHVuZGVsaXZlcmFibGUocGt0LCBtb2RlKSA6OlxuICAgIGNvbnNvbGUud2FybiBAICd1bmRlbGl2ZXJhYmxlOicsIHBrdCwgbW9kZVxuXG4gIHN0YXRpYyBhc0FQSShodWIsIHJvdXRlciwgcGFja1JhdykgOjpcbiAgICBjb25zdCBzZWxmID0gbmV3IHRoaXMoKVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgc2VsZiwgQDpcbiAgICAgIHBhY2tSYXc6IEA6IHZhbHVlOiBwYWNrUmF3XG4gICAgICByb3V0ZXI6IEA6IHZhbHVlOiByb3V0ZXJcbiAgICAgIGh1YjogQDogdmFsdWU6IGh1YlxuICAgICAgX3Jvb3RfOiBAOiB2YWx1ZTogc2VsZlxuICAgIHJldHVybiBzZWxmXG5cbiAgc3RhdGljIGFzQ2hhbm5lbEFQSShodWIsIHJvdXRlciwgcGFja2V0UGFyc2VyKSA6OlxuICAgIGNvbnN0IHNlbGYgPSB0aGlzLmFzQVBJIEAgaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlci5wYWNrUGFja2V0XG4gICAgcmV0dXJuIHNlbGZcblxuICBzdGF0aWMgYXNJbnRlcm5hbEFQSShodWIsIHJvdXRlciwgcGFja2V0UGFyc2VyKSA6OlxuICAgIGNvbnN0IHNlbGYgPSB0aGlzLmFzQVBJIEAgaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlci5wYWNrUGFja2V0T2JqXG4gICAgcmV0dXJuIHNlbGYuYmluZENoYW5uZWwgQCBiaW5kRGlzcGF0Y2hJbnRlcm5hbFBhY2tldChyb3V0ZXIpXG5cbmV4cG9ydCBkZWZhdWx0IENoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kQ2hhbm5lbChjaGFubmVsLCBzZW5kUmF3LCBwcm9wcykgOjpcbiAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHNlbmRSYXcgOjpcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYENoYW5uZWwgZXhwZWN0cyAnc2VuZFJhdycgZnVuY3Rpb24gcGFyYW1ldGVyYFxuXG4gIGNvbnN0IGNvcmVfcHJvcHMgPSBAOiBzZW5kUmF3OiBAe30gdmFsdWU6IHNlbmRSYXdcbiAgcHJvcHMgPSBudWxsID09IHByb3BzID8gY29yZV9wcm9wcyA6IE9iamVjdC5hc3NpZ24gQCBjb3JlX3Byb3BzLCBwcm9wc1xuXG4gIGNvbnN0IHNlbGYgPSBPYmplY3QuY3JlYXRlIEAgY2hhbm5lbCwgcHJvcHNcbiAgcmV0dXJuIHNlbmRSYXcuY2hhbm5lbCA9IHNlbGZcblxuXG5leHBvcnQgZnVuY3Rpb24gYmluZERpc3BhdGNoSW50ZXJuYWxQYWNrZXQocm91dGVyKSA6OlxuICBjb25zdCBkaXNwYXRjaCA9IHJvdXRlci5kaXNwYXRjaFxuICByZXR1cm4gZGlzcGF0Y2hfcGt0X29ialxuXG4gIGZ1bmN0aW9uIGRpc3BhdGNoX3BrdF9vYmoocGt0KSA6OlxuICAgIGlmIHVuZGVmaW5lZCA9PT0gcGt0Ll9yYXdfIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkIGEgcGFyc2VkIHBrdF9vYmogd2l0aCB2YWxpZCAnX3Jhd18nIGJ1ZmZlciBwcm9wZXJ0eWBcbiAgICBkaXNwYXRjaCBAIFtwa3RdLCBkaXNwYXRjaF9wa3Rfb2JqLmNoYW5uZWxcbiAgICByZXR1cm4gdHJ1ZVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kRGlzcGF0Y2hQYWNrZXRzKGNoYW5uZWwpIDo6XG4gIGNvbnN0IGRpc3BhdGNoID0gY2hhbm5lbC5yb3V0ZXIuZGlzcGF0Y2hcbiAgY29uc3QgZmVlZCA9IGNoYW5uZWwuaHViLnBhY2tldFBhcnNlci5wYWNrZXRTdHJlYW0oKVxuXG4gIHJldHVybiBmdW5jdGlvbiBvbl9yZWN2X2RhdGEoZGF0YSkgOjpcbiAgICBjb25zdCBwa3RMaXN0ID0gZmVlZChkYXRhKVxuICAgIGlmIDAgPCBwa3RMaXN0Lmxlbmd0aCA6OlxuICAgICAgZGlzcGF0Y2ggQCBwa3RMaXN0LCBjaGFubmVsXG4iLCJpbXBvcnQge1JvdXRlcn0gZnJvbSAnLi9yb3V0ZXIuanN5J1xuaW1wb3J0IHtDaGFubmVsfSBmcm9tICcuL2NoYW5uZWwuanN5J1xuXG5leHBvcnQgY2xhc3MgRmFicmljSHViIDo6XG4gIGNvbnN0cnVjdG9yKCkgOjpcbiAgICBhcHBseVBsdWdpbnMgQCAncHJlJywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG5cbiAgICBjb25zdCBwYWNrZXRQYXJzZXIgPSB0aGlzLnBhY2tldFBhcnNlclxuICAgIGlmIG51bGw9PXBhY2tldFBhcnNlciB8fCAhIHBhY2tldFBhcnNlci5pc1BhY2tldFBhcnNlcigpIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEludmFsaWQgaHViLnBhY2tldFBhcnNlcmBcblxuICAgIGNvbnN0IHJvdXRlciA9IHRoaXMuX2luaXRfcm91dGVyKClcbiAgICBjb25zdCBfYXBpX2NoYW5uZWwgPSB0aGlzLl9pbml0X2NoYW5uZWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpXG4gICAgY29uc3QgX2FwaV9pbnRlcm5hbCA9IHRoaXMuX2luaXRfaW50ZXJuYWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAe31cbiAgICAgIHJvdXRlcjogQHt9IHZhbHVlOiByb3V0ZXJcbiAgICAgIHBhY2tldFBhcnNlcjogQHt9IHZhbHVlOiBwYWNrZXRQYXJzZXJcbiAgICAgIF9hcGlfY2hhbm5lbDogQHt9IHZhbHVlOiBfYXBpX2NoYW5uZWxcbiAgICAgIF9hcGlfaW50ZXJuYWw6IEB7fSB2YWx1ZTogX2FwaV9pbnRlcm5hbFxuXG4gICAgYXBwbHlQbHVnaW5zIEAgbnVsbCwgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3Bvc3QnLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICByZXR1cm4gdGhpc1xuXG4gIF9pbml0X3JvdXRlcigpIDo6IHRocm93IG5ldyBFcnJvciBAIGBQbHVnaW4gcmVzcG9uc2libGl0eWBcblxuICBfaW5pdF9jaGFubmVsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiBDaGFubmVsLmFzQ2hhbm5lbEFQSSBAXG4gICAgICB0aGlzLCByb3V0ZXIsIHBhY2tldFBhcnNlclxuICBfaW5pdF9pbnRlcm5hbEFQSShyb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gQ2hhbm5lbC5hc0ludGVybmFsQVBJIEBcbiAgICAgIHRoaXMsIHJvdXRlciwgcGFja2V0UGFyc2VyXG5cblxuICBzdGF0aWMgcGx1Z2luKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICByZXR1cm4gdGhpcy5wbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucylcbiAgc3RhdGljIHBsdWdpbnMoLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIGNvbnN0IHBsdWdpbkxpc3QgPSBbXS5jb25jYXQgQFxuICAgICAgdGhpcy5wcm90b3R5cGUucGx1Z2luTGlzdCB8fCBbXVxuICAgICAgcGx1Z2luRnVuY3Rpb25zXG5cbiAgICBwbHVnaW5MaXN0LnNvcnQgQCAoYSwgYikgPT4gKDAgfCBhLm9yZGVyKSAtICgwIHwgYi5vcmRlcilcblxuICAgIGNvbnN0IEJhc2VIdWIgPSB0aGlzLl9CYXNlSHViXyB8fCB0aGlzXG4gICAgY2xhc3MgRmFicmljSHViX1BJIGV4dGVuZHMgQmFzZUh1YiA6OlxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgRmFicmljSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBsdWdpbkxpc3Q6IEB7fSB2YWx1ZTogT2JqZWN0LmZyZWV6ZSBAIHBsdWdpbkxpc3RcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIEZhYnJpY0h1Yl9QSSwgQDpcbiAgICAgIF9CYXNlSHViXzogQHt9IHZhbHVlOiBCYXNlSHViXG5cbiAgICBhcHBseVBsdWdpbnMgQCAnc3ViY2xhc3MnLCBwbHVnaW5MaXN0LCBGYWJyaWNIdWJfUEksIEA6IFJvdXRlciwgQ2hhbm5lbFxuICAgIHJldHVybiBGYWJyaWNIdWJfUElcblxuXG4gIGdldCBpZF9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBpZF9yb3V0ZXJfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMucGFja2V0UGFyc2VyLnBhY2tJZCBAXG4gICAgICB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGNvbm5lY3Rfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMuX2FwaV9pbnRlcm5hbC5jbG9uZSgpXG5cbiAgY29ubmVjdChjb25uX3VybCkgOjpcbiAgICBpZiBudWxsID09IGNvbm5fdXJsIDo6XG4gICAgICByZXR1cm4gdGhpcy5jb25uZWN0X3NlbGYoKVxuXG4gICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBjb25uX3VybCA6OlxuICAgICAgY29ubl91cmwgPSB0aGlzLl9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpXG5cbiAgICBjb25zdCBjb25uZWN0ID0gdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xbY29ubl91cmwucHJvdG9jb2xdXG4gICAgaWYgISBjb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IgQCBgQ29ubmVjdGlvbiBwcm90b2NvbCBcIiR7Y29ubl91cmwucHJvdG9jb2x9XCIgbm90IHJlZ2lzdGVyZWQgZm9yIFwiJHtjb25uX3VybC50b1N0cmluZygpfVwiYFxuXG4gICAgcmV0dXJuIGNvbm5lY3QoY29ubl91cmwpXG5cbiAgcmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wocHJvdG9jb2wsIGNiX2Nvbm5lY3QpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNiX2Nvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2NiX2Nvbm5lY3QnIGZ1bmN0aW9uYFxuICAgIGNvbnN0IGJ5UHJvdG9jb2wgPSBPYmplY3QuYXNzaWduIEAge30sIHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sXG4gICAgYnlQcm90b2NvbFtwcm90b2NvbF0gPSBjYl9jb25uZWN0XG4gICAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIHRoaXMsICdfY29ubmVjdEJ5UHJvdG9jb2wnLFxuICAgICAgQDogdmFsdWU6IGJ5UHJvdG9jb2wsIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuXG4gIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgcmV0dXJuIG5ldyBVUkwoY29ubl91cmwpXG5cbmV4cG9ydCBkZWZhdWx0IEZhYnJpY0h1YlxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlQbHVnaW5zKGtleSwgcGx1Z2luTGlzdCwgLi4uYXJncykgOjpcbiAgaWYgISBrZXkgOjoga2V5ID0gbnVsbFxuICBmb3IgbGV0IHBsdWdpbiBvZiBwbHVnaW5MaXN0IDo6XG4gICAgaWYgbnVsbCAhPT0ga2V5IDo6IHBsdWdpbiA9IHBsdWdpbltrZXldXG4gICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIHBsdWdpbiA6OlxuICAgICAgcGx1Z2luKC4uLmFyZ3MpXG4iXSwibmFtZXMiOlsiZGlzcENvbnRyb2xCeVR5cGUiLCJyZWN2X2hlbGxvIiwicmVjdl9vbGxlaCIsInJlY3ZfcG9uZyIsInJlY3ZfcGluZyIsInNlbmRfaGVsbG8iLCJjaGFubmVsIiwiZWNfcHViX2lkIiwicm91dGVyIiwicGFja0FuZFNlbmRSYXciLCJ0eXBlIiwiaHViIiwiaWRfcm91dGVyX3NlbGYiLCJwa3QiLCJlY19vdGhlcl9pZCIsImhlYWRlcl9idWZmZXIiLCJsZW5ndGgiLCJlY19pZF9obWFjIiwiaG1hY19zZWNyZXQiLCJpZF9yb3V0ZXIiLCJ1bnBhY2tJZCIsImJvZHlfYnVmZmVyIiwidW52ZXJpZmllZFBlZXJSb3V0ZSIsInNlbmRfb2xsZWgiLCJwZWVyX2htYWNfY2xhaW0iLCJjb21wYXJlIiwidmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX3Bpbmdwb25nIiwicG9uZyIsIkRhdGUiLCJ0b0lTT1N0cmluZyIsImxvY2FsIiwicmVtb3RlIiwidG9TdHJpbmciLCJkZWx0YSIsInRzX3BvbmciLCJlcnIiLCJ0c19waW5nIiwiUm91dGVyIiwiaWRfc2VsZiIsInJvdXRlRGlzY292ZXJ5IiwidGFyZ2V0RGlzY292ZXJ5IiwidGFyZ2V0cyIsIl9jcmVhdGVUYXJnZXRzTWFwIiwiT2JqZWN0IiwiY3JlYXRlIiwiZGVmaW5lUHJvcGVydGllcyIsInZhbHVlIiwiX2luaXREaXNwYXRjaCIsInJvdXRlcyIsIl9jcmVhdGVSb3V0ZXNNYXAiLCJzZXQiLCJiaW5kRGlzcGF0Y2hDb250cm9sIiwiYmluZERpc3BhdGNoU2VsZiIsImJpbmREaXNwYXRjaFJvdXRlcyIsImVycm9yIiwiTWFwIiwiZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUiLCJkaXNwYXRjaF9yb3V0ZSIsIl9maXJzdFJvdXRlIiwicmVnaXN0ZXJSb3V0ZSIsInBxdWV1ZSIsInByb21pc2VRdWV1ZSIsImRpc3BhdGNoIiwicGt0TGlzdCIsInBxIiwibWFwIiwidGhlbiIsImRpc3BhdGNoX29uZSIsImdldCIsInVuZGVmaW5lZCIsInVuZGVsaXZlcmFibGUiLCJ1bnJlZ2lzdGVyUm91dGUiLCJvbl9lcnJvcl9pbl9kaXNwYXRjaCIsInJlc29sdmVSb3V0ZSIsIlR5cGVFcnJvciIsImhhcyIsImRlbGV0ZSIsInR0bCIsInNlbmRSYXciLCJyZWdpc3RlclBlZXJSb3V0ZSIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsImNvbnNvbGUiLCJ3YXJuIiwicXVlcnkiLCJfZmlyc3RUYXJnZXQiLCJkaXNwYXRjaFNlbGYiLCJpZF90YXJnZXQiLCJ0YXJnZXQiLCJ1bnJlZ2lzdGVyVGFyZ2V0IiwiaWQiLCJOdW1iZXIiLCJpc1NhZmVJbnRlZ2VyIiwiaGFuZGxlciIsImRudV9kaXNwYXRjaF9jb250cm9sIiwiYXNzaWduIiwicHJvdG90eXBlIiwiYmluZFByb21pc2VGaXJzdFJlc3VsdCIsInRpcCIsIlByb21pc2UiLCJyZXNvbHZlIiwiY2xlYXJfdGlwIiwib3B0aW9ucyIsIm9uX2Vycm9yIiwiaWZBYnNlbnQiLCJhYnNlbnQiLCJsc3RGbnMiLCJhbGwiLCJBcnJheSIsImZyb20iLCJmbiIsIkNoYW5uZWwiLCJFcnJvciIsImFyZ3MiLCJwYWNrUmF3IiwicGt0X29iaiIsInBhY2tKU09OIiwiaGVhZGVyIiwiSlNPTiIsInN0cmluZ2lmeSIsImJvZHkiLCJwcm9wcyIsImV4dHJhIiwic2VsZiIsImJpbmRDaGFubmVsIiwiYmluZERpc3BhdGNoUGFja2V0cyIsIm1vZGUiLCJhc0FQSSIsImFzQ2hhbm5lbEFQSSIsInBhY2tldFBhcnNlciIsInBhY2tQYWNrZXQiLCJhc0ludGVybmFsQVBJIiwicGFja1BhY2tldE9iaiIsImJpbmREaXNwYXRjaEludGVybmFsUGFja2V0IiwiY29yZV9wcm9wcyIsImRpc3BhdGNoX3BrdF9vYmoiLCJfcmF3XyIsImZlZWQiLCJwYWNrZXRTdHJlYW0iLCJvbl9yZWN2X2RhdGEiLCJkYXRhIiwiRmFicmljSHViIiwicGx1Z2luTGlzdCIsImlzUGFja2V0UGFyc2VyIiwiX2luaXRfcm91dGVyIiwiX2FwaV9jaGFubmVsIiwiX2luaXRfY2hhbm5lbEFQSSIsIl9hcGlfaW50ZXJuYWwiLCJfaW5pdF9pbnRlcm5hbEFQSSIsInBsdWdpbiIsInBsdWdpbkZ1bmN0aW9ucyIsInBsdWdpbnMiLCJjb25jYXQiLCJzb3J0IiwiYSIsImIiLCJvcmRlciIsIkJhc2VIdWIiLCJfQmFzZUh1Yl8iLCJGYWJyaWNIdWJfUEkiLCJmcmVlemUiLCJwYWNrSWQiLCJjbG9uZSIsImNvbm5fdXJsIiwiY29ubmVjdF9zZWxmIiwiX3BhcnNlQ29ubmVjdFVSTCIsImNvbm5lY3QiLCJfY29ubmVjdEJ5UHJvdG9jb2wiLCJwcm90b2NvbCIsImNiX2Nvbm5lY3QiLCJieVByb3RvY29sIiwiZGVmaW5lUHJvcGVydHkiLCJjb25maWd1cmFibGUiLCJVUkwiLCJhcHBseVBsdWdpbnMiLCJrZXkiXSwibWFwcGluZ3MiOiI7Ozs7QUFBTyxNQUFNQSxvQkFBb0I7R0FDOUIsSUFBRCxHQUFRQyxVQUR1QjtHQUU5QixJQUFELEdBQVFDLFVBRnVCO0dBRzlCLElBQUQsR0FBUUMsU0FIdUI7R0FJOUIsSUFBRCxHQUFRQyxTQUp1QixFQUExQjs7QUFRUCxBQUFPLFNBQVNDLFVBQVQsQ0FBb0JDLE9BQXBCLEVBQTZCO1FBQzVCLEVBQUNDLFNBQUQsS0FBY0QsUUFBUUUsTUFBNUI7U0FDT0YsUUFBUUcsY0FBUixDQUF5QjtlQUNuQixDQURtQixFQUNoQkMsTUFBTSxJQURVO1lBRXRCSCxTQUZzQjtVQUd4QkQsUUFBUUssR0FBUixDQUFZQyxjQUFaLEVBSHdCLEVBQXpCLENBQVA7OztBQUtGLFNBQVNYLFVBQVQsQ0FBb0JPLE1BQXBCLEVBQTRCSyxHQUE1QixFQUFpQ1AsT0FBakMsRUFBMEM7UUFDbENRLGNBQWNELElBQUlFLGFBQUosRUFBcEI7TUFDRyxNQUFNRCxZQUFZRSxNQUFsQixJQUE0QlIsT0FBT1MsVUFBdEMsRUFBbUQ7VUFDM0NDLGNBQWNWLE9BQU9TLFVBQVAsR0FDaEJULE9BQU9TLFVBQVAsQ0FBa0JILFdBQWxCLENBRGdCLEdBQ2lCLElBRHJDO2VBRWFSLE9BQWIsRUFBc0JZLFdBQXRCO0dBSEYsTUFLSztVQUNHQyxZQUFZTixJQUFJTyxRQUFKLENBQWFQLElBQUlRLFdBQUosRUFBYixFQUFnQyxDQUFoQyxDQUFsQjtXQUNPQyxtQkFBUCxDQUE2QkgsU0FBN0IsRUFBd0NiLE9BQXhDOzs7O0FBR0osU0FBU2lCLFVBQVQsQ0FBb0JqQixPQUFwQixFQUE2Qlks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
