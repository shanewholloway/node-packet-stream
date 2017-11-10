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

export { channel, control_protocol, MessageHub$1 as MessageHub, applyPlugins, MessageRouter };
export default MessageHub$1;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgubWpzIiwic291cmNlcyI6WyIuLi9jb2RlL2NvbnRyb2xfcHJvdG9jb2wuanN5IiwiLi4vY29kZS9yb3V0ZXIuanN5IiwiLi4vY29kZS9jaGFubmVsLmpzeSIsIi4uL2NvZGUvaHViLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY29uc3QgZGlzcENvbnRyb2xCeVR5cGUgPSBAe31cbiAgWzB4ZjBdOiByZWN2X2hlbGxvXG4gIFsweGYxXTogcmVjdl9vbGxlaFxuICBbMHhmZV06IHJlY3ZfcG9uZ1xuICBbMHhmZl06IHJlY3ZfcGluZ1xuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfaGVsbG8oY2hhbm5lbCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKHJvdXRlciwgbXNnLCBjaGFubmVsKSA6OlxuICBjb25zdCBlY19vdGhlcl9pZCA9IG1zZy5oZWFkZXJfYnVmZmVyKClcbiAgaWYgMCAhPT0gZWNfb3RoZXJfaWQubGVuZ3RoICYmIHJvdXRlci5lY19pZF9obWFjIDo6XG4gICAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgICAgPyByb3V0ZXIuZWNfaWRfaG1hYyhlY19vdGhlcl9pZCkgOiBudWxsXG4gICAgc2VuZF9vbGxlaCBAIGNoYW5uZWwsIGhtYWNfc2VjcmV0XG5cbiAgZWxzZSA6OlxuICAgIGNvbnN0IGlkX3JvdXRlciA9IG1zZy51bnBhY2tJZChtc2cuYm9keV9idWZmZXIoKSwgMClcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbmZ1bmN0aW9uIHNlbmRfb2xsZWgoY2hhbm5lbCwgaG1hY19zZWNyZXQpIDo6XG4gIGNvbnN0IHtlY19wdWJfaWR9ID0gY2hhbm5lbC5yb3V0ZXJcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IDB4ZjFcbiAgICBoZWFkZXI6IGVjX3B1Yl9pZFxuICAgIGJvZHk6IGhtYWNfc2VjcmV0XG5cbmZ1bmN0aW9uIHJlY3Zfb2xsZWgocm91dGVyLCBtc2csIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gbXNnLmhlYWRlcl9idWZmZXIoKVxuICBjb25zdCBpZF9yb3V0ZXIgPSBtc2cudW5wYWNrSWQoZWNfb3RoZXJfaWQpXG5cbiAgY29uc3QgaG1hY19zZWNyZXQgPSByb3V0ZXIuZWNfaWRfaG1hY1xuICAgID8gcm91dGVyLmVjX2lkX2htYWMoZWNfb3RoZXJfaWQsIHRydWUpIDogbnVsbFxuICBjb25zdCBwZWVyX2htYWNfY2xhaW0gPSBtc2cuYm9keV9idWZmZXIoKVxuICBpZiBobWFjX3NlY3JldCAmJiAwID09PSBobWFjX3NlY3JldC5jb21wYXJlIEAgcGVlcl9obWFjX2NsYWltIDo6XG4gICAgcm91dGVyLnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG4gIGVsc2UgOjpcbiAgICByb3V0ZXIudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfcGluZ3BvbmcoY2hhbm5lbCwgcG9uZykgOjpcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IHBvbmcgPyAweGZlIDogMHhmZlxuICAgIGJvZHk6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG5mdW5jdGlvbiByZWN2X3Bvbmcocm91dGVyLCBtc2csIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGxvY2FsID0gbmV3IERhdGUoKVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgbXNnLmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BvbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGxvY2FsXG5cbmZ1bmN0aW9uIHJlY3ZfcGluZyhyb3V0ZXIsIG1zZywgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgc2VuZF9waW5ncG9uZyBAIGNoYW5uZWwsIHRydWVcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIG1zZy5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBsb2NhbFxuXG4iLCJpbXBvcnQge2Rpc3BDb250cm9sQnlUeXBlfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5jb25zdCBmaXJzdEFuc3dlciA9IGJpbmRQcm9taXNlRmlyc3RSZXN1bHQoKVxuXG5leHBvcnQgY2xhc3MgTWVzc2FnZVJvdXRlciA6OlxuICBjb25zdHJ1Y3RvcihpZF9zZWxmKSA6OlxuICAgIGlmIGlkX3NlbGYgOjpcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDogaWRfc2VsZjogQDogdmFsdWU6IGlkX3NlbGZcbiAgICAgIHRoaXMuX2luaXREaXNwYXRjaCgpXG5cbiAgLy8gLS0tIERpc3BhdGNoIGNvcmUgLS0tXG5cbiAgX2luaXREaXNwYXRjaCgpIDo6XG4gICAgY29uc3Qgcm91dGVzID0gdGhpcy5fY3JlYXRlUm91dGVzTWFwKClcbiAgICByb3V0ZXMuc2V0IEAgMCwgdGhpcy5iaW5kRGlzcGF0Y2hDb250cm9sKClcbiAgICBpZiBudWxsICE9IHRoaXMuaWRfc2VsZiA6OlxuICAgICAgcm91dGVzLnNldCBAIHRoaXMuaWRfc2VsZiwgdGhpcy5iaW5kRGlzcGF0Y2hTZWxmKClcblxuICAgIGNvbnN0IHBxdWV1ZSA9IHByb21pc2VRdWV1ZSgpXG4gICAgY29uc3QgZGlzcGF0Y2hfb25lID0gdGhpcy5iaW5kRGlzcGF0Y2hSb3V0ZShyb3V0ZXMpXG4gICAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDpcbiAgICAgIHJvdXRlczogQDogdmFsdWU6IHJvdXRlc1xuICAgICAgZGlzcGF0Y2g6IEA6IHZhbHVlOiBkaXNwYXRjaFxuXG4gICAgZnVuY3Rpb24gZGlzcGF0Y2gobXNnTGlzdCwgY2hhbm5lbCkgOjpcbiAgICAgIGNvbnN0IHBxID0gcHF1ZXVlKCkgLy8gcHEgd2lsbCBkaXNwYXRjaCBkdXJpbmcgUHJvbWlzZSByZXNvbHV0aW9uc1xuICAgICAgcmV0dXJuIG1zZ0xpc3QubWFwIEAgbXNnID0+XG4gICAgICAgIHBxLnRoZW4gQCAoKSA9PiBkaXNwYXRjaF9vbmUobXNnLCBjaGFubmVsKVxuXG4gIG9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgbXNnKSA6OlxuICAgIGNvbnNvbGUuZXJyb3IgQCAnRXJyb3IgZHVyaW5nIG1zZyBkaXNwYXRjaFxcbiAgbXNnOicsIG1zZywgJ1xcbicsIGVyciwgJ1xcbidcblxuICBfY3JlYXRlUm91dGVzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byByb3V0ZSAtLS1cblxuICByb3V0ZURpc2NvdmVyeSA9IFtdXG4gIGRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlciwgbXNnKSA6OlxuICAgIHJldHVybiBmaXJzdEFuc3dlciBAIGlkX3JvdXRlciwgdGhpcy5yb3V0ZURpc2NvdmVyeVxuXG4gIGJpbmREaXNwYXRjaFJvdXRlKHJvdXRlcykgOjpcbiAgICByZXR1cm4gYXN5bmMgKG1zZywgY2hhbm5lbCkgPT4gOjpcbiAgICAgIHRyeSA6OlxuICAgICAgICBjb25zdCBpZF9yb3V0ZXIgPSBtc2cuaWRfcm91dGVyXG4gICAgICAgIGxldCBkaXNwYXRjaF9yb3V0ZSA9IHJvdXRlcy5nZXQoaWRfcm91dGVyKVxuICAgICAgICBpZiB1bmRlZmluZWQgPT09IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgICAgZGlzcGF0Y2hfcm91dGUgPSBhd2FpdCB0aGlzLmRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlciwgbXNnKVxuICAgICAgICAgIGlmIG51bGwgPT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgICAgIHJldHVybiBjaGFubmVsLnVuZGVsaXZlcmFibGUobXNnLCAncm91dGUnKVxuICAgICAgICAgIHRoaXMucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlKVxuXG4gICAgICAgIGlmIGZhbHNlID09PSBhd2FpdCBkaXNwYXRjaF9yb3V0ZShtc2csIGNoYW5uZWwpIDo6XG4gICAgICAgICAgdGhpcy51bnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHRoaXMub25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBtc2csIGNoYW5uZWwpXG5cblxuICByZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICBpZiBudWxsICE9IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2Rpc3BhdGNoX3JvdXRlJyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgICAgZWxzZSByZXR1cm4gZmFsc2VcbiAgICBpZiB0aGlzLnJvdXRlcy5oYXMgQCBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgMCA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMuaWRfc2VsZiA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuXG4gICAgdGhpcy5yb3V0ZXMuc2V0IEAgaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZVxuICAgIHJldHVybiB0cnVlXG4gIHVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpIDo6XG4gICAgcmV0dXJuIHRoaXMucm91dGVzLmRlbGV0ZSBAIGlkX3JvdXRlclxuICByZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJSb3V0ZSBAIGlkX3JvdXRlciwgbXNnID0+IDo6XG4gICAgICBpZiAwICE9PSBtc2cudHRsIDo6IGNoYW5uZWwuc2VuZFJhdyhtc2cpXG4gIHZlcmlmaWVkUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gIHVudmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIGlmIHRoaXMuYWxsb3dVbnZlcmlmaWVkUm91dGVzIHx8IGNoYW5uZWwuYWxsb3dVbnZlcmlmaWVkUm91dGVzIDo6XG4gICAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gICAgZWxzZSBjb25zb2xlLndhcm4gQCAnVW52ZXJpZmllZCBwZWVyIHJvdXRlIChpZ25vcmVkKTonLCBAOiBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byBsb2NhbCB0YXJnZXRcblxuICB0YXJnZXREaXNjb3ZlcnkgPSBbXVxuICBkaXNwYXRjaF9kaXNjb3Zlcl90YXJnZXQoaWRfdGFyZ2V0LCBtc2cpIDo6XG4gICAgcmV0dXJuIGZpcnN0QW5zd2VyIEAgaWRfdGFyZ2V0LCB0aGlzLnRhcmdldERpc2NvdmVyeVxuXG4gIGJpbmREaXNwYXRjaFNlbGYobXNnKSA6OlxuICAgIGNvbnN0IGRpc3BhdGNoU2VsZiA9IGFzeW5jIChtc2csIGNoYW5uZWwpID0+IDo6XG4gICAgICBjb25zdCBpZF90YXJnZXQgPSBtc2cuaWRfdGFyZ2V0XG4gICAgICBsZXQgdGFyZ2V0ID0gdGhpcy50YXJnZXRzLmdldChpZF90YXJnZXQpXG4gICAgICBpZiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgICB0YXJnZXQgPSBhd2FpdCB0aGlzLmRpc3BhdGNoX2Rpc2NvdmVyX3RhcmdldChtc2cpXG4gICAgICAgIGlmIG51bGwgPT0gdGFyZ2V0IDo6XG4gICAgICAgICAgcmV0dXJuIGNoYW5uZWwudW5kZWxpdmVyYWJsZShtc2csICd0YXJnZXQnKVxuICAgICAgICAvL3RoaXMucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0LCB0YXJnZXQpXG5cbiAgICAgIGlmIGZhbHNlID09PSBhd2FpdCB0YXJnZXQobXNnLCB0aGlzKSA6OlxuICAgICAgICB0aGlzLnVucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0KVxuXG4gICAgdGhpcy5kaXNwYXRjaFNlbGYgPSBkaXNwYXRjaFNlbGZcbiAgICByZXR1cm4gZGlzcGF0Y2hTZWxmXG5cbiAgX2NyZWF0ZVRhcmdldHNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG4gIHRhcmdldHMgPSB0aGlzLl9jcmVhdGVUYXJnZXRzTWFwKClcbiAgcmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0LCB0YXJnZXQpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIGlkX3RhcmdldCAmJiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgdGFyZ2V0ID0gaWRfdGFyZ2V0XG4gICAgICBpZF90YXJnZXQgPSB0YXJnZXQuaWRfdGFyZ2V0IHx8IHRhcmdldC5pZFxuXG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHRhcmdldCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAndGFyZ2V0JyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgIGlmICEgTnVtYmVyLmlzU2FmZUludGVnZXIgQCBpZF90YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2lkX3RhcmdldCcgdG8gYmUgYW4gaW50ZWdlcmBcbiAgICBpZiB0aGlzLnRhcmdldHMuaGFzIEAgaWRfdGFyZ2V0IDo6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLnNldCBAIGlkX3RhcmdldCwgdGFyZ2V0XG4gIHVucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0KSA6OlxuICAgIHJldHVybiB0aGlzLnRhcmdldHMuZGVsZXRlIEAgaWRfdGFyZ2V0XG5cblxuXG4gIC8vIC0tLSBEaXNwYXRjaCBjb250cm9sIG1lc3NhZ2VzXG5cbiAgYmluZERpc3BhdGNoQ29udHJvbCgpIDo6XG4gICAgcmV0dXJuIChtc2csIGNoYW5uZWwpID0+IDo6XG4gICAgICBpZiAwICE9PSBtc2cuaWRfdGFyZ2V0IDo6IC8vIGNvbm5lY3Rpb24tZGlzcGF0Y2hlZFxuICAgICAgICByZXR1cm4gdGhpcy5kaXNwYXRjaFNlbGYobXNnLCBjaGFubmVsKVxuXG4gICAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVttc2cudHlwZV1cbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gaGFuZGxlciA6OlxuICAgICAgICByZXR1cm4gaGFuZGxlcih0aGlzLCBtc2csIGNoYW5uZWwpXG4gICAgICBlbHNlIDo6XG4gICAgICAgIHJldHVybiB0aGlzLmRudV9kaXNwYXRjaF9jb250cm9sKG1zZywgY2hhbm5lbClcblxuICBkaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5jcmVhdGUgQCB0aGlzLmRpc3BDb250cm9sQnlUeXBlXG4gIGRudV9kaXNwYXRjaF9jb250cm9sKG1zZywgY2hhbm5lbCkgOjpcbiAgICBjb25zb2xlLndhcm4gQCAnZG51X2Rpc3BhdGNoX2NvbnRyb2wnLCBtc2cudHlwZSwgbXNnXG5cblxuTWVzc2FnZVJvdXRlci5wcm90b3R5cGUuZGlzcENvbnRyb2xCeVR5cGUgPSBPYmplY3QuYXNzaWduIEAge31cbiAgZGlzcENvbnRyb2xCeVR5cGVcblxuZXhwb3J0IGRlZmF1bHQgTWVzc2FnZVJvdXRlclxuXG5cbmZ1bmN0aW9uIHByb21pc2VRdWV1ZSgpIDo6XG4gIGxldCB0aXAgPSBudWxsXG4gIHJldHVybiBmdW5jdGlvbiAoKSA6OlxuICAgIGlmIG51bGwgPT09IHRpcCA6OlxuICAgICAgdGlwID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIHRpcC50aGVuIEAgY2xlYXJfdGlwXG4gICAgcmV0dXJuIHRpcFxuXG4gIGZ1bmN0aW9uIGNsZWFyX3RpcCgpIDo6XG4gICAgdGlwID0gbnVsbFxuXG5mdW5jdGlvbiBiaW5kUHJvbWlzZUZpcnN0UmVzdWx0KG9wdGlvbnM9e30pIDo6XG4gIGNvbnN0IG9uX2Vycm9yID0gb3B0aW9ucy5vbl9lcnJvciB8fCBjb25zb2xlLmVycm9yXG4gIGNvbnN0IGlmQWJzZW50ID0gb3B0aW9ucy5hYnNlbnQgfHwgbnVsbFxuXG4gIHJldHVybiAodGlwLCBsc3RGbnMpID0+XG4gICAgbmV3IFByb21pc2UgQCByZXNvbHZlID0+OjpcbiAgICAgIHRpcCA9IFByb21pc2UucmVzb2x2ZSh0aXApXG4gICAgICBQcm9taXNlLmFsbCBAXG4gICAgICAgIEFycmF5LmZyb20gQCBsc3RGbnMsIGZuID0+XG4gICAgICAgICAgdGlwLnRoZW4oZm4pLnRoZW4ocmVzb2x2ZSwgb25fZXJyb3IpXG4gICAgICAudGhlbiBAIGFic2VudCwgYWJzZW50XG5cbiAgICAgIGZ1bmN0aW9uIGFic2VudCgpIDo6XG4gICAgICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBpZkFic2VudCA6OlxuICAgICAgICAgIHJlc29sdmUgQCBpZkFic2VudCgpXG4gICAgICAgIGVsc2UgcmVzb2x2ZSBAIGlmQWJzZW50XG4iLCJpbXBvcnQge3NlbmRfaGVsbG8sIHNlbmRfcGluZ3Bvbmd9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cblxuZXhwb3J0IGNsYXNzIE1lc3NhZ2VDaGFubmVsIDo6XG4gIHNlbmRSYXcoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgSW5zdGFuY2UgcmVzcG9uc2libGl0eWBcbiAgcGFja1JhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuXG4gIHBhY2tBbmRTZW5kUmF3KC4uLmFyZ3MpIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja1JhdyBAIC4uLmFyZ3NcblxuICBzZW5kSlNPTihtc2dfb2JqKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tKU09OIEAgbXNnX29ialxuICBwYWNrSlNPTihtc2dfb2JqKSA6OlxuICAgIGlmIHVuZGVmaW5lZCAhPT0gbXNnX29iai5oZWFkZXIgOjpcbiAgICAgIG1zZ19vYmouaGVhZGVyID0gSlNPTi5zdHJpbmdpZnkgQCBtc2dfb2JqLmhlYWRlclxuICAgIGlmIHVuZGVmaW5lZCAhPT0gbXNnX29iai5ib2R5IDo6XG4gICAgICBtc2dfb2JqLmJvZHkgPSBKU09OLnN0cmluZ2lmeSBAIG1zZ19vYmouYm9keVxuICAgIHJldHVybiB0aGlzLnBhY2tSYXcobXNnX29iailcblxuXG4gIC8vIC0tLSBDb250cm9sIG1lc3NhZ2UgdXRpbGl0aWVzXG5cbiAgc2VuZFJvdXRpbmdIYW5kc2hha2UoKSA6OlxuICAgIHJldHVybiBzZW5kX2hlbGxvKHRoaXMsIHRoaXMucm91dGVyLmVjX3B1Yl9pZClcbiAgc2VuZFBpbmcoKSA6OlxuICAgIHJldHVybiBzZW5kX3Bpbmdwb25nKHRoaXMpXG5cblxuICBjbG9uZShwcm9wcywgLi4uZXh0cmEpIDo6XG4gICAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUodGhpcywgcHJvcHMpXG4gICAgcmV0dXJuIDAgPT09IGV4dHJhLmxlbmd0aCA/IHNlbGYgOiBPYmplY3QuYXNzaWduKHNlbGYsIC4uLmV4dHJhKVxuICBiaW5kQ2hhbm5lbChzZW5kUmF3LCBwcm9wcykgOjogcmV0dXJuIGJpbmRDaGFubmVsKHRoaXMsIHNlbmRSYXcsIHByb3BzKVxuICBiaW5kRGlzcGF0Y2hQYWNrZXRzKCkgOjogcmV0dXJuIGJpbmREaXNwYXRjaFBhY2tldHModGhpcylcblxuICB1bmRlbGl2ZXJhYmxlKG1zZywgbW9kZSkgOjpcbiAgICBjb25zb2xlLndhcm4gQCAndW5kZWxpdmVyYWJsZTonLCBtc2csIG1vZGVcblxuICBzdGF0aWMgYXNBUEkoaHViLCByb3V0ZXIsIHBhY2tSYXcpIDo6XG4gICAgY29uc3Qgc2VsZiA9IG5ldyB0aGlzKClcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHNlbGYsIEA6XG4gICAgICBwYWNrUmF3OiBAOiB2YWx1ZTogcGFja1Jhd1xuICAgICAgcm91dGVyOiBAOiB2YWx1ZTogcm91dGVyXG4gICAgICBodWI6IEA6IHZhbHVlOiBodWJcbiAgICAgIF9yb290XzogQDogdmFsdWU6IHNlbGZcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0NoYW5uZWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja01lc3NhZ2VcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0ludGVybmFsQVBJKGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgY29uc3Qgc2VsZiA9IHRoaXMuYXNBUEkgQCBodWIsIHJvdXRlciwgcGFja2V0UGFyc2VyLnBhY2tNZXNzYWdlT2JqXG4gICAgcmV0dXJuIHNlbGYuYmluZENoYW5uZWwobnVsbClcblxuZXhwb3J0IGRlZmF1bHQgTWVzc2FnZUNoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kQ2hhbm5lbChjaGFubmVsLCBzZW5kUmF3LCBwcm9wcykgOjpcbiAgaWYgbnVsbCA9PSBzZW5kUmF3IDo6XG4gICAgc2VuZFJhdyA9IGJpbmREaXNwYXRjaE1zZ1JhdyhjaGFubmVsLnJvdXRlcilcbiAgZWxzZSBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2Ygc2VuZFJhdyA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgQ2hhbm5lbCBleHBlY3RzICdzZW5kUmF3JyBmdW5jdGlvbiBwYXJhbWV0ZXJgXG5cbiAgY29uc3QgY29yZV9wcm9wcyA9IEA6IHNlbmRSYXc6IEB7fSB2YWx1ZTogc2VuZFJhd1xuICBwcm9wcyA9IG51bGwgPT0gcHJvcHMgPyBjb3JlX3Byb3BzIDogT2JqZWN0LmFzc2lnbiBAIGNvcmVfcHJvcHMsIHByb3BzXG5cbiAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUgQCBjaGFubmVsLCBwcm9wc1xuICByZXR1cm4gc2VuZFJhdy5jaGFubmVsID0gc2VsZlxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kRGlzcGF0Y2hNc2dSYXcocm91dGVyKSA6OlxuICBjb25zdCBkaXNwYXRjaCA9IHJvdXRlci5kaXNwYXRjaFxuICByZXR1cm4gZGlzcGF0Y2hNc2dPYmpcblxuICBmdW5jdGlvbiBkaXNwYXRjaE1zZ09iaihtc2cpIDo6XG4gICAgaWYgdW5kZWZpbmVkID09PSBtc2cuX3Jhd18gOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgYSBwYXJzZWQgbXNnX29iaiB3aXRoIHZhbGlkICdfcmF3XycgYnVmZmVyIHByb3BlcnR5YFxuICAgIGRpc3BhdGNoIEAgW21zZ10sIGRpc3BhdGNoTXNnT2JqLmNoYW5uZWxcbiAgICByZXR1cm4gdHJ1ZVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kRGlzcGF0Y2hQYWNrZXRzKGNoYW5uZWwpIDo6XG4gIGNvbnN0IGRpc3BhdGNoID0gY2hhbm5lbC5yb3V0ZXIuZGlzcGF0Y2hcbiAgY29uc3QgZmVlZCA9IGNoYW5uZWwuaHViLnBhY2tldFBhcnNlci5wYWNrZXRTdHJlYW0oKVxuXG4gIHJldHVybiBmdW5jdGlvbiBvbl9yZWN2X2RhdGEoZGF0YSkgOjpcbiAgICBjb25zdCBtc2dMaXN0ID0gZmVlZChkYXRhKVxuICAgIGlmIDAgPCBtc2dMaXN0Lmxlbmd0aCA6OlxuICAgICAgZGlzcGF0Y2ggQCBtc2dMaXN0LCBjaGFubmVsXG4iLCJpbXBvcnQge01lc3NhZ2VSb3V0ZXJ9IGZyb20gJy4vcm91dGVyLmpzeSdcbmltcG9ydCB7TWVzc2FnZUNoYW5uZWx9IGZyb20gJy4vY2hhbm5lbC5qc3knXG5cbmV4cG9ydCBjbGFzcyBNZXNzYWdlSHViIDo6XG4gIGNvbnN0cnVjdG9yKCkgOjpcbiAgICBhcHBseVBsdWdpbnMgQCAncHJlJywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG5cbiAgICBjb25zdCBwYWNrZXRQYXJzZXIgPSB0aGlzLnBhY2tldFBhcnNlclxuICAgIGlmIG51bGw9PXBhY2tldFBhcnNlciB8fCAhIHBhY2tldFBhcnNlci5pc1BhY2tldFBhcnNlcigpIDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEludmFsaWQgaHViLnBhY2tldFBhcnNlcmBcblxuICAgIGNvbnN0IHJvdXRlciA9IHRoaXMuX2luaXRfcm91dGVyKClcbiAgICBjb25zdCBfYXBpX2NoYW5uZWwgPSB0aGlzLl9pbml0X2NoYW5uZWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpXG4gICAgY29uc3QgX2FwaV9pbnRlcm5hbCA9IHRoaXMuX2luaXRfaW50ZXJuYWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAe31cbiAgICAgIHJvdXRlcjogQHt9IHZhbHVlOiByb3V0ZXJcbiAgICAgIHBhY2tldFBhcnNlcjogQHt9IHZhbHVlOiBwYWNrZXRQYXJzZXJcbiAgICAgIF9hcGlfY2hhbm5lbDogQHt9IHZhbHVlOiBfYXBpX2NoYW5uZWxcbiAgICAgIF9hcGlfaW50ZXJuYWw6IEB7fSB2YWx1ZTogX2FwaV9pbnRlcm5hbFxuXG4gICAgYXBwbHlQbHVnaW5zIEAgbnVsbCwgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3Bvc3QnLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICByZXR1cm4gdGhpc1xuXG4gIF9pbml0X3JvdXRlcigpIDo6IHRocm93IG5ldyBFcnJvciBAIGBQbHVnaW4gcmVzcG9uc2libGl0eWBcblxuICBfaW5pdF9jaGFubmVsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiBNZXNzYWdlQ2hhbm5lbC5hc0NoYW5uZWxBUEkgQFxuICAgICAgdGhpcywgcm91dGVyLCBwYWNrZXRQYXJzZXJcbiAgX2luaXRfaW50ZXJuYWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIE1lc3NhZ2VDaGFubmVsLmFzSW50ZXJuYWxBUEkgQFxuICAgICAgdGhpcywgcm91dGVyLCBwYWNrZXRQYXJzZXJcblxuXG4gIHN0YXRpYyBwbHVnaW4oLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIHJldHVybiB0aGlzLnBsdWdpbnMoLi4ucGx1Z2luRnVuY3Rpb25zKVxuICBzdGF0aWMgcGx1Z2lucyguLi5wbHVnaW5GdW5jdGlvbnMpIDo6XG4gICAgY29uc3QgcGx1Z2luTGlzdCA9IFtdLmNvbmNhdCBAXG4gICAgICB0aGlzLnByb3RvdHlwZS5wbHVnaW5MaXN0IHx8IFtdXG4gICAgICBwbHVnaW5GdW5jdGlvbnNcblxuICAgIHBsdWdpbkxpc3Quc29ydCBAIChhLCBiKSA9PiAoMCB8IGEub3JkZXIpIC0gKDAgfCBiLm9yZGVyKVxuXG4gICAgY29uc3QgQmFzZUh1YiA9IHRoaXMuX0Jhc2VIdWJfIHx8IHRoaXNcbiAgICBjbGFzcyBNZXNzYWdlSHViX1BJIGV4dGVuZHMgQmFzZUh1YiA6OlxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgTWVzc2FnZUh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwbHVnaW5MaXN0OiBAe30gdmFsdWU6IE9iamVjdC5mcmVlemUgQCBwbHVnaW5MaXN0XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBNZXNzYWdlSHViX1BJLCBAOlxuICAgICAgX0Jhc2VIdWJfOiBAe30gdmFsdWU6IEJhc2VIdWJcblxuICAgIGFwcGx5UGx1Z2lucyBAICdzdWJjbGFzcycsIHBsdWdpbkxpc3QsIE1lc3NhZ2VIdWJfUEksIEA6IE1lc3NhZ2VSb3V0ZXIsIE1lc3NhZ2VDaGFubmVsXG4gICAgcmV0dXJuIE1lc3NhZ2VIdWJfUElcblxuXG4gIGdldCBpZF9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5yb3V0ZXIuaWRfc2VsZlxuICBpZF9yb3V0ZXJfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMucGFja2V0UGFyc2VyLnBhY2tJZCBAXG4gICAgICB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGNvbm5lY3Rfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMuX2FwaV9pbnRlcm5hbC5jbG9uZSgpXG5cbiAgY29ubmVjdChjb25uX3VybCkgOjpcbiAgICBpZiBudWxsID09IGNvbm5fdXJsIDo6XG4gICAgICByZXR1cm4gdGhpcy5jb25uZWN0X3NlbGYoKVxuXG4gICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBjb25uX3VybCA6OlxuICAgICAgY29ubl91cmwgPSB0aGlzLl9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpXG5cbiAgICBjb25zdCBjb25uZWN0ID0gdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xbY29ubl91cmwucHJvdG9jb2xdXG4gICAgaWYgISBjb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IgQCBgQ29ubmVjdGlvbiBwcm90b2NvbCBcIiR7Y29ubl91cmwucHJvdG9jb2x9XCIgbm90IHJlZ2lzdGVyZWQgZm9yIFwiJHtjb25uX3VybC50b1N0cmluZygpfVwiYFxuXG4gICAgcmV0dXJuIGNvbm5lY3QoY29ubl91cmwpXG5cbiAgcmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wocHJvdG9jb2wsIGNiX2Nvbm5lY3QpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNiX2Nvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2NiX2Nvbm5lY3QnIGZ1bmN0aW9uYFxuICAgIGNvbnN0IGJ5UHJvdG9jb2wgPSBPYmplY3QuYXNzaWduIEAge30sIHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sXG4gICAgYnlQcm90b2NvbFtwcm90b2NvbF0gPSBjYl9jb25uZWN0XG4gICAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIHRoaXMsICdfY29ubmVjdEJ5UHJvdG9jb2wnLFxuICAgICAgQDogdmFsdWU6IGJ5UHJvdG9jb2wsIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuXG4gIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgcmV0dXJuIG5ldyBVUkwoY29ubl91cmwpXG5cbmV4cG9ydCBkZWZhdWx0IE1lc3NhZ2VIdWJcblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGx1Z2lucyhrZXksIHBsdWdpbkxpc3QsIC4uLmFyZ3MpIDo6XG4gIGlmICEga2V5IDo6IGtleSA9IG51bGxcbiAgZm9yIGxldCBwbHVnaW4gb2YgcGx1Z2luTGlzdCA6OlxuICAgIGlmIG51bGwgIT09IGtleSA6OiBwbHVnaW4gPSBwbHVnaW5ba2V5XVxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBwbHVnaW4gOjpcbiAgICAgIHBsdWdpbiguLi5hcmdzKVxuIl0sIm5hbWVzIjpbImRpc3BDb250cm9sQnlUeXBlIiwicmVjdl9oZWxsbyIsInJlY3Zfb2xsZWgiLCJyZWN2X3BvbmciLCJyZWN2X3BpbmciLCJzZW5kX2hlbGxvIiwiY2hhbm5lbCIsImVjX3B1Yl9pZCIsInJvdXRlciIsInBhY2tBbmRTZW5kUmF3IiwidHlwZSIsImh1YiIsImlkX3JvdXRlcl9zZWxmIiwibXNnIiwiZWNfb3RoZXJfaWQiLCJoZWFkZXJfYnVmZmVyIiwibGVuZ3RoIiwiZWNfaWRfaG1hYyIsImhtYWNfc2VjcmV0IiwiaWRfcm91dGVyIiwidW5wYWNrSWQiLCJib2R5X2J1ZmZlciIsInVudmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX29sbGVoIiwicGVlcl9obWFjX2NsYWltIiwiY29tcGFyZSIsInZlcmlmaWVkUGVlclJvdXRlIiwic2VuZF9waW5ncG9uZyIsInBvbmciLCJEYXRlIiwidG9JU09TdHJpbmciLCJsb2NhbCIsInJlbW90ZSIsInRvU3RyaW5nIiwiZGVsdGEiLCJ0c19wb25nIiwiZXJyIiwidHNfcGluZyIsImZpcnN0QW5zd2VyIiwiYmluZFByb21pc2VGaXJzdFJlc3VsdCIsIk1lc3NhZ2VSb3V0ZXIiLCJpZF9zZWxmIiwicm91dGVEaXNjb3ZlcnkiLCJ0YXJnZXREaXNjb3ZlcnkiLCJ0YXJnZXRzIiwiX2NyZWF0ZVRhcmdldHNNYXAiLCJPYmplY3QiLCJjcmVhdGUiLCJkZWZpbmVQcm9wZXJ0aWVzIiwidmFsdWUiLCJfaW5pdERpc3BhdGNoIiwicm91dGVzIiwiX2NyZWF0ZVJvdXRlc01hcCIsInNldCIsImJpbmREaXNwYXRjaENvbnRyb2wiLCJiaW5kRGlzcGF0Y2hTZWxmIiwicHF1ZXVlIiwicHJvbWlzZVF1ZXVlIiwiZGlzcGF0Y2hfb25lIiwiYmluZERpc3BhdGNoUm91dGUiLCJkaXNwYXRjaCIsIm1zZ0xpc3QiLCJwcSIsIm1hcCIsInRoZW4iLCJlcnJvciIsIk1hcCIsImRpc3BhdGNoX3JvdXRlIiwiZ2V0IiwidW5kZWZpbmVkIiwiZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUiLCJ1bmRlbGl2ZXJhYmxlIiwicmVnaXN0ZXJSb3V0ZSIsInVucmVnaXN0ZXJSb3V0ZSIsIm9uX2Vycm9yX2luX2Rpc3BhdGNoIiwiVHlwZUVycm9yIiwiaGFzIiwiZGVsZXRlIiwidHRsIiwic2VuZFJhdyIsInJlZ2lzdGVyUGVlclJvdXRlIiwiYWxsb3dVbnZlcmlmaWVkUm91dGVzIiwiY29uc29sZSIsIndhcm4iLCJpZF90YXJnZXQiLCJkaXNwYXRjaFNlbGYiLCJ0YXJnZXQiLCJkaXNwYXRjaF9kaXNjb3Zlcl90YXJnZXQiLCJ1bnJlZ2lzdGVyVGFyZ2V0IiwiaWQiLCJOdW1iZXIiLCJpc1NhZmVJbnRlZ2VyIiwiaGFuZGxlciIsImRudV9kaXNwYXRjaF9jb250cm9sIiwicHJvdG90eXBlIiwiYXNzaWduIiwidGlwIiwiUHJvbWlzZSIsInJlc29sdmUiLCJjbGVhcl90aXAiLCJvcHRpb25zIiwib25fZXJyb3IiLCJpZkFic2VudCIsImFic2VudCIsImxzdEZucyIsImFsbCIsIkFycmF5IiwiZnJvbSIsImZuIiwiTWVzc2FnZUNoYW5uZWwiLCJFcnJvciIsImFyZ3MiLCJwYWNrUmF3IiwibXNnX29iaiIsInBhY2tKU09OIiwiaGVhZGVyIiwiSlNPTiIsInN0cmluZ2lmeSIsImJvZHkiLCJwcm9wcyIsImV4dHJhIiwic2VsZiIsImJpbmRDaGFubmVsIiwiYmluZERpc3BhdGNoUGFja2V0cyIsIm1vZGUiLCJhc0FQSSIsImFzQ2hhbm5lbEFQSSIsInBhY2tldFBhcnNlciIsInBhY2tNZXNzYWdlIiwiYXNJbnRlcm5hbEFQSSIsInBhY2tNZXNzYWdlT2JqIiwiYmluZERpc3BhdGNoTXNnUmF3IiwiY29yZV9wcm9wcyIsImRpc3BhdGNoTXNnT2JqIiwiX3Jhd18iLCJmZWVkIiwicGFja2V0U3RyZWFtIiwib25fcmVjdl9kYXRhIiwiZGF0YSIsIk1lc3NhZ2VIdWIiLCJwbHVnaW5MaXN0IiwiaXNQYWNrZXRQYXJzZXIiLCJfaW5pdF9yb3V0ZXIiLCJfYXBpX2NoYW5uZWwiLCJfaW5pdF9jaGFubmVsQVBJIiwiX2FwaV9pbnRlcm5hbCIsIl9pbml0X2ludGVybmFsQVBJIiwicGx1Z2luIiwicGx1Z2luRnVuY3Rpb25zIiwicGx1Z2lucyIsImNvbmNhdCIsInNvcnQiLCJhIiwiYiIsIm9yZGVyIiwiQmFzZUh1YiIsIl9CYXNlSHViXyIsIk1lc3NhZ2VIdWJfUEkiLCJmcmVlemUiLCJwYWNrSWQiLCJjbG9uZSIsImNvbm5fdXJsIiwiY29ubmVjdF9zZWxmIiwiX3BhcnNlQ29ubmVjdFVSTCIsImNvbm5lY3QiLCJfY29ubmVjdEJ5UHJvdG9jb2wiLCJwcm90b2NvbCIsImNiX2Nvbm5lY3QiLCJieVByb3RvY29sIiwiZGVmaW5lUHJvcGVydHkiLCJjb25maWd1cmFibGUiLCJVUkwiLCJhcHBseVBsdWdpbnMiLCJrZXkiXSwibWFwcGluZ3MiOiJBQUFPLE1BQU1BLG9CQUFvQjtHQUM5QixJQUFELEdBQVFDLFVBRHVCO0dBRTlCLElBQUQsR0FBUUMsVUFGdUI7R0FHOUIsSUFBRCxHQUFRQyxTQUh1QjtHQUk5QixJQUFELEdBQVFDLFNBSnVCLEVBQTFCOztBQVFQLEFBQU8sU0FBU0MsVUFBVCxDQUFvQkMsT0FBcEIsRUFBNkI7UUFDNUIsRUFBQ0MsU0FBRCxLQUFjRCxRQUFRRSxNQUE1QjtTQUNPRixRQUFRRyxjQUFSLENBQXlCO2VBQ25CLENBRG1CLEVBQ2hCQyxNQUFNLElBRFU7WUFFdEJILFNBRnNCO1VBR3hCRCxRQUFRSyxHQUFSLENBQVlDLGNBQVosRUFId0IsRUFBekIsQ0FBUDs7O0FBS0YsU0FBU1gsVUFBVCxDQUFvQk8sTUFBcEIsRUFBNEJLLEdBQTVCLEVBQWlDUCxPQUFqQyxFQUEwQztRQUNsQ1EsY0FBY0QsSUFBSUUsYUFBSixFQUFwQjtNQUNHLE1BQU1ELFlBQVlFLE1BQWxCLElBQTRCUixPQUFPUyxVQUF0QyxFQUFtRDtVQUMzQ0MsY0FBY1YsT0FBT1MsVUFBUCxHQUNoQlQsT0FBT1MsVUFBUCxDQUFrQkgsV0FBbEIsQ0FEZ0IsR0FDaUIsSUFEckM7ZUFFYVIsT0FBYixFQUFzQlksV0FBdEI7R0FIRixNQUtLO1VBQ0dDLFlBQVlOLElBQUlPLFFBQUosQ0FBYVAsSUFBSVEsV0FBSixFQUFiLEVBQWdDLENBQWhDLENBQWxCO1dBQ09DLG1CQUFQLENBQTZCSCxTQUE3QixFQUF3Q2IsT0FBeEM7Ozs7QUFHSixTQUFTaUIsVUFBVCxDQUFvQmpCLE9BQXBCLEVBQTZCWSxXQUE3QixFQUEwQztRQUNsQyxFQUFDWCxTQUFELEtBQWNELFFBQVFFLE1BQTVCO1NBQ09GLFFBQVFHLGNBQVIsQ0FBeUI7ZUFDbkIsQ0FEbUIsRUFDaEJDLE1BQU0sSUFEVTtZ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
