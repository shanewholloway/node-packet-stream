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
    return this.plugins(...pluginFunctions);
  }
  static plugins(...pluginFunctions) {
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

  get id_self() {
    return this.router.id_self;
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

Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgudW1kLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL2NvbnRyb2xfcHJvdG9jb2wuanN5IiwiLi4vY29kZS9yb3V0ZXIuanN5IiwiLi4vY29kZS9jaGFubmVsLmpzeSIsIi4uL2NvZGUvaHViLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY29uc3QgZGlzcENvbnRyb2xCeVR5cGUgPSBAe31cbiAgWzB4ZjBdOiByZWN2X2hlbGxvXG4gIFsweGYxXTogcmVjdl9vbGxlaFxuICBbMHhmZV06IHJlY3ZfcG9uZ1xuICBbMHhmZl06IHJlY3ZfcGluZ1xuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfaGVsbG8oY2hhbm5lbCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKGRpc3BhdGNoLCBtc2csIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gbXNnLmhlYWRlcl9idWZmZXIoKVxuICBpZiAwICE9PSBlY19vdGhlcl9pZC5sZW5ndGggJiYgZGlzcGF0Y2guZWNfaWRfaG1hYyA6OlxuICAgIGNvbnN0IGhtYWNfc2VjcmV0ID0gZGlzcGF0Y2guZWNfaWRfaG1hY1xuICAgICAgPyBkaXNwYXRjaC5lY19pZF9obWFjKGVjX290aGVyX2lkKSA6IG51bGxcbiAgICBzZW5kX29sbGVoIEAgY2hhbm5lbCwgaG1hY19zZWNyZXRcblxuICBlbHNlIDo6XG4gICAgY29uc3QgaWRfcm91dGVyID0gbXNnLnVucGFja0lkKG1zZy5ib2R5X2J1ZmZlcigpLCAwKVxuICAgIGRpc3BhdGNoLnVudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG5mdW5jdGlvbiBzZW5kX29sbGVoKGNoYW5uZWwsIGhtYWNfc2VjcmV0KSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYxXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBobWFjX3NlY3JldFxuXG5mdW5jdGlvbiByZWN2X29sbGVoKGRpc3BhdGNoLCBtc2csIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gbXNnLmhlYWRlcl9idWZmZXIoKVxuICBjb25zdCBpZF9yb3V0ZXIgPSBtc2cudW5wYWNrSWQoZWNfb3RoZXJfaWQpXG5cbiAgY29uc3QgaG1hY19zZWNyZXQgPSBkaXNwYXRjaC5lY19pZF9obWFjXG4gICAgPyBkaXNwYXRjaC5lY19pZF9obWFjKGVjX290aGVyX2lkLCB0cnVlKSA6IG51bGxcbiAgY29uc3QgcGVlcl9obWFjX2NsYWltID0gbXNnLmJvZHlfYnVmZmVyKClcbiAgaWYgaG1hY19zZWNyZXQgJiYgMCA9PT0gaG1hY19zZWNyZXQuY29tcGFyZSBAIHBlZXJfaG1hY19jbGFpbSA6OlxuICAgIGRpc3BhdGNoLnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG4gIGVsc2UgOjpcbiAgICBkaXNwYXRjaC51bnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9waW5ncG9uZyhjaGFubmVsLCBwb25nKSA6OlxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogcG9uZyA/IDB4ZmUgOiAweGZmXG4gICAgYm9keTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbmZ1bmN0aW9uIHJlY3ZfcG9uZyhkaXNwYXRjaCwgbXNnLCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIG1zZy5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBsb2NhbFxuXG5mdW5jdGlvbiByZWN2X3BpbmcoZGlzcGF0Y2gsIG1zZywgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgc2VuZF9waW5ncG9uZyBAIGNoYW5uZWwsIHRydWVcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIG1zZy5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBsb2NhbFxuXG4iLCJpbXBvcnQge2Rpc3BDb250cm9sQnlUeXBlfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5leHBvcnQgY2xhc3MgTWVzc2FnZVJvdXRlciA6OlxuICBjb25zdHJ1Y3RvcihpZF9zZWxmKSA6OlxuICAgIGlmIGlkX3NlbGYgOjpcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDogaWRfc2VsZjogQDogdmFsdWU6IGlkX3NlbGZcbiAgICAgIHRoaXMuX2luaXREaXNwYXRjaCgpXG5cbiAgLy8gLS0tIERpc3BhdGNoIGNvcmUgLS0tXG5cbiAgX2luaXREaXNwYXRjaCgpIDo6XG4gICAgY29uc3Qgcm91dGVzID0gdGhpcy5fY3JlYXRlUm91dGVzTWFwKClcbiAgICByb3V0ZXMuc2V0IEAgMCwgdGhpcy5iaW5kRGlzcGF0Y2hDb250cm9sKClcbiAgICBpZiBudWxsICE9IHRoaXMuaWRfc2VsZiA6OlxuICAgICAgcm91dGVzLnNldCBAIHRoaXMuaWRfc2VsZiwgdGhpcy5iaW5kRGlzcGF0Y2hTZWxmKClcblxuICAgIGNvbnN0IHBxdWV1ZSA9IHByb21pc2VRdWV1ZSgpXG4gICAgY29uc3QgZGlzcGF0Y2hfb25lID0gdGhpcy5iaW5kRGlzcGF0Y2hSb3V0ZShyb3V0ZXMpXG4gICAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDpcbiAgICAgIHJvdXRlczogQDogdmFsdWU6IHJvdXRlc1xuICAgICAgZGlzcGF0Y2g6IEA6IHZhbHVlOiBkaXNwYXRjaFxuXG4gICAgZnVuY3Rpb24gZGlzcGF0Y2gobXNnTGlzdCwgY2hhbm5lbCkgOjpcbiAgICAgIGNvbnN0IHBxID0gcHF1ZXVlKCkgLy8gcHEgd2lsbCBkaXNwYXRjaCBkdXJpbmcgUHJvbWlzZSByZXNvbHV0aW9uc1xuICAgICAgcmV0dXJuIG1zZ0xpc3QubWFwIEAgbXNnID0+XG4gICAgICAgIHBxLnRoZW4gQCAoKSA9PiBkaXNwYXRjaF9vbmUobXNnLCBjaGFubmVsKVxuXG4gIG9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgbXNnKSA6OlxuICAgIGNvbnNvbGUuZXJyb3IgQCAnRXJyb3IgZHVyaW5nIG1zZyBkaXNwYXRjaFxcbiAgbXNnOicsIG1zZywgJ1xcbicsIGVyciwgJ1xcbidcblxuICBfY3JlYXRlUm91dGVzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byByb3V0ZSAtLS1cblxuICBfcm91dGVEaXNjb3ZlcnkgPSBbXVxuICBkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIsIG1zZykgOjpcbiAgICBjb25zdCB0aXAgPSBQcm9taXNlLnJlc29sdmUoaWRfcm91dGVyKVxuICAgIC8vIFRPRE86IFByb21pc2UucmFjZSBtaWdodCByZXR1cm4gdGhlIGZpcnN0IG51bGzigKYgZGFuZy5cbiAgICByZXR1cm4gUHJvbWlzZS5yYWNlIEBcbiAgICAgIHRoaXMuX3JvdXRlRGlzY292ZXJ5Lm1hcCBAXG4gICAgICAgIGRpc2NvdmVyID0+IHRpcC50aGVuIEAgZGlzY292ZXJcblxuICBiaW5kRGlzcGF0Y2hSb3V0ZShyb3V0ZXMpIDo6XG4gICAgcmV0dXJuIGFzeW5jIChtc2csIGNoYW5uZWwpID0+IDo6XG4gICAgICB0cnkgOjpcbiAgICAgICAgY29uc3QgaWRfcm91dGVyID0gbXNnLmlkX3JvdXRlclxuICAgICAgICBsZXQgZGlzcGF0Y2hfcm91dGUgPSByb3V0ZXMuZ2V0KGlkX3JvdXRlcilcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgIGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIsIG1zZylcbiAgICAgICAgICBpZiBudWxsID09IGRpc3BhdGNoX3JvdXRlIDo6IHJldHVyblxuICAgICAgICAgIHRoaXMucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlKVxuXG4gICAgICAgIGlmIGZhbHNlID09PSBkaXNwYXRjaF9yb3V0ZShtc2csIGNoYW5uZWwpIDo6XG4gICAgICAgICAgdGhpcy51bnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHRoaXMub25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBtc2csIGNoYW5uZWwpXG5cblxuICByZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICBpZiBudWxsICE9IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2Rpc3BhdGNoX3JvdXRlJyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgICAgZWxzZSByZXR1cm4gZmFsc2VcbiAgICBpZiB0aGlzLnJvdXRlcy5oYXMgQCBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgMCA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMuaWRfc2VsZiA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuXG4gICAgdGhpcy5yb3V0ZXMuc2V0IEAgaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZVxuICAgIHJldHVybiB0cnVlXG4gIHVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpIDo6XG4gICAgcmV0dXJuIHRoaXMucm91dGVzLmRlbGV0ZSBAIGlkX3JvdXRlclxuICByZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJSb3V0ZSBAIGlkX3JvdXRlciwgbXNnID0+IDo6XG4gICAgICBpZiAwICE9PSBtc2cudHRsIDo6IGNoYW5uZWwuc2VuZFJhdyhtc2cpXG4gIHZlcmlmaWVkUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gIHVudmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIGlmIHRoaXMuYWxsb3dVbnZlcmlmaWVkUm91dGVzIHx8IGNoYW5uZWwuYWxsb3dVbnZlcmlmaWVkUm91dGVzIDo6XG4gICAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gICAgZWxzZSBjb25zb2xlLndhcm4gQCAnVW52ZXJpZmllZCBwZWVyIHJvdXRlIChpZ25vcmVkKTonLCBAOiBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byBsb2NhbCB0YXJnZXRcblxuICBkbnVfZGlzcGF0Y2hfc2VsZihtc2cpIDo6XG4gIGJpbmREaXNwYXRjaFNlbGYobXNnKSA6OlxuICAgIHJldHVybiBhc3luYyAobXNnLCBjaGFubmVsKSA9PiA6OlxuICAgICAgY29uc3QgaWRfdGFyZ2V0ID0gbXNnLmlkX3RhcmdldFxuICAgICAgbGV0IHRhcmdldCA9IHRoaXMudGFyZ2V0cy5nZXQoaWRfdGFyZ2V0KVxuICAgICAgaWYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgICAgdGFyZ2V0ID0gYXdhaXQgdGhpcy5kbnVfZGlzcGF0Y2hfc2VsZihtc2cpXG4gICAgICAgIGlmIG51bGwgPT0gdGFyZ2V0IDo6IHJldHVyblxuXG4gICAgICBpZiBmYWxzZSA9PT0gdGFyZ2V0KG1zZywgdGhpcykgOjpcbiAgICAgICAgdGhpcy51bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldClcblxuICBfY3JlYXRlVGFyZ2V0c01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcbiAgdGFyZ2V0cyA9IHRoaXMuX2NyZWF0ZVRhcmdldHNNYXAoKVxuICByZWdpc3RlclRhcmdldChpZF90YXJnZXQsIHRhcmdldCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICd0YXJnZXQnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgaWYgdGhpcy50YXJnZXRzLmhhcyBAIGlkX3RhcmdldCA6OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5zZXQgQCBpZF90YXJnZXQsIHRhcmdldFxuICB1bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCkgOjpcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLmRlbGV0ZSBAIGlkX3RhcmdldFxuXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggY29udHJvbCBtZXNzYWdlc1xuXG4gIGJpbmREaXNwYXRjaENvbnRyb2woKSA6OlxuICAgIHJldHVybiAobXNnLCBjaGFubmVsKSA9PiA6OlxuICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMuZGlzcENvbnRyb2xCeVR5cGVbbXNnLnR5cGVdXG4gICAgICBpZiB1bmRlZmluZWQgIT09IGhhbmRsZXIgOjpcbiAgICAgICAgaGFuZGxlcih0aGlzLCBtc2csIGNoYW5uZWwpXG4gICAgICBlbHNlXG4gICAgICAgIHRoaXMuZG51X2Rpc3BhdGNoX2NvbnRyb2wobXNnLCBjaGFubmVsKVxuXG4gIGRpc3BDb250cm9sQnlUeXBlID0gT2JqZWN0LmNyZWF0ZSBAIHRoaXMuZGlzcENvbnRyb2xCeVR5cGVcbiAgZG51X2Rpc3BhdGNoX2NvbnRyb2wobXNnLCBjaGFubmVsKSA6OlxuICAgIGNvbnNvbGUud2FybiBAICdkbnVfZGlzcGF0Y2hfY29udHJvbCcsIG1zZy50eXBlLCBtc2dcblxuXG5NZXNzYWdlUm91dGVyLnByb3RvdHlwZS5kaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5hc3NpZ24gQCB7fVxuICBkaXNwQ29udHJvbEJ5VHlwZVxuXG5leHBvcnQgZGVmYXVsdCBNZXNzYWdlUm91dGVyXG5cblxuZnVuY3Rpb24gcHJvbWlzZVF1ZXVlKCkgOjpcbiAgbGV0IHRpcCA9IG51bGxcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIDo6XG4gICAgaWYgbnVsbCA9PT0gdGlwIDo6XG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgdGlwLnRoZW4gQCBjbGVhcl90aXBcbiAgICByZXR1cm4gdGlwXG5cbiAgZnVuY3Rpb24gY2xlYXJfdGlwKCkgOjpcbiAgICB0aXAgPSBudWxsXG5cbiIsImltcG9ydCB7c2VuZF9oZWxsbywgc2VuZF9waW5ncG9uZ30gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuXG5leHBvcnQgY2xhc3MgTWVzc2FnZUNoYW5uZWwgOjpcbiAgc2VuZFJhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuICBwYWNrUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG4gIHBhY2soLi4uYXJncykgOjogcmV0dXJuIHRoaXMucGFja1JhdyBAIHRoaXMuY29udGV4dCwgLi4uYXJnc1xuXG4gIHBhY2tBbmRTZW5kUmF3KC4uLmFyZ3MpIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja1JhdyBAIC4uLmFyZ3NcblxuICBzZW5kSlNPTihtc2dfb2JqKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tKU09OIEAgbXNnX29ialxuICBwYWNrSlNPTihtc2dfb2JqKSA6OlxuICAgIGlmIHVuZGVmaW5lZCAhPT0gbXNnX29iai5oZWFkZXIgOjpcbiAgICAgIG1zZ19vYmouaGVhZGVyID0gSlNPTi5zdHJpbmdpZnkgQCBtc2dfb2JqLmhlYWRlclxuICAgIGlmIHVuZGVmaW5lZCAhPT0gbXNnX29iai5ib2R5IDo6XG4gICAgICBtc2dfb2JqLmJvZHkgPSBKU09OLnN0cmluZ2lmeSBAIG1zZ19vYmouYm9keVxuXG4gICAgcmV0dXJuIHRoaXMucGFjayhtc2dfb2JqKVxuXG5cbiAgLy8gLS0tIENvbnRyb2wgbWVzc2FnZSB1dGlsaXRpZXNcblxuICBzZW5kUm91dGluZ0hhbmRzaGFrZShjaGFubmVsKSA6OlxuICAgIHJldHVybiBzZW5kX2hlbGxvKHRoaXMsIHRoaXMuZWNfcHViX2lkKVxuICBzZW5kUGluZyhjaGFubmVsKSA6OlxuICAgIHJldHVybiBzZW5kX3Bpbmdwb25nKHRoaXMpXG5cblxuXG4gIGNsb25lKHByb3BzKSA6OiByZXR1cm4gT2JqZWN0LmNyZWF0ZSh0aGlzLCBwcm9wcylcbiAgYmluZENoYW5uZWwoc2VuZFJhdywgcHJvcHMpIDo6IHJldHVybiBiaW5kQ2hhbm5lbCh0aGlzLCBzZW5kUmF3LCBwcm9wcylcbiAgYmluZERpc3BhdGNoUGFja2V0cygpIDo6IHJldHVybiBiaW5kRGlzcGF0Y2hQYWNrZXRzKHRoaXMpXG5cblxuICBzdGF0aWMgYXNBUEkoaHViLCByb3V0ZXIsIHBhY2tSYXcpIDo6XG4gICAgY29uc3Qgc2VsZiA9IG5ldyB0aGlzKClcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHNlbGYsIEA6XG4gICAgICBwYWNrUmF3OiBAOiB2YWx1ZTogcGFja1Jhd1xuICAgICAgcm91dGVyOiBAOiB2YWx1ZTogcm91dGVyXG4gICAgICBodWI6IEA6IHZhbHVlOiBodWJcbiAgICAgIF9yb290XzogQDogdmFsdWU6IHNlbGZcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0NoYW5uZWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja01lc3NhZ2VcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0ludGVybmFsQVBJKGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgY29uc3Qgc2VsZiA9IHRoaXMuYXNBUEkgQCBodWIsIHJvdXRlciwgcGFja2V0UGFyc2VyLnBhY2tNZXNzYWdlT2JqXG4gICAgcmV0dXJuIHNlbGYuYmluZENoYW5uZWwobnVsbClcblxuZXhwb3J0IGRlZmF1bHQgTWVzc2FnZUNoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kQ2hhbm5lbChjaGFubmVsLCBzZW5kUmF3LCBwcm9wcykgOjpcbiAgaWYgbnVsbCA9PSBzZW5kUmF3IDo6XG4gICAgc2VuZFJhdyA9IGJpbmREaXNwYXRjaE1zZ1JhdyhjaGFubmVsLnJvdXRlcilcbiAgZWxzZSBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2Ygc2VuZFJhdyA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgQ2hhbm5lbCBleHBlY3RzICdzZW5kUmF3JyBmdW5jdGlvbiBwYXJhbWV0ZXJgXG5cbiAgY29uc3QgY29yZV9wcm9wcyA9IEA6IHNlbmRSYXc6IEB7fSB2YWx1ZTogc2VuZFJhd1xuICBwcm9wcyA9IG51bGwgPT0gcHJvcHMgPyBjb3JlX3Byb3BzIDogT2JqZWN0LmFzc2lnbiBAIGNvcmVfcHJvcHMsIHByb3BzXG5cbiAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUgQCBjaGFubmVsLCBwcm9wc1xuICByZXR1cm4gc2VuZFJhdy5jaGFubmVsID0gc2VsZlxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kRGlzcGF0Y2hNc2dSYXcocm91dGVyKSA6OlxuICBjb25zdCBkaXNwYXRjaCA9IHJvdXRlci5kaXNwYXRjaFxuICByZXR1cm4gZGlzcGF0Y2hNc2dPYmpcblxuICBmdW5jdGlvbiBkaXNwYXRjaE1zZ09iaihtc2cpIDo6XG4gICAgaWYgdW5kZWZpbmVkID09PSBtc2cuX3Jhd18gOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgYSBwYXJzZWQgbXNnX29iaiB3aXRoIHZhbGlkICdfcmF3XycgYnVmZmVyIHByb3BlcnR5YFxuICAgIGRpc3BhdGNoIEAgW21zZ10sIGRpc3BhdGNoTXNnT2JqLmNoYW5uZWxcbiAgICByZXR1cm4gdHJ1ZVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kRGlzcGF0Y2hQYWNrZXRzKGNoYW5uZWwpIDo6XG4gIGNvbnN0IGRpc3BhdGNoID0gY2hhbm5lbC5yb3V0ZXIuZGlzcGF0Y2hcbiAgY29uc3QgZmVlZCA9IGNoYW5uZWwuaHViLl9wYWNrZXRQYXJzZXIucGFja2V0U3RyZWFtKClcblxuICByZXR1cm4gZnVuY3Rpb24gb25fcmVjdl9kYXRhKGRhdGEpIDo6XG4gICAgY29uc3QgbXNnTGlzdCA9IGZlZWQoZGF0YSlcbiAgICBpZiAwIDwgbXNnTGlzdC5sZW5ndGggOjpcbiAgICAgIGRpc3BhdGNoIEAgbXNnTGlzdCwgY2hhbm5lbFxuIiwiaW1wb3J0IHtNZXNzYWdlUm91dGVyfSBmcm9tICcuL3JvdXRlci5qc3knXG5pbXBvcnQge01lc3NhZ2VDaGFubmVsfSBmcm9tICcuL2NoYW5uZWwuanN5J1xuXG5leHBvcnQgY2xhc3MgTWVzc2FnZUh1YiA6OlxuICBjb25zdHJ1Y3RvcigpIDo6XG4gICAgYXBwbHlQbHVnaW5zIEAgJ3ByZScsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuXG4gICAgY29uc3Qgcm91dGVyID0gdGhpcy5faW5pdF9yb3V0ZXIoKVxuICAgIGNvbnN0IF9wYWNrZXRQYXJzZXIgPSB0aGlzLl9pbml0X3BhY2tldFBhcnNlcigpXG4gICAgY29uc3QgX2FwaV9jaGFubmVsID0gdGhpcy5faW5pdF9jaGFubmVsQVBJKHJvdXRlciwgX3BhY2tldFBhcnNlcilcbiAgICBjb25zdCBfYXBpX2ludGVybmFsID0gdGhpcy5faW5pdF9pbnRlcm5hbEFQSShyb3V0ZXIsIF9wYWNrZXRQYXJzZXIpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAe31cbiAgICAgIHJvdXRlcjogQHt9IHZhbHVlOiByb3V0ZXJcbiAgICAgIF9wYWNrZXRQYXJzZXI6IEB7fSB2YWx1ZTogX3BhY2tldFBhcnNlclxuICAgICAgX2FwaV9jaGFubmVsOiBAe30gdmFsdWU6IF9hcGlfY2hhbm5lbFxuICAgICAgX2FwaV9pbnRlcm5hbDogQHt9IHZhbHVlOiBfYXBpX2ludGVybmFsXG5cbiAgICBhcHBseVBsdWdpbnMgQCBudWxsLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICBhcHBseVBsdWdpbnMgQCAncG9zdCcsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIHJldHVybiB0aGlzXG5cbiAgX2luaXRfcm91dGVyKCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYFBsdWdpbiByZXNwb25zaWJsaXR5YFxuICBfaW5pdF9wYWNrZXRQYXJzZXIoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgUGx1Z2luIHJlc3BvbnNpYmxpdHlgXG5cbiAgX2luaXRfY2hhbm5lbEFQSShyb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gTWVzc2FnZUNoYW5uZWwuYXNDaGFubmVsQVBJIEBcbiAgICAgIHRoaXMsIHJvdXRlciwgcGFja2V0UGFyc2VyXG4gIF9pbml0X2ludGVybmFsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiBNZXNzYWdlQ2hhbm5lbC5hc0ludGVybmFsQVBJIEBcbiAgICAgIHRoaXMsIHJvdXRlciwgcGFja2V0UGFyc2VyXG5cblxuICBzdGF0aWMgcGx1Z2luKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICByZXR1cm4gdGhpcy5wbHVnaW5zKC4uLnBsdWdpbkZ1bmN0aW9ucylcbiAgc3RhdGljIHBsdWdpbnMoLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIGNvbnN0IHBsdWdpbkxpc3QgPSBbXS5jb25jYXQgQFxuICAgICAgdGhpcy5wcm90b3R5cGUucGx1Z2luTGlzdCB8fCBbXVxuICAgICAgcGx1Z2luRnVuY3Rpb25zXG5cbiAgICBjb25zdCBCYXNlSHViID0gdGhpcy5fQmFzZUh1Yl8gfHwgdGhpc1xuICAgIGNsYXNzIE1lc3NhZ2VIdWJfUEkgZXh0ZW5kcyBCYXNlSHViIDo6XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBNZXNzYWdlSHViX1BJLnByb3RvdHlwZSwgQDpcbiAgICAgIHBsdWdpbkxpc3Q6IEB7fSB2YWx1ZTogT2JqZWN0LmZyZWV6ZSBAIHBsdWdpbkxpc3RcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIE1lc3NhZ2VIdWJfUEksIEA6XG4gICAgICBfQmFzZUh1Yl86IEB7fSB2YWx1ZTogQmFzZUh1YlxuXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3N1YmNsYXNzJywgcGx1Z2luTGlzdCwgTWVzc2FnZUh1Yl9QSSwgQDogTWVzc2FnZVJvdXRlciwgTWVzc2FnZUNoYW5uZWxcbiAgICByZXR1cm4gTWVzc2FnZUh1Yl9QSVxuXG5cbiAgZ2V0IGlkX3NlbGYoKSA6OlxuICAgIHJldHVybiB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGlkX3JvdXRlcl9zZWxmKCkgOjpcbiAgICByZXR1cm4gdGhpcy5fcGFja2V0UGFyc2VyLnBhY2tJZCBAXG4gICAgICB0aGlzLnJvdXRlci5pZF9zZWxmXG4gIGNvbm5lY3Rfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMuX2FwaV9pbnRlcm5hbC5jbG9uZSgpXG5cbiAgY29ubmVjdChjb25uX3VybCkgOjpcbiAgICBpZiBudWxsID09IGNvbm5fdXJsIDo6XG4gICAgICByZXR1cm4gdGhpcy5jb25uZWN0X3NlbGYoKVxuXG4gICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBjb25uX3VybCA6OlxuICAgICAgY29ubl91cmwgPSB0aGlzLl9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpXG5cbiAgICBjb25zdCBjb25uZWN0ID0gdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xbY29ubl91cmwucHJvdG9jb2xdXG4gICAgaWYgISBjb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IgQCBgQ29ubmVjdGlvbiBwcm90b2NvbCBcIiR7Y29ubl91cmwucHJvdG9jb2x9XCIgbm90IHJlZ2lzdGVyZWQgZm9yIFwiJHtjb25uX3VybC50b1N0cmluZygpfVwiYFxuXG4gICAgcmV0dXJuIGNvbm5lY3QoY29ubl91cmwpXG5cbiAgcmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wocHJvdG9jb2wsIGNiX2Nvbm5lY3QpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNiX2Nvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2NiX2Nvbm5lY3QnIGZ1bmN0aW9uYFxuICAgIGNvbnN0IGJ5UHJvdG9jb2wgPSBPYmplY3QuYXNzaWduIEAge30sIHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sXG4gICAgYnlQcm90b2NvbFtwcm90b2NvbF0gPSBjYl9jb25uZWN0XG4gICAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIHRoaXMsICdfY29ubmVjdEJ5UHJvdG9jb2wnLFxuICAgICAgQDogdmFsdWU6IGJ5UHJvdG9jb2wsIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuXG4gIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgcmV0dXJuIG5ldyBVUkwoY29ubl91cmwpXG5cbmV4cG9ydCBkZWZhdWx0IE1lc3NhZ2VIdWJcblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGx1Z2lucyhrZXksIHBsdWdpbkxpc3QsIC4uLmFyZ3MpIDo6XG4gIGlmICEga2V5IDo6IGtleSA9IG51bGxcbiAgZm9yIGxldCBwbHVnaW4gb2YgcGx1Z2luTGlzdCA6OlxuICAgIGlmIG51bGwgIT09IGtleSA6OiBwbHVnaW4gPSBwbHVnaW5ba2V5XVxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBwbHVnaW4gOjpcbiAgICAgIHBsdWdpbiguLi5hcmdzKVxuIl0sIm5hbWVzIjpbImRpc3BDb250cm9sQnlUeXBlIiwicmVjdl9oZWxsbyIsInJlY3Zfb2xsZWgiLCJyZWN2X3BvbmciLCJyZWN2X3BpbmciLCJzZW5kX2hlbGxvIiwiY2hhbm5lbCIsImVjX3B1Yl9pZCIsInJvdXRlciIsInBhY2tBbmRTZW5kUmF3IiwidHlwZSIsImh1YiIsImlkX3JvdXRlcl9zZWxmIiwiZGlzcGF0Y2giLCJtc2ciLCJlY19vdGhlcl9pZCIsImhlYWRlcl9idWZmZXIiLCJsZW5ndGgiLCJlY19pZF9obWFjIiwiaG1hY19zZWNyZXQiLCJpZF9yb3V0ZXIiLCJ1bnBhY2tJZCIsImJvZHlfYnVmZmVyIiwidW52ZXJpZmllZFBlZXJSb3V0ZSIsInNlbmRfb2xsZWgiLCJwZWVyX2htYWNfY2xhaW0iLCJjb21wYXJlIiwidmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX3Bpbmdwb25nIiwicG9uZyIsIkRhdGUiLCJ0b0lTT1N0cmluZyIsImxvY2FsIiwicmVtb3RlIiwidG9TdHJpbmciLCJkZWx0YSIsInRzX3BvbmciLCJlcnIiLCJ0c19waW5nIiwiTWVzc2FnZVJvdXRlciIsImlkX3NlbGYiLCJfcm91dGVEaXNjb3ZlcnkiLCJ0YXJnZXRzIiwiX2NyZWF0ZVRhcmdldHNNYXAiLCJPYmplY3QiLCJjcmVhdGUiLCJkZWZpbmVQcm9wZXJ0aWVzIiwidmFsdWUiLCJfaW5pdERpc3BhdGNoIiwicm91dGVzIiwiX2NyZWF0ZVJvdXRlc01hcCIsInNldCIsImJpbmREaXNwYXRjaENvbnRyb2wiLCJiaW5kRGlzcGF0Y2hTZWxmIiwicHF1ZXVlIiwicHJvbWlzZVF1ZXVlIiwiZGlzcGF0Y2hfb25lIiwiYmluZERpc3BhdGNoUm91dGUiLCJtc2dMaXN0IiwicHEiLCJtYXAiLCJ0aGVuIiwiZXJyb3IiLCJNYXAiLCJ0aXAiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJhY2UiLCJkaXNjb3ZlciIsImRpc3BhdGNoX3JvdXRlIiwiZ2V0IiwidW5kZWZpbmVkIiwiZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUiLCJyZWdpc3RlclJvdXRlIiwidW5yZWdpc3RlclJvdXRlIiwib25fZXJyb3JfaW5fZGlzcGF0Y2giLCJUeXBlRXJyb3IiLCJoYXMiLCJkZWxldGUiLCJ0dGwiLCJzZW5kUmF3IiwicmVnaXN0ZXJQZWVyUm91dGUiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJjb25zb2xlIiwid2FybiIsImlkX3RhcmdldCIsInRhcmdldCIsImRudV9kaXNwYXRjaF9zZWxmIiwidW5yZWdpc3RlclRhcmdldCIsImhhbmRsZXIiLCJkbnVfZGlzcGF0Y2hfY29udHJvbCIsInByb3RvdHlwZSIsImFzc2lnbiIsImNsZWFyX3RpcCIsIk1lc3NhZ2VDaGFubmVsIiwiRXJyb3IiLCJhcmdzIiwicGFja1JhdyIsImNvbnRleHQiLCJtc2dfb2JqIiwicGFja0pTT04iLCJoZWFkZXIiLCJKU09OIiwic3RyaW5naWZ5IiwiYm9keSIsInBhY2siLCJwcm9wcyIsImJpbmRDaGFubmVsIiwiYmluZERpc3BhdGNoUGFja2V0cyIsImFzQVBJIiwic2VsZiIsImFzQ2hhbm5lbEFQSSIsInBhY2tldFBhcnNlciIsInBhY2tNZXNzYWdlIiwiYXNJbnRlcm5hbEFQSSIsInBhY2tNZXNzYWdlT2JqIiwiYmluZERpc3BhdGNoTXNnUmF3IiwiY29yZV9wcm9wcyIsImRpc3BhdGNoTXNnT2JqIiwiX3Jhd18iLCJmZWVkIiwiX3BhY2tldFBhcnNlciIsInBhY2tldFN0cmVhbSIsIm9uX3JlY3ZfZGF0YSIsImRhdGEiLCJNZXNzYWdlSHViIiwicGx1Z2luTGlzdCIsIl9pbml0X3JvdXRlciIsIl9pbml0X3BhY2tldFBhcnNlciIsIl9hcGlfY2hhbm5lbCIsIl9pbml0X2NoYW5uZWxBUEkiLCJfYXBpX2ludGVybmFsIiwiX2luaXRfaW50ZXJuYWxBUEkiLCJwbHVnaW4iLCJwbHVnaW5GdW5jdGlvbnMiLCJwbHVnaW5zIiwiY29uY2F0IiwiQmFzZUh1YiIsIl9CYXNlSHViXyIsIk1lc3NhZ2VIdWJfUEkiLCJmcmVlemUiLCJwYWNrSWQiLCJjbG9uZSIsImNvbm5fdXJsIiwiY29ubmVjdF9zZWxmIiwiX3BhcnNlQ29ubmVjdFVSTCIsImNvbm5lY3QiLCJfY29ubmVjdEJ5UHJvdG9jb2wiLCJwcm90b2NvbCIsImNiX2Nvbm5lY3QiLCJieVByb3RvY29sIiwiZGVmaW5lUHJvcGVydHkiLCJjb25maWd1cmFibGUiLCJVUkwiLCJhcHBseVBsdWdpbnMiLCJrZXkiXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFPLE1BQU1BLG9CQUFvQjtHQUM5QixJQUFELEdBQVFDLFVBRHVCO0dBRTlCLElBQUQsR0FBUUMsVUFGdUI7R0FHOUIsSUFBRCxHQUFRQyxTQUh1QjtHQUk5QixJQUFELEdBQVFDLFNBSnVCLEVBQTFCOztBQVFQLEFBQU8sU0FBU0MsVUFBVCxDQUFvQkMsT0FBcEIsRUFBNkI7UUFDNUIsRUFBQ0MsU0FBRCxLQUFjRCxRQUFRRSxNQUE1QjtTQUNPRixRQUFRRyxjQUFSLENBQXlCO2VBQ25CLENBRG1CLEVBQ2hCQyxNQUFNLElBRFU7WUFFdEJILFNBRnNCO1VBR3hCRCxRQUFRSyxHQUFSLENBQVlDLGNBQVosRUFId0IsRUFBekIsQ0FBUDs7O0FBS0YsU0FBU1gsVUFBVCxDQUFvQlksUUFBcEIsRUFBOEJDLEdBQTlCLEVBQW1DUixPQUFuQyxFQUE0QztRQUNwQ1MsY0FBY0QsSUFBSUUsYUFBSixFQUFwQjtNQUNHLE1BQU1ELFlBQVlFLE1BQWxCLElBQTRCSixTQUFTSyxVQUF4QyxFQUFxRDtVQUM3Q0MsY0FBY04sU0FBU0ssVUFBVCxHQUNoQkwsU0FBU0ssVUFBVCxD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
