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

    const pqueue = promiseQueue();
    const dispatch_one = this.bindDispatchRoute(routes);
    return Object.defineProperties(this, {
      routes: { value: routes },
      dispatch: { value: dispatch } });

    function dispatch(pktList, channel) {
      const pq = pqueue(); // pq will dispatch during Promise resolutions
      return pktList.map(pkt => pq.then(() => dispatch_one(pkt, channel)));
    }
  }

  on_error_in_dispatch(err, pkt) {
    console.error('Error during packet dispatch\n  pkt:', pkt, '\n', err, '\n');
  }

  _createRoutesMap() {
    return new Map();
  }

  // --- Dispatch to route ---

  dispatch_discover_route(id_router, pkt) {
    return firstAnswer(id_router, this.routeDiscovery);
  }

  bindDispatchRoute(routes) {
    return async (pkt, channel) => {
      try {
        const id_router = pkt.id_router;
        let dispatch_route = routes.get(id_router);
        if (undefined === dispatch_route) {
          dispatch_route = await this.dispatch_discover_route(id_router, pkt);
          if (null == dispatch_route) {
            return channel.undeliverable(pkt, 'route');
          }
          this.registerRoute(id_router, dispatch_route);
        }

        if (false === (await dispatch_route(pkt, channel))) {
          this.unregisterRoute(id_router);
        }
      } catch (err) {
        this.on_error_in_dispatch(err, pkt, channel);
      }
    };
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

class FiberHub$1 {
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
    class FiberHub_PI extends BaseHub {}
    Object.defineProperties(FiberHub_PI.prototype, {
      pluginList: { value: Object.freeze(pluginList) } });
    Object.defineProperties(FiberHub_PI, {
      _BaseHub_: { value: BaseHub } });

    applyPlugins('subclass', pluginList, FiberHub_PI, { Router, Channel });
    return FiberHub_PI;
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
exports['default'] = FiberHub$1;
exports.FiberHub = FiberHub$1;
exports.applyPlugins = applyPlugins;
exports.Router = Router;

Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgudW1kLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL2NvbnRyb2xfcHJvdG9jb2wuanN5IiwiLi4vY29kZS9yb3V0ZXIuanN5IiwiLi4vY29kZS9jaGFubmVsLmpzeSIsIi4uL2NvZGUvaHViLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY29uc3QgZGlzcENvbnRyb2xCeVR5cGUgPSBAe31cbiAgWzB4ZjBdOiByZWN2X2hlbGxvXG4gIFsweGYxXTogcmVjdl9vbGxlaFxuICBbMHhmZV06IHJlY3ZfcG9uZ1xuICBbMHhmZl06IHJlY3ZfcGluZ1xuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfaGVsbG8oY2hhbm5lbCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgaWYgMCAhPT0gZWNfb3RoZXJfaWQubGVuZ3RoICYmIHJvdXRlci5lY19pZF9obWFjIDo6XG4gICAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCkgOiBudWxsXG4gICAgc2VuZF9vbGxlaCBAIGNoYW5uZWwsIGhtYWNfc2VjcmV0XG5cbiAgZWxzZSA6OlxuICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChwa3QuYm9keV9idWZmZXIoKSwgMClcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbmZ1bmN0aW9uIHNlbmRfb2xsZWgoY2hhbm5lbCwgaG1hY19zZWNyZXQpIDo6XG4gIGNvbnN0IHtlY19wdWJfaWR9ID0gY2hhbm5lbC5yb3V0ZXJcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IDB4ZjFcbiAgICBoZWFkZXI6IGVjX3B1Yl9pZFxuICAgIGJvZHk6IGhtYWNfc2VjcmV0XG5cbmZ1bmN0aW9uIHJlY3Zfb2xsZWgocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gcGt0LmhlYWRlcl9idWZmZXIoKVxuICBjb25zdCBpZF9yb3V0ZXIgPSBwa3QudW5wYWNrSWQoZWNfb3RoZXJfaWQpXG5cbiAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgID8gcm91dGVyLmVjX2lkX2htYWMoZWNfb3RoZXJfaWQsIHRydWUpIDogbnVsbFxuICBjb25zdCBwZWVyX2htYWNfY2xhaW0gPSBwa3QuYm9keV9idWZmZXIoKVxuICBpZiBobWFjX3NlY3JldCAmJiAwID09PSBobWFjX3NlY3JldC5jb21wYXJlIEAgcGVlcl9obWFjX2NsYWltIDo6XG4gICAgcm91dGVyLnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG4gIGVsc2UgOjpcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfcGluZ3BvbmcoY2hhbm5lbCwgcG9uZykgOjpcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IHBvbmcgPyAweGZlIDogMHhmZlxuICAgIGJvZHk6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG5mdW5jdGlvbiByZWN2X3Bvbmcocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGxvY2FsID0gbmV3IERhdGUoKVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgcGt0LmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BvbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGxvY2FsXG5cbmZ1bmN0aW9uIHJlY3ZfcGluZyhyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgc2VuZF9waW5ncG9uZyBAIGNoYW5uZWwsIHRydWVcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIHBrdC5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBsb2NhbFxuXG4iLCJpbXBvcnQge2Rpc3BDb250cm9sQnlUeXBlfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5jb25zdCBmaXJzdEFuc3dlciA9IGJpbmRQcm9taXNlRmlyc3RSZXN1bHQoKVxuXG5leHBvcnQgY2xhc3MgUm91dGVyIDo6XG4gIGNvbnN0cnVjdG9yKGlkX3NlbGYpIDo6XG4gICAgaWYgaWRfc2VsZiA6OlxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOiBpZF9zZWxmOiBAOiB2YWx1ZTogaWRfc2VsZlxuICAgICAgdGhpcy5faW5pdERpc3BhdGNoKClcblxuICAvLyAtLS0gRGlzcGF0Y2ggY29yZSAtLS1cblxuICBfaW5pdERpc3BhdGNoKCkgOjpcbiAgICBjb25zdCByb3V0ZXMgPSB0aGlzLl9jcmVhdGVSb3V0ZXNNYXAoKVxuICAgIHJvdXRlcy5zZXQgQCAwLCB0aGlzLmJpbmREaXNwYXRjaENvbnRyb2woKVxuICAgIGlmIG51bGwgIT0gdGhpcy5pZF9zZWxmIDo6XG4gICAgICByb3V0ZXMuc2V0IEAgdGhpcy5pZF9zZWxmLCB0aGlzLmJpbmREaXNwYXRjaFNlbGYoKVxuXG4gICAgY29uc3QgcHF1ZXVlID0gcHJvbWlzZVF1ZXVlKClcbiAgICBjb25zdCBkaXNwYXRjaF9vbmUgPSB0aGlzLmJpbmREaXNwYXRjaFJvdXRlKHJvdXRlcylcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOlxuICAgICAgcm91dGVzOiBAOiB2YWx1ZTogcm91dGVzXG4gICAgICBkaXNwYXRjaDogQDogdmFsdWU6IGRpc3BhdGNoXG5cbiAgICBmdW5jdGlvbiBkaXNwYXRjaChwa3RMaXN0LCBjaGFubmVsKSA6OlxuICAgICAgY29uc3QgcHEgPSBwcXVldWUoKSAvLyBwcSB3aWxsIGRpc3BhdGNoIGR1cmluZyBQcm9taXNlIHJlc29sdXRpb25zXG4gICAgICByZXR1cm4gcGt0TGlzdC5tYXAgQCBwa3QgPT5cbiAgICAgICAgcHEudGhlbiBAICgpID0+IGRpc3BhdGNoX29uZShwa3QsIGNoYW5uZWwpXG5cbiAgb25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBwa3QpIDo6XG4gICAgY29uc29sZS5lcnJvciBAICdFcnJvciBkdXJpbmcgcGFja2V0IGRpc3BhdGNoXFxuICBwa3Q6JywgcGt0LCAnXFxuJywgZXJyLCAnXFxuJ1xuXG4gIF9jcmVhdGVSb3V0ZXNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIHJvdXRlIC0tLVxuXG4gIHJvdXRlRGlzY292ZXJ5ID0gW11cbiAgZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyLCBwa3QpIDo6XG4gICAgcmV0dXJuIGZpcnN0QW5zd2VyIEAgaWRfcm91dGVyLCB0aGlzLnJvdXRlRGlzY292ZXJ5XG5cbiAgYmluZERpc3BhdGNoUm91dGUocm91dGVzKSA6OlxuICAgIHJldHVybiBhc3luYyAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgdHJ5IDo6XG4gICAgICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC5pZF9yb3V0ZXJcbiAgICAgICAgbGV0IGRpc3BhdGNoX3JvdXRlID0gcm91dGVzLmdldChpZF9yb3V0ZXIpXG4gICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgICBkaXNwYXRjaF9yb3V0ZSA9IGF3YWl0IHRoaXMuZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyLCBwa3QpXG4gICAgICAgICAgaWYgbnVsbCA9PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgICAgcmV0dXJuIGNoYW5uZWwudW5kZWxpdmVyYWJsZShwa3QsICdyb3V0ZScpXG4gICAgICAgICAgdGhpcy5yZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpXG5cbiAgICAgICAgaWYgZmFsc2UgPT09IGF3YWl0IGRpc3BhdGNoX3JvdXRlKHBrdCwgY2hhbm5lbCkgOjpcbiAgICAgICAgICB0aGlzLnVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpXG4gICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgdGhpcy5vbl9lcnJvcl9pbl9kaXNwYXRjaChlcnIsIHBrdCwgY2hhbm5lbClcblxuXG4gIHJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgIGlmIG51bGwgIT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnZGlzcGF0Y2hfcm91dGUnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgICBlbHNlIHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMucm91dGVzLmhhcyBAIGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiAwID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5pZF9zZWxmID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG5cbiAgICB0aGlzLnJvdXRlcy5zZXQgQCBpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlXG4gICAgcmV0dXJuIHRydWVcbiAgdW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcikgOjpcbiAgICByZXR1cm4gdGhpcy5yb3V0ZXMuZGVsZXRlIEAgaWRfcm91dGVyXG4gIHJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclJvdXRlIEAgaWRfcm91dGVyLCBwa3QgPT4gOjpcbiAgICAgIGlmIDAgIT09IHBrdC50dGwgOjogY2hhbm5lbC5zZW5kUmF3KHBrdClcbiAgdmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgdW52ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgaWYgdGhpcy5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgfHwgY2hhbm5lbC5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgOjpcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgICBlbHNlIGNvbnNvbGUud2FybiBAICdVbnZlcmlmaWVkIHBlZXIgcm91dGUgKGlnbm9yZWQpOicsIEA6IGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIGxvY2FsIHRhcmdldFxuXG4gIHRhcmdldERpc2NvdmVyeSA9IFtdXG4gIGRpc3BhdGNoX2Rpc2NvdmVyX3RhcmdldChpZF90YXJnZXQsIHBrdCkgOjpcbiAgICByZXR1cm4gZmlyc3RBbnN3ZXIgQCBpZF90YXJnZXQsIHRoaXMudGFyZ2V0RGlzY292ZXJ5XG5cbiAgYmluZERpc3BhdGNoU2VsZihwa3QpIDo6XG4gICAgY29uc3QgZGlzcGF0Y2hTZWxmID0gYXN5bmMgKHBrdCwgY2hhbm5lbCkgPT4gOjpcbiAgICAgIGNvbnN0IGlkX3RhcmdldCA9IHBrdC5pZF90YXJnZXRcbiAgICAgIGxldCB0YXJnZXQgPSB0aGlzLnRhcmdldHMuZ2V0KGlkX3RhcmdldClcbiAgICAgIGlmIHVuZGVmaW5lZCA9PT0gdGFyZ2V0IDo6XG4gICAgICAgIHRhcmdldCA9IGF3YWl0IHRoaXMuZGlzcGF0Y2hfZGlzY292ZXJfdGFyZ2V0KHBrdClcbiAgICAgICAgaWYgbnVsbCA9PSB0YXJnZXQgOjpcbiAgICAgICAgICByZXR1cm4gY2hhbm5lbC51bmRlbGl2ZXJhYmxlKHBrdCwgJ3RhcmdldCcpXG4gICAgICAgIC8vdGhpcy5yZWdpc3RlclRhcmdldChpZF90YXJnZXQsIHRhcmdldClcblxuICAgICAgaWYgZmFsc2UgPT09IGF3YWl0IHRhcmdldChwa3QsIHRoaXMpIDo6XG4gICAgICAgIHRoaXMudW5yZWdpc3RlclRhcmdldChpZF90YXJnZXQpXG5cbiAgICB0aGlzLmRpc3BhdGNoU2VsZiA9IGRpc3BhdGNoU2VsZlxuICAgIHJldHVybiBkaXNwYXRjaFNlbGZcblxuICBfY3JlYXRlVGFyZ2V0c01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcbiAgdGFyZ2V0cyA9IHRoaXMuX2NyZWF0ZVRhcmdldHNNYXAoKVxuICByZWdpc3RlclRhcmdldChpZF90YXJnZXQsIHRhcmdldCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaWRfdGFyZ2V0ICYmIHVuZGVmaW5lZCA9PT0gdGFyZ2V0IDo6XG4gICAgICB0YXJnZXQgPSBpZF90YXJnZXRcbiAgICAgIGlkX3RhcmdldCA9IHRhcmdldC5pZF90YXJnZXQgfHwgdGFyZ2V0LmlkXG5cbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICd0YXJnZXQnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgaWYgISBOdW1iZXIuaXNTYWZlSW50ZWdlciBAIGlkX3RhcmdldCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnaWRfdGFyZ2V0JyB0byBiZSBhbiBpbnRlZ2VyYFxuICAgIGlmIHRoaXMudGFyZ2V0cy5oYXMgQCBpZF90YXJnZXQgOjpcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIHJldHVybiB0aGlzLnRhcmdldHMuc2V0IEAgaWRfdGFyZ2V0LCB0YXJnZXRcbiAgdW5yZWdpc3RlclRhcmdldChpZF90YXJnZXQpIDo6XG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5kZWxldGUgQCBpZF90YXJnZXRcblxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIGNvbnRyb2wgcGFja2V0c1xuXG4gIGJpbmREaXNwYXRjaENvbnRyb2woKSA6OlxuICAgIHJldHVybiAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgaWYgMCAhPT0gcGt0LmlkX3RhcmdldCA6OiAvLyBjb25uZWN0aW9uLWRpc3BhdGNoZWRcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlzcGF0Y2hTZWxmKHBrdCwgY2hhbm5lbClcblxuICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMuZGlzcENvbnRyb2xCeVR5cGVbcGt0LnR5cGVdXG4gICAgICBpZiB1bmRlZmluZWQgIT09IGhhbmRsZXIgOjpcbiAgICAgICAgcmV0dXJuIGhhbmRsZXIodGhpcywgcGt0LCBjaGFubmVsKVxuICAgICAgZWxzZSA6OlxuICAgICAgICByZXR1cm4gdGhpcy5kbnVfZGlzcGF0Y2hfY29udHJvbChwa3QsIGNoYW5uZWwpXG5cbiAgZGlzcENvbnRyb2xCeVR5cGUgPSBPYmplY3QuY3JlYXRlIEAgdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVxuICBkbnVfZGlzcGF0Y2hfY29udHJvbChwa3QsIGNoYW5uZWwpIDo6XG4gICAgY29uc29sZS53YXJuIEAgJ2RudV9kaXNwYXRjaF9jb250cm9sJywgcGt0LnR5cGUsIHBrdFxuXG5cblJvdXRlci5wcm90b3R5cGUuZGlzcENvbnRyb2xCeVR5cGUgPSBPYmplY3QuYXNzaWduIEAge31cbiAgZGlzcENvbnRyb2xCeVR5cGVcblxuZXhwb3J0IGRlZmF1bHQgUm91dGVyXG5cblxuZnVuY3Rpb24gcHJvbWlzZVF1ZXVlKCkgOjpcbiAgbGV0IHRpcCA9IG51bGxcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIDo6XG4gICAgaWYgbnVsbCA9PT0gdGlwIDo6XG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgdGlwLnRoZW4gQCBjbGVhcl90aXBcbiAgICByZXR1cm4gdGlwXG5cbiAgZnVuY3Rpb24gY2xlYXJfdGlwKCkgOjpcbiAgICB0aXAgPSBudWxsXG5cbmZ1bmN0aW9uIGJpbmRQcm9taXNlRmlyc3RSZXN1bHQob3B0aW9ucz17fSkgOjpcbiAgY29uc3Qgb25fZXJyb3IgPSBvcHRpb25zLm9uX2Vycm9yIHx8IGNvbnNvbGUuZXJyb3JcbiAgY29uc3QgaWZBYnNlbnQgPSBvcHRpb25zLmFic2VudCB8fCBudWxsXG5cbiAgcmV0dXJuICh0aXAsIGxzdEZucykgPT5cbiAgICBuZXcgUHJvbWlzZSBAIHJlc29sdmUgPT46OlxuICAgICAgdGlwID0gUHJvbWlzZS5yZXNvbHZlKHRpcClcbiAgICAgIFByb21pc2UuYWxsIEBcbiAgICAgICAgQXJyYXkuZnJvbSBAIGxzdEZucywgZm4gPT5cbiAgICAgICAgICB0aXAudGhlbihmbikudGhlbihyZXNvbHZlLCBvbl9lcnJvcilcbiAgICAgIC50aGVuIEAgYWJzZW50LCBhYnNlbnRcblxuICAgICAgZnVuY3Rpb24gYWJzZW50KCkgOjpcbiAgICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGlmQWJzZW50IDo6XG4gICAgICAgICAgcmVzb2x2ZSBAIGlmQWJzZW50KClcbiAgICAgICAgZWxzZSByZXNvbHZlIEAgaWZBYnNlbnRcbiIsImltcG9ydCB7c2VuZF9oZWxsbywgc2VuZF9waW5ncG9uZ30gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuXG5leHBvcnQgY2xhc3MgQ2hhbm5lbCA6OlxuICBzZW5kUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG4gIHBhY2tSYXcoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgSW5zdGFuY2UgcmVzcG9uc2libGl0eWBcblxuICBwYWNrQW5kU2VuZFJhdyguLi5hcmdzKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tSYXcgQCAuLi5hcmdzXG5cbiAgc2VuZEpTT04ocGt0X29iaikgOjpcbiAgICByZXR1cm4gdGhpcy5zZW5kUmF3IEAgdGhpcy5wYWNrSlNPTiBAIHBrdF9vYmpcbiAgcGFja0pTT04ocGt0X29iaikgOjpcbiAgICBpZiB1bmRlZmluZWQgIT09IHBrdF9vYmouaGVhZGVyIDo6XG4gICAgICBwa3Rfb2JqLmhlYWRlciA9IEpTT04uc3RyaW5naWZ5IEAgcGt0X29iai5oZWFkZXJcbiAgICBpZiB1bmRlZmluZWQgIT09IHBrdF9vYmouYm9keSA6OlxuICAgICAgcGt0X29iai5ib2R5ID0gSlNPTi5zdHJpbmdpZnkgQCBwa3Rfb2JqLmJvZHlcbiAgICByZXR1cm4gdGhpcy5wYWNrUmF3KHBrdF9vYmopXG5cblxuICAvLyAtLS0gQ29udHJvbCBtZXNzYWdlIHV0aWxpdGllc1xuXG4gIHNlbmRSb3V0aW5nSGFuZHNoYWtlKCkgOjpcbiAgICByZXR1cm4gc2VuZF9oZWxsbyh0aGlzLCB0aGlzLnJvdXRlci5lY19wdWJfaWQpXG4gIHNlbmRQaW5nKCkgOjpcbiAgICByZXR1cm4gc2VuZF9waW5ncG9uZyh0aGlzKVxuXG5cbiAgY2xvbmUocHJvcHMsIC4uLmV4dHJhKSA6OlxuICAgIGNvbnN0IHNlbGYgPSBPYmplY3QuY3JlYXRlKHRoaXMsIHByb3BzKVxuICAgIHJldHVybiAwID09PSBleHRyYS5sZW5ndGggPyBzZWxmIDogT2JqZWN0LmFzc2lnbihzZWxmLCAuLi5leHRyYSlcbiAgYmluZENoYW5uZWwoc2VuZFJhdywgcHJvcHMpIDo6IHJldHVybiBiaW5kQ2hhbm5lbCh0aGlzLCBzZW5kUmF3LCBwcm9wcylcbiAgYmluZERpc3BhdGNoUGFja2V0cygpIDo6IHJldHVybiBiaW5kRGlzcGF0Y2hQYWNrZXRzKHRoaXMpXG5cbiAgdW5kZWxpdmVyYWJsZShwa3QsIG1vZGUpIDo6XG4gICAgY29uc29sZS53YXJuIEAgJ3VuZGVsaXZlcmFibGU6JywgcGt0LCBtb2RlXG5cbiAgc3RhdGljIGFzQVBJKGh1Yiwgcm91dGVyLCBwYWNrUmF3KSA6OlxuICAgIGNvbnN0IHNlbGYgPSBuZXcgdGhpcygpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBzZWxmLCBAOlxuICAgICAgcGFja1JhdzogQDogdmFsdWU6IHBhY2tSYXdcbiAgICAgIHJvdXRlcjogQDogdmFsdWU6IHJvdXRlclxuICAgICAgaHViOiBAOiB2YWx1ZTogaHViXG4gICAgICBfcm9vdF86IEA6IHZhbHVlOiBzZWxmXG4gICAgcmV0dXJuIHNlbGZcblxuICBzdGF0aWMgYXNDaGFubmVsQVBJKGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgY29uc3Qgc2VsZiA9IHRoaXMuYXNBUEkgQCBodWIsIHJvdXRlciwgcGFja2V0UGFyc2VyLnBhY2tQYWNrZXRcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0ludGVybmFsQVBJKGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgY29uc3Qgc2VsZiA9IHRoaXMuYXNBUEkgQCBodWIsIHJvdXRlciwgcGFja2V0UGFyc2VyLnBhY2tQYWNrZXRPYmpcbiAgICByZXR1cm4gc2VsZi5iaW5kQ2hhbm5lbCBAIGJpbmREaXNwYXRjaEludGVybmFsUGFja2V0KHJvdXRlcilcblxuZXhwb3J0IGRlZmF1bHQgQ2hhbm5lbFxuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRDaGFubmVsKGNoYW5uZWwsIHNlbmRSYXcsIHByb3BzKSA6OlxuICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2Ygc2VuZFJhdyA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgQ2hhbm5lbCBleHBlY3RzICdzZW5kUmF3JyBmdW5jdGlvbiBwYXJhbWV0ZXJgXG5cbiAgY29uc3QgY29yZV9wcm9wcyA9IEA6IHNlbmRSYXc6IEB7fSB2YWx1ZTogc2VuZFJhd1xuICBwcm9wcyA9IG51bGwgPT0gcHJvcHMgPyBjb3JlX3Byb3BzIDogT2JqZWN0LmFzc2lnbiBAIGNvcmVfcHJvcHMsIHByb3BzXG5cbiAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUgQCBjaGFubmVsLCBwcm9wc1xuICByZXR1cm4gc2VuZFJhdy5jaGFubmVsID0gc2VsZlxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kRGlzcGF0Y2hJbnRlcm5hbFBhY2tldChyb3V0ZXIpIDo6XG4gIGNvbnN0IGRpc3BhdGNoID0gcm91dGVyLmRpc3BhdGNoXG4gIHJldHVybiBkaXNwYXRjaF9wa3Rfb2JqXG5cbiAgZnVuY3Rpb24gZGlzcGF0Y2hfcGt0X29iaihwa3QpIDo6XG4gICAgaWYgdW5kZWZpbmVkID09PSBwa3QuX3Jhd18gOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgYSBwYXJzZWQgcGt0X29iaiB3aXRoIHZhbGlkICdfcmF3XycgYnVmZmVyIHByb3BlcnR5YFxuICAgIGRpc3BhdGNoIEAgW3BrdF0sIGRpc3BhdGNoX3BrdF9vYmouY2hhbm5lbFxuICAgIHJldHVybiB0cnVlXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaFBhY2tldHMoY2hhbm5lbCkgOjpcbiAgY29uc3QgZGlzcGF0Y2ggPSBjaGFubmVsLnJvdXRlci5kaXNwYXRjaFxuICBjb25zdCBmZWVkID0gY2hhbm5lbC5odWIucGFja2V0UGFyc2VyLnBhY2tldFN0cmVhbSgpXG5cbiAgcmV0dXJuIGZ1bmN0aW9uIG9uX3JlY3ZfZGF0YShkYXRhKSA6OlxuICAgIGNvbnN0IHBrdExpc3QgPSBmZWVkKGRhdGEpXG4gICAgaWYgMCA8IHBrdExpc3QubGVuZ3RoIDo6XG4gICAgICBkaXNwYXRjaCBAIHBrdExpc3QsIGNoYW5uZWxcbiIsImltcG9ydCB7Um91dGVyfSBmcm9tICcuL3JvdXRlci5qc3knXG5pbXBvcnQge0NoYW5uZWx9IGZyb20gJy4vY2hhbm5lbC5qc3knXG5cbmV4cG9ydCBjbGFzcyBGaWJlckh1YiA6OlxuICBjb25zdHJ1Y3RvcigpIDo6XG4gICAgYXBwbHlQbHVnaW5zIEAgJ3ByZScsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuXG4gICAgY29uc3QgcGFja2V0UGFyc2VyID0gdGhpcy5wYWNrZXRQYXJzZXJcbiAgICBpZiBudWxsPT1wYWNrZXRQYXJzZXIgfHwgISBwYWNrZXRQYXJzZXIuaXNQYWNrZXRQYXJzZXIoKSA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBJbnZhbGlkIGh1Yi5wYWNrZXRQYXJzZXJgXG5cbiAgICBjb25zdCByb3V0ZXIgPSB0aGlzLl9pbml0X3JvdXRlcigpXG4gICAgY29uc3QgX2FwaV9jaGFubmVsID0gdGhpcy5faW5pdF9jaGFubmVsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKVxuICAgIGNvbnN0IF9hcGlfaW50ZXJuYWwgPSB0aGlzLl9pbml0X2ludGVybmFsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQHt9XG4gICAgICByb3V0ZXI6IEB7fSB2YWx1ZTogcm91dGVyXG4gICAgICBwYWNrZXRQYXJzZXI6IEB7fSB2YWx1ZTogcGFja2V0UGFyc2VyXG4gICAgICBfYXBpX2NoYW5uZWw6IEB7fSB2YWx1ZTogX2FwaV9jaGFubmVsXG4gICAgICBfYXBpX2ludGVybmFsOiBAe30gdmFsdWU6IF9hcGlfaW50ZXJuYWxcblxuICAgIGFwcGx5UGx1Z2lucyBAIG51bGwsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIGFwcGx5UGx1Z2lucyBAICdwb3N0JywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgcmV0dXJuIHRoaXNcblxuICBfaW5pdF9yb3V0ZXIoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgUGx1Z2luIHJlc3BvbnNpYmxpdHlgXG5cbiAgX2luaXRfY2hhbm5lbEFQSShyb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gQ2hhbm5lbC5hc0NoYW5uZWxBUEkgQFxuICAgICAgdGhpcywgcm91dGVyLCBwYWNrZXRQYXJzZXJcbiAgX2luaXRfaW50ZXJuYWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIENoYW5uZWwuYXNJbnRlcm5hbEFQSSBAXG4gICAgICB0aGlzLCByb3V0ZXIsIHBhY2tldFBhcnNlclxuXG5cbiAgc3RhdGljIHBsdWdpbiguLi5wbHVnaW5GdW5jdGlvbnMpIDo6XG4gICAgcmV0dXJuIHRoaXMucGx1Z2lucyguLi5wbHVnaW5GdW5jdGlvbnMpXG4gIHN0YXRpYyBwbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICBjb25zdCBwbHVnaW5MaXN0ID0gW10uY29uY2F0IEBcbiAgICAgIHRoaXMucHJvdG90eXBlLnBsdWdpbkxpc3QgfHwgW11cbiAgICAgIHBsdWdpbkZ1bmN0aW9uc1xuXG4gICAgcGx1Z2luTGlzdC5zb3J0IEAgKGEsIGIpID0+ICgwIHwgYS5vcmRlcikgLSAoMCB8IGIub3JkZXIpXG5cbiAgICBjb25zdCBCYXNlSHViID0gdGhpcy5fQmFzZUh1Yl8gfHwgdGhpc1xuICAgIGNsYXNzIEZpYmVySHViX1BJIGV4dGVuZHMgQmFzZUh1YiA6OlxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgRmliZXJIdWJfUEkucHJvdG90eXBlLCBAOlxuICAgICAgcGx1Z2luTGlzdDogQHt9IHZhbHVlOiBPYmplY3QuZnJlZXplIEAgcGx1Z2luTGlzdFxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgRmliZXJIdWJfUEksIEA6XG4gICAgICBfQmFzZUh1Yl86IEB7fSB2YWx1ZTogQmFzZUh1YlxuXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3N1YmNsYXNzJywgcGx1Z2luTGlzdCwgRmliZXJIdWJfUEksIEA6IFJvdXRlciwgQ2hhbm5lbFxuICAgIHJldHVybiBGaWJlckh1Yl9QSVxuXG5cbiAgZ2V0IGlkX3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGlkX3JvdXRlcl9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5wYWNrZXRQYXJzZXIucGFja0lkIEBcbiAgICAgIHRoaXMucm91dGVyLmlkX3NlbGZcbiAgY29ubmVjdF9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5fYXBpX2ludGVybmFsLmNsb25lKClcblxuICBjb25uZWN0KGNvbm5fdXJsKSA6OlxuICAgIGlmIG51bGwgPT0gY29ubl91cmwgOjpcbiAgICAgIHJldHVybiB0aGlzLmNvbm5lY3Rfc2VsZigpXG5cbiAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGNvbm5fdXJsIDo6XG4gICAgICBjb25uX3VybCA9IHRoaXMuX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybClcblxuICAgIGNvbnN0IGNvbm5lY3QgPSB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFtjb25uX3VybC5wcm90b2NvbF1cbiAgICBpZiAhIGNvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBFcnJvciBAIGBDb25uZWN0aW9uIHByb3RvY29sIFwiJHtjb25uX3VybC5wcm90b2NvbH1cIiBub3QgcmVnaXN0ZXJlZCBmb3IgXCIke2Nvbm5fdXJsLnRvU3RyaW5nKCl9XCJgXG5cbiAgICByZXR1cm4gY29ubmVjdChjb25uX3VybClcblxuICByZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbChwcm90b2NvbCwgY2JfY29ubmVjdCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2JfY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnY2JfY29ubmVjdCcgZnVuY3Rpb25gXG4gICAgY29uc3QgYnlQcm90b2NvbCA9IE9iamVjdC5hc3NpZ24gQCB7fSwgdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xcbiAgICBieVByb3RvY29sW3Byb3RvY29sXSA9IGNiX2Nvbm5lY3RcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgdGhpcywgJ19jb25uZWN0QnlQcm90b2NvbCcsXG4gICAgICBAOiB2YWx1ZTogYnlQcm90b2NvbCwgY29uZmlndXJhYmxlOiB0cnVlXG5cbiAgX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybCkgOjpcbiAgICByZXR1cm4gbmV3IFVSTChjb25uX3VybClcblxuZXhwb3J0IGRlZmF1bHQgRmliZXJIdWJcblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGx1Z2lucyhrZXksIHBsdWdpbkxpc3QsIC4uLmFyZ3MpIDo6XG4gIGlmICEga2V5IDo6IGtleSA9IG51bGxcbiAgZm9yIGxldCBwbHVnaW4gb2YgcGx1Z2luTGlzdCA6OlxuICAgIGlmIG51bGwgIT09IGtleSA6OiBwbHVnaW4gPSBwbHVnaW5ba2V5XVxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBwbHVnaW4gOjpcbiAgICAgIHBsdWdpbiguLi5hcmdzKVxuIl0sIm5hbWVzIjpbImRpc3BDb250cm9sQnlUeXBlIiwicmVjdl9oZWxsbyIsInJlY3Zfb2xsZWgiLCJyZWN2X3BvbmciLCJyZWN2X3BpbmciLCJzZW5kX2hlbGxvIiwiY2hhbm5lbCIsImVjX3B1Yl9pZCIsInJvdXRlciIsInBhY2tBbmRTZW5kUmF3IiwidHlwZSIsImh1YiIsImlkX3JvdXRlcl9zZWxmIiwicGt0IiwiZWNfb3RoZXJfaWQiLCJoZWFkZXJfYnVmZmVyIiwibGVuZ3RoIiwiZWNfaWRfaG1hYyIsImhtYWNfc2VjcmV0IiwiaWRfcm91dGVyIiwidW5wYWNrSWQiLCJib2R5X2J1ZmZlciIsInVudmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX29sbGVoIiwicGVlcl9obWFjX2NsYWltIiwiY29tcGFyZSIsInZlcmlmaWVkUGVlclJvdXRlIiwic2VuZF9waW5ncG9uZyIsInBvbmciLCJEYXRlIiwidG9JU09TdHJpbmciLCJsb2NhbCIsInJlbW90ZSIsInRvU3RyaW5nIiwiZGVsdGEiLCJ0c19wb25nIiwiZXJyIiwidHNfcGluZyIsImZpcnN0QW5zd2VyIiwiYmluZFByb21pc2VGaXJzdFJlc3VsdCIsIlJvdXRlciIsImlkX3NlbGYiLCJyb3V0ZURpc2NvdmVyeSIsInRhcmdldERpc2NvdmVyeSIsInRhcmdldHMiLCJfY3JlYXRlVGFyZ2V0c01hcCIsIk9iamVjdCIsImNyZWF0ZSIsImRlZmluZVByb3BlcnRpZXMiLCJ2YWx1ZSIsIl9pbml0RGlzcGF0Y2giLCJyb3V0ZXMiLCJfY3JlYXRlUm91dGVzTWFwIiwic2V0IiwiYmluZERpc3BhdGNoQ29udHJvbCIsImJpbmREaXNwYXRjaFNlbGYiLCJwcXVldWUiLCJwcm9taXNlUXVldWUiLCJkaXNwYXRjaF9vbmUiLCJiaW5kRGlzcGF0Y2hSb3V0ZSIsImRpc3BhdGNoIiwicGt0TGlzdCIsInBxIiwibWFwIiwidGhlbiIsImVycm9yIiwiTWFwIiwiZGlzcGF0Y2hfcm91dGUiLCJnZXQiLCJ1bmRlZmluZWQiLCJkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZSIsInVuZGVsaXZlcmFibGUiLCJyZWdpc3RlclJvdXRlIiwidW5yZWdpc3RlclJvdXRlIiwib25fZXJyb3JfaW5fZGlzcGF0Y2giLCJUeXBlRXJyb3IiLCJoYXMiLCJkZWxldGUiLCJ0dGwiLCJzZW5kUmF3IiwicmVnaXN0ZXJQZWVyUm91dGUiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJjb25zb2xlIiwid2FybiIsImlkX3RhcmdldCIsImRpc3BhdGNoU2VsZiIsInRhcmdldCIsImRpc3BhdGNoX2Rpc2NvdmVyX3RhcmdldCIsInVucmVnaXN0ZXJUYXJnZXQiLCJpZCIsIk51bWJlciIsImlzU2FmZUludGVnZXIiLCJoYW5kbGVyIiwiZG51X2Rpc3BhdGNoX2NvbnRyb2wiLCJwcm90b3R5cGUiLCJhc3NpZ24iLCJ0aXAiLCJQcm9taXNlIiwicmVzb2x2ZSIsImNsZWFyX3RpcCIsIm9wdGlvbnMiLCJvbl9lcnJvciIsImlmQWJzZW50IiwiYWJzZW50IiwibHN0Rm5zIiwiYWxsIiwiQXJyYXkiLCJmcm9tIiwiZm4iLCJDaGFubmVsIiwiRXJyb3IiLCJhcmdzIiwicGFja1JhdyIsInBrdF9vYmoiLCJwYWNrSlNPTiIsImhlYWRlciIsIkpTT04iLCJzdHJpbmdpZnkiLCJib2R5IiwicHJvcHMiLCJleHRyYSIsInNlbGYiLCJiaW5kQ2hhbm5lbCIsImJpbmREaXNwYXRjaFBhY2tldHMiLCJtb2RlIiwiYXNBUEkiLCJhc0NoYW5uZWxBUEkiLCJwYWNrZXRQYXJzZXIiLCJwYWNrUGFja2V0IiwiYXNJbnRlcm5hbEFQSSIsInBhY2tQYWNrZXRPYmoiLCJiaW5kRGlzcGF0Y2hJbnRlcm5hbFBhY2tldCIsImNvcmVfcHJvcHMiLCJkaXNwYXRjaF9wa3Rfb2JqIiwiX3Jhd18iLCJmZWVkIiwicGFja2V0U3RyZWFtIiwib25fcmVjdl9kYXRhIiwiZGF0YSIsIkZpYmVySHViIiwicGx1Z2luTGlzdCIsImlzUGFja2V0UGFyc2VyIiwiX2luaXRfcm91dGVyIiwiX2FwaV9jaGFubmVsIiwiX2luaXRfY2hhbm5lbEFQSSIsIl9hcGlfaW50ZXJuYWwiLCJfaW5pdF9pbnRlcm5hbEFQSSIsInBsdWdpbiIsInBsdWdpbkZ1bmN0aW9ucyIsInBsdWdpbnMiLCJjb25jYXQiLCJzb3J0IiwiYSIsImIiLCJvcmRlciIsIkJhc2VIdWIiLCJfQmFzZUh1Yl8iLCJGaWJlckh1Yl9QSSIsImZyZWV6ZSIsInBhY2tJZCIsImNsb25lIiwiY29ubl91cmwiLCJjb25uZWN0X3NlbGYiLCJfcGFyc2VDb25uZWN0VVJMIiwiY29ubmVjdCIsIl9jb25uZWN0QnlQcm90b2NvbCIsInByb3RvY29sIiwiY2JfY29ubmVjdCIsImJ5UHJvdG9jb2wiLCJkZWZpbmVQcm9wZXJ0eSIsImNvbmZpZ3VyYWJsZSIsIlVSTCIsImFwcGx5UGx1Z2lucyIsImtleSJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQU8sTUFBTUEsb0JBQW9CO0dB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
