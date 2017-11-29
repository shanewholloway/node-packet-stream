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

exports.channel = channel;
exports.control_protocol = control_protocol;
exports['default'] = FabricHub$1;
exports.FabricHub = FabricHub$1;
exports.applyPlugins = applyPlugins;
exports.Router = Router;
exports.promiseQueue = promiseQueue;
exports.bindPromiseFirstResult = bindPromiseFirstResult;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvY29udHJvbF9wcm90b2NvbC5qc3kiLCIuLi9jb2RlL3JvdXRlci5qc3kiLCIuLi9jb2RlL2NoYW5uZWwuanN5IiwiLi4vY29kZS9odWIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBkaXNwQ29udHJvbEJ5VHlwZSA9IEB7fVxuICBbMHhmMF06IHJlY3ZfaGVsbG9cbiAgWzB4ZjFdOiByZWN2X29sbGVoXG4gIFsweGZlXTogcmVjdl9wb25nXG4gIFsweGZmXTogcmVjdl9waW5nXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9oZWxsbyhjaGFubmVsKSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwuaHViLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgaWYgMCAhPT0gZWNfb3RoZXJfaWQubGVuZ3RoICYmIHJvdXRlci5lY19pZF9obWFjIDo6XG4gICAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCkgOiBudWxsXG4gICAgc2VuZF9vbGxlaCBAIGNoYW5uZWwsIGhtYWNfc2VjcmV0XG5cbiAgZWxzZSA6OlxuICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChwa3QuYm9keV9idWZmZXIoKSwgMClcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbmZ1bmN0aW9uIHNlbmRfb2xsZWgoY2hhbm5lbCwgaG1hY19zZWNyZXQpIDo6XG4gIGNvbnN0IHtlY19wdWJfaWR9ID0gY2hhbm5lbC5odWIucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYxXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBobWFjX3NlY3JldFxuXG5mdW5jdGlvbiByZWN2X29sbGVoKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgY29uc3QgaWRfcm91dGVyID0gcGt0LnVucGFja0lkKGVjX290aGVyX2lkKVxuXG4gIGNvbnN0IGhtYWNfc2VjcmV0ID0gcm91dGVyLmVjX2lkX2htYWNcbiAgICA/IHJvdXRlci5lY19pZF9obWFjKGVjX290aGVyX2lkLCB0cnVlKSA6IG51bGxcbiAgY29uc3QgcGVlcl9obWFjX2NsYWltID0gcGt0LmJvZHlfYnVmZmVyKClcbiAgaWYgaG1hY19zZWNyZXQgJiYgMCA9PT0gaG1hY19zZWNyZXQuY29tcGFyZSBAIHBlZXJfaG1hY19jbGFpbSA6OlxuICAgIHJvdXRlci52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuICBlbHNlIDo6XG4gICAgcm91dGVyLnVudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBzZW5kX3Bpbmdwb25nKGNoYW5uZWwsIHBvbmcpIDo6XG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiBwb25nID8gMHhmZSA6IDB4ZmZcbiAgICBib2R5OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuZnVuY3Rpb24gcmVjdl9wb25nKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIHBrdC5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBsb2NhbFxuXG5mdW5jdGlvbiByZWN2X3Bpbmcocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGxvY2FsID0gbmV3IERhdGUoKVxuXG4gIHNlbmRfcGluZ3BvbmcgQCBjaGFubmVsLCB0cnVlXG5cbiAgdHJ5IDo6XG4gICAgY29uc3QgcmVtb3RlID0gbmV3IERhdGUgQCBwa3QuYm9keV9idWZmZXIoKS50b1N0cmluZygpXG4gICAgY29uc3QgZGVsdGEgPSByZW1vdGUgLSBsb2NhbFxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBkZWx0YSwgcmVtb3RlLCBsb2NhbFxuICBjYXRjaCBlcnIgOjpcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gbG9jYWxcblxuIiwiaW1wb3J0IHtkaXNwQ29udHJvbEJ5VHlwZX0gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuZXhwb3J0IGNsYXNzIFJvdXRlciA6OlxuICBjb25zdHJ1Y3RvcihpZF9zZWxmKSA6OlxuICAgIGlmIGlkX3NlbGYgOjpcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDogaWRfc2VsZjogQDogdmFsdWU6IGlkX3NlbGZcblxuICAvLyAtLS0gRGlzcGF0Y2ggY29yZSAtLS1cblxuICBpbml0RGlzcGF0Y2goKSA6OlxuICAgIGNvbnN0IHJvdXRlcyA9IHRoaXMuX2NyZWF0ZVJvdXRlc01hcCgpXG4gICAgcm91dGVzLnNldCBAIDAsIHRoaXMuYmluZERpc3BhdGNoQ29udHJvbCgpXG4gICAgaWYgbnVsbCAhPSB0aGlzLmlkX3NlbGYgOjpcbiAgICAgIHJvdXRlcy5zZXQgQCB0aGlzLmlkX3NlbGYsIHRoaXMuYmluZERpc3BhdGNoU2VsZigpXG5cbiAgICB0aGlzLmJpbmREaXNwYXRjaFJvdXRlcyhyb3V0ZXMpXG5cbiAgb25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBwa3QpIDo6XG4gICAgY29uc29sZS5lcnJvciBAICdFcnJvciBkdXJpbmcgcGFja2V0IGRpc3BhdGNoXFxuICBwa3Q6JywgcGt0LCAnXFxuJywgZXJyLCAnXFxuJ1xuXG4gIF9jcmVhdGVSb3V0ZXNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIHJvdXRlIC0tLVxuXG4gIHJvdXRlRGlzY292ZXJ5ID0gW11cbiAgYXN5bmMgZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyKSA6OlxuICAgIGNvbnN0IGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5fZmlyc3RSb3V0ZSBAIGlkX3JvdXRlciwgdGhpcy5yb3V0ZURpc2NvdmVyeVxuICAgIGlmIG51bGwgPT0gZGlzcGF0Y2hfcm91dGUgOjogcmV0dXJuXG4gICAgdGhpcy5yZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpXG4gICAgcmV0dXJuIGRpc3BhdGNoX3JvdXRlXG5cbiAgYmluZERpc3BhdGNoUm91dGVzKHJvdXRlcykgOjpcbiAgICBjb25zdCBwcXVldWUgPSBwcm9taXNlUXVldWUoKVxuICAgIGZ1bmN0aW9uIGRpc3BhdGNoKHBrdExpc3QsIGNoYW5uZWwpIDo6XG4gICAgICBjb25zdCBwcSA9IHBxdWV1ZSgpIC8vIHBxIHdpbGwgZGlzcGF0Y2ggZHVyaW5nIFByb21pc2UgcmVzb2x1dGlvbnNcbiAgICAgIHJldHVybiBwa3RMaXN0Lm1hcCBAIHBrdCA9PlxuICAgICAgICBwcS50aGVuIEAgKCkgPT4gZGlzcGF0Y2hfb25lKHBrdCwgY2hhbm5lbClcblxuICAgIGNvbnN0IGRpc3BhdGNoX29uZSA9IGFzeW5jIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICB0cnkgOjpcbiAgICAgICAgY29uc3QgaWRfcm91dGVyID0gcGt0LmlkX3JvdXRlclxuICAgICAgICBsZXQgZGlzcGF0Y2hfcm91dGUgPSByb3V0ZXMuZ2V0KGlkX3JvdXRlcilcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgIGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIpXG4gICAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgICAgcmV0dXJuIGNoYW5uZWwgJiYgY2hhbm5lbC51bmRlbGl2ZXJhYmxlKHBrdCwgJ3JvdXRlJylcblxuICAgICAgICBpZiBmYWxzZSA9PT0gYXdhaXQgZGlzcGF0Y2hfcm91dGUocGt0LCBjaGFubmVsKSA6OlxuICAgICAgICAgIHRoaXMudW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcilcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICB0aGlzLm9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgcGt0LCBjaGFubmVsKVxuXG4gICAgY29uc3QgcmVzb2x2ZVJvdXRlID0gaWRfcm91dGVyID0+XG4gICAgICByb3V0ZXMuZ2V0KGlkX3JvdXRlcikgfHxcbiAgICAgICAgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIpXG5cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEA6XG4gICAgICByb3V0ZXM6IEA6IHZhbHVlOiByb3V0ZXNcbiAgICAgIGRpc3BhdGNoOiBAOiB2YWx1ZTogZGlzcGF0Y2hcbiAgICAgIHJlc29sdmVSb3V0ZTogQDogdmFsdWU6IHJlc29sdmVSb3V0ZVxuICAgIHJldHVybiBkaXNwYXRjaFxuXG4gIHJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgIGlmIG51bGwgIT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnZGlzcGF0Y2hfcm91dGUnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgICBlbHNlIHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMucm91dGVzLmhhcyBAIGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiAwID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5pZF9zZWxmID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG5cbiAgICB0aGlzLnJvdXRlcy5zZXQgQCBpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlXG4gICAgcmV0dXJuIHRydWVcbiAgdW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcikgOjpcbiAgICByZXR1cm4gdGhpcy5yb3V0ZXMuZGVsZXRlIEAgaWRfcm91dGVyXG4gIHJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclJvdXRlIEAgaWRfcm91dGVyLCBwa3QgPT4gOjpcbiAgICAgIGlmIDAgIT09IHBrdC50dGwgOjogY2hhbm5lbC5zZW5kUmF3KHBrdClcbiAgdmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgdW52ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgaWYgdGhpcy5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgfHwgY2hhbm5lbC5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgOjpcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgICBlbHNlIGNvbnNvbGUud2FybiBAICdVbnZlcmlmaWVkIHBlZXIgcm91dGUgKGlnbm9yZWQpOicsIEA6IGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIGxvY2FsIHRhcmdldFxuXG4gIHRhcmdldERpc2NvdmVyeSA9IFtdXG4gIGRpc2NvdmVyVGFyZ2V0KHF1ZXJ5KSA6OlxuICAgIHJldHVybiB0aGlzLl9maXJzdFRhcmdldCBAIHF1ZXJ5LCB0aGlzLnRhcmdldERpc2NvdmVyeVxuXG4gIGJpbmREaXNwYXRjaFNlbGYoKSA6OlxuICAgIGNvbnN0IGRpc3BhdGNoU2VsZiA9IGFzeW5jIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICBjb25zdCBpZF90YXJnZXQgPSBwa3QuaWRfdGFyZ2V0XG4gICAgICBsZXQgdGFyZ2V0ID0gdGhpcy50YXJnZXRzLmdldChpZF90YXJnZXQpXG4gICAgICBpZiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgICByZXR1cm4gY2hhbm5lbCAmJiBjaGFubmVsLnVuZGVsaXZlcmFibGUocGt0LCAndGFyZ2V0JylcblxuICAgICAgaWYgZmFsc2UgPT09IGF3YWl0IHRhcmdldChwa3QsIHRoaXMpIDo6XG4gICAgICAgIHRoaXMudW5yZWdpc3RlclRhcmdldChpZF90YXJnZXQpXG5cbiAgICB0aGlzLmRpc3BhdGNoU2VsZiA9IGRpc3BhdGNoU2VsZlxuICAgIHJldHVybiBkaXNwYXRjaFNlbGZcblxuICBfY3JlYXRlVGFyZ2V0c01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcbiAgdGFyZ2V0cyA9IHRoaXMuX2NyZWF0ZVRhcmdldHNNYXAoKVxuICByZWdpc3RlclRhcmdldChpZF90YXJnZXQsIHRhcmdldCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaWRfdGFyZ2V0ICYmIHVuZGVmaW5lZCA9PT0gdGFyZ2V0IDo6XG4gICAgICB0YXJnZXQgPSBpZF90YXJnZXRcbiAgICAgIGlkX3RhcmdldCA9IHRhcmdldC5pZF90YXJnZXQgfHwgdGFyZ2V0LmlkXG5cbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICd0YXJnZXQnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgaWYgISBOdW1iZXIuaXNTYWZlSW50ZWdlciBAIGlkX3RhcmdldCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnaWRfdGFyZ2V0JyB0byBiZSBhbiBpbnRlZ2VyYFxuICAgIGlmIHRoaXMudGFyZ2V0cy5oYXMgQCBpZF90YXJnZXQgOjpcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIHJldHVybiB0aGlzLnRhcmdldHMuc2V0IEAgaWRfdGFyZ2V0LCB0YXJnZXRcbiAgdW5yZWdpc3RlclRhcmdldChpZF90YXJnZXQpIDo6XG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5kZWxldGUgQCBpZF90YXJnZXRcblxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIGNvbnRyb2wgcGFja2V0c1xuXG4gIGJpbmREaXNwYXRjaENvbnRyb2woKSA6OlxuICAgIHJldHVybiAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgaWYgMCAhPT0gcGt0LmlkX3RhcmdldCA6OiAvLyBjb25uZWN0aW9uLWRpc3BhdGNoZWRcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlzcGF0Y2hTZWxmKHBrdCwgY2hhbm5lbClcblxuICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMuZGlzcENvbnRyb2xCeVR5cGVbcGt0LnR5cGVdXG4gICAgICBpZiB1bmRlZmluZWQgIT09IGhhbmRsZXIgOjpcbiAgICAgICAgcmV0dXJuIGhhbmRsZXIodGhpcywgcGt0LCBjaGFubmVsKVxuICAgICAgZWxzZSA6OlxuICAgICAgICByZXR1cm4gdGhpcy5kbnVfZGlzcGF0Y2hfY29udHJvbChwa3QsIGNoYW5uZWwpXG5cbiAgZGlzcENvbnRyb2xCeVR5cGUgPSBPYmplY3QuY3JlYXRlIEAgdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVxuICBkbnVfZGlzcGF0Y2hfY29udHJvbChwa3QsIGNoYW5uZWwpIDo6XG4gICAgY29uc29sZS53YXJuIEAgJ2RudV9kaXNwYXRjaF9jb250cm9sJywgcGt0LnR5cGUsIHBrdFxuXG5cbk9iamVjdC5hc3NpZ24gQCBSb3V0ZXIucHJvdG90eXBlLCBAe31cbiAgZGlzcENvbnRyb2xCeVR5cGU6IE9iamVjdC5hc3NpZ24gQCB7fVxuICAgIGRpc3BDb250cm9sQnlUeXBlXG5cbiAgYmluZFByb21pc2VGaXJzdFJlc3VsdFxuICBfZmlyc3RSb3V0ZTogYmluZFByb21pc2VGaXJzdFJlc3VsdCgpXG4gIF9maXJzdFRhcmdldDogYmluZFByb21pc2VGaXJzdFJlc3VsdCgpXG5cbmV4cG9ydCBkZWZhdWx0IFJvdXRlclxuXG5cbmV4cG9ydCBmdW5jdGlvbiBwcm9taXNlUXVldWUoKSA6OlxuICBsZXQgdGlwID0gbnVsbFxuICByZXR1cm4gZnVuY3Rpb24gKCkgOjpcbiAgICBpZiBudWxsID09PSB0aXAgOjpcbiAgICAgIHRpcCA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICB0aXAudGhlbiBAIGNsZWFyX3RpcFxuICAgIHJldHVybiB0aXBcblxuICBmdW5jdGlvbiBjbGVhcl90aXAoKSA6OlxuICAgIHRpcCA9IG51bGxcblxuZnVuY3Rpb24gaXNfZGVmaW5lZChlKSA6OiByZXR1cm4gdW5kZWZpbmVkICE9PSBlXG5leHBvcnQgZnVuY3Rpb24gYmluZFByb21pc2VGaXJzdFJlc3VsdChvcHRpb25zPXt9KSA6OlxuICBjb25zdCB0ZXN0ID0gb3B0aW9ucy50ZXN0IHx8IGlzX2RlZmluZWRcbiAgY29uc3Qgb25fZXJyb3IgPSBvcHRpb25zLm9uX2Vycm9yIHx8IGNvbnNvbGUuZXJyb3JcbiAgY29uc3QgaWZBYnNlbnQgPSBvcHRpb25zLmFic2VudCB8fCBudWxsXG5cbiAgcmV0dXJuICh0aXAsIGxzdEZucykgPT5cbiAgICBuZXcgUHJvbWlzZSBAIHJlc29sdmUgPT4gOjpcbiAgICAgIGNvbnN0IHJlc29sdmVJZiA9IGUgPT4gdGVzdChlKSA/IHJlc29sdmUoZSkgOiBlXG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUodGlwKVxuICAgICAgUHJvbWlzZS5hbGwgQFxuICAgICAgICBBcnJheS5mcm9tIEAgbHN0Rm5zLCBmbiA9PlxuICAgICAgICAgIHRpcC50aGVuKGZuKS50aGVuKHJlc29sdmVJZiwgb25fZXJyb3IpXG4gICAgICAudGhlbiBAIGFic2VudCwgYWJzZW50XG5cbiAgICAgIGZ1bmN0aW9uIGFic2VudCgpIDo6XG4gICAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpZkFic2VudCA6OlxuICAgICAgICAgIHJlc29sdmUgQCBpZkFic2VudCgpXG4gICAgICAgIGVsc2UgcmVzb2x2ZSBAIGlmQWJzZW50XG4iLCJpbXBvcnQge3NlbmRfaGVsbG8sIHNlbmRfcGluZ3Bvbmd9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cblxuZXhwb3J0IGNsYXNzIENoYW5uZWwgOjpcbiAgc2VuZFJhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuICBwYWNrUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG5cbiAgcGFja0FuZFNlbmRSYXcoLi4uYXJncykgOjpcbiAgICByZXR1cm4gdGhpcy5zZW5kUmF3IEAgdGhpcy5wYWNrUmF3IEAgLi4uYXJnc1xuXG4gIHNlbmRKU09OKHBrdF9vYmopIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja0pTT04gQCBwa3Rfb2JqXG4gIHBhY2tKU09OKHBrdF9vYmopIDo6XG4gICAgaWYgdW5kZWZpbmVkICE9PSBwa3Rfb2JqLmhlYWRlciA6OlxuICAgICAgcGt0X29iai5oZWFkZXIgPSBKU09OLnN0cmluZ2lmeSBAIHBrdF9vYmouaGVhZGVyXG4gICAgaWYgdW5kZWZpbmVkICE9PSBwa3Rfb2JqLmJvZHkgOjpcbiAgICAgIHBrdF9vYmouYm9keSA9IEpTT04uc3RyaW5naWZ5IEAgcGt0X29iai5ib2R5XG4gICAgcmV0dXJuIHRoaXMucGFja1Jhdyhwa3Rfb2JqKVxuXG5cbiAgLy8gLS0tIENvbnRyb2wgbWVzc2FnZSB1dGlsaXRpZXNcblxuICBzZW5kUm91dGluZ0hhbmRzaGFrZSgpIDo6XG4gICAgcmV0dXJuIHNlbmRfaGVsbG8odGhpcywgdGhpcy5odWIucm91dGVyLmVjX3B1Yl9pZClcbiAgc2VuZFBpbmcoKSA6OlxuICAgIHJldHVybiBzZW5kX3Bpbmdwb25nKHRoaXMpXG5cblxuICBjbG9uZShwcm9wcywgLi4uZXh0cmEpIDo6XG4gICAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUodGhpcywgcHJvcHMpXG4gICAgcmV0dXJuIDAgPT09IGV4dHJhLmxlbmd0aCA/IHNlbGYgOiBPYmplY3QuYXNzaWduKHNlbGYsIC4uLmV4dHJhKVxuICBiaW5kQ2hhbm5lbChzZW5kUmF3LCBwcm9wcykgOjogcmV0dXJuIGJpbmRDaGFubmVsKHRoaXMsIHNlbmRSYXcsIHByb3BzKVxuICBiaW5kRGlzcGF0Y2hQYWNrZXRzKCkgOjogcmV0dXJuIGJpbmREaXNwYXRjaFBhY2tldHModGhpcylcblxuICB1bmRlbGl2ZXJhYmxlKHBrdCwgbW9kZSkgOjpcbiAgICBjb25zdCBydHIgPSBwa3QuaWRfcm91dGVyICE9PSB0aGlzLmh1Yi5yb3V0ZXIuaWRfc2VsZiA/IHBrdC5pZF9yb3V0ZXIgOiAnc2VsZidcbiAgICBjb25zb2xlLndhcm4gQCBgVW5kZWxpdmVyYWJsZVske21vZGV9XTogJHtwa3QuaWRfdGFyZ2V0fSBvZiAke3J0cn1gXG5cbiAgc3RhdGljIGFzQVBJKGh1YiwgcGFja1JhdykgOjpcbiAgICBjb25zdCBzZWxmID0gbmV3IHRoaXMoKVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgc2VsZiwgQDpcbiAgICAgIHBhY2tSYXc6IEA6IHZhbHVlOiBwYWNrUmF3XG4gICAgICBodWI6IEA6IHZhbHVlOiBodWJcbiAgICAgIF9yb290XzogQDogdmFsdWU6IHNlbGZcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0NoYW5uZWxBUEkoaHViLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIHRoaXMuYXNBUEkgQCBodWIsIHBhY2tldFBhcnNlci5wYWNrUGFja2V0XG5cbiAgc3RhdGljIGFzSW50ZXJuYWxBUEkoaHViLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgY29uc3Qgc2VsZiA9IHRoaXMuYXNBUEkgQCBodWIsIHBhY2tldFBhcnNlci5wYWNrUGFja2V0T2JqXG4gICAgc2VsZi5iaW5kSW50ZXJuYWxDaGFubmVsID0gZGlzcGF0Y2ggPT4gYmluZEludGVybmFsQ2hhbm5lbChzZWxmLCBkaXNwYXRjaClcbiAgICByZXR1cm4gc2VsZlxuXG5cbmV4cG9ydCBkZWZhdWx0IENoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kQ2hhbm5lbChjaGFubmVsLCBzZW5kUmF3LCBwcm9wcykgOjpcbiAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHNlbmRSYXcgOjpcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYENoYW5uZWwgZXhwZWN0cyAnc2VuZFJhdycgZnVuY3Rpb24gcGFyYW1ldGVyYFxuXG4gIGNvbnN0IGNvcmVfcHJvcHMgPSBAOiBzZW5kUmF3OiBAe30gdmFsdWU6IHNlbmRSYXdcbiAgcHJvcHMgPSBudWxsID09IHByb3BzID8gY29yZV9wcm9wcyA6IE9iamVjdC5hc3NpZ24gQCBjb3JlX3Byb3BzLCBwcm9wc1xuXG4gIGNvbnN0IHNlbGYgPSBPYmplY3QuY3JlYXRlIEAgY2hhbm5lbCwgcHJvcHNcbiAgcmV0dXJuIHNlbmRSYXcuY2hhbm5lbCA9IHNlbGZcblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRJbnRlcm5hbENoYW5uZWwoY2hhbm5lbCwgZGlzcGF0Y2gpIDo6XG4gIGRpc3BhdGNoX3BrdF9vYmouY2hhbm5lbCA9IGNoYW5uZWxcbiAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgY2hhbm5lbCwgQHt9XG4gICAgc2VuZFJhdzogQHt9IHZhbHVlOiBkaXNwYXRjaF9wa3Rfb2JqXG4gICAgYmluZENoYW5uZWw6IEB7fSB2YWx1ZTogbnVsbFxuXG4gIGZ1bmN0aW9uIGRpc3BhdGNoX3BrdF9vYmoocGt0KSA6OlxuICAgIGlmIHVuZGVmaW5lZCA9PT0gcGt0Ll9yYXdfIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkIGEgcGFyc2VkIHBrdF9vYmogd2l0aCB2YWxpZCAnX3Jhd18nIGJ1ZmZlciBwcm9wZXJ0eWBcbiAgICBkaXNwYXRjaCBAIFtwa3RdLCBjaGFubmVsXG4gICAgcmV0dXJuIHRydWVcblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaFBhY2tldHMoY2hhbm5lbCkgOjpcbiAgY29uc3QgZGlzcGF0Y2ggPSBjaGFubmVsLmh1Yi5yb3V0ZXIuZGlzcGF0Y2hcbiAgY29uc3QgZmVlZCA9IGNoYW5uZWwuaHViLnBhY2tldFBhcnNlci5wYWNrZXRTdHJlYW0oKVxuXG4gIHJldHVybiBmdW5jdGlvbiBvbl9yZWN2X2RhdGEoZGF0YSkgOjpcbiAgICBjb25zdCBwa3RMaXN0ID0gZmVlZChkYXRhKVxuICAgIGlmIDAgPCBwa3RMaXN0Lmxlbmd0aCA6OlxuICAgICAgZGlzcGF0Y2ggQCBwa3RMaXN0LCBjaGFubmVsXG4iLCJpbXBvcnQge1JvdXRlcn0gZnJvbSAnLi9yb3V0ZXIuanN5J1xuaW1wb3J0IHtDaGFubmVsfSBmcm9tICcuL2NoYW5uZWwuanN5J1xuXG5leHBvcnQgY2xhc3MgRmFicmljSHViIDo6XG4gIGNvbnN0cnVjdG9yKCkgOjpcbiAgICBhcHBseVBsdWdpbnMgQCAncHJlJywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG5cbiAgICBjb25zdCBwYWNrZXRQYXJzZXIgPSB0aGlzLnBhY2tldFBhcnNlclxuICAgIGlmIG51bGw9PXBhY2tldFBhcnNlciB8fCAhIHBhY2tldFBhcnNlci5pc1BhY2tldFBhcnNlcigpIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEludmFsaWQgaHViLnBhY2tldFBhcnNlcmBcblxuICAgIGNvbnN0IHJvdXRlciA9IHRoaXMuX2luaXRfcm91dGVyKClcbiAgICBjb25zdCBfYXBpX2NoYW5uZWwgPSB0aGlzLl9pbml0X2NoYW5uZWxBUEkocGFja2V0UGFyc2VyKVxuICAgIGNvbnN0IF9hcGlfaW50ZXJuYWwgPSB0aGlzLl9pbml0X2ludGVybmFsQVBJKHBhY2tldFBhcnNlcilcbiAgICByb3V0ZXIuaW5pdERpc3BhdGNoKClcbiAgICBfYXBpX2ludGVybmFsLmJpbmRJbnRlcm5hbENoYW5uZWwgQCByb3V0ZXIuZGlzcGF0Y2hcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQHt9XG4gICAgICByb3V0ZXI6IEB7fSB2YWx1ZTogcm91dGVyXG4gICAgICBwYWNrZXRQYXJzZXI6IEB7fSB2YWx1ZTogcGFja2V0UGFyc2VyXG4gICAgICBfYXBpX2NoYW5uZWw6IEB7fSB2YWx1ZTogX2FwaV9jaGFubmVsXG4gICAgICBfYXBpX2ludGVybmFsOiBAe30gdmFsdWU6IF9hcGlfaW50ZXJuYWxcblxuICAgIGFwcGx5UGx1Z2lucyBAIG51bGwsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIGFwcGx5UGx1Z2lucyBAICdwb3N0JywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgcmV0dXJuIHRoaXNcblxuICBfaW5pdF9yb3V0ZXIoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgUGx1Z2luIHJlc3BvbnNpYmxpdHlgXG5cbiAgX2luaXRfY2hhbm5lbEFQSShwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIENoYW5uZWwuYXNDaGFubmVsQVBJIEAgdGhpcywgcGFja2V0UGFyc2VyXG4gIF9pbml0X2ludGVybmFsQVBJKHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gQ2hhbm5lbC5hc0ludGVybmFsQVBJIEAgdGhpcywgcGFja2V0UGFyc2VyXG5cblxuICBzdGF0aWMgcGx1Z2luKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICByZXR1cm4gdGhpcy5wbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucylcbiAgc3RhdGljIHBsdWdpbnMoLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIGNvbnN0IHBsdWdpbkxpc3QgPSBbXS5jb25jYXQgQFxuICAgICAgdGhpcy5wcm90b3R5cGUucGx1Z2luTGlzdCB8fCBbXVxuICAgICAgcGx1Z2luRnVuY3Rpb25zXG5cbiAgICBwbHVnaW5MaXN0LnNvcnQgQCAoYSwgYikgPT4gKDAgfCBhLm9yZGVyKSAtICgwIHwgYi5vcmRlcilcblxuICAgIGNvbnN0IEJhc2VIdWIgPSB0aGlzLl9CYXNlSHViXyB8fCB0aGlzXG4gICAgY2xhc3MgRmFicmljSHViX1BJIGV4dGVuZHMgQmFzZUh1YiA6OlxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgRmFicmljSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBsdWdpbkxpc3Q6IEB7fSB2YWx1ZTogT2JqZWN0LmZyZWV6ZSBAIHBsdWdpbkxpc3RcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIEZhYnJpY0h1Yl9QSSwgQDpcbiAgICAgIF9CYXNlSHViXzogQHt9IHZhbHVlOiBCYXNlSHViXG5cbiAgICBhcHBseVBsdWdpbnMgQCAnc3ViY2xhc3MnLCBwbHVnaW5MaXN0LCBGYWJyaWNIdWJfUEksIEA6IFJvdXRlciwgQ2hhbm5lbFxuICAgIHJldHVybiBGYWJyaWNIdWJfUElcblxuXG4gIHZhbHVlT2YoKSA6OiByZXR1cm4gdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBnZXQgaWRfc2VsZigpIDo6IHJldHVybiB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGlkX3JvdXRlcl9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5wYWNrZXRQYXJzZXIucGFja0lkIEBcbiAgICAgIHRoaXMucm91dGVyLmlkX3NlbGZcbiAgY29ubmVjdF9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5fYXBpX2ludGVybmFsLmNsb25lKClcbiAgYmluZFJvdXRlRGlzcGF0Y2goY2hhbm5lbCkgOjpcbiAgICBpZiBudWxsID09IGNoYW5uZWwgOjogY2hhbm5lbCA9IHRoaXMuY29ubmVjdF9zZWxmKClcbiAgICByZXR1cm4gaWRfcm91dGVyID0+IDo6XG4gICAgICBsZXQgcm91dGUsIGRpc2NvID0gdGhpcy5yb3V0ZXIucmVzb2x2ZVJvdXRlKGlkX3JvdXRlcilcbiAgICAgIHJldHVybiBhc3luYyBwa3QgPT4gOjpcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSByb3V0ZSA6OlxuICAgICAgICAgIHJvdXRlID0gZGlzY28gPSBhd2FpdCBkaXNjb1xuICAgICAgICByZXR1cm4gcm91dGUgQCBwa3QsIGNoYW5uZWxcblxuICBjb25uZWN0KGNvbm5fdXJsKSA6OlxuICAgIGlmIG51bGwgPT0gY29ubl91cmwgOjpcbiAgICAgIHJldHVybiB0aGlzLmNvbm5lY3Rfc2VsZigpXG5cbiAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGNvbm5fdXJsIDo6XG4gICAgICBjb25uX3VybCA9IHRoaXMuX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybClcblxuICAgIGNvbnN0IGNvbm5lY3QgPSB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFtjb25uX3VybC5wcm90b2NvbF1cbiAgICBpZiAhIGNvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBFcnJvciBAIGBDb25uZWN0aW9uIHByb3RvY29sIFwiJHtjb25uX3VybC5wcm90b2NvbH1cIiBub3QgcmVnaXN0ZXJlZCBmb3IgXCIke2Nvbm5fdXJsLnRvU3RyaW5nKCl9XCJgXG5cbiAgICByZXR1cm4gY29ubmVjdChjb25uX3VybClcblxuICByZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbChwcm90b2NvbCwgY2JfY29ubmVjdCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2JfY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnY2JfY29ubmVjdCcgZnVuY3Rpb25gXG4gICAgY29uc3QgYnlQcm90b2NvbCA9IE9iamVjdC5hc3NpZ24gQCB7fSwgdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xcbiAgICBieVByb3RvY29sW3Byb3RvY29sXSA9IGNiX2Nvbm5lY3RcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgdGhpcywgJ19jb25uZWN0QnlQcm90b2NvbCcsXG4gICAgICBAOiB2YWx1ZTogYnlQcm90b2NvbCwgY29uZmlndXJhYmxlOiB0cnVlXG5cbiAgX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybCkgOjpcbiAgICByZXR1cm4gbmV3IFVSTChjb25uX3VybClcblxuZXhwb3J0IGRlZmF1bHQgRmFicmljSHViXG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVBsdWdpbnMoa2V5LCBwbHVnaW5MaXN0LCAuLi5hcmdzKSA6OlxuICBpZiAhIGtleSA6OiBrZXkgPSBudWxsXG4gIGZvciBsZXQgcGx1Z2luIG9mIHBsdWdpbkxpc3QgOjpcbiAgICBpZiBudWxsICE9PSBrZXkgOjogcGx1Z2luID0gcGx1Z2luW2tleV1cbiAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgcGx1Z2luIDo6XG4gICAgICBwbHVnaW4oLi4uYXJncylcbiJdLCJuYW1lcyI6WyJkaXNwQ29udHJvbEJ5VHlwZSIsInJlY3ZfaGVsbG8iLCJyZWN2X29sbGVoIiwicmVjdl9wb25nIiwicmVjdl9waW5nIiwic2VuZF9oZWxsbyIsImNoYW5uZWwiLCJlY19wdWJfaWQiLCJodWIiLCJyb3V0ZXIiLCJwYWNrQW5kU2VuZFJhdyIsInR5cGUiLCJpZF9yb3V0ZXJfc2VsZiIsInBrdCIsImVjX290aGVyX2lkIiwiaGVhZGVyX2J1ZmZlciIsImxlbmd0aCIsImVjX2lkX2htYWMiLCJobWFjX3NlY3JldCIsImlkX3JvdXRlciIsInVucGFja0lkIiwiYm9keV9idWZmZXIiLCJ1bnZlcmlmaWVkUGVlclJvdXRlIiwic2VuZF9vbGxlaCIsInBlZXJfaG1hY19jbGFpbSIsImNvbXBhcmUiLCJ2ZXJpZmllZFBlZXJSb3V0ZSIsInNlbmRfcGluZ3BvbmciLCJwb25nIiwiRGF0ZSIsInRvSVNPU3RyaW5nIiwibG9jYWwiLCJyZW1vdGUiLCJ0b1N0cmluZyIsImRlbHRhIiwidHNfcG9uZyIsImVyciIsInRzX3BpbmciLCJSb3V0ZXIiLCJpZF9zZWxmIiwicm91dGVEaXNjb3ZlcnkiLCJ0YXJnZXREaXNjb3ZlcnkiLCJ0YXJnZXRzIiwiX2NyZWF0ZVRhcmdldHNNYXAiLCJPYmplY3QiLCJjcmVhdGUiLCJkZWZpbmVQcm9wZXJ0aWVzIiwidmFsdWUiLCJyb3V0ZXMiLCJfY3JlYXRlUm91dGVzTWFwIiwic2V0IiwiYmluZERpc3BhdGNoQ29udHJvbCIsImJpbmREaXNwYXRjaFNlbGYiLCJiaW5kRGlzcGF0Y2hSb3V0ZXMiLCJlcnJvciIsIk1hcCIsImRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlIiwiZGlzcGF0Y2hfcm91dGUiLCJfZmlyc3RSb3V0ZSIsInJlZ2lzdGVyUm91dGUiLCJwcXVldWUiLCJwcm9taXNlUXVldWUiLCJkaXNwYXRjaCIsInBrdExpc3QiLCJwcSIsIm1hcCIsInRoZW4iLCJkaXNwYXRjaF9vbmUiLCJnZXQiLCJ1bmRlZmluZWQiLCJ1bmRlbGl2ZXJhYmxlIiwidW5yZWdpc3RlclJvdXRlIiwib25fZXJyb3JfaW5fZGlzcGF0Y2giLCJyZXNvbHZlUm91dGUiLCJUeXBlRXJyb3IiLCJoYXMiLCJkZWxldGUiLCJ0dGwiLCJzZW5kUmF3IiwicmVnaXN0ZXJQZWVyUm91dGUiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJjb25zb2xlIiwid2FybiIsInF1ZXJ5IiwiX2ZpcnN0VGFyZ2V0IiwiZGlzcGF0Y2hTZWxmIiwiaWRfdGFyZ2V0IiwidGFyZ2V0IiwidW5yZWdpc3RlclRhcmdldCIsImlkIiwiTnVtYmVyIiwiaXNTYWZlSW50ZWdlciIsImhhbmRsZXIiLCJkbnVfZGlzcGF0Y2hfY29udHJvbCIsImFzc2lnbiIsInByb3RvdHlwZSIsImJpbmRQcm9taXNlRmlyc3RSZXN1bHQiLCJ0aXAiLCJQcm9taXNlIiwicmVzb2x2ZSIsImNsZWFyX3RpcCIsImlzX2RlZmluZWQiLCJlIiwib3B0aW9ucyIsInRlc3QiLCJvbl9lcnJvciIsImlmQWJzZW50IiwiYWJzZW50IiwibHN0Rm5zIiwicmVzb2x2ZUlmIiwiYWxsIiwiQXJyYXkiLCJmcm9tIiwiZm4iLCJDaGFubmVsIiwiRXJyb3IiLCJhcmdzIiwicGFja1JhdyIsInBrdF9vYmoiLCJwYWNrSlNPTiIsImhlYWRlciIsIkpTT04iLCJzdHJpbmdpZnkiLCJib2R5IiwicHJvcHMiLCJleHRyYSIsInNlbGYiLCJiaW5kQ2hhbm5lbCIsImJpbmREaXNwYXRjaFBhY2tldHMiLCJtb2RlIiwicnRyIiwiYXNBUEkiLCJhc0NoYW5uZWxBUEkiLCJwYWNrZXRQYXJzZXIiLCJwYWNrUGFja2V0IiwiYXNJbnRlcm5hbEFQSSIsInBhY2tQYWNrZXRPYmoiLCJiaW5kSW50ZXJuYWxDaGFubmVsIiwiY29yZV9wcm9wcyIsImRpc3BhdGNoX3BrdF9vYmoiLCJfcmF3XyIsImZlZWQiLCJwYWNrZXRTdHJlYW0iLCJvbl9yZWN2X2RhdGEiLCJkYXRhIiwiRmFicmljSHViIiwicGx1Z2luTGlzdCIsImlzUGFja2V0UGFyc2VyIiwiX2luaXRfcm91dGVyIiwiX2FwaV9jaGFubmVsIiwiX2luaXRfY2hhbm5lbEFQSSIsIl9hcGlfaW50ZXJuYWwiLCJfaW5pdF9pbnRlcm5hbEFQSSIsImluaXREaXNwYXRjaCIsInBsdWdpbiIsInBsdWdpbkZ1bmN0aW9ucyIsInBsdWdpbnMiLCJjb25jYXQiLCJzb3J0IiwiYSIsImIiLCJvcmRlciIsIkJhc2VIdWIiLCJfQmFzZUh1Yl8iLCJGYWJyaWNIdWJfUEkiLCJmcmVlemUiLCJwYWNrSWQiLCJjbG9uZSIsImNvbm5lY3Rfc2VsZiIsInJvdXRlIiwiZGlzY28iLCJjb25uX3VybCIsIl9wYXJzZUNvbm5lY3RVUkwiLCJjb25uZWN0IiwiX2Nvbm5lY3RCeVByb3RvY29sIiwicHJvdG9jb2wiLCJjYl9jb25uZWN0IiwiYnlQcm90b2NvbCIsImRlZmluZVByb3BlcnR5IiwiY29uZmlndXJhYmxlIiwiVVJMIiwiYXBwbHlQbHVnaW5z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
