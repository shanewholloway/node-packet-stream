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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvY29udHJvbF9wcm90b2NvbC5qc3kiLCIuLi9jb2RlL3JvdXRlci5qc3kiLCIuLi9jb2RlL2NoYW5uZWwuanN5IiwiLi4vY29kZS9odWIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBkaXNwQ29udHJvbEJ5VHlwZSA9IEB7fVxuICBbMHhmMF06IHJlY3ZfaGVsbG9cbiAgWzB4ZjFdOiByZWN2X29sbGVoXG4gIFsweGZlXTogcmVjdl9wb25nXG4gIFsweGZmXTogcmVjdl9waW5nXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9oZWxsbyhjaGFubmVsKSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYwXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBjaGFubmVsLmh1Yi5pZF9yb3V0ZXJfc2VsZigpXG5cbmZ1bmN0aW9uIHJlY3ZfaGVsbG8ocm91dGVyLCBwa3QsIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gcGt0LmhlYWRlcl9idWZmZXIoKVxuICBpZiAwICE9PSBlY19vdGhlcl9pZC5sZW5ndGggJiYgcm91dGVyLmVjX2lkX2htYWMgOjpcbiAgICBjb25zdCBobWFjX3NlY3JldCA9IHJvdXRlci5lY19pZF9obWFjXG4gICAgICA/IHJvdXRlci5lY19pZF9obWFjKGVjX290aGVyX2lkKSA6IG51bGxcbiAgICBzZW5kX29sbGVoIEAgY2hhbm5lbCwgaG1hY19zZWNyZXRcblxuICBlbHNlIDo6XG4gICAgY29uc3QgaWRfcm91dGVyID0gcGt0LnVucGFja0lkKHBrdC5ib2R5X2J1ZmZlcigpLCAwKVxuICAgIHJvdXRlci51bnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG5cblxuZnVuY3Rpb24gc2VuZF9vbGxlaChjaGFubmVsLCBobWFjX3NlY3JldCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMVxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogaG1hY19zZWNyZXRcblxuZnVuY3Rpb24gcmVjdl9vbGxlaChyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgZWNfb3RoZXJfaWQgPSBwa3QuaGVhZGVyX2J1ZmZlcigpXG4gIGNvbnN0IGlkX3JvdXRlciA9IHBrdC51bnBhY2tJZChlY19vdGhlcl9pZClcblxuICBjb25zdCBobWFjX3NlY3JldCA9IHJvdXRlci5lY19pZF9obWFjXG4gICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCwgdHJ1ZSkgOiBudWxsXG4gIGNvbnN0IHBlZXJfaG1hY19jbGFpbSA9IHBrdC5ib2R5X2J1ZmZlcigpXG4gIGlmIGhtYWNfc2VjcmV0ICYmIDAgPT09IGhtYWNfc2VjcmV0LmNvbXBhcmUgQCBwZWVyX2htYWNfY2xhaW0gOjpcbiAgICByb3V0ZXIudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcbiAgZWxzZSA6OlxuICAgIHJvdXRlci51bnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9waW5ncG9uZyhjaGFubmVsLCBwb25nKSA6OlxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogcG9uZyA/IDB4ZmUgOiAweGZmXG4gICAgYm9keTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbmZ1bmN0aW9uIHJlY3ZfcG9uZyhyb3V0ZXIsIHBrdCwgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgdHJ5IDo6XG4gICAgY29uc3QgcmVtb3RlID0gbmV3IERhdGUgQCBwa3QuYm9keV9idWZmZXIoKS50b1N0cmluZygpXG4gICAgY29uc3QgZGVsdGEgPSByZW1vdGUgLSBsb2NhbFxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBkZWx0YSwgcmVtb3RlLCBsb2NhbFxuICBjYXRjaCBlcnIgOjpcbiAgICBjaGFubmVsLnRzX3BvbmcgPSBAe30gbG9jYWxcblxuZnVuY3Rpb24gcmVjdl9waW5nKHJvdXRlciwgcGt0LCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICBzZW5kX3Bpbmdwb25nIEAgY2hhbm5lbCwgdHJ1ZVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgcGt0LmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGxvY2FsXG5cbiIsImltcG9ydCB7ZGlzcENvbnRyb2xCeVR5cGV9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cbmNvbnN0IGZpcnN0QW5zd2VyID0gYmluZFByb21pc2VGaXJzdFJlc3VsdCgpXG5cbmV4cG9ydCBjbGFzcyBSb3V0ZXIgOjpcbiAgY29uc3RydWN0b3IoaWRfc2VsZikgOjpcbiAgICBpZiBpZF9zZWxmIDo6XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEA6IGlkX3NlbGY6IEA6IHZhbHVlOiBpZF9zZWxmXG4gICAgICB0aGlzLl9pbml0RGlzcGF0Y2goKVxuXG4gIC8vIC0tLSBEaXNwYXRjaCBjb3JlIC0tLVxuXG4gIF9pbml0RGlzcGF0Y2goKSA6OlxuICAgIGNvbnN0IHJvdXRlcyA9IHRoaXMuX2NyZWF0ZVJvdXRlc01hcCgpXG4gICAgcm91dGVzLnNldCBAIDAsIHRoaXMuYmluZERpc3BhdGNoQ29udHJvbCgpXG4gICAgaWYgbnVsbCAhPSB0aGlzLmlkX3NlbGYgOjpcbiAgICAgIHJvdXRlcy5zZXQgQCB0aGlzLmlkX3NlbGYsIHRoaXMuYmluZERpc3BhdGNoU2VsZigpXG5cbiAgICBjb25zdCBwcXVldWUgPSBwcm9taXNlUXVldWUoKVxuICAgIGNvbnN0IGRpc3BhdGNoX29uZSA9IHRoaXMuYmluZERpc3BhdGNoUm91dGUocm91dGVzKVxuICAgIHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEA6XG4gICAgICByb3V0ZXM6IEA6IHZhbHVlOiByb3V0ZXNcbiAgICAgIGRpc3BhdGNoOiBAOiB2YWx1ZTogZGlzcGF0Y2hcblxuICAgIGZ1bmN0aW9uIGRpc3BhdGNoKHBrdExpc3QsIGNoYW5uZWwpIDo6XG4gICAgICBjb25zdCBwcSA9IHBxdWV1ZSgpIC8vIHBxIHdpbGwgZGlzcGF0Y2ggZHVyaW5nIFByb21pc2UgcmVzb2x1dGlvbnNcbiAgICAgIHJldHVybiBwa3RMaXN0Lm1hcCBAIHBrdCA9PlxuICAgICAgICBwcS50aGVuIEAgKCkgPT4gZGlzcGF0Y2hfb25lKHBrdCwgY2hhbm5lbClcblxuICBvbl9lcnJvcl9pbl9kaXNwYXRjaChlcnIsIHBrdCkgOjpcbiAgICBjb25zb2xlLmVycm9yIEAgJ0Vycm9yIGR1cmluZyBwYWNrZXQgZGlzcGF0Y2hcXG4gIHBrdDonLCBwa3QsICdcXG4nLCBlcnIsICdcXG4nXG5cbiAgX2NyZWF0ZVJvdXRlc01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcblxuICAvLyAtLS0gRGlzcGF0Y2ggdG8gcm91dGUgLS0tXG5cbiAgcm91dGVEaXNjb3ZlcnkgPSBbXVxuICBkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIsIHBrdCkgOjpcbiAgICByZXR1cm4gZmlyc3RBbnN3ZXIgQCBpZF9yb3V0ZXIsIHRoaXMucm91dGVEaXNjb3ZlcnlcblxuICBiaW5kRGlzcGF0Y2hSb3V0ZShyb3V0ZXMpIDo6XG4gICAgcmV0dXJuIGFzeW5jIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICB0cnkgOjpcbiAgICAgICAgY29uc3QgaWRfcm91dGVyID0gcGt0LmlkX3JvdXRlclxuICAgICAgICBsZXQgZGlzcGF0Y2hfcm91dGUgPSByb3V0ZXMuZ2V0KGlkX3JvdXRlcilcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgIGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIsIHBrdClcbiAgICAgICAgICBpZiBudWxsID09IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgICAgICByZXR1cm4gY2hhbm5lbC51bmRlbGl2ZXJhYmxlKHBrdCwgJ3JvdXRlJylcbiAgICAgICAgICB0aGlzLnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSlcblxuICAgICAgICBpZiBmYWxzZSA9PT0gYXdhaXQgZGlzcGF0Y2hfcm91dGUocGt0LCBjaGFubmVsKSA6OlxuICAgICAgICAgIHRoaXMudW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcilcbiAgICAgIGNhdGNoIGVyciA6OlxuICAgICAgICB0aGlzLm9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgcGt0LCBjaGFubmVsKVxuXG5cbiAgcmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlKSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgaWYgbnVsbCAhPSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdkaXNwYXRjaF9yb3V0ZScgdG8gYmUgYSBmdW5jdGlvbmBcbiAgICAgIGVsc2UgcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5yb3V0ZXMuaGFzIEAgaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuICAgIGlmIDAgPT09IGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiB0aGlzLmlkX3NlbGYgPT09IGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcblxuICAgIHRoaXMucm91dGVzLnNldCBAIGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGVcbiAgICByZXR1cm4gdHJ1ZVxuICB1bnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyKSA6OlxuICAgIHJldHVybiB0aGlzLnJvdXRlcy5kZWxldGUgQCBpZF9yb3V0ZXJcbiAgcmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUm91dGUgQCBpZF9yb3V0ZXIsIHBrdCA9PiA6OlxuICAgICAgaWYgMCAhPT0gcGt0LnR0bCA6OiBjaGFubmVsLnNlbmRSYXcocGt0KVxuICB2ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKVxuICB1bnZlcmlmaWVkUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICBpZiB0aGlzLmFsbG93VW52ZXJpZmllZFJvdXRlcyB8fCBjaGFubmVsLmFsbG93VW52ZXJpZmllZFJvdXRlcyA6OlxuICAgICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKVxuICAgIGVsc2UgY29uc29sZS53YXJuIEAgJ1VudmVyaWZpZWQgcGVlciByb3V0ZSAoaWdub3JlZCk6JywgQDogaWRfcm91dGVyLCBjaGFubmVsXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggdG8gbG9jYWwgdGFyZ2V0XG5cbiAgdGFyZ2V0RGlzY292ZXJ5ID0gW11cbiAgZGlzcGF0Y2hfZGlzY292ZXJfdGFyZ2V0KGlkX3RhcmdldCwgcGt0KSA6OlxuICAgIHJldHVybiBmaXJzdEFuc3dlciBAIGlkX3RhcmdldCwgdGhpcy50YXJnZXREaXNjb3ZlcnlcblxuICBiaW5kRGlzcGF0Y2hTZWxmKHBrdCkgOjpcbiAgICBjb25zdCBkaXNwYXRjaFNlbGYgPSBhc3luYyAocGt0LCBjaGFubmVsKSA9PiA6OlxuICAgICAgY29uc3QgaWRfdGFyZ2V0ID0gcGt0LmlkX3RhcmdldFxuICAgICAgbGV0IHRhcmdldCA9IHRoaXMudGFyZ2V0cy5nZXQoaWRfdGFyZ2V0KVxuICAgICAgaWYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgICAgdGFyZ2V0ID0gYXdhaXQgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl90YXJnZXQocGt0KVxuICAgICAgICBpZiBudWxsID09IHRhcmdldCA6OlxuICAgICAgICAgIHJldHVybiBjaGFubmVsLnVuZGVsaXZlcmFibGUocGt0LCAndGFyZ2V0JylcbiAgICAgICAgLy90aGlzLnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCwgdGFyZ2V0KVxuXG4gICAgICBpZiBmYWxzZSA9PT0gYXdhaXQgdGFyZ2V0KHBrdCwgdGhpcykgOjpcbiAgICAgICAgdGhpcy51bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldClcblxuICAgIHRoaXMuZGlzcGF0Y2hTZWxmID0gZGlzcGF0Y2hTZWxmXG4gICAgcmV0dXJuIGRpc3BhdGNoU2VsZlxuXG4gIF9jcmVhdGVUYXJnZXRzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuICB0YXJnZXRzID0gdGhpcy5fY3JlYXRlVGFyZ2V0c01hcCgpXG4gIHJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCwgdGFyZ2V0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpZF90YXJnZXQgJiYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgIHRhcmdldCA9IGlkX3RhcmdldFxuICAgICAgaWRfdGFyZ2V0ID0gdGFyZ2V0LmlkX3RhcmdldCB8fCB0YXJnZXQuaWRcblxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiB0YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ3RhcmdldCcgdG8gYmUgYSBmdW5jdGlvbmBcbiAgICBpZiAhIE51bWJlci5pc1NhZmVJbnRlZ2VyIEAgaWRfdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdpZF90YXJnZXQnIHRvIGJlIGFuIGludGVnZXJgXG4gICAgaWYgdGhpcy50YXJnZXRzLmhhcyBAIGlkX3RhcmdldCA6OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5zZXQgQCBpZF90YXJnZXQsIHRhcmdldFxuICB1bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCkgOjpcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLmRlbGV0ZSBAIGlkX3RhcmdldFxuXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggY29udHJvbCBwYWNrZXRzXG5cbiAgYmluZERpc3BhdGNoQ29udHJvbCgpIDo6XG4gICAgcmV0dXJuIChwa3QsIGNoYW5uZWwpID0+IDo6XG4gICAgICBpZiAwICE9PSBwa3QuaWRfdGFyZ2V0IDo6IC8vIGNvbm5lY3Rpb24tZGlzcGF0Y2hlZFxuICAgICAgICByZXR1cm4gdGhpcy5kaXNwYXRjaFNlbGYocGt0LCBjaGFubmVsKVxuXG4gICAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVtwa3QudHlwZV1cbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gaGFuZGxlciA6OlxuICAgICAgICByZXR1cm4gaGFuZGxlcih0aGlzLCBwa3QsIGNoYW5uZWwpXG4gICAgICBlbHNlIDo6XG4gICAgICAgIHJldHVybiB0aGlzLmRudV9kaXNwYXRjaF9jb250cm9sKHBrdCwgY2hhbm5lbClcblxuICBkaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5jcmVhdGUgQCB0aGlzLmRpc3BDb250cm9sQnlUeXBlXG4gIGRudV9kaXNwYXRjaF9jb250cm9sKHBrdCwgY2hhbm5lbCkgOjpcbiAgICBjb25zb2xlLndhcm4gQCAnZG51X2Rpc3BhdGNoX2NvbnRyb2wnLCBwa3QudHlwZSwgcGt0XG5cblxuUm91dGVyLnByb3RvdHlwZS5kaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5hc3NpZ24gQCB7fVxuICBkaXNwQ29udHJvbEJ5VHlwZVxuXG5leHBvcnQgZGVmYXVsdCBSb3V0ZXJcblxuXG5mdW5jdGlvbiBwcm9taXNlUXVldWUoKSA6OlxuICBsZXQgdGlwID0gbnVsbFxuICByZXR1cm4gZnVuY3Rpb24gKCkgOjpcbiAgICBpZiBudWxsID09PSB0aXAgOjpcbiAgICAgIHRpcCA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICB0aXAudGhlbiBAIGNsZWFyX3RpcFxuICAgIHJldHVybiB0aXBcblxuICBmdW5jdGlvbiBjbGVhcl90aXAoKSA6OlxuICAgIHRpcCA9IG51bGxcblxuZnVuY3Rpb24gYmluZFByb21pc2VGaXJzdFJlc3VsdChvcHRpb25zPXt9KSA6OlxuICBjb25zdCBvbl9lcnJvciA9IG9wdGlvbnMub25fZXJyb3IgfHwgY29uc29sZS5lcnJvclxuICBjb25zdCBpZkFic2VudCA9IG9wdGlvbnMuYWJzZW50IHx8IG51bGxcblxuICByZXR1cm4gKHRpcCwgbHN0Rm5zKSA9PlxuICAgIG5ldyBQcm9taXNlIEAgcmVzb2x2ZSA9Pjo6XG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUodGlwKVxuICAgICAgUHJvbWlzZS5hbGwgQFxuICAgICAgICBBcnJheS5mcm9tIEAgbHN0Rm5zLCBmbiA9PlxuICAgICAgICAgIHRpcC50aGVuKGZuKS50aGVuKHJlc29sdmUsIG9uX2Vycm9yKVxuICAgICAgLnRoZW4gQCBhYnNlbnQsIGFic2VudFxuXG4gICAgICBmdW5jdGlvbiBhYnNlbnQoKSA6OlxuICAgICAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaWZBYnNlbnQgOjpcbiAgICAgICAgICByZXNvbHZlIEAgaWZBYnNlbnQoKVxuICAgICAgICBlbHNlIHJlc29sdmUgQCBpZkFic2VudFxuIiwiaW1wb3J0IHtzZW5kX2hlbGxvLCBzZW5kX3Bpbmdwb25nfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5cbmV4cG9ydCBjbGFzcyBDaGFubmVsIDo6XG4gIHNlbmRSYXcoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgSW5zdGFuY2UgcmVzcG9uc2libGl0eWBcbiAgcGFja1JhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuXG4gIHBhY2tBbmRTZW5kUmF3KC4uLmFyZ3MpIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja1JhdyBAIC4uLmFyZ3NcblxuICBzZW5kSlNPTihwa3Rfb2JqKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tKU09OIEAgcGt0X29ialxuICBwYWNrSlNPTihwa3Rfb2JqKSA6OlxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcGt0X29iai5oZWFkZXIgOjpcbiAgICAgIHBrdF9vYmouaGVhZGVyID0gSlNPTi5zdHJpbmdpZnkgQCBwa3Rfb2JqLmhlYWRlclxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcGt0X29iai5ib2R5IDo6XG4gICAgICBwa3Rfb2JqLmJvZHkgPSBKU09OLnN0cmluZ2lmeSBAIHBrdF9vYmouYm9keVxuICAgIHJldHVybiB0aGlzLnBhY2tSYXcocGt0X29iailcblxuXG4gIC8vIC0tLSBDb250cm9sIG1lc3NhZ2UgdXRpbGl0aWVzXG5cbiAgc2VuZFJvdXRpbmdIYW5kc2hha2UoKSA6OlxuICAgIHJldHVybiBzZW5kX2hlbGxvKHRoaXMsIHRoaXMucm91dGVyLmVjX3B1Yl9pZClcbiAgc2VuZFBpbmcoKSA6OlxuICAgIHJldHVybiBzZW5kX3Bpbmdwb25nKHRoaXMpXG5cblxuICBjbG9uZShwcm9wcywgLi4uZXh0cmEpIDo6XG4gICAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUodGhpcywgcHJvcHMpXG4gICAgcmV0dXJuIDAgPT09IGV4dHJhLmxlbmd0aCA/IHNlbGYgOiBPYmplY3QuYXNzaWduKHNlbGYsIC4uLmV4dHJhKVxuICBiaW5kQ2hhbm5lbChzZW5kUmF3LCBwcm9wcykgOjogcmV0dXJuIGJpbmRDaGFubmVsKHRoaXMsIHNlbmRSYXcsIHByb3BzKVxuICBiaW5kRGlzcGF0Y2hQYWNrZXRzKCkgOjogcmV0dXJuIGJpbmREaXNwYXRjaFBhY2tldHModGhpcylcblxuICB1bmRlbGl2ZXJhYmxlKHBrdCwgbW9kZSkgOjpcbiAgICBjb25zb2xlLndhcm4gQCAndW5kZWxpdmVyYWJsZTonLCBwa3QsIG1vZGVcblxuICBzdGF0aWMgYXNBUEkoaHViLCByb3V0ZXIsIHBhY2tSYXcpIDo6XG4gICAgY29uc3Qgc2VsZiA9IG5ldyB0aGlzKClcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHNlbGYsIEA6XG4gICAgICBwYWNrUmF3OiBAOiB2YWx1ZTogcGFja1Jhd1xuICAgICAgcm91dGVyOiBAOiB2YWx1ZTogcm91dGVyXG4gICAgICBodWI6IEA6IHZhbHVlOiBodWJcbiAgICAgIF9yb290XzogQDogdmFsdWU6IHNlbGZcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0NoYW5uZWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja1BhY2tldFxuICAgIHJldHVybiBzZWxmXG5cbiAgc3RhdGljIGFzSW50ZXJuYWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja1BhY2tldE9ialxuICAgIHJldHVybiBzZWxmLmJpbmRDaGFubmVsIEAgYmluZERpc3BhdGNoSW50ZXJuYWxQYWNrZXQocm91dGVyKVxuXG5leHBvcnQgZGVmYXVsdCBDaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gYmluZENoYW5uZWwoY2hhbm5lbCwgc2VuZFJhdywgcHJvcHMpIDo6XG4gIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBzZW5kUmF3IDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBDaGFubmVsIGV4cGVjdHMgJ3NlbmRSYXcnIGZ1bmN0aW9uIHBhcmFtZXRlcmBcblxuICBjb25zdCBjb3JlX3Byb3BzID0gQDogc2VuZFJhdzogQHt9IHZhbHVlOiBzZW5kUmF3XG4gIHByb3BzID0gbnVsbCA9PSBwcm9wcyA/IGNvcmVfcHJvcHMgOiBPYmplY3QuYXNzaWduIEAgY29yZV9wcm9wcywgcHJvcHNcblxuICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSBAIGNoYW5uZWwsIHByb3BzXG4gIHJldHVybiBzZW5kUmF3LmNoYW5uZWwgPSBzZWxmXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaEludGVybmFsUGFja2V0KHJvdXRlcikgOjpcbiAgY29uc3QgZGlzcGF0Y2ggPSByb3V0ZXIuZGlzcGF0Y2hcbiAgcmV0dXJuIGRpc3BhdGNoX3BrdF9vYmpcblxuICBmdW5jdGlvbiBkaXNwYXRjaF9wa3Rfb2JqKHBrdCkgOjpcbiAgICBpZiB1bmRlZmluZWQgPT09IHBrdC5fcmF3XyA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCBhIHBhcnNlZCBwa3Rfb2JqIHdpdGggdmFsaWQgJ19yYXdfJyBidWZmZXIgcHJvcGVydHlgXG4gICAgZGlzcGF0Y2ggQCBbcGt0XSwgZGlzcGF0Y2hfcGt0X29iai5jaGFubmVsXG4gICAgcmV0dXJuIHRydWVcblxuXG5leHBvcnQgZnVuY3Rpb24gYmluZERpc3BhdGNoUGFja2V0cyhjaGFubmVsKSA6OlxuICBjb25zdCBkaXNwYXRjaCA9IGNoYW5uZWwucm91dGVyLmRpc3BhdGNoXG4gIGNvbnN0IGZlZWQgPSBjaGFubmVsLmh1Yi5wYWNrZXRQYXJzZXIucGFja2V0U3RyZWFtKClcblxuICByZXR1cm4gZnVuY3Rpb24gb25fcmVjdl9kYXRhKGRhdGEpIDo6XG4gICAgY29uc3QgcGt0TGlzdCA9IGZlZWQoZGF0YSlcbiAgICBpZiAwIDwgcGt0TGlzdC5sZW5ndGggOjpcbiAgICAgIGRpc3BhdGNoIEAgcGt0TGlzdCwgY2hhbm5lbFxuIiwiaW1wb3J0IHtSb3V0ZXJ9IGZyb20gJy4vcm91dGVyLmpzeSdcbmltcG9ydCB7Q2hhbm5lbH0gZnJvbSAnLi9jaGFubmVsLmpzeSdcblxuZXhwb3J0IGNsYXNzIEZpYmVySHViIDo6XG4gIGNvbnN0cnVjdG9yKCkgOjpcbiAgICBhcHBseVBsdWdpbnMgQCAncHJlJywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG5cbiAgICBjb25zdCBwYWNrZXRQYXJzZXIgPSB0aGlzLnBhY2tldFBhcnNlclxuICAgIGlmIG51bGw9PXBhY2tldFBhcnNlciB8fCAhIHBhY2tldFBhcnNlci5pc1BhY2tldFBhcnNlcigpIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEludmFsaWQgaHViLnBhY2tldFBhcnNlcmBcblxuICAgIGNvbnN0IHJvdXRlciA9IHRoaXMuX2luaXRfcm91dGVyKClcbiAgICBjb25zdCBfYXBpX2NoYW5uZWwgPSB0aGlzLl9pbml0X2NoYW5uZWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpXG4gICAgY29uc3QgX2FwaV9pbnRlcm5hbCA9IHRoaXMuX2luaXRfaW50ZXJuYWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAe31cbiAgICAgIHJvdXRlcjogQHt9IHZhbHVlOiByb3V0ZXJcbiAgICAgIHBhY2tldFBhcnNlcjogQHt9IHZhbHVlOiBwYWNrZXRQYXJzZXJcbiAgICAgIF9hcGlfY2hhbm5lbDogQHt9IHZhbHVlOiBfYXBpX2NoYW5uZWxcbiAgICAgIF9hcGlfaW50ZXJuYWw6IEB7fSB2YWx1ZTogX2FwaV9pbnRlcm5hbFxuXG4gICAgYXBwbHlQbHVnaW5zIEAgbnVsbCwgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3Bvc3QnLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICByZXR1cm4gdGhpc1xuXG4gIF9pbml0X3JvdXRlcigpIDo6IHRocm93IG5ldyBFcnJvciBAIGBQbHVnaW4gcmVzcG9uc2libGl0eWBcblxuICBfaW5pdF9jaGFubmVsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiBDaGFubmVsLmFzQ2hhbm5lbEFQSSBAXG4gICAgICB0aGlzLCByb3V0ZXIsIHBhY2tldFBhcnNlclxuICBfaW5pdF9pbnRlcm5hbEFQSShyb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gQ2hhbm5lbC5hc0ludGVybmFsQVBJIEBcbiAgICAgIHRoaXMsIHJvdXRlciwgcGFja2V0UGFyc2VyXG5cblxuICBzdGF0aWMgcGx1Z2luKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICByZXR1cm4gdGhpcy5wbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucylcbiAgc3RhdGljIHBsdWdpbnMoLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIGNvbnN0IHBsdWdpbkxpc3QgPSBbXS5jb25jYXQgQFxuICAgICAgdGhpcy5wcm90b3R5cGUucGx1Z2luTGlzdCB8fCBbXVxuICAgICAgcGx1Z2luRnVuY3Rpb25zXG5cbiAgICBwbHVnaW5MaXN0LnNvcnQgQCAoYSwgYikgPT4gKDAgfCBhLm9yZGVyKSAtICgwIHwgYi5vcmRlcilcblxuICAgIGNvbnN0IEJhc2VIdWIgPSB0aGlzLl9CYXNlSHViXyB8fCB0aGlzXG4gICAgY2xhc3MgRmliZXJIdWJfUEkgZXh0ZW5kcyBCYXNlSHViIDo6XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBGaWJlckh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwbHVnaW5MaXN0OiBAe30gdmFsdWU6IE9iamVjdC5mcmVlemUgQCBwbHVnaW5MaXN0XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBGaWJlckh1Yl9QSSwgQDpcbiAgICAgIF9CYXNlSHViXzogQHt9IHZhbHVlOiBCYXNlSHViXG5cbiAgICBhcHBseVBsdWdpbnMgQCAnc3ViY2xhc3MnLCBwbHVnaW5MaXN0LCBGaWJlckh1Yl9QSSwgQDogUm91dGVyLCBDaGFubmVsXG4gICAgcmV0dXJuIEZpYmVySHViX1BJXG5cblxuICBnZXQgaWRfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMucm91dGVyLmlkX3NlbGZcbiAgaWRfcm91dGVyX3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLnBhY2tldFBhcnNlci5wYWNrSWQgQFxuICAgICAgdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBjb25uZWN0X3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLl9hcGlfaW50ZXJuYWwuY2xvbmUoKVxuXG4gIGNvbm5lY3QoY29ubl91cmwpIDo6XG4gICAgaWYgbnVsbCA9PSBjb25uX3VybCA6OlxuICAgICAgcmV0dXJuIHRoaXMuY29ubmVjdF9zZWxmKClcblxuICAgIGlmICdzdHJpbmcnID09PSB0eXBlb2YgY29ubl91cmwgOjpcbiAgICAgIGNvbm5fdXJsID0gdGhpcy5fcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKVxuXG4gICAgY29uc3QgY29ubmVjdCA9IHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sW2Nvbm5fdXJsLnByb3RvY29sXVxuICAgIGlmICEgY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYENvbm5lY3Rpb24gcHJvdG9jb2wgXCIke2Nvbm5fdXJsLnByb3RvY29sfVwiIG5vdCByZWdpc3RlcmVkIGZvciBcIiR7Y29ubl91cmwudG9TdHJpbmcoKX1cImBcblxuICAgIHJldHVybiBjb25uZWN0KGNvbm5fdXJsKVxuXG4gIHJlZ2lzdGVyQ29ubmVjdGlvblByb3RvY29sKHByb3RvY29sLCBjYl9jb25uZWN0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYl9jb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdjYl9jb25uZWN0JyBmdW5jdGlvbmBcbiAgICBjb25zdCBieVByb3RvY29sID0gT2JqZWN0LmFzc2lnbiBAIHt9LCB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFxuICAgIGJ5UHJvdG9jb2xbcHJvdG9jb2xdID0gY2JfY29ubmVjdFxuICAgIHJldHVybiBPYmplY3QuZGVmaW5lUHJvcGVydHkgQCB0aGlzLCAnX2Nvbm5lY3RCeVByb3RvY29sJyxcbiAgICAgIEA6IHZhbHVlOiBieVByb3RvY29sLCBjb25maWd1cmFibGU6IHRydWVcblxuICBfcGFyc2VDb25uZWN0VVJMKGNvbm5fdXJsKSA6OlxuICAgIHJldHVybiBuZXcgVVJMKGNvbm5fdXJsKVxuXG5leHBvcnQgZGVmYXVsdCBGaWJlckh1YlxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlQbHVnaW5zKGtleSwgcGx1Z2luTGlzdCwgLi4uYXJncykgOjpcbiAgaWYgISBrZXkgOjoga2V5ID0gbnVsbFxuICBmb3IgbGV0IHBsdWdpbiBvZiBwbHVnaW5MaXN0IDo6XG4gICAgaWYgbnVsbCAhPT0ga2V5IDo6IHBsdWdpbiA9IHBsdWdpbltrZXldXG4gICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIHBsdWdpbiA6OlxuICAgICAgcGx1Z2luKC4uLmFyZ3MpXG4iXSwibmFtZXMiOlsiZGlzcENvbnRyb2xCeVR5cGUiLCJyZWN2X2hlbGxvIiwicmVjdl9vbGxlaCIsInJlY3ZfcG9uZyIsInJlY3ZfcGluZyIsInNlbmRfaGVsbG8iLCJjaGFubmVsIiwiZWNfcHViX2lkIiwicm91dGVyIiwicGFja0FuZFNlbmRSYXciLCJ0eXBlIiwiaHViIiwiaWRfcm91dGVyX3NlbGYiLCJwa3QiLCJlY19vdGhlcl9pZCIsImhlYWRlcl9idWZmZXIiLCJsZW5ndGgiLCJlY19pZF9obWFjIiwiaG1hY19zZWNyZXQiLCJpZF9yb3V0ZXIiLCJ1bnBhY2tJZCIsImJvZHlfYnVmZmVyIiwidW52ZXJpZmllZFBlZXJSb3V0ZSIsInNlbmRfb2xsZWgiLCJwZWVyX2htYWNfY2xhaW0iLCJjb21wYXJlIiwidmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX3Bpbmdwb25nIiwicG9uZyIsIkRhdGUiLCJ0b0lTT1N0cmluZyIsImxvY2FsIiwicmVtb3RlIiwidG9TdHJpbmciLCJkZWx0YSIsInRzX3BvbmciLCJlcnIiLCJ0c19waW5nIiwiZmlyc3RBbnN3ZXIiLCJiaW5kUHJvbWlzZUZpcnN0UmVzdWx0IiwiUm91dGVyIiwiaWRfc2VsZiIsInJvdXRlRGlzY292ZXJ5IiwidGFyZ2V0RGlzY292ZXJ5IiwidGFyZ2V0cyIsIl9jcmVhdGVUYXJnZXRzTWFwIiwiT2JqZWN0IiwiY3JlYXRlIiwiZGVmaW5lUHJvcGVydGllcyIsInZhbHVlIiwiX2luaXREaXNwYXRjaCIsInJvdXRlcyIsIl9jcmVhdGVSb3V0ZXNNYXAiLCJzZXQiLCJiaW5kRGlzcGF0Y2hDb250cm9sIiwiYmluZERpc3BhdGNoU2VsZiIsInBxdWV1ZSIsInByb21pc2VRdWV1ZSIsImRpc3BhdGNoX29uZSIsImJpbmREaXNwYXRjaFJvdXRlIiwiZGlzcGF0Y2giLCJwa3RMaXN0IiwicHEiLCJtYXAiLCJ0aGVuIiwiZXJyb3IiLCJNYXAiLCJkaXNwYXRjaF9yb3V0ZSIsImdldCIsInVuZGVmaW5lZCIsImRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlIiwidW5kZWxpdmVyYWJsZSIsInJlZ2lzdGVyUm91dGUiLCJ1bnJlZ2lzdGVyUm91dGUiLCJvbl9lcnJvcl9pbl9kaXNwYXRjaCIsIlR5cGVFcnJvciIsImhhcyIsImRlbGV0ZSIsInR0bCIsInNlbmRSYXciLCJyZWdpc3RlclBlZXJSb3V0ZSIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsImNvbnNvbGUiLCJ3YXJuIiwiaWRfdGFyZ2V0IiwiZGlzcGF0Y2hTZWxmIiwidGFyZ2V0IiwiZGlzcGF0Y2hfZGlzY292ZXJfdGFyZ2V0IiwidW5yZWdpc3RlclRhcmdldCIsImlkIiwiTnVtYmVyIiwiaXNTYWZlSW50ZWdlciIsImhhbmRsZXIiLCJkbnVfZGlzcGF0Y2hfY29udHJvbCIsInByb3RvdHlwZSIsImFzc2lnbiIsInRpcCIsIlByb21pc2UiLCJyZXNvbHZlIiwiY2xlYXJfdGlwIiwib3B0aW9ucyIsIm9uX2Vycm9yIiwiaWZBYnNlbnQiLCJhYnNlbnQiLCJsc3RGbnMiLCJhbGwiLCJBcnJheSIsImZyb20iLCJmbiIsIkNoYW5uZWwiLCJFcnJvciIsImFyZ3MiLCJwYWNrUmF3IiwicGt0X29iaiIsInBhY2tKU09OIiwiaGVhZGVyIiwiSlNPTiIsInN0cmluZ2lmeSIsImJvZHkiLCJwcm9wcyIsImV4dHJhIiwic2VsZiIsImJpbmRDaGFubmVsIiwiYmluZERpc3BhdGNoUGFja2V0cyIsIm1vZGUiLCJhc0FQSSIsImFzQ2hhbm5lbEFQSSIsInBhY2tldFBhcnNlciIsInBhY2tQYWNrZXQiLCJhc0ludGVybmFsQVBJIiwicGFja1BhY2tldE9iaiIsImJpbmREaXNwYXRjaEludGVybmFsUGFja2V0IiwiY29yZV9wcm9wcyIsImRpc3BhdGNoX3BrdF9vYmoiLCJfcmF3XyIsImZlZWQiLCJwYWNrZXRTdHJlYW0iLCJvbl9yZWN2X2RhdGEiLCJkYXRhIiwiRmliZXJIdWIiLCJwbHVnaW5MaXN0IiwiaXNQYWNrZXRQYXJzZXIiLCJfaW5pdF9yb3V0ZXIiLCJfYXBpX2NoYW5uZWwiLCJfaW5pdF9jaGFubmVsQVBJIiwiX2FwaV9pbnRlcm5hbCIsIl9pbml0X2ludGVybmFsQVBJIiwicGx1Z2luIiwicGx1Z2luRnVuY3Rpb25zIiwicGx1Z2lucyIsImNvbmNhdCIsInNvcnQiLCJhIiwiYiIsIm9yZGVyIiwiQmFzZUh1YiIsIl9CYXNlSHViXyIsIkZpYmVySHViX1BJIiwiZnJlZXplIiwicGFja0lkIiwiY2xvbmUiLCJjb25uX3VybCIsImNvbm5lY3Rfc2VsZiIsIl9wYXJzZUNvbm5lY3RVUkwiLCJjb25uZWN0IiwiX2Nvbm5lY3RCeVByb3RvY29sIiwicHJvdG9jb2wiLCJjYl9jb25uZWN0IiwiYnlQcm90b2NvbCIsImRlZmluZVByb3BlcnR5IiwiY29uZmlndXJhYmxlIiwiVVJMIiwiYXBwbHlQbHVnaW5zIiwia2V5Il0sIm1hcHBpbmdzIjoiOzs7O0FBQU8sTUFBTUEsb0JBQW9CO0dBQzlCLElB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
