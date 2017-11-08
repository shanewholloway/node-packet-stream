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

function recv_hello(dispatch, msg, channel) {
  const ec_other_id = msg.header_buffer();
  if (0 !== ec_other_id.length && dispatch.ec_id_hmac) {
    const hmac_secret = dispatch.ec_id_hmac ? dispatch.ec_id_hmac(ec_other_id) : null;
    send_olleh(channel, hmac_secret);
  } else {
    const id_router = msg.unpackId(msg.body_buffer(), 0);
    dispatch.unverifiedPeerRoute(id_router, channel);
  }
}

function send_olleh(channel, hmac_secret) {
  const { ec_pub_id } = channel.router;
  return channel.packAndSendRaw({
    id_router: 0, type: 0xf1,
    header: ec_pub_id,
    body: hmac_secret });
}

function recv_olleh(dispatch, msg, channel) {
  const ec_other_id = msg.header_buffer();
  const id_router = msg.unpackId(ec_other_id);

  const hmac_secret = dispatch.ec_id_hmac ? dispatch.ec_id_hmac(ec_other_id, true) : null;
  const peer_hmac_claim = msg.body_buffer();
  if (hmac_secret && 0 === hmac_secret.compare(peer_hmac_claim)) {
    dispatch.verifiedPeerRoute(id_router, channel);
  } else {
    dispatch.unverifiedPeerRoute(id_router, channel);
  }
}

function send_pingpong(channel, pong) {
  return channel.packAndSendRaw({
    id_router: 0, type: pong ? 0xfe : 0xff,
    body: new Date().toISOString() });
}

function recv_pong(dispatch, msg, channel) {
  const local = new Date();

  try {
    const remote = new Date(msg.body_buffer().toString());
    const delta = remote - local;
    channel.ts_pong = { delta, remote, local };
  } catch (err) {
    channel.ts_pong = { local };
  }
}

function recv_ping(dispatch, msg, channel) {
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

class MessageRouter {
  constructor(id_self) {
    this._routeDiscovery = [];
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
    const tip = Promise.resolve(id_router);
    // TODO: Promise.race might return the first null… dang.
    return Promise.race(this._routeDiscovery.map(discover => tip.then(discover)));
  }

  bindDispatchRoute(routes) {
    return async (msg, channel) => {
      try {
        const id_router = msg.id_router;
        let dispatch_route = routes.get(id_router);
        if (undefined === dispatch_route) {
          dispatch_route = await this.dispatch_discover_route(id_router, msg);
          if (null == dispatch_route) {
            return;
          }
          this.registerRoute(id_router, dispatch_route);
        }

        if (false === dispatch_route(msg, channel)) {
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

  dnu_dispatch_self(msg) {}
  bindDispatchSelf(msg) {
    return async (msg, channel) => {
      const id_target = msg.id_target;
      let target = this.targets.get(id_target);
      if (undefined === target) {
        target = await this.dnu_dispatch_self(msg);
        if (null == target) {
          return;
        }
      }

      if (false === target(msg, this)) {
        this.unregisterTarget(id_target);
      }
    };
  }

  _createTargetsMap() {
    return new Map();
  }
  registerTarget(id_target, target) {
    if ('function' !== typeof target) {
      throw new TypeError(`Expected 'target' to be a function`);
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
      const handler = this.dispControlByType[msg.type];
      if (undefined !== handler) {
        handler(this, msg, channel);
      } else this.dnu_dispatch_control(msg, channel);
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

class MessageChannel {
  sendRaw() {
    throw new Error(`Instance responsiblity`);
  }
  packRaw() {
    throw new Error(`Instance responsiblity`);
  }
  pack(...args) {
    return this.packRaw(this.context, ...args);
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

    return this.pack(msg_obj);
  }

  // --- Control message utilities

  sendRoutingHandshake(channel) {
    return send_hello(this, this.ec_pub_id);
  }
  sendPing(channel) {
    return send_pingpong(this);
  }

  clone(props) {
    return Object.create(this, props);
  }
  bindChannel(sendRaw, props) {
    return bindChannel(this, sendRaw, props);
  }
  bindDispatchPackets() {
    return bindDispatchPackets(this);
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
  const feed = channel.hub._packetParser.packetStream();

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

    const router = this._init_router();
    const _packetParser = this._init_packetParser();
    const _api_channel = this._init_channelAPI(router, _packetParser);
    const _api_internal = this._init_internalAPI(router, _packetParser);
    Object.defineProperties(this, {
      router: { value: router },
      _packetParser: { value: _packetParser },
      _api_channel: { value: _api_channel },
      _api_internal: { value: _api_internal } });

    applyPlugins(null, this.pluginList, this);
    applyPlugins('post', this.pluginList, this);
    return this;
  }

  _init_router() {
    throw new Error(`Plugin responsiblity`);
  }
  _init_packetParser() {
    throw new Error(`Plugin responsiblity`);
  }

  _init_channelAPI(router, packetParser) {
    return MessageChannel.asChannelAPI(this, router, packetParser);
  }
  _init_internalAPI(router, packetParser) {
    return MessageChannel.asInternalAPI(this, router, packetParser);
  }

  static plugin(...pluginFunctions) {
    const pluginList = [].concat(this.prototype.pluginList || [], pluginFunctions);

    const BaseHub = this._BaseHub_ || this;
    class MessageHub_PI extends BaseHub {}
    Object.defineProperties(MessageHub_PI.prototype, {
      pluginList: { value: Object.freeze(pluginList) } });
    Object.defineProperties(MessageHub_PI, {
      _BaseHub_: { value: BaseHub } });

    applyPlugins('subclass', pluginList, MessageHub_PI, { MessageRouter, MessageChannel });
    return MessageHub_PI;
  }

  id_router_self() {
    return this._packetParser.packId(this.router.id_self);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvY29udHJvbF9wcm90b2NvbC5qc3kiLCIuLi9jb2RlL3JvdXRlci5qc3kiLCIuLi9jb2RlL2NoYW5uZWwuanN5IiwiLi4vY29kZS9odWIuanN5Il0sInNvdXJjZXNDb250ZW50IjpbImV4cG9ydCBjb25zdCBkaXNwQ29udHJvbEJ5VHlwZSA9IEB7fVxuICBbMHhmMF06IHJlY3ZfaGVsbG9cbiAgWzB4ZjFdOiByZWN2X29sbGVoXG4gIFsweGZlXTogcmVjdl9wb25nXG4gIFsweGZmXTogcmVjdl9waW5nXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9oZWxsbyhjaGFubmVsKSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYwXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBjaGFubmVsLmh1Yi5pZF9yb3V0ZXJfc2VsZigpXG5cbmZ1bmN0aW9uIHJlY3ZfaGVsbG8oZGlzcGF0Y2gsIG1zZywgY2hhbm5lbCkgOjpcbiAgY29uc3QgZWNfb3RoZXJfaWQgPSBtc2cuaGVhZGVyX2J1ZmZlcigpXG4gIGlmIDAgIT09IGVjX290aGVyX2lkLmxlbmd0aCAmJiBkaXNwYXRjaC5lY19pZF9obWFjIDo6XG4gICAgY29uc3QgaG1hY19zZWNyZXQgPSBkaXNwYXRjaC5lY19pZF9obWFjXG4gICAgICA/IGRpc3BhdGNoLmVjX2lkX2htYWMoZWNfb3RoZXJfaWQpIDogbnVsbFxuICAgIHNlbmRfb2xsZWggQCBjaGFubmVsLCBobWFjX3NlY3JldFxuXG4gIGVsc2UgOjpcbiAgICBjb25zdCBpZF9yb3V0ZXIgPSBtc2cudW5wYWNrSWQobXNnLmJvZHlfYnVmZmVyKCksIDApXG4gICAgZGlzcGF0Y2gudW52ZXJpZmllZFBlZXJSb3V0ZSBAIGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbmZ1bmN0aW9uIHNlbmRfb2xsZWgoY2hhbm5lbCwgaG1hY19zZWNyZXQpIDo6XG4gIGNvbnN0IHtlY19wdWJfaWR9ID0gY2hhbm5lbC5yb3V0ZXJcbiAgcmV0dXJuIGNoYW5uZWwucGFja0FuZFNlbmRSYXcgQDpcbiAgICBpZF9yb3V0ZXI6IDAsIHR5cGU6IDB4ZjFcbiAgICBoZWFkZXI6IGVjX3B1Yl9pZFxuICAgIGJvZHk6IGhtYWNfc2VjcmV0XG5cbmZ1bmN0aW9uIHJlY3Zfb2xsZWgoZGlzcGF0Y2gsIG1zZywgY2hhbm5lbCkgOjpcbiAgY29uc3QgZWNfb3RoZXJfaWQgPSBtc2cuaGVhZGVyX2J1ZmZlcigpXG4gIGNvbnN0IGlkX3JvdXRlciA9IG1zZy51bnBhY2tJZChlY19vdGhlcl9pZClcblxuICBjb25zdCBobWFjX3NlY3JldCA9IGRpc3BhdGNoLmVjX2lkX2htYWNcbiAgICA/IGRpc3BhdGNoLmVjX2lkX2htYWMoZWNfb3RoZXJfaWQsIHRydWUpIDogbnVsbFxuICBjb25zdCBwZWVyX2htYWNfY2xhaW0gPSBtc2cuYm9keV9idWZmZXIoKVxuICBpZiBobWFjX3NlY3JldCAmJiAwID09PSBobWFjX3NlY3JldC5jb21wYXJlIEAgcGVlcl9obWFjX2NsYWltIDo6XG4gICAgZGlzcGF0Y2gudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcbiAgZWxzZSA6OlxuICAgIGRpc3BhdGNoLnVudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBzZW5kX3Bpbmdwb25nKGNoYW5uZWwsIHBvbmcpIDo6XG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiBwb25nID8gMHhmZSA6IDB4ZmZcbiAgICBib2R5OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuZnVuY3Rpb24gcmVjdl9wb25nKGRpc3BhdGNoLCBtc2csIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGxvY2FsID0gbmV3IERhdGUoKVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgbXNnLmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BvbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGxvY2FsXG5cbmZ1bmN0aW9uIHJlY3ZfcGluZyhkaXNwYXRjaCwgbXNnLCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICBzZW5kX3Bpbmdwb25nIEAgY2hhbm5lbCwgdHJ1ZVxuXG4gIHRyeSA6OlxuICAgIGNvbnN0IHJlbW90ZSA9IG5ldyBEYXRlIEAgbXNnLmJvZHlfYnVmZmVyKCkudG9TdHJpbmcoKVxuICAgIGNvbnN0IGRlbHRhID0gcmVtb3RlIC0gbG9jYWxcbiAgICBjaGFubmVsLnRzX3BpbmcgPSBAe30gZGVsdGEsIHJlbW90ZSwgbG9jYWxcbiAgY2F0Y2ggZXJyIDo6XG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGxvY2FsXG5cbiIsImltcG9ydCB7ZGlzcENvbnRyb2xCeVR5cGV9IGZyb20gJy4vY29udHJvbF9wcm90b2NvbC5qc3knXG5cbmV4cG9ydCBjbGFzcyBNZXNzYWdlUm91dGVyIDo6XG4gIGNvbnN0cnVjdG9yKGlkX3NlbGYpIDo6XG4gICAgaWYgaWRfc2VsZiA6OlxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOiBpZF9zZWxmOiBAOiB2YWx1ZTogaWRfc2VsZlxuICAgICAgdGhpcy5faW5pdERpc3BhdGNoKClcblxuICAvLyAtLS0gRGlzcGF0Y2ggY29yZSAtLS1cblxuICBfaW5pdERpc3BhdGNoKCkgOjpcbiAgICBjb25zdCByb3V0ZXMgPSB0aGlzLl9jcmVhdGVSb3V0ZXNNYXAoKVxuICAgIHJvdXRlcy5zZXQgQCAwLCB0aGlzLmJpbmREaXNwYXRjaENvbnRyb2woKVxuICAgIGlmIG51bGwgIT0gdGhpcy5pZF9zZWxmIDo6XG4gICAgICByb3V0ZXMuc2V0IEAgdGhpcy5pZF9zZWxmLCB0aGlzLmJpbmREaXNwYXRjaFNlbGYoKVxuXG4gICAgY29uc3QgcHF1ZXVlID0gcHJvbWlzZVF1ZXVlKClcbiAgICBjb25zdCBkaXNwYXRjaF9vbmUgPSB0aGlzLmJpbmREaXNwYXRjaFJvdXRlKHJvdXRlcylcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAOlxuICAgICAgcm91dGVzOiBAOiB2YWx1ZTogcm91dGVzXG4gICAgICBkaXNwYXRjaDogQDogdmFsdWU6IGRpc3BhdGNoXG5cbiAgICBmdW5jdGlvbiBkaXNwYXRjaChtc2dMaXN0LCBjaGFubmVsKSA6OlxuICAgICAgY29uc3QgcHEgPSBwcXVldWUoKSAvLyBwcSB3aWxsIGRpc3BhdGNoIGR1cmluZyBQcm9taXNlIHJlc29sdXRpb25zXG4gICAgICByZXR1cm4gbXNnTGlzdC5tYXAgQCBtc2cgPT5cbiAgICAgICAgcHEudGhlbiBAICgpID0+IGRpc3BhdGNoX29uZShtc2csIGNoYW5uZWwpXG5cbiAgb25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBtc2cpIDo6XG4gICAgY29uc29sZS5lcnJvciBAICdFcnJvciBkdXJpbmcgbXNnIGRpc3BhdGNoXFxuICBtc2c6JywgbXNnLCAnXFxuJywgZXJyLCAnXFxuJ1xuXG4gIF9jcmVhdGVSb3V0ZXNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIHJvdXRlIC0tLVxuXG4gIF9yb3V0ZURpc2NvdmVyeSA9IFtdXG4gIGRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlciwgbXNnKSA6OlxuICAgIGNvbnN0IHRpcCA9IFByb21pc2UucmVzb2x2ZShpZF9yb3V0ZXIpXG4gICAgLy8gVE9ETzogUHJvbWlzZS5yYWNlIG1pZ2h0IHJldHVybiB0aGUgZmlyc3QgbnVsbOKApiBkYW5nLlxuICAgIHJldHVybiBQcm9taXNlLnJhY2UgQFxuICAgICAgdGhpcy5fcm91dGVEaXNjb3ZlcnkubWFwIEBcbiAgICAgICAgZGlzY292ZXIgPT4gdGlwLnRoZW4gQCBkaXNjb3ZlclxuXG4gIGJpbmREaXNwYXRjaFJvdXRlKHJvdXRlcykgOjpcbiAgICByZXR1cm4gYXN5bmMgKG1zZywgY2hhbm5lbCkgPT4gOjpcbiAgICAgIHRyeSA6OlxuICAgICAgICBjb25zdCBpZF9yb3V0ZXIgPSBtc2cuaWRfcm91dGVyXG4gICAgICAgIGxldCBkaXNwYXRjaF9yb3V0ZSA9IHJvdXRlcy5nZXQoaWRfcm91dGVyKVxuICAgICAgICBpZiB1bmRlZmluZWQgPT09IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgICAgZGlzcGF0Y2hfcm91dGUgPSBhd2FpdCB0aGlzLmRpc3BhdGNoX2Rpc2NvdmVyX3JvdXRlKGlkX3JvdXRlciwgbXNnKVxuICAgICAgICAgIGlmIG51bGwgPT0gZGlzcGF0Y2hfcm91dGUgOjogcmV0dXJuXG4gICAgICAgICAgdGhpcy5yZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpXG5cbiAgICAgICAgaWYgZmFsc2UgPT09IGRpc3BhdGNoX3JvdXRlKG1zZywgY2hhbm5lbCkgOjpcbiAgICAgICAgICB0aGlzLnVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpXG4gICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgdGhpcy5vbl9lcnJvcl9pbl9kaXNwYXRjaChlcnIsIG1zZywgY2hhbm5lbClcblxuXG4gIHJlZ2lzdGVyUm91dGUoaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZSkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgIGlmIG51bGwgIT0gZGlzcGF0Y2hfcm91dGUgOjpcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnZGlzcGF0Y2hfcm91dGUnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgICBlbHNlIHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMucm91dGVzLmhhcyBAIGlkX3JvdXRlciA6OiByZXR1cm4gZmFsc2VcbiAgICBpZiAwID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgdGhpcy5pZF9zZWxmID09PSBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG5cbiAgICB0aGlzLnJvdXRlcy5zZXQgQCBpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlXG4gICAgcmV0dXJuIHRydWVcbiAgdW5yZWdpc3RlclJvdXRlKGlkX3JvdXRlcikgOjpcbiAgICByZXR1cm4gdGhpcy5yb3V0ZXMuZGVsZXRlIEAgaWRfcm91dGVyXG4gIHJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclJvdXRlIEAgaWRfcm91dGVyLCBtc2cgPT4gOjpcbiAgICAgIGlmIDAgIT09IG1zZy50dGwgOjogY2hhbm5lbC5zZW5kUmF3KG1zZylcbiAgdmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgdW52ZXJpZmllZFBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgaWYgdGhpcy5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgfHwgY2hhbm5lbC5hbGxvd1VudmVyaWZpZWRSb3V0ZXMgOjpcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbClcbiAgICBlbHNlIGNvbnNvbGUud2FybiBAICdVbnZlcmlmaWVkIHBlZXIgcm91dGUgKGlnbm9yZWQpOicsIEA6IGlkX3JvdXRlciwgY2hhbm5lbFxuXG5cbiAgLy8gLS0tIERpc3BhdGNoIHRvIGxvY2FsIHRhcmdldFxuXG4gIGRudV9kaXNwYXRjaF9zZWxmKG1zZykgOjpcbiAgYmluZERpc3BhdGNoU2VsZihtc2cpIDo6XG4gICAgcmV0dXJuIGFzeW5jIChtc2csIGNoYW5uZWwpID0+IDo6XG4gICAgICBjb25zdCBpZF90YXJnZXQgPSBtc2cuaWRfdGFyZ2V0XG4gICAgICBsZXQgdGFyZ2V0ID0gdGhpcy50YXJnZXRzLmdldChpZF90YXJnZXQpXG4gICAgICBpZiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgICB0YXJnZXQgPSBhd2FpdCB0aGlzLmRudV9kaXNwYXRjaF9zZWxmKG1zZylcbiAgICAgICAgaWYgbnVsbCA9PSB0YXJnZXQgOjogcmV0dXJuXG5cbiAgICAgIGlmIGZhbHNlID09PSB0YXJnZXQobXNnLCB0aGlzKSA6OlxuICAgICAgICB0aGlzLnVucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0KVxuXG4gIF9jcmVhdGVUYXJnZXRzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuICB0YXJnZXRzID0gdGhpcy5fY3JlYXRlVGFyZ2V0c01hcCgpXG4gIHJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCwgdGFyZ2V0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiB0YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ3RhcmdldCcgdG8gYmUgYSBmdW5jdGlvbmBcbiAgICBpZiB0aGlzLnRhcmdldHMuaGFzIEAgaWRfdGFyZ2V0IDo6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLnNldCBAIGlkX3RhcmdldCwgdGFyZ2V0XG4gIHVucmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0KSA6OlxuICAgIHJldHVybiB0aGlzLnRhcmdldHMuZGVsZXRlIEAgaWRfdGFyZ2V0XG5cblxuXG4gIC8vIC0tLSBEaXNwYXRjaCBjb250cm9sIG1lc3NhZ2VzXG5cbiAgYmluZERpc3BhdGNoQ29udHJvbCgpIDo6XG4gICAgcmV0dXJuIChtc2csIGNoYW5uZWwpID0+IDo6XG4gICAgICBjb25zdCBoYW5kbGVyID0gdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVttc2cudHlwZV1cbiAgICAgIGlmIHVuZGVmaW5lZCAhPT0gaGFuZGxlciA6OlxuICAgICAgICBoYW5kbGVyKHRoaXMsIG1zZywgY2hhbm5lbClcbiAgICAgIGVsc2VcbiAgICAgICAgdGhpcy5kbnVfZGlzcGF0Y2hfY29udHJvbChtc2csIGNoYW5uZWwpXG5cbiAgZGlzcENvbnRyb2xCeVR5cGUgPSBPYmplY3QuY3JlYXRlIEAgdGhpcy5kaXNwQ29udHJvbEJ5VHlwZVxuICBkbnVfZGlzcGF0Y2hfY29udHJvbChtc2csIGNoYW5uZWwpIDo6XG4gICAgY29uc29sZS53YXJuIEAgJ2RudV9kaXNwYXRjaF9jb250cm9sJywgbXNnLnR5cGUsIG1zZ1xuXG5cbk1lc3NhZ2VSb3V0ZXIucHJvdG90eXBlLmRpc3BDb250cm9sQnlUeXBlID0gT2JqZWN0LmFzc2lnbiBAIHt9XG4gIGRpc3BDb250cm9sQnlUeXBlXG5cbmV4cG9ydCBkZWZhdWx0IE1lc3NhZ2VSb3V0ZXJcblxuXG5mdW5jdGlvbiBwcm9taXNlUXVldWUoKSA6OlxuICBsZXQgdGlwID0gbnVsbFxuICByZXR1cm4gZnVuY3Rpb24gKCkgOjpcbiAgICBpZiBudWxsID09PSB0aXAgOjpcbiAgICAgIHRpcCA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICB0aXAudGhlbiBAIGNsZWFyX3RpcFxuICAgIHJldHVybiB0aXBcblxuICBmdW5jdGlvbiBjbGVhcl90aXAoKSA6OlxuICAgIHRpcCA9IG51bGxcblxuIiwiaW1wb3J0IHtzZW5kX2hlbGxvLCBzZW5kX3Bpbmdwb25nfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5cbmV4cG9ydCBjbGFzcyBNZXNzYWdlQ2hhbm5lbCA6OlxuICBzZW5kUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG4gIHBhY2tSYXcoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgSW5zdGFuY2UgcmVzcG9uc2libGl0eWBcbiAgcGFjayguLi5hcmdzKSA6OiByZXR1cm4gdGhpcy5wYWNrUmF3IEAgdGhpcy5jb250ZXh0LCAuLi5hcmdzXG5cbiAgcGFja0FuZFNlbmRSYXcoLi4uYXJncykgOjpcbiAgICByZXR1cm4gdGhpcy5zZW5kUmF3IEAgdGhpcy5wYWNrUmF3IEAgLi4uYXJnc1xuXG4gIHNlbmRKU09OKG1zZ19vYmopIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja0pTT04gQCBtc2dfb2JqXG4gIHBhY2tKU09OKG1zZ19vYmopIDo6XG4gICAgaWYgdW5kZWZpbmVkICE9PSBtc2dfb2JqLmhlYWRlciA6OlxuICAgICAgbXNnX29iai5oZWFkZXIgPSBKU09OLnN0cmluZ2lmeSBAIG1zZ19vYmouaGVhZGVyXG4gICAgaWYgdW5kZWZpbmVkICE9PSBtc2dfb2JqLmJvZHkgOjpcbiAgICAgIG1zZ19vYmouYm9keSA9IEpTT04uc3RyaW5naWZ5IEAgbXNnX29iai5ib2R5XG5cbiAgICByZXR1cm4gdGhpcy5wYWNrKG1zZ19vYmopXG5cblxuICAvLyAtLS0gQ29udHJvbCBtZXNzYWdlIHV0aWxpdGllc1xuXG4gIHNlbmRSb3V0aW5nSGFuZHNoYWtlKGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHNlbmRfaGVsbG8odGhpcywgdGhpcy5lY19wdWJfaWQpXG4gIHNlbmRQaW5nKGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHNlbmRfcGluZ3BvbmcodGhpcylcblxuXG5cbiAgY2xvbmUocHJvcHMpIDo6IHJldHVybiBPYmplY3QuY3JlYXRlKHRoaXMsIHByb3BzKVxuICBiaW5kQ2hhbm5lbChzZW5kUmF3LCBwcm9wcykgOjogcmV0dXJuIGJpbmRDaGFubmVsKHRoaXMsIHNlbmRSYXcsIHByb3BzKVxuICBiaW5kRGlzcGF0Y2hQYWNrZXRzKCkgOjogcmV0dXJuIGJpbmREaXNwYXRjaFBhY2tldHModGhpcylcblxuXG4gIHN0YXRpYyBhc0FQSShodWIsIHJvdXRlciwgcGFja1JhdykgOjpcbiAgICBjb25zdCBzZWxmID0gbmV3IHRoaXMoKVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgc2VsZiwgQDpcbiAgICAgIHBhY2tSYXc6IEA6IHZhbHVlOiBwYWNrUmF3XG4gICAgICByb3V0ZXI6IEA6IHZhbHVlOiByb3V0ZXJcbiAgICAgIGh1YjogQDogdmFsdWU6IGh1YlxuICAgICAgX3Jvb3RfOiBAOiB2YWx1ZTogc2VsZlxuICAgIHJldHVybiBzZWxmXG5cbiAgc3RhdGljIGFzQ2hhbm5lbEFQSShodWIsIHJvdXRlciwgcGFja2V0UGFyc2VyKSA6OlxuICAgIGNvbnN0IHNlbGYgPSB0aGlzLmFzQVBJIEAgaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlci5wYWNrTWVzc2FnZVxuICAgIHJldHVybiBzZWxmXG5cbiAgc3RhdGljIGFzSW50ZXJuYWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja01lc3NhZ2VPYmpcbiAgICByZXR1cm4gc2VsZi5iaW5kQ2hhbm5lbChudWxsKVxuXG5leHBvcnQgZGVmYXVsdCBNZXNzYWdlQ2hhbm5lbFxuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRDaGFubmVsKGNoYW5uZWwsIHNlbmRSYXcsIHByb3BzKSA6OlxuICBpZiBudWxsID09IHNlbmRSYXcgOjpcbiAgICBzZW5kUmF3ID0gYmluZERpc3BhdGNoTXNnUmF3KGNoYW5uZWwucm91dGVyKVxuICBlbHNlIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBzZW5kUmF3IDo6XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBDaGFubmVsIGV4cGVjdHMgJ3NlbmRSYXcnIGZ1bmN0aW9uIHBhcmFtZXRlcmBcblxuICBjb25zdCBjb3JlX3Byb3BzID0gQDogc2VuZFJhdzogQHt9IHZhbHVlOiBzZW5kUmF3XG4gIHByb3BzID0gbnVsbCA9PSBwcm9wcyA/IGNvcmVfcHJvcHMgOiBPYmplY3QuYXNzaWduIEAgY29yZV9wcm9wcywgcHJvcHNcblxuICBjb25zdCBzZWxmID0gT2JqZWN0LmNyZWF0ZSBAIGNoYW5uZWwsIHByb3BzXG4gIHJldHVybiBzZW5kUmF3LmNoYW5uZWwgPSBzZWxmXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaE1zZ1Jhdyhyb3V0ZXIpIDo6XG4gIGNvbnN0IGRpc3BhdGNoID0gcm91dGVyLmRpc3BhdGNoXG4gIHJldHVybiBkaXNwYXRjaE1zZ09ialxuXG4gIGZ1bmN0aW9uIGRpc3BhdGNoTXNnT2JqKG1zZykgOjpcbiAgICBpZiB1bmRlZmluZWQgPT09IG1zZy5fcmF3XyA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCBhIHBhcnNlZCBtc2dfb2JqIHdpdGggdmFsaWQgJ19yYXdfJyBidWZmZXIgcHJvcGVydHlgXG4gICAgZGlzcGF0Y2ggQCBbbXNnXSwgZGlzcGF0Y2hNc2dPYmouY2hhbm5lbFxuICAgIHJldHVybiB0cnVlXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmREaXNwYXRjaFBhY2tldHMoY2hhbm5lbCkgOjpcbiAgY29uc3QgZGlzcGF0Y2ggPSBjaGFubmVsLnJvdXRlci5kaXNwYXRjaFxuICBjb25zdCBmZWVkID0gY2hhbm5lbC5odWIuX3BhY2tldFBhcnNlci5wYWNrZXRTdHJlYW0oKVxuXG4gIHJldHVybiBmdW5jdGlvbiBvbl9yZWN2X2RhdGEoZGF0YSkgOjpcbiAgICBjb25zdCBtc2dMaXN0ID0gZmVlZChkYXRhKVxuICAgIGlmIDAgPCBtc2dMaXN0Lmxlbmd0aCA6OlxuICAgICAgZGlzcGF0Y2ggQCBtc2dMaXN0LCBjaGFubmVsXG4iLCJpbXBvcnQge01lc3NhZ2VSb3V0ZXJ9IGZyb20gJy4vcm91dGVyLmpzeSdcbmltcG9ydCB7TWVzc2FnZUNoYW5uZWx9IGZyb20gJy4vY2hhbm5lbC5qc3knXG5cbmV4cG9ydCBjbGFzcyBNZXNzYWdlSHViIDo6XG4gIGNvbnN0cnVjdG9yKCkgOjpcbiAgICBhcHBseVBsdWdpbnMgQCAncHJlJywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG5cbiAgICBjb25zdCByb3V0ZXIgPSB0aGlzLl9pbml0X3JvdXRlcigpXG4gICAgY29uc3QgX3BhY2tldFBhcnNlciA9IHRoaXMuX2luaXRfcGFja2V0UGFyc2VyKClcbiAgICBjb25zdCBfYXBpX2NoYW5uZWwgPSB0aGlzLl9pbml0X2NoYW5uZWxBUEkocm91dGVyLCBfcGFja2V0UGFyc2VyKVxuICAgIGNvbnN0IF9hcGlfaW50ZXJuYWwgPSB0aGlzLl9pbml0X2ludGVybmFsQVBJKHJvdXRlciwgX3BhY2tldFBhcnNlcilcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEB7fVxuICAgICAgcm91dGVyOiBAe30gdmFsdWU6IHJvdXRlclxuICAgICAgX3BhY2tldFBhcnNlcjogQHt9IHZhbHVlOiBfcGFja2V0UGFyc2VyXG4gICAgICBfYXBpX2NoYW5uZWw6IEB7fSB2YWx1ZTogX2FwaV9jaGFubmVsXG4gICAgICBfYXBpX2ludGVybmFsOiBAe30gdmFsdWU6IF9hcGlfaW50ZXJuYWxcblxuICAgIGFwcGx5UGx1Z2lucyBAIG51bGwsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIGFwcGx5UGx1Z2lucyBAICdwb3N0JywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgcmV0dXJuIHRoaXNcblxuICBfaW5pdF9yb3V0ZXIoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgUGx1Z2luIHJlc3BvbnNpYmxpdHlgXG4gIF9pbml0X3BhY2tldFBhcnNlcigpIDo6IHRocm93IG5ldyBFcnJvciBAIGBQbHVnaW4gcmVzcG9uc2libGl0eWBcblxuICBfaW5pdF9jaGFubmVsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiBNZXNzYWdlQ2hhbm5lbC5hc0NoYW5uZWxBUEkgQFxuICAgICAgdGhpcywgcm91dGVyLCBwYWNrZXRQYXJzZXJcbiAgX2luaXRfaW50ZXJuYWxBUEkocm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgcmV0dXJuIE1lc3NhZ2VDaGFubmVsLmFzSW50ZXJuYWxBUEkgQFxuICAgICAgdGhpcywgcm91dGVyLCBwYWNrZXRQYXJzZXJcblxuXG4gIHN0YXRpYyBwbHVnaW4oLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIGNvbnN0IHBsdWdpbkxpc3QgPSBbXS5jb25jYXQgQFxuICAgICAgdGhpcy5wcm90b3R5cGUucGx1Z2luTGlzdCB8fCBbXVxuICAgICAgcGx1Z2luRnVuY3Rpb25zXG5cbiAgICBjb25zdCBCYXNlSHViID0gdGhpcy5fQmFzZUh1Yl8gfHwgdGhpc1xuICAgIGNsYXNzIE1lc3NhZ2VIdWJfUEkgZXh0ZW5kcyBCYXNlSHViIDo6XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBNZXNzYWdlSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBsdWdpbkxpc3Q6IEB7fSB2YWx1ZTogT2JqZWN0LmZyZWV6ZSBAIHBsdWdpbkxpc3RcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIE1lc3NhZ2VIdWJfUEksIEA6XG4gICAgICBfQmFzZUh1Yl86IEB7fSB2YWx1ZTogQmFzZUh1YlxuXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3N1YmNsYXNzJywgcGx1Z2luTGlzdCwgTWVzc2FnZUh1Yl9QSSwgQDogTWVzc2FnZVJvdXRlciwgTWVzc2FnZUNoYW5uZWxcbiAgICByZXR1cm4gTWVzc2FnZUh1Yl9QSVxuXG4gIGlkX3JvdXRlcl9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5fcGFja2V0UGFyc2VyLnBhY2tJZCBAXG4gICAgICB0aGlzLnJvdXRlci5pZF9zZWxmXG5cbiAgY29ubmVjdF9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5fYXBpX2ludGVybmFsLmNsb25lKClcblxuICBjb25uZWN0KGNvbm5fdXJsKSA6OlxuICAgIGlmIG51bGwgPT0gY29ubl91cmwgOjpcbiAgICAgIHJldHVybiB0aGlzLmNvbm5lY3Rfc2VsZigpXG5cbiAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGNvbm5fdXJsIDo6XG4gICAgICBjb25uX3VybCA9IHRoaXMuX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybClcblxuICAgIGNvbnN0IGNvbm5lY3QgPSB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFtjb25uX3VybC5wcm90b2NvbF1cbiAgICBpZiAhIGNvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBFcnJvciBAIGBDb25uZWN0aW9uIHByb3RvY29sIFwiJHtjb25uX3VybC5wcm90b2NvbH1cIiBub3QgcmVnaXN0ZXJlZCBmb3IgXCIke2Nvbm5fdXJsLnRvU3RyaW5nKCl9XCJgXG5cbiAgICByZXR1cm4gY29ubmVjdChjb25uX3VybClcblxuICByZWdpc3RlckNvbm5lY3Rpb25Qcm90b2NvbChwcm90b2NvbCwgY2JfY29ubmVjdCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgY2JfY29ubmVjdCA6OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvciBAIGBFeHBlY3RlZCAnY2JfY29ubmVjdCcgZnVuY3Rpb25gXG4gICAgY29uc3QgYnlQcm90b2NvbCA9IE9iamVjdC5hc3NpZ24gQCB7fSwgdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xcbiAgICBieVByb3RvY29sW3Byb3RvY29sXSA9IGNiX2Nvbm5lY3RcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgdGhpcywgJ19jb25uZWN0QnlQcm90b2NvbCcsXG4gICAgICBAOiB2YWx1ZTogYnlQcm90b2NvbCwgY29uZmlndXJhYmxlOiB0cnVlXG5cbiAgX3BhcnNlQ29ubmVjdFVSTChjb25uX3VybCkgOjpcbiAgICByZXR1cm4gbmV3IFVSTChjb25uX3VybClcblxuZXhwb3J0IGRlZmF1bHQgTWVzc2FnZUh1YlxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlQbHVnaW5zKGtleSwgcGx1Z2luTGlzdCwgLi4uYXJncykgOjpcbiAgaWYgISBrZXkgOjoga2V5ID0gbnVsbFxuICBmb3IgbGV0IHBsdWdpbiBvZiBwbHVnaW5MaXN0IDo6XG4gICAgaWYgbnVsbCAhPT0ga2V5IDo6IHBsdWdpbiA9IHBsdWdpbltrZXldXG4gICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIHBsdWdpbiA6OlxuICAgICAgcGx1Z2luKC4uLmFyZ3MpXG4iXSwibmFtZXMiOlsiZGlzcENvbnRyb2xCeVR5cGUiLCJyZWN2X2hlbGxvIiwicmVjdl9vbGxlaCIsInJlY3ZfcG9uZyIsInJlY3ZfcGluZyIsInNlbmRfaGVsbG8iLCJjaGFubmVsIiwiZWNfcHViX2lkIiwicm91dGVyIiwicGFja0FuZFNlbmRSYXciLCJ0eXBlIiwiaHViIiwiaWRfcm91dGVyX3NlbGYiLCJkaXNwYXRjaCIsIm1zZyIsImVjX290aGVyX2lkIiwiaGVhZGVyX2J1ZmZlciIsImxlbmd0aCIsImVjX2lkX2htYWMiLCJobWFjX3NlY3JldCIsImlkX3JvdXRlciIsInVucGFja0lkIiwiYm9keV9idWZmZXIiLCJ1bnZlcmlmaWVkUGVlclJvdXRlIiwic2VuZF9vbGxlaCIsInBlZXJfaG1hY19jbGFpbSIsImNvbXBhcmUiLCJ2ZXJpZmllZFBlZXJSb3V0ZSIsInNlbmRfcGluZ3BvbmciLCJwb25nIiwiRGF0ZSIsInRvSVNPU3RyaW5nIiwibG9jYWwiLCJyZW1vdGUiLCJ0b1N0cmluZyIsImRlbHRhIiwidHNfcG9uZyIsImVyciIsInRzX3BpbmciLCJNZXNzYWdlUm91dGVyIiwiaWRfc2VsZiIsIl9yb3V0ZURpc2NvdmVyeSIsInRhcmdldHMiLCJfY3JlYXRlVGFyZ2V0c01hcCIsIk9iamVjdCIsImNyZWF0ZSIsImRlZmluZVByb3BlcnRpZXMiLCJ2YWx1ZSIsIl9pbml0RGlzcGF0Y2giLCJyb3V0ZXMiLCJfY3JlYXRlUm91dGVzTWFwIiwic2V0IiwiYmluZERpc3BhdGNoQ29udHJvbCIsImJpbmREaXNwYXRjaFNlbGYiLCJwcXVldWUiLCJwcm9taXNlUXVldWUiLCJkaXNwYXRjaF9vbmUiLCJiaW5kRGlzcGF0Y2hSb3V0ZSIsIm1zZ0xpc3QiLCJwcSIsIm1hcCIsInRoZW4iLCJlcnJvciIsIk1hcCIsInRpcCIsIlByb21pc2UiLCJyZXNvbHZlIiwicmFjZSIsImRpc2NvdmVyIiwiZGlzcGF0Y2hfcm91dGUiLCJnZXQiLCJ1bmRlZmluZWQiLCJkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZSIsInJlZ2lzdGVyUm91dGUiLCJ1bnJlZ2lzdGVyUm91dGUiLCJvbl9lcnJvcl9pbl9kaXNwYXRjaCIsIlR5cGVFcnJvciIsImhhcyIsImRlbGV0ZSIsInR0bCIsInNlbmRSYXciLCJyZWdpc3RlclBlZXJSb3V0ZSIsImFsbG93VW52ZXJpZmllZFJvdXRlcyIsImNvbnNvbGUiLCJ3YXJuIiwiaWRfdGFyZ2V0IiwidGFyZ2V0IiwiZG51X2Rpc3BhdGNoX3NlbGYiLCJ1bnJlZ2lzdGVyVGFyZ2V0IiwiaGFuZGxlciIsImRudV9kaXNwYXRjaF9jb250cm9sIiwicHJvdG90eXBlIiwiYXNzaWduIiwiY2xlYXJfdGlwIiwiTWVzc2FnZUNoYW5uZWwiLCJFcnJvciIsImFyZ3MiLCJwYWNrUmF3IiwiY29udGV4dCIsIm1zZ19vYmoiLCJwYWNrSlNPTiIsImhlYWRlciIsIkpTT04iLCJzdHJpbmdpZnkiLCJib2R5IiwicGFjayIsInByb3BzIiwiYmluZENoYW5uZWwiLCJiaW5kRGlzcGF0Y2hQYWNrZXRzIiwiYXNBUEkiLCJzZWxmIiwiYXNDaGFubmVsQVBJIiwicGFja2V0UGFyc2VyIiwicGFja01lc3NhZ2UiLCJhc0ludGVybmFsQVBJIiwicGFja01lc3NhZ2VPYmoiLCJiaW5kRGlzcGF0Y2hNc2dSYXciLCJjb3JlX3Byb3BzIiwiZGlzcGF0Y2hNc2dPYmoiLCJfcmF3XyIsImZlZWQiLCJfcGFja2V0UGFyc2VyIiwicGFja2V0U3RyZWFtIiwib25fcmVjdl9kYXRhIiwiZGF0YSIsIk1lc3NhZ2VIdWIiLCJwbHVnaW5MaXN0IiwiX2luaXRfcm91dGVyIiwiX2luaXRfcGFja2V0UGFyc2VyIiwiX2FwaV9jaGFubmVsIiwiX2luaXRfY2hhbm5lbEFQSSIsIl9hcGlfaW50ZXJuYWwiLCJfaW5pdF9pbnRlcm5hbEFQSSIsInBsdWdpbiIsInBsdWdpbkZ1bmN0aW9ucyIsImNvbmNhdCIsIkJhc2VIdWIiLCJfQmFzZUh1Yl8iLCJNZXNzYWdlSHViX1BJIiwiZnJlZXplIiwicGFja0lkIiwiY2xvbmUiLCJjb25uX3VybCIsImNvbm5lY3Rfc2VsZiIsIl9wYXJzZUNvbm5lY3RVUkwiLCJjb25uZWN0IiwiX2Nvbm5lY3RCeVByb3RvY29sIiwicHJvdG9jb2wiLCJjYl9jb25uZWN0IiwiYnlQcm90b2NvbCIsImRlZmluZVByb3BlcnR5IiwiY29uZmlndXJhYmxlIiwiVVJMIiwiYXBwbHlQbHVnaW5zIiwia2V5Il0sIm1hcHBpbmdzIjoiOzs7O0FBQU8sTUFBTUEsb0JBQW9CO0dBQzlCLElBQUQsR0FBUUMsVUFEdUI7R0FFOUIsSUFBRCxHQUFRQyxVQUZ1QjtHQUc5QixJQUFELEdBQVFDLFNBSHVCO0dBSTlCLElBQUQsR0FBUUMsU0FKdUIsRUFBMUI7O0FBUVAsQUFBTyxTQUFTQyxVQUFULENBQW9CQyxPQUFwQixFQUE2QjtRQUM1QixFQUFDQyxTQUFELEtBQWNELFFBQVFFLE1BQTVCO1NBQ09GLFFBQVFHLGNBQVIsQ0FBeUI7ZUFDbkIsQ0FEbUIsRUFDaEJDLE1BQU0sSUFEVTtZQUV0QkgsU0FGc0I7VUFHeEJELFFBQVFLLEdBQVIsQ0FBWUMsY0FBWixFQUh3QixFQUF6QixDQUFQOzs7QUFLRixTQUFTWCxVQUFULENBQW9CWSxRQUFwQixFQUE4QkMsR0FBOUIsRUFBbUNSLE9BQW5DLEVBQTRDO1FBQ3BDUyxjQUFjRCxJQUFJRSxhQUFKLEVBQXBCO01BQ0csTUFBTUQsWUFBWUUsTUFBbEIsSUFBNEJKLFNBQVNLLFVBQXhDLEVBQXFEO1VBQzdDQyxjQUFjTixTQUFTSyxVQUFULEdBQ2hCTCxTQUFTSyxVQUFULENBQW9CSCxXQUFwQixDQURnQixHQUNtQixJQUR2QztlQUVhVCxPQUFiLEVBQXNCYSxXQUF0QjtHQUhGLE1BS0s7VUFDR0MsWUFBWU4sSUFBSU8sUUFBSixDQUFhUCxJQUFJUSxXQUFKLEVBQWIsRUFBZ0MsQ0FBaEMsQ0FBbEI7YUFDU0MsbUJBQVQsQ0FBK0JILFNBQS9CLEVB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
