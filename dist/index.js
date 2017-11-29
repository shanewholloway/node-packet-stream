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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvY29udHJvbF9wcm90b2NvbC5qc3kiLCIuLi9jb2RlL3JvdXRlci5qc3kiLCIuLi9jb2RlL2NoYW5uZWwuanN5IiwiLi4vY29kZS9odWIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBkaXNwQ29udHJvbEJ5VHlwZSA9IEB7fVxuICBbMHhmMF06IHJlY3ZfaGVsbG9cbiAgWzB4ZjFdOiByZWN2X29sbGVoXG4gIFsweGZlXTogcmVjdl9wb25nXG4gIFsweGZmXTogcmVjdl9waW5nXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9oZWxsbyhjaGFubmVsKSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwuaHViLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgaWYgMCAhPT0gZWNfb3RoZXJfaWQubGVuZ3RoICYmIHJvdXRlci5lY19pZF9obWFjIDo6XG4gICAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCkgOiBudWxsXG4gICAgc2VuZF9vbGxlaCBAIGNoYW5uZWwsIGhtYWNfc2VjcmV0XG5cbiAgZWxzZSA6OlxuICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChwa3QuYm9keV9idWZmZXIoKSwgMClcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbmZ1bmN0aW9uIHNlbmRfb2xsZWgoY2hhbm5lbCwgaG1hY19zZWNyZXQpIDo6XG4gIGNvbnN0IHtlY19wdWJfaWR9ID0gY2hhbm5lbC5odWIucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYxXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBobWFjX3NlY3JldFxuXG5mdW5jdGlvbiByZWN2X29sbGVoKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgY29uc3QgaWRfcm91dGVyID0gcGt0LnVucGFja0lkKGVjX290aGVyX2lkKVxuXG4gIGNvbnN0IGhtYWNfc2VjcmV0ID0gcm91dGVyLmVjX2lkX2htYWNcbiAgICA/IHJvdXRlci5lY19pZF9obWFjKGVjX290aGVyX2lkLCB0cnVlKSA6IG51bGxcbiAgY29uc3QgcGVlcl9obWFjX2NsYWltID0gcGt0LmJvZHlfYnVmZmVyKClcbiAgaWYgaG1hY19zZWNyZXQgJiYgMCA9PT0gaG1hY19zZWNyZXQuY29tcGFyZSBAIHBlZXJfaG1hY19jbGFpbSA6OlxuICAgIHJvdXRlci52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuICBlbHNlIDo6XG4gICAgcm91dGVyLnVudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBzZW5kX3Bpbmdwb25nKGNoYW5uZWwsIHBvbmcpIDo6XG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiBwb25nID8gMHhmZSA6IDB4ZmZcbiAgICBib2R5OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuZnVuY3Rpb24gcmVjdl9wb25nKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIHBrdC5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBsb2NhbFxuXG5mdW5jdGlvbiByZWN2X3Bpbmcocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGxvY2FsID0gbmV3IERhdGUoKVxuXG4gIHNlbmRfcGluZ3BvbmcgQCBjaGFubmVsLCB0cnVlXG5cbiAgdHJ5IDo6XG4gICAgY29uc3QgcmVtb3RlID0gbmV3IERhdGUgQCBwa3QuYm9keV9idWZmZXIoKS50b1N0cmluZygpXG4gICAgY29uc3QgZGVsdGEgPSByZW1vdGUgLSBsb2NhbFxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBkZWx0YSwgcmVtb3RlLCBsb2NhbFxuICBjYXRjaCBlcnIgOjpcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gbG9jYWxcblxuIiwiaW1wb3J0IHtkaXNwQ29udHJvbEJ5VHlwZX0gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuZXhwb3J0IGNsYXNzIFJvdXRlciA6OlxuICBjb25zdHJ1Y3RvcihpZF9zZWxmKSA6OlxuICAgIGlmIGlkX3NlbGYgOjpcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDogaWRfc2VsZjogQDogdmFsdWU6IGlkX3NlbGZcblxuICAvLyAtLS0gRGlzcGF0Y2ggY29yZSAtLS1cblxuICBpbml0RGlzcGF0Y2goKSA6OlxuICAgIGNvbnN0IHJvdXRlcyA9IHRoaXMuX2NyZWF0ZVJvdXRlc01hcCgpXG4gICAgcm91dGVzLnNldCBAIDAsIHRoaXMuYmluZERpc3BhdGNoQ29udHJvbCgpXG4gICAgaWYgbnVsbCAhPSB0aGlzLmlkX3NlbGYgOjpcbiAgICAgIHJvdXRlcy5zZXQgQCB0aGlzLmlkX3NlbGYsIHRoaXMuYmluZERpc3BhdGNoU2VsZigpXG5cbiAgICB0aGlzLmJpbmREaXNwYXRjaFJvdXRlcyhyb3V0ZXMpXG5cbiAgb25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBwa3QpIDo6XG4gICAgY29uc29sZS5lcnJvciBAICdFcnJvciBkdXJpbmcgcGFja2V0IGRpc3BhdGNoXFxuICBwa3Q6JywgcGt0LCAnXFxuJywgZXJyLCAnXFxuJ1xuXG4gIF9jcmVhdGVSb3V0ZXNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIHJvdXRlIC0tLVxuXG4gIHJvdXRlRGlzY292ZXJ5ID0gW11cbiAgYXN5bmMgZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyKSA6OlxuICAgIGNvbnN0IGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5fZmlyc3RSb3V0ZSBAIGlkX3JvdXRlciwgdGhpcy5yb3V0ZURpc2NvdmVyeVxuICAgIGlmIG51bGwgPT0gZGlzcGF0Y2hfcm91dGUgOjogcmV0dXJuXG4gICAgdGhpcy5yZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpXG4gICAgcmV0dXJuIGRpc3BhdGNoX3JvdXRlXG5cbiAgYmluZERpc3BhdGNoUm91dGVzKHJvdXRlcykgOjpcbiAgICBjb25zdCBwcXVldWUgPSBwcm9taXNlUXVldWUoKVxuICAgIGZ1bmN0aW9uIGRpc3BhdGNoKHBrdExpc3QsIGNoYW5uZWwpIDo6XG4gICAgICBjb25zdCBwcSA9IHBxdWV1ZSgpIC8vIHBxIHdpbGwgZGlzcGF0Y2ggZHVyaW5nIFByb21pc2UgcmVzb2x1dGlvbnNcbiAgICAgIHJldHVybiBwa3RMaXN0Lm1hcCBAIHBrdCA9PlxuICAgICAgICBwcS50aGVuIEAgKCkgPT4gZGlzcGF0Y2hfb25lKHBrdCwgY2hhbm5lbClcblxuICAgIGNvbnN0IGRpc3BhdGNoX29uZSA9IGFzeW5jIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICB0cnkgOjpcbiAgICAgICAgY29uc3QgaWRfcm91dGVyID0gcGt0LmlkX3JvdXRlclxuICAgICAgICBsZXQgZGlzcGF0Y2hfcm91dGUgPSByb3V0ZXMuZ2V0KGlkX3JvdXRlcilcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgIGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIpXG4gICAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgICAgcmV0dXJuIGNoYW5uZWwgJiYgY2hhbm5lbC51bmRlbGl2ZXJhYmxlKHBrdCwgJ3JvdXRlJylcblxuICAgICAgICBpZiBmYWxzZSA9PT0gYXdhaXQgZGlzcGF0Y2hfcm91dGUocGt0LCBjaGFubmVsKSA6OlxuICAgICAgICAgIHRoaXMudW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcilcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICB0aGlzLm9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgcGt0LCBjaGFubmVsKVxuXG4gICAgY29uc3QgcmVzb2x2ZVJvdXRlID0gaWRfcm91dGVyID0+XG4gICAgICByb3V0ZXMuZ2V0KGlkX3JvdXRlcikgfHxcbiAgICAgICAgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIpXG5cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEA6XG4gICAgICByb3V0ZXM6IEA6IHZhbHVlOiByb3V0ZXNcbiAgICAgIGRpc3BhdGNoOiBAOiB2YWx1ZTogZGlzcGF0Y2hcbiAgICAgIHJlc29sdmVSb3V0ZTogQDogdmFsdWU6IHJlc29sdmVSb3V0ZVxuICAgIHJldHVybiBkaXNwYXRjaFxuXG4gIHJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgIGlmIG51bGwgIT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnZGlzcGF0Y2hfcm91dGUnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgICBlbHNlIHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMucm91dGVzLmhhcyBAIGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiAwID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5pZF9zZWxmID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG5cbiAgICB0aGlzLnJvdXRlcy5zZXQgQCBpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlXG4gICAgcmV0dXJuIHRydWVcbiAgdW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcikgOjpcbiAgICByZXR1cm4gdGhpcy5yb3V0ZXMuZGVsZXRlIEAgaWRfcm91dGVyXG4gIHJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclJvdXRlIEAgaWRfcm91dGVyLCBwa3QgPT4gOjpcbiAgICAgIGlmIDAgIT09IHBrdC50dGwgOjogY2hhbm5lbC5zZW5kUmF3KHBrdClcbiAgdmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgdW52ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgaWYgdGhpcy5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgfHwgY2hhbm5lbC5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgOjpcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgICBlbHNlIGNvbnNvbGUud2FybiBAICdVbnZlcmlmaWVkIHBlZXIgcm91dGUgKGlnbm9yZWQpOicsIEA6IGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIGxvY2FsIHRhcmdldFxuXG4gIHRhcmdldERpc2NvdmVyeSA9IFtdXG4gIGRpc2NvdmVyVGFyZ2V0KHF1ZXJ5KSA6OlxuICAgIHJldHVybiB0aGlzLl9maXJzdFRhcmdldCBAIHF1ZXJ5LCB0aGlzLnRhcmdldERpc2NvdmVyeVxuXG4gIGJpbmREaXNwYXRjaFNlbGYoKSA6OlxuICAgIGNvbnN0IGRpc3BhdGNoU2VsZiA9IGFzeW5jIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICBjb25zdCBpZF90YXJnZXQgPSBwa3QuaWRfdGFyZ2V0XG4gICAgICBsZXQgdGFyZ2V0ID0gdGhpcy50YXJnZXRzLmdldChpZF90YXJnZXQpXG4gICAgICBpZiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgICByZXR1cm4gY2hhbm5lbCAmJiBjaGFubmVsLnVuZGVsaXZlcmFibGUocGt0LCAndGFyZ2V0JylcblxuICAgICAgaWYgZmFsc2UgPT09IGF3YWl0IHRhcmdldChwa3QsIHRoaXMpIDo6XG4gICAgICAgIHRoaXMudW5yZWdpc3RlclRhcmdldChpZF90YXJnZXQpXG5cbiAgICB0aGlzLmRpc3BhdGNoU2VsZiA9IGRpc3BhdGNoU2VsZlxuICAgIHJldHVybiBkaXNwYXRjaFNlbGZcblxuICBfY3JlYXRlVGFyZ2V0c01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcbiAgdGFyZ2V0cyA9IHRoaXMuX2NyZWF0ZVRhcmdldHNNYXAoKVxuICByZWdpc3RlclRhcmdldChpZF90YXJnZXQsIHRhcmdldCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaWRfdGFyZ2V0ICYmIHVuZGVmaW5lZCA9PT0gdGFyZ2V0IDo6XG4gICAgICB0YXJnZXQgPSBpZF90YXJnZXRcbiAgICAgIGlkX3RhcmdldCA9IHRhcmdldC5pZF90YXJnZXQgfHwgdGFyZ2V0LmlkXG5cbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICd0YXJnZXQnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgaWYgISBOdW1iZXIuaXNTYWZlSW50ZWdlciBAIGlkX3RhcmdldCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnaWRfdGFyZ2V0JyB0byBiZSBhbiBpbnRlZ2VyYFxuICAgIGlmIHRoaXMudGFyZ2V0cy5oYXMgQCBpZF90YXJnZXQgOjpcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIHJldHVybiB0aGlzLnRhcmdldHMuc2V0IEAgaWRfdGFyZ2V0LCB0YXJnZXRcbiAgdW5yZWdpc3RlclRhcmdldChpZF90YXJnZXQpIDo6XG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5kZWxldGUgQCBpZF90YXJnZXRcblxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIGNvbnRyb2wgcGFja2V0c1xuXG4gIGJpbmREaXNwYXRjaENvbnRyb2woKSA6OlxuICAgIHJldHVybiAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgaWYgMCAhPT0gcGt0LmlkX3RhcmdldCA6OiAvLyBjb25uZWN0aW9uLWRpc3BhdGNoZWRcbiAgICAgICAgcmV0dXJuIHRoaXMuZGlzcGF0Y2hTZWxmKHBrdCwgY2hhbm5lbClcblxuICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMuZGlzcENvbnRyb2xCeVR5cGVbcGt0LnR5cGVdXG4gICAgICBpZiB1bmRlZmluZWQgIT09IGhhbmRsZXIgOjpcbiAgICAgICAgcmV0dXJuIGhhbmRsZXIodGhpcywgcGt0LCBjaGFubmVsKVxuICAgICAgZWxzZSA6OlxuICAgICAgICByZXR1cm4gdGhpcy5kbnVfZGlzcGF0Y2hfY29udHJvbChwa3QsIGNoYW5uZWwpXG5cbiAgZGlzcENvbnRyb2xCeVR5cGUgPSBPYmplY3QuY3JlYXRlIEAgdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVxuICBkbnVfZGlzcGF0Y2hfY29udHJvbChwa3QsIGNoYW5uZWwpIDo6XG4gICAgY29uc29sZS53YXJuIEAgJ2RudV9kaXNwYXRjaF9jb250cm9sJywgcGt0LnR5cGUsIHBrdFxuXG5cbk9iamVjdC5hc3NpZ24gQCBSb3V0ZXIucHJvdG90eXBlLCBAe31cbiAgZGlzcENvbnRyb2xCeVR5cGU6IE9iamVjdC5hc3NpZ24gQCB7fVxuICAgIGRpc3BDb250cm9sQnlUeXBlXG5cbiAgYmluZFByb21pc2VGaXJzdFJlc3VsdFxuICBfZmlyc3RSb3V0ZTogYmluZFByb21pc2VGaXJzdFJlc3VsdCgpXG4gIF9maXJzdFRhcmdldDogYmluZFByb21pc2VGaXJzdFJlc3VsdCgpXG5cbmV4cG9ydCBkZWZhdWx0IFJvdXRlclxuXG5cbmV4cG9ydCBmdW5jdGlvbiBwcm9taXNlUXVldWUoKSA6OlxuICBsZXQgdGlwID0gbnVsbFxuICByZXR1cm4gZnVuY3Rpb24gKCkgOjpcbiAgICBpZiBudWxsID09PSB0aXAgOjpcbiAgICAgIHRpcCA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICB0aXAudGhlbiBAIGNsZWFyX3RpcFxuICAgIHJldHVybiB0aXBcblxuICBmdW5jdGlvbiBjbGVhcl90aXAoKSA6OlxuICAgIHRpcCA9IG51bGxcblxuZnVuY3Rpb24gaXNfZGVmaW5lZChlKSA6OiByZXR1cm4gdW5kZWZpbmVkICE9PSBlXG5leHBvcnQgZnVuY3Rpb24gYmluZFByb21pc2VGaXJzdFJlc3VsdChvcHRpb25zPXt9KSA6OlxuICBjb25zdCB0ZXN0ID0gb3B0aW9ucy50ZXN0IHx8IGlzX2RlZmluZWRcbiAgY29uc3Qgb25fZXJyb3IgPSBvcHRpb25zLm9uX2Vycm9yIHx8IGNvbnNvbGUuZXJyb3JcbiAgY29uc3QgaWZBYnNlbnQgPSBvcHRpb25zLmFic2VudCB8fCBudWxsXG5cbiAgcmV0dXJuICh0aXAsIGxzdEZucykgPT5cbiAgICBuZXcgUHJvbWlzZSBAIHJlc29sdmUgPT4gOjpcbiAgICAgIGNvbnN0IHJlc29sdmVJZiA9IGUgPT4gdGVzdChlKSA/IHJlc29sdmUoZSkgOiBlXG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUodGlwKVxuICAgICAgUHJvbWlzZS5hbGwgQFxuICAgICAgICBBcnJheS5mcm9tIEAgbHN0Rm5zLCBmbiA9PlxuICAgICAgICAgIHRpcC50aGVuKGZuKS50aGVuKHJlc29sdmVJZiwgb25fZXJyb3IpXG4gICAgICAudGhlbiBAIGFic2VudCwgYWJzZW50XG5cbiAgICAgIGZ1bmN0aW9uIGFic2VudCgpIDo6XG4gICAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpZkFic2VudCA6OlxuICAgICAgICAgIHJlc29sdmUgQCBpZkFic2VudCgpXG4gICAgICAgIGVsc2UgcmVzb2x2ZSBAIGlmQWJzZW50XG4iLCJpbXBvcnQge3NlbmRfaGVsbG8sIHNlbmRfcGluZ3Bvbmd9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cblxuZXhwb3J0IGNsYXNzIENoYW5uZWwgOjpcbiAgc2VuZFJhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuICBwYWNrUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG5cbiAgcGFja0FuZFNlbmRSYXcoLi4uYXJncykgOjpcbiAgICByZXR1cm4gdGhpcy5zZW5kUmF3IEAgdGhpcy5wYWNrUmF3IEAgLi4uYXJnc1xuXG4gIHNlbmRKU09OKHBrdF9vYmopIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja0pTT04gQCBwa3Rfb2JqXG4gIHBhY2tKU09OKHBrdF9vYmopIDo6XG4gICAgaWYgdW5kZWZpbmVkICE9PSBwa3Rfb2JqLmhlYWRlciA6OlxuICAgICAgcGt0X29iai5oZWFkZXIgPSBKU09OLnN0cmluZ2lmeSBAIHBrdF9vYmouaGVhZGVyXG4gICAgaWYgdW5kZWZpbmVkICE9PSBwa3Rfb2JqLmJvZHkgOjpcbiAgICAgIHBrdF9vYmouYm9keSA9IEpTT04uc3RyaW5naWZ5IEAgcGt0X29iai5ib2R5XG4gICAgcmV0dXJuIHRoaXMucGFja1Jhdyhwa3Rfb2JqKVxuXG5cbiAgLy8gLS0tIENvbnRyb2wgbWVzc2FnZSB1dGlsaXRpZXNcblxuICBzZW5kUm91dGluZ0hhbmRzaGFrZSgpIDo6XG4gICAgcmV0dXJuIHNlbmRfaGVsbG8odGhpcywgdGhpcy5odWIucm91dGVyLmVjX3B1Yl9pZClcbiAgc2VuZFBpbmcoKSA6OlxuICAgIHJldHVybiBzZW5kX3Bpbmdwb25nKHRoaXMpXG5cblxuICBjbG9uZShwcm9wcywgLi4uZXh0cmEpIDo6XG4gICAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUodGhpcywgcHJvcHMpXG4gICAgcmV0dXJuIDAgPT09IGV4dHJhLmxlbmd0aCA/IHNlbGYgOiBPYmplY3QuYXNzaWduKHNlbGYsIC4uLmV4dHJhKVxuICBiaW5kQ2hhbm5lbChzZW5kUmF3LCBwcm9wcykgOjogcmV0dXJuIGJpbmRDaGFubmVsKHRoaXMsIHNlbmRSYXcsIHByb3BzKVxuICBiaW5kRGlzcGF0Y2hQYWNrZXRzKCkgOjogcmV0dXJuIGJpbmREaXNwYXRjaFBhY2tldHModGhpcylcblxuICB1bmRlbGl2ZXJhYmxlKHBrdCwgbW9kZSkgOjpcbiAgICBjb25zdCBydHIgPSBwa3QuaWRfcm91dGVyICE9PSB0aGlzLmh1Yi5yb3V0ZXIuaWRfc2VsZiA/IHBrdC5pZF9yb3V0ZXIgOiAnc2VsZidcbiAgICBjb25zb2xlLndhcm4gQCBgVW5kZWxpdmVyYWJsZVske21vZGV9XTogJHtwa3QuaWRfdGFyZ2V0fSBvZiAke3J0cn1gXG5cbiAgc3RhdGljIGFzQVBJKGh1YiwgcGFja1JhdykgOjpcbiAgICBjb25zdCBzZWxmID0gbmV3IHRoaXMoKVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgc2VsZiwgQDpcbiAgICAgIHBhY2tSYXc6IEA6IHZhbHVlOiBwYWNrUmF3XG4gICAgICBodWI6IEA6IHZhbHVlOiBodWJcbiAgICAgIF9yb290XzogQDogdmFsdWU6IHNlbGZcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0NoYW5uZWxBUEkoaHViLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIHRoaXMuYXNBUEkgQCBodWIsIHBhY2tldFBhcnNlci5wYWNrUGFja2V0XG5cbiAgc3RhdGljIGFzSW50ZXJuYWxBUEkoaHViLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgY29uc3Qgc2VsZiA9IHRoaXMuYXNBUEkgQCBodWIsIHBhY2tldFBhcnNlci5wYWNrUGFja2V0T2JqXG4gICAgc2VsZi5iaW5kSW50ZXJuYWxDaGFubmVsID0gZGlzcGF0Y2ggPT4gYmluZEludGVybmFsQ2hhbm5lbChzZWxmLCBkaXNwYXRjaClcbiAgICByZXR1cm4gc2VsZlxuXG5cbmV4cG9ydCBkZWZhdWx0IENoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kQ2hhbm5lbChjaGFubmVsLCBzZW5kUmF3LCBwcm9wcykgOjpcbiAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHNlbmRSYXcgOjpcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYENoYW5uZWwgZXhwZWN0cyAnc2VuZFJhdycgZnVuY3Rpb24gcGFyYW1ldGVyYFxuXG4gIGNvbnN0IGNvcmVfcHJvcHMgPSBAOiBzZW5kUmF3OiBAe30gdmFsdWU6IHNlbmRSYXdcbiAgcHJvcHMgPSBudWxsID09IHByb3BzID8gY29yZV9wcm9wcyA6IE9iamVjdC5hc3NpZ24gQCBjb3JlX3Byb3BzLCBwcm9wc1xuXG4gIGNvbnN0IHNlbGYgPSBPYmplY3QuY3JlYXRlIEAgY2hhbm5lbCwgcHJvcHNcbiAgcmV0dXJuIHNlbmRSYXcuY2hhbm5lbCA9IHNlbGZcblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRJbnRlcm5hbENoYW5uZWwoY2hhbm5lbCwgZGlzcGF0Y2gpIDo6XG4gIGRpc3BhdGNoX3BrdF9vYmouY2hhbm5lbCA9IGNoYW5uZWxcbiAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgY2hhbm5lbCwgQHt9XG4gICAgc2VuZFJhdzogQHt9IHZhbHVlOiBkaXNwYXRjaF9wa3Rfb2JqXG4gICAgYmluZENoYW5uZWw6IEB7fSB2YWx1ZTogbnVsbFxuXG4gIGZ1bmN0aW9uIGRpc3BhdGNoX3BrdF9vYmoocGt0KSA6OlxuICAgIGlmIHVuZGVmaW5lZCA9PT0gcGt0Ll9yYXdfIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkIGEgcGFyc2VkIHBrdF9vYmogd2l0aCB2YWxpZCAnX3Jhd18nIGJ1ZmZlciBwcm9wZXJ0eWBcbiAgICBkaXNwYXRjaCBAIFtwa3RdLCBjaGFubmVsXG4gICAgcmV0dXJuIHRydWVcblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaFBhY2tldHMoY2hhbm5lbCkgOjpcbiAgY29uc3QgZGlzcGF0Y2ggPSBjaGFubmVsLmh1Yi5yb3V0ZXIuZGlzcGF0Y2hcbiAgY29uc3QgZmVlZCA9IGNoYW5uZWwuaHViLnBhY2tldFBhcnNlci5wYWNrZXRTdHJlYW0oKVxuXG4gIHJldHVybiBmdW5jdGlvbiBvbl9yZWN2X2RhdGEoZGF0YSkgOjpcbiAgICBjb25zdCBwa3RMaXN0ID0gZmVlZChkYXRhKVxuICAgIGlmIDAgPCBwa3RMaXN0Lmxlbmd0aCA6OlxuICAgICAgZGlzcGF0Y2ggQCBwa3RMaXN0LCBjaGFubmVsXG4iLCJpbXBvcnQge1JvdXRlcn0gZnJvbSAnLi9yb3V0ZXIuanN5J1xuaW1wb3J0IHtDaGFubmVsfSBmcm9tICcuL2NoYW5uZWwuanN5J1xuXG5leHBvcnQgY2xhc3MgRmFicmljSHViIDo6XG4gIGNvbnN0cnVjdG9yKCkgOjpcbiAgICBhcHBseVBsdWdpbnMgQCAncHJlJywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG5cbiAgICBjb25zdCBwYWNrZXRQYXJzZXIgPSB0aGlzLnBhY2tldFBhcnNlclxuICAgIGlmIG51bGw9PXBhY2tldFBhcnNlciB8fCAhIHBhY2tldFBhcnNlci5pc1BhY2tldFBhcnNlcigpIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEludmFsaWQgaHViLnBhY2tldFBhcnNlcmBcblxuICAgIGNvbnN0IHJvdXRlciA9IHRoaXMuX2luaXRfcm91dGVyKClcbiAgICBjb25zdCBfYXBpX2NoYW5uZWwgPSB0aGlzLl9pbml0X2NoYW5uZWxBUEkocGFja2V0UGFyc2VyKVxuICAgIGNvbnN0IF9hcGlfaW50ZXJuYWwgPSB0aGlzLl9pbml0X2ludGVybmFsQVBJKHBhY2tldFBhcnNlcilcbiAgICByb3V0ZXIuaW5pdERpc3BhdGNoKClcbiAgICBfYXBpX2ludGVybmFsLmJpbmRJbnRlcm5hbENoYW5uZWwgQCByb3V0ZXIuZGlzcGF0Y2hcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQHt9XG4gICAgICByb3V0ZXI6IEB7fSB2YWx1ZTogcm91dGVyXG4gICAgICBwYWNrZXRQYXJzZXI6IEB7fSB2YWx1ZTogcGFja2V0UGFyc2VyXG4gICAgICBfYXBpX2NoYW5uZWw6IEB7fSB2YWx1ZTogX2FwaV9jaGFubmVsXG4gICAgICBfYXBpX2ludGVybmFsOiBAe30gdmFsdWU6IF9hcGlfaW50ZXJuYWxcblxuICAgIGFwcGx5UGx1Z2lucyBAIG51bGwsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIGFwcGx5UGx1Z2lucyBAICdwb3N0JywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgcmV0dXJuIHRoaXNcblxuICBfaW5pdF9yb3V0ZXIoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgUGx1Z2luIHJlc3BvbnNpYmxpdHlgXG5cbiAgX2luaXRfY2hhbm5lbEFQSShwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIENoYW5uZWwuYXNDaGFubmVsQVBJIEAgdGhpcywgcGFja2V0UGFyc2VyXG4gIF9pbml0X2ludGVybmFsQVBJKHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gQ2hhbm5lbC5hc0ludGVybmFsQVBJIEAgdGhpcywgcGFja2V0UGFyc2VyXG5cblxuICBzdGF0aWMgcGx1Z2luKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICByZXR1cm4gdGhpcy5wbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucylcbiAgc3RhdGljIHBsdWdpbnMoLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIGNvbnN0IHBsdWdpbkxpc3QgPSBbXS5jb25jYXQgQFxuICAgICAgdGhpcy5wcm90b3R5cGUucGx1Z2luTGlzdCB8fCBbXVxuICAgICAgcGx1Z2luRnVuY3Rpb25zXG5cbiAgICBwbHVnaW5MaXN0LnNvcnQgQCAoYSwgYikgPT4gKDAgfCBhLm9yZGVyKSAtICgwIHwgYi5vcmRlcilcblxuICAgIGNvbnN0IEJhc2VIdWIgPSB0aGlzLl9CYXNlSHViXyB8fCB0aGlzXG4gICAgY2xhc3MgRmFicmljSHViX1BJIGV4dGVuZHMgQmFzZUh1YiA6OlxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgRmFicmljSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBsdWdpbkxpc3Q6IEB7fSB2YWx1ZTogT2JqZWN0LmZyZWV6ZSBAIHBsdWdpbkxpc3RcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIEZhYnJpY0h1Yl9QSSwgQDpcbiAgICAgIF9CYXNlSHViXzogQHt9IHZhbHVlOiBCYXNlSHViXG5cbiAgICBhcHBseVBsdWdpbnMgQCAnc3ViY2xhc3MnLCBwbHVnaW5MaXN0LCBGYWJyaWNIdWJfUEksIEA6IFJvdXRlciwgQ2hhbm5lbFxuICAgIHJldHVybiBGYWJyaWNIdWJfUElcblxuXG4gIGdldCBpZF9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBpZF9yb3V0ZXJfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMucGFja2V0UGFyc2VyLnBhY2tJZCBAXG4gICAgICB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGNvbm5lY3Rfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMuX2FwaV9pbnRlcm5hbC5jbG9uZSgpXG4gIGJpbmRSb3V0ZURpc3BhdGNoKGNoYW5uZWwpIDo6XG4gICAgaWYgbnVsbCA9PSBjaGFubmVsIDo6IGNoYW5uZWwgPSB0aGlzLmNvbm5lY3Rfc2VsZigpXG4gICAgcmV0dXJuIGlkX3JvdXRlciA9PiA6OlxuICAgICAgbGV0IHJvdXRlLCBkaXNjbyA9IHRoaXMucm91dGVyLnJlc29sdmVSb3V0ZShpZF9yb3V0ZXIpXG4gICAgICByZXR1cm4gYXN5bmMgcGt0ID0+IDo6XG4gICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gcm91dGUgOjpcbiAgICAgICAgICByb3V0ZSA9IGRpc2NvID0gYXdhaXQgZGlzY29cbiAgICAgICAgcmV0dXJuIHJvdXRlIEAgcGt0LCBjaGFubmVsXG5cbiAgY29ubmVjdChjb25uX3VybCkgOjpcbiAgICBpZiBudWxsID09IGNvbm5fdXJsIDo6XG4gICAgICByZXR1cm4gdGhpcy5jb25uZWN0X3NlbGYoKVxuXG4gICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBjb25uX3VybCA6OlxuICAgICAgY29ubl91cmwgPSB0aGlzLl9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpXG5cbiAgICBjb25zdCBjb25uZWN0ID0gdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xbY29ubl91cmwucHJvdG9jb2xdXG4gICAgaWYgISBjb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IgQCBgQ29ubmVjdGlvbiBwcm90b2NvbCBcIiR7Y29ubl91cmwucHJvdG9jb2x9XCIgbm90IHJlZ2lzdGVyZWQgZm9yIFwiJHtjb25uX3VybC50b1N0cmluZygpfVwiYFxuXG4gICAgcmV0dXJuIGNvbm5lY3QoY29ubl91cmwpXG5cbiAgcmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wocHJvdG9jb2wsIGNiX2Nvbm5lY3QpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNiX2Nvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2NiX2Nvbm5lY3QnIGZ1bmN0aW9uYFxuICAgIGNvbnN0IGJ5UHJvdG9jb2wgPSBPYmplY3QuYXNzaWduIEAge30sIHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sXG4gICAgYnlQcm90b2NvbFtwcm90b2NvbF0gPSBjYl9jb25uZWN0XG4gICAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIHRoaXMsICdfY29ubmVjdEJ5UHJvdG9jb2wnLFxuICAgICAgQDogdmFsdWU6IGJ5UHJvdG9jb2wsIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuXG4gIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgcmV0dXJuIG5ldyBVUkwoY29ubl91cmwpXG5cbmV4cG9ydCBkZWZhdWx0IEZhYnJpY0h1YlxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlQbHVnaW5zKGtleSwgcGx1Z2luTGlzdCwgLi4uYXJncykgOjpcbiAgaWYgISBrZXkgOjoga2V5ID0gbnVsbFxuICBmb3IgbGV0IHBsdWdpbiBvZiBwbHVnaW5MaXN0IDo6XG4gICAgaWYgbnVsbCAhPT0ga2V5IDo6IHBsdWdpbiA9IHBsdWdpbltrZXldXG4gICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIHBsdWdpbiA6OlxuICAgICAgcGx1Z2luKC4uLmFyZ3MpXG4iXSwibmFtZXMiOlsiZGlzcENvbnRyb2xCeVR5cGUiLCJyZWN2X2hlbGxvIiwicmVjdl9vbGxlaCIsInJlY3ZfcG9uZyIsInJlY3ZfcGluZyIsInNlbmRfaGVsbG8iLCJjaGFubmVsIiwiZWNfcHViX2lkIiwiaHViIiwicm91dGVyIiwicGFja0FuZFNlbmRSYXciLCJ0eXBlIiwiaWRfcm91dGVyX3NlbGYiLCJwa3QiLCJlY19vdGhlcl9pZCIsImhlYWRlcl9idWZmZXIiLCJsZW5ndGgiLCJlY19pZF9obWFjIiwiaG1hY19zZWNyZXQiLCJpZF9yb3V0ZXIiLCJ1bnBhY2tJZCIsImJvZHlfYnVmZmVyIiwidW52ZXJpZmllZFBlZXJSb3V0ZSIsInNlbmRfb2xsZWgiLCJwZWVyX2htYWNfY2xhaW0iLCJjb21wYXJlIiwidmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX3Bpbmdwb25nIiwicG9uZyIsIkRhdGUiLCJ0b0lTT1N0cmluZyIsImxvY2FsIiwicmVtb3RlIiwidG9TdHJpbmciLCJkZWx0YSIsInRzX3BvbmciLCJlcnIiLCJ0c19waW5nIiwiUm91dGVyIiwiaWRfc2VsZiIsInJvdXRlRGlzY292ZXJ5IiwidGFyZ2V0RGlzY292ZXJ5IiwidGFyZ2V0cyIsIl9jcmVhdGVUYXJnZXRzTWFwIiwiT2JqZWN0IiwiY3JlYXRlIiwiZGVmaW5lUHJvcGVydGllcyIsInZhbHVlIiwicm91dGVzIiwiX2NyZWF0ZVJvdXRlc01hcCIsInNldCIsImJpbmREaXNwYXRjaENvbnRyb2wiLCJiaW5kRGlzcGF0Y2hTZWxmIiwiYmluZERpc3BhdGNoUm91dGVzIiwiZXJyb3IiLCJNYXAiLCJkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZSIsImRpc3BhdGNoX3JvdXRlIiwiX2ZpcnN0Um91dGUiLCJyZWdpc3RlclJvdXRlIiwicHF1ZXVlIiwicHJvbWlzZVF1ZXVlIiwiZGlzcGF0Y2giLCJwa3RMaXN0IiwicHEiLCJtYXAiLCJ0aGVuIiwiZGlzcGF0Y2hfb25lIiwiZ2V0IiwidW5kZWZpbmVkIiwidW5kZWxpdmVyYWJsZSIsInVucmVnaXN0ZXJSb3V0ZSIsIm9uX2Vycm9yX2luX2Rpc3BhdGNoIiwicmVzb2x2ZVJvdXRlIiwiVHlwZUVycm9yIiwiaGFzIiwiZGVsZXRlIiwidHRsIiwic2VuZFJhdyIsInJlZ2lzdGVyUGVlclJvdXRlIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwiY29uc29sZSIsIndhcm4iLCJxdWVyeSIsIl9maXJzdFRhcmdldCIsImRpc3BhdGNoU2VsZiIsImlkX3RhcmdldCIsInRhcmdldCIsInVucmVnaXN0ZXJUYXJnZXQiLCJpZCIsIk51bWJlciIsImlzU2FmZUludGVnZXIiLCJoYW5kbGVyIiwiZG51X2Rpc3BhdGNoX2NvbnRyb2wiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJiaW5kUHJvbWlzZUZpcnN0UmVzdWx0IiwidGlwIiwiUHJvbWlzZSIsInJlc29sdmUiLCJjbGVhcl90aXAiLCJpc19kZWZpbmVkIiwiZSIsIm9wdGlvbnMiLCJ0ZXN0Iiwib25fZXJyb3IiLCJpZkFic2VudCIsImFic2VudCIsImxzdEZucyIsInJlc29sdmVJZiIsImFsbCIsIkFycmF5IiwiZnJvbSIsImZuIiwiQ2hhbm5lbCIsIkVycm9yIiwiYXJncyIsInBhY2tSYXciLCJwa3Rfb2JqIiwicGFja0pTT04iLCJoZWFkZXIiLCJKU09OIiwic3RyaW5naWZ5IiwiYm9keSIsInByb3BzIiwiZXh0cmEiLCJzZWxmIiwiYmluZENoYW5uZWwiLCJiaW5kRGlzcGF0Y2hQYWNrZXRzIiwibW9kZSIsInJ0ciIsImFzQVBJIiwiYXNDaGFubmVsQVBJIiwicGFja2V0UGFyc2VyIiwicGFja1BhY2tldCIsImFzSW50ZXJuYWxBUEkiLCJwYWNrUGFja2V0T2JqIiwiYmluZEludGVybmFsQ2hhbm5lbCIsImNvcmVfcHJvcHMiLCJkaXNwYXRjaF9wa3Rfb2JqIiwiX3Jhd18iLCJmZWVkIiwicGFja2V0U3RyZWFtIiwib25fcmVjdl9kYXRhIiwiZGF0YSIsIkZhYnJpY0h1YiIsInBsdWdpbkxpc3QiLCJpc1BhY2tldFBhcnNlciIsIl9pbml0X3JvdXRlciIsIl9hcGlfY2hhbm5lbCIsIl9pbml0X2NoYW5uZWxBUEkiLCJfYXBpX2ludGVybmFsIiwiX2luaXRfaW50ZXJuYWxBUEkiLCJpbml0RGlzcGF0Y2giLCJwbHVnaW4iLCJwbHVnaW5GdW5jdGlvbnMiLCJwbHVnaW5zIiwiY29uY2F0Iiwic29ydCIsImEiLCJiIiwib3JkZXIiLCJCYXNlSHViIiwiX0Jhc2VIdWJfIiwiRmFicmljSHViX1BJIiwiZnJlZXplIiwicGFja0lkIiwiY2xvbmUiLCJjb25uZWN0X3NlbGYiLCJyb3V0ZSIsImRpc2NvIiwiY29ubl91cmwiLCJfcGFyc2VDb25uZWN0VVJMIiwiY29ubmVjdCIsIl9jb25uZWN0QnlQcm90b2NvbCIsInByb3RvY29sIiwiY2JfY29ubmVjdCIsImJ5UHJvdG9jb2wiLCJkZWZpbmVQcm9wZXJ0eSIsImNvbmZpZ3VyYWJsZSIsIlVSTCIsImFwcGx5UGx1Z2lucyIsImtleSJdLCJtYXBwaW5ncyI6Ijs7OztBQUFPLE1BQU1BLG9C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
