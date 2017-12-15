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

const sym_unregister = Symbol('msg-fabirc unregister');
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

        if (sym_unregister === (await dispatch_route(pkt, channel))) {
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

      if (sym_unregister === (await target(pkt, this))) {
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

  unregister: sym_unregister,
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvY29udHJvbF9wcm90b2NvbC5qc3kiLCIuLi9jb2RlL3JvdXRlci5qc3kiLCIuLi9jb2RlL2NoYW5uZWwuanN5IiwiLi4vY29kZS9odWIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBkaXNwQ29udHJvbEJ5VHlwZSA9IEB7fVxuICBbMHhmMF06IHJlY3ZfaGVsbG9cbiAgWzB4ZjFdOiByZWN2X29sbGVoXG4gIFsweGZlXTogcmVjdl9wb25nXG4gIFsweGZmXTogcmVjdl9waW5nXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9oZWxsbyhjaGFubmVsKSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwuaHViLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgaWYgMCAhPT0gZWNfb3RoZXJfaWQubGVuZ3RoICYmIHJvdXRlci5lY19pZF9obWFjIDo6XG4gICAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCkgOiBudWxsXG4gICAgc2VuZF9vbGxlaCBAIGNoYW5uZWwsIGhtYWNfc2VjcmV0XG5cbiAgZWxzZSA6OlxuICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChwa3QuYm9keV9idWZmZXIoKSwgMClcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbmZ1bmN0aW9uIHNlbmRfb2xsZWgoY2hhbm5lbCwgaG1hY19zZWNyZXQpIDo6XG4gIGNvbnN0IHtlY19wdWJfaWR9ID0gY2hhbm5lbC5odWIucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYxXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBobWFjX3NlY3JldFxuXG5mdW5jdGlvbiByZWN2X29sbGVoKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgY29uc3QgaWRfcm91dGVyID0gcGt0LnVucGFja0lkKGVjX290aGVyX2lkKVxuXG4gIGNvbnN0IGhtYWNfc2VjcmV0ID0gcm91dGVyLmVjX2lkX2htYWNcbiAgICA/IHJvdXRlci5lY19pZF9obWFjKGVjX290aGVyX2lkLCB0cnVlKSA6IG51bGxcbiAgY29uc3QgcGVlcl9obWFjX2NsYWltID0gcGt0LmJvZHlfYnVmZmVyKClcbiAgaWYgaG1hY19zZWNyZXQgJiYgMCA9PT0gaG1hY19zZWNyZXQuY29tcGFyZSBAIHBlZXJfaG1hY19jbGFpbSA6OlxuICAgIHJvdXRlci52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuICBlbHNlIDo6XG4gICAgcm91dGVyLnVudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBzZW5kX3Bpbmdwb25nKGNoYW5uZWwsIHBvbmcpIDo6XG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiBwb25nID8gMHhmZSA6IDB4ZmZcbiAgICBib2R5OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuZnVuY3Rpb24gcmVjdl9wb25nKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIHBrdC5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBsb2NhbFxuXG5mdW5jdGlvbiByZWN2X3Bpbmcocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGxvY2FsID0gbmV3IERhdGUoKVxuXG4gIHNlbmRfcGluZ3BvbmcgQCBjaGFubmVsLCB0cnVlXG5cbiAgdHJ5IDo6XG4gICAgY29uc3QgcmVtb3RlID0gbmV3IERhdGUgQCBwa3QuYm9keV9idWZmZXIoKS50b1N0cmluZygpXG4gICAgY29uc3QgZGVsdGEgPSByZW1vdGUgLSBsb2NhbFxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBkZWx0YSwgcmVtb3RlLCBsb2NhbFxuICBjYXRjaCBlcnIgOjpcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gbG9jYWxcblxuIiwiaW1wb3J0IHtkaXNwQ29udHJvbEJ5VHlwZX0gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuY29uc3Qgc3ltX3VucmVnaXN0ZXIgPSBTeW1ib2woJ21zZy1mYWJpcmMgdW5yZWdpc3RlcicpXG5leHBvcnQgY2xhc3MgUm91dGVyIDo6XG4gIGNvbnN0cnVjdG9yKGlkX3NlbGYpIDo6XG4gICAgaWYgaWRfc2VsZiA6OlxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOiBpZF9zZWxmOiBAOiB2YWx1ZTogaWRfc2VsZlxuXG4gIC8vIC0tLSBEaXNwYXRjaCBjb3JlIC0tLVxuXG4gIGluaXREaXNwYXRjaCgpIDo6XG4gICAgY29uc3Qgcm91dGVzID0gdGhpcy5fY3JlYXRlUm91dGVzTWFwKClcbiAgICByb3V0ZXMuc2V0IEAgMCwgdGhpcy5iaW5kRGlzcGF0Y2hDb250cm9sKClcbiAgICBpZiBudWxsICE9IHRoaXMuaWRfc2VsZiA6OlxuICAgICAgcm91dGVzLnNldCBAIHRoaXMuaWRfc2VsZiwgdGhpcy5iaW5kRGlzcGF0Y2hTZWxmKClcblxuICAgIHRoaXMuYmluZERpc3BhdGNoUm91dGVzKHJvdXRlcylcblxuICBvbl9lcnJvcl9pbl9kaXNwYXRjaChlcnIsIHBrdCkgOjpcbiAgICBjb25zb2xlLmVycm9yIEAgJ0Vycm9yIGR1cmluZyBwYWNrZXQgZGlzcGF0Y2hcXG4gIHBrdDonLCBwa3QsICdcXG4nLCBlcnIsICdcXG4nXG5cbiAgX2NyZWF0ZVJvdXRlc01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcblxuICAvLyAtLS0gRGlzcGF0Y2ggdG8gcm91dGUgLS0tXG5cbiAgcm91dGVEaXNjb3ZlcnkgPSBbXVxuICBhc3luYyBkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIpIDo6XG4gICAgY29uc3QgZGlzcGF0Y2hfcm91dGUgPSBhd2FpdCB0aGlzLl9maXJzdFJvdXRlIEAgaWRfcm91dGVyLCB0aGlzLnJvdXRlRGlzY292ZXJ5XG4gICAgaWYgbnVsbCA9PSBkaXNwYXRjaF9yb3V0ZSA6OiByZXR1cm5cbiAgICB0aGlzLnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSlcbiAgICByZXR1cm4gZGlzcGF0Y2hfcm91dGVcblxuICBiaW5kRGlzcGF0Y2hSb3V0ZXMocm91dGVzKSA6OlxuICAgIGNvbnN0IHBxdWV1ZSA9IHByb21pc2VRdWV1ZSgpXG4gICAgZnVuY3Rpb24gZGlzcGF0Y2gocGt0TGlzdCwgY2hhbm5lbCkgOjpcbiAgICAgIGNvbnN0IHBxID0gcHF1ZXVlKCkgLy8gcHEgd2lsbCBkaXNwYXRjaCBkdXJpbmcgUHJvbWlzZSByZXNvbHV0aW9uc1xuICAgICAgcmV0dXJuIHBrdExpc3QubWFwIEAgcGt0ID0+XG4gICAgICAgIHBxLnRoZW4gQCAoKSA9PiBkaXNwYXRjaF9vbmUocGt0LCBjaGFubmVsKVxuXG4gICAgY29uc3QgZGlzcGF0Y2hfb25lID0gYXN5bmMgKHBrdCwgY2hhbm5lbCkgPT4gOjpcbiAgICAgIHRyeSA6OlxuICAgICAgICBjb25zdCBpZF9yb3V0ZXIgPSBwa3QuaWRfcm91dGVyXG4gICAgICAgIGxldCBkaXNwYXRjaF9yb3V0ZSA9IHJvdXRlcy5nZXQoaWRfcm91dGVyKVxuICAgICAgICBpZiB1bmRlZmluZWQgPT09IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgICAgZGlzcGF0Y2hfcm91dGUgPSBhd2FpdCB0aGlzLmRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlcilcbiAgICAgICAgICBpZiB1bmRlZmluZWQgPT09IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgICAgICByZXR1cm4gY2hhbm5lbCAmJiBjaGFubmVsLnVuZGVsaXZlcmFibGUocGt0LCAncm91dGUnKVxuXG4gICAgICAgIGlmIHN5bV91bnJlZ2lzdGVyID09PSBhd2FpdCBkaXNwYXRjaF9yb3V0ZShwa3QsIGNoYW5uZWwpIDo6XG4gICAgICAgICAgdGhpcy51bnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHRoaXMub25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBwa3QsIGNoYW5uZWwpXG5cbiAgICBjb25zdCByZXNvbHZlUm91dGUgPSBpZF9yb3V0ZXIgPT5cbiAgICAgIHJvdXRlcy5nZXQoaWRfcm91dGVyKSB8fFxuICAgICAgICB0aGlzLmRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlcilcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDpcbiAgICAgIHJvdXRlczogQDogdmFsdWU6IHJvdXRlc1xuICAgICAgZGlzcGF0Y2g6IEA6IHZhbHVlOiBkaXNwYXRjaFxuICAgICAgcmVzb2x2ZVJvdXRlOiBAOiB2YWx1ZTogcmVzb2x2ZVJvdXRlXG4gICAgcmV0dXJuIGRpc3BhdGNoXG5cbiAgcmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlKSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgaWYgbnVsbCAhPSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdkaXNwYXRjaF9yb3V0ZScgdG8gYmUgYSBmdW5jdGlvbmBcbiAgICAgIGVsc2UgcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5yb3V0ZXMuaGFzIEAgaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuICAgIGlmIDAgPT09IGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiB0aGlzLmlkX3NlbGYgPT09IGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcblxuICAgIHRoaXMucm91dGVzLnNldCBAIGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGVcbiAgICByZXR1cm4gdHJ1ZVxuICB1bnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyKSA6OlxuICAgIHJldHVybiB0aGlzLnJvdXRlcy5kZWxldGUgQCBpZF9yb3V0ZXJcbiAgcmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUm91dGUgQCBpZF9yb3V0ZXIsIHBrdCA9PiA6OlxuICAgICAgaWYgMCAhPT0gcGt0LnR0bCA6OiBjaGFubmVsLnNlbmRSYXcocGt0KVxuICB2ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKVxuICB1bnZlcmlmaWVkUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICBpZiB0aGlzLmFsbG93VW52ZXJpZmllZFJvdXRlcyB8fCBjaGFubmVsLmFsbG93VW52ZXJpZmllZFJvdXRlcyA6OlxuICAgICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKVxuICAgIGVsc2UgY29uc29sZS53YXJuIEAgJ1VudmVyaWZpZWQgcGVlciByb3V0ZSAoaWdub3JlZCk6JywgQDogaWRfcm91dGVyLCBjaGFubmVsXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggdG8gbG9jYWwgdGFyZ2V0XG5cbiAgdGFyZ2V0RGlzY292ZXJ5ID0gW11cbiAgZGlzY292ZXJUYXJnZXQocXVlcnkpIDo6XG4gICAgcmV0dXJuIHRoaXMuX2ZpcnN0VGFyZ2V0IEAgcXVlcnksIHRoaXMudGFyZ2V0RGlzY292ZXJ5XG5cbiAgYmluZERpc3BhdGNoU2VsZigpIDo6XG4gICAgY29uc3QgZGlzcGF0Y2hTZWxmID0gYXN5bmMgKHBrdCwgY2hhbm5lbCkgPT4gOjpcbiAgICAgIGNvbnN0IGlkX3RhcmdldCA9IHBrdC5pZF90YXJnZXRcbiAgICAgIGxldCB0YXJnZXQgPSB0aGlzLnRhcmdldHMuZ2V0KGlkX3RhcmdldClcbiAgICAgIGlmIHVuZGVmaW5lZCA9PT0gdGFyZ2V0IDo6XG4gICAgICAgIHJldHVybiBjaGFubmVsICYmIGNoYW5uZWwudW5kZWxpdmVyYWJsZShwa3QsICd0YXJnZXQnKVxuXG4gICAgICBpZiBzeW1fdW5yZWdpc3RlciA9PT0gYXdhaXQgdGFyZ2V0KHBrdCwgdGhpcykgOjpcbiAgICAgICAgdGhpcy51bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldClcblxuICAgIHRoaXMuZGlzcGF0Y2hTZWxmID0gZGlzcGF0Y2hTZWxmXG4gICAgcmV0dXJuIGRpc3BhdGNoU2VsZlxuXG4gIF9jcmVhdGVUYXJnZXRzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuICB0YXJnZXRzID0gdGhpcy5fY3JlYXRlVGFyZ2V0c01hcCgpXG4gIHJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCwgdGFyZ2V0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpZF90YXJnZXQgJiYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgIHRhcmdldCA9IGlkX3RhcmdldFxuICAgICAgaWRfdGFyZ2V0ID0gdGFyZ2V0LmlkX3RhcmdldCB8fCB0YXJnZXQuaWRcblxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiB0YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ3RhcmdldCcgdG8gYmUgYSBmdW5jdGlvbmBcbiAgICBpZiAhIE51bWJlci5pc1NhZmVJbnRlZ2VyIEAgaWRfdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdpZF90YXJnZXQnIHRvIGJlIGFuIGludGVnZXJgXG4gICAgaWYgdGhpcy50YXJnZXRzLmhhcyBAIGlkX3RhcmdldCA6OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5zZXQgQCBpZF90YXJnZXQsIHRhcmdldFxuICB1bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCkgOjpcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLmRlbGV0ZSBAIGlkX3RhcmdldFxuXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggY29udHJvbCBwYWNrZXRzXG5cbiAgYmluZERpc3BhdGNoQ29udHJvbCgpIDo6XG4gICAgcmV0dXJuIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICBpZiAwICE9PSBwa3QuaWRfdGFyZ2V0IDo6IC8vIGNvbm5lY3Rpb24tZGlzcGF0Y2hlZFxuICAgICAgICByZXR1cm4gdGhpcy5kaXNwYXRjaFNlbGYocGt0LCBjaGFubmVsKVxuXG4gICAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVtwa3QudHlwZV1cbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gaGFuZGxlciA6OlxuICAgICAgICByZXR1cm4gaGFuZGxlcih0aGlzLCBwa3QsIGNoYW5uZWwpXG4gICAgICBlbHNlIDo6XG4gICAgICAgIHJldHVybiB0aGlzLmRudV9kaXNwYXRjaF9jb250cm9sKHBrdCwgY2hhbm5lbClcblxuICBkaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5jcmVhdGUgQCB0aGlzLmRpc3BDb250cm9sQnlUeXBlXG4gIGRudV9kaXNwYXRjaF9jb250cm9sKHBrdCwgY2hhbm5lbCkgOjpcbiAgICBjb25zb2xlLndhcm4gQCAnZG51X2Rpc3BhdGNoX2NvbnRyb2wnLCBwa3QudHlwZSwgcGt0XG5cblxuT2JqZWN0LmFzc2lnbiBAIFJvdXRlci5wcm90b3R5cGUsIEB7fVxuICBkaXNwQ29udHJvbEJ5VHlwZTogT2JqZWN0LmFzc2lnbiBAIHt9XG4gICAgZGlzcENvbnRyb2xCeVR5cGVcblxuICB1bnJlZ2lzdGVyOiBzeW1fdW5yZWdpc3RlclxuICBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0XG4gIF9maXJzdFJvdXRlOiBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0KClcbiAgX2ZpcnN0VGFyZ2V0OiBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0KClcblxuZXhwb3J0IGRlZmF1bHQgUm91dGVyXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHByb21pc2VRdWV1ZSgpIDo6XG4gIGxldCB0aXAgPSBudWxsXG4gIHJldHVybiBmdW5jdGlvbiAoKSA6OlxuICAgIGlmIG51bGwgPT09IHRpcCA6OlxuICAgICAgdGlwID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIHRpcC50aGVuIEAgY2xlYXJfdGlwXG4gICAgcmV0dXJuIHRpcFxuXG4gIGZ1bmN0aW9uIGNsZWFyX3RpcCgpIDo6XG4gICAgdGlwID0gbnVsbFxuXG5mdW5jdGlvbiBpc19kZWZpbmVkKGUpIDo6IHJldHVybiB1bmRlZmluZWQgIT09IGVcbmV4cG9ydCBmdW5jdGlvbiBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0KG9wdGlvbnM9e30pIDo6XG4gIGNvbnN0IHRlc3QgPSBvcHRpb25zLnRlc3QgfHwgaXNfZGVmaW5lZFxuICBjb25zdCBvbl9lcnJvciA9IG9wdGlvbnMub25fZXJyb3IgfHwgY29uc29sZS5lcnJvclxuICBjb25zdCBpZkFic2VudCA9IG9wdGlvbnMuYWJzZW50IHx8IG51bGxcblxuICByZXR1cm4gKHRpcCwgbHN0Rm5zKSA9PlxuICAgIG5ldyBQcm9taXNlIEAgcmVzb2x2ZSA9PiA6OlxuICAgICAgY29uc3QgcmVzb2x2ZUlmID0gZSA9PiB0ZXN0KGUpID8gcmVzb2x2ZShlKSA6IGVcbiAgICAgIHRpcCA9IFByb21pc2UucmVzb2x2ZSh0aXApXG4gICAgICBQcm9taXNlLmFsbCBAXG4gICAgICAgIEFycmF5LmZyb20gQCBsc3RGbnMsIGZuID0+XG4gICAgICAgICAgdGlwLnRoZW4oZm4pLnRoZW4ocmVzb2x2ZUlmLCBvbl9lcnJvcilcbiAgICAgIC50aGVuIEAgYWJzZW50LCBhYnNlbnRcblxuICAgICAgZnVuY3Rpb24gYWJzZW50KCkgOjpcbiAgICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGlmQWJzZW50IDo6XG4gICAgICAgICAgcmVzb2x2ZSBAIGlmQWJzZW50KClcbiAgICAgICAgZWxzZSByZXNvbHZlIEAgaWZBYnNlbnRcbiIsImltcG9ydCB7c2VuZF9oZWxsbywgc2VuZF9waW5ncG9uZ30gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuXG5leHBvcnQgY2xhc3MgQ2hhbm5lbCA6OlxuICBzZW5kUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG4gIHBhY2tSYXcoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgSW5zdGFuY2UgcmVzcG9uc2libGl0eWBcblxuICBwYWNrQW5kU2VuZFJhdyguLi5hcmdzKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tSYXcgQCAuLi5hcmdzXG5cbiAgc2VuZEpTT04ocGt0X29iaikgOjpcbiAgICByZXR1cm4gdGhpcy5zZW5kUmF3IEAgdGhpcy5wYWNrSlNPTiBAIHBrdF9vYmpcbiAgcGFja0pTT04ocGt0X29iaikgOjpcbiAgICBpZiB1bmRlZmluZWQgIT09IHBrdF9vYmouaGVhZGVyIDo6XG4gICAgICBwa3Rfb2JqLmhlYWRlciA9IEpTT04uc3RyaW5naWZ5IEAgcGt0X29iai5oZWFkZXJcbiAgICBpZiB1bmRlZmluZWQgIT09IHBrdF9vYmouYm9keSA6OlxuICAgICAgcGt0X29iai5ib2R5ID0gSlNPTi5zdHJpbmdpZnkgQCBwa3Rfb2JqLmJvZHlcbiAgICByZXR1cm4gdGhpcy5wYWNrUmF3KHBrdF9vYmopXG5cblxuICAvLyAtLS0gQ29udHJvbCBtZXNzYWdlIHV0aWxpdGllc1xuXG4gIHNlbmRSb3V0aW5nSGFuZHNoYWtlKCkgOjpcbiAgICByZXR1cm4gc2VuZF9oZWxsbyh0aGlzLCB0aGlzLmh1Yi5yb3V0ZXIuZWNfcHViX2lkKVxuICBzZW5kUGluZygpIDo6XG4gICAgcmV0dXJuIHNlbmRfcGluZ3BvbmcodGhpcylcblxuXG4gIGNsb25lKHByb3BzLCAuLi5leHRyYSkgOjpcbiAgICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSh0aGlzLCBwcm9wcylcbiAgICByZXR1cm4gMCA9PT0gZXh0cmEubGVuZ3RoID8gc2VsZiA6IE9iamVjdC5hc3NpZ24oc2VsZiwgLi4uZXh0cmEpXG4gIGJpbmRDaGFubmVsKHNlbmRSYXcsIHByb3BzKSA6OiByZXR1cm4gYmluZENoYW5uZWwodGhpcywgc2VuZFJhdywgcHJvcHMpXG4gIGJpbmREaXNwYXRjaFBhY2tldHMoKSA6OiByZXR1cm4gYmluZERpc3BhdGNoUGFja2V0cyh0aGlzKVxuXG4gIHVuZGVsaXZlcmFibGUocGt0LCBtb2RlKSA6OlxuICAgIGNvbnN0IHJ0ciA9IHBrdC5pZF9yb3V0ZXIgIT09IHRoaXMuaHViLnJvdXRlci5pZF9zZWxmID8gcGt0LmlkX3JvdXRlciA6ICdzZWxmJ1xuICAgIGNvbnNvbGUud2FybiBAIGBVbmRlbGl2ZXJhYmxlWyR7bW9kZX1dOiAke3BrdC5pZF90YXJnZXR9IG9mICR7cnRyfWBcblxuICBzdGF0aWMgYXNBUEkoaHViLCBwYWNrUmF3KSA6OlxuICAgIGNvbnN0IHNlbGYgPSBuZXcgdGhpcygpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBzZWxmLCBAOlxuICAgICAgcGFja1JhdzogQDogdmFsdWU6IHBhY2tSYXdcbiAgICAgIGh1YjogQDogdmFsdWU6IGh1YlxuICAgICAgX3Jvb3RfOiBAOiB2YWx1ZTogc2VsZlxuICAgIHJldHVybiBzZWxmXG5cbiAgc3RhdGljIGFzQ2hhbm5lbEFQSShodWIsIHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gdGhpcy5hc0FQSSBAIGh1YiwgcGFja2V0UGFyc2VyLnBhY2tQYWNrZXRcblxuICBzdGF0aWMgYXNJbnRlcm5hbEFQSShodWIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1YiwgcGFja2V0UGFyc2VyLnBhY2tQYWNrZXRPYmpcbiAgICBzZWxmLmJpbmRJbnRlcm5hbENoYW5uZWwgPSBkaXNwYXRjaCA9PiBiaW5kSW50ZXJuYWxDaGFubmVsKHNlbGYsIGRpc3BhdGNoKVxuICAgIHJldHVybiBzZWxmXG5cblxuZXhwb3J0IGRlZmF1bHQgQ2hhbm5lbFxuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRDaGFubmVsKGNoYW5uZWwsIHNlbmRSYXcsIHByb3BzKSA6OlxuICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2Ygc2VuZFJhdyA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgQ2hhbm5lbCBleHBlY3RzICdzZW5kUmF3JyBmdW5jdGlvbiBwYXJhbWV0ZXJgXG5cbiAgY29uc3QgY29yZV9wcm9wcyA9IEA6IHNlbmRSYXc6IEB7fSB2YWx1ZTogc2VuZFJhd1xuICBwcm9wcyA9IG51bGwgPT0gcHJvcHMgPyBjb3JlX3Byb3BzIDogT2JqZWN0LmFzc2lnbiBAIGNvcmVfcHJvcHMsIHByb3BzXG5cbiAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUgQCBjaGFubmVsLCBwcm9wc1xuICByZXR1cm4gc2VuZFJhdy5jaGFubmVsID0gc2VsZlxuXG5leHBvcnQgZnVuY3Rpb24gYmluZEludGVybmFsQ2hhbm5lbChjaGFubmVsLCBkaXNwYXRjaCkgOjpcbiAgZGlzcGF0Y2hfcGt0X29iai5jaGFubmVsID0gY2hhbm5lbFxuICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBjaGFubmVsLCBAe31cbiAgICBzZW5kUmF3OiBAe30gdmFsdWU6IGRpc3BhdGNoX3BrdF9vYmpcbiAgICBiaW5kQ2hhbm5lbDogQHt9IHZhbHVlOiBudWxsXG5cbiAgZnVuY3Rpb24gZGlzcGF0Y2hfcGt0X29iaihwa3QpIDo6XG4gICAgaWYgdW5kZWZpbmVkID09PSBwa3QuX3Jhd18gOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgYSBwYXJzZWQgcGt0X29iaiB3aXRoIHZhbGlkICdfcmF3XycgYnVmZmVyIHByb3BlcnR5YFxuICAgIGRpc3BhdGNoIEAgW3BrdF0sIGNoYW5uZWxcbiAgICByZXR1cm4gdHJ1ZVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZERpc3BhdGNoUGFja2V0cyhjaGFubmVsKSA6OlxuICBjb25zdCBkaXNwYXRjaCA9IGNoYW5uZWwuaHViLnJvdXRlci5kaXNwYXRjaFxuICBjb25zdCBmZWVkID0gY2hhbm5lbC5odWIucGFja2V0UGFyc2VyLnBhY2tldFN0cmVhbSgpXG5cbiAgcmV0dXJuIGZ1bmN0aW9uIG9uX3JlY3ZfZGF0YShkYXRhKSA6OlxuICAgIGNvbnN0IHBrdExpc3QgPSBmZWVkKGRhdGEpXG4gICAgaWYgMCA8IHBrdExpc3QubGVuZ3RoIDo6XG4gICAgICBkaXNwYXRjaCBAIHBrdExpc3QsIGNoYW5uZWxcbiIsImltcG9ydCB7Um91dGVyfSBmcm9tICcuL3JvdXRlci5qc3knXG5pbXBvcnQge0NoYW5uZWx9IGZyb20gJy4vY2hhbm5lbC5qc3knXG5cbmV4cG9ydCBjbGFzcyBGYWJyaWNIdWIgOjpcbiAgY29uc3RydWN0b3IoKSA6OlxuICAgIGFwcGx5UGx1Z2lucyBAICdwcmUnLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcblxuICAgIGNvbnN0IHBhY2tldFBhcnNlciA9IHRoaXMucGFja2V0UGFyc2VyXG4gICAgaWYgbnVsbD09cGFja2V0UGFyc2VyIHx8ICEgcGFja2V0UGFyc2VyLmlzUGFja2V0UGFyc2VyKCkgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgSW52YWxpZCBodWIucGFja2V0UGFyc2VyYFxuXG4gICAgY29uc3Qgcm91dGVyID0gdGhpcy5faW5pdF9yb3V0ZXIoKVxuICAgIGNvbnN0IF9hcGlfY2hhbm5lbCA9IHRoaXMuX2luaXRfY2hhbm5lbEFQSShwYWNrZXRQYXJzZXIpXG4gICAgY29uc3QgX2FwaV9pbnRlcm5hbCA9IHRoaXMuX2luaXRfaW50ZXJuYWxBUEkocGFja2V0UGFyc2VyKVxuICAgIHJvdXRlci5pbml0RGlzcGF0Y2goKVxuICAgIF9hcGlfaW50ZXJuYWwuYmluZEludGVybmFsQ2hhbm5lbCBAIHJvdXRlci5kaXNwYXRjaFxuXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAe31cbiAgICAgIHJvdXRlcjogQHt9IHZhbHVlOiByb3V0ZXJcbiAgICAgIHBhY2tldFBhcnNlcjogQHt9IHZhbHVlOiBwYWNrZXRQYXJzZXJcbiAgICAgIF9hcGlfY2hhbm5lbDogQHt9IHZhbHVlOiBfYXBpX2NoYW5uZWxcbiAgICAgIF9hcGlfaW50ZXJuYWw6IEB7fSB2YWx1ZTogX2FwaV9pbnRlcm5hbFxuXG4gICAgYXBwbHlQbHVnaW5zIEAgbnVsbCwgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3Bvc3QnLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICByZXR1cm4gdGhpc1xuXG4gIF9pbml0X3JvdXRlcigpIDo6IHRocm93IG5ldyBFcnJvciBAIGBQbHVnaW4gcmVzcG9uc2libGl0eWBcblxuICBfaW5pdF9jaGFubmVsQVBJKHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gQ2hhbm5lbC5hc0NoYW5uZWxBUEkgQCB0aGlzLCBwYWNrZXRQYXJzZXJcbiAgX2luaXRfaW50ZXJuYWxBUEkocGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiBDaGFubmVsLmFzSW50ZXJuYWxBUEkgQCB0aGlzLCBwYWNrZXRQYXJzZXJcblxuXG4gIHN0YXRpYyBwbHVnaW4oLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIHJldHVybiB0aGlzLnBsdWdpbnMoLi4ucGx1Z2luRnVuY3Rpb25zKVxuICBzdGF0aWMgcGx1Z2lucyguLi5wbHVnaW5GdW5jdGlvbnMpIDo6XG4gICAgY29uc3QgcGx1Z2luTGlzdCA9IFtdLmNvbmNhdCBAXG4gICAgICB0aGlzLnByb3RvdHlwZS5wbHVnaW5MaXN0IHx8IFtdXG4gICAgICBwbHVnaW5GdW5jdGlvbnNcblxuICAgIHBsdWdpbkxpc3Quc29ydCBAIChhLCBiKSA9PiAoMCB8IGEub3JkZXIpIC0gKDAgfCBiLm9yZGVyKVxuXG4gICAgY29uc3QgQmFzZUh1YiA9IHRoaXMuX0Jhc2VIdWJfIHx8IHRoaXNcbiAgICBjbGFzcyBGYWJyaWNIdWJfUEkgZXh0ZW5kcyBCYXNlSHViIDo6XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBGYWJyaWNIdWJfUEkucHJvdG90eXBlLCBAOlxuICAgICAgcGx1Z2luTGlzdDogQHt9IHZhbHVlOiBPYmplY3QuZnJlZXplIEAgcGx1Z2luTGlzdFxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgRmFicmljSHViX1BJLCBAOlxuICAgICAgX0Jhc2VIdWJfOiBAe30gdmFsdWU6IEJhc2VIdWJcblxuICAgIGFwcGx5UGx1Z2lucyBAICdzdWJjbGFzcycsIHBsdWdpbkxpc3QsIEZhYnJpY0h1Yl9QSSwgQDogUm91dGVyLCBDaGFubmVsXG4gICAgcmV0dXJuIEZhYnJpY0h1Yl9QSVxuXG5cbiAgZ2V0IGlkX3NlbGYoKSA6OiByZXR1cm4gdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBpZF9yb3V0ZXJfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMucGFja2V0UGFyc2VyLnBhY2tJZCBAXG4gICAgICB0aGlzLnJvdXRlci5pZF9zZWxmXG5cbiAgY29ubmVjdF9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5fYXBpX2ludGVybmFsLmNsb25lKClcblxuXG4gIGNvbm5lY3QoY29ubl91cmwpIDo6XG4gICAgaWYgbnVsbCA9PSBjb25uX3VybCA6OlxuICAgICAgcmV0dXJuIHRoaXMuY29ubmVjdF9zZWxmKClcblxuICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgY29ubl91cmwgOjpcbiAgICAgIGNvbm5fdXJsID0gdGhpcy5fcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKVxuXG4gICAgY29uc3QgY29ubmVjdCA9IHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sW2Nvbm5fdXJsLnByb3RvY29sXVxuICAgIGlmICEgY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYENvbm5lY3Rpb24gcHJvdG9jb2wgXCIke2Nvbm5fdXJsLnByb3RvY29sfVwiIG5vdCByZWdpc3RlcmVkIGZvciBcIiR7Y29ubl91cmwudG9TdHJpbmcoKX1cImBcblxuICAgIHJldHVybiBjb25uZWN0KGNvbm5fdXJsKVxuXG4gIHJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sKHByb3RvY29sLCBjYl9jb25uZWN0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYl9jb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdjYl9jb25uZWN0JyBmdW5jdGlvbmBcbiAgICBjb25zdCBieVByb3RvY29sID0gT2JqZWN0LmFzc2lnbiBAIHt9LCB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFxuICAgIGJ5UHJvdG9jb2xbcHJvdG9jb2xdID0gY2JfY29ubmVjdFxuICAgIHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydHkgQCB0aGlzLCAnX2Nvbm5lY3RCeVByb3RvY29sJyxcbiAgICAgIEA6IHZhbHVlOiBieVByb3RvY29sLCBjb25maWd1cmFibGU6IHRydWVcblxuICBfcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKSA6OlxuICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG5leHBvcnQgZGVmYXVsdCBGYWJyaWNIdWJcblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGx1Z2lucyhrZXksIHBsdWdpbkxpc3QsIC4uLmFyZ3MpIDo6XG4gIGlmICEga2V5IDo6IGtleSA9IG51bGxcbiAgZm9yIGxldCBwbHVnaW4gb2YgcGx1Z2luTGlzdCA6OlxuICAgIGlmIG51bGwgIT09IGtleSA6OiBwbHVnaW4gPSBwbHVnaW5ba2V5XVxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBwbHVnaW4gOjpcbiAgICAgIHBsdWdpbiguLi5hcmdzKVxuIl0sIm5hbWVzIjpbImRpc3BDb250cm9sQnlUeXBlIiwicmVjdl9oZWxsbyIsInJlY3Zfb2xsZWgiLCJyZWN2X3BvbmciLCJyZWN2X3BpbmciLCJzZW5kX2hlbGxvIiwiY2hhbm5lbCIsImVjX3B1Yl9pZCIsImh1YiIsInJvdXRlciIsInBhY2tBbmRTZW5kUmF3IiwidHlwZSIsImlkX3JvdXRlcl9zZWxmIiwicGt0IiwiZWNfb3RoZXJfaWQiLCJoZWFkZXJfYnVmZmVyIiwibGVuZ3RoIiwiZWNfaWRfaG1hYyIsImhtYWNfc2VjcmV0IiwiaWRfcm91dGVyIiwidW5wYWNrSWQiLCJib2R5X2J1ZmZlciIsInVudmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX29sbGVoIiwicGVlcl9obWFjX2NsYWltIiwiY29tcGFyZSIsInZlcmlmaWVkUGVlclJvdXRlIiwic2VuZF9waW5ncG9uZyIsInBvbmciLCJEYXRlIiwidG9JU09TdHJpbmciLCJsb2NhbCIsInJlbW90ZSIsInRvU3RyaW5nIiwiZGVsdGEiLCJ0c19wb25nIiwiZXJyIiwidHNfcGluZyIsInN5bV91bnJlZ2lzdGVyIiwiU3ltYm9sIiwiUm91dGVyIiwiaWRfc2VsZiIsInJvdXRlRGlzY292ZXJ5IiwidGFyZ2V0RGlzY292ZXJ5IiwidGFyZ2V0cyIsIl9jcmVhdGVUYXJnZXRzTWFwIiwiT2JqZWN0IiwiY3JlYXRlIiwiZGVmaW5lUHJvcGVydGllcyIsInZhbHVlIiwicm91dGVzIiwiX2NyZWF0ZVJvdXRlc01hcCIsInNldCIsImJpbmREaXNwYXRjaENvbnRyb2wiLCJiaW5kRGlzcGF0Y2hTZWxmIiwiYmluZERpc3BhdGNoUm91dGVzIiwiZXJyb3IiLCJNYXAiLCJkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZSIsImRpc3BhdGNoX3JvdXRlIiwiX2ZpcnN0Um91dGUiLCJyZWdpc3RlclJvdXRlIiwicHF1ZXVlIiwicHJvbWlzZVF1ZXVlIiwiZGlzcGF0Y2giLCJwa3RMaXN0IiwicHEiLCJtYXAiLCJ0aGVuIiwiZGlzcGF0Y2hfb25lIiwiZ2V0IiwidW5kZWZpbmVkIiwidW5kZWxpdmVyYWJsZSIsInVucmVnaXN0ZXJSb3V0ZSIsIm9uX2Vycm9yX2luX2Rpc3BhdGNoIiwicmVzb2x2ZVJvdXRlIiwiVHlwZUVycm9yIiwiaGFzIiwiZGVsZXRlIiwidHRsIiwic2VuZFJhdyIsInJlZ2lzdGVyUGVlclJvdXRlIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwiY29uc29sZSIsIndhcm4iLCJxdWVyeSIsIl9maXJzdFRhcmdldCIsImRpc3BhdGNoU2VsZiIsImlkX3RhcmdldCIsInRhcmdldCIsInVucmVnaXN0ZXJUYXJnZXQiLCJpZCIsIk51bWJlciIsImlzU2FmZUludGVnZXIiLCJoYW5kbGVyIiwiZG51X2Rpc3BhdGNoX2NvbnRyb2wiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJiaW5kUHJvbWlzZUZpcnN0UmVzdWx0IiwidGlwIiwiUHJvbWlzZSIsInJlc29sdmUiLCJjbGVhcl90aXAiLCJpc19kZWZpbmVkIiwiZSIsIm9wdGlvbnMiLCJ0ZXN0Iiwib25fZXJyb3IiLCJpZkFic2VudCIsImFic2VudCIsImxzdEZucyIsInJlc29sdmVJZiIsImFsbCIsIkFycmF5IiwiZnJvbSIsImZuIiwiQ2hhbm5lbCIsIkVycm9yIiwiYXJncyIsInBhY2tSYXciLCJwa3Rfb2JqIiwicGFja0pTT04iLCJoZWFkZXIiLCJKU09OIiwic3RyaW5naWZ5IiwiYm9keSIsInByb3BzIiwiZXh0cmEiLCJzZWxmIiwiYmluZENoYW5uZWwiLCJiaW5kRGlzcGF0Y2hQYWNrZXRzIiwibW9kZSIsInJ0ciIsImFzQVBJIiwiYXNDaGFubmVsQVBJIiwicGFja2V0UGFyc2VyIiwicGFja1BhY2tldCIsImFzSW50ZXJuYWxBUEkiLCJwYWNrUGFja2V0T2JqIiwiYmluZEludGVybmFsQ2hhbm5lbCIsImNvcmVfcHJvcHMiLCJkaXNwYXRjaF9wa3Rfb2JqIiwiX3Jhd18iLCJmZWVkIiwicGFja2V0U3RyZWFtIiwib25fcmVjdl9kYXRhIiwiZGF0YSIsIkZhYnJpY0h1YiIsInBsdWdpbkxpc3QiLCJpc1BhY2tldFBhcnNlciIsIl9pbml0X3JvdXRlciIsIl9hcGlfY2hhbm5lbCIsIl9pbml0X2NoYW5uZWxBUEkiLCJfYXBpX2ludGVybmFsIiwiX2luaXRfaW50ZXJuYWxBUEkiLCJpbml0RGlzcGF0Y2giLCJwbHVnaW4iLCJwbHVnaW5GdW5jdGlvbnMiLCJwbHVnaW5zIiwiY29uY2F0Iiwic29ydCIsImEiLCJiIiwib3JkZXIiLCJCYXNlSHViIiwiX0Jhc2VIdWJfIiwiRmFicmljSHViX1BJIiwiZnJlZXplIiwicGFja0lkIiwiY2xvbmUiLCJjb25uX3VybCIsImNvbm5lY3Rfc2VsZiIsIl9wYXJzZUNvbm5lY3RVUkwiLCJjb25uZWN0IiwiX2Nvbm5lY3RCeVByb3RvY29sIiwicHJvdG9jb2wiLCJjYl9jb25uZWN0IiwiYnlQcm90b2NvbCIsImRlZmluZVByb3BlcnR5IiwiY29uZmlndXJhYmxlIiwiVVJMIiwiYXBwbHlQbHVnaW5zIiwia2V5Il0sIm1hcHBpbmdzIjoiOzs7O0FBQU8sTUFBTUEsb0JBQW9CO0dBQzlCLElBQUQsR0FBUUMsVUFEdUI7R0FFOUIsSUFBRCxHQUFRQyxVQUZ1QjtHQUc5QixJQUFELEdBQVFDLFNBSHVCO0dBSTlCLElBQUQsR0FBUUMsU0FKdUIsRUFBMUI7O0FBUVAsQUFBTyxTQUFTQyxVQUFULENBQW9CQyxPQUFwQixFQUE2QjtRQUM1QixFQUFDQyxTQUFELEtBQWNELFFBQVFFLEdBQVIsQ0FBWUMsTUFBaEM7U0FDT0gsUUFBUUksY0FBUixD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
