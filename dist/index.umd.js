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

Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgudW1kLmpzIiwic291cmNlcyI6WyIuLi9jb2RlL2NvbnRyb2xfcHJvdG9jb2wuanN5IiwiLi4vY29kZS9yb3V0ZXIuanN5IiwiLi4vY29kZS9jaGFubmVsLmpzeSIsIi4uL2NvZGUvaHViLmpzeSJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY29uc3QgZGlzcENvbnRyb2xCeVR5cGUgPSBAe31cbiAgWzB4ZjBdOiByZWN2X2hlbGxvXG4gIFsweGYxXTogcmVjdl9vbGxlaFxuICBbMHhmZV06IHJlY3ZfcG9uZ1xuICBbMHhmZl06IHJlY3ZfcGluZ1xuXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHNlbmRfaGVsbG8oY2hhbm5lbCkgOjpcbiAgY29uc3Qge2VjX3B1Yl9pZH0gPSBjaGFubmVsLnJvdXRlclxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogMHhmMFxuICAgIGhlYWRlcjogZWNfcHViX2lkXG4gICAgYm9keTogY2hhbm5lbC5odWIuaWRfcm91dGVyX3NlbGYoKVxuXG5mdW5jdGlvbiByZWN2X2hlbGxvKGRpc3BhdGNoLCBtc2csIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gbXNnLmhlYWRlcl9idWZmZXIoKVxuICBpZiAwICE9PSBlY19vdGhlcl9pZC5sZW5ndGggJiYgZGlzcGF0Y2guZWNfaWRfaG1hYyA6OlxuICAgIGNvbnN0IGhtYWNfc2VjcmV0ID0gZGlzcGF0Y2guZWNfaWRfaG1hY1xuICAgICAgPyBkaXNwYXRjaC5lY19pZF9obWFjKGVjX290aGVyX2lkKSA6IG51bGxcbiAgICBzZW5kX29sbGVoIEAgY2hhbm5lbCwgaG1hY19zZWNyZXRcblxuICBlbHNlIDo6XG4gICAgY29uc3QgaWRfcm91dGVyID0gbXNnLnVucGFja0lkKG1zZy5ib2R5X2J1ZmZlcigpLCAwKVxuICAgIGRpc3BhdGNoLnVudmVyaWZpZWRQZWVyUm91dGUgQCBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG5mdW5jdGlvbiBzZW5kX29sbGVoKGNoYW5uZWwsIGhtYWNfc2VjcmV0KSA6OlxuICBjb25zdCB7ZWNfcHViX2lkfSA9IGNoYW5uZWwucm91dGVyXG4gIHJldHVybiBjaGFubmVsLnBhY2tBbmRTZW5kUmF3IEA6XG4gICAgaWRfcm91dGVyOiAwLCB0eXBlOiAweGYxXG4gICAgaGVhZGVyOiBlY19wdWJfaWRcbiAgICBib2R5OiBobWFjX3NlY3JldFxuXG5mdW5jdGlvbiByZWN2X29sbGVoKGRpc3BhdGNoLCBtc2csIGNoYW5uZWwpIDo6XG4gIGNvbnN0IGVjX290aGVyX2lkID0gbXNnLmhlYWRlcl9idWZmZXIoKVxuICBjb25zdCBpZF9yb3V0ZXIgPSBtc2cudW5wYWNrSWQoZWNfb3RoZXJfaWQpXG5cbiAgY29uc3QgaG1hY19zZWNyZXQgPSBkaXNwYXRjaC5lY19pZF9obWFjXG4gICAgPyBkaXNwYXRjaC5lY19pZF9obWFjKGVjX290aGVyX2lkLCB0cnVlKSA6IG51bGxcbiAgY29uc3QgcGVlcl9obWFjX2NsYWltID0gbXNnLmJvZHlfYnVmZmVyKClcbiAgaWYgaG1hY19zZWNyZXQgJiYgMCA9PT0gaG1hY19zZWNyZXQuY29tcGFyZSBAIHBlZXJfaG1hY19jbGFpbSA6OlxuICAgIGRpc3BhdGNoLnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG4gIGVsc2UgOjpcbiAgICBkaXNwYXRjaC51bnZlcmlmaWVkUGVlclJvdXRlIEAgaWRfcm91dGVyLCBjaGFubmVsXG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc2VuZF9waW5ncG9uZyhjaGFubmVsLCBwb25nKSA6OlxuICByZXR1cm4gY2hhbm5lbC5wYWNrQW5kU2VuZFJhdyBAOlxuICAgIGlkX3JvdXRlcjogMCwgdHlwZTogcG9uZyA/IDB4ZmUgOiAweGZmXG4gICAgYm9keTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbmZ1bmN0aW9uIHJlY3ZfcG9uZyhkaXNwYXRjaCwgbXNnLCBjaGFubmVsKSA6OlxuICBjb25zdCBsb2NhbCA9IG5ldyBEYXRlKClcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIG1zZy5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19wb25nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcG9uZyA9IEB7fSBsb2NhbFxuXG5mdW5jdGlvbiByZWN2X3BpbmcoZGlzcGF0Y2gsIG1zZywgY2hhbm5lbCkgOjpcbiAgY29uc3QgbG9jYWwgPSBuZXcgRGF0ZSgpXG5cbiAgc2VuZF9waW5ncG9uZyBAIGNoYW5uZWwsIHRydWVcblxuICB0cnkgOjpcbiAgICBjb25zdCByZW1vdGUgPSBuZXcgRGF0ZSBAIG1zZy5ib2R5X2J1ZmZlcigpLnRvU3RyaW5nKClcbiAgICBjb25zdCBkZWx0YSA9IHJlbW90ZSAtIGxvY2FsXG4gICAgY2hhbm5lbC50c19waW5nID0gQHt9IGRlbHRhLCByZW1vdGUsIGxvY2FsXG4gIGNhdGNoIGVyciA6OlxuICAgIGNoYW5uZWwudHNfcGluZyA9IEB7fSBsb2NhbFxuXG4iLCJpbXBvcnQge2Rpc3BDb250cm9sQnlUeXBlfSBmcm9tICcuL2NvbnRyb2xfcHJvdG9jb2wuanN5J1xuXG5leHBvcnQgY2xhc3MgTWVzc2FnZVJvdXRlciA6OlxuICBjb25zdHJ1Y3RvcihpZF9zZWxmKSA6OlxuICAgIGlmIGlkX3NlbGYgOjpcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDogaWRfc2VsZjogQDogdmFsdWU6IGlkX3NlbGZcbiAgICAgIHRoaXMuX2luaXREaXNwYXRjaCgpXG5cbiAgLy8gLS0tIERpc3BhdGNoIGNvcmUgLS0tXG5cbiAgX2luaXREaXNwYXRjaCgpIDo6XG4gICAgY29uc3Qgcm91dGVzID0gdGhpcy5fY3JlYXRlUm91dGVzTWFwKClcbiAgICByb3V0ZXMuc2V0IEAgMCwgdGhpcy5iaW5kRGlzcGF0Y2hDb250cm9sKClcbiAgICBpZiBudWxsICE9IHRoaXMuaWRfc2VsZiA6OlxuICAgICAgcm91dGVzLnNldCBAIHRoaXMuaWRfc2VsZiwgdGhpcy5iaW5kRGlzcGF0Y2hTZWxmKClcblxuICAgIGNvbnN0IHBxdWV1ZSA9IHByb21pc2VRdWV1ZSgpXG4gICAgY29uc3QgZGlzcGF0Y2hfb25lID0gdGhpcy5iaW5kRGlzcGF0Y2hSb3V0ZShyb3V0ZXMpXG4gICAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDpcbiAgICAgIHJvdXRlczogQDogdmFsdWU6IHJvdXRlc1xuICAgICAgZGlzcGF0Y2g6IEA6IHZhbHVlOiBkaXNwYXRjaFxuXG4gICAgZnVuY3Rpb24gZGlzcGF0Y2gobXNnTGlzdCwgY2hhbm5lbCkgOjpcbiAgICAgIGNvbnN0IHBxID0gcHF1ZXVlKCkgLy8gcHEgd2lsbCBkaXNwYXRjaCBkdXJpbmcgUHJvbWlzZSByZXNvbHV0aW9uc1xuICAgICAgcmV0dXJuIG1zZ0xpc3QubWFwIEAgbXNnID0+XG4gICAgICAgIHBxLnRoZW4gQCAoKSA9PiBkaXNwYXRjaF9vbmUobXNnLCBjaGFubmVsKVxuXG4gIG9uX2Vycm9yX2luX2Rpc3BhdGNoKGVyciwgbXNnKSA6OlxuICAgIGNvbnNvbGUuZXJyb3IgQCAnRXJyb3IgZHVyaW5nIG1zZyBkaXNwYXRjaFxcbiAgbXNnOicsIG1zZywgJ1xcbicsIGVyciwgJ1xcbidcblxuICBfY3JlYXRlUm91dGVzTWFwKCkgOjogcmV0dXJuIG5ldyBNYXAoKVxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byByb3V0ZSAtLS1cblxuICBfcm91dGVEaXNjb3ZlcnkgPSBbXVxuICBkaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIsIG1zZykgOjpcbiAgICBjb25zdCB0aXAgPSBQcm9taXNlLnJlc29sdmUoaWRfcm91dGVyKVxuICAgIC8vIFRPRE86IFByb21pc2UucmFjZSBtaWdodCByZXR1cm4gdGhlIGZpcnN0IG51bGzigKYgZGFuZy5cbiAgICByZXR1cm4gUHJvbWlzZS5yYWNlIEBcbiAgICAgIHRoaXMuX3JvdXRlRGlzY292ZXJ5Lm1hcCBAXG4gICAgICAgIGRpc2NvdmVyID0+IHRpcC50aGVuIEAgZGlzY292ZXJcblxuICBiaW5kRGlzcGF0Y2hSb3V0ZShyb3V0ZXMpIDo6XG4gICAgcmV0dXJuIGFzeW5jIChtc2csIGNoYW5uZWwpID0+IDo6XG4gICAgICB0cnkgOjpcbiAgICAgICAgY29uc3QgaWRfcm91dGVyID0gbXNnLmlkX3JvdXRlclxuICAgICAgICBsZXQgZGlzcGF0Y2hfcm91dGUgPSByb3V0ZXMuZ2V0KGlkX3JvdXRlcilcbiAgICAgICAgaWYgdW5kZWZpbmVkID09PSBkaXNwYXRjaF9yb3V0ZSA6OlxuICAgICAgICAgIGRpc3BhdGNoX3JvdXRlID0gYXdhaXQgdGhpcy5kaXNwYXRjaF9kaXNjb3Zlcl9yb3V0ZShpZF9yb3V0ZXIsIG1zZylcbiAgICAgICAgICBpZiBudWxsID09IGRpc3BhdGNoX3JvdXRlIDo6IHJldHVyblxuICAgICAgICAgIHRoaXMucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIsIGRpc3BhdGNoX3JvdXRlKVxuXG4gICAgICAgIGlmIGZhbHNlID09PSBkaXNwYXRjaF9yb3V0ZShtc2csIGNoYW5uZWwpIDo6XG4gICAgICAgICAgdGhpcy51bnJlZ2lzdGVyUm91dGUoaWRfcm91dGVyKVxuICAgICAgY2F0Y2ggZXJyIDo6XG4gICAgICAgIHRoaXMub25fZXJyb3JfaW5fZGlzcGF0Y2goZXJyLCBtc2csIGNoYW5uZWwpXG5cblxuICByZWdpc3RlclJvdXRlKGlkX3JvdXRlciwgZGlzcGF0Y2hfcm91dGUpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICBpZiBudWxsICE9IGRpc3BhdGNoX3JvdXRlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2Rpc3BhdGNoX3JvdXRlJyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgICAgZWxzZSByZXR1cm4gZmFsc2VcbiAgICBpZiB0aGlzLnJvdXRlcy5oYXMgQCBpZF9yb3V0ZXIgOjogcmV0dXJuIGZhbHNlXG4gICAgaWYgMCA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuICAgIGlmIHRoaXMuaWRfc2VsZiA9PT0gaWRfcm91dGVyIDo6IHJldHVybiBmYWxzZVxuXG4gICAgdGhpcy5yb3V0ZXMuc2V0IEAgaWRfcm91dGVyLCBkaXNwYXRjaF9yb3V0ZVxuICAgIHJldHVybiB0cnVlXG4gIHVucmVnaXN0ZXJSb3V0ZShpZF9yb3V0ZXIpIDo6XG4gICAgcmV0dXJuIHRoaXMucm91dGVzLmRlbGV0ZSBAIGlkX3JvdXRlclxuICByZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJSb3V0ZSBAIGlkX3JvdXRlciwgbXNnID0+IDo6XG4gICAgICBpZiAwICE9PSBtc2cudHRsIDo6IGNoYW5uZWwuc2VuZFJhdyhtc2cpXG4gIHZlcmlmaWVkUGVlclJvdXRlKGlkX3JvdXRlciwgY2hhbm5lbCkgOjpcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gIHVudmVyaWZpZWRQZWVyUm91dGUoaWRfcm91dGVyLCBjaGFubmVsKSA6OlxuICAgIGlmIHRoaXMuYWxsb3dVbnZlcmlmaWVkUm91dGVzIHx8IGNoYW5uZWwuYWxsb3dVbnZlcmlmaWVkUm91dGVzIDo6XG4gICAgICByZXR1cm4gdGhpcy5yZWdpc3RlclBlZXJSb3V0ZShpZF9yb3V0ZXIsIGNoYW5uZWwpXG4gICAgZWxzZSBjb25zb2xlLndhcm4gQCAnVW52ZXJpZmllZCBwZWVyIHJvdXRlIChpZ25vcmVkKTonLCBAOiBpZF9yb3V0ZXIsIGNoYW5uZWxcblxuXG4gIC8vIC0tLSBEaXNwYXRjaCB0byBsb2NhbCB0YXJnZXRcblxuICBkbnVfZGlzcGF0Y2hfc2VsZihtc2cpIDo6XG4gIGJpbmREaXNwYXRjaFNlbGYobXNnKSA6OlxuICAgIHJldHVybiBhc3luYyAobXNnLCBjaGFubmVsKSA9PiA6OlxuICAgICAgY29uc3QgaWRfdGFyZ2V0ID0gbXNnLmlkX3RhcmdldFxuICAgICAgbGV0IHRhcmdldCA9IHRoaXMudGFyZ2V0cy5nZXQoaWRfdGFyZ2V0KVxuICAgICAgaWYgdW5kZWZpbmVkID09PSB0YXJnZXQgOjpcbiAgICAgICAgdGFyZ2V0ID0gYXdhaXQgdGhpcy5kbnVfZGlzcGF0Y2hfc2VsZihtc2cpXG4gICAgICAgIGlmIG51bGwgPT0gdGFyZ2V0IDo6IHJldHVyblxuXG4gICAgICBpZiBmYWxzZSA9PT0gdGFyZ2V0KG1zZywgdGhpcykgOjpcbiAgICAgICAgdGhpcy51bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldClcblxuICBfY3JlYXRlVGFyZ2V0c01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcbiAgdGFyZ2V0cyA9IHRoaXMuX2NyZWF0ZVRhcmdldHNNYXAoKVxuICByZWdpc3RlclRhcmdldChpZF90YXJnZXQsIHRhcmdldCkgOjpcbiAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgdGFyZ2V0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICd0YXJnZXQnIHRvIGJlIGEgZnVuY3Rpb25gXG4gICAgaWYgdGhpcy50YXJnZXRzLmhhcyBAIGlkX3RhcmdldCA6OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIHRoaXMudGFyZ2V0cy5zZXQgQCBpZF90YXJnZXQsIHRhcmdldFxuICB1bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCkgOjpcbiAgICByZXR1cm4gdGhpcy50YXJnZXRzLmRlbGV0ZSBAIGlkX3RhcmdldFxuXG5cblxuICAvLyAtLS0gRGlzcGF0Y2ggY29udHJvbCBtZXNzYWdlc1xuXG4gIGJpbmREaXNwYXRjaENvbnRyb2woKSA6OlxuICAgIHJldHVybiAobXNnLCBjaGFubmVsKSA9PiA6OlxuICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMuZGlzcENvbnRyb2xCeVR5cGVbbXNnLnR5cGVdXG4gICAgICBpZiB1bmRlZmluZWQgIT09IGhhbmRsZXIgOjpcbiAgICAgICAgaGFuZGxlcih0aGlzLCBtc2csIGNoYW5uZWwpXG4gICAgICBlbHNlXG4gICAgICAgIHRoaXMuZG51X2Rpc3BhdGNoX2NvbnRyb2wobXNnLCBjaGFubmVsKVxuXG4gIGRpc3BDb250cm9sQnlUeXBlID0gT2JqZWN0LmNyZWF0ZSBAIHRoaXMuZGlzcENvbnRyb2xCeVR5cGVcbiAgZG51X2Rpc3BhdGNoX2NvbnRyb2wobXNnLCBjaGFubmVsKSA6OlxuICAgIGNvbnNvbGUud2FybiBAICdkbnVfZGlzcGF0Y2hfY29udHJvbCcsIG1zZy50eXBlLCBtc2dcblxuXG5NZXNzYWdlUm91dGVyLnByb3RvdHlwZS5kaXNwQ29udHJvbEJ5VHlwZSA9IE9iamVjdC5hc3NpZ24gQCB7fVxuICBkaXNwQ29udHJvbEJ5VHlwZVxuXG5leHBvcnQgZGVmYXVsdCBNZXNzYWdlUm91dGVyXG5cblxuZnVuY3Rpb24gcHJvbWlzZVF1ZXVlKCkgOjpcbiAgbGV0IHRpcCA9IG51bGxcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIDo6XG4gICAgaWYgbnVsbCA9PT0gdGlwIDo6XG4gICAgICB0aXAgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgdGlwLnRoZW4gQCBjbGVhcl90aXBcbiAgICByZXR1cm4gdGlwXG5cbiAgZnVuY3Rpb24gY2xlYXJfdGlwKCkgOjpcbiAgICB0aXAgPSBudWxsXG5cbiIsImltcG9ydCB7c2VuZF9oZWxsbywgc2VuZF9waW5ncG9uZ30gZnJvbSAnLi9jb250cm9sX3Byb3RvY29sLmpzeSdcblxuXG5leHBvcnQgY2xhc3MgTWVzc2FnZUNoYW5uZWwgOjpcbiAgc2VuZFJhdygpIDo6IHRocm93IG5ldyBFcnJvciBAIGBJbnN0YW5jZSByZXNwb25zaWJsaXR5YFxuICBwYWNrUmF3KCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYEluc3RhbmNlIHJlc3BvbnNpYmxpdHlgXG4gIHBhY2soLi4uYXJncykgOjogcmV0dXJuIHRoaXMucGFja1JhdyBAIHRoaXMuY29udGV4dCwgLi4uYXJnc1xuXG4gIHBhY2tBbmRTZW5kUmF3KC4uLmFyZ3MpIDo6XG4gICAgcmV0dXJuIHRoaXMuc2VuZFJhdyBAIHRoaXMucGFja1JhdyBAIC4uLmFyZ3NcblxuICBzZW5kSlNPTihtc2dfb2JqKSA6OlxuICAgIHJldHVybiB0aGlzLnNlbmRSYXcgQCB0aGlzLnBhY2tKU09OIEAgbXNnX29ialxuICBwYWNrSlNPTihtc2dfb2JqKSA6OlxuICAgIGlmIHVuZGVmaW5lZCAhPT0gbXNnX29iai5oZWFkZXIgOjpcbiAgICAgIG1zZ19vYmouaGVhZGVyID0gSlNPTi5zdHJpbmdpZnkgQCBtc2dfb2JqLmhlYWRlclxuICAgIGlmIHVuZGVmaW5lZCAhPT0gbXNnX29iai5ib2R5IDo6XG4gICAgICBtc2dfb2JqLmJvZHkgPSBKU09OLnN0cmluZ2lmeSBAIG1zZ19vYmouYm9keVxuXG4gICAgcmV0dXJuIHRoaXMucGFjayhtc2dfb2JqKVxuXG5cbiAgLy8gLS0tIENvbnRyb2wgbWVzc2FnZSB1dGlsaXRpZXNcblxuICBzZW5kUm91dGluZ0hhbmRzaGFrZShjaGFubmVsKSA6OlxuICAgIHJldHVybiBzZW5kX2hlbGxvKHRoaXMsIHRoaXMuZWNfcHViX2lkKVxuICBzZW5kUGluZyhjaGFubmVsKSA6OlxuICAgIHJldHVybiBzZW5kX3Bpbmdwb25nKHRoaXMpXG5cblxuXG4gIGNsb25lKHByb3BzKSA6OiByZXR1cm4gT2JqZWN0LmNyZWF0ZSh0aGlzLCBwcm9wcylcbiAgYmluZENoYW5uZWwoc2VuZFJhdywgcHJvcHMpIDo6IHJldHVybiBiaW5kQ2hhbm5lbCh0aGlzLCBzZW5kUmF3LCBwcm9wcylcbiAgYmluZERpc3BhdGNoUGFja2V0cygpIDo6IHJldHVybiBiaW5kRGlzcGF0Y2hQYWNrZXRzKHRoaXMpXG5cblxuICBzdGF0aWMgYXNBUEkoaHViLCByb3V0ZXIsIHBhY2tSYXcpIDo6XG4gICAgY29uc3Qgc2VsZiA9IG5ldyB0aGlzKClcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHNlbGYsIEA6XG4gICAgICBwYWNrUmF3OiBAOiB2YWx1ZTogcGFja1Jhd1xuICAgICAgcm91dGVyOiBAOiB2YWx1ZTogcm91dGVyXG4gICAgICBodWI6IEA6IHZhbHVlOiBodWJcbiAgICAgIF9yb290XzogQDogdmFsdWU6IHNlbGZcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0NoYW5uZWxBUEkoaHViLCByb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICBjb25zdCBzZWxmID0gdGhpcy5hc0FQSSBAIGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIucGFja01lc3NhZ2VcbiAgICByZXR1cm4gc2VsZlxuXG4gIHN0YXRpYyBhc0ludGVybmFsQVBJKGh1Yiwgcm91dGVyLCBwYWNrZXRQYXJzZXIpIDo6XG4gICAgY29uc3Qgc2VsZiA9IHRoaXMuYXNBUEkgQCBodWIsIHJvdXRlciwgcGFja2V0UGFyc2VyLnBhY2tNZXNzYWdlT2JqXG4gICAgcmV0dXJuIHNlbGYuYmluZENoYW5uZWwobnVsbClcblxuZXhwb3J0IGRlZmF1bHQgTWVzc2FnZUNoYW5uZWxcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kQ2hhbm5lbChjaGFubmVsLCBzZW5kUmF3LCBwcm9wcykgOjpcbiAgaWYgbnVsbCA9PSBzZW5kUmF3IDo6XG4gICAgc2VuZFJhdyA9IGJpbmREaXNwYXRjaE1zZ1JhdyhjaGFubmVsLnJvdXRlcilcbiAgZWxzZSBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2Ygc2VuZFJhdyA6OlxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgQ2hhbm5lbCBleHBlY3RzICdzZW5kUmF3JyBmdW5jdGlvbiBwYXJhbWV0ZXJgXG5cbiAgY29uc3QgY29yZV9wcm9wcyA9IEA6IHNlbmRSYXc6IEB7fSB2YWx1ZTogc2VuZFJhd1xuICBwcm9wcyA9IG51bGwgPT0gcHJvcHMgPyBjb3JlX3Byb3BzIDogT2JqZWN0LmFzc2lnbiBAIGNvcmVfcHJvcHMsIHByb3BzXG5cbiAgY29uc3Qgc2VsZiA9IE9iamVjdC5jcmVhdGUgQCBjaGFubmVsLCBwcm9wc1xuICByZXR1cm4gc2VuZFJhdy5jaGFubmVsID0gc2VsZlxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kRGlzcGF0Y2hNc2dSYXcocm91dGVyKSA6OlxuICBjb25zdCBkaXNwYXRjaCA9IHJvdXRlci5kaXNwYXRjaFxuICByZXR1cm4gZGlzcGF0Y2hNc2dPYmpcblxuICBmdW5jdGlvbiBkaXNwYXRjaE1zZ09iaihtc2cpIDo6XG4gICAgaWYgdW5kZWZpbmVkID09PSBtc2cuX3Jhd18gOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgYSBwYXJzZWQgbXNnX29iaiB3aXRoIHZhbGlkICdfcmF3XycgYnVmZmVyIHByb3BlcnR5YFxuICAgIGRpc3BhdGNoIEAgW21zZ10sIGRpc3BhdGNoTXNnT2JqLmNoYW5uZWxcbiAgICByZXR1cm4gdHJ1ZVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kRGlzcGF0Y2hQYWNrZXRzKGNoYW5uZWwpIDo6XG4gIGNvbnN0IGRpc3BhdGNoID0gY2hhbm5lbC5yb3V0ZXIuZGlzcGF0Y2hcbiAgY29uc3QgZmVlZCA9IGNoYW5uZWwuaHViLl9wYWNrZXRQYXJzZXIucGFja2V0U3RyZWFtKClcblxuICByZXR1cm4gZnVuY3Rpb24gb25fcmVjdl9kYXRhKGRhdGEpIDo6XG4gICAgY29uc3QgbXNnTGlzdCA9IGZlZWQoZGF0YSlcbiAgICBpZiAwIDwgbXNnTGlzdC5sZW5ndGggOjpcbiAgICAgIGRpc3BhdGNoIEAgbXNnTGlzdCwgY2hhbm5lbFxuIiwiaW1wb3J0IHtNZXNzYWdlUm91dGVyfSBmcm9tICcuL3JvdXRlci5qc3knXG5pbXBvcnQge01lc3NhZ2VDaGFubmVsfSBmcm9tICcuL2NoYW5uZWwuanN5J1xuXG5leHBvcnQgY2xhc3MgTWVzc2FnZUh1YiA6OlxuICBjb25zdHJ1Y3RvcigpIDo6XG4gICAgYXBwbHlQbHVnaW5zIEAgJ3ByZScsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuXG4gICAgY29uc3Qgcm91dGVyID0gdGhpcy5faW5pdF9yb3V0ZXIoKVxuICAgIGNvbnN0IF9wYWNrZXRQYXJzZXIgPSB0aGlzLl9pbml0X3BhY2tldFBhcnNlcigpXG4gICAgY29uc3QgX2FwaV9jaGFubmVsID0gdGhpcy5faW5pdF9jaGFubmVsQVBJKHJvdXRlciwgX3BhY2tldFBhcnNlcilcbiAgICBjb25zdCBfYXBpX2ludGVybmFsID0gdGhpcy5faW5pdF9pbnRlcm5hbEFQSShyb3V0ZXIsIF9wYWNrZXRQYXJzZXIpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAe31cbiAgICAgIHJvdXRlcjogQHt9IHZhbHVlOiByb3V0ZXJcbiAgICAgIF9wYWNrZXRQYXJzZXI6IEB7fSB2YWx1ZTogX3BhY2tldFBhcnNlclxuICAgICAgX2FwaV9jaGFubmVsOiBAe30gdmFsdWU6IF9hcGlfY2hhbm5lbFxuICAgICAgX2FwaV9pbnRlcm5hbDogQHt9IHZhbHVlOiBfYXBpX2ludGVybmFsXG5cbiAgICBhcHBseVBsdWdpbnMgQCBudWxsLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICBhcHBseVBsdWdpbnMgQCAncG9zdCcsIHRoaXMucGx1Z2luTGlzdCwgdGhpc1xuICAgIHJldHVybiB0aGlzXG5cbiAgX2luaXRfcm91dGVyKCkgOjogdGhyb3cgbmV3IEVycm9yIEAgYFBsdWdpbiByZXNwb25zaWJsaXR5YFxuICBfaW5pdF9wYWNrZXRQYXJzZXIoKSA6OiB0aHJvdyBuZXcgRXJyb3IgQCBgUGx1Z2luIHJlc3BvbnNpYmxpdHlgXG5cbiAgX2luaXRfY2hhbm5lbEFQSShyb3V0ZXIsIHBhY2tldFBhcnNlcikgOjpcbiAgICByZXR1cm4gTWVzc2FnZUNoYW5uZWwuYXNDaGFubmVsQVBJIEBcbiAgICAgIHRoaXMsIHJvdXRlciwgcGFja2V0UGFyc2VyXG4gIF9pbml0X2ludGVybmFsQVBJKHJvdXRlciwgcGFja2V0UGFyc2VyKSA6OlxuICAgIHJldHVybiBNZXNzYWdlQ2hhbm5lbC5hc0ludGVybmFsQVBJIEBcbiAgICAgIHRoaXMsIHJvdXRlciwgcGFja2V0UGFyc2VyXG5cblxuICBzdGF0aWMgcGx1Z2luKC4uLnBsdWdpbkZ1bmN0aW9ucykgOjpcbiAgICBjb25zdCBwbHVnaW5MaXN0ID0gW10uY29uY2F0IEBcbiAgICAgIHRoaXMucHJvdG90eXBlLnBsdWdpbkxpc3QgfHwgW11cbiAgICAgIHBsdWdpbkZ1bmN0aW9uc1xuXG4gICAgY29uc3QgQmFzZUh1YiA9IHRoaXMuX0Jhc2VIdWJfIHx8IHRoaXNcbiAgICBjbGFzcyBNZXNzYWdlSHViX1BJIGV4dGVuZHMgQmFzZUh1YiA6OlxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgTWVzc2FnZUh1Yl9QSS5wcm90b3R5cGUsIEA6XG4gICAgICBwbHVnaW5MaXN0OiBAe30gdmFsdWU6IE9iamVjdC5mcmVlemUgQCBwbHVnaW5MaXN0XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBNZXNzYWdlSHViX1BJLCBAOlxuICAgICAgX0Jhc2VIdWJfOiBAe30gdmFsdWU6IEJhc2VIdWJcblxuICAgIGFwcGx5UGx1Z2lucyBAICdzdWJjbGFzcycsIHBsdWdpbkxpc3QsIE1lc3NhZ2VIdWJfUEksIEA6IE1lc3NhZ2VSb3V0ZXIsIE1lc3NhZ2VDaGFubmVsXG4gICAgcmV0dXJuIE1lc3NhZ2VIdWJfUElcblxuICBpZF9yb3V0ZXJfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMuX3BhY2tldFBhcnNlci5wYWNrSWQgQFxuICAgICAgdGhpcy5yb3V0ZXIuaWRfc2VsZlxuXG4gIGNvbm5lY3Rfc2VsZigpIDo6XG4gICAgcmV0dXJuIHRoaXMuX2FwaV9pbnRlcm5hbC5jbG9uZSgpXG5cbiAgY29ubmVjdChjb25uX3VybCkgOjpcbiAgICBpZiBudWxsID09IGNvbm5fdXJsIDo6XG4gICAgICByZXR1cm4gdGhpcy5jb25uZWN0X3NlbGYoKVxuXG4gICAgaWYgJ3N0cmluZycgPT09IHR5cGVvZiBjb25uX3VybCA6OlxuICAgICAgY29ubl91cmwgPSB0aGlzLl9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpXG5cbiAgICBjb25zdCBjb25uZWN0ID0gdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xbY29ubl91cmwucHJvdG9jb2xdXG4gICAgaWYgISBjb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IgQCBgQ29ubmVjdGlvbiBwcm90b2NvbCBcIiR7Y29ubl91cmwucHJvdG9jb2x9XCIgbm90IHJlZ2lzdGVyZWQgZm9yIFwiJHtjb25uX3VybC50b1N0cmluZygpfVwiYFxuXG4gICAgcmV0dXJuIGNvbm5lY3QoY29ubl91cmwpXG5cbiAgcmVnaXN0ZXJDb25uZWN0aW9uUHJvdG9jb2wocHJvdG9jb2wsIGNiX2Nvbm5lY3QpIDo6XG4gICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGNiX2Nvbm5lY3QgOjpcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ2NiX2Nvbm5lY3QnIGZ1bmN0aW9uYFxuICAgIGNvbnN0IGJ5UHJvdG9jb2wgPSBPYmplY3QuYXNzaWduIEAge30sIHRoaXMuX2Nvbm5lY3RCeVByb3RvY29sXG4gICAgYnlQcm90b2NvbFtwcm90b2NvbF0gPSBjYl9jb25uZWN0XG4gICAgcmV0dXJuIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSBAIHRoaXMsICdfY29ubmVjdEJ5UHJvdG9jb2wnLFxuICAgICAgQDogdmFsdWU6IGJ5UHJvdG9jb2wsIGNvbmZpZ3VyYWJsZTogdHJ1ZVxuXG4gIF9wYXJzZUNvbm5lY3RVUkwoY29ubl91cmwpIDo6XG4gICAgcmV0dXJuIG5ldyBVUkwoY29ubl91cmwpXG5cbmV4cG9ydCBkZWZhdWx0IE1lc3NhZ2VIdWJcblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGx1Z2lucyhrZXksIHBsdWdpbkxpc3QsIC4uLmFyZ3MpIDo6XG4gIGlmICEga2V5IDo6IGtleSA9IG51bGxcbiAgZm9yIGxldCBwbHVnaW4gb2YgcGx1Z2luTGlzdCA6OlxuICAgIGlmIG51bGwgIT09IGtleSA6OiBwbHVnaW4gPSBwbHVnaW5ba2V5XVxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBwbHVnaW4gOjpcbiAgICAgIHBsdWdpbiguLi5hcmdzKVxuIl0sIm5hbWVzIjpbImRpc3BDb250cm9sQnlUeXBlIiwicmVjdl9oZWxsbyIsInJlY3Zfb2xsZWgiLCJyZWN2X3BvbmciLCJyZWN2X3BpbmciLCJzZW5kX2hlbGxvIiwiY2hhbm5lbCIsImVjX3B1Yl9pZCIsInJvdXRlciIsInBhY2tBbmRTZW5kUmF3IiwidHlwZSIsImh1YiIsImlkX3JvdXRlcl9zZWxmIiwiZGlzcGF0Y2giLCJtc2ciLCJlY19vdGhlcl9pZCIsImhlYWRlcl9idWZmZXIiLCJsZW5ndGgiLCJlY19pZF9obWFjIiwiaG1hY19zZWNyZXQiLCJpZF9yb3V0ZXIiLCJ1bnBhY2tJZCIsImJvZHlfYnVmZmVyIiwidW52ZXJpZmllZFBlZXJSb3V0ZSIsInNlbmRfb2xsZWgiLCJwZWVyX2htYWNfY2xhaW0iLCJjb21wYXJlIiwidmVyaWZpZWRQZWVyUm91dGUiLCJzZW5kX3Bpbmdwb25nIiwicG9uZyIsIkRhdGUiLCJ0b0lTT1N0cmluZyIsImxvY2FsIiwicmVtb3RlIiwidG9TdHJpbmciLCJkZWx0YSIsInRzX3BvbmciLCJlcnIiLCJ0c19waW5nIiwiTWVzc2FnZVJvdXRlciIsImlkX3NlbGYiLCJfcm91dGVEaXNjb3ZlcnkiLCJ0YXJnZXRzIiwiX2NyZWF0ZVRhcmdldHNNYXAiLCJPYmplY3QiLCJjcmVhdGUiLCJkZWZpbmVQcm9wZXJ0aWVzIiwidmFsdWUiLCJfaW5pdERpc3BhdGNoIiwicm91dGVzIiwiX2NyZWF0ZVJvdXRlc01hcCIsInNldCIsImJpbmREaXNwYXRjaENvbnRyb2wiLCJiaW5kRGlzcGF0Y2hTZWxmIiwicHF1ZXVlIiwicHJvbWlzZVF1ZXVlIiwiZGlzcGF0Y2hfb25lIiwiYmluZERpc3BhdGNoUm91dGUiLCJtc2dMaXN0IiwicHEiLCJtYXAiLCJ0aGVuIiwiZXJyb3IiLCJNYXAiLCJ0aXAiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJhY2UiLCJkaXNjb3ZlciIsImRpc3BhdGNoX3JvdXRlIiwiZ2V0IiwidW5kZWZpbmVkIiwiZGlzcGF0Y2hfZGlzY292ZXJfcm91dGUiLCJyZWdpc3RlclJvdXRlIiwidW5yZWdpc3RlclJvdXRlIiwib25fZXJyb3JfaW5fZGlzcGF0Y2giLCJUeXBlRXJyb3IiLCJoYXMiLCJkZWxldGUiLCJ0dGwiLCJzZW5kUmF3IiwicmVnaXN0ZXJQZWVyUm91dGUiLCJhbGxvd1VudmVyaWZpZWRSb3V0ZXMiLCJjb25zb2xlIiwid2FybiIsImlkX3RhcmdldCIsInRhcmdldCIsImRudV9kaXNwYXRjaF9zZWxmIiwidW5yZWdpc3RlclRhcmdldCIsImhhbmRsZXIiLCJkbnVfZGlzcGF0Y2hfY29udHJvbCIsInByb3RvdHlwZSIsImFzc2lnbiIsImNsZWFyX3RpcCIsIk1lc3NhZ2VDaGFubmVsIiwiRXJyb3IiLCJhcmdzIiwicGFja1JhdyIsImNvbnRleHQiLCJtc2dfb2JqIiwicGFja0pTT04iLCJoZWFkZXIiLCJKU09OIiwic3RyaW5naWZ5IiwiYm9keSIsInBhY2siLCJwcm9wcyIsImJpbmRDaGFubmVsIiwiYmluZERpc3BhdGNoUGFja2V0cyIsImFzQVBJIiwic2VsZiIsImFzQ2hhbm5lbEFQSSIsInBhY2tldFBhcnNlciIsInBhY2tNZXNzYWdlIiwiYXNJbnRlcm5hbEFQSSIsInBhY2tNZXNzYWdlT2JqIiwiYmluZERpc3BhdGNoTXNnUmF3IiwiY29yZV9wcm9wcyIsImRpc3BhdGNoTXNnT2JqIiwiX3Jhd18iLCJmZWVkIiwiX3BhY2tldFBhcnNlciIsInBhY2tldFN0cmVhbSIsIm9uX3JlY3ZfZGF0YSIsImRhdGEiLCJNZXNzYWdlSHViIiwicGx1Z2luTGlzdCIsIl9pbml0X3JvdXRlciIsIl9pbml0X3BhY2tldFBhcnNlciIsIl9hcGlfY2hhbm5lbCIsIl9pbml0X2NoYW5uZWxBUEkiLCJfYXBpX2ludGVybmFsIiwiX2luaXRfaW50ZXJuYWxBUEkiLCJwbHVnaW4iLCJwbHVnaW5GdW5jdGlvbnMiLCJjb25jYXQiLCJCYXNlSHViIiwiX0Jhc2VIdWJfIiwiTWVzc2FnZUh1Yl9QSSIsImZyZWV6ZSIsInBhY2tJZCIsImNsb25lIiwiY29ubl91cmwiLCJjb25uZWN0X3NlbGYiLCJfcGFyc2VDb25uZWN0VVJMIiwiY29ubmVjdCIsIl9jb25uZWN0QnlQcm90b2NvbCIsInByb3RvY29sIiwiY2JfY29ubmVjdCIsImJ5UHJvdG9jb2wiLCJkZWZpbmVQcm9wZXJ0eSIsImNvbmZpZ3VyYWJsZSIsIlVSTCIsImFwcGx5UGx1Z2lucyIsImtleSJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQU8sTUFBTUEsb0JBQW9CO0dBQzlCLElBQUQsR0FBUUMsVUFEdUI7R0FFOUIsSUFBRCxHQUFRQyxVQUZ1QjtHQUc5QixJQUFELEdBQVFDLFNBSHVCO0dBSTlCLElBQUQsR0FBUUMsU0FKdUIsRUFBMUI7O0FBUVAsQUFBTyxTQUFTQyxVQUFULENBQW9CQyxPQUFwQixFQUE2QjtRQUM1QixFQUFDQyxTQUFELEtBQWNELFFBQVFFLE1BQTVCO1NBQ09GLFFBQVFHLGNBQVIsQ0FBeUI7ZUFDbkIsQ0FEbUIsRUFDaEJDLE1BQU0sSUFEVTtZQUV0QkgsU0FGc0I7VUFHeEJELFFBQVFLLEdBQVIsQ0FBWUMsY0FBWixFQUh3QixFQUF6QixDQUFQOzs7QUFLRixTQUFTWCxVQUFULENBQW9CWSxRQUFwQixFQUE4QkMsR0FBOUIsRUFBbUNSLE9BQW5DLEVBQTRDO1FBQ3BDUyxjQUFjRCxJQUFJRSxhQUFKLEVBQXBCO01BQ0csTUFBTUQsWUFBWUUsTUFBbEIsSUFBNEJKLFNBQVNLLFVBQXhDLEVBQXFEO1VBQzdDQyxjQUFjTixTQUFTSyxVQUFULEdBQ2hCTCxTQUFTSyxVQUFULENBQW9CSCxXQUFwQixDQURnQixHQUNtQixJQUR2QztlQUVhVCxPQUFiLEVBQXNCYSxXQUF0QjtHQUhGLE1BS0s7VUFDR0MsWUFBWU4sSUFBSU8sUUFBSixDQUFhUCxJQUFJUSxXQUFKLEVBQWIsRUFBZ0MsQ0FBaEMsQ0FBbEI7YUFDU0MsbUJBQVQsQ0FBK0JILFNB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
