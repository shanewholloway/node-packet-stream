(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(factory((global['msg-fabric-core'] = {})));
}(this, (function (exports) { 'use strict';

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

Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgudW1kLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL2NvbnRyb2xfcHJvdG9jb2wuanN5IiwiLi4vY29kZS9yb3V0ZXIuanN5IiwiLi4vY29kZS9jaGFubmVsLmpzeSIsIi4uL2NvZGUvaHViLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY29uc3QgZGlzcENvbnRyb2xCeVR5cGUgPSBAe31cbiAgWzB4ZjBdOiByZWN2X2hlbGxvXG4gIFsweGYxXTogcmVjdl9vbGxlaFxuICBbMHhmZV06IHJlY3ZfcG9uZ1xuICBbMHhmZl06IHJlY3ZfcGluZ1xuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfaGVsbG8oY2hhbm5lbCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgaWYgMCAhPT0gZWNfb3RoZXJfaWQubGVuZ3RoICYmIHJvdXRlci5lY19pZF9obWFjIDo6XG4gICAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCkgOiBudWxsXG4gICAgc2VuZF9vbGxlaCBAIGNoYW5uZWwsIGhtYWNfc2VjcmV0XG5cbiAgZWxzZSA6OlxuICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChwa3QuYm9keV9idWZmZXIoKSwgMClcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbmZ1bmN0aW9uIHNlbmRfb2xsZWgoY2hhbm5lbCwgaG1hY19zZWNyZXQpIDo6XG4gIGNvbnN0IHtlY19wdWJfaWR9ID0gY2hhbm5lbC5yb3V0ZXJcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IDB4ZjFcbiAgICBoZWFkZXI6IGVjX3B1Yl9pZFxuICAgIGJvZHk6IGhtYWNfc2VjcmV0XG5cbmZ1bmN0aW9uIHJlY3Zfb2xsZWgocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gcGt0LmhlYWRlcl9idWZmZXIoKVxuICBjb25zdCBpZF9yb3V0ZXIgPSBwa3QudW5wYWNrSWQoZWNfb3RoZXJfaWQpXG5cbiAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgID8gcm91dGVyLmVjX2lkX2htYWMoZWNfb3RoZXJfaWQsIHRydWUpIDogbnVsbFxuICBjb25zdCBwZWVyX2htYWNfY2xhaW0gPSBwa3QuYm9keV9idWZmZXIoKVxuICBpZiBobWFjX3NlY3JldCAmJiAwID09PSBobWFjX3NlY3JldC5jb21wYXJlIEAgcGVlcl9obWFjX2NsYWltIDo6XG4gICAgcm91dGVyLnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG4gIGVsc2UgOjpcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfcGluZ3BvbmcoY2hhbm5lbCwgcG9uZykgOjpcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IHBvbmcgPyAweGZlIDogMHhmZlxuICAgIGJvZHk6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG5mdW5jdGlvbiByZWN2X3Bvbmcocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGxvY2FsID0gbmV3IERhdGUoKVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgcGt0LmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BvbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGxvY2FsXG5cbmZ1bmN0aW9uIHJlY3ZfcGluZyhyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgc2VuZF9waW5ncG9uZyBAIGNoYW5uZWwsIHRydWVcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIHBrdC5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBsb2NhbFxuXG4iLCJpbXBvcnQge2Rpc3BDb250cm9sQnlUeXBlfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5leHBvcnQgY2xhc3MgUm91dGVyIDo6XG4gIGNvbnN0cnVjdG9yKGlkX3NlbGYpIDo6XG4gICAgaWYgaWRfc2VsZiA6OlxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOiBpZF9zZWxmOiBAOiB2YWx1ZTogaWRfc2VsZlxuICAgICAgdGhpcy5faW5pdERpc3BhdGNoKClcblxuICAvLyAtLS0gRGlzcGF0Y2ggY29yZSAtLS1cblxuICBfaW5pdERpc3BhdGNoKCkgOjpcbiAgICBjb25zdCByb3V0ZXMgPSB0aGlzLl9jcmVhdGVSb3V0ZXNNYXAoKVxuICAgIHJvdXRlcy5zZXQgQCAwLCB0aGlzLmJpbmREaXNwYXRjaENvbnRyb2woKVxuICAgIGlmIG51bGwgIT0gdGhpcy5pZF9zZWxmIDo6XG4gICAgICByb3V0ZXMuc2V0IEAgdGhpcy5pZF9zZWxmLCB0aGlzLmJpbmREaXNwYXRjaFNlbGYoKVxuXG4gICAgdGhpcy5iaW5kRGlzcGF0Y2hSb3V0ZXMocm91dGVzKVxuXG4gIG9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgcGt0KSA6OlxuICAgIGNvbnNvbGUuZXJyb3IgQCAnRXJyb3IgZHVyaW5nIHBhY2tldCBkaXNwYXRjaFxcbiAgcGt0OicsIHBrdCwgJ1xcbicsIGVyciwgJ1xcbidcblxuICBfY3JlYXRlUm91dGVzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byByb3V0ZSAtLS1cblxuICByb3V0ZURpc2NvdmVyeSA9IFtdXG4gIGFzeW5jIGRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlcikgOjpcbiAgICBjb25zdCBkaXNwYXRjaF9yb3V0ZSA9IGF3YWl0IHRoaXMuX2ZpcnN0Um91dGUgQCBpZF9yb3V0ZXIsIHRoaXMucm91dGVEaXNjb3ZlcnlcbiAgICBpZiBudWxsID09IGRpc3BhdGNoX3JvdXRlIDo6IHJldHVyblxuICAgIHRoaXMucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlKVxuICAgIHJldHVybiBkaXNwYXRjaF9yb3V0ZVxuXG4gIGJpbmREaXNwYXRjaFJvdXRlcyhyb3V0ZXMpIDo6XG4gICAgY29uc3QgcHF1ZXVlID0gcHJvbWlzZVF1ZXVlKClcbiAgICBmdW5jdGlvbiBkaXNwYXRjaChwa3RMaXN0LCBjaGFubmVsKSA6OlxuICAgICAgY29uc3QgcHEgPSBwcXVldWUoKSAvLyBwcSB3aWxsIGRpc3BhdGNoIGR1cmluZyBQcm9taXNlIHJlc29sdXRpb25zXG4gICAgICByZXR1cm4gcGt0TGlzdC5tYXAgQCBwa3QgPT5cbiAgICAgICAgcHEudGhlbiBAICgpID0+IGRpc3BhdGNoX29uZShwa3QsIGNoYW5uZWwpXG5cbiAgICBjb25zdCBkaXNwYXRjaF9vbmUgPSBhc3luYyAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgdHJ5IDo6XG4gICAgICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC5pZF9yb3V0ZXJcbiAgICAgICAgbGV0IGRpc3BhdGNoX3JvdXRlID0gcm91dGVzLmdldChpZF9yb3V0ZXIpXG4gICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgICBkaXNwYXRjaF9yb3V0ZSA9IGF3YWl0IHRoaXMuZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyKVxuICAgICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgICAgIHJldHVybiBjaGFubmVsLnVuZGVsaXZlcmFibGUocGt0LCAncm91dGUnKVxuXG4gICAgICAgIGlmIGZhbHNlID09PSBhd2FpdCBkaXNwYXRjaF9yb3V0ZShwa3QsIGNoYW5uZWwpIDo6XG4gICAgICAgICAgdGhpcy51bnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHRoaXMub25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBwa3QsIGNoYW5uZWwpXG5cbiAgICBjb25zdCByZXNvbHZlUm91dGUgPSAoaWRfcm91dGVyKSA9PlxuICAgICAgcm91dGVzLmdldChpZF9yb3V0ZXIpIHx8XG4gICAgICAgIHRoaXMuZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyKVxuXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOlxuICAgICAgcm91dGVzOiBAOiB2YWx1ZTogcm91dGVzXG4gICAgICBkaXNwYXRjaDogQDogdmFsdWU6IGRpc3BhdGNoXG4gICAgICByZXNvbHZlUm91dGU6IEA6IHZhbHVlOiByZXNvbHZlUm91dGVcbiAgICByZXR1cm4gZGlzcGF0Y2hcblxuICByZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICBpZiBudWxsICE9IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2Rpc3BhdGNoX3JvdXRlJyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgICAgZWxzZSByZXR1cm4gZmFsc2VcbiAgICBpZiB0aGlzLnJvdXRlcy5oYXMgQCBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgMCA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMuaWRfc2VsZiA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuXG4gICAgdGhpcy5yb3V0ZXMuc2V0IEAgaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZVxuICAgIHJldHVybiB0cnVlXG4gIHVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpIDo6XG4gICAgcmV0dXJuIHRoaXMucm91dGVzLmRlbGV0ZSBAIGlkX3JvdXRlclxuICByZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJSb3V0ZSBAIGlkX3JvdXRlciwgcGt0ID0+IDo6XG4gICAgICBpZiAwICE9PSBwa3QudHRsIDo6IGNoYW5uZWwuc2VuZFJhdyhwa3QpXG4gIHZlcmlmaWVkUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gIHVudmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIGlmIHRoaXMuYWxsb3dVbnZlcmlmaWVkUm91dGVzIHx8IGNoYW5uZWwuYWxsb3dVbnZlcmlmaWVkUm91dGVzIDo6XG4gICAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gICAgZWxzZSBjb25zb2xlLndhcm4gQCAnVW52ZXJpZmllZCBwZWVyIHJvdXRlIChpZ25vcmVkKTonLCBAOiBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byBsb2NhbCB0YXJnZXRcblxuICB0YXJnZXREaXNjb3ZlcnkgPSBbXVxuICBkaXNjb3ZlclRhcmdldChxdWVyeSkgOjpcbiAgICByZXR1cm4gdGhpcy5fZmlyc3RUYXJnZXQgQCBxdWVyeSwgdGhpcy50YXJnZXREaXNjb3ZlcnlcblxuICBiaW5kRGlzcGF0Y2hTZWxmKHBrdCkgOjpcbiAgICBjb25zdCBkaXNwYXRjaFNlbGYgPSBhc3luYyAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgY29uc3QgaWRfdGFyZ2V0ID0gcGt0LmlkX3RhcmdldFxuICAgICAgbGV0IHRhcmdldCA9IHRoaXMudGFyZ2V0cy5nZXQoaWRfdGFyZ2V0KVxuICAgICAgaWYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgICAgcmV0dXJuIGNoYW5uZWwudW5kZWxpdmVyYWJsZShwa3QsICd0YXJnZXQnKVxuXG4gICAgICBpZiBmYWxzZSA9PT0gYXdhaXQgdGFyZ2V0KHBrdCwgdGhpcykgOjpcbiAgICAgICAgdGhpcy51bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldClcblxuICAgIHRoaXMuZGlzcGF0Y2hTZWxmID0gZGlzcGF0Y2hTZWxmXG4gICAgcmV0dXJuIGRpc3BhdGNoU2VsZlxuXG4gIF9jcmVhdGVUYXJnZXRzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuICB0YXJnZXRzID0gdGhpcy5fY3JlYXRlVGFyZ2V0c01hcCgpXG4gIHJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCwgdGFyZ2V0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpZF90YXJnZXQgJiYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgIHRhcmdldCA9IGlkX3RhcmdldFxuICAgICAgaWRfdGFyZ2V0ID0gdGFyZ2V0LmlkX3RhcmdldCB8fCB0YXJnZXQuaWRcblxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiB0YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ3RhcmdldCcgdG8gYmUgYSBmdW5jdGlvbmBcbiAgICBpZiAhIE51bWJlci5pc1NhZmVJbnRlZ2VyIEAgaWRfdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdpZF90YXJnZXQnIHRvIGJlIGFuIGludGVnZXJgXG4gICAgaWYgdGhpcy50YXJnZXRzLmhhcyBAIGlkX3RhcmdldCA6OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5zZXQgQCBpZF90YXJnZXQsIHRhcmdldFxuICB1bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCkgOjpcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLmRlbGV0ZSBAIGlkX3RhcmdldFxuXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggY29udHJvbCBwYWNrZXRzXG5cbiAgYmluZERpc3BhdGNoQ29udHJvbCgpIDo6XG4gICAgcmV0dXJuIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICBpZiAwICE9PSBwa3QuaWRfdGFyZ2V0IDo6IC8vIGNvbm5lY3Rpb24tZGlzcGF0Y2hlZFxuICAgICAgICByZXR1cm4gdGhpcy5kaXNwYXRjaFNlbGYocGt0LCBjaGFubmVsKVxuXG4gICAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVtwa3QudHlwZV1cbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gaGFuZGxlciA6OlxuICAgICAgICByZXR1cm4gaGFuZGxlcih0aGlzLCBwa3QsIGNoYW5uZWwpXG4gICAgICBlbHNlIDo6XG4gICAgICAgIHJldHVybiB0aGlzLmRudV9kaXNwYXRjaF9jb250cm9sKHBrdCwgY2hhbm5lbClcblxuICBkaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5jcmVhdGUgQCB0aGlzLmRpc3BDb250cm9sQnlUeXBlXG4gIGRudV9kaXNwYXRjaF9jb250cm9sKHBrdCwgY2hhbm5lbCkgOjpcbiAgICBjb25zb2xlLndhcm4gQCAnZG51X2Rpc3BhdGNoX2NvbnRyb2wnLCBwa3QudHlwZSwgcGt0XG5cblxuT2JqZWN0LmFzc2lnbiBAIFJvdXRlci5wcm90b3R5cGUsIEB7fVxuICBkaXNwQ29udHJvbEJ5VHlwZTogT2JqZWN0LmFzc2lnbiBAIHt9XG4gICAgZGlzcENvbnRyb2xCeVR5cGVcblxuICBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0XG4gIF9maXJzdFJvdXRlOiBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0KClcbiAgX2ZpcnN0VGFyZ2V0OiBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0KClcblxuZXhwb3J0IGRlZmF1bHQgUm91dGVyXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHByb21pc2VRdWV1ZSgpIDo6XG4gIGxldCB0aXAgPSBudWxsXG4gIHJldHVybiBmdW5jdGlvbiAoKSA6OlxuICAgIGlmIG51bGwgPT09IHRpcCA6OlxuICAgICAgdGlwID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIHRpcC50aGVuIEAgY2xlYXJfdGlwXG4gICAgcmV0dXJuIHRpcFxuXG4gIGZ1bmN0aW9uIGNsZWFyX3RpcCgpIDo6XG4gICAgdGlwID0gbnVsbFxuXG5leHBvcnQgZnVuY3Rpb24gYmluZFByb21pc2VGaXJzdFJlc3VsdChvcHRpb25zPXt9KSA6OlxuICBjb25zdCBvbl9lcnJvciA9IG9wdGlvbnMub25fZXJyb3IgfHwgY29uc29sZS5lcnJvclxuICBjb25zdCBpZkFic2VudCA9IG9wdGlvbnMuYWJzZW50IHx8IG51bGxcblxuICByZXR1cm4gKHRpcCwgbHN0Rm5zKSA9PlxuICAgIG5ldyBQcm9taXNlIEAgcmVzb2x2ZSA9Pjo6XG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUodGlwKVxuICAgICAgUHJvbWlzZS5hbGwgQFxuICAgICAgICBBcnJheS5mcm9tIEAgbHN0Rm5zLCBmbiA9PlxuICAgICAgICAgIHRpcC50aGVuKGZuKS50aGVuKHJlc29sdmUsIG9uX2Vycm9yKVxuICAgICAgLnRoZW4gQCBhYnNlbnQsIGFic2VudFxuXG4gICAgICBmdW5jdGlvbiBhYnNlbnQoKSA6OlxuICAgICAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaWZBYnNlbnQgOjpcbiAgICAgICAgICByZXNvbHZlIEAgaWZBYnNlbnQoKVxuICAgICAgICBlbHNlIHJlc29sdmUgQCBpZkFic2VudFxuIiwiaW1wb3J0IHtzZW5kX2hlbGxvLCBzZW5kX3Bpbmdwb25nfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5cbmV4cG9ydCBjbGFzcyBDaGFubmVsIDo6XG4gIHNlbmRSYXcoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgSW5zdGFuY2UgcmVzcG9uc2libGl0eWBcbiAgcGFja1JhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuXG4gIHBhY2tBbmRTZW5kUmF3KC4uLmFyZ3MpIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja1JhdyBAIC4uLmFyZ3NcblxuICBzZW5kSlNPTihwa3Rfb2JqKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tKU09OIEAgcGt0X29ialxuICBwYWNrSlNPTihwa3Rfb2JqKSA6OlxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcGt0X29iai5oZWFkZXIgOjpcbiAgICAgIHBrdF9vYmouaGVhZGVyID0gSlNPTi5zdHJpbmdpZnkgQCBwa3Rfb2JqLmhlYWRlclxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcGt0X29iai5ib2R5IDo6XG4gICAgICBwa3Rfb2JqLmJvZHkgPSBKU09OLnN0cmluZ2lmeSBAIHBrdF9vYmouYm9keVxuICAgIHJldHVybiB0aGlzLnBhY2tSYXcocGt0X29iailcblxuXG4gIC8vIC0tLSBDb250cm9sIG1lc3NhZ2UgdXRpbGl0aWVzXG5cbiAgc2VuZFJvdXRpbmdIYW5kc2hha2UoKSA6OlxuICAgIHJldHVybiBzZW5kX2hlbGxvKHRoaXMsIHRoaXMucm91dGVyLmVjX3B1Yl9pZClcbiAgc2VuZFBpbmcoKSA6OlxuICAgIHJldHVybiBzZW5kX3Bpbmdwb25nKHRoaXMpXG5cblxuICBjbG9uZShwcm9wcywgLi4uZXh0cmEpIDo6XG4gICAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUodGhpcywgcHJvcHMpXG4gICAgcmV0dXJuIDAgPT09IGV4dHJhLmxlbmd0aCA/IHNlbGYgOiBPYmplY3QuYXNzaWduKHNlbGYsIC4uLmV4dHJhKVxuICBiaW5kQ2hhbm5lbChzZW5kUmF3LCBwcm9wcykgOjogcmV0dXJuIGJpbmRDaGFubmVsKHRoaXMsIHNlbmRSYXcsIHByb3BzKVxuICBiaW5kRGlzcGF0Y2hQYWNrZXRzKCkgOjogcmV0dXJuIGJpbmREaXNwYXRjaFBhY2tldHModGhpcylcblxuICB1bmRlbGl2ZXJhYmxlKHBrdCwgbW9kZSkgOjpcbiAgICBjb25zb2xlLndhcm4gQCAndW5kZWxpdmVyYWJsZTonLCBwa3QsIG1vZGVcblxuICBzdGF0aWMgYXNBUEkoaHViLCByb3V0ZXIsIHBhY2tSYXcpIDo6XG4gICAgY29uc3Qgc2VsZiA9IG5ldyB0aGlzKClcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHNlbGYsIEA6XG4gICAgICBwYWNrUmF3OiBAOiB2YWx1ZTogcGFja1Jhd1xuICAgICAgcm91dGVyOiBAOiB2YWx1ZTogcm91dGVyXG4gICAgICBodWI6IEA6IHZhbHVlOiBodWJcbiAgICAgIF9yb290XzogQDogdmFsdWU6IHNlbGZcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0NoYW5uZWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja1BhY2tldFxuICAgIHJldHVybiBzZWxmXG5cbiAgc3RhdGljIGFzSW50ZXJuYWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja1BhY2tldE9ialxuICAgIHJldHVybiBzZWxmLmJpbmRDaGFubmVsIEAgYmluZERpc3BhdGNoSW50ZXJuYWxQYWNrZXQocm91dGVyKVxuXG5leHBvcnQgZGVmYXVsdCBDaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gYmluZENoYW5uZWwoY2hhbm5lbCwgc2VuZFJhdywgcHJvcHMpIDo6XG4gIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBzZW5kUmF3IDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBDaGFubmVsIGV4cGVjdHMgJ3NlbmRSYXcnIGZ1bmN0aW9uIHBhcmFtZXRlcmBcblxuICBjb25zdCBjb3JlX3Byb3BzID0gQDogc2VuZFJhdzogQHt9IHZhbHVlOiBzZW5kUmF3XG4gIHByb3BzID0gbnVsbCA9PSBwcm9wcyA/IGNvcmVfcHJvcHMgOiBPYmplY3QuYXNzaWduIEAgY29yZV9wcm9wcywgcHJvcHNcblxuICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSBAIGNoYW5uZWwsIHByb3BzXG4gIHJldHVybiBzZW5kUmF3LmNoYW5uZWwgPSBzZWxmXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaEludGVybmFsUGFja2V0KHJvdXRlcikgOjpcbiAgY29uc3QgZGlzcGF0Y2ggPSByb3V0ZXIuZGlzcGF0Y2hcbiAgcmV0dXJuIGRpc3BhdGNoX3BrdF9vYmpcblxuICBmdW5jdGlvbiBkaXNwYXRjaF9wa3Rfb2JqKHBrdCkgOjpcbiAgICBpZiB1bmRlZmluZWQgPT09IHBrdC5fcmF3XyA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCBhIHBhcnNlZCBwa3Rfb2JqIHdpdGggdmFsaWQgJ19yYXdfJyBidWZmZXIgcHJvcGVydHlgXG4gICAgZGlzcGF0Y2ggQCBbcGt0XSwgZGlzcGF0Y2hfcGt0X29iai5jaGFubmVsXG4gICAgcmV0dXJuIHRydWVcblxuXG5leHBvcnQgZnVuY3Rpb24gYmluZERpc3BhdGNoUGFja2V0cyhjaGFubmVsKSA6OlxuICBjb25zdCBkaXNwYXRjaCA9IGNoYW5uZWwucm91dGVyLmRpc3BhdGNoXG4gIGNvbnN0IGZlZWQgPSBjaGFubmVsLmh1Yi5wYWNrZXRQYXJzZXIucGFja2V0U3RyZWFtKClcblxuICByZXR1cm4gZnVuY3Rpb24gb25fcmVjdl9kYXRhKGRhdGEpIDo6XG4gICAgY29uc3QgcGt0TGlzdCA9IGZlZWQoZGF0YSlcbiAgICBpZiAwIDwgcGt0TGlzdC5sZW5ndGggOjpcbiAgICAgIGRpc3BhdGNoIEAgcGt0TGlzdCwgY2hhbm5lbFxuIiwiaW1wb3J0IHtSb3V0ZXJ9IGZyb20gJy4vcm91dGVyLmpzeSdcbmltcG9ydCB7Q2hhbm5lbH0gZnJvbSAnLi9jaGFubmVsLmpzeSdcblxuZXhwb3J0IGNsYXNzIEZhYnJpY0h1YiA6OlxuICBjb25zdHJ1Y3RvcigpIDo6XG4gICAgYXBwbHlQbHVnaW5zIEAgJ3ByZScsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuXG4gICAgY29uc3QgcGFja2V0UGFyc2VyID0gdGhpcy5wYWNrZXRQYXJzZXJcbiAgICBpZiBudWxsPT1wYWNrZXRQYXJzZXIgfHwgISBwYWNrZXRQYXJzZXIuaXNQYWNrZXRQYXJzZXIoKSA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBJbnZhbGlkIGh1Yi5wYWNrZXRQYXJzZXJgXG5cbiAgICBjb25zdCByb3V0ZXIgPSB0aGlzLl9pbml0X3JvdXRlcigpXG4gICAgY29uc3QgX2FwaV9jaGFubmVsID0gdGhpcy5faW5pdF9jaGFubmVsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKVxuICAgIGNvbnN0IF9hcGlfaW50ZXJuYWwgPSB0aGlzLl9pbml0X2ludGVybmFsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQHt9XG4gICAgICByb3V0ZXI6IEB7fSB2YWx1ZTogcm91dGVyXG4gICAgICBwYWNrZXRQYXJzZXI6IEB7fSB2YWx1ZTogcGFja2V0UGFyc2VyXG4gICAgICBfYXBpX2NoYW5uZWw6IEB7fSB2YWx1ZTogX2FwaV9jaGFubmVsXG4gICAgICBfYXBpX2ludGVybmFsOiBAe30gdmFsdWU6IF9hcGlfaW50ZXJuYWxcblxuICAgIGFwcGx5UGx1Z2lucyBAIG51bGwsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIGFwcGx5UGx1Z2lucyBAICdwb3N0JywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgcmV0dXJuIHRoaXNcblxuICBfaW5pdF9yb3V0ZXIoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgUGx1Z2luIHJlc3BvbnNpYmxpdHlgXG5cbiAgX2luaXRfY2hhbm5lbEFQSShyb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gQ2hhbm5lbC5hc0NoYW5uZWxBUEkgQFxuICAgICAgdGhpcywgcm91dGVyLCBwYWNrZXRQYXJzZXJcbiAgX2luaXRfaW50ZXJuYWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIENoYW5uZWwuYXNJbnRlcm5hbEFQSSBAXG4gICAgICB0aGlzLCByb3V0ZXIsIHBhY2tldFBhcnNlclxuXG5cbiAgc3RhdGljIHBsdWdpbiguLi5wbHVnaW5GdW5jdGlvbnMpIDo6XG4gICAgcmV0dXJuIHRoaXMucGx1Z2lucyguLi5wbHVnaW5GdW5jdGlvbnMpXG4gIHN0YXRpYyBwbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICBjb25zdCBwbHVnaW5MaXN0ID0gW10uY29uY2F0IEBcbiAgICAgIHRoaXMucHJvdG90eXBlLnBsdWdpbkxpc3QgfHwgW11cbiAgICAgIHBsdWdpbkZ1bmN0aW9uc1xuXG4gICAgcGx1Z2luTGlzdC5zb3J0IEAgKGEsIGIpID0+ICgwIHwgYS5vcmRlcikgLSAoMCB8IGIub3JkZXIpXG5cbiAgICBjb25zdCBCYXNlSHViID0gdGhpcy5fQmFzZUh1Yl8gfHwgdGhpc1xuICAgIGNsYXNzIEZhYnJpY0h1Yl9QSSBleHRlbmRzIEJhc2VIdWIgOjpcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIEZhYnJpY0h1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwbHVnaW5MaXN0OiBAe30gdmFsdWU6IE9iamVjdC5mcmVlemUgQCBwbHVnaW5MaXN0XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBGYWJyaWNIdWJfUEksIEA6XG4gICAgICBfQmFzZUh1Yl86IEB7fSB2YWx1ZTogQmFzZUh1YlxuXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3N1YmNsYXNzJywgcGx1Z2luTGlzdCwgRmFicmljSHViX1BJLCBAOiBSb3V0ZXIsIENoYW5uZWxcbiAgICByZXR1cm4gRmFicmljSHViX1BJXG5cblxuICBnZXQgaWRfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMucm91dGVyLmlkX3NlbGZcbiAgaWRfcm91dGVyX3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLnBhY2tldFBhcnNlci5wYWNrSWQgQFxuICAgICAgdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBjb25uZWN0X3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLl9hcGlfaW50ZXJuYWwuY2xvbmUoKVxuXG4gIGNvbm5lY3QoY29ubl91cmwpIDo6XG4gICAgaWYgbnVsbCA9PSBjb25uX3VybCA6OlxuICAgICAgcmV0dXJuIHRoaXMuY29ubmVjdF9zZWxmKClcblxuICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgY29ubl91cmwgOjpcbiAgICAgIGNvbm5fdXJsID0gdGhpcy5fcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKVxuXG4gICAgY29uc3QgY29ubmVjdCA9IHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sW2Nvbm5fdXJsLnByb3RvY29sXVxuICAgIGlmICEgY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYENvbm5lY3Rpb24gcHJvdG9jb2wgXCIke2Nvbm5fdXJsLnByb3RvY29sfVwiIG5vdCByZWdpc3RlcmVkIGZvciBcIiR7Y29ubl91cmwudG9TdHJpbmcoKX1cImBcblxuICAgIHJldHVybiBjb25uZWN0KGNvbm5fdXJsKVxuXG4gIHJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sKHByb3RvY29sLCBjYl9jb25uZWN0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYl9jb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdjYl9jb25uZWN0JyBmdW5jdGlvbmBcbiAgICBjb25zdCBieVByb3RvY29sID0gT2JqZWN0LmFzc2lnbiBAIHt9LCB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFxuICAgIGJ5UHJvdG9jb2xbcHJvdG9jb2xdID0gY2JfY29ubmVjdFxuICAgIHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydHkgQCB0aGlzLCAnX2Nvbm5lY3RCeVByb3RvY29sJyxcbiAgICAgIEA6IHZhbHVlOiBieVByb3RvY29sLCBjb25maWd1cmFibGU6IHRydWVcblxuICBfcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKSA6OlxuICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG5leHBvcnQgZGVmYXVsdCBGYWJyaWNIdWJcblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGx1Z2lucyhrZXksIHBsdWdpbkxpc3QsIC4uLmFyZ3MpIDo6XG4gIGlmICEga2V5IDo6IGtleSA9IG51bGxcbiAgZm9yIGxldCBwbHVnaW4gb2YgcGx1Z2luTGlzdCA6OlxuICAgIGlmIG51bGwgIT09IGtleSA6OiBwbHVnaW4gPSBwbHVnaW5ba2V5XVxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBwbHVnaW4gOjpcbiAgICAgIHBsdWdpbiguLi5hcmdzKVxuIl0sIm5hbWVzIjpbImRpc3BDb250cm9sQnlUeXBlIiwicmVjdl9oZWxsbyIsInJlY3Zfb2xsZWgiLCJyZWN2X3BvbmciLCJyZWN2X3BpbmciLCJzZW5kX2hlbGxvIiwiY2hhbm5lbCIsImVjX3B1Yl9pZCIsInJvdXRlciIsInBhY2tBbmRTZW5kUmF3IiwidHlwZSIsImh1YiIsImlkX3JvdXRlcl9zZWxmIiwicGt0IiwiZWNfb3RoZXJfaWQiLCJoZWFkZXJfYnVmZmVyIiwibGVuZ3RoIiwiZWNfaWRfaG1hYyIsImhtYWNfc2VjcmV0IiwiaWRfcm91dGVyIiwidW5wYWNrSWQiLCJib2R5X2J1ZmZlciIsInVudmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX29sbGVoIiwicGVlcl9obWFjX2NsYWltIiwiY29tcGFyZSIsInZlcmlmaWVkUGVlclJvdXRlIiwic2VuZF9waW5ncG9uZyIsInBvbmciLCJEYXRlIiwidG9JU09TdHJpbmciLCJsb2NhbCIsInJlbW90ZSIsInRvU3RyaW5nIiwiZGVsdGEiLCJ0c19wb25nIiwiZXJyIiwidHNfcGluZyIsIlJvdXRlciIsImlkX3NlbGYiLCJyb3V0ZURpc2NvdmVyeSIsInRhcmdldERpc2NvdmVyeSIsInRhcmdldHMiLCJfY3JlYXRlVGFyZ2V0c01hcCIsIk9iamVjdCIsImNyZWF0ZSIsImRlZmluZVByb3BlcnRpZXMiLCJ2YWx1ZSIsIl9pbml0RGlzcGF0Y2giLCJyb3V0ZXMiLCJfY3JlYXRlUm91dGVzTWFwIiwic2V0IiwiYmluZERpc3BhdGNoQ29udHJvbCIsImJpbmREaXNwYXRjaFNlbGYiLCJiaW5kRGlzcGF0Y2hSb3V0ZXMiLCJlcnJvciIsIk1hcCIsImRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlIiwiZGlzcGF0Y2hfcm91dGUiLCJfZmlyc3RSb3V0ZSIsInJlZ2lzdGVyUm91dGUiLCJwcXVldWUiLCJwcm9taXNlUXVldWUiLCJkaXNwYXRjaCIsInBrdExpc3QiLCJwcSIsIm1hcCIsInRoZW4iLCJkaXNwYXRjaF9vbmUiLCJnZXQiLCJ1bmRlZmluZWQiLCJ1bmRlbGl2ZXJhYmxlIiwidW5yZWdpc3RlclJvdXRlIiwib25fZXJyb3JfaW5fZGlzcGF0Y2giLCJyZXNvbHZlUm91dGUiLCJUeXBlRXJyb3IiLCJoYXMiLCJkZWxldGUiLCJ0dGwiLCJzZW5kUmF3IiwicmVnaXN0ZXJQZWVyUm91dGUiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJjb25zb2xlIiwid2FybiIsInF1ZXJ5IiwiX2ZpcnN0VGFyZ2V0IiwiZGlzcGF0Y2hTZWxmIiwiaWRfdGFyZ2V0IiwidGFyZ2V0IiwidW5yZWdpc3RlclRhcmdldCIsImlkIiwiTnVtYmVyIiwiaXNTYWZlSW50ZWdlciIsImhhbmRsZXIiLCJkbnVfZGlzcGF0Y2hfY29udHJvbCIsImFzc2lnbiIsInByb3RvdHlwZSIsImJpbmRQcm9taXNlRmlyc3RSZXN1bHQiLCJ0aXAiLCJQcm9taXNlIiwicmVzb2x2ZSIsImNsZWFyX3RpcCIsIm9wdGlvbnMiLCJvbl9lcnJvciIsImlmQWJzZW50IiwiYWJzZW50IiwibHN0Rm5zIiwiYWxsIiwiQXJyYXkiLCJmcm9tIiwiZm4iLCJDaGFubmVsIiwiRXJyb3IiLCJhcmdzIiwicGFja1JhdyIsInBrdF9vYmoiLCJwYWNrSlNPTiIsImhlYWRlciIsIkpTT04iLCJzdHJpbmdpZnkiLCJib2R5IiwicHJvcHMiLCJleHRyYSIsInNlbGYiLCJiaW5kQ2hhbm5lbCIsImJpbmREaXNwYXRjaFBhY2tldHMiLCJtb2RlIiwiYXNBUEkiLCJhc0NoYW5uZWxBUEkiLCJwYWNrZXRQYXJzZXIiLCJwYWNrUGFja2V0IiwiYXNJbnRlcm5hbEFQSSIsInBhY2tQYWNrZXRPYmoiLCJiaW5kRGlzcGF0Y2hJbnRlcm5hbFBhY2tldCIsImNvcmVfcHJvcHMiLCJkaXNwYXRjaF9wa3Rfb2JqIiwiX3Jhd18iLCJmZWVkIiwicGFja2V0U3RyZWFtIiwib25fcmVjdl9kYXRhIiwiZGF0YSIsIkZhYnJpY0h1YiIsInBsdWdpbkxpc3QiLCJpc1BhY2tldFBhcnNlciIsIl9pbml0X3JvdXRlciIsIl9hcGlfY2hhbm5lbCIsIl9pbml0X2NoYW5uZWxBUEkiLCJfYXBpX2ludGVybmFsIiwiX2luaXRfaW50ZXJuYWxBUEkiLCJwbHVnaW4iLCJwbHVnaW5GdW5jdGlvbnMiLCJwbHVnaW5zIiwiY29uY2F0Iiwic29ydCIsImEiLCJiIiwib3JkZXIiLCJCYXNlSHViIiwiX0Jhc2VIdWJfIiwiRmFicmljSHViX1BJIiwiZnJlZXplIiwicGFja0lkIiwiY2xvbmUiLCJjb25uX3VybCIsImNvbm5lY3Rfc2VsZiIsIl9wYXJzZUNvbm5lY3RVUkwiLCJjb25uZWN0IiwiX2Nvbm5lY3RCeVByb3RvY29sIiwicHJvdG9jb2wiLCJjYl9jb25uZWN0IiwiYnlQcm90b2NvbCIsImRlZmluZVByb3BlcnR5IiwiY29uZmlndXJhYmxlIiwiVVJMIiwiYXBwbHlQbHVnaW5zIiwia2V5Il0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBTyxNQUFNQSxvQkFBb0I7R0FDOUIsSUFBRCxHQUFRQyxVQUR1QjtHQUU5QixJQUFELEdBQVFDLFVBRnVCO0dBRzlCLElBQUQsR0FBUUMsU0FIdUI7R0FJOUIsSUFBRCxHQUFRQyxTQUp1QixFQUExQjs7QUFRUCxBQUFPLFNBQVNDLFVBQVQsQ0FBb0JDLE9BQXBCLEVBQTZCO1FBQzVCLEVBQUNDLFNBQUQsS0FBY0QsUUFBUUUsTUFBNUI7U0FDT0YsUUFBUUcsY0FBUixDQUF5QjtlQUNuQixDQURtQixFQUNoQkMsTUFBTSxJQURVO1lBRXRCSCxTQUZzQjtVQUd4QkQsUUFBUUssR0FBUixDQUFZQyxjQUFaLEVBSHdCLEVBQXpCLENBQVA7OztBQUtGLFNBQVNYLFVBQVQsQ0FBb0JPLE1BQXBCLEVBQTRCSyxHQUE1QixFQUFpQ1AsT0FBakMsRUFBMEM7UUFDbENRLGNBQWNELElBQUlFLGFBQUosRUFBcEI7TUFDRyxNQUFNRCxZQUFZRSxNQUFsQixJQUE0QlIsT0FBT1MsVUFBdEMsRUFBbUQ7VUFDM0NDLGNBQWNWLE9BQU9TLFVBQVAsR0FDaEJULE9BQU9TLFVBQVAsQ0FBa0JILFdBQWxCLENBRGdCLEdBQ2lCLElBRHJDO2VBRWFSLE9BQWIsRUFBc0JZLFdBQXRCO0dBSEYsTUFLSztVQUNHQyxZQUFZTixJQUFJTyxRQUFKLENBQWFQLElBQUlRLFdBQUosRUFBYixFQUFnQyxDQUFoQyxDQUFsQjtXQUNPQyxtQkFBUCxDQUE2QkgsU0FBN0IsRUFBd0NiLE9BQXhDOzs7O0FBR0osU0FBU2lCLFVBQVQsQ0FBb0JqQixPQUFwQixF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
