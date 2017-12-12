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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvY29udHJvbF9wcm90b2NvbC5qc3kiLCIuLi9jb2RlL3JvdXRlci5qc3kiLCIuLi9jb2RlL2NoYW5uZWwuanN5IiwiLi4vY29kZS9odWIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBkaXNwQ29udHJvbEJ5VHlwZSA9IEB7fVxuICBbMHhmMF06IHJlY3ZfaGVsbG9cbiAgWzB4ZjFdOiByZWN2X29sbGVoXG4gIFsweGZlXTogcmVjdl9wb25nXG4gIFsweGZmXTogcmVjdl9waW5nXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9oZWxsbyhjaGFubmVsKSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwuaHViLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgaWYgMCAhPT0gZWNfb3RoZXJfaWQubGVuZ3RoICYmIHJvdXRlci5lY19pZF9obWFjIDo6XG4gICAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCkgOiBudWxsXG4gICAgc2VuZF9vbGxlaCBAIGNoYW5uZWwsIGhtYWNfc2VjcmV0XG5cbiAgZWxzZSA6OlxuICAgIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChwa3QuYm9keV9idWZmZXIoKSwgMClcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbmZ1bmN0aW9uIHNlbmRfb2xsZWgoY2hhbm5lbCwgaG1hY19zZWNyZXQpIDo6XG4gIGNvbnN0IHtlY19wdWJfaWR9ID0gY2hhbm5lbC5odWIucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYxXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBobWFjX3NlY3JldFxuXG5mdW5jdGlvbiByZWN2X29sbGVoKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IHBrdC5oZWFkZXJfYnVmZmVyKClcbiAgY29uc3QgaWRfcm91dGVyID0gcGt0LnVucGFja0lkKGVjX290aGVyX2lkKVxuXG4gIGNvbnN0IGhtYWNfc2VjcmV0ID0gcm91dGVyLmVjX2lkX2htYWNcbiAgICA/IHJvdXRlci5lY19pZF9obWFjKGVjX290aGVyX2lkLCB0cnVlKSA6IG51bGxcbiAgY29uc3QgcGVlcl9obWFjX2NsYWltID0gcGt0LmJvZHlfYnVmZmVyKClcbiAgaWYgaG1hY19zZWNyZXQgJiYgMCA9PT0gaG1hY19zZWNyZXQuY29tcGFyZSBAIHBlZXJfaG1hY19jbGFpbSA6OlxuICAgIHJvdXRlci52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuICBlbHNlIDo6XG4gICAgcm91dGVyLnVudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBzZW5kX3Bpbmdwb25nKGNoYW5uZWwsIHBvbmcpIDo6XG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiBwb25nID8gMHhmZSA6IDB4ZmZcbiAgICBib2R5OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuZnVuY3Rpb24gcmVjdl9wb25nKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIHBrdC5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBsb2NhbFxuXG5mdW5jdGlvbiByZWN2X3Bpbmcocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGxvY2FsID0gbmV3IERhdGUoKVxuXG4gIHNlbmRfcGluZ3BvbmcgQCBjaGFubmVsLCB0cnVlXG5cbiAgdHJ5IDo6XG4gICAgY29uc3QgcmVtb3RlID0gbmV3IERhdGUgQCBwa3QuYm9keV9idWZmZXIoKS50b1N0cmluZygpXG4gICAgY29uc3QgZGVsdGEgPSByZW1vdGUgLSBsb2NhbFxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBkZWx0YSwgcmVtb3RlLCBsb2NhbFxuICBjYXRjaCBlcnIgOjpcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gbG9jYWxcblxuIiwiaW1wb3J0IHtkaXNwQ29udHJvbEJ5VHlwZX0gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuY29uc3Qgc3ltX3VucmVnaXN0ZXIgPSBTeW1ib2woJ21zZy1mYWJpcmMgdW5yZWdpc3RlcicpXG5leHBvcnQgY2xhc3MgUm91dGVyIDo6XG4gIGNvbnN0cnVjdG9yKGlkX3NlbGYpIDo6XG4gICAgaWYgaWRfc2VsZiA6OlxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOiBpZF9zZWxmOiBAOiB2YWx1ZTogaWRfc2VsZlxuXG4gIC8vIC0tLSBEaXNwYXRjaCBjb3JlIC0tLVxuXG4gIGluaXREaXNwYXRjaCgpIDo6XG4gICAgY29uc3Qgcm91dGVzID0gdGhpcy5fY3JlYXRlUm91dGVzTWFwKClcbiAgICByb3V0ZXMuc2V0IEAgMCwgdGhpcy5iaW5kRGlzcGF0Y2hDb250cm9sKClcbiAgICBpZiBudWxsICE9IHRoaXMuaWRfc2VsZiA6OlxuICAgICAgcm91dGVzLnNldCBAIHRoaXMuaWRfc2VsZiwgdGhpcy5iaW5kRGlzcGF0Y2hTZWxmKClcblxuICAgIHRoaXMuYmluZERpc3BhdGNoUm91dGVzKHJvdXRlcylcblxuICBvbl9lcnJvcl9pbl9kaXNwYXRjaChlcnIsIHBrdCkgOjpcbiAgICBjb25zb2xlLmVycm9yIEAgJ0Vycm9yIGR1cmluZyBwYWNrZXQgZGlzcGF0Y2hcXG4gIHBrdDonLCBwa3QsICdcXG4nLCBlcnIsICdcXG4nXG5cbiAgX2NyZWF0ZVJvdXRlc01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcblxuICAvLyAtLS0gRGlzcGF0Y2ggdG8gcm91dGUgLS0tXG5cbiAgcm91dGVEaXNjb3ZlcnkgPSBbXVxuICBhc3luYyBkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIpIDo6XG4gICAgY29uc3QgZGlzcGF0Y2hfcm91dGUgPSBhd2FpdCB0aGlzLl9maXJzdFJvdXRlIEAgaWRfcm91dGVyLCB0aGlzLnJvdXRlRGlzY292ZXJ5XG4gICAgaWYgbnVsbCA9PSBkaXNwYXRjaF9yb3V0ZSA6OiByZXR1cm5cbiAgICB0aGlzLnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSlcbiAgICByZXR1cm4gZGlzcGF0Y2hfcm91dGVcblxuICBiaW5kRGlzcGF0Y2hSb3V0ZXMocm91dGVzKSA6OlxuICAgIGNvbnN0IHBxdWV1ZSA9IHByb21pc2VRdWV1ZSgpXG4gICAgZnVuY3Rpb24gZGlzcGF0Y2gocGt0TGlzdCwgY2hhbm5lbCkgOjpcbiAgICAgIGNvbnN0IHBxID0gcHF1ZXVlKCkgLy8gcHEgd2lsbCBkaXNwYXRjaCBkdXJpbmcgUHJvbWlzZSByZXNvbHV0aW9uc1xuICAgICAgcmV0dXJuIHBrdExpc3QubWFwIEAgcGt0ID0+XG4gICAgICAgIHBxLnRoZW4gQCAoKSA9PiBkaXNwYXRjaF9vbmUocGt0LCBjaGFubmVsKVxuXG4gICAgY29uc3QgZGlzcGF0Y2hfb25lID0gYXN5bmMgKHBrdCwgY2hhbm5lbCkgPT4gOjpcbiAgICAgIHRyeSA6OlxuICAgICAgICBjb25zdCBpZF9yb3V0ZXIgPSBwa3QuaWRfcm91dGVyXG4gICAgICAgIGxldCBkaXNwYXRjaF9yb3V0ZSA9IHJvdXRlcy5nZXQoaWRfcm91dGVyKVxuICAgICAgICBpZiB1bmRlZmluZWQgPT09IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgICAgZGlzcGF0Y2hfcm91dGUgPSBhd2FpdCB0aGlzLmRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlcilcbiAgICAgICAgICBpZiB1bmRlZmluZWQgPT09IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgICAgICByZXR1cm4gY2hhbm5lbCAmJiBjaGFubmVsLnVuZGVsaXZlcmFibGUocGt0LCAncm91dGUnKVxuXG4gICAgICAgIGlmIHN5bV91bnJlZ2lzdGVyID09PSBhd2FpdCBkaXNwYXRjaF9yb3V0ZShwa3QsIGNoYW5uZWwpIDo6XG4gICAgICAgICAgdGhpcy51bnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHRoaXMub25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBwa3QsIGNoYW5uZWwpXG5cbiAgICBjb25zdCByZXNvbHZlUm91dGUgPSBpZF9yb3V0ZXIgPT5cbiAgICAgIHJvdXRlcy5nZXQoaWRfcm91dGVyKSB8fFxuICAgICAgICB0aGlzLmRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlcilcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDpcbiAgICAgIHJvdXRlczogQDogdmFsdWU6IHJvdXRlc1xuICAgICAgZGlzcGF0Y2g6IEA6IHZhbHVlOiBkaXNwYXRjaFxuICAgICAgcmVzb2x2ZVJvdXRlOiBAOiB2YWx1ZTogcmVzb2x2ZVJvdXRlXG4gICAgcmV0dXJuIGRpc3BhdGNoXG5cbiAgcmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlKSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgaWYgbnVsbCAhPSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdkaXNwYXRjaF9yb3V0ZScgdG8gYmUgYSBmdW5jdGlvbmBcbiAgICAgIGVsc2UgcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5yb3V0ZXMuaGFzIEAgaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuICAgIGlmIDAgPT09IGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiB0aGlzLmlkX3NlbGYgPT09IGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcblxuICAgIHRoaXMucm91dGVzLnNldCBAIGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGVcbiAgICByZXR1cm4gdHJ1ZVxuICB1bnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyKSA6OlxuICAgIHJldHVybiB0aGlzLnJvdXRlcy5kZWxldGUgQCBpZF9yb3V0ZXJcbiAgcmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUm91dGUgQCBpZF9yb3V0ZXIsIHBrdCA9PiA6OlxuICAgICAgaWYgMCAhPT0gcGt0LnR0bCA6OiBjaGFubmVsLnNlbmRSYXcocGt0KVxuICB2ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKVxuICB1bnZlcmlmaWVkUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICBpZiB0aGlzLmFsbG93VW52ZXJpZmllZFJvdXRlcyB8fCBjaGFubmVsLmFsbG93VW52ZXJpZmllZFJvdXRlcyA6OlxuICAgICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKVxuICAgIGVsc2UgY29uc29sZS53YXJuIEAgJ1VudmVyaWZpZWQgcGVlciByb3V0ZSAoaWdub3JlZCk6JywgQDogaWRfcm91dGVyLCBjaGFubmVsXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggdG8gbG9jYWwgdGFyZ2V0XG5cbiAgdGFyZ2V0RGlzY292ZXJ5ID0gW11cbiAgZGlzY292ZXJUYXJnZXQocXVlcnkpIDo6XG4gICAgcmV0dXJuIHRoaXMuX2ZpcnN0VGFyZ2V0IEAgcXVlcnksIHRoaXMudGFyZ2V0RGlzY292ZXJ5XG5cbiAgYmluZERpc3BhdGNoU2VsZigpIDo6XG4gICAgY29uc3QgZGlzcGF0Y2hTZWxmID0gYXN5bmMgKHBrdCwgY2hhbm5lbCkgPT4gOjpcbiAgICAgIGNvbnN0IGlkX3RhcmdldCA9IHBrdC5pZF90YXJnZXRcbiAgICAgIGxldCB0YXJnZXQgPSB0aGlzLnRhcmdldHMuZ2V0KGlkX3RhcmdldClcbiAgICAgIGlmIHVuZGVmaW5lZCA9PT0gdGFyZ2V0IDo6XG4gICAgICAgIHJldHVybiBjaGFubmVsICYmIGNoYW5uZWwudW5kZWxpdmVyYWJsZShwa3QsICd0YXJnZXQnKVxuXG4gICAgICBpZiBzeW1fdW5yZWdpc3RlciA9PT0gYXdhaXQgdGFyZ2V0KHBrdCwgdGhpcykgOjpcbiAgICAgICAgdGhpcy51bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldClcblxuICAgIHRoaXMuZGlzcGF0Y2hTZWxmID0gZGlzcGF0Y2hTZWxmXG4gICAgcmV0dXJuIGRpc3BhdGNoU2VsZlxuXG4gIF9jcmVhdGVUYXJnZXRzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuICB0YXJnZXRzID0gdGhpcy5fY3JlYXRlVGFyZ2V0c01hcCgpXG4gIHJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCwgdGFyZ2V0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpZF90YXJnZXQgJiYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgIHRhcmdldCA9IGlkX3RhcmdldFxuICAgICAgaWRfdGFyZ2V0ID0gdGFyZ2V0LmlkX3RhcmdldCB8fCB0YXJnZXQuaWRcblxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiB0YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ3RhcmdldCcgdG8gYmUgYSBmdW5jdGlvbmBcbiAgICBpZiAhIE51bWJlci5pc1NhZmVJbnRlZ2VyIEAgaWRfdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdpZF90YXJnZXQnIHRvIGJlIGFuIGludGVnZXJgXG4gICAgaWYgdGhpcy50YXJnZXRzLmhhcyBAIGlkX3RhcmdldCA6OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5zZXQgQCBpZF90YXJnZXQsIHRhcmdldFxuICB1bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCkgOjpcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLmRlbGV0ZSBAIGlkX3RhcmdldFxuXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggY29udHJvbCBwYWNrZXRzXG5cbiAgYmluZERpc3BhdGNoQ29udHJvbCgpIDo6XG4gICAgcmV0dXJuIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICBpZiAwICE9PSBwa3QuaWRfdGFyZ2V0IDo6IC8vIGNvbm5lY3Rpb24tZGlzcGF0Y2hlZFxuICAgICAgICByZXR1cm4gdGhpcy5kaXNwYXRjaFNlbGYocGt0LCBjaGFubmVsKVxuXG4gICAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVtwa3QudHlwZV1cbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gaGFuZGxlciA6OlxuICAgICAgICByZXR1cm4gaGFuZGxlcih0aGlzLCBwa3QsIGNoYW5uZWwpXG4gICAgICBlbHNlIDo6XG4gICAgICAgIHJldHVybiB0aGlzLmRudV9kaXNwYXRjaF9jb250cm9sKHBrdCwgY2hhbm5lbClcblxuICBkaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5jcmVhdGUgQCB0aGlzLmRpc3BDb250cm9sQnlUeXBlXG4gIGRudV9kaXNwYXRjaF9jb250cm9sKHBrdCwgY2hhbm5lbCkgOjpcbiAgICBjb25zb2xlLndhcm4gQCAnZG51X2Rpc3BhdGNoX2NvbnRyb2wnLCBwa3QudHlwZSwgcGt0XG5cblxuT2JqZWN0LmFzc2lnbiBAIFJvdXRlci5wcm90b3R5cGUsIEB7fVxuICBkaXNwQ29udHJvbEJ5VHlwZTogT2JqZWN0LmFzc2lnbiBAIHt9XG4gICAgZGlzcENvbnRyb2xCeVR5cGVcblxuICB1bnJlZ2lzdGVyOiBzeW1fdW5yZWdpc3RlclxuICBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0XG4gIF9maXJzdFJvdXRlOiBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0KClcbiAgX2ZpcnN0VGFyZ2V0OiBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0KClcblxuZXhwb3J0IGRlZmF1bHQgUm91dGVyXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHByb21pc2VRdWV1ZSgpIDo6XG4gIGxldCB0aXAgPSBudWxsXG4gIHJldHVybiBmdW5jdGlvbiAoKSA6OlxuICAgIGlmIG51bGwgPT09IHRpcCA6OlxuICAgICAgdGlwID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIHRpcC50aGVuIEAgY2xlYXJfdGlwXG4gICAgcmV0dXJuIHRpcFxuXG4gIGZ1bmN0aW9uIGNsZWFyX3RpcCgpIDo6XG4gICAgdGlwID0gbnVsbFxuXG5mdW5jdGlvbiBpc19kZWZpbmVkKGUpIDo6IHJldHVybiB1bmRlZmluZWQgIT09IGVcbmV4cG9ydCBmdW5jdGlvbiBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0KG9wdGlvbnM9e30pIDo6XG4gIGNvbnN0IHRlc3QgPSBvcHRpb25zLnRlc3QgfHwgaXNfZGVmaW5lZFxuICBjb25zdCBvbl9lcnJvciA9IG9wdGlvbnMub25fZXJyb3IgfHwgY29uc29sZS5lcnJvclxuICBjb25zdCBpZkFic2VudCA9IG9wdGlvbnMuYWJzZW50IHx8IG51bGxcblxuICByZXR1cm4gKHRpcCwgbHN0Rm5zKSA9PlxuICAgIG5ldyBQcm9taXNlIEAgcmVzb2x2ZSA9PiA6OlxuICAgICAgY29uc3QgcmVzb2x2ZUlmID0gZSA9PiB0ZXN0KGUpID8gcmVzb2x2ZShlKSA6IGVcbiAgICAgIHRpcCA9IFByb21pc2UucmVzb2x2ZSh0aXApXG4gICAgICBQcm9taXNlLmFsbCBAXG4gICAgICAgIEFycmF5LmZyb20gQCBsc3RGbnMsIGZuID0+XG4gICAgICAgICAgdGlwLnRoZW4oZm4pLnRoZW4ocmVzb2x2ZUlmLCBvbl9lcnJvcilcbiAgICAgIC50aGVuIEAgYWJzZW50LCBhYnNlbnRcblxuICAgICAgZnVuY3Rpb24gYWJzZW50KCkgOjpcbiAgICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGlmQWJzZW50IDo6XG4gICAgICAgICAgcmVzb2x2ZSBAIGlmQWJzZW50KClcbiAgICAgICAgZWxzZSByZXNvbHZlIEAgaWZBYnNlbnRcbiIsImltcG9ydCB7c2VuZF9oZWxsbywgc2VuZF9waW5ncG9uZ30gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuXG5leHBvcnQgY2xhc3MgQ2hhbm5lbCA6OlxuICBzZW5kUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG4gIHBhY2tSYXcoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgSW5zdGFuY2UgcmVzcG9uc2libGl0eWBcblxuICBwYWNrQW5kU2VuZFJhdyguLi5hcmdzKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tSYXcgQCAuLi5hcmdzXG5cbiAgc2VuZEpTT04ocGt0X29iaikgOjpcbiAgICByZXR1cm4gdGhpcy5zZW5kUmF3IEAgdGhpcy5wYWNrSlNPTiBAIHBrdF9vYmpcbiAgcGFja0pTT04ocGt0X29iaikgOjpcbiAgICBpZiB1bmRlZmluZWQgIT09IHBrdF9vYmouaGVhZGVyIDo6XG4gICAgICBwa3Rfb2JqLmhlYWRlciA9IEpTT04uc3RyaW5naWZ5IEAgcGt0X29iai5oZWFkZXJcbiAgICBpZiB1bmRlZmluZWQgIT09IHBrdF9vYmouYm9keSA6OlxuICAgICAgcGt0X29iai5ib2R5ID0gSlNPTi5zdHJpbmdpZnkgQCBwa3Rfb2JqLmJvZHlcbiAgICByZXR1cm4gdGhpcy5wYWNrUmF3KHBrdF9vYmopXG5cblxuICAvLyAtLS0gQ29udHJvbCBtZXNzYWdlIHV0aWxpdGllc1xuXG4gIHNlbmRSb3V0aW5nSGFuZHNoYWtlKCkgOjpcbiAgICByZXR1cm4gc2VuZF9oZWxsbyh0aGlzLCB0aGlzLmh1Yi5yb3V0ZXIuZWNfcHViX2lkKVxuICBzZW5kUGluZygpIDo6XG4gICAgcmV0dXJuIHNlbmRfcGluZ3BvbmcodGhpcylcblxuXG4gIGNsb25lKHByb3BzLCAuLi5leHRyYSkgOjpcbiAgICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSh0aGlzLCBwcm9wcylcbiAgICByZXR1cm4gMCA9PT0gZXh0cmEubGVuZ3RoID8gc2VsZiA6IE9iamVjdC5hc3NpZ24oc2VsZiwgLi4uZXh0cmEpXG4gIGJpbmRDaGFubmVsKHNlbmRSYXcsIHByb3BzKSA6OiByZXR1cm4gYmluZENoYW5uZWwodGhpcywgc2VuZFJhdywgcHJvcHMpXG4gIGJpbmREaXNwYXRjaFBhY2tldHMoKSA6OiByZXR1cm4gYmluZERpc3BhdGNoUGFja2V0cyh0aGlzKVxuXG4gIHVuZGVsaXZlcmFibGUocGt0LCBtb2RlKSA6OlxuICAgIGNvbnN0IHJ0ciA9IHBrdC5pZF9yb3V0ZXIgIT09IHRoaXMuaHViLnJvdXRlci5pZF9zZWxmID8gcGt0LmlkX3JvdXRlciA6ICdzZWxmJ1xuICAgIGNvbnNvbGUud2FybiBAIGBVbmRlbGl2ZXJhYmxlWyR7bW9kZX1dOiAke3BrdC5pZF90YXJnZXR9IG9mICR7cnRyfWBcblxuICBzdGF0aWMgYXNBUEkoaHViLCBwYWNrUmF3KSA6OlxuICAgIGNvbnN0IHNlbGYgPSBuZXcgdGhpcygpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBzZWxmLCBAOlxuICAgICAgcGFja1JhdzogQDogdmFsdWU6IHBhY2tSYXdcbiAgICAgIGh1YjogQDogdmFsdWU6IGh1YlxuICAgICAgX3Jvb3RfOiBAOiB2YWx1ZTogc2VsZlxuICAgIHJldHVybiBzZWxmXG5cbiAgc3RhdGljIGFzQ2hhbm5lbEFQSShodWIsIHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gdGhpcy5hc0FQSSBAIGh1YiwgcGFja2V0UGFyc2VyLnBhY2tQYWNrZXRcblxuICBzdGF0aWMgYXNJbnRlcm5hbEFQSShodWIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1YiwgcGFja2V0UGFyc2VyLnBhY2tQYWNrZXRPYmpcbiAgICBzZWxmLmJpbmRJbnRlcm5hbENoYW5uZWwgPSBkaXNwYXRjaCA9PiBiaW5kSW50ZXJuYWxDaGFubmVsKHNlbGYsIGRpc3BhdGNoKVxuICAgIHJldHVybiBzZWxmXG5cblxuZXhwb3J0IGRlZmF1bHQgQ2hhbm5lbFxuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRDaGFubmVsKGNoYW5uZWwsIHNlbmRSYXcsIHByb3BzKSA6OlxuICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2Ygc2VuZFJhdyA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgQ2hhbm5lbCBleHBlY3RzICdzZW5kUmF3JyBmdW5jdGlvbiBwYXJhbWV0ZXJgXG5cbiAgY29uc3QgY29yZV9wcm9wcyA9IEA6IHNlbmRSYXc6IEB7fSB2YWx1ZTogc2VuZFJhd1xuICBwcm9wcyA9IG51bGwgPT0gcHJvcHMgPyBjb3JlX3Byb3BzIDogT2JqZWN0LmFzc2lnbiBAIGNvcmVfcHJvcHMsIHByb3BzXG5cbiAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUgQCBjaGFubmVsLCBwcm9wc1xuICByZXR1cm4gc2VuZFJhdy5jaGFubmVsID0gc2VsZlxuXG5leHBvcnQgZnVuY3Rpb24gYmluZEludGVybmFsQ2hhbm5lbChjaGFubmVsLCBkaXNwYXRjaCkgOjpcbiAgZGlzcGF0Y2hfcGt0X29iai5jaGFubmVsID0gY2hhbm5lbFxuICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBjaGFubmVsLCBAe31cbiAgICBzZW5kUmF3OiBAe30gdmFsdWU6IGRpc3BhdGNoX3BrdF9vYmpcbiAgICBiaW5kQ2hhbm5lbDogQHt9IHZhbHVlOiBudWxsXG5cbiAgZnVuY3Rpb24gZGlzcGF0Y2hfcGt0X29iaihwa3QpIDo6XG4gICAgaWYgdW5kZWZpbmVkID09PSBwa3QuX3Jhd18gOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgYSBwYXJzZWQgcGt0X29iaiB3aXRoIHZhbGlkICdfcmF3XycgYnVmZmVyIHByb3BlcnR5YFxuICAgIGRpc3BhdGNoIEAgW3BrdF0sIGNoYW5uZWxcbiAgICByZXR1cm4gdHJ1ZVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZERpc3BhdGNoUGFja2V0cyhjaGFubmVsKSA6OlxuICBjb25zdCBkaXNwYXRjaCA9IGNoYW5uZWwuaHViLnJvdXRlci5kaXNwYXRjaFxuICBjb25zdCBmZWVkID0gY2hhbm5lbC5odWIucGFja2V0UGFyc2VyLnBhY2tldFN0cmVhbSgpXG5cbiAgcmV0dXJuIGZ1bmN0aW9uIG9uX3JlY3ZfZGF0YShkYXRhKSA6OlxuICAgIGNvbnN0IHBrdExpc3QgPSBmZWVkKGRhdGEpXG4gICAgaWYgMCA8IHBrdExpc3QubGVuZ3RoIDo6XG4gICAgICBkaXNwYXRjaCBAIHBrdExpc3QsIGNoYW5uZWxcbiIsImltcG9ydCB7Um91dGVyfSBmcm9tICcuL3JvdXRlci5qc3knXG5pbXBvcnQge0NoYW5uZWx9IGZyb20gJy4vY2hhbm5lbC5qc3knXG5cbmV4cG9ydCBjbGFzcyBGYWJyaWNIdWIgOjpcbiAgY29uc3RydWN0b3IoKSA6OlxuICAgIGFwcGx5UGx1Z2lucyBAICdwcmUnLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcblxuICAgIGNvbnN0IHBhY2tldFBhcnNlciA9IHRoaXMucGFja2V0UGFyc2VyXG4gICAgaWYgbnVsbD09cGFja2V0UGFyc2VyIHx8ICEgcGFja2V0UGFyc2VyLmlzUGFja2V0UGFyc2VyKCkgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgSW52YWxpZCBodWIucGFja2V0UGFyc2VyYFxuXG4gICAgY29uc3Qgcm91dGVyID0gdGhpcy5faW5pdF9yb3V0ZXIoKVxuICAgIGNvbnN0IF9hcGlfY2hhbm5lbCA9IHRoaXMuX2luaXRfY2hhbm5lbEFQSShwYWNrZXRQYXJzZXIpXG4gICAgY29uc3QgX2FwaV9pbnRlcm5hbCA9IHRoaXMuX2luaXRfaW50ZXJuYWxBUEkocGFja2V0UGFyc2VyKVxuICAgIHJvdXRlci5pbml0RGlzcGF0Y2goKVxuICAgIF9hcGlfaW50ZXJuYWwuYmluZEludGVybmFsQ2hhbm5lbCBAIHJvdXRlci5kaXNwYXRjaFxuXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAe31cbiAgICAgIHJvdXRlcjogQHt9IHZhbHVlOiByb3V0ZXJcbiAgICAgIHBhY2tldFBhcnNlcjogQHt9IHZhbHVlOiBwYWNrZXRQYXJzZXJcbiAgICAgIF9hcGlfY2hhbm5lbDogQHt9IHZhbHVlOiBfYXBpX2NoYW5uZWxcbiAgICAgIF9hcGlfaW50ZXJuYWw6IEB7fSB2YWx1ZTogX2FwaV9pbnRlcm5hbFxuXG4gICAgYXBwbHlQbHVnaW5zIEAgbnVsbCwgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3Bvc3QnLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICByZXR1cm4gdGhpc1xuXG4gIF9pbml0X3JvdXRlcigpIDo6IHRocm93IG5ldyBFcnJvciBAIGBQbHVnaW4gcmVzcG9uc2libGl0eWBcblxuICBfaW5pdF9jaGFubmVsQVBJKHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gQ2hhbm5lbC5hc0NoYW5uZWxBUEkgQCB0aGlzLCBwYWNrZXRQYXJzZXJcbiAgX2luaXRfaW50ZXJuYWxBUEkocGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiBDaGFubmVsLmFzSW50ZXJuYWxBUEkgQCB0aGlzLCBwYWNrZXRQYXJzZXJcblxuXG4gIHN0YXRpYyBwbHVnaW4oLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIHJldHVybiB0aGlzLnBsdWdpbnMoLi4ucGx1Z2luRnVuY3Rpb25zKVxuICBzdGF0aWMgcGx1Z2lucyguLi5wbHVnaW5GdW5jdGlvbnMpIDo6XG4gICAgY29uc3QgcGx1Z2luTGlzdCA9IFtdLmNvbmNhdCBAXG4gICAgICB0aGlzLnByb3RvdHlwZS5wbHVnaW5MaXN0IHx8IFtdXG4gICAgICBwbHVnaW5GdW5jdGlvbnNcblxuICAgIHBsdWdpbkxpc3Quc29ydCBAIChhLCBiKSA9PiAoMCB8IGEub3JkZXIpIC0gKDAgfCBiLm9yZGVyKVxuXG4gICAgY29uc3QgQmFzZUh1YiA9IHRoaXMuX0Jhc2VIdWJfIHx8IHRoaXNcbiAgICBjbGFzcyBGYWJyaWNIdWJfUEkgZXh0ZW5kcyBCYXNlSHViIDo6XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBGYWJyaWNIdWJfUEkucHJvdG90eXBlLCBAOlxuICAgICAgcGx1Z2luTGlzdDogQHt9IHZhbHVlOiBPYmplY3QuZnJlZXplIEAgcGx1Z2luTGlzdFxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgRmFicmljSHViX1BJLCBAOlxuICAgICAgX0Jhc2VIdWJfOiBAe30gdmFsdWU6IEJhc2VIdWJcblxuICAgIGFwcGx5UGx1Z2lucyBAICdzdWJjbGFzcycsIHBsdWdpbkxpc3QsIEZhYnJpY0h1Yl9QSSwgQDogUm91dGVyLCBDaGFubmVsXG4gICAgcmV0dXJuIEZhYnJpY0h1Yl9QSVxuXG5cbiAgdmFsdWVPZigpIDo6IHJldHVybiB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGdldCBpZF9zZWxmKCkgOjogcmV0dXJuIHRoaXMucm91dGVyLmlkX3NlbGZcbiAgaWRfcm91dGVyX3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLnBhY2tldFBhcnNlci5wYWNrSWQgQFxuICAgICAgdGhpcy5yb3V0ZXIuaWRfc2VsZlxuXG4gIGNvbm5lY3Rfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMuX2FwaV9pbnRlcm5hbC5jbG9uZSgpXG5cblxuICBjb25uZWN0KGNvbm5fdXJsKSA6OlxuICAgIGlmIG51bGwgPT0gY29ubl91cmwgOjpcbiAgICAgIHJldHVybiB0aGlzLmNvbm5lY3Rfc2VsZigpXG5cbiAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGNvbm5fdXJsIDo6XG4gICAgICBjb25uX3VybCA9IHRoaXMuX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybClcblxuICAgIGNvbnN0IGNvbm5lY3QgPSB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFtjb25uX3VybC5wcm90b2NvbF1cbiAgICBpZiAhIGNvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBFcnJvciBAIGBDb25uZWN0aW9uIHByb3RvY29sIFwiJHtjb25uX3VybC5wcm90b2NvbH1cIiBub3QgcmVnaXN0ZXJlZCBmb3IgXCIke2Nvbm5fdXJsLnRvU3RyaW5nKCl9XCJgXG5cbiAgICByZXR1cm4gY29ubmVjdChjb25uX3VybClcblxuICByZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbChwcm90b2NvbCwgY2JfY29ubmVjdCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2JfY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnY2JfY29ubmVjdCcgZnVuY3Rpb25gXG4gICAgY29uc3QgYnlQcm90b2NvbCA9IE9iamVjdC5hc3NpZ24gQCB7fSwgdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xcbiAgICBieVByb3RvY29sW3Byb3RvY29sXSA9IGNiX2Nvbm5lY3RcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgdGhpcywgJ19jb25uZWN0QnlQcm90b2NvbCcsXG4gICAgICBAOiB2YWx1ZTogYnlQcm90b2NvbCwgY29uZmlndXJhYmxlOiB0cnVlXG5cbiAgX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybCkgOjpcbiAgICByZXR1cm4gbmV3IFVSTChjb25uX3VybClcblxuZXhwb3J0IGRlZmF1bHQgRmFicmljSHViXG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseVBsdWdpbnMoa2V5LCBwbHVnaW5MaXN0LCAuLi5hcmdzKSA6OlxuICBpZiAhIGtleSA6OiBrZXkgPSBudWxsXG4gIGZvciBsZXQgcGx1Z2luIG9mIHBsdWdpbkxpc3QgOjpcbiAgICBpZiBudWxsICE9PSBrZXkgOjogcGx1Z2luID0gcGx1Z2luW2tleV1cbiAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgcGx1Z2luIDo6XG4gICAgICBwbHVnaW4oLi4uYXJncylcbiJdLCJuYW1lcyI6WyJkaXNwQ29udHJvbEJ5VHlwZSIsInJlY3ZfaGVsbG8iLCJyZWN2X29sbGVoIiwicmVjdl9wb25nIiwicmVjdl9waW5nIiwic2VuZF9oZWxsbyIsImNoYW5uZWwiLCJlY19wdWJfaWQiLCJodWIiLCJyb3V0ZXIiLCJwYWNrQW5kU2VuZFJhdyIsInR5cGUiLCJpZF9yb3V0ZXJfc2VsZiIsInBrdCIsImVjX290aGVyX2lkIiwiaGVhZGVyX2J1ZmZlciIsImxlbmd0aCIsImVjX2lkX2htYWMiLCJobWFjX3NlY3JldCIsImlkX3JvdXRlciIsInVucGFja0lkIiwiYm9keV9idWZmZXIiLCJ1bnZlcmlmaWVkUGVlclJvdXRlIiwic2VuZF9vbGxlaCIsInBlZXJfaG1hY19jbGFpbSIsImNvbXBhcmUiLCJ2ZXJpZmllZFBlZXJSb3V0ZSIsInNlbmRfcGluZ3BvbmciLCJwb25nIiwiRGF0ZSIsInRvSVNPU3RyaW5nIiwibG9jYWwiLCJyZW1vdGUiLCJ0b1N0cmluZyIsImRlbHRhIiwidHNfcG9uZyIsImVyciIsInRzX3BpbmciLCJzeW1fdW5yZWdpc3RlciIsIlN5bWJvbCIsIlJvdXRlciIsImlkX3NlbGYiLCJyb3V0ZURpc2NvdmVyeSIsInRhcmdldERpc2NvdmVyeSIsInRhcmdldHMiLCJfY3JlYXRlVGFyZ2V0c01hcCIsIk9iamVjdCIsImNyZWF0ZSIsImRlZmluZVByb3BlcnRpZXMiLCJ2YWx1ZSIsInJvdXRlcyIsIl9jcmVhdGVSb3V0ZXNNYXAiLCJzZXQiLCJiaW5kRGlzcGF0Y2hDb250cm9sIiwiYmluZERpc3BhdGNoU2VsZiIsImJpbmREaXNwYXRjaFJvdXRlcyIsImVycm9yIiwiTWFwIiwiZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUiLCJkaXNwYXRjaF9yb3V0ZSIsIl9maXJzdFJvdXRlIiwicmVnaXN0ZXJSb3V0ZSIsInBxdWV1ZSIsInByb21pc2VRdWV1ZSIsImRpc3BhdGNoIiwicGt0TGlzdCIsInBxIiwibWFwIiwidGhlbiIsImRpc3BhdGNoX29uZSIsImdldCIsInVuZGVmaW5lZCIsInVuZGVsaXZlcmFibGUiLCJ1bnJlZ2lzdGVyUm91dGUiLCJvbl9lcnJvcl9pbl9kaXNwYXRjaCIsInJlc29sdmVSb3V0ZSIsIlR5cGVFcnJvciIsImhhcyIsImRlbGV0ZSIsInR0bCIsInNlbmRSYXciLCJyZWdpc3RlclBlZXJSb3V0ZSIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsImNvbnNvbGUiLCJ3YXJuIiwicXVlcnkiLCJfZmlyc3RUYXJnZXQiLCJkaXNwYXRjaFNlbGYiLCJpZF90YXJnZXQiLCJ0YXJnZXQiLCJ1bnJlZ2lzdGVyVGFyZ2V0IiwiaWQiLCJOdW1iZXIiLCJpc1NhZmVJbnRlZ2VyIiwiaGFuZGxlciIsImRudV9kaXNwYXRjaF9jb250cm9sIiwiYXNzaWduIiwicHJvdG90eXBlIiwiYmluZFByb21pc2VGaXJzdFJlc3VsdCIsInRpcCIsIlByb21pc2UiLCJyZXNvbHZlIiwiY2xlYXJfdGlwIiwiaXNfZGVmaW5lZCIsImUiLCJvcHRpb25zIiwidGVzdCIsIm9uX2Vycm9yIiwiaWZBYnNlbnQiLCJhYnNlbnQiLCJsc3RGbnMiLCJyZXNvbHZlSWYiLCJhbGwiLCJBcnJheSIsImZyb20iLCJmbiIsIkNoYW5uZWwiLCJFcnJvciIsImFyZ3MiLCJwYWNrUmF3IiwicGt0X29iaiIsInBhY2tKU09OIiwiaGVhZGVyIiwiSlNPTiIsInN0cmluZ2lmeSIsImJvZHkiLCJwcm9wcyIsImV4dHJhIiwic2VsZiIsImJpbmRDaGFubmVsIiwiYmluZERpc3BhdGNoUGFja2V0cyIsIm1vZGUiLCJydHIiLCJhc0FQSSIsImFzQ2hhbm5lbEFQSSIsInBhY2tldFBhcnNlciIsInBhY2tQYWNrZXQiLCJhc0ludGVybmFsQVBJIiwicGFja1BhY2tldE9iaiIsImJpbmRJbnRlcm5hbENoYW5uZWwiLCJjb3JlX3Byb3BzIiwiZGlzcGF0Y2hfcGt0X29iaiIsIl9yYXdfIiwiZmVlZCIsInBhY2tldFN0cmVhbSIsIm9uX3JlY3ZfZGF0YSIsImRhdGEiLCJGYWJyaWNIdWIiLCJwbHVnaW5MaXN0IiwiaXNQYWNrZXRQYXJzZXIiLCJfaW5pdF9yb3V0ZXIiLCJfYXBpX2NoYW5uZWwiLCJfaW5pdF9jaGFubmVsQVBJIiwiX2FwaV9pbnRlcm5hbCIsIl9pbml0X2ludGVybmFsQVBJIiwiaW5pdERpc3BhdGNoIiwicGx1Z2luIiwicGx1Z2luRnVuY3Rpb25zIiwicGx1Z2lucyIsImNvbmNhdCIsInNvcnQiLCJhIiwiYiIsIm9yZGVyIiwiQmFzZUh1YiIsIl9CYXNlSHViXyIsIkZhYnJpY0h1Yl9QSSIsImZyZWV6ZSIsInBhY2tJZCIsImNsb25lIiwiY29ubl91cmwiLCJjb25uZWN0X3NlbGYiLCJfcGFyc2VDb25uZWN0VVJMIiwiY29ubmVjdCIsIl9jb25uZWN0QnlQcm90b2NvbCIsInByb3RvY29sIiwiY2JfY29ubmVjdCIsImJ5UHJvdG9jb2wiLCJkZWZpbmVQcm9wZXJ0eSIsImNvbmZpZ3VyYWJsZSIsIlVSTCIsImFwcGx5UGx1Z2lucyIsImtleSJdLCJtYXBwaW5ncyI6Ijs7OztBQUFPLE1BQU1BLG9CQUFvQjtHQUM5QixJQUFELEdBQVFDLFVBRHVCO0dBRTlCLElBQUQsR0FBUUMsVUFGdUI7R0FHOUIsSUFBRCxHQUFRQyxTQUh1QjtHQUk5QixJQUFELEdBQVFDLFNBSnVCLEVBQTFCOztBQVFQLEFBQU8sU0FBU0MsVUFBVCxDQUFvQkMsT0FBcEIsRUFBNkI7UUFDNUIsRUFBQ0MsU0FBRCxLQUFj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
