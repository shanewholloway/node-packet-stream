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

function recv_hello(router, msg, channel) {
  const ec_other_id = msg.header_buffer();
  if (0 !== ec_other_id.length && router.ec_id_hmac) {
    const hmac_secret = router.ec_id_hmac ? router.ec_id_hmac(ec_other_id) : null;
    send_olleh(channel, hmac_secret);
  } else {
    const id_router = msg.unpackId(msg.body_buffer(), 0);
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

function recv_olleh(router, msg, channel) {
  const ec_other_id = msg.header_buffer();
  const id_router = msg.unpackId(ec_other_id);

  const hmac_secret = router.ec_id_hmac ? router.ec_id_hmac(ec_other_id, true) : null;
  const peer_hmac_claim = msg.body_buffer();
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

function recv_pong(router, msg, channel) {
  const local = new Date();

  try {
    const remote = new Date(msg.body_buffer().toString());
    const delta = remote - local;
    channel.ts_pong = { delta, remote, local };
  } catch (err) {
    channel.ts_pong = { local };
  }
}

function recv_ping(router, msg, channel) {
  const local = new Date();

  send_pingpong(channel, true);

  try {
    const remote = new Date(msg.body_buffer().toString());
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

class MessageRouter {
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

    function dispatch(msgList, channel) {
      const pq = pqueue(); // pq will dispatch during Promise resolutions
      return msgList.map(msg => pq.then(() => dispatch_one(msg, channel)));
    }
  }

  on_error_in_dispatch(err, msg) {
    console.error('Error during msg dispatch\n  msg:', msg, '\n', err, '\n');
  }

  _createRoutesMap() {
    return new Map();
  }

  // --- Dispatch to route ---

  dispatch_discover_route(id_router, msg) {
    return firstAnswer(id_router, this.routeDiscovery);
  }

  bindDispatchRoute(routes) {
    return async (msg, channel) => {
      try {
        const id_router = msg.id_router;
        let dispatch_route = routes.get(id_router);
        if (undefined === dispatch_route) {
          dispatch_route = await this.dispatch_discover_route(id_router, msg);
          if (null == dispatch_route) {
            return channel.undeliverable(msg, 'route');
          }
          this.registerRoute(id_router, dispatch_route);
        }

        if (false === (await dispatch_route(msg, channel))) {
          this.unregisterRoute(id_router);
        }
      } catch (err) {
        this.on_error_in_dispatch(err, msg, channel);
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
    return this.registerRoute(id_router, msg => {
      if (0 !== msg.ttl) {
        channel.sendRaw(msg);
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

  dispatch_discover_target(id_target, msg) {
    return firstAnswer(id_target, this.targetDiscovery);
  }

  bindDispatchSelf(msg) {
    const dispatchSelf = async (msg, channel) => {
      const id_target = msg.id_target;
      let target = this.targets.get(id_target);
      if (undefined === target) {
        target = await this.dispatch_discover_target(msg);
        if (null == target) {
          return channel.undeliverable(msg, 'target');
        }
        //this.registerTarget(id_target, target)
      }if (false === (await target(msg, this))) {
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

  // --- Dispatch control messages

  bindDispatchControl() {
    return (msg, channel) => {
      if (0 !== msg.id_target) {
        // connection-dispatched
        return this.dispatchSelf(msg, channel);
      }

      const handler = this.dispControlByType[msg.type];
      if (undefined !== handler) {
        return handler(this, msg, channel);
      } else {
        return this.dnu_dispatch_control(msg, channel);
      }
    };
  }
  dnu_dispatch_control(msg, channel) {
    console.warn('dnu_dispatch_control', msg.type, msg);
  }
}

MessageRouter.prototype.dispControlByType = Object.assign({}, dispControlByType);

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

class MessageChannel {
  sendRaw() {
    throw new Error(`Instance responsiblity`);
  }
  packRaw() {
    throw new Error(`Instance responsiblity`);
  }

  packAndSendRaw(...args) {
    return this.sendRaw(this.packRaw(...args));
  }

  sendJSON(msg_obj) {
    return this.sendRaw(this.packJSON(msg_obj));
  }
  packJSON(msg_obj) {
    if (undefined !== msg_obj.header) {
      msg_obj.header = JSON.stringify(msg_obj.header);
    }
    if (undefined !== msg_obj.body) {
      msg_obj.body = JSON.stringify(msg_obj.body);
    }
    return this.packRaw(msg_obj);
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

  undeliverable(msg, mode) {
    console.warn('undeliverable:', msg, mode);
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
    const self = this.asAPI(hub, router, packetParser.packMessage);
    return self;
  }

  static asInternalAPI(hub, router, packetParser) {
    const self = this.asAPI(hub, router, packetParser.packMessageObj);
    return self.bindChannel(null);
  }
}

function bindChannel(channel, sendRaw, props) {
  if (null == sendRaw) {
    sendRaw = bindDispatchMsgRaw(channel.router);
  } else if ('function' !== typeof sendRaw) {
    throw new TypeError(`Channel expects 'sendRaw' function parameter`);
  }

  const core_props = { sendRaw: { value: sendRaw } };
  props = null == props ? core_props : Object.assign(core_props, props);

  const self = Object.create(channel, props);
  return sendRaw.channel = self;
}

function bindDispatchMsgRaw(router) {
  const dispatch = router.dispatch;
  return dispatchMsgObj;

  function dispatchMsgObj(msg) {
    if (undefined === msg._raw_) {
      throw new TypeError(`Expected a parsed msg_obj with valid '_raw_' buffer property`);
    }
    dispatch([msg], dispatchMsgObj.channel);
    return true;
  }
}

function bindDispatchPackets(channel) {
  const dispatch = channel.router.dispatch;
  const feed = channel.hub.packetParser.packetStream();

  return function on_recv_data(data) {
    const msgList = feed(data);
    if (0 < msgList.length) {
      dispatch(msgList, channel);
    }
  };
}

var channel = Object.freeze({
	MessageChannel: MessageChannel,
	default: MessageChannel,
	bindChannel: bindChannel,
	bindDispatchMsgRaw: bindDispatchMsgRaw,
	bindDispatchPackets: bindDispatchPackets
});

class MessageHub$1 {
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
    return MessageChannel.asChannelAPI(this, router, packetParser);
  }
  _init_internalAPI(router, packetParser) {
    return MessageChannel.asInternalAPI(this, router, packetParser);
  }

  static plugin(...pluginFunctions) {
    return this.plugins(...pluginFunctions);
  }
  static plugins(...pluginFunctions) {
    const pluginList = [].concat(this.prototype.pluginList || [], pluginFunctions);

    pluginList.sort((a, b) => (0 | a.order) - (0 | b.order));

    const BaseHub = this._BaseHub_ || this;
    class MessageHub_PI extends BaseHub {}
    Object.defineProperties(MessageHub_PI.prototype, {
      pluginList: { value: Object.freeze(pluginList) } });
    Object.defineProperties(MessageHub_PI, {
      _BaseHub_: { value: BaseHub } });

    applyPlugins('subclass', pluginList, MessageHub_PI, { MessageRouter, MessageChannel });
    return MessageHub_PI;
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
exports['default'] = MessageHub$1;
exports.MessageHub = MessageHub$1;
exports.applyPlugins = applyPlugins;
exports.MessageRouter = MessageRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvY29udHJvbF9wcm90b2NvbC5qc3kiLCIuLi9jb2RlL3JvdXRlci5qc3kiLCIuLi9jb2RlL2NoYW5uZWwuanN5IiwiLi4vY29kZS9odWIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBkaXNwQ29udHJvbEJ5VHlwZSA9IEB7fVxuICBbMHhmMF06IHJlY3ZfaGVsbG9cbiAgWzB4ZjFdOiByZWN2X29sbGVoXG4gIFsweGZlXTogcmVjdl9wb25nXG4gIFsweGZmXTogcmVjdl9waW5nXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9oZWxsbyhjaGFubmVsKSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYwXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBjaGFubmVsLmh1Yi5pZF9yb3V0ZXJfc2VsZigpXG5cbmZ1bmN0aW9uIHJlY3ZfaGVsbG8ocm91dGVyLCBtc2csIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gbXNnLmhlYWRlcl9idWZmZXIoKVxuICBpZiAwICE9PSBlY19vdGhlcl9pZC5sZW5ndGggJiYgcm91dGVyLmVjX2lkX2htYWMgOjpcbiAgICBjb25zdCBobWFjX3NlY3JldCA9IHJvdXRlci5lY19pZF9obWFjXG4gICAgICA/IHJvdXRlci5lY19pZF9obWFjKGVjX290aGVyX2lkKSA6IG51bGxcbiAgICBzZW5kX29sbGVoIEAgY2hhbm5lbCwgaG1hY19zZWNyZXRcblxuICBlbHNlIDo6XG4gICAgY29uc3QgaWRfcm91dGVyID0gbXNnLnVucGFja0lkKG1zZy5ib2R5X2J1ZmZlcigpLCAwKVxuICAgIHJvdXRlci51bnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG5cblxuZnVuY3Rpb24gc2VuZF9vbGxlaChjaGFubmVsLCBobWFjX3NlY3JldCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMVxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogaG1hY19zZWNyZXRcblxuZnVuY3Rpb24gcmVjdl9vbGxlaChyb3V0ZXIsIG1zZywgY2hhbm5lbCkgOjpcbiAgY29uc3QgZWNfb3RoZXJfaWQgPSBtc2cuaGVhZGVyX2J1ZmZlcigpXG4gIGNvbnN0IGlkX3JvdXRlciA9IG1zZy51bnBhY2tJZChlY19vdGhlcl9pZClcblxuICBjb25zdCBobWFjX3NlY3JldCA9IHJvdXRlci5lY19pZF9obWFjXG4gICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCwgdHJ1ZSkgOiBudWxsXG4gIGNvbnN0IHBlZXJfaG1hY19jbGFpbSA9IG1zZy5ib2R5X2J1ZmZlcigpXG4gIGlmIGhtYWNfc2VjcmV0ICYmIDAgPT09IGhtYWNfc2VjcmV0LmNvbXBhcmUgQCBwZWVyX2htYWNfY2xhaW0gOjpcbiAgICByb3V0ZXIudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcbiAgZWxzZSA6OlxuICAgIHJvdXRlci51bnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9waW5ncG9uZyhjaGFubmVsLCBwb25nKSA6OlxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogcG9uZyA/IDB4ZmUgOiAweGZmXG4gICAgYm9keTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbmZ1bmN0aW9uIHJlY3ZfcG9uZyhyb3V0ZXIsIG1zZywgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgdHJ5IDo6XG4gICAgY29uc3QgcmVtb3RlID0gbmV3IERhdGUgQCBtc2cuYm9keV9idWZmZXIoKS50b1N0cmluZygpXG4gICAgY29uc3QgZGVsdGEgPSByZW1vdGUgLSBsb2NhbFxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBkZWx0YSwgcmVtb3RlLCBsb2NhbFxuICBjYXRjaCBlcnIgOjpcbiAgICBjaGFubmVsLnRzX3BvbmcgPSBAe30gbG9jYWxcblxuZnVuY3Rpb24gcmVjdl9waW5nKHJvdXRlciwgbXNnLCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICBzZW5kX3Bpbmdwb25nIEAgY2hhbm5lbCwgdHJ1ZVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgbXNnLmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGxvY2FsXG5cbiIsImltcG9ydCB7ZGlzcENvbnRyb2xCeVR5cGV9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cbmNvbnN0IGZpcnN0QW5zd2VyID0gYmluZFByb21pc2VGaXJzdFJlc3VsdCgpXG5cbmV4cG9ydCBjbGFzcyBNZXNzYWdlUm91dGVyIDo6XG4gIGNvbnN0cnVjdG9yKGlkX3NlbGYpIDo6XG4gICAgaWYgaWRfc2VsZiA6OlxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOiBpZF9zZWxmOiBAOiB2YWx1ZTogaWRfc2VsZlxuICAgICAgdGhpcy5faW5pdERpc3BhdGNoKClcblxuICAvLyAtLS0gRGlzcGF0Y2ggY29yZSAtLS1cblxuICBfaW5pdERpc3BhdGNoKCkgOjpcbiAgICBjb25zdCByb3V0ZXMgPSB0aGlzLl9jcmVhdGVSb3V0ZXNNYXAoKVxuICAgIHJvdXRlcy5zZXQgQCAwLCB0aGlzLmJpbmREaXNwYXRjaENvbnRyb2woKVxuICAgIGlmIG51bGwgIT0gdGhpcy5pZF9zZWxmIDo6XG4gICAgICByb3V0ZXMuc2V0IEAgdGhpcy5pZF9zZWxmLCB0aGlzLmJpbmREaXNwYXRjaFNlbGYoKVxuXG4gICAgY29uc3QgcHF1ZXVlID0gcHJvbWlzZVF1ZXVlKClcbiAgICBjb25zdCBkaXNwYXRjaF9vbmUgPSB0aGlzLmJpbmREaXNwYXRjaFJvdXRlKHJvdXRlcylcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOlxuICAgICAgcm91dGVzOiBAOiB2YWx1ZTogcm91dGVzXG4gICAgICBkaXNwYXRjaDogQDogdmFsdWU6IGRpc3BhdGNoXG5cbiAgICBmdW5jdGlvbiBkaXNwYXRjaChtc2dMaXN0LCBjaGFubmVsKSA6OlxuICAgICAgY29uc3QgcHEgPSBwcXVldWUoKSAvLyBwcSB3aWxsIGRpc3BhdGNoIGR1cmluZyBQcm9taXNlIHJlc29sdXRpb25zXG4gICAgICByZXR1cm4gbXNnTGlzdC5tYXAgQCBtc2cgPT5cbiAgICAgICAgcHEudGhlbiBAICgpID0+IGRpc3BhdGNoX29uZShtc2csIGNoYW5uZWwpXG5cbiAgb25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBtc2cpIDo6XG4gICAgY29uc29sZS5lcnJvciBAICdFcnJvciBkdXJpbmcgbXNnIGRpc3BhdGNoXFxuICBtc2c6JywgbXNnLCAnXFxuJywgZXJyLCAnXFxuJ1xuXG4gIF9jcmVhdGVSb3V0ZXNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIHJvdXRlIC0tLVxuXG4gIHJvdXRlRGlzY292ZXJ5ID0gW11cbiAgZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyLCBtc2cpIDo6XG4gICAgcmV0dXJuIGZpcnN0QW5zd2VyIEAgaWRfcm91dGVyLCB0aGlzLnJvdXRlRGlzY292ZXJ5XG5cbiAgYmluZERpc3BhdGNoUm91dGUocm91dGVzKSA6OlxuICAgIHJldHVybiBhc3luYyAobXNnLCBjaGFubmVsKSA9PiA6OlxuICAgICAgdHJ5IDo6XG4gICAgICAgIGNvbnN0IGlkX3JvdXRlciA9IG1zZy5pZF9yb3V0ZXJcbiAgICAgICAgbGV0IGRpc3BhdGNoX3JvdXRlID0gcm91dGVzLmdldChpZF9yb3V0ZXIpXG4gICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgICBkaXNwYXRjaF9yb3V0ZSA9IGF3YWl0IHRoaXMuZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUoaWRfcm91dGVyLCBtc2cpXG4gICAgICAgICAgaWYgbnVsbCA9PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgICAgcmV0dXJuIGNoYW5uZWwudW5kZWxpdmVyYWJsZShtc2csICdyb3V0ZScpXG4gICAgICAgICAgdGhpcy5yZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpXG5cbiAgICAgICAgaWYgZmFsc2UgPT09IGF3YWl0IGRpc3BhdGNoX3JvdXRlKG1zZywgY2hhbm5lbCkgOjpcbiAgICAgICAgICB0aGlzLnVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpXG4gICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgdGhpcy5vbl9lcnJvcl9pbl9kaXNwYXRjaChlcnIsIG1zZywgY2hhbm5lbClcblxuXG4gIHJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgIGlmIG51bGwgIT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnZGlzcGF0Y2hfcm91dGUnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgICBlbHNlIHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMucm91dGVzLmhhcyBAIGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiAwID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5pZF9zZWxmID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG5cbiAgICB0aGlzLnJvdXRlcy5zZXQgQCBpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlXG4gICAgcmV0dXJuIHRydWVcbiAgdW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcikgOjpcbiAgICByZXR1cm4gdGhpcy5yb3V0ZXMuZGVsZXRlIEAgaWRfcm91dGVyXG4gIHJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclJvdXRlIEAgaWRfcm91dGVyLCBtc2cgPT4gOjpcbiAgICAgIGlmIDAgIT09IG1zZy50dGwgOjogY2hhbm5lbC5zZW5kUmF3KG1zZylcbiAgdmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgdW52ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgaWYgdGhpcy5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgfHwgY2hhbm5lbC5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgOjpcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgICBlbHNlIGNvbnNvbGUud2FybiBAICdVbnZlcmlmaWVkIHBlZXIgcm91dGUgKGlnbm9yZWQpOicsIEA6IGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIGxvY2FsIHRhcmdldFxuXG4gIHRhcmdldERpc2NvdmVyeSA9IFtdXG4gIGRpc3BhdGNoX2Rpc2NvdmVyX3RhcmdldChpZF90YXJnZXQsIG1zZykgOjpcbiAgICByZXR1cm4gZmlyc3RBbnN3ZXIgQCBpZF90YXJnZXQsIHRoaXMudGFyZ2V0RGlzY292ZXJ5XG5cbiAgYmluZERpc3BhdGNoU2VsZihtc2cpIDo6XG4gICAgY29uc3QgZGlzcGF0Y2hTZWxmID0gYXN5bmMgKG1zZywgY2hhbm5lbCkgPT4gOjpcbiAgICAgIGNvbnN0IGlkX3RhcmdldCA9IG1zZy5pZF90YXJnZXRcbiAgICAgIGxldCB0YXJnZXQgPSB0aGlzLnRhcmdldHMuZ2V0KGlkX3RhcmdldClcbiAgICAgIGlmIHVuZGVmaW5lZCA9PT0gdGFyZ2V0IDo6XG4gICAgICAgIHRhcmdldCA9IGF3YWl0IHRoaXMuZGlzcGF0Y2hfZGlzY292ZXJfdGFyZ2V0KG1zZylcbiAgICAgICAgaWYgbnVsbCA9PSB0YXJnZXQgOjpcbiAgICAgICAgICByZXR1cm4gY2hhbm5lbC51bmRlbGl2ZXJhYmxlKG1zZywgJ3RhcmdldCcpXG4gICAgICAgIC8vdGhpcy5yZWdpc3RlclRhcmdldChpZF90YXJnZXQsIHRhcmdldClcblxuICAgICAgaWYgZmFsc2UgPT09IGF3YWl0IHRhcmdldChtc2csIHRoaXMpIDo6XG4gICAgICAgIHRoaXMudW5yZWdpc3RlclRhcmdldChpZF90YXJnZXQpXG5cbiAgICB0aGlzLmRpc3BhdGNoU2VsZiA9IGRpc3BhdGNoU2VsZlxuICAgIHJldHVybiBkaXNwYXRjaFNlbGZcblxuICBfY3JlYXRlVGFyZ2V0c01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcbiAgdGFyZ2V0cyA9IHRoaXMuX2NyZWF0ZVRhcmdldHNNYXAoKVxuICByZWdpc3RlclRhcmdldChpZF90YXJnZXQsIHRhcmdldCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgaWRfdGFyZ2V0ICYmIHVuZGVmaW5lZCA9PT0gdGFyZ2V0IDo6XG4gICAgICB0YXJnZXQgPSBpZF90YXJnZXRcbiAgICAgIGlkX3RhcmdldCA9IHRhcmdldC5pZF90YXJnZXQgfHwgdGFyZ2V0LmlkXG5cbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICd0YXJnZXQnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgaWYgISBOdW1iZXIuaXNTYWZlSW50ZWdlciBAIGlkX3RhcmdldCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnaWRfdGFyZ2V0JyB0byBiZSBhbiBpbnRlZ2VyYFxuICAgIGlmIHRoaXMudGFyZ2V0cy5oYXMgQCBpZF90YXJnZXQgOjpcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIHJldHVybiB0aGlzLnRhcmdldHMuc2V0IEAgaWRfdGFyZ2V0LCB0YXJnZXRcbiAgdW5yZWdpc3RlclRhcmdldChpZF90YXJnZXQpIDo6XG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5kZWxldGUgQCBpZF90YXJnZXRcblxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIGNvbnRyb2wgbWVzc2FnZXNcblxuICBiaW5kRGlzcGF0Y2hDb250cm9sKCkgOjpcbiAgICByZXR1cm4gKG1zZywgY2hhbm5lbCkgPT4gOjpcbiAgICAgIGlmIDAgIT09IG1zZy5pZF90YXJnZXQgOjogLy8gY29ubmVjdGlvbi1kaXNwYXRjaGVkXG4gICAgICAgIHJldHVybiB0aGlzLmRpc3BhdGNoU2VsZihtc2csIGNoYW5uZWwpXG5cbiAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLmRpc3BDb250cm9sQnlUeXBlW21zZy50eXBlXVxuICAgICAgaWYgdW5kZWZpbmVkICE9PSBoYW5kbGVyIDo6XG4gICAgICAgIHJldHVybiBoYW5kbGVyKHRoaXMsIG1zZywgY2hhbm5lbClcbiAgICAgIGVsc2UgOjpcbiAgICAgICAgcmV0dXJuIHRoaXMuZG51X2Rpc3BhdGNoX2NvbnRyb2wobXNnLCBjaGFubmVsKVxuXG4gIGRpc3BDb250cm9sQnlUeXBlID0gT2JqZWN0LmNyZWF0ZSBAIHRoaXMuZGlzcENvbnRyb2xCeVR5cGVcbiAgZG51X2Rpc3BhdGNoX2NvbnRyb2wobXNnLCBjaGFubmVsKSA6OlxuICAgIGNvbnNvbGUud2FybiBAICdkbnVfZGlzcGF0Y2hfY29udHJvbCcsIG1zZy50eXBlLCBtc2dcblxuXG5NZXNzYWdlUm91dGVyLnByb3RvdHlwZS5kaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5hc3NpZ24gQCB7fVxuICBkaXNwQ29udHJvbEJ5VHlwZVxuXG5leHBvcnQgZGVmYXVsdCBNZXNzYWdlUm91dGVyXG5cblxuZnVuY3Rpb24gcHJvbWlzZVF1ZXVlKCkgOjpcbiAgbGV0IHRpcCA9IG51bGxcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIDo6XG4gICAgaWYgbnVsbCA9PT0gdGlwIDo6XG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgdGlwLnRoZW4gQCBjbGVhcl90aXBcbiAgICByZXR1cm4gdGlwXG5cbiAgZnVuY3Rpb24gY2xlYXJfdGlwKCkgOjpcbiAgICB0aXAgPSBudWxsXG5cbmZ1bmN0aW9uIGJpbmRQcm9taXNlRmlyc3RSZXN1bHQob3B0aW9ucz17fSkgOjpcbiAgY29uc3Qgb25fZXJyb3IgPSBvcHRpb25zLm9uX2Vycm9yIHx8IGNvbnNvbGUuZXJyb3JcbiAgY29uc3QgaWZBYnNlbnQgPSBvcHRpb25zLmFic2VudCB8fCBudWxsXG5cbiAgcmV0dXJuICh0aXAsIGxzdEZucykgPT5cbiAgICBuZXcgUHJvbWlzZSBAIHJlc29sdmUgPT46OlxuICAgICAgdGlwID0gUHJvbWlzZS5yZXNvbHZlKHRpcClcbiAgICAgIFByb21pc2UuYWxsIEBcbiAgICAgICAgQXJyYXkuZnJvbSBAIGxzdEZucywgZm4gPT5cbiAgICAgICAgICB0aXAudGhlbihmbikudGhlbihyZXNvbHZlLCBvbl9lcnJvcilcbiAgICAgIC50aGVuIEAgYWJzZW50LCBhYnNlbnRcblxuICAgICAgZnVuY3Rpb24gYWJzZW50KCkgOjpcbiAgICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGlmQWJzZW50IDo6XG4gICAgICAgICAgcmVzb2x2ZSBAIGlmQWJzZW50KClcbiAgICAgICAgZWxzZSByZXNvbHZlIEAgaWZBYnNlbnRcbiIsImltcG9ydCB7c2VuZF9oZWxsbywgc2VuZF9waW5ncG9uZ30gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuXG5leHBvcnQgY2xhc3MgTWVzc2FnZUNoYW5uZWwgOjpcbiAgc2VuZFJhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuICBwYWNrUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG5cbiAgcGFja0FuZFNlbmRSYXcoLi4uYXJncykgOjpcbiAgICByZXR1cm4gdGhpcy5zZW5kUmF3IEAgdGhpcy5wYWNrUmF3IEAgLi4uYXJnc1xuXG4gIHNlbmRKU09OKG1zZ19vYmopIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja0pTT04gQCBtc2dfb2JqXG4gIHBhY2tKU09OKG1zZ19vYmopIDo6XG4gICAgaWYgdW5kZWZpbmVkICE9PSBtc2dfb2JqLmhlYWRlciA6OlxuICAgICAgbXNnX29iai5oZWFkZXIgPSBKU09OLnN0cmluZ2lmeSBAIG1zZ19vYmouaGVhZGVyXG4gICAgaWYgdW5kZWZpbmVkICE9PSBtc2dfb2JqLmJvZHkgOjpcbiAgICAgIG1zZ19vYmouYm9keSA9IEpTT04uc3RyaW5naWZ5IEAgbXNnX29iai5ib2R5XG4gICAgcmV0dXJuIHRoaXMucGFja1Jhdyhtc2dfb2JqKVxuXG5cbiAgLy8gLS0tIENvbnRyb2wgbWVzc2FnZSB1dGlsaXRpZXNcblxuICBzZW5kUm91dGluZ0hhbmRzaGFrZSgpIDo6XG4gICAgcmV0dXJuIHNlbmRfaGVsbG8odGhpcywgdGhpcy5yb3V0ZXIuZWNfcHViX2lkKVxuICBzZW5kUGluZygpIDo6XG4gICAgcmV0dXJuIHNlbmRfcGluZ3BvbmcodGhpcylcblxuXG4gIGNsb25lKHByb3BzLCAuLi5leHRyYSkgOjpcbiAgICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSh0aGlzLCBwcm9wcylcbiAgICByZXR1cm4gMCA9PT0gZXh0cmEubGVuZ3RoID8gc2VsZiA6IE9iamVjdC5hc3NpZ24oc2VsZiwgLi4uZXh0cmEpXG4gIGJpbmRDaGFubmVsKHNlbmRSYXcsIHByb3BzKSA6OiByZXR1cm4gYmluZENoYW5uZWwodGhpcywgc2VuZFJhdywgcHJvcHMpXG4gIGJpbmREaXNwYXRjaFBhY2tldHMoKSA6OiByZXR1cm4gYmluZERpc3BhdGNoUGFja2V0cyh0aGlzKVxuXG4gIHVuZGVsaXZlcmFibGUobXNnLCBtb2RlKSA6OlxuICAgIGNvbnNvbGUud2FybiBAICd1bmRlbGl2ZXJhYmxlOicsIG1zZywgbW9kZVxuXG4gIHN0YXRpYyBhc0FQSShodWIsIHJvdXRlciwgcGFja1JhdykgOjpcbiAgICBjb25zdCBzZWxmID0gbmV3IHRoaXMoKVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgc2VsZiwgQDpcbiAgICAgIHBhY2tSYXc6IEA6IHZhbHVlOiBwYWNrUmF3XG4gICAgICByb3V0ZXI6IEA6IHZhbHVlOiByb3V0ZXJcbiAgICAgIGh1YjogQDogdmFsdWU6IGh1YlxuICAgICAgX3Jvb3RfOiBAOiB2YWx1ZTogc2VsZlxuICAgIHJldHVybiBzZWxmXG5cbiAgc3RhdGljIGFzQ2hhbm5lbEFQSShodWIsIHJvdXRlciwgcGFja2V0UGFyc2VyKSA6OlxuICAgIGNvbnN0IHNlbGYgPSB0aGlzLmFzQVBJIEAgaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlci5wYWNrTWVzc2FnZVxuICAgIHJldHVybiBzZWxmXG5cbiAgc3RhdGljIGFzSW50ZXJuYWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja01lc3NhZ2VPYmpcbiAgICByZXR1cm4gc2VsZi5iaW5kQ2hhbm5lbChudWxsKVxuXG5leHBvcnQgZGVmYXVsdCBNZXNzYWdlQ2hhbm5lbFxuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRDaGFubmVsKGNoYW5uZWwsIHNlbmRSYXcsIHByb3BzKSA6OlxuICBpZiBudWxsID09IHNlbmRSYXcgOjpcbiAgICBzZW5kUmF3ID0gYmluZERpc3BhdGNoTXNnUmF3KGNoYW5uZWwucm91dGVyKVxuICBlbHNlIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBzZW5kUmF3IDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBDaGFubmVsIGV4cGVjdHMgJ3NlbmRSYXcnIGZ1bmN0aW9uIHBhcmFtZXRlcmBcblxuICBjb25zdCBjb3JlX3Byb3BzID0gQDogc2VuZFJhdzogQHt9IHZhbHVlOiBzZW5kUmF3XG4gIHByb3BzID0gbnVsbCA9PSBwcm9wcyA/IGNvcmVfcHJvcHMgOiBPYmplY3QuYXNzaWduIEAgY29yZV9wcm9wcywgcHJvcHNcblxuICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSBAIGNoYW5uZWwsIHByb3BzXG4gIHJldHVybiBzZW5kUmF3LmNoYW5uZWwgPSBzZWxmXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaE1zZ1Jhdyhyb3V0ZXIpIDo6XG4gIGNvbnN0IGRpc3BhdGNoID0gcm91dGVyLmRpc3BhdGNoXG4gIHJldHVybiBkaXNwYXRjaE1zZ09ialxuXG4gIGZ1bmN0aW9uIGRpc3BhdGNoTXNnT2JqKG1zZykgOjpcbiAgICBpZiB1bmRlZmluZWQgPT09IG1zZy5fcmF3XyA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCBhIHBhcnNlZCBtc2dfb2JqIHdpdGggdmFsaWQgJ19yYXdfJyBidWZmZXIgcHJvcGVydHlgXG4gICAgZGlzcGF0Y2ggQCBbbXNnXSwgZGlzcGF0Y2hNc2dPYmouY2hhbm5lbFxuICAgIHJldHVybiB0cnVlXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaFBhY2tldHMoY2hhbm5lbCkgOjpcbiAgY29uc3QgZGlzcGF0Y2ggPSBjaGFubmVsLnJvdXRlci5kaXNwYXRjaFxuICBjb25zdCBmZWVkID0gY2hhbm5lbC5odWIucGFja2V0UGFyc2VyLnBhY2tldFN0cmVhbSgpXG5cbiAgcmV0dXJuIGZ1bmN0aW9uIG9uX3JlY3ZfZGF0YShkYXRhKSA6OlxuICAgIGNvbnN0IG1zZ0xpc3QgPSBmZWVkKGRhdGEpXG4gICAgaWYgMCA8IG1zZ0xpc3QubGVuZ3RoIDo6XG4gICAgICBkaXNwYXRjaCBAIG1zZ0xpc3QsIGNoYW5uZWxcbiIsImltcG9ydCB7TWVzc2FnZVJvdXRlcn0gZnJvbSAnLi9yb3V0ZXIuanN5J1xuaW1wb3J0IHtNZXNzYWdlQ2hhbm5lbH0gZnJvbSAnLi9jaGFubmVsLmpzeSdcblxuZXhwb3J0IGNsYXNzIE1lc3NhZ2VIdWIgOjpcbiAgY29uc3RydWN0b3IoKSA6OlxuICAgIGFwcGx5UGx1Z2lucyBAICdwcmUnLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcblxuICAgIGNvbnN0IHBhY2tldFBhcnNlciA9IHRoaXMucGFja2V0UGFyc2VyXG4gICAgaWYgbnVsbD09cGFja2V0UGFyc2VyIHx8ICEgcGFja2V0UGFyc2VyLmlzUGFja2V0UGFyc2VyKCkgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgSW52YWxpZCBodWIucGFja2V0UGFyc2VyYFxuXG4gICAgY29uc3Qgcm91dGVyID0gdGhpcy5faW5pdF9yb3V0ZXIoKVxuICAgIGNvbnN0IF9hcGlfY2hhbm5lbCA9IHRoaXMuX2luaXRfY2hhbm5lbEFQSShyb3V0ZXIsIHBhY2tldFBhcnNlcilcbiAgICBjb25zdCBfYXBpX2ludGVybmFsID0gdGhpcy5faW5pdF9pbnRlcm5hbEFQSShyb3V0ZXIsIHBhY2tldFBhcnNlcilcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEB7fVxuICAgICAgcm91dGVyOiBAe30gdmFsdWU6IHJvdXRlclxuICAgICAgcGFja2V0UGFyc2VyOiBAe30gdmFsdWU6IHBhY2tldFBhcnNlclxuICAgICAgX2FwaV9jaGFubmVsOiBAe30gdmFsdWU6IF9hcGlfY2hhbm5lbFxuICAgICAgX2FwaV9pbnRlcm5hbDogQHt9IHZhbHVlOiBfYXBpX2ludGVybmFsXG5cbiAgICBhcHBseVBsdWdpbnMgQCBudWxsLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICBhcHBseVBsdWdpbnMgQCAncG9zdCcsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIHJldHVybiB0aGlzXG5cbiAgX2luaXRfcm91dGVyKCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYFBsdWdpbiByZXNwb25zaWJsaXR5YFxuXG4gIF9pbml0X2NoYW5uZWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIE1lc3NhZ2VDaGFubmVsLmFzQ2hhbm5lbEFQSSBAXG4gICAgICB0aGlzLCByb3V0ZXIsIHBhY2tldFBhcnNlclxuICBfaW5pdF9pbnRlcm5hbEFQSShyb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gTWVzc2FnZUNoYW5uZWwuYXNJbnRlcm5hbEFQSSBAXG4gICAgICB0aGlzLCByb3V0ZXIsIHBhY2tldFBhcnNlclxuXG5cbiAgc3RhdGljIHBsdWdpbiguLi5wbHVnaW5GdW5jdGlvbnMpIDo6XG4gICAgcmV0dXJuIHRoaXMucGx1Z2lucyguLi5wbHVnaW5GdW5jdGlvbnMpXG4gIHN0YXRpYyBwbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICBjb25zdCBwbHVnaW5MaXN0ID0gW10uY29uY2F0IEBcbiAgICAgIHRoaXMucHJvdG90eXBlLnBsdWdpbkxpc3QgfHwgW11cbiAgICAgIHBsdWdpbkZ1bmN0aW9uc1xuXG4gICAgcGx1Z2luTGlzdC5zb3J0IEAgKGEsIGIpID0+ICgwIHwgYS5vcmRlcikgLSAoMCB8IGIub3JkZXIpXG5cbiAgICBjb25zdCBCYXNlSHViID0gdGhpcy5fQmFzZUh1Yl8gfHwgdGhpc1xuICAgIGNsYXNzIE1lc3NhZ2VIdWJfUEkgZXh0ZW5kcyBCYXNlSHViIDo6XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBNZXNzYWdlSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBsdWdpbkxpc3Q6IEB7fSB2YWx1ZTogT2JqZWN0LmZyZWV6ZSBAIHBsdWdpbkxpc3RcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIE1lc3NhZ2VIdWJfUEksIEA6XG4gICAgICBfQmFzZUh1Yl86IEB7fSB2YWx1ZTogQmFzZUh1YlxuXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3N1YmNsYXNzJywgcGx1Z2luTGlzdCwgTWVzc2FnZUh1Yl9QSSwgQDogTWVzc2FnZVJvdXRlciwgTWVzc2FnZUNoYW5uZWxcbiAgICByZXR1cm4gTWVzc2FnZUh1Yl9QSVxuXG5cbiAgZ2V0IGlkX3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGlkX3JvdXRlcl9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5wYWNrZXRQYXJzZXIucGFja0lkIEBcbiAgICAgIHRoaXMucm91dGVyLmlkX3NlbGZcbiAgY29ubmVjdF9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5fYXBpX2ludGVybmFsLmNsb25lKClcblxuICBjb25uZWN0KGNvbm5fdXJsKSA6OlxuICAgIGlmIG51bGwgPT0gY29ubl91cmwgOjpcbiAgICAgIHJldHVybiB0aGlzLmNvbm5lY3Rfc2VsZigpXG5cbiAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGNvbm5fdXJsIDo6XG4gICAgICBjb25uX3VybCA9IHRoaXMuX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybClcblxuICAgIGNvbnN0IGNvbm5lY3QgPSB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFtjb25uX3VybC5wcm90b2NvbF1cbiAgICBpZiAhIGNvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBFcnJvciBAIGBDb25uZWN0aW9uIHByb3RvY29sIFwiJHtjb25uX3VybC5wcm90b2NvbH1cIiBub3QgcmVnaXN0ZXJlZCBmb3IgXCIke2Nvbm5fdXJsLnRvU3RyaW5nKCl9XCJgXG5cbiAgICByZXR1cm4gY29ubmVjdChjb25uX3VybClcblxuICByZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbChwcm90b2NvbCwgY2JfY29ubmVjdCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2JfY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnY2JfY29ubmVjdCcgZnVuY3Rpb25gXG4gICAgY29uc3QgYnlQcm90b2NvbCA9IE9iamVjdC5hc3NpZ24gQCB7fSwgdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xcbiAgICBieVByb3RvY29sW3Byb3RvY29sXSA9IGNiX2Nvbm5lY3RcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgdGhpcywgJ19jb25uZWN0QnlQcm90b2NvbCcsXG4gICAgICBAOiB2YWx1ZTogYnlQcm90b2NvbCwgY29uZmlndXJhYmxlOiB0cnVlXG5cbiAgX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybCkgOjpcbiAgICByZXR1cm4gbmV3IFVSTChjb25uX3VybClcblxuZXhwb3J0IGRlZmF1bHQgTWVzc2FnZUh1YlxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlQbHVnaW5zKGtleSwgcGx1Z2luTGlzdCwgLi4uYXJncykgOjpcbiAgaWYgISBrZXkgOjoga2V5ID0gbnVsbFxuICBmb3IgbGV0IHBsdWdpbiBvZiBwbHVnaW5MaXN0IDo6XG4gICAgaWYgbnVsbCAhPT0ga2V5IDo6IHBsdWdpbiA9IHBsdWdpbltrZXldXG4gICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIHBsdWdpbiA6OlxuICAgICAgcGx1Z2luKC4uLmFyZ3MpXG4iXSwibmFtZXMiOlsiZGlzcENvbnRyb2xCeVR5cGUiLCJyZWN2X2hlbGxvIiwicmVjdl9vbGxlaCIsInJlY3ZfcG9uZyIsInJlY3ZfcGluZyIsInNlbmRfaGVsbG8iLCJjaGFubmVsIiwiZWNfcHViX2lkIiwicm91dGVyIiwicGFja0FuZFNlbmRSYXciLCJ0eXBlIiwiaHViIiwiaWRfcm91dGVyX3NlbGYiLCJtc2ciLCJlY19vdGhlcl9pZCIsImhlYWRlcl9idWZmZXIiLCJsZW5ndGgiLCJlY19pZF9obWFjIiwiaG1hY19zZWNyZXQiLCJpZF9yb3V0ZXIiLCJ1bnBhY2tJZCIsImJvZHlfYnVmZmVyIiwidW52ZXJpZmllZFBlZXJSb3V0ZSIsInNlbmRfb2xsZWgiLCJwZWVyX2htYWNfY2xhaW0iLCJjb21wYXJlIiwidmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX3Bpbmdwb25nIiwicG9uZyIsIkRhdGUiLCJ0b0lTT1N0cmluZyIsImxvY2FsIiwicmVtb3RlIiwidG9TdHJpbmciLCJkZWx0YSIsInRzX3BvbmciLCJlcnIiLCJ0c19waW5nIiwiZmlyc3RBbnN3ZXIiLCJiaW5kUHJvbWlzZUZpcnN0UmVzdWx0IiwiTWVzc2FnZVJvdXRlciIsImlkX3NlbGYiLCJyb3V0ZURpc2NvdmVyeSIsInRhcmdldERpc2NvdmVyeSIsInRhcmdldHMiLCJfY3JlYXRlVGFyZ2V0c01hcCIsIk9iamVjdCIsImNyZWF0ZSIsImRlZmluZVByb3BlcnRpZXMiLCJ2YWx1ZSIsIl9pbml0RGlzcGF0Y2giLCJyb3V0ZXMiLCJfY3JlYXRlUm91dGVzTWFwIiwic2V0IiwiYmluZERpc3BhdGNoQ29udHJvbCIsImJpbmREaXNwYXRjaFNlbGYiLCJwcXVldWUiLCJwcm9taXNlUXVldWUiLCJkaXNwYXRjaF9vbmUiLCJiaW5kRGlzcGF0Y2hSb3V0ZSIsImRpc3BhdGNoIiwibXNnTGlzdCIsInBxIiwibWFwIiwidGhlbiIsImVycm9yIiwiTWFwIiwiZGlzcGF0Y2hfcm91dGUiLCJnZXQiLCJ1bmRlZmluZWQiLCJkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZSIsInVuZGVsaXZlcmFibGUiLCJyZWdpc3RlclJvdXRlIiwidW5yZWdpc3RlclJvdXRlIiwib25fZXJyb3JfaW5fZGlzcGF0Y2giLCJUeXBlRXJyb3IiLCJoYXMiLCJkZWxldGUiLCJ0dGwiLCJzZW5kUmF3IiwicmVnaXN0ZXJQZWVyUm91dGUiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJjb25zb2xlIiwid2FybiIsImlkX3RhcmdldCIsImRpc3BhdGNoU2VsZiIsInRhcmdldCIsImRpc3BhdGNoX2Rpc2NvdmVyX3RhcmdldCIsInVucmVnaXN0ZXJUYXJnZXQiLCJpZCIsIk51bWJlciIsImlzU2FmZUludGVnZXIiLCJoYW5kbGVyIiwiZG51X2Rpc3BhdGNoX2NvbnRyb2wiLCJwcm90b3R5cGUiLCJhc3NpZ24iLCJ0aXAiLCJQcm9taXNlIiwicmVzb2x2ZSIsImNsZWFyX3RpcCIsIm9wdGlvbnMiLCJvbl9lcnJvciIsImlmQWJzZW50IiwiYWJzZW50IiwibHN0Rm5zIiwiYWxsIiwiQXJyYXkiLCJmcm9tIiwiZm4iLCJNZXNzYWdlQ2hhbm5lbCIsIkVycm9yIiwiYXJncyIsInBhY2tSYXciLCJtc2dfb2JqIiwicGFja0pTT04iLCJoZWFkZXIiLCJKU09OIiwic3RyaW5naWZ5IiwiYm9keSIsInByb3BzIiwiZXh0cmEiLCJzZWxmIiwiYmluZENoYW5uZWwiLCJiaW5kRGlzcGF0Y2hQYWNrZXRzIiwibW9kZSIsImFzQVBJIiwiYXNDaGFubmVsQVBJIiwicGFja2V0UGFyc2VyIiwicGFja01lc3NhZ2UiLCJhc0ludGVybmFsQVBJIiwicGFja01lc3NhZ2VPYmoiLCJiaW5kRGlzcGF0Y2hNc2dSYXciLCJjb3JlX3Byb3BzIiwiZGlzcGF0Y2hNc2dPYmoiLCJfcmF3XyIsImZlZWQiLCJwYWNrZXRTdHJlYW0iLCJvbl9yZWN2X2RhdGEiLCJkYXRhIiwiTWVzc2FnZUh1YiIsInBsdWdpbkxpc3QiLCJpc1BhY2tldFBhcnNlciIsIl9pbml0X3JvdXRlciIsIl9hcGlfY2hhbm5lbCIsIl9pbml0X2NoYW5uZWxBUEkiLCJfYXBpX2ludGVybmFsIiwiX2luaXRfaW50ZXJuYWxBUEkiLCJwbHVnaW4iLCJwbHVnaW5GdW5jdGlvbnMiLCJwbHVnaW5zIiwiY29uY2F0Iiwic29ydCIsImEiLCJiIiwib3JkZXIiLCJCYXNlSHViIiwiX0Jhc2VIdWJfIiwiTWVzc2FnZUh1Yl9QSSIsImZyZWV6ZSIsInBhY2tJZCIsImNsb25lIiwiY29ubl91cmwiLCJjb25uZWN0X3NlbGYiLCJfcGFyc2VDb25uZWN0VVJMIiwiY29ubmVjdCIsIl9jb25uZWN0QnlQcm90b2NvbCIsInByb3RvY29sIiwiY2JfY29ubmVjdCIsImJ5UHJvdG9jb2wiLCJkZWZpbmVQcm9wZXJ0eSIsImNvbmZpZ3VyYWJsZSIsIlVSTCIsImFwcGx5UGx1Z2lucyIsImtleSJdLCJtYXBwaW5ncyI6Ijs7OztBQUFPLE1BQU1BLG9CQUFvQjtHQUM5QixJQUFELEdBQVFDLFVBRHVCO0dBRTlCLElBQUQsR0FBUUMsVUFGdUI7R0FHOUIsSUFBRCxHQUFRQyxTQUh1QjtHQUk5QixJQUFELEdBQVFDLFNBSnVCLEVBQTFCOztBQVFQLEFBQU8sU0FBU0MsVUFBVCxDQUFvQkMsT0FBcEIsRUFBNkI7UUFDNUIsRUFBQ0MsU0FBRCxLQUFjRCxRQUFRRSxNQUE1QjtTQUNPRixRQUFRRyxjQUFSLENBQXlCO2VBQ25CLENBRG1CLEVBQ2hCQyxNQUFNLElBRFU7WUFFdEJILFNBRnNCO1VBR3hCRCxRQUFRSyxHQUFSLENBQVlDLGNBQVosRUFId0IsRUFBekIsQ0FBUDs7O0FBS0YsU0FBU1gsVUFBVCxDQUFvQk8sTUFBcEIsRUFBNEJLLEdBQTVCLEVBQWlDUCxPQUFqQyxFQUEwQztRQUNsQ1EsY0FBY0QsSUFBSUUsYUFBSixFQUFwQjtNQUNHLE1BQU1ELFlBQVlFLE1BQWxCLElBQTRCUixPQUFPUyxVQUF0QyxFQUFtRDtVQUMzQ0MsY0FBY1YsT0FBT1MsVUFBUCxHQUNoQlQsT0FBT1MsVUFBUCxDQUFrQkgsV0FBbEIsQ0FEZ0IsR0FDaUIsSUFEckM7ZUFFYVIsT0FBYixFQUFzQlksV0FBdEI7R0FIRixNQUtLO1VBQ0dDLFlBQVlOLElBQUlPLFFBQUosQ0FBYVAsSUFBSVEsV0FBSixFQUFiLEVBQWdDLENBQWhDLENBQWxCO1dBQ09DLG1CQUFQLENBQTZCSCxTQUE3QixFQUF3Q2IsT0FBeEM7Ozs7QUFHSixTQUFTaUIsVUFBVCxDQUFvQmpCLE9BQXBCLEVBQTZCWSxXQUE3QixFQUEwQztRQUNsQyxFQUFDWCxTQUFELEtBQWNELFFBQVFFLE1BQTVCO1NBQ09GLFFBQVFHLGNBQVIsQ0FBeUI7ZUFDbkIsQ0FEbUIsRUFDaEJDLE1BQU0sSUFE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
