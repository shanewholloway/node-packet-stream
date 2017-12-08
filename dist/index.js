'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

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

  bindRouteChannel(channel, cache) {
    if (null == channel) {
      channel = this.connect_self();
    }
    const { resolveRoute, routes } = this.router;

    const resolveRouteChannel = id_router => {
      let route,
          disco = resolveRoute(id_router);
      return async pkt => {
        if (null !== disco) {
          route = await disco;
          disco = null;
        }

        if (null != route && routes.has(id_router)) {
          return route(pkt, channel);
        } else {
          if (cache) {
            cache.delete(id_router);
          }
          throw new Error("Unresolvable route");
        }
      };
    };

    return cache ? cacheRouteChannel : resolveRouteChannel;

    function cacheRouteChannel(id_router) {
      let chan = cache.get(id_router);
      if (undefined === chan) {
        chan = resolveRouteChannel(id_router);
        cache.set(id_router, chan);
      }
      return chan;
    }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvY29udHJvbF9wcm90b2NvbC5qc3kiLCIuLi9jb2RlL3JvdXRlci5qc3kiLCIuLi9jb2RlL2NoYW5uZWwuanN5IiwiLi4vY29kZS9odWIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBkaXNwQ29udHJvbEJ5VHlwZSA9IEB7fVxuICBbMHhmMF06IHJlY3ZfaGVsbG9cbiAgWzB4ZjFdOiByZWN2X29sbGVoXG4gIFsweGZlXTogcmVjdl9wb25nXG4gIFsweGZmXTogcmVjdl9waW5nXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9oZWxsbyhjaGFubmVsKSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwuaHViLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgaWYgMCAhPT0gZWNfb3RoZXJfaWQubGVuZ3RoICYmIHJvdXRlci5lY19pZF9obWFjIDo6XG4gICAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCkgOiBudWxsXG4gICAgc2VuZF9vbGxlaCBAIGNoYW5uZWwsIGhtYWNfc2VjcmV0XG5cbiAgZWxzZSA6OlxuICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChwa3QuYm9keV9idWZmZXIoKSwgMClcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbmZ1bmN0aW9uIHNlbmRfb2xsZWgoY2hhbm5lbCwgaG1hY19zZWNyZXQpIDo6XG4gIGNvbnN0IHtlY19wdWJfaWR9ID0gY2hhbm5lbC5odWIucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYxXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBobWFjX3NlY3JldFxuXG5mdW5jdGlvbiByZWN2X29sbGVoKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgY29uc3QgaWRfcm91dGVyID0gcGt0LnVucGFja0lkKGVjX290aGVyX2lkKVxuXG4gIGNvbnN0IGhtYWNfc2VjcmV0ID0gcm91dGVyLmVjX2lkX2htYWNcbiAgICA/IHJvdXRlci5lY19pZF9obWFjKGVjX290aGVyX2lkLCB0cnVlKSA6IG51bGxcbiAgY29uc3QgcGVlcl9obWFjX2NsYWltID0gcGt0LmJvZHlfYnVmZmVyKClcbiAgaWYgaG1hY19zZWNyZXQgJiYgMCA9PT0gaG1hY19zZWNyZXQuY29tcGFyZSBAIHBlZXJfaG1hY19jbGFpbSA6OlxuICAgIHJvdXRlci52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuICBlbHNlIDo6XG4gICAgcm91dGVyLnVudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBzZW5kX3Bpbmdwb25nKGNoYW5uZWwsIHBvbmcpIDo6XG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiBwb25nID8gMHhmZSA6IDB4ZmZcbiAgICBib2R5OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuZnVuY3Rpb24gcmVjdl9wb25nKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIHBrdC5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBsb2NhbFxuXG5mdW5jdGlvbiByZWN2X3Bpbmcocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGxvY2FsID0gbmV3IERhdGUoKVxuXG4gIHNlbmRfcGluZ3BvbmcgQCBjaGFubmVsLCB0cnVlXG5cbiAgdHJ5IDo6XG4gICAgY29uc3QgcmVtb3RlID0gbmV3IERhdGUgQCBwa3QuYm9keV9idWZmZXIoKS50b1N0cmluZygpXG4gICAgY29uc3QgZGVsdGEgPSByZW1vdGUgLSBsb2NhbFxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBkZWx0YSwgcmVtb3RlLCBsb2NhbFxuICBjYXRjaCBlcnIgOjpcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gbG9jYWxcblxuIiwiaW1wb3J0IHtkaXNwQ29udHJvbEJ5VHlwZX0gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuZXhwb3J0IGNsYXNzIFJvdXRlciA6OlxuICBjb25zdHJ1Y3RvcihpZF9zZWxmKSA6OlxuICAgIGlmIGlkX3NlbGYgOjpcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDogaWRfc2VsZjogQDogdmFsdWU6IGlkX3NlbGZcblxuICAvLyAtLS0gRGlzcGF0Y2ggY29yZSAtLS1cblxuICBpbml0RGlzcGF0Y2goKSA6OlxuICAgIGNvbnN0IHJvdXRlcyA9IHRoaXMuX2NyZWF0ZVJvdXRlc01hcCgpXG4gICAgcm91dGVzLnNldCBAIDAsIHRoaXMuYmluZERpc3BhdGNoQ29udHJvbCgpXG4gICAgaWYgbnVsbCAhPSB0aGlzLmlkX3NlbGYgOjpcbiAgICAgIHJvdXRlcy5zZXQgQCB0aGlzLmlkX3NlbGYsIHRoaXMuYmluZERpc3BhdGNoU2VsZigpXG5cbiAgICB0aGlzLmJpbmREaXNwYXRjaFJvdXRlcyhyb3V0ZXMpXG5cbiAgb25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBwa3QpIDo6XG4gICAgY29uc29sZS5lcnJvciBAICdFcnJvciBkdXJpbmcgcGFja2V0IGRpc3BhdGNoXFxuICBwa3Q6JywgcGt0LCAnXFxuJywgZXJyLCAnXFxuJ1xuXG4gIF9jcmVhdGVSb3V0ZXNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIHJvdXRlIC0tLVxuXG4gIHJvdXRlRGlzY292ZXJ5ID0gW11cbiAgYXN5bmMgZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyKSA6OlxuICAgIGNvbnN0IGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5fZmlyc3RSb3V0ZSBAIGlkX3JvdXRlciwgdGhpcy5yb3V0ZURpc2NvdmVyeVxuICAgIGlmIG51bGwgPT0gZGlzcGF0Y2hfcm91dGUgOjogcmV0dXJuXG4gICAgdGhpcy5yZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpXG4gICAgcmV0dXJuIGRpc3BhdGNoX3JvdXRlXG5cbiAgYmluZERpc3BhdGNoUm91dGVzKHJvdXRlcykgOjpcbiAgICBjb25zdCBwcXVldWUgPSBwcm9taXNlUXVldWUoKVxuICAgIGZ1bmN0aW9uIGRpc3BhdGNoKHBrdExpc3QsIGNoYW5uZWwpIDo6XG4gICAgICBjb25zdCBwcSA9IHBxdWV1ZSgpIC8vIHBxIHdpbGwgZGlzcGF0Y2ggZHVyaW5nIFByb21pc2UgcmVzb2x1dGlvbnNcbiAgICAgIHJldHVybiBwa3RMaXN0Lm1hcCBAIHBrdCA9PlxuICAgICAgICBwcS50aGVuIEAgKCkgPT4gZGlzcGF0Y2hfb25lKHBrdCwgY2hhbm5lbClcblxuICAgIGNvbnN0IGRpc3BhdGNoX29uZSA9IGFzeW5jIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICB0cnkgOjpcbiAgICAgICAgY29uc3QgaWRfcm91dGVyID0gcGt0LmlkX3JvdXRlclxuICAgICAgICBsZXQgZGlzcGF0Y2hfcm91dGUgPSByb3V0ZXMuZ2V0KGlkX3JvdXRlcilcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgIGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIpXG4gICAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgICAgcmV0dXJuIGNoYW5uZWwgJiYgY2hhbm5lbC51bmRlbGl2ZXJhYmxlKHBrdCwgJ3JvdXRlJylcblxuICAgICAgICBpZiBmYWxzZSA9PT0gYXdhaXQgZGlzcGF0Y2hfcm91dGUocGt0LCBjaGFubmVsKSA6OlxuICAgICAgICAgIHRoaXMudW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcilcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICB0aGlzLm9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgcGt0LCBjaGFubmVsKVxuXG4gICAgY29uc3QgcmVzb2x2ZVJvdXRlID0gaWRfcm91dGVyID0+XG4gICAgICByb3V0ZXMuZ2V0KGlkX3JvdXRlcikgfHxcbiAgICAgICAgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIpXG5cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEA6XG4gICAgICByb3V0ZXM6IEA6IHZhbHVlOiByb3V0ZXNcbiAgICAgIGRpc3BhdGNoOiBAOiB2YWx1ZTogZGlzcGF0Y2hcbiAgICAgIHJlc29sdmVSb3V0ZTogQDogdmFsdWU6IHJlc29sdmVSb3V0ZVxuICAgIHJldHVybiBkaXNwYXRjaFxuXG4gIHJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgIGlmIG51bGwgIT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnZGlzcGF0Y2hfcm91dGUnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgICBlbHNlIHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMucm91dGVzLmhhcyBAIGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiAwID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5pZF9zZWxmID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG5cbiAgICB0aGlzLnJvdXRlcy5zZXQgQCBpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlXG4gICAgcmV0dXJuIHRydWVcbiAgdW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcikgOjpcbiAgICByZXR1cm4gdGhpcy5yb3V0ZXMuZGVsZXRlIEAgaWRfcm91dGVyXG4gIHJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclJvdXRlIEAgaWRfcm91dGVyLCBwa3QgPT4gOjpcbiAgICAgIGlmIDAgIT09IHBrdC50dGwgOjogY2hhbm5lbC5zZW5kUmF3KHBrdClcbiAgdmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgdW52ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgaWYgdGhpcy5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgfHwgY2hhbm5lbC5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgOjpcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgICBlbHNlIGNvbnNvbGUud2FybiBAICdVbnZlcmlmaWVkIHBlZXIgcm91dGUgKGlnbm9yZWQpOicsIEA6IGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIGxvY2FsIHRhcmdldFxuXG4gIHRhcmdldERpc2NvdmVyeSA9IFtdXG4gIGRpc2NvdmVyVGFyZ2V0KHF1ZXJ5KSA6OlxuICAgIHJldHVybiB0aGlzLl9maXJzdFRhcmdldCBAIHF1ZXJ5LCB0aGlzLnRhcmdldERpc2NvdmVyeVxuXG4gIGJpbmREaXNwYXRjaFNlbGYoKSA6OlxuICAgIGNvbnN0IGRpc3BhdGNoU2VsZiA9IGFzeW5jIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICBjb25zdCBpZF90YXJnZXQgPSBwa3QuaWRfdGFyZ2V0XG4gICAgICBsZXQgdGFyZ2V0ID0gdGhpcy50YXJnZXRzLmdldChpZF90YXJnZXQpXG4gICAgICBpZiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgICByZXR1cm4gY2hhbm5lbCAmJiBjaGFubmVsLnVuZGVsaXZlcmFibGUocGt0LCAndGFyZ2V0JylcblxuICAgICAgaWYgZmFsc2UgPT09IGF3YWl0IHRhcmdldChwa3QsIHRoaXMpIDo6XG4gICAgICAgIHRoaXMudW5yZWdpc3RlclRhcmdldChpZF90YXJnZXQpXG5cbiAgICB0aGlzLmRpc3BhdGNoU2VsZiA9IGRpc3BhdGNoU2VsZlxuICAgIHJldHVybiBkaXNwYXRjaFNlbGZcblxuICBfY3JlYXRlVGFyZ2V0c01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcbiAgdGFyZ2V0cyA9IHRoaXMuX2NyZWF0ZVRhcmdldHNNYXAoKVxuICByZWdpc3RlclRhcmdldChpZF90YXJnZXQsIHRhcmdldCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaWRfdGFyZ2V0ICYmIHVuZGVmaW5lZCA9PT0gdGFyZ2V0IDo6XG4gICAgICB0YXJnZXQgPSBpZF90YXJnZXRcbiAgICAgIGlkX3RhcmdldCA9IHRhcmdldC5pZF90YXJnZXQgfHwgdGFyZ2V0LmlkXG5cbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICd0YXJnZXQnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgaWYgISBOdW1iZXIuaXNTYWZlSW50ZWdlciBAIGlkX3RhcmdldCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnaWRfdGFyZ2V0JyB0byBiZSBhbiBpbnRlZ2VyYFxuICAgIGlmIHRoaXMudGFyZ2V0cy5oYXMgQCBpZF90YXJnZXQgOjpcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIHJldHVybiB0aGlzLnRhcmdldHMuc2V0IEAgaWRfdGFyZ2V0LCB0YXJnZXRcbiAgdW5yZWdpc3RlclRhcmdldChpZF90YXJnZXQpIDo6XG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5kZWxldGUgQCBpZF90YXJnZXRcblxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIGNvbnRyb2wgcGFja2V0c1xuXG4gIGJpbmREaXNwYXRjaENvbnRyb2woKSA6OlxuICAgIHJldHVybiAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgaWYgMCAhPT0gcGt0LmlkX3RhcmdldCA6OiAvLyBjb25uZWN0aW9uLWRpc3BhdGNoZWRcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlzcGF0Y2hTZWxmKHBrdCwgY2hhbm5lbClcblxuICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMuZGlzcENvbnRyb2xCeVR5cGVbcGt0LnR5cGVdXG4gICAgICBpZiB1bmRlZmluZWQgIT09IGhhbmRsZXIgOjpcbiAgICAgICAgcmV0dXJuIGhhbmRsZXIodGhpcywgcGt0LCBjaGFubmVsKVxuICAgICAgZWxzZSA6OlxuICAgICAgICByZXR1cm4gdGhpcy5kbnVfZGlzcGF0Y2hfY29udHJvbChwa3QsIGNoYW5uZWwpXG5cbiAgZGlzcENvbnRyb2xCeVR5cGUgPSBPYmplY3QuY3JlYXRlIEAgdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVxuICBkbnVfZGlzcGF0Y2hfY29udHJvbChwa3QsIGNoYW5uZWwpIDo6XG4gICAgY29uc29sZS53YXJuIEAgJ2RudV9kaXNwYXRjaF9jb250cm9sJywgcGt0LnR5cGUsIHBrdFxuXG5cbk9iamVjdC5hc3NpZ24gQCBSb3V0ZXIucHJvdG90eXBlLCBAe31cbiAgZGlzcENvbnRyb2xCeVR5cGU6IE9iamVjdC5hc3NpZ24gQCB7fVxuICAgIGRpc3BDb250cm9sQnlUeXBlXG5cbiAgYmluZFByb21pc2VGaXJzdFJlc3VsdFxuICBfZmlyc3RSb3V0ZTogYmluZFByb21pc2VGaXJzdFJlc3VsdCgpXG4gIF9maXJzdFRhcmdldDogYmluZFByb21pc2VGaXJzdFJlc3VsdCgpXG5cbmV4cG9ydCBkZWZhdWx0IFJvdXRlclxuXG5cbmV4cG9ydCBmdW5jdGlvbiBwcm9taXNlUXVldWUoKSA6OlxuICBsZXQgdGlwID0gbnVsbFxuICByZXR1cm4gZnVuY3Rpb24gKCkgOjpcbiAgICBpZiBudWxsID09PSB0aXAgOjpcbiAgICAgIHRpcCA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICB0aXAudGhlbiBAIGNsZWFyX3RpcFxuICAgIHJldHVybiB0aXBcblxuICBmdW5jdGlvbiBjbGVhcl90aXAoKSA6OlxuICAgIHRpcCA9IG51bGxcblxuZnVuY3Rpb24gaXNfZGVmaW5lZChlKSA6OiByZXR1cm4gdW5kZWZpbmVkICE9PSBlXG5leHBvcnQgZnVuY3Rpb24gYmluZFByb21pc2VGaXJzdFJlc3VsdChvcHRpb25zPXt9KSA6OlxuICBjb25zdCB0ZXN0ID0gb3B0aW9ucy50ZXN0IHx8IGlzX2RlZmluZWRcbiAgY29uc3Qgb25fZXJyb3IgPSBvcHRpb25zLm9uX2Vycm9yIHx8IGNvbnNvbGUuZXJyb3JcbiAgY29uc3QgaWZBYnNlbnQgPSBvcHRpb25zLmFic2VudCB8fCBudWxsXG5cbiAgcmV0dXJuICh0aXAsIGxzdEZucykgPT5cbiAgICBuZXcgUHJvbWlzZSBAIHJlc29sdmUgPT4gOjpcbiAgICAgIGNvbnN0IHJlc29sdmVJZiA9IGUgPT4gdGVzdChlKSA/IHJlc29sdmUoZSkgOiBlXG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUodGlwKVxuICAgICAgUHJvbWlzZS5hbGwgQFxuICAgICAgICBBcnJheS5mcm9tIEAgbHN0Rm5zLCBmbiA9PlxuICAgICAgICAgIHRpcC50aGVuKGZuKS50aGVuKHJlc29sdmVJZiwgb25fZXJyb3IpXG4gICAgICAudGhlbiBAIGFic2VudCwgYWJzZW50XG5cbiAgICAgIGZ1bmN0aW9uIGFic2VudCgpIDo6XG4gICAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpZkFic2VudCA6OlxuICAgICAgICAgIHJlc29sdmUgQCBpZkFic2VudCgpXG4gICAgICAgIGVsc2UgcmVzb2x2ZSBAIGlmQWJzZW50XG4iLCJpbXBvcnQge3NlbmRfaGVsbG8sIHNlbmRfcGluZ3Bvbmd9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cblxuZXhwb3J0IGNsYXNzIENoYW5uZWwgOjpcbiAgc2VuZFJhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuICBwYWNrUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG5cbiAgcGFja0FuZFNlbmRSYXcoLi4uYXJncykgOjpcbiAgICByZXR1cm4gdGhpcy5zZW5kUmF3IEAgdGhpcy5wYWNrUmF3IEAgLi4uYXJnc1xuXG4gIHNlbmRKU09OKHBrdF9vYmopIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja0pTT04gQCBwa3Rfb2JqXG4gIHBhY2tKU09OKHBrdF9vYmopIDo6XG4gICAgaWYgdW5kZWZpbmVkICE9PSBwa3Rfb2JqLmhlYWRlciA6OlxuICAgICAgcGt0X29iai5oZWFkZXIgPSBKU09OLnN0cmluZ2lmeSBAIHBrdF9vYmouaGVhZGVyXG4gICAgaWYgdW5kZWZpbmVkICE9PSBwa3Rfb2JqLmJvZHkgOjpcbiAgICAgIHBrdF9vYmouYm9keSA9IEpTT04uc3RyaW5naWZ5IEAgcGt0X29iai5ib2R5XG4gICAgcmV0dXJuIHRoaXMucGFja1Jhdyhwa3Rfb2JqKVxuXG5cbiAgLy8gLS0tIENvbnRyb2wgbWVzc2FnZSB1dGlsaXRpZXNcblxuICBzZW5kUm91dGluZ0hhbmRzaGFrZSgpIDo6XG4gICAgcmV0dXJuIHNlbmRfaGVsbG8odGhpcywgdGhpcy5odWIucm91dGVyLmVjX3B1Yl9pZClcbiAgc2VuZFBpbmcoKSA6OlxuICAgIHJldHVybiBzZW5kX3Bpbmdwb25nKHRoaXMpXG5cblxuICBjbG9uZShwcm9wcywgLi4uZXh0cmEpIDo6XG4gICAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUodGhpcywgcHJvcHMpXG4gICAgcmV0dXJuIDAgPT09IGV4dHJhLmxlbmd0aCA/IHNlbGYgOiBPYmplY3QuYXNzaWduKHNlbGYsIC4uLmV4dHJhKVxuICBiaW5kQ2hhbm5lbChzZW5kUmF3LCBwcm9wcykgOjogcmV0dXJuIGJpbmRDaGFubmVsKHRoaXMsIHNlbmRSYXcsIHByb3BzKVxuICBiaW5kRGlzcGF0Y2hQYWNrZXRzKCkgOjogcmV0dXJuIGJpbmREaXNwYXRjaFBhY2tldHModGhpcylcblxuICB1bmRlbGl2ZXJhYmxlKHBrdCwgbW9kZSkgOjpcbiAgICBjb25zdCBydHIgPSBwa3QuaWRfcm91dGVyICE9PSB0aGlzLmh1Yi5yb3V0ZXIuaWRfc2VsZiA/IHBrdC5pZF9yb3V0ZXIgOiAnc2VsZidcbiAgICBjb25zb2xlLndhcm4gQCBgVW5kZWxpdmVyYWJsZVske21vZGV9XTogJHtwa3QuaWRfdGFyZ2V0fSBvZiAke3J0cn1gXG5cbiAgc3RhdGljIGFzQVBJKGh1YiwgcGFja1JhdykgOjpcbiAgICBjb25zdCBzZWxmID0gbmV3IHRoaXMoKVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgc2VsZiwgQDpcbiAgICAgIHBhY2tSYXc6IEA6IHZhbHVlOiBwYWNrUmF3XG4gICAgICBodWI6IEA6IHZhbHVlOiBodWJcbiAgICAgIF9yb290XzogQDogdmFsdWU6IHNlbGZcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0NoYW5uZWxBUEkoaHViLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIHRoaXMuYXNBUEkgQCBodWIsIHBhY2tldFBhcnNlci5wYWNrUGFja2V0XG5cbiAgc3RhdGljIGFzSW50ZXJuYWxBUEkoaHViLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgY29uc3Qgc2VsZiA9IHRoaXMuYXNBUEkgQCBodWIsIHBhY2tldFBhcnNlci5wYWNrUGFja2V0T2JqXG4gICAgc2VsZi5iaW5kSW50ZXJuYWxDaGFubmVsID0gZGlzcGF0Y2ggPT4gYmluZEludGVybmFsQ2hhbm5lbChzZWxmLCBkaXNwYXRjaClcbiAgICByZXR1cm4gc2VsZlxuXG5cbmV4cG9ydCBkZWZhdWx0IENoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kQ2hhbm5lbChjaGFubmVsLCBzZW5kUmF3LCBwcm9wcykgOjpcbiAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHNlbmRSYXcgOjpcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYENoYW5uZWwgZXhwZWN0cyAnc2VuZFJhdycgZnVuY3Rpb24gcGFyYW1ldGVyYFxuXG4gIGNvbnN0IGNvcmVfcHJvcHMgPSBAOiBzZW5kUmF3OiBAe30gdmFsdWU6IHNlbmRSYXdcbiAgcHJvcHMgPSBudWxsID09IHByb3BzID8gY29yZV9wcm9wcyA6IE9iamVjdC5hc3NpZ24gQCBjb3JlX3Byb3BzLCBwcm9wc1xuXG4gIGNvbnN0IHNlbGYgPSBPYmplY3QuY3JlYXRlIEAgY2hhbm5lbCwgcHJvcHNcbiAgcmV0dXJuIHNlbmRSYXcuY2hhbm5lbCA9IHNlbGZcblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRJbnRlcm5hbENoYW5uZWwoY2hhbm5lbCwgZGlzcGF0Y2gpIDo6XG4gIGRpc3BhdGNoX3BrdF9vYmouY2hhbm5lbCA9IGNoYW5uZWxcbiAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgY2hhbm5lbCwgQHt9XG4gICAgc2VuZFJhdzogQHt9IHZhbHVlOiBkaXNwYXRjaF9wa3Rfb2JqXG4gICAgYmluZENoYW5uZWw6IEB7fSB2YWx1ZTogbnVsbFxuXG4gIGZ1bmN0aW9uIGRpc3BhdGNoX3BrdF9vYmoocGt0KSA6OlxuICAgIGlmIHVuZGVmaW5lZCA9PT0gcGt0Ll9yYXdfIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkIGEgcGFyc2VkIHBrdF9vYmogd2l0aCB2YWxpZCAnX3Jhd18nIGJ1ZmZlciBwcm9wZXJ0eWBcbiAgICBkaXNwYXRjaCBAIFtwa3RdLCBjaGFubmVsXG4gICAgcmV0dXJuIHRydWVcblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaFBhY2tldHMoY2hhbm5lbCkgOjpcbiAgY29uc3QgZGlzcGF0Y2ggPSBjaGFubmVsLmh1Yi5yb3V0ZXIuZGlzcGF0Y2hcbiAgY29uc3QgZmVlZCA9IGNoYW5uZWwuaHViLnBhY2tldFBhcnNlci5wYWNrZXRTdHJlYW0oKVxuXG4gIHJldHVybiBmdW5jdGlvbiBvbl9yZWN2X2RhdGEoZGF0YSkgOjpcbiAgICBjb25zdCBwa3RMaXN0ID0gZmVlZChkYXRhKVxuICAgIGlmIDAgPCBwa3RMaXN0Lmxlbmd0aCA6OlxuICAgICAgZGlzcGF0Y2ggQCBwa3RMaXN0LCBjaGFubmVsXG4iLCJpbXBvcnQge1JvdXRlcn0gZnJvbSAnLi9yb3V0ZXIuanN5J1xuaW1wb3J0IHtDaGFubmVsfSBmcm9tICcuL2NoYW5uZWwuanN5J1xuXG5leHBvcnQgY2xhc3MgRmFicmljSHViIDo6XG4gIGNvbnN0cnVjdG9yKCkgOjpcbiAgICBhcHBseVBsdWdpbnMgQCAncHJlJywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG5cbiAgICBjb25zdCBwYWNrZXRQYXJzZXIgPSB0aGlzLnBhY2tldFBhcnNlclxuICAgIGlmIG51bGw9PXBhY2tldFBhcnNlciB8fCAhIHBhY2tldFBhcnNlci5pc1BhY2tldFBhcnNlcigpIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEludmFsaWQgaHViLnBhY2tldFBhcnNlcmBcblxuICAgIGNvbnN0IHJvdXRlciA9IHRoaXMuX2luaXRfcm91dGVyKClcbiAgICBjb25zdCBfYXBpX2NoYW5uZWwgPSB0aGlzLl9pbml0X2NoYW5uZWxBUEkocGFja2V0UGFyc2VyKVxuICAgIGNvbnN0IF9hcGlfaW50ZXJuYWwgPSB0aGlzLl9pbml0X2ludGVybmFsQVBJKHBhY2tldFBhcnNlcilcbiAgICByb3V0ZXIuaW5pdERpc3BhdGNoKClcbiAgICBfYXBpX2ludGVybmFsLmJpbmRJbnRlcm5hbENoYW5uZWwgQCByb3V0ZXIuZGlzcGF0Y2hcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQHt9XG4gICAgICByb3V0ZXI6IEB7fSB2YWx1ZTogcm91dGVyXG4gICAgICBwYWNrZXRQYXJzZXI6IEB7fSB2YWx1ZTogcGFja2V0UGFyc2VyXG4gICAgICBfYXBpX2NoYW5uZWw6IEB7fSB2YWx1ZTogX2FwaV9jaGFubmVsXG4gICAgICBfYXBpX2ludGVybmFsOiBAe30gdmFsdWU6IF9hcGlfaW50ZXJuYWxcblxuICAgIGFwcGx5UGx1Z2lucyBAIG51bGwsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIGFwcGx5UGx1Z2lucyBAICdwb3N0JywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgcmV0dXJuIHRoaXNcblxuICBfaW5pdF9yb3V0ZXIoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgUGx1Z2luIHJlc3BvbnNpYmxpdHlgXG5cbiAgX2luaXRfY2hhbm5lbEFQSShwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIENoYW5uZWwuYXNDaGFubmVsQVBJIEAgdGhpcywgcGFja2V0UGFyc2VyXG4gIF9pbml0X2ludGVybmFsQVBJKHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gQ2hhbm5lbC5hc0ludGVybmFsQVBJIEAgdGhpcywgcGFja2V0UGFyc2VyXG5cblxuICBzdGF0aWMgcGx1Z2luKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICByZXR1cm4gdGhpcy5wbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucylcbiAgc3RhdGljIHBsdWdpbnMoLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIGNvbnN0IHBsdWdpbkxpc3QgPSBbXS5jb25jYXQgQFxuICAgICAgdGhpcy5wcm90b3R5cGUucGx1Z2luTGlzdCB8fCBbXVxuICAgICAgcGx1Z2luRnVuY3Rpb25zXG5cbiAgICBwbHVnaW5MaXN0LnNvcnQgQCAoYSwgYikgPT4gKDAgfCBhLm9yZGVyKSAtICgwIHwgYi5vcmRlcilcblxuICAgIGNvbnN0IEJhc2VIdWIgPSB0aGlzLl9CYXNlSHViXyB8fCB0aGlzXG4gICAgY2xhc3MgRmFicmljSHViX1BJIGV4dGVuZHMgQmFzZUh1YiA6OlxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgRmFicmljSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBsdWdpbkxpc3Q6IEB7fSB2YWx1ZTogT2JqZWN0LmZyZWV6ZSBAIHBsdWdpbkxpc3RcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIEZhYnJpY0h1Yl9QSSwgQDpcbiAgICAgIF9CYXNlSHViXzogQHt9IHZhbHVlOiBCYXNlSHViXG5cbiAgICBhcHBseVBsdWdpbnMgQCAnc3ViY2xhc3MnLCBwbHVnaW5MaXN0LCBGYWJyaWNIdWJfUEksIEA6IFJvdXRlciwgQ2hhbm5lbFxuICAgIHJldHVybiBGYWJyaWNIdWJfUElcblxuXG4gIHZhbHVlT2YoKSA6OiByZXR1cm4gdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBnZXQgaWRfc2VsZigpIDo6IHJldHVybiB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGlkX3JvdXRlcl9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5wYWNrZXRQYXJzZXIucGFja0lkIEBcbiAgICAgIHRoaXMucm91dGVyLmlkX3NlbGZcblxuICBiaW5kUm91dGVDaGFubmVsKGNoYW5uZWwsIGNhY2hlKSA6OlxuICAgIGlmIG51bGwgPT0gY2hhbm5lbCA6OiBjaGFubmVsID0gdGhpcy5jb25uZWN0X3NlbGYoKVxuICAgIGNvbnN0IHtyZXNvbHZlUm91dGUsIHJvdXRlc30gPSB0aGlzLnJvdXRlclxuXG4gICAgY29uc3QgcmVzb2x2ZVJvdXRlQ2hhbm5lbCA9IGlkX3JvdXRlciA9PiA6OlxuICAgICAgbGV0IHJvdXRlLCBkaXNjbyA9IHJlc29sdmVSb3V0ZShpZF9yb3V0ZXIpXG4gICAgICByZXR1cm4gYXN5bmMgcGt0ID0+IDo6XG4gICAgICAgIGlmIG51bGwgIT09IGRpc2NvIDo6XG4gICAgICAgICAgcm91dGUgPSBhd2FpdCBkaXNjb1xuICAgICAgICAgIGRpc2NvID0gbnVsbFxuXG4gICAgICAgIGlmIG51bGwgIT0gcm91dGUgJiYgcm91dGVzLmhhcyhpZF9yb3V0ZXIpIDo6XG4gICAgICAgICAgcmV0dXJuIHJvdXRlIEAgcGt0LCBjaGFubmVsXG4gICAgICAgIGVsc2UgOjpcbiAgICAgICAgICBpZiBjYWNoZSA6OiBjYWNoZS5kZWxldGUoaWRfcm91dGVyKVxuICAgICAgICAgIHRocm93IG5ldyBFcnJvciBAIFwiVW5yZXNvbHZhYmxlIHJvdXRlXCJcblxuICAgIHJldHVybiBjYWNoZSA/IGNhY2hlUm91dGVDaGFubmVsIDogcmVzb2x2ZVJvdXRlQ2hhbm5lbFxuXG4gICAgZnVuY3Rpb24gY2FjaGVSb3V0ZUNoYW5uZWwoaWRfcm91dGVyKSA6OlxuICAgICAgbGV0IGNoYW4gPSBjYWNoZS5nZXQoaWRfcm91dGVyKVxuICAgICAgaWYgdW5kZWZpbmVkID09PSBjaGFuIDo6XG4gICAgICAgIGNoYW4gPSByZXNvbHZlUm91dGVDaGFubmVsKGlkX3JvdXRlcilcbiAgICAgICAgY2FjaGUuc2V0KGlkX3JvdXRlciwgY2hhbilcbiAgICAgIHJldHVybiBjaGFuXG5cbiAgY29ubmVjdF9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5fYXBpX2ludGVybmFsLmNsb25lKClcblxuXG4gIGNvbm5lY3QoY29ubl91cmwpIDo6XG4gICAgaWYgbnVsbCA9PSBjb25uX3VybCA6OlxuICAgICAgcmV0dXJuIHRoaXMuY29ubmVjdF9zZWxmKClcblxuICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgY29ubl91cmwgOjpcbiAgICAgIGNvbm5fdXJsID0gdGhpcy5fcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKVxuXG4gICAgY29uc3QgY29ubmVjdCA9IHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sW2Nvbm5fdXJsLnByb3RvY29sXVxuICAgIGlmICEgY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYENvbm5lY3Rpb24gcHJvdG9jb2wgXCIke2Nvbm5fdXJsLnByb3RvY29sfVwiIG5vdCByZWdpc3RlcmVkIGZvciBcIiR7Y29ubl91cmwudG9TdHJpbmcoKX1cImBcblxuICAgIHJldHVybiBjb25uZWN0KGNvbm5fdXJsKVxuXG4gIHJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sKHByb3RvY29sLCBjYl9jb25uZWN0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYl9jb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdjYl9jb25uZWN0JyBmdW5jdGlvbmBcbiAgICBjb25zdCBieVByb3RvY29sID0gT2JqZWN0LmFzc2lnbiBAIHt9LCB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFxuICAgIGJ5UHJvdG9jb2xbcHJvdG9jb2xdID0gY2JfY29ubmVjdFxuICAgIHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydHkgQCB0aGlzLCAnX2Nvbm5lY3RCeVByb3RvY29sJyxcbiAgICAgIEA6IHZhbHVlOiBieVByb3RvY29sLCBjb25maWd1cmFibGU6IHRydWVcblxuICBfcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKSA6OlxuICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG5leHBvcnQgZGVmYXVsdCBGYWJyaWNIdWJcblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGx1Z2lucyhrZXksIHBsdWdpbkxpc3QsIC4uLmFyZ3MpIDo6XG4gIGlmICEga2V5IDo6IGtleSA9IG51bGxcbiAgZm9yIGxldCBwbHVnaW4gb2YgcGx1Z2luTGlzdCA6OlxuICAgIGlmIG51bGwgIT09IGtleSA6OiBwbHVnaW4gPSBwbHVnaW5ba2V5XVxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBwbHVnaW4gOjpcbiAgICAgIHBsdWdpbiguLi5hcmdzKVxuIl0sIm5hbWVzIjpbImRpc3BDb250cm9sQnlUeXBlIiwicmVjdl9oZWxsbyIsInJlY3Zfb2xsZWgiLCJyZWN2X3BvbmciLCJyZWN2X3BpbmciLCJzZW5kX2hlbGxvIiwiY2hhbm5lbCIsImVjX3B1Yl9pZCIsImh1YiIsInJvdXRlciIsInBhY2tBbmRTZW5kUmF3IiwidHlwZSIsImlkX3JvdXRlcl9zZWxmIiwicGt0IiwiZWNfb3RoZXJfaWQiLCJoZWFkZXJfYnVmZmVyIiwibGVuZ3RoIiwiZWNfaWRfaG1hYyIsImhtYWNfc2VjcmV0IiwiaWRfcm91dGVyIiwidW5wYWNrSWQiLCJib2R5X2J1ZmZlciIsInVudmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX29sbGVoIiwicGVlcl9obWFjX2NsYWltIiwiY29tcGFyZSIsInZlcmlmaWVkUGVlclJvdXRlIiwic2VuZF9waW5ncG9uZyIsInBvbmciLCJEYXRlIiwidG9JU09TdHJpbmciLCJsb2NhbCIsInJlbW90ZSIsInRvU3RyaW5nIiwiZGVsdGEiLCJ0c19wb25nIiwiZXJyIiwidHNfcGluZyIsIlJvdXRlciIsImlkX3NlbGYiLCJyb3V0ZURpc2NvdmVyeSIsInRhcmdldERpc2NvdmVyeSIsInRhcmdldHMiLCJfY3JlYXRlVGFyZ2V0c01hcCIsIk9iamVjdCIsImNyZWF0ZSIsImRlZmluZVByb3BlcnRpZXMiLCJ2YWx1ZSIsInJvdXRlcyIsIl9jcmVhdGVSb3V0ZXNNYXAiLCJzZXQiLCJiaW5kRGlzcGF0Y2hDb250cm9sIiwiYmluZERpc3BhdGNoU2VsZiIsImJpbmREaXNwYXRjaFJvdXRlcyIsImVycm9yIiwiTWFwIiwiZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUiLCJkaXNwYXRjaF9yb3V0ZSIsIl9maXJzdFJvdXRlIiwicmVnaXN0ZXJSb3V0ZSIsInBxdWV1ZSIsInByb21pc2VRdWV1ZSIsImRpc3BhdGNoIiwicGt0TGlzdCIsInBxIiwibWFwIiwidGhlbiIsImRpc3BhdGNoX29uZSIsImdldCIsInVuZGVmaW5lZCIsInVuZGVsaXZlcmFibGUiLCJ1bnJlZ2lzdGVyUm91dGUiLCJvbl9lcnJvcl9pbl9kaXNwYXRjaCIsInJlc29sdmVSb3V0ZSIsIlR5cGVFcnJvciIsImhhcyIsImRlbGV0ZSIsInR0bCIsInNlbmRSYXciLCJyZWdpc3RlclBlZXJSb3V0ZSIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsImNvbnNvbGUiLCJ3YXJuIiwicXVlcnkiLCJfZmlyc3RUYXJnZXQiLCJkaXNwYXRjaFNlbGYiLCJpZF90YXJnZXQiLCJ0YXJnZXQiLCJ1bnJlZ2lzdGVyVGFyZ2V0IiwiaWQiLCJOdW1iZXIiLCJpc1NhZmVJbnRlZ2VyIiwiaGFuZGxlciIsImRudV9kaXNwYXRjaF9jb250cm9sIiwiYXNzaWduIiwicHJvdG90eXBlIiwiYmluZFByb21pc2VGaXJzdFJlc3VsdCIsInRpcCIsIlByb21pc2UiLCJyZXNvbHZlIiwiY2xlYXJfdGlwIiwiaXNfZGVmaW5lZCIsImUiLCJvcHRpb25zIiwidGVzdCIsIm9uX2Vycm9yIiwiaWZBYnNlbnQiLCJhYnNlbnQiLCJsc3RGbnMiLCJyZXNvbHZlSWYiLCJhbGwiLCJBcnJheSIsImZyb20iLCJmbiIsIkNoYW5uZWwiLCJFcnJvciIsImFyZ3MiLCJwYWNrUmF3IiwicGt0X29iaiIsInBhY2tKU09OIiwiaGVhZGVyIiwiSlNPTiIsInN0cmluZ2lmeSIsImJvZHkiLCJwcm9wcyIsImV4dHJhIiwic2VsZiIsImJpbmRDaGFubmVsIiwiYmluZERpc3BhdGNoUGFja2V0cyIsIm1vZGUiLCJydHIiLCJhc0FQSSIsImFzQ2hhbm5lbEFQSSIsInBhY2tldFBhcnNlciIsInBhY2tQYWNrZXQiLCJhc0ludGVybmFsQVBJIiwicGFja1BhY2tldE9iaiIsImJpbmRJbnRlcm5hbENoYW5uZWwiLCJjb3JlX3Byb3BzIiwiZGlzcGF0Y2hfcGt0X29iaiIsIl9yYXdfIiwiZmVlZCIsInBhY2tldFN0cmVhbSIsIm9uX3JlY3ZfZGF0YSIsImRhdGEiLCJGYWJyaWNIdWIiLCJwbHVnaW5MaXN0IiwiaXNQYWNrZXRQYXJzZXIiLCJfaW5pdF9yb3V0ZXIiLCJfYXBpX2NoYW5uZWwiLCJfaW5pdF9jaGFubmVsQVBJIiwiX2FwaV9pbnRlcm5hbCIsIl9pbml0X2ludGVybmFsQVBJIiwiaW5pdERpc3BhdGNoIiwicGx1Z2luIiwicGx1Z2luRnVuY3Rpb25zIiwicGx1Z2lucyIsImNvbmNhdCIsInNvcnQiLCJhIiwiYiIsIm9yZGVyIiwiQmFzZUh1YiIsIl9CYXNlSHViXyIsIkZhYnJpY0h1Yl9QSSIsImZyZWV6ZSIsInBhY2tJZCIsImNhY2hlIiwiY29ubmVjdF9zZWxmIiwicmVzb2x2ZVJvdXRlQ2hhbm5lbCIsInJvdXRlIiwiZGlzY28iLCJjYWNoZVJvdXRlQ2hhbm5lbCIsImNoYW4iLCJjbG9uZSIsImNvbm5fdXJsIiwiX3BhcnNlQ29ubmVjdFVSTCIsImNvbm5lY3QiLCJfY29ubmVjdEJ5UHJvdG9jb2wiLCJwcm90b2NvbCIsImNiX2Nvbm5lY3QiLCJieVByb3RvY29sIiwiZGVmaW5lUHJvcGVydHkiLCJjb25maWd1cmFibGUiLCJVUkwiLCJhcHBseVBsdWdpbnMiLCJrZXkiXSwibWFwcGluZ3MiOiI7Ozs7QUFBTyxNQUFNQSxvQkFBb0I7R0FDOUIsSUFBRCxHQUFRQyxVQUR1QjtHQUU5QixJQUFELEdBQVFDLFVBRnVCO0dBRzlCLElBQUQsR0FBUUMsU0FIdUI7R0FJOUIsSUFBRCxHQUFRQyxTQUp1QixFQUExQjs7QUFRUCxBQUFPLFNBQVNDLFVBQVQsQ0FBb0JDLE9BQXBCLEVBQTZCO1FBQzVCLEVBQUNDLFNBQUQsS0FBY0QsUUFBUUUsR0FBUixDQUFZQyxNQUFoQztTQUNPSCxRQUFRSSxjQUFSLENBQXlCO2VBQ25CLENBRG1CLEVBQ2hCQyxNQUFNLElBRFU7WUFFdEJKLFNBRnNCO1VBR3hCRCxRQUFR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
