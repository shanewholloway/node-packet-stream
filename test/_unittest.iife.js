(function () {
'use strict';

function promiseQueue(src) {
  let tip = null;
  return function () {
    if (null === tip) {
      tip = Promise.resolve(src).then(clear);
    }
    return tip;
  };

  function clear() {
    tip = null;
  }
}

const sym_dedup = Symbol('msg_fabric_discovery');
function discoverFirst(lstFns, query, on_error) {
  const key = query.key;
  let dedup = lstFns[sym_dedup];
  if (undefined !== dedup) {
    const res = dedup.get(key);
    if (undefined !== res) {
      return res;
    }
  } else {
    dedup = new Map();
    Object.defineProperty(lstFns, sym_dedup, { value: dedup });
  }

  const res = new Promise(resolve => {
    const resolveIf = e => undefined !== e ? resolve(e) : e;
    const tip = Promise.resolve(query);
    Promise.all(Array.from(lstFns, fn => tip.then(fn).then(resolveIf, on_error))).then(() => resolve(null));
  });

  dedup.set(key, res);
  res.then(() => dedup.delete(key));
  return res;
}

const timeoutResolve = (ms, answer) => new Promise(resolve => setTimeout(resolve, ms, answer));

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

class FabricBase {}

Object.assign(FabricBase.prototype, {
  _promiseQueue: promiseQueue,
  _discoverFirst: discoverFirst,
  _discoveryDefault: [() => timeoutResolve(5000, null)],
  _on_error(scope, err) {
    console.error(scope, err);
  } });

class FabricRouter extends FabricBase {
  _createRoutesMap() {
    return new Map();
  }

  constructor() {
    super();
    Object.defineProperties(this, {
      routeDiscovery: { value: this._discoveryDefault.slice() } });

    this._bindDispatchRoutes();
  }

  _bindDispatchRoutes() {
    // as closures over private variables (routes_map)
    const hub_router = this;
    const routes_map = this._createRoutesMap();
    const pqueue = this._promiseQueue();

    Object.defineProperties(this, {
      _bindDispatchRoutes: { value: false },
      dispatch: { value: dispatch },
      resolveRoute: { value: resolveRoute },
      registerRoute: { value: registerRoute },
      unregisterRoute: { value: unregisterRoute } });
    return dispatch;

    function resolveRoute(id_route) {
      return routes_map.get(id_route) || hub_router.discoverRoute(id_route);
    }

    async function dispatch_one(pkt, pktctx) {
      try {
        const id_route = pkt.id_route;
        let route = routes_map.get(id_route);
        if (undefined === route) {
          route = await hub_router.discoverRoute(id_route, pktctx);
          if (undefined === route) {
            const channel = pktctx.channel;
            return channel && channel.undeliverable(pkt, 'route');
          }
        }

        await route(pkt, pktctx);
      } catch (err) {
        hub_router._on_error('router.dispatch', err, { pkt, pktctx });
      }
    }

    function dispatch(pktList, channel) {
      const pq = pqueue(); // pq will dispatch during Promise resolutions
      return pktList.map(pkt => pq.then(() => dispatch_one(pkt, { channel, hub_router })));
    }

    function registerRoute(id_route, route) {
      if ('function' !== typeof route) {
        throw new TypeError(`Expected 'route' to be a function`);
      }
      if (routes_map.has(id_route)) {
        return routes_map.get(id_route);
      }

      routes_map.set(id_route, route);
      return route;
    }
    function unregisterRoute(id_route) {
      return routes_map.delete(id_route);
    }
  }

  registerPeerRoute(id_route, channel) {
    return this.registerRoute(id_route, pkt => {
      channel.send(pkt);
    });
  }

  async discoverRoute(id_route, pktctx) {
    const route = await this._discoverFirst(this.routeDiscovery, { key: id_route, id_route, pktctx }, err => this._on_error('router.discovery', err));

    if (null == route) {
      return;
    }
    if (route.ephemeral) {
      return route;
    }

    if ('function' !== typeof route) {
      return this.registerPeerRoute(id_route, route);
    }
    return this.registerRoute(id_route, route);
  }
}

class TargetRouter extends FabricBase {
  _createTargetsMap() {
    return new Map();
  }

  constructor(id_route, router) {
    super();
    Object.defineProperties(this, {
      id_route: { value: id_route, enumerable: true },
      targetDiscovery: { value: this._discoveryDefault.slice() } });

    this._bindDispatchTarget(id_route, router);
  }

  _bindDispatchTarget(id_route, router) {
    // as closures over private variables (targets_map)

    const tgt_router = this;
    const targets_map = this._createTargetsMap();

    Object.defineProperties(this, {
      registerTarget: { value: registerTarget },
      unregisterTarget: { value: unregisterTarget },
      _bindDispatchTarget: { value: false } });

    dispatch_target.id_route = id_route;
    router.registerRoute(id_route, dispatch_target);
    return this;

    async function dispatch_target(pkt, pktctx) {
      const id_target = pkt.id_target;
      let target = targets_map.get(id_target);
      if (undefined === target) {
        target = await tgt_router.discoverTarget(id_target, pktctx);
        if (undefined === target) {
          const channel = pktctx.channel;
          return channel && channel.undeliverable(pkt, 'target');
        }
      }

      pktctx.tgt_router = tgt_router;
      await target(pkt, pktctx);
    }

    function registerTarget(id_target, target) {
      if ('function' !== typeof target) {
        throw new TypeError(`Expected 'target' function`);
      }

      if (targets_map.has(id_target)) {
        return targets_map.get(target);
      }
      targets_map.set(id_target, target);
      return target;
    }

    function unregisterTarget(id_target) {
      return targets_map.delete(id_target);
    }
  }

  async discoverTarget(id_target, pktctx) {
    const target = await this._discoverFirst(this.targetDiscovery, { key: id_target, id_target, pktctx }, err => this._on_error('target.discovery', err));

    if (null == target) {
      return;
    }

    if (!target.ephemeral) {
      this.registerTarget(id_target, target);
    }
    return target;
  }
}

class P2PRouter extends TargetRouter {
  constructor(router) {
    super('', router);
    this.public_routes = [];
    this.initP2P();
  }

  publishRoute(route) {
    const id = route.id_route ? route.id_route : 'string' === typeof route ? route : null;

    if (!id) {
      throw new Error('Invalid route identifier');
    }
    this.public_routes.push(id);
    return this;
  }

  initP2P() {
    this.registerTarget('hello', this._tgt_hello.bind(this));
    this.registerTarget('olleh', this._tgt_olleh.bind(this));
  }

  helloHandshake() {
    return {
      id_target: 'hello', id_route: '',
      body: this.public_routes };
  }

  _tgt_hello(pkt, pktctx) {
    const { channel, hub_router } = pktctx;
    channel.send({
      id_target: 'olleh', id_route: '',
      body: this.public_routes });

    const peer_routes = pkt.json();
    for (const id_route of peer_routes) {
      hub_router.registerPeerRoute(id_route, channel);
    }
  }

  _tgt_olleh(pkt, pktctx) {
    const { channel, hub_router } = pktctx;
    const peer_routes = pkt.json();
    for (const id_route of peer_routes) {
      hub_router.registerPeerRoute(id_route, channel);
    }
  }
}

class FabricHub {
  static create(...args) {
    return new this(...args);
  }

  constructor(options) {
    if (null == options) {
      options = {};
    } else if ('string' === typeof options) {
      options = { id_route: options };
    }

    Object.defineProperties(this, {
      options: { value: options } });

    applyPlugins('pre', this.pluginList, this);

    const router = this._init_fabricRouter();
    const dispatch = router.dispatch;

    const p2p = this.createP2PRoute(router);
    const local = this.createLocalRoute(router, options.id_route);
    p2p.publishRoute(local);

    const channel = this._bindSendLocal(dispatch);
    Object.defineProperties(this, {
      router: { value: router },
      dispatch: { value: dispatch },
      channel: { value: channel },
      send: { value: channel.send },

      p2p: { value: p2p },
      local: { value: local },

      _connectByProtocol: { value: {} } });

    applyPlugins(null, this.pluginList, this);
    applyPlugins('post', this.pluginList, this);
    return this;
  }

  _init_fabricRouter() {
    const klass = this.constructor;
    return new klass.FabricRouter();
  }

  createP2PRoute(router = this.router) {
    const klass = this.constructor;
    return new klass.P2PRouter(router);
  }

  createLocalRoute(router = this.router, id_route) {
    if (null == id_route) {
      id_route = this.newRouteId();
    }
    const klass = this.constructor;
    return new klass.TargetRouter(id_route, router);
  }

  newRouteId() {
    const id = this.data_utils.random(5, true).slice(0, 6);
    const prefix = this.options.id_prefix;
    return undefined === prefix ? id : prefix + id;
  }

  /* data_utils is provided by router plugins
   data_utils = @{}
    parse_url(str) ::
    random(n, asBase64) ::
    pack_base64(data) ::
    unpack_base64(str_b64) ::
    decode_utf8(u8) ::
    encode_utf8(str) ::
   */

  newLocalRoute(privateRoute, id_route) {
    const route = this.createLocalRoute(this.router, id_route);
    this.p2p.publishRoute(route);
    return route;
  }

  connect(conn_url) {
    if ('string' === typeof conn_url) {
      conn_url = this.data_utils.parse_url(conn_url);
    }

    const connect = this._connectByProtocol[conn_url.protocol];
    if (!connect) {
      throw new Error(`Connection protocol "${conn_url.protocol}" not registered`);
    }
    return connect(conn_url);
  }

  registerProtocols(protocolList, cb_connect) {
    if ('function' !== typeof cb_connect) {
      throw new TypeError(`Expected 'cb_connect' function`);
    }
    for (const protocol of protocolList) {
      this._connectByProtocol[protocol] = cb_connect;
    }
    return this;
  }

  _bindSendLocal(dispatch) {
    const { _fromObjPacket, _hub_channel_ } = this;
    return Object.create(_hub_channel_, { send: { value: hub_send } });

    function hub_send(...objs) {
      const pktList = objs.map(_fromObjPacket);
      return dispatch(pktList, _hub_channel_);
    }
  }
  _fromObjPacket(obj) {
    return obj; // plugin (pkt) responsiblity
  }static plugin(...pluginFunctions) {
    return this.plugins(...pluginFunctions);
  }
  static plugins(...pluginFunctions) {
    const pluginList = Object.freeze(this.prototype.pluginList.concat(pluginFunctions).sort((a, b) => (0 | a.order) - (0 | b.order)));

    class FabricHub extends this {}
    Object.defineProperties(FabricHub.prototype, {
      pluginList: { value: pluginList } });

    class FabricRouter$$1 extends this.FabricRouter {}
    class TargetRouter$$1 extends this.TargetRouter {}
    class P2PRouter$$1 extends this.P2PRouter {}
    Object.assign(FabricHub, {
      FabricRouter: FabricRouter$$1, TargetRouter: TargetRouter$$1, P2PRouter: P2PRouter$$1 });

    applyPlugins('subclass', pluginList, FabricHub);
    return FabricHub;
  }
}

const _hub_channel_ = {
  is_local: true,
  undeliverable(pkt, mode) {
    const { id_route, id_target } = pkt;
    console.warn('~~ undeliverable «hub»', {
      mode, id_route, id_target });
  } };

Object.defineProperties(FabricHub.prototype, {
  pluginList: { value: Object.freeze([]) },
  _hub_channel_: { value: Object.create(_hub_channel_) } });

Object.assign(FabricHub, {
  FabricRouter: FabricRouter,
  TargetRouter: TargetRouter,
  P2PRouter: P2PRouter });

const _fromCharCode = String.fromCharCode;
const _charCodeAt = ''.charCodeAt;

function browser_platform_plugin(plugin_options = {}) {
  return { order: -9, subclass(FabricHub) {

      Object.assign(FabricHub.prototype, {
        data_utils });

      Object.assign(FabricHub.TargetRouter.prototype, {
        data_utils });
    } };
}

const data_utils = {
  random, parse_url,
  pack_base64, unpack_base64,
  decode_utf8, encode_utf8,
  as_data, concat_data };

function random(n, asBase64) {
  const ua = new Uint8Array(n);
  window.crypto.getRandomValues(ua);
  return asBase64 ? pack_base64(ua) : ua;
}

function parse_url(url) {
  return new URL(url);
}

function pack_base64(data) {
  const u8 = new Uint8Array(data.buffer || data),
        len = u8.byteLength;

  let res = '';
  for (let i = 0; i < len; i++) res += _fromCharCode(u8[i]);
  return window.btoa(res);
}

function unpack_base64(str_b64) {
  const sz = window.atob(str_b64),
        len = sz.length;

  const res = new Uint8Array(len);
  for (let i = 0; i < len; i++) res[i] += _charCodeAt.call(sz, i);
  return res;
}

function decode_utf8(u8) {
  return new TextDecoder().decode(u8);
}

function encode_utf8(str) {
  return new TextEncoder().encode(str);
}

function as_data(data) {
  if (null === data) {
    return new ArrayBuffer(0);
  }
  return 'string' === typeof data ? encode_utf8(data) : new ArrayBuffer(data);
}

function concat_data(parts) {
  let i = 0,
      len = 0;
  for (const b of parts) {
    len += b.byteLength;
  }

  const ua = new Uint8Array(len);
  for (const b of parts) {
    ua.set(new Uint8Array(b.buffer || b), i);
    i += b.byteLength;
  }
  return ua;
}

const json_parse = JSON.parse;
const json_stringify = JSON.stringify;

function as_hdr({ id_route, id_target, op }) {
  if ('string' !== typeof id_route) {
    throw new TypeError('id_route');
  }
  if ('string' !== typeof id_target) {
    throw new TypeError('id_target');
  }
  return op && op.length ? `${id_route} ${id_target} ${op ? op.join(' ') : ''}` : `${id_route} ${id_target}`;
}

const o_create = Object.create;
function as_pkt0(hdr, meta, body, aPktBase) {
  return o_create(aPktBase, {
    _hdr_: { value: hdr.split(' ') },
    _meta_: { value: meta },
    _body_: { value: body } });
}

function is_json_body(body) {
  if (null == body) {
    return true;
  }
  return undefined === body.byteLength && 'string' !== typeof body;
}

function bind_repack(repackByKind) {
  return (pkt, pkt_kind) => repackByKind[pkt_kind](pkt, pkt._hdr_.join(' '));
}

const PktBase = {
  __proto__: null, is_pkt: true,
  get id_route() {
    return this._hdr_[0];
  },
  get id_target() {
    return this._hdr_[1];
  },
  meta(reviver) {
    return json_parse(this._meta_ || null, reviver);
  },

  inspect() {
    return this._hdr_ ? `«pkt(${this.pkt_kind}) ${json_stringify(this._hdr_.join(' '))}»` : `«{Pkt(${this.pkt_kind})}»`;
  },
  repack_pkt(repack) {
    return repack(this, this.pkt_kind);
  } };

function json(reviver) {
  const src = this.text();
  if (src) {
    return json_parse(src, reviver);
  }
}

const PktJsonBase = { __proto__: PktBase,
  pkt_kind: 'json', is_pkt_json: true,
  json // and... text(){}
};

const PktDataBase = { __proto__: PktBase,
  pkt_kind: 'data', is_pkt_data: true,
  json // and... text(){}  buffer(){}  base64(){}
};

const sym_split = Symbol('pkt split');
const k_data = '=',
      k_split_data = '?';
const k_json = '@',
      k_split_json = '#';

const PktSplitJson = { __proto__: PktBase,
  pkt_kind: 'split_json', is_pkt_split: true };

const PktSplitData = { __proto__: PktBase,
  pkt_kind: 'split_data', is_pkt_split: true };

function bind_packObjPacket({ PktData, PktJson, packBody }, repack) {
  const pktByKind = {
    [k_data]: PktData, [k_split_data]: PktSplitData,
    [k_json]: PktJson, [k_split_json]: PktSplitJson };

  return function (obj) {
    if ('function' === typeof obj.repack_pkt) {
      return obj.repack_pkt(repack);
    }

    const hdr = as_hdr(obj),
          { body, meta } = obj,
          k_token = body[sym_split];
    return undefined !== k_token ? undefined !== body.src ? as_pkt0(hdr, meta, body.src, pktByKind[k_token]) : as_pkt0(hdr, meta, body.buf, pktByKind[k_token]) : is_json_body(body) ? as_pkt0(hdr, json_stringify(meta) || '', json_stringify(body) || '', PktJson) : as_pkt0(hdr, json_stringify(meta) || '', packBody(body), PktData);
  };
}

function bind_binaryCallPacket(options) {
  const _common_ = bind_binaryPacketCommon(options);
  const _unpackBySlice = _common_._unpackBinaryPacketBySlice;
  _common_.unpackBinaryPacket = unpackBinaryCallPacket;
  return _common_;

  function unpackBinaryCallPacket(pkt_buf) {
    return _unpackBySlice(pkt_buf, 0);
  }
}

const _fromCharCode$1 = String.fromCharCode;
function bind_binaryPacketCommon(options) {
  const {
    decode_utf8, unpack_base64, packParts,
    PktData, PktJson } = options;

  const pktByKind = {
    [k_data]: PktData, [k_split_data]: PktSplitData,
    [k_json]: PktJson, [k_split_json]: PktSplitJson };

  const repack_binary = bind_repack({
    json: (pkt, hdr) => packParts(`${hdr}\t${k_json}${pkt._meta_}\t${pkt.text()}`),
    split_json: (pkt, hdr) => packParts(`${hdr}\t${k_split_json}${pkt._meta_}\t${pkt._body_}`),

    data: (pkt, hdr) => packParts(`${hdr}\t${k_data}${pkt._meta_}\t`, pkt.buffer()),
    split_data: (pkt, hdr) => packParts(`${hdr}\t${k_split_data}${pkt._meta_}\t`, pkt._body_),
    split_b64: (pkt, hdr) => packParts(`${hdr}\t${k_split_data}${pkt._meta_}\t`, unpack_base64(pkt._body_)) });

  return {
    packBinaryPacket(obj) {
      if ('function' === typeof obj.repack_pkt) {
        return obj.repack_pkt(repack_binary);
      }

      const hdr = as_hdr(obj),
            { body, meta } = obj,
            k_token = body[sym_split];
      return undefined !== k_token ? undefined !== body.src ? packParts(`${hdr}\t${k_token}${obj._meta_}\t${body.src}`) : packParts(`${hdr}\t${k_token}${obj._meta_}\t`, body.buf) : is_json_body(body) ? packParts(`${hdr}\t${k_json}${json_stringify(meta) || ''}\t${json_stringify(body) || ''}`) : packParts(`${hdr}\t${k_data}${json_stringify(meta) || ''}\t`, body);
    },

    _unpackBinaryPacketBySlice(pkt_buf, i0) {
      // 0x9 == '\t'.charCodeAt(0)
      const i1 = pkt_buf.indexOf(0x9, i0);
      const i2 = pkt_buf.indexOf(0x9, 1 + i1);
      if (-1 === i1 || -1 === i2) {
        throw new Error('Invalid packet');
      }

      const hdr = decode_utf8(pkt_buf.slice(i0, i1));
      const kind = _fromCharCode$1(pkt_buf[1 + i1]);
      const meta = decode_utf8(pkt_buf.slice(2 + i1, i2));
      const body = pkt_buf.slice(1 + i2);

      return as_pkt0(hdr, meta, body, pktByKind[kind]);
    },

    fromObjBinaryPacket: bind_packObjPacket(options, repack_binary) };
}

function pkt_call_binary ({ decode_utf8, encode_utf8, pack_base64, unpack_base64, as_data, concat_data }) {
  const packBody = as_data,
        concatBody = concat_data;

  const PktJson = { __proto__: PktJsonBase,
    text() {
      return decode_utf8(this._body_);
    } };

  const PktData = { __proto__: PktDataBase,
    text() {
      return decode_utf8(this._body_);
    },
    base64() {
      return pack_base64(this._body_);
    },
    buffer() {
      return this._body_;
    } };

  return bind_binaryCallPacket({
    decode_utf8, unpack_base64, packBody, packParts, concatBody,
    PktJson, PktData });

  function packParts(hdr, body) {
    if (body) {
      return packPartsU8(hdr, packBody(body));
    } else return hdr;
  }

  function packPartsU8(hdr, body) {
    hdr = encode_utf8(hdr);
    const len0 = hdr.byteLength;
    const len = len0 + body.byteLength;

    const u8 = new Uint8Array(len);
    u8.set(hdr, 0);

    if (len0 !== len) {
      u8.set(new Uint8Array(body.buffer || body), len0);
    }
    return u8;
  }
}

// Max of 16,384 bytes is the practical SCTP limit. (ref: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels#Concerns_with_large_messages)
const maxlen_pkt = 16 << 10;
const maxlen_hdr = 256; // 192 bytes id_route + id_target; 56 all op fields; 8 bytes spacing overhead
const maxlen_msg = maxlen_pkt - maxlen_hdr; // 1.6% overhead reserved


const MultiPktBase = {
  __proto__: null, is_pkt: false, is_multi_pkt: true,
  get id_route() {
    return this.pkt0.id_route;
  },
  get id_target() {
    return this.pkt0.id_target;
  },
  get op() {
    return this.pkt0.op;
  },

  inspect() {
    return undefined !== this.pkt0 ? `«multipkt(${this._parts_} ${this.pkt_kind}) ${json_stringify([this.id_route, this.id_target].join(' '))}»` : `«{MultiPkt(${this.pkt_kind})}»`;
  },

  repack_pkt(repack) {
    throw new Error('MultiPkt are not repackable');
  },

  json // and... text(){}  buffer(){}  base64(){}
};

function splitParts(buf, len) {
  const parts = [];
  for (let i1 = 0, i0 = 0; i0 < len; i0 = i1) {
    i1 = i0 + maxlen_msg;
    parts.push(buf.slice(i0, i1));
  }
  return parts;
}
function bind_multiPacket$1({ decode_utf8, unpack_base64, packBody, concatBody }) {

  const MultiPktJson = { __proto__: MultiPktBase,
    pkt_kind: 'json', is_pkt_json: true,
    text() {
      return this._body_;
    } };

  const MultiPktData = { __proto__: MultiPktBase,
    pkt_kind: 'data', is_pkt_data: true,
    text() {
      return decode_utf8(this.buffer());
    },
    buffer() {
      return this._body_;
    } };

  const unpackByKind = {
    split_b64: pkt => unpack_base64(pkt._body_),
    split_data: pkt => pkt._body_,
    split_json: pkt => 'string' === typeof pkt._body_ ? pkt._body_ : decode_utf8(pkt._body_) };

  return {
    splitBody(body, meta) {
      if (is_json_body(body)) {
        const src = json_stringify(body) || '';
        if (src.length <= maxlen_msg) {
          return [{ [sym_split]: k_json, src }];
        }

        return splitParts(src, src.length).map((src, idx) => 0 === idx ? { [sym_split]: k_split_json, src, idx, meta } : { [sym_split]: k_split_json, src, idx });
      }

      const buf = packBody(body);
      if (buf.byteLength <= maxlen_msg) {
        return [{ [sym_split]: k_data, buf }];
      }

      return splitParts(buf, buf.byteLength).map((buf, idx) => 0 === idx ? { [sym_split]: k_split_data, buf, idx, meta } : { [sym_split]: k_split_data, buf, idx });
    },

    joinPackets(pktList) {
      const pkt0 = pktList[0],
            pkt_kind = pkt0.pkt_kind;
      if (!pktList.every(pkt => pkt_kind === pkt.pkt_kind)) {
        throw new Error(`Mismatched pkt_kind`);
      }

      const unpack_split = unpackByKind[pkt_kind];
      if (!unpack_split) {
        throw new Error(`Unknown pkt_kind: ${pkt_kind}`);
      }

      const is_json = 'split_json' === pkt_kind;
      const MultiPkt = is_json ? MultiPktJson : MultiPktData;

      const parts = pktList.map(unpack_split);
      const _body_ = is_json ? parts.join('') : concatBody(parts);

      return o_create(MultiPkt, {
        pkt0: { value: pkt0 },
        _parts_: { value: parts.length },
        _meta_: { value: pkt0._meta_ },
        _body_: { value: _body_ } });
    } };
}

function pkt_multi ({ decode_utf8, unpack_base64, as_data, concat_data }) {
  return bind_multiPacket$1({ decode_utf8, unpack_base64, packBody: as_data, concatBody: concat_data });
}

function browser_pkt_plugin() {
  return { order: -1, subclass(FabricHub) {
      const data_utils = FabricHub.prototype.data_utils;

      const bin_call = pkt_call_binary(data_utils);
      const _pkts_ = Object.assign({}, { bin_call }, bin_call, pkt_multi(data_utils));

      const _fromObjPacket = _pkts_.fromObjPacket = _pkts_.fromObjBinaryPacket;

      Object.assign(FabricHub.prototype, {
        _pkts_, _fromObjPacket });
    } };
}

function deferred() {
  const e = {};
  e.promise = new Promise((resolve, reject) => {
    e.resolve = resolve;e.reject = reject;
  });
  return e;
}

function timeoutReaper(timeout = 5000) {
  let q = [],
      reap = [];
  const cid = setInterval(tick, Math.max(1000, timeout));
  if (cid.unref) {
    cid.unref();
  }
  return expire;

  function expire(fn) {
    q.push(fn);
  }

  function tick() {
    if (0 !== reap.length) {
      const err = new Error('Timeout');
      console.log('EXPIRE', reap);
      for (const fn of reap) {
        fn(err);
      }
    }
    reap = q;q = [];
  }
}

const sym_sampi = '\u03E0'; // 'Ϡ'

const o_create$1 = Object.create,
      o_assign = Object.assign;

function as_source_id(id) {
  return 'string' === typeof id ? id.split(' ', 2) : 'string' === typeof id[sym_sampi] ? id[sym_sampi].split(' ', 2) : [id.id_route, id.id_target];
}

function as_reply_id(id) {
  return 'string' === typeof id ? id.split(' ', 2) : 'string' === typeof id[sym_sampi] ? id[sym_sampi].split(' ', 2) : [id.from_route, id.from_target];
}

function bind_mx_api(source_api, reply_api) {
  return (pkt_op, _mx_) => {
    const props = {
      _mx_: { value: _mx_ },
      [sym_sampi]: { enumerable: true,
        value: `${_mx_.id_route} ${_mx_.id_target}` } };

    if (null != pkt_op && pkt_op.token) {
      _mx_.opo0.msgid = pkt_op.token;
      return o_create$1(reply_api, props);
    }
    return o_create$1(source_api, props);
  };
}
function msg_base_api(hub, options) {
  const { splitBody, joinPackets } = hub._pkts_;
  const random = hub.data_utils.random;

  const chan = options.channel || hub.channel;
  const tokenLen = Math.max(1, options.tokenLen || 3 | 0);
  const expire = timeoutReaper(options.timeout || 5000);
  const newToken = () => random(tokenLen, true);

  const msg_api0 = bind_msg_api0(chan);

  return {
    newToken, expire, msg_api0,
    bind_msg_api,
    bind_sendmsg,
    bind_replymsg,

    createContext() {
      let db = new Map();
      return { newToken,
        deferredFor(token) {
          if (!token) {
            return;
          }
          let d = db.get(token);
          if (undefined !== d) {
            return d;
          }
          d = deferred();
          db.set(token, d);

          expire(d.reject);
          const remove = () => db.delete(token);
          d.promise.then(remove, remove);
          return d;
        },

        responseFor(token) {
          return this.deferredFor(token).promise;
        },

        on_resolve(msgid, ans) {
          if (!msgid) {
            return ans;
          }
          const d = db.get(msgid);
          if (undefined === d) {
            return ans;
          }
          db.delete(msgid);
          d.resolve(ans);
          return null;
        },

        on_split_pkt(pkt, op) {
          const key = '~ ' + (op.token || op.msgid);
          let d = db.get(key);
          if (undefined === d) {
            d = this.deferredFor(key);
            d.feed = this.on_new_split(key, d);
          } else if (undefined === d.feed) {
            d.feed = this.on_new_split(key, d);
          }

          pkt.complete = d.promise;
          return d.feed(pkt, op);
        },

        on_new_split(key, d) {
          let fin,
              parts = [];
          return function (pkt, op) {
            const { seq } = op;
            if (seq >= 0) {
              parts[seq] = pkt;
              if (!fin) {
                return null;
              }
            } else {
              parts[-seq] = pkt;
              fin = true;
            }

            if (!parts.includes(undefined)) {
              // all parts accounted for
              const multi = joinPackets(parts);
              parts = null;
              d.resolve(multi);
              db.delete(key);
              return multi;
            }
            return null;
          };
        } };
    } };

  function bind_sendmsg(kw) {
    const api = bind_msg_api(kw);
    api.send = api.post;
    return api;
  }

  function bind_replymsg(kw) {
    const api = bind_msg_api(kw);
    api.send = api.answer;
    api.replyExpected = true;
    return api;
  }

  function bind_msg_api({ anon, op_api }) {
    return { __proto__: msg_api0, anon,
      answer: _mp_with_response,
      query: _mp_with_response,
      post: _mp_post,

      dg_post: _dg_post,
      dg_query: _dg_response,
      dg_answer: _dg_response,

      stream(extra) {
        const { response, opo } = this._new_response();
        return _wstream(this, opo, op_api.stream, extra, response);
      },

      multipart(extra) {
        const { response, opo } = this._new_response();
        return _wstream(this, opo, op_api.multipart, extra, response);
      },

      ctrl(body, extra) {
        const meta = undefined !== extra && null !== extra ? extra.meta : undefined;

        const { response, opo } = this._new_response();
        const { id_route, id_target } = this._mx_;
        const obj = { id_route, id_target, body, meta };
        const pkt = op_api.ctrl(obj, opo);
        this._send_pkt(pkt);
        return response;
      } };

    function _mp_post(body, extra) {
      const meta = undefined !== extra && null !== extra ? extra.meta : undefined;

      const parts = splitBody(body, meta);
      if (1 < parts.length) {
        const { opo } = this._new_token();
        return _msend(this, parts, opo);
      }

      const { id_route, id_target, opo0 } = this._mx_;
      const obj = { id_route, id_target, body: parts[0], meta };
      const pkt = op_api.datagram(obj, opo0);
      this._send_pkt(pkt);
    }

    function _mp_with_response(body, extra) {
      const meta = undefined !== extra && null !== extra ? extra.meta : undefined;
      const { response, opo } = this._new_response();

      const parts = splitBody(body, meta);
      if (1 < parts.length) {
        return _msend(this, parts, opo, response);
      }

      const { id_route, id_target } = this._mx_;
      const obj = { id_route, id_target, body: parts[0], meta };
      const pkt = op_api.direct(obj, opo);
      this._send_pkt(pkt);
      return response;
    }

    function _dg_post(body, extra) {
      const meta = undefined !== extra && null !== extra ? extra.meta : undefined;
      const { id_route, id_target, opo0 } = this._mx_;
      const obj = { id_route, id_target, body, meta };
      const pkt = op_api.datagram(obj, opo0);
      this._send_pkt(pkt);
    }

    function _dg_response(body, extra) {
      const meta = undefined !== extra && null !== extra ? extra.meta : undefined;
      const { response, opo } = this._new_response();
      const { id_route, id_target } = this._mx_;
      const obj = { id_route, id_target, body, meta };
      const pkt = op_api.direct(obj, opo);
      this._send_pkt(pkt);
      return response;
    }

    function _msend(msgapi, parts, opo, response) {
      _wstream(msgapi, opo, op_api.multipart, undefined, response).writeAll(parts, true);
      return response;
    }

    function _wstream(msgapi, opo, op_method, extra, response) {
      const meta = undefined !== extra && null !== extra ? extra.meta : undefined;

      const { id_route, id_target } = msgapi._mx_;
      let seq = 0,
          self;
      return self = { response,
        writeMeta: (body, meta) => {
          const obj = { id_route, id_target, body, meta };

          const pkt = op_method(obj, o_assign({ seq: seq++ }, opo));
          msgapi._send_pkt(pkt);
        },

        write: body => {
          const obj = { id_route, id_target, body };

          if (undefined !== meta && null !== meta) {
            obj.meta = meta;
            meta = undefined;
          }

          const pkt = op_method(obj, o_assign({ seq: seq++ }, opo));
          msgapi._send_pkt(pkt);
        },

        writeAll: (body, close) => {
          let cur, next;
          for (next of body) {
            if (undefined !== cur) {
              self.write(cur);
            }
            cur = next;
          }

          if (undefined !== cur) {
            return close ? self.end(cur) : self.write(cur);
          }
        },

        end: body => {
          seq = -seq;
          self.write(body);
          seq = null;
        } };
    }
  }

  function bind_msg_api0(chan) {
    return { __proto__: null,
      inspect() {
        return `«${sym_sampi} ${this[sym_sampi]}»`;
      },
      toJSON(obj = {}) {
        obj[sym_sampi] = this[sym_sampi];return obj;
      },

      _send_pkt: chan.send.bind(chan),

      _new_token() {
        const { ctx, opo0 } = this._mx_;
        const token = ctx.newToken();
        return { token,
          opo: o_assign({ token }, opo0) };
      },

      _new_response() {
        const { ctx, opo0 } = this._mx_;
        if (opo0.msgid) {
          return { opo: opo0 };
        }

        const token = ctx.newToken();
        return { token,
          opo: o_assign({ token }, opo0),
          response: ctx.responseFor(token) };
      } };
  }
}

const _b16_unpack = v => parseInt(v, 16) | 0;
const _b16_pack = v => (v | 0).toString(16);
const _is_defined = (attr, v) => {
  if (undefined === v) {
    throw new Error(attr);
  }
  return v;
};

const frm = {
  _b16_pack, _b16_unpack, _is_defined,

  msgid: { attr: 'msgid',
    unpack: (v, hdr) => {
      hdr.msgid = v;
    },
    pack: hdr => _is_defined('msgid', hdr.msgid) },

  token: { attr: 'token',
    unpack: (v, hdr) => {
      hdr.token = v;
    },
    pack: hdr => _is_defined('token', hdr.token) },

  from_route: { attr: 'from_route',
    unpack: (v, hdr) => {
      hdr.from = true;hdr.from_route = v;
    },
    pack: hdr => _is_defined('from_route', hdr.from_route) },

  from_target: { attr: 'from_target',
    unpack: (v, hdr) => {
      hdr.from_target = v;
    },
    pack: hdr => _is_defined('from_target', hdr.from_target) },

  seq: { attr: 'seq',
    unpack: (v, hdr) => {
      hdr.seq = _b16_unpack(v);
    },
    pack: hdr => _b16_pack(_is_defined('seq', hdr.seq)) } };

function as_op_frame(op_frame) {
  let { kind, action, frames, pack, unpack } = op_frame;

  if (null == frames) {
    frames = [];
  }
  frames.unshift({ attr: 'action',
    unpack: (v, hdr) => {
      hdr.kind = kind;
    },
    pack: hdr => action });

  if (null == pack) {
    const f_pack = frames.map(f => f.pack ? f.pack.bind(f) : null).filter(e => null !== e);
    const bind = _as_pack_fn[f_pack.length] || _as_packN_fn;
    pack = bind(...f_pack);
  }

  if (null == unpack) {
    const f_unpack = frames.map(f => f.unpack ? f.unpack.bind(f) : null).filter(e => null !== e);

    const bind = _as_unpack_fn[f_unpack.length] || _as_unpackN_fn;
    unpack = bind(...f_unpack);
  }

  return Object.assign(op_frame, {
    attrs: frames.map(f => f.attr),
    frames, pack, unpack });
}

// unroll looping over the functions
const _as_pack_fn = [() => hdr => [], f0 => hdr => [f0(hdr)], (f0, f1) => hdr => [f0(hdr), f1(hdr)], (f0, f1, f2) => hdr => [f0(hdr), f1(hdr), f2(hdr)], (f0, f1, f2, f3) => hdr => [f0(hdr), f1(hdr), f2(hdr), f3(hdr)], (f0, f1, f2, f3, f4) => hdr => [f0(hdr), f1(hdr), f2(hdr), f3(hdr), f4(hdr)]];

const _as_packN_fn = (...fns) => hdr => fns.map(f => f(hdr));

// unroll looping over the functions
const _as_unpack_fn = [() => (hdr, op) => op, f0 => (hdr, op) => (f0(hdr[2], op), op), (f0, f1) => (hdr, op) => (f0(hdr[2], op), f1(hdr[3], op), op), (f0, f1, f2) => (hdr, op) => (f0(hdr[2], op), f1(hdr[3], op), f2(hdr[4], op), op), (f0, f1, f2, f3) => (hdr, op) => (f0(hdr[2], op), f1(hdr[3], op), f2(hdr[4], op), f3(hdr[5], op), op), (f0, f1, f2, f3, f4) => (hdr, op) => (f0(hdr[2], op), f1(hdr[3], op), f2(hdr[4], op), f3(hdr[5], op), f4(hdr[6], op), op)];

const _as_unpackN_fn = (...fns) => (hdr, op) => {
  let i = 2;
  for (const f of fns) {
    f(hdr[i++], op);
  }
  return op;
};

function standard_frames() {
  return [
  // control datagram:
  as_op_frame({ kind: 'ctrl', action: '?', frames: [frm.token] }), as_op_frame({ kind: 'ctrl', action: '!', frames: [frm.msgid] })

  // datagram:
  , as_op_frame({ kind: 'datagram', action: '-', frames: [] }), as_op_frame({ kind: 'datagram', action: '@', frames: [frm.from_route, frm.from_target] })

  // direct: 
  , as_op_frame({ kind: 'direct', action: 'E', frames: [frm.token] }), as_op_frame({ kind: 'direct', action: 'e', frames: [frm.msgid] }), as_op_frame({ kind: 'direct', action: 'D', frames: [frm.from_route, frm.from_target, frm.token] }), as_op_frame({ kind: 'direct', action: 'd', frames: [frm.from_route, frm.from_target, frm.msgid] })

  // multipart:
  , as_op_frame({ kind: 'multipart', action: 'U', frames: [frm.token, frm.seq] }), as_op_frame({ kind: 'multipart', action: 'u', frames: [frm.msgid, frm.seq] }), as_op_frame({ kind: 'multipart', action: 'M', frames: [frm.from_route, frm.from_target, frm.token, frm.seq] }), as_op_frame({ kind: 'multipart', action: 'm', frames: [frm.from_route, frm.from_target, frm.msgid, frm.seq] })

  // streaming:
  , as_op_frame({ kind: 'stream', action: 'R', frames: [frm.token, frm.seq] }), as_op_frame({ kind: 'stream', action: 'r', frames: [frm.msgid, frm.seq] }), as_op_frame({ kind: 'stream', action: 'S', frames: [frm.from_route, frm.from_target, frm.token, frm.seq] }), as_op_frame({ kind: 'stream', action: 's', frames: [frm.from_route, frm.from_target, frm.msgid, frm.seq] })];
}

function ident(op) {
  return op;
}
function bind_op_unpack(ops_list) {
  const op_unpack_table = { '': ident, ' ': ident };
  for (const op of ops_list) {
    op_unpack_table[op.action] = op.unpack;
  }
  return op_unpack;

  function op_unpack(pkt, op) {
    const hdr = pkt._hdr_;
    const unpack = op_unpack_table[hdr[2]] || ident;
    unpack(hdr, op);
    return pkt.op = hdr.op = op;
  }
}

function as_ops_api(...ops_list) {
  ops_list = [].concat(...ops_list);
  const api = {};
  for (const { kind, action, pack } of ops_list) {
    // trick to get the proper function displayName
    const name = `op ${action}`,
          tmp = {
      [name](obj, hdr) {
        obj.op = pack(hdr);
        return obj;
      } };

    api[kind] = tmp[name];
  }
  return api;
}
function msg_framing_api(shared, plugin_frames) {
  let all_ops = standard_frames();
  if (plugin_frames) {
    all_ops = plugin_frames({ frm, as_op_frame }, all_ops);
  }

  shared.op_unpack = bind_op_unpack(all_ops);

  const find_ops = ({ has, sans }) => all_ops.filter(op => (!has || has.split(' ').every(a => op.attrs.includes(a))) && (!sans || sans.split(' ').every(a => !op.attrs.includes(a))));

  const basic_from_ops = find_ops({ has: 'from_route', sans: 'token msgid' });
  const basic_anon_ops = find_ops({ sans: 'from_route token msgid' });

  shared.ops_api = {
    from_source: as_ops_api(basic_from_ops, find_ops({ has: 'from_route', sans: 'msgid' })),

    from_reply: as_ops_api(basic_from_ops, find_ops({ has: 'from_route msgid' })),

    anon_source: as_ops_api(basic_anon_ops, find_ops({ sans: 'from_route msgid' })),

    anon_reply: as_ops_api(basic_anon_ops, find_ops({ has: 'msgid', sans: 'from_route' })) };
}

function msg_anon_api(shared) {
  const { newToken, bind_sendmsg, bind_replymsg } = shared;

  const source_api = bind_sendmsg({ anon, op_api: shared.ops_api.anon_source });
  const reply_api = bind_replymsg({ anon, op_api: shared.ops_api.anon_reply });

  const mx_api = bind_mx_api(source_api, reply_api);
  const anon_ctx = { newToken, responseFor() {}, on_response() {} };

  anon_api.root_source = pi_msgs => ({});
  return shared.anon_api = anon_api;

  function anon_api(to_id, pkt_op, source) {
    if (null == source) {
      throw new TypeError('Invalid source');
    }

    const [id_route, id_target] = null !== to_id ? as_source_id(to_id) : as_reply_id(pkt_op);

    if (null == id_target || null == id_route) {
      throw new Error(`Invalid id`);
    }

    return mx_api(pkt_op, {
      id_route, id_target, ctx: anon_ctx, source, opo0: {} });
  }
}

function anon() {
  return this;
}

function msg_source_api(shared) {
  const { op_unpack, from_api, anon_api } = shared;

  return shared.source_api = (src_id, pi_msgs) => {

    const [from_route, from_target] = as_source_id(src_id);
    if (null == from_route || null == from_target) {
      throw new Error('Valid target and route required');
    }

    const ctx = pi_msgs.createContext();

    const source = { _recv_,
      toJSON(obj = {}) {
        obj[sym_sampi] = `${from_route} ${from_target}`;
        return obj;
      },

      anon(id) {
        return anon_api(id, null, source);
      },
      to(id) {
        return from_src(id, null);
      } };

    const from_src = from_api({
      from_route, from_target, ctx, source });

    const pkt_api = {
      anon() {
        return anon_api(null, this, source);
      },
      reply() {
        return from_src(null, this);
      },
      resolve(ans) {
        const { msgid } = this;
        return msgid ? ctx.on_resolve(msgid, ans) : ans;
      } };

    return source;

    function _recv_(pkt) {
      const op = op_unpack(pkt, { __proto__: pkt_api });
      if (pkt.is_pkt_split) {
        return ctx.on_split_pkt(pkt, op);
      } else return pkt;
    }
  };
}

function msg_sendFrom_api(shared) {
  const { bind_sendmsg, bind_replymsg } = shared;

  const source_api = bind_sendmsg({ anon, op_api: shared.ops_api.from_source });
  const reply_api = bind_replymsg({ anon, op_api: shared.ops_api.from_reply });

  const mx_api = bind_mx_api(source_api, reply_api);

  return shared.from_api = ({ from_route, from_target, ctx, source }) => {
    if (null == source) {
      throw new TypeError('Invalid source');
    }

    return (to_id, pkt_op) => {

      const [id_route, id_target] = null !== to_id ? as_source_id(to_id) : as_reply_id(pkt_op);

      if (null == id_route || null == id_target) {
        throw new Error(`Invalid id`);
      }

      return mx_api(pkt_op, {
        id_route, id_target, ctx, source,
        pkt_op, opo0: { from_route, from_target } });
    };
  };

  function anon() {
    const _mx_ = this._mx_;
    return shared.anon_api(_mx_, _mx_.pkt_op, _mx_.source);
  }
}

function msgs_plugin(plugin_options) {
  return function (hub) {
    const msgs = createMsgsPlugin(plugin_options);
    msgs.createMsgsPlugin = createMsgsPlugin;
    return hub.msgs = msgs;

    function createMsgsPlugin(options = {}) {
      const shared = msg_base_api(hub, options);

      msg_framing_api(shared, options.bind_framings);

      if (options.bind_msgapis) {
        _extend_msgapis(options, shared);
      }

      const as_anon = msg_anon_api(shared);
      msg_sendFrom_api(shared);
      const as_src = msg_source_api(shared);

      return {
        to(id) {
          return as_anon(id, null, as_anon.root_source(this));
        },
        as(id) {
          return as_src(id, this);
        },

        createContext: shared.createContext,
        expire: shared.expire };
    }
  };
}

function _extend_msgapis(options, shared) {
  const { bind_msg_api, bind_sendmsg, bind_replymsg } = options.bind_msgapis({
    bind_msg_api: shared.bind_msg_api,
    bind_sendmsg: shared.bind_sendmsg,
    bind_replymsg: shared.bind_replymsg });

  if (bind_msg_api) {
    shared.bind_msg_api = bind_msg_api;
  }
  if (bind_sendmsg) {
    shared.bind_sendmsg = bind_sendmsg;
  }
  if (bind_replymsg) {
    shared.bind_replymsg = bind_replymsg;
  }
}

var FabricHub$2 = FabricHub.plugin(browser_platform_plugin(), browser_pkt_plugin(), msgs_plugin());

var Hub;
function _init(FabricHub) {
  Hub = FabricHub;
}

const chai = require('chai');
const assert = chai.assert;
const expect = chai.expect;

it('smoke', async () => {
  expect(Hub).to.be.a('function');
  expect(Hub.create).to.be.a('function');
});

describe('Hub creation', () => {

  it('new Hub', async () => {
    const hub = new Hub();
    expect(hub.local.id_route).to.be.a('string');
  });

  it('Hub.create', async () => {
    const hub = Hub.create();
    expect(hub.local.id_route).to.be.a('string');
  });

  it('new Hub with specified id_route', async () => {
    const hub = new Hub('$unit$');
    expect(hub.local.id_route).to.equal('$unit$');
  });

  it('Hub.create with specified id_route', async () => {
    const hub = Hub.create('$unit$');
    expect(hub.local.id_route).to.equal('$unit$');
  });

  it('new Hub with id_prefix', async () => {
    const hub = new Hub({ id_prefix: '$unit$' });
    expect(hub.local.id_route.startsWith('$unit$')).to.be.true;
  });

  it('Hub.create with id_prefix', async () => {
    const hub = Hub.create({ id_prefix: '$unit$' });
    expect(hub.local.id_route.startsWith('$unit$')).to.be.true;
  });
});

_init(FabricHub$2);

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiX3VuaXR0ZXN0LmlpZmUuanMiLCJzb3VyY2VzIjpbIi4uL2NvZGUvdXRpbHMuanN5IiwiLi4vY29kZS9yb3V0ZXIuanN5IiwiLi4vY29kZS90YXJnZXRzLmpzeSIsIi4uL2NvZGUvcDJwLmpzeSIsIi4uL2NvZGUvaHViLmpzeSIsIi4uL3BsdWdpbnMvcGxhdGZvcm0vYnJvd3Nlci5qc3kiLCIuLi9wbHVnaW5zL3BrdC9pbXBsL2NvbW1vbl9iYXNlLmpzeSIsIi4uL3BsdWdpbnMvcGt0L2ltcGwvY29tbW9uLmpzeSIsIi4uL3BsdWdpbnMvcGt0L2ltcGwvY29tbW9uX2JpbmFyeS5qc3kiLCIuLi9wbHVnaW5zL3BrdC9pbXBsL2Jyb3dzZXIvY2FsbF9iaW5hcnkuanN5IiwiLi4vcGx1Z2lucy9wa3QvaW1wbC9jb21tb25fbXVsdGkuanN5IiwiLi4vcGx1Z2lucy9wa3QvaW1wbC9icm93c2VyL211bHRpLmpzeSIsIi4uL3BsdWdpbnMvcGt0L2Jyb3dzZXIuanN5IiwiLi4vcGx1Z2lucy9tc2dzL3V0aWwuanN5IiwiLi4vcGx1Z2lucy9tc2dzL2Jhc2UuanN5IiwiLi4vcGx1Z2lucy9tc2dzL2ZyYW1pbmcuanN5IiwiLi4vcGx1Z2lucy9tc2dzL3NlbmRfYW5vbi5qc3kiLCIuLi9wbHVnaW5zL21zZ3Mvc291cmNlLmpzeSIsIi4uL3BsdWdpbnMvbXNncy9zZW5kX2Zyb20uanN5IiwiLi4vcGx1Z2lucy9tc2dzL3BsdWdpbi5qc3kiLCIuLi9jb2RlL2luZGV4LmJyb3dzZXIuanN5IiwidW5pdC9fc2V0dXAuanMiLCJ1bml0L191dGlscy5qcyIsInVuaXQvc21va2UuanMiLCJ1bml0L2h1Yl9jcmVhdGUuanMiLCJ1bml0L2luZGV4LmJyb3dzZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGZ1bmN0aW9uIHByb21pc2VRdWV1ZShzcmMpIDo6XG4gIGxldCB0aXAgPSBudWxsXG4gIHJldHVybiBmdW5jdGlvbiAoKSA6OlxuICAgIGlmIG51bGwgPT09IHRpcCA6OlxuICAgICAgdGlwID0gUHJvbWlzZS5yZXNvbHZlKHNyYykudGhlbihjbGVhcilcbiAgICByZXR1cm4gdGlwXG5cbiAgZnVuY3Rpb24gY2xlYXIoKSA6OiB0aXAgPSBudWxsXG5cblxuY29uc3Qgc3ltX2RlZHVwID0gU3ltYm9sKCdtc2dfZmFicmljX2Rpc2NvdmVyeScpXG5leHBvcnQgZnVuY3Rpb24gZGlzY292ZXJGaXJzdChsc3RGbnMsIHF1ZXJ5LCBvbl9lcnJvcikgOjpcbiAgY29uc3Qga2V5ID0gcXVlcnkua2V5XG4gIGxldCBkZWR1cCA9IGxzdEZuc1tzeW1fZGVkdXBdXG4gIGlmIHVuZGVmaW5lZCAhPT0gZGVkdXAgOjpcbiAgICBjb25zdCByZXMgPSBkZWR1cC5nZXQoa2V5KVxuICAgIGlmIHVuZGVmaW5lZCAhPT0gcmVzIDo6XG4gICAgICByZXR1cm4gcmVzXG5cbiAgZWxzZSA6OlxuICAgIGRlZHVwID0gbmV3IE1hcCgpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5IEAgbHN0Rm5zLCBzeW1fZGVkdXAsIHt2YWx1ZTogZGVkdXB9XG5cbiAgY29uc3QgcmVzID0gbmV3IFByb21pc2UgQCByZXNvbHZlID0+IDo6XG4gICAgY29uc3QgcmVzb2x2ZUlmID0gZSA9PiB1bmRlZmluZWQgIT09IGUgPyByZXNvbHZlKGUpIDogZVxuICAgIGNvbnN0IHRpcCA9IFByb21pc2UucmVzb2x2ZShxdWVyeSlcbiAgICBQcm9taXNlLmFsbCBAXG4gICAgICBBcnJheS5mcm9tIEAgbHN0Rm5zLCBmbiA9PlxuICAgICAgICB0aXAudGhlbihmbikudGhlbihyZXNvbHZlSWYsIG9uX2Vycm9yKVxuICAgIC50aGVuIEA9PiByZXNvbHZlKG51bGwpXG5cbiAgZGVkdXAuc2V0IEAga2V5LCByZXNcbiAgcmVzLnRoZW4gQD0+IGRlZHVwLmRlbGV0ZShrZXkpXG4gIHJldHVybiByZXNcblxuZXhwb3J0IGNvbnN0IHRpbWVvdXRSZXNvbHZlID0gKG1zLCBhbnN3ZXIpID0+XG4gIG5ldyBQcm9taXNlIEAgcmVzb2x2ZSA9PlxuICAgIHNldFRpbWVvdXQgQCByZXNvbHZlLCBtcywgYW5zd2VyXG5cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5UGx1Z2lucyhrZXksIHBsdWdpbkxpc3QsIC4uLmFyZ3MpIDo6XG4gIGlmICEga2V5IDo6IGtleSA9IG51bGxcbiAgZm9yIGxldCBwbHVnaW4gb2YgcGx1Z2luTGlzdCA6OlxuICAgIGlmIG51bGwgIT09IGtleSA6OlxuICAgICAgcGx1Z2luID0gcGx1Z2luW2tleV1cbiAgICBpZiAnZnVuY3Rpb24nID09PSB0eXBlb2YgcGx1Z2luIDo6XG4gICAgICBwbHVnaW4oLi4uYXJncylcblxuXG5leHBvcnQgY2xhc3MgRmFicmljQmFzZSA6OlxuXG5PYmplY3QuYXNzaWduIEAgRmFicmljQmFzZS5wcm90b3R5cGUsIEB7fVxuICBfcHJvbWlzZVF1ZXVlOiBwcm9taXNlUXVldWVcbiAgX2Rpc2NvdmVyRmlyc3Q6IGRpc2NvdmVyRmlyc3RcbiAgX2Rpc2NvdmVyeURlZmF1bHQ6IEBbXSAoKSA9PiB0aW1lb3V0UmVzb2x2ZSg1MDAwLCBudWxsKVxuICBfb25fZXJyb3Ioc2NvcGUsIGVycikgOjogY29uc29sZS5lcnJvciBAIHNjb3BlLCBlcnJcblxuIiwiaW1wb3J0IHtGYWJyaWNCYXNlfSBmcm9tICcuL3V0aWxzLmpzeSdcblxuZXhwb3J0IGNsYXNzIEZhYnJpY1JvdXRlciBleHRlbmRzIEZhYnJpY0Jhc2UgOjpcbiAgX2NyZWF0ZVJvdXRlc01hcCgpIDo6IHJldHVybiBuZXcgTWFwKClcblxuICBjb25zdHJ1Y3RvcigpIDo6XG4gICAgc3VwZXIoKVxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQHt9XG4gICAgICByb3V0ZURpc2NvdmVyeTogQHt9IHZhbHVlOiB0aGlzLl9kaXNjb3ZlcnlEZWZhdWx0LnNsaWNlKClcblxuICAgIHRoaXMuX2JpbmREaXNwYXRjaFJvdXRlcygpXG5cblxuICBfYmluZERpc3BhdGNoUm91dGVzKCkgOjpcbiAgICAvLyBhcyBjbG9zdXJlcyBvdmVyIHByaXZhdGUgdmFyaWFibGVzIChyb3V0ZXNfbWFwKVxuICAgIGNvbnN0IGh1Yl9yb3V0ZXIgPSB0aGlzXG4gICAgY29uc3Qgcm91dGVzX21hcCA9IHRoaXMuX2NyZWF0ZVJvdXRlc01hcCgpXG4gICAgY29uc3QgcHF1ZXVlID0gdGhpcy5fcHJvbWlzZVF1ZXVlKClcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQDpcbiAgICAgIF9iaW5kRGlzcGF0Y2hSb3V0ZXM6IEB7fSB2YWx1ZTogZmFsc2VcbiAgICAgIGRpc3BhdGNoOiBAOiB2YWx1ZTogZGlzcGF0Y2hcbiAgICAgIHJlc29sdmVSb3V0ZTogQDogdmFsdWU6IHJlc29sdmVSb3V0ZVxuICAgICAgcmVnaXN0ZXJSb3V0ZTogQHt9IHZhbHVlOiByZWdpc3RlclJvdXRlXG4gICAgICB1bnJlZ2lzdGVyUm91dGU6IEB7fSB2YWx1ZTogdW5yZWdpc3RlclJvdXRlXG4gICAgcmV0dXJuIGRpc3BhdGNoXG5cblxuICAgIGZ1bmN0aW9uIHJlc29sdmVSb3V0ZShpZF9yb3V0ZSkgOjpcbiAgICAgIHJldHVybiByb3V0ZXNfbWFwLmdldChpZF9yb3V0ZSkgfHxcbiAgICAgICAgaHViX3JvdXRlci5kaXNjb3ZlclJvdXRlKGlkX3JvdXRlKVxuXG4gICAgYXN5bmMgZnVuY3Rpb24gZGlzcGF0Y2hfb25lKHBrdCwgcGt0Y3R4KSA6OlxuICAgICAgdHJ5IDo6XG4gICAgICAgIGNvbnN0IGlkX3JvdXRlID0gcGt0LmlkX3JvdXRlXG4gICAgICAgIGxldCByb3V0ZSA9IHJvdXRlc19tYXAuZ2V0KGlkX3JvdXRlKVxuICAgICAgICBpZiB1bmRlZmluZWQgPT09IHJvdXRlIDo6XG4gICAgICAgICAgcm91dGUgPSBhd2FpdCBodWJfcm91dGVyLmRpc2NvdmVyUm91dGUoaWRfcm91dGUsIHBrdGN0eClcbiAgICAgICAgICBpZiB1bmRlZmluZWQgPT09IHJvdXRlIDo6XG4gICAgICAgICAgICBjb25zdCBjaGFubmVsID0gcGt0Y3R4LmNoYW5uZWxcbiAgICAgICAgICAgIHJldHVybiBjaGFubmVsICYmIGNoYW5uZWwudW5kZWxpdmVyYWJsZShwa3QsICdyb3V0ZScpXG5cbiAgICAgICAgYXdhaXQgcm91dGUocGt0LCBwa3RjdHgpXG4gICAgICBjYXRjaCBlcnIgOjpcbiAgICAgICAgaHViX3JvdXRlci5fb25fZXJyb3IgQCAncm91dGVyLmRpc3BhdGNoJywgZXJyLCB7cGt0LCBwa3RjdHh9XG5cbiAgICBmdW5jdGlvbiBkaXNwYXRjaChwa3RMaXN0LCBjaGFubmVsKSA6OlxuICAgICAgY29uc3QgcHEgPSBwcXVldWUoKSAvLyBwcSB3aWxsIGRpc3BhdGNoIGR1cmluZyBQcm9taXNlIHJlc29sdXRpb25zXG4gICAgICByZXR1cm4gcGt0TGlzdC5tYXAgQCBwa3QgPT5cbiAgICAgICAgcHEudGhlbiBAICgpID0+IGRpc3BhdGNoX29uZSBAIHBrdCwge2NoYW5uZWwsIGh1Yl9yb3V0ZXJ9XG5cblxuICAgIGZ1bmN0aW9uIHJlZ2lzdGVyUm91dGUoaWRfcm91dGUsIHJvdXRlKSA6OlxuICAgICAgaWYgJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIHJvdXRlIDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ3JvdXRlJyB0byBiZSBhIGZ1bmN0aW9uYFxuICAgICAgaWYgcm91dGVzX21hcC5oYXMgQCBpZF9yb3V0ZSA6OlxuICAgICAgICByZXR1cm4gcm91dGVzX21hcC5nZXQoaWRfcm91dGUpXG5cbiAgICAgIHJvdXRlc19tYXAuc2V0IEAgaWRfcm91dGUsIHJvdXRlXG4gICAgICByZXR1cm4gcm91dGVcbiAgICBmdW5jdGlvbiB1bnJlZ2lzdGVyUm91dGUoaWRfcm91dGUpIDo6XG4gICAgICByZXR1cm4gcm91dGVzX21hcC5kZWxldGUgQCBpZF9yb3V0ZVxuXG5cbiAgcmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGUsIGNoYW5uZWwpIDo6XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJSb3V0ZSBAIGlkX3JvdXRlXG4gICAgICBwa3QgPT4gOjogY2hhbm5lbC5zZW5kKHBrdClcblxuXG4gIGFzeW5jIGRpc2NvdmVyUm91dGUoaWRfcm91dGUsIHBrdGN0eCkgOjpcbiAgICBjb25zdCByb3V0ZSA9IGF3YWl0IHRoaXMuX2Rpc2NvdmVyRmlyc3QgQFxuICAgICAgdGhpcy5yb3V0ZURpc2NvdmVyeVxuICAgICAgQHt9IGtleTogaWRfcm91dGUsIGlkX3JvdXRlLCBwa3RjdHhcbiAgICAgIGVyciA9PiB0aGlzLl9vbl9lcnJvciBAICdyb3V0ZXIuZGlzY292ZXJ5JywgZXJyXG5cbiAgICBpZiBudWxsID09IHJvdXRlIDo6IHJldHVyblxuICAgIGlmIHJvdXRlLmVwaGVtZXJhbCA6OiByZXR1cm4gcm91dGVcblxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiByb3V0ZSA6OlxuICAgICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJQZWVyUm91dGUoaWRfcm91dGUsIHJvdXRlKVxuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyUm91dGUoaWRfcm91dGUsIHJvdXRlKVxuXG5cbmV4cG9ydCBkZWZhdWx0IEZhYnJpY1JvdXRlclxuIiwiaW1wb3J0IHtGYWJyaWNCYXNlfSBmcm9tICcuL3V0aWxzLmpzeSdcblxuZXhwb3J0IGNsYXNzIFRhcmdldFJvdXRlciBleHRlbmRzIEZhYnJpY0Jhc2UgOjpcbiAgX2NyZWF0ZVRhcmdldHNNYXAoKSA6OiByZXR1cm4gbmV3IE1hcCgpXG5cbiAgY29uc3RydWN0b3IoaWRfcm91dGUsIHJvdXRlcikgOjpcbiAgICBzdXBlcigpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAe31cbiAgICAgIGlkX3JvdXRlOiBAe30gdmFsdWU6IGlkX3JvdXRlLCBlbnVtZXJhYmxlOiB0cnVlXG4gICAgICB0YXJnZXREaXNjb3Zlcnk6IEB7fSB2YWx1ZTogdGhpcy5fZGlzY292ZXJ5RGVmYXVsdC5zbGljZSgpXG5cbiAgICB0aGlzLl9iaW5kRGlzcGF0Y2hUYXJnZXQoaWRfcm91dGUsIHJvdXRlcilcblxuICBfYmluZERpc3BhdGNoVGFyZ2V0KGlkX3JvdXRlLCByb3V0ZXIpIDo6XG4gICAgLy8gYXMgY2xvc3VyZXMgb3ZlciBwcml2YXRlIHZhcmlhYmxlcyAodGFyZ2V0c19tYXApXG5cbiAgICBjb25zdCB0Z3Rfcm91dGVyID0gdGhpc1xuICAgIGNvbnN0IHRhcmdldHNfbWFwID0gdGhpcy5fY3JlYXRlVGFyZ2V0c01hcCgpXG5cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyBAIHRoaXMsIEB7fVxuICAgICAgcmVnaXN0ZXJUYXJnZXQ6IEB7fSB2YWx1ZTogcmVnaXN0ZXJUYXJnZXRcbiAgICAgIHVucmVnaXN0ZXJUYXJnZXQ6IEB7fSB2YWx1ZTogdW5yZWdpc3RlclRhcmdldFxuICAgICAgX2JpbmREaXNwYXRjaFRhcmdldDogQHt9IHZhbHVlOiBmYWxzZVxuXG4gICAgZGlzcGF0Y2hfdGFyZ2V0LmlkX3JvdXRlID0gaWRfcm91dGVcbiAgICByb3V0ZXIucmVnaXN0ZXJSb3V0ZSBAIGlkX3JvdXRlLCBkaXNwYXRjaF90YXJnZXRcbiAgICByZXR1cm4gdGhpc1xuXG4gICAgYXN5bmMgZnVuY3Rpb24gZGlzcGF0Y2hfdGFyZ2V0KHBrdCwgcGt0Y3R4KSA6OlxuICAgICAgY29uc3QgaWRfdGFyZ2V0ID0gcGt0LmlkX3RhcmdldFxuICAgICAgbGV0IHRhcmdldCA9IHRhcmdldHNfbWFwLmdldChpZF90YXJnZXQpXG4gICAgICBpZiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgICB0YXJnZXQgPSBhd2FpdCB0Z3Rfcm91dGVyLmRpc2NvdmVyVGFyZ2V0KGlkX3RhcmdldCwgcGt0Y3R4KVxuICAgICAgICBpZiB1bmRlZmluZWQgPT09IHRhcmdldCA6OlxuICAgICAgICAgIGNvbnN0IGNoYW5uZWwgPSBwa3RjdHguY2hhbm5lbFxuICAgICAgICAgIHJldHVybiBjaGFubmVsICYmIGNoYW5uZWwudW5kZWxpdmVyYWJsZShwa3QsICd0YXJnZXQnKVxuXG4gICAgICBwa3RjdHgudGd0X3JvdXRlciA9IHRndF9yb3V0ZXJcbiAgICAgIGF3YWl0IHRhcmdldChwa3QsIHBrdGN0eClcblxuXG4gICAgZnVuY3Rpb24gcmVnaXN0ZXJUYXJnZXQoaWRfdGFyZ2V0LCB0YXJnZXQpIDo6XG4gICAgICBpZiAnZnVuY3Rpb24nICE9PSB0eXBlb2YgdGFyZ2V0IDo6XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IgQCBgRXhwZWN0ZWQgJ3RhcmdldCcgZnVuY3Rpb25gXG5cbiAgICAgIGlmIHRhcmdldHNfbWFwLmhhcyBAIGlkX3RhcmdldCA6OlxuICAgICAgICByZXR1cm4gdGFyZ2V0c19tYXAuZ2V0KHRhcmdldClcbiAgICAgIHRhcmdldHNfbWFwLnNldCBAIGlkX3RhcmdldCwgdGFyZ2V0XG4gICAgICByZXR1cm4gdGFyZ2V0XG5cbiAgICBmdW5jdGlvbiB1bnJlZ2lzdGVyVGFyZ2V0KGlkX3RhcmdldCkgOjpcbiAgICAgIHJldHVybiB0YXJnZXRzX21hcC5kZWxldGUgQCBpZF90YXJnZXRcblxuXG4gIGFzeW5jIGRpc2NvdmVyVGFyZ2V0KGlkX3RhcmdldCwgcGt0Y3R4KSA6OlxuICAgIGNvbnN0IHRhcmdldCA9IGF3YWl0IHRoaXMuX2Rpc2NvdmVyRmlyc3QgQFxuICAgICAgdGhpcy50YXJnZXREaXNjb3ZlcnlcbiAgICAgIEB7fSBrZXk6IGlkX3RhcmdldCwgaWRfdGFyZ2V0LCBwa3RjdHhcbiAgICAgIGVyciA9PiB0aGlzLl9vbl9lcnJvciBAICd0YXJnZXQuZGlzY292ZXJ5JywgZXJyXG5cbiAgICBpZiBudWxsID09IHRhcmdldCA6OiByZXR1cm5cblxuICAgIGlmICEgdGFyZ2V0LmVwaGVtZXJhbCA6OlxuICAgICAgdGhpcy5yZWdpc3RlclRhcmdldChpZF90YXJnZXQsIHRhcmdldClcbiAgICByZXR1cm4gdGFyZ2V0XG5cbmV4cG9ydCBkZWZhdWx0IFRhcmdldFJvdXRlclxuIiwiaW1wb3J0IFRhcmdldFJvdXRlciBmcm9tICcuL3RhcmdldHMuanN5J1xuXG5leHBvcnQgY2xhc3MgUDJQUm91dGVyIGV4dGVuZHMgVGFyZ2V0Um91dGVyIDo6XG4gIGNvbnN0cnVjdG9yKHJvdXRlcikgOjpcbiAgICBzdXBlcignJywgcm91dGVyKVxuICAgIHRoaXMucHVibGljX3JvdXRlcyA9IFtdXG4gICAgdGhpcy5pbml0UDJQKClcblxuICBwdWJsaXNoUm91dGUocm91dGUpIDo6XG4gICAgY29uc3QgaWQgPSByb3V0ZS5pZF9yb3V0ZSA/IHJvdXRlLmlkX3JvdXRlXG4gICAgICA6ICdzdHJpbmcnID09PSB0eXBlb2Ygcm91dGUgPyByb3V0ZVxuICAgICAgOiBudWxsXG5cbiAgICBpZiAhIGlkIDo6IHRocm93IG5ldyBFcnJvciBAICdJbnZhbGlkIHJvdXRlIGlkZW50aWZpZXInXG4gICAgdGhpcy5wdWJsaWNfcm91dGVzLnB1c2goaWQpXG4gICAgcmV0dXJuIHRoaXNcblxuXG4gIGluaXRQMlAoKSA6OlxuICAgIHRoaXMucmVnaXN0ZXJUYXJnZXQgQCAnaGVsbG8nLCB0aGlzLl90Z3RfaGVsbG8uYmluZCh0aGlzKVxuICAgIHRoaXMucmVnaXN0ZXJUYXJnZXQgQCAnb2xsZWgnLCB0aGlzLl90Z3Rfb2xsZWguYmluZCh0aGlzKVxuXG4gIGhlbGxvSGFuZHNoYWtlKCkgOjpcbiAgICByZXR1cm4gQHt9XG4gICAgICBpZF90YXJnZXQ6ICdoZWxsbycsIGlkX3JvdXRlOiAnJ1xuICAgICAgYm9keTogdGhpcy5wdWJsaWNfcm91dGVzXG5cbiAgX3RndF9oZWxsbyhwa3QsIHBrdGN0eCkgOjpcbiAgICBjb25zdCB7Y2hhbm5lbCwgaHViX3JvdXRlcn0gPSBwa3RjdHhcbiAgICBjaGFubmVsLnNlbmQgQDpcbiAgICAgIGlkX3RhcmdldDogJ29sbGVoJywgaWRfcm91dGU6ICcnXG4gICAgICBib2R5OiB0aGlzLnB1YmxpY19yb3V0ZXNcblxuICAgIGNvbnN0IHBlZXJfcm91dGVzID0gcGt0Lmpzb24oKVxuICAgIGZvciBjb25zdCBpZF9yb3V0ZSBvZiBwZWVyX3JvdXRlcyA6OlxuICAgICAgaHViX3JvdXRlci5yZWdpc3RlclBlZXJSb3V0ZSBAIGlkX3JvdXRlLCBjaGFubmVsXG5cbiAgX3RndF9vbGxlaChwa3QsIHBrdGN0eCkgOjpcbiAgICBjb25zdCB7Y2hhbm5lbCwgaHViX3JvdXRlcn0gPSBwa3RjdHhcbiAgICBjb25zdCBwZWVyX3JvdXRlcyA9IHBrdC5qc29uKClcbiAgICBmb3IgY29uc3QgaWRfcm91dGUgb2YgcGVlcl9yb3V0ZXMgOjpcbiAgICAgIGh1Yl9yb3V0ZXIucmVnaXN0ZXJQZWVyUm91dGUgQCBpZF9yb3V0ZSwgY2hhbm5lbFxuXG5cbmV4cG9ydCBkZWZhdWx0IFAyUFJvdXRlclxuIiwiaW1wb3J0IEZhYnJpY1JvdXRlcl9CYXNlIGZyb20gJy4vcm91dGVyLmpzeSdcbmltcG9ydCBUYXJnZXRSb3V0ZXJfQmFzZSBmcm9tICcuL3RhcmdldHMuanN5J1xuaW1wb3J0IFAyUFJvdXRlcl9CYXNlIGZyb20gJy4vcDJwLmpzeSdcblxuaW1wb3J0IHthcHBseVBsdWdpbnN9IGZyb20gJy4vdXRpbHMuanN5J1xuXG5leHBvcnQgY2xhc3MgRmFicmljSHViIDo6XG4gIHN0YXRpYyBjcmVhdGUoLi4uYXJncykgOjogcmV0dXJuIG5ldyB0aGlzKC4uLmFyZ3MpXG5cbiAgY29uc3RydWN0b3Iob3B0aW9ucykgOjpcbiAgICBpZiBudWxsID09IG9wdGlvbnMgOjogb3B0aW9ucyA9IHt9XG4gICAgZWxzZSBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIG9wdGlvbnMgOjpcbiAgICAgIG9wdGlvbnMgPSBAe30gaWRfcm91dGU6IG9wdGlvbnNcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgdGhpcywgQHt9XG4gICAgICBvcHRpb25zOiB7dmFsdWU6IG9wdGlvbnN9XG5cbiAgICBhcHBseVBsdWdpbnMgQCAncHJlJywgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG5cbiAgICBjb25zdCByb3V0ZXIgPSB0aGlzLl9pbml0X2ZhYnJpY1JvdXRlcigpXG4gICAgY29uc3QgZGlzcGF0Y2ggPSByb3V0ZXIuZGlzcGF0Y2hcblxuICAgIGNvbnN0IHAycCA9IHRoaXMuY3JlYXRlUDJQUm91dGUocm91dGVyKVxuICAgIGNvbnN0IGxvY2FsID0gdGhpcy5jcmVhdGVMb2NhbFJvdXRlKHJvdXRlciwgb3B0aW9ucy5pZF9yb3V0ZSlcbiAgICBwMnAucHVibGlzaFJvdXRlKGxvY2FsKVxuXG4gICAgY29uc3QgY2hhbm5lbCA9IHRoaXMuX2JpbmRTZW5kTG9jYWwoZGlzcGF0Y2gpXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCB0aGlzLCBAe31cbiAgICAgIHJvdXRlcjogQHt9IHZhbHVlOiByb3V0ZXJcbiAgICAgIGRpc3BhdGNoOiBAe30gdmFsdWU6IGRpc3BhdGNoXG4gICAgICBjaGFubmVsOiBAe30gdmFsdWU6IGNoYW5uZWxcbiAgICAgIHNlbmQ6IEB7fSB2YWx1ZTogY2hhbm5lbC5zZW5kXG5cbiAgICAgIHAycDogQHt9IHZhbHVlOiBwMnBcbiAgICAgIGxvY2FsOiBAe30gdmFsdWU6IGxvY2FsXG5cbiAgICAgIF9jb25uZWN0QnlQcm90b2NvbDogQHt9IHZhbHVlOiB7fVxuXG4gICAgYXBwbHlQbHVnaW5zIEAgbnVsbCwgdGhpcy5wbHVnaW5MaXN0LCB0aGlzXG4gICAgYXBwbHlQbHVnaW5zIEAgJ3Bvc3QnLCB0aGlzLnBsdWdpbkxpc3QsIHRoaXNcbiAgICByZXR1cm4gdGhpc1xuXG5cbiAgX2luaXRfZmFicmljUm91dGVyKCkgOjpcbiAgICBjb25zdCBrbGFzcyA9IHRoaXMuY29uc3RydWN0b3JcbiAgICByZXR1cm4gbmV3IGtsYXNzLkZhYnJpY1JvdXRlcigpXG5cbiAgY3JlYXRlUDJQUm91dGUocm91dGVyPXRoaXMucm91dGVyKSA6OlxuICAgIGNvbnN0IGtsYXNzID0gdGhpcy5jb25zdHJ1Y3RvclxuICAgIHJldHVybiBuZXcga2xhc3MuUDJQUm91dGVyIEAgcm91dGVyXG5cbiAgY3JlYXRlTG9jYWxSb3V0ZShyb3V0ZXI9dGhpcy5yb3V0ZXIsIGlkX3JvdXRlKSA6OlxuICAgIGlmIG51bGwgPT0gaWRfcm91dGUgOjogaWRfcm91dGUgPSB0aGlzLm5ld1JvdXRlSWQoKVxuICAgIGNvbnN0IGtsYXNzID0gdGhpcy5jb25zdHJ1Y3RvclxuICAgIHJldHVybiBuZXcga2xhc3MuVGFyZ2V0Um91dGVyIEBcbiAgICAgIGlkX3JvdXRlLCByb3V0ZXJcblxuICBuZXdSb3V0ZUlkKCkgOjpcbiAgICBjb25zdCBpZCA9IHRoaXMuZGF0YV91dGlscy5yYW5kb20oNSwgdHJ1ZSkuc2xpY2UoMCwgNilcbiAgICBjb25zdCBwcmVmaXggPSB0aGlzLm9wdGlvbnMuaWRfcHJlZml4XG4gICAgcmV0dXJuIHVuZGVmaW5lZCA9PT0gcHJlZml4ID8gaWQgOiBwcmVmaXgraWRcblxuICAvKiBkYXRhX3V0aWxzIGlzIHByb3ZpZGVkIGJ5IHJvdXRlciBwbHVnaW5zXG5cbiAgZGF0YV91dGlscyA9IEB7fVxuICAgIHBhcnNlX3VybChzdHIpIDo6XG4gICAgcmFuZG9tKG4sIGFzQmFzZTY0KSA6OlxuICAgIHBhY2tfYmFzZTY0KGRhdGEpIDo6XG4gICAgdW5wYWNrX2Jhc2U2NChzdHJfYjY0KSA6OlxuICAgIGRlY29kZV91dGY4KHU4KSA6OlxuICAgIGVuY29kZV91dGY4KHN0cikgOjpcblxuICAqL1xuXG4gIG5ld0xvY2FsUm91dGUocHJpdmF0ZVJvdXRlLCBpZF9yb3V0ZSkgOjpcbiAgICBjb25zdCByb3V0ZSA9IHRoaXMuY3JlYXRlTG9jYWxSb3V0ZSh0aGlzLnJvdXRlciwgaWRfcm91dGUpXG4gICAgdGhpcy5wMnAucHVibGlzaFJvdXRlKHJvdXRlKVxuICAgIHJldHVybiByb3V0ZVxuXG5cbiAgY29ubmVjdChjb25uX3VybCkgOjpcbiAgICBpZiAnc3RyaW5nJyA9PT0gdHlwZW9mIGNvbm5fdXJsIDo6XG4gICAgICBjb25uX3VybCA9IHRoaXMuZGF0YV91dGlscy5wYXJzZV91cmwoY29ubl91cmwpXG5cbiAgICBjb25zdCBjb25uZWN0ID0gdGhpcy5fY29ubmVjdEJ5UHJvdG9jb2xbY29ubl91cmwucHJvdG9jb2xdXG4gICAgaWYgISBjb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IgQCBgQ29ubmVjdGlvbiBwcm90b2NvbCBcIiR7Y29ubl91cmwucHJvdG9jb2x9XCIgbm90IHJlZ2lzdGVyZWRgXG4gICAgcmV0dXJuIGNvbm5lY3QoY29ubl91cmwpXG5cbiAgcmVnaXN0ZXJQcm90b2NvbHMocHJvdG9jb2xMaXN0LCBjYl9jb25uZWN0KSA6OlxuICAgIGlmICdmdW5jdGlvbicgIT09IHR5cGVvZiBjYl9jb25uZWN0IDo6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yIEAgYEV4cGVjdGVkICdjYl9jb25uZWN0JyBmdW5jdGlvbmBcbiAgICBmb3IgY29uc3QgcHJvdG9jb2wgb2YgcHJvdG9jb2xMaXN0IDo6XG4gICAgICB0aGlzLl9jb25uZWN0QnlQcm90b2NvbFtwcm90b2NvbF0gPSBjYl9jb25uZWN0XG4gICAgcmV0dXJuIHRoaXNcblxuXG4gIF9iaW5kU2VuZExvY2FsKGRpc3BhdGNoKSA6OlxuICAgIGNvbnN0IHtfZnJvbU9ialBhY2tldCwgX2h1Yl9jaGFubmVsX30gPSB0aGlzXG4gICAgcmV0dXJuIE9iamVjdC5jcmVhdGUgQCBfaHViX2NoYW5uZWxfLCBAe30gc2VuZDoge3ZhbHVlOiBodWJfc2VuZH1cblxuICAgIGZ1bmN0aW9uIGh1Yl9zZW5kKC4uLm9ianMpIDo6XG4gICAgICBjb25zdCBwa3RMaXN0ID0gb2Jqcy5tYXAgQCBfZnJvbU9ialBhY2tldFxuICAgICAgcmV0dXJuIGRpc3BhdGNoIEAgcGt0TGlzdCwgX2h1Yl9jaGFubmVsX1xuICBfZnJvbU9ialBhY2tldChvYmopIDo6IHJldHVybiBvYmogLy8gcGx1Z2luIChwa3QpIHJlc3BvbnNpYmxpdHlcblxuXG4gIHN0YXRpYyBwbHVnaW4oLi4ucGx1Z2luRnVuY3Rpb25zKSA6OlxuICAgIHJldHVybiB0aGlzLnBsdWdpbnMoLi4ucGx1Z2luRnVuY3Rpb25zKVxuICBzdGF0aWMgcGx1Z2lucyguLi5wbHVnaW5GdW5jdGlvbnMpIDo6XG4gICAgY29uc3QgcGx1Z2luTGlzdCA9IE9iamVjdC5mcmVlemUgQFxuICAgICAgdGhpcy5wcm90b3R5cGUucGx1Z2luTGlzdFxuICAgICAgICAuY29uY2F0IEAgcGx1Z2luRnVuY3Rpb25zXG4gICAgICAgIC5zb3J0IEAgKGEsIGIpID0+ICgwIHwgYS5vcmRlcikgLSAoMCB8IGIub3JkZXIpXG5cbiAgICBjbGFzcyBGYWJyaWNIdWIgZXh0ZW5kcyB0aGlzIDo6XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMgQCBGYWJyaWNIdWIucHJvdG90eXBlLCBAe31cbiAgICAgIHBsdWdpbkxpc3Q6IEB7fSB2YWx1ZTogcGx1Z2luTGlzdFxuXG4gICAgY2xhc3MgRmFicmljUm91dGVyIGV4dGVuZHMgdGhpcy5GYWJyaWNSb3V0ZXIgOjpcbiAgICBjbGFzcyBUYXJnZXRSb3V0ZXIgZXh0ZW5kcyB0aGlzLlRhcmdldFJvdXRlciA6OlxuICAgIGNsYXNzIFAyUFJvdXRlciBleHRlbmRzIHRoaXMuUDJQUm91dGVyIDo6XG4gICAgT2JqZWN0LmFzc2lnbiBAIEZhYnJpY0h1YiwgQHt9XG4gICAgICBGYWJyaWNSb3V0ZXIsIFRhcmdldFJvdXRlciwgUDJQUm91dGVyXG5cbiAgICBhcHBseVBsdWdpbnMgQCAnc3ViY2xhc3MnLCBwbHVnaW5MaXN0LCBGYWJyaWNIdWJcbiAgICByZXR1cm4gRmFicmljSHViXG5cblxuY29uc3QgX2h1Yl9jaGFubmVsXyA9IEB7fVxuICBpc19sb2NhbDogdHJ1ZVxuICB1bmRlbGl2ZXJhYmxlKHBrdCwgbW9kZSkgOjpcbiAgICBjb25zdCB7aWRfcm91dGUsIGlkX3RhcmdldH0gPSBwa3RcbiAgICBjb25zb2xlLndhcm4gQCAnfn4gdW5kZWxpdmVyYWJsZSDCq2h1YsK7JywgQHt9XG4gICAgICBtb2RlLCBpZF9yb3V0ZSwgaWRfdGFyZ2V0XG5cbk9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzIEAgRmFicmljSHViLnByb3RvdHlwZSwgQHt9XG4gIHBsdWdpbkxpc3Q6IEB7fSB2YWx1ZTogT2JqZWN0LmZyZWV6ZShbXSlcbiAgX2h1Yl9jaGFubmVsXzogQHt9IHZhbHVlOiBPYmplY3QuY3JlYXRlKF9odWJfY2hhbm5lbF8pXG5cbk9iamVjdC5hc3NpZ24gQCBGYWJyaWNIdWIsIEB7fVxuICBGYWJyaWNSb3V0ZXI6IEZhYnJpY1JvdXRlcl9CYXNlXG4gIFRhcmdldFJvdXRlcjogVGFyZ2V0Um91dGVyX0Jhc2VcbiAgUDJQUm91dGVyOiBQMlBSb3V0ZXJfQmFzZVxuXG5leHBvcnQgZGVmYXVsdCBGYWJyaWNIdWJcbiIsImNvbnN0IF9mcm9tQ2hhckNvZGUgPSBTdHJpbmcuZnJvbUNoYXJDb2RlXG5jb25zdCBfY2hhckNvZGVBdCA9ICcnLmNoYXJDb2RlQXRcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYnJvd3Nlcl9wbGF0Zm9ybV9wbHVnaW4ocGx1Z2luX29wdGlvbnM9e30pIDo6XG4gIHJldHVybiBAOiBvcmRlcjogLTksIHN1YmNsYXNzKEZhYnJpY0h1YikgOjpcblxuICAgIE9iamVjdC5hc3NpZ24gQCBGYWJyaWNIdWIucHJvdG90eXBlLCBAe31cbiAgICAgIGRhdGFfdXRpbHNcblxuICAgIE9iamVjdC5hc3NpZ24gQCBGYWJyaWNIdWIuVGFyZ2V0Um91dGVyLnByb3RvdHlwZSwgQHt9XG4gICAgICBkYXRhX3V0aWxzXG5cbmNvbnN0IGRhdGFfdXRpbHMgPSBAe31cbiAgcmFuZG9tLCBwYXJzZV91cmxcbiAgcGFja19iYXNlNjQsIHVucGFja19iYXNlNjRcbiAgZGVjb2RlX3V0ZjgsIGVuY29kZV91dGY4XG4gIGFzX2RhdGEsIGNvbmNhdF9kYXRhXG5cbmZ1bmN0aW9uIHJhbmRvbShuLCBhc0Jhc2U2NCkgOjpcbiAgY29uc3QgdWEgPSBuZXcgVWludDhBcnJheShuKVxuICB3aW5kb3cuY3J5cHRvLmdldFJhbmRvbVZhbHVlcyh1YSlcbiAgcmV0dXJuIGFzQmFzZTY0ID8gcGFja19iYXNlNjQodWEpIDogdWFcblxuZnVuY3Rpb24gcGFyc2VfdXJsKHVybCkgOjpcbiAgcmV0dXJuIG5ldyBVUkwodXJsKVxuXG5mdW5jdGlvbiBwYWNrX2Jhc2U2NChkYXRhKSA6OlxuICBjb25zdCB1OCA9IG5ldyBVaW50OEFycmF5KGRhdGEuYnVmZmVyIHx8IGRhdGEpLCBsZW4gPSB1OC5ieXRlTGVuZ3RoXG5cbiAgbGV0IHJlcz0nJ1xuICBmb3IgKGxldCBpPTA7IGk8bGVuOyBpKyspXG4gICAgcmVzICs9IF9mcm9tQ2hhckNvZGUodThbaV0pXG4gIHJldHVybiB3aW5kb3cuYnRvYShyZXMpXG5cbmZ1bmN0aW9uIHVucGFja19iYXNlNjQoc3RyX2I2NCkgOjpcbiAgY29uc3Qgc3ogPSB3aW5kb3cuYXRvYihzdHJfYjY0KSwgbGVuID0gc3oubGVuZ3RoXG5cbiAgY29uc3QgcmVzID0gbmV3IFVpbnQ4QXJyYXkobGVuKVxuICBmb3IgKGxldCBpPTA7IGk8bGVuOyBpKyspXG4gICAgcmVzW2ldICs9IF9jaGFyQ29kZUF0LmNhbGwoc3osIGkpXG4gIHJldHVybiByZXNcblxuZnVuY3Rpb24gZGVjb2RlX3V0ZjgodTgpIDo6XG4gIHJldHVybiBuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUodTgpXG5cbmZ1bmN0aW9uIGVuY29kZV91dGY4KHN0cikgOjpcbiAgcmV0dXJuIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzdHIpXG5cbmZ1bmN0aW9uIGFzX2RhdGEoZGF0YSkgOjpcbiAgaWYgbnVsbCA9PT0gZGF0YSA6OlxuICAgIHJldHVybiBuZXcgQXJyYXlCdWZmZXIoMClcbiAgcmV0dXJuICdzdHJpbmcnID09PSB0eXBlb2YgZGF0YVxuICAgID8gZW5jb2RlX3V0ZjgoZGF0YSlcbiAgICA6IG5ldyBBcnJheUJ1ZmZlcihkYXRhKVxuXG5mdW5jdGlvbiBjb25jYXRfZGF0YShwYXJ0cykgOjpcbiAgbGV0IGk9MCwgbGVuPTBcbiAgZm9yIGNvbnN0IGIgb2YgcGFydHMgOjpcbiAgICBsZW4gKz0gYi5ieXRlTGVuZ3RoXG5cbiAgY29uc3QgdWEgPSBuZXcgVWludDhBcnJheShsZW4pXG4gIGZvciBjb25zdCBiIG9mIHBhcnRzIDo6XG4gICAgdWEuc2V0IEAgbmV3IFVpbnQ4QXJyYXkoYi5idWZmZXIgfHwgYiksIGlcbiAgICBpICs9IGIuYnl0ZUxlbmd0aFxuICByZXR1cm4gdWFcblxuIiwiZXhwb3J0IGNvbnN0IGpzb25fcGFyc2UgPSBKU09OLnBhcnNlXG5leHBvcnQgY29uc3QganNvbl9zdHJpbmdpZnkgPSBKU09OLnN0cmluZ2lmeVxuXG5leHBvcnQgZnVuY3Rpb24gYXNfaGRyKHtpZF9yb3V0ZSwgaWRfdGFyZ2V0LCBvcH0pIDo6XG4gIGlmICdzdHJpbmcnICE9PSB0eXBlb2YgaWRfcm91dGUgOjogdGhyb3cgbmV3IFR5cGVFcnJvciBAICdpZF9yb3V0ZSdcbiAgaWYgJ3N0cmluZycgIT09IHR5cGVvZiBpZF90YXJnZXQgOjogdGhyb3cgbmV3IFR5cGVFcnJvciBAICdpZF90YXJnZXQnXG4gIHJldHVybiBvcCAmJiBvcC5sZW5ndGhcbiAgICA/IGAke2lkX3JvdXRlfSAke2lkX3RhcmdldH0gJHtvcD9vcC5qb2luKCcgJyk6Jyd9YFxuICAgIDogYCR7aWRfcm91dGV9ICR7aWRfdGFyZ2V0fWBcblxuZXhwb3J0IGNvbnN0IG9fY3JlYXRlID0gT2JqZWN0LmNyZWF0ZVxuZXhwb3J0IGZ1bmN0aW9uIGFzX3BrdDAoaGRyLCBtZXRhLCBib2R5LCBhUGt0QmFzZSkgOjpcbiAgcmV0dXJuIG9fY3JlYXRlIEAgYVBrdEJhc2UsIEB7fVxuICAgIF9oZHJfOiBAe30gdmFsdWU6IGhkci5zcGxpdCgnICcpXG4gICAgX21ldGFfOiBAe30gdmFsdWU6IG1ldGFcbiAgICBfYm9keV86IEB7fSB2YWx1ZTogYm9keVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBpc19qc29uX2JvZHkoYm9keSkgOjpcbiAgaWYgbnVsbCA9PSBib2R5IDo6IHJldHVybiB0cnVlXG4gIHJldHVybiB1bmRlZmluZWQgPT09IGJvZHkuYnl0ZUxlbmd0aFxuICAgICYmICdzdHJpbmcnICE9PSB0eXBlb2YgYm9keVxuXG5leHBvcnQgZnVuY3Rpb24gYmluZF9yZXBhY2socmVwYWNrQnlLaW5kKSA6OlxuICByZXR1cm4gKHBrdCwgcGt0X2tpbmQpID0+XG4gICAgcmVwYWNrQnlLaW5kW3BrdF9raW5kXSBAXG4gICAgICBwa3QsIHBrdC5faGRyXy5qb2luKCcgJylcblxuIiwiaW1wb3J0IHtpc19qc29uX2JvZHksIGpzb25fc3RyaW5naWZ5LCBqc29uX3BhcnNlfSBmcm9tICcuL2NvbW1vbl9iYXNlLmpzeSdcbmltcG9ydCB7YXNfaGRyLCBhc19wa3QwfSBmcm9tICcuL2NvbW1vbl9iYXNlLmpzeSdcblxuZXhwb3J0IGNvbnN0IFBrdEJhc2UgPSBAe31cbiAgX19wcm90b19fOiBudWxsLCBpc19wa3Q6IHRydWVcbiAgZ2V0IGlkX3JvdXRlKCkgOjogcmV0dXJuIHRoaXMuX2hkcl9bMF1cbiAgZ2V0IGlkX3RhcmdldCgpIDo6IHJldHVybiB0aGlzLl9oZHJfWzFdXG4gIG1ldGEocmV2aXZlcikgOjogcmV0dXJuIGpzb25fcGFyc2UodGhpcy5fbWV0YV98fG51bGwsIHJldml2ZXIpXG5cbiAgaW5zcGVjdCgpIDo6IHJldHVybiB0aGlzLl9oZHJfXG4gICAgPyBgwqtwa3QoJHt0aGlzLnBrdF9raW5kfSkgJHtqc29uX3N0cmluZ2lmeSh0aGlzLl9oZHJfLmpvaW4oJyAnKSl9wrtgXG4gICAgOiBgwqt7UGt0KCR7dGhpcy5wa3Rfa2luZH0pfcK7YFxuICByZXBhY2tfcGt0KHJlcGFjaykgOjogcmV0dXJuIHJlcGFjayh0aGlzLCB0aGlzLnBrdF9raW5kKVxuXG5cbmV4cG9ydCBmdW5jdGlvbiBqc29uKHJldml2ZXIpIDo6XG4gIGNvbnN0IHNyYyA9IHRoaXMudGV4dCgpXG4gIGlmIHNyYyA6OiByZXR1cm4ganNvbl9wYXJzZShzcmMsIHJldml2ZXIpXG5cbmV4cG9ydCBjb25zdCBQa3RKc29uQmFzZSA9IEB7fSBfX3Byb3RvX186IFBrdEJhc2VcbiAgcGt0X2tpbmQ6ICdqc29uJywgaXNfcGt0X2pzb246IHRydWVcbiAganNvbiAvLyBhbmQuLi4gdGV4dCgpe31cblxuZXhwb3J0IGNvbnN0IFBrdERhdGFCYXNlID0gQHt9IF9fcHJvdG9fXzogUGt0QmFzZVxuICBwa3Rfa2luZDogJ2RhdGEnLCBpc19wa3RfZGF0YTogdHJ1ZVxuICBqc29uIC8vIGFuZC4uLiB0ZXh0KCl7fSAgYnVmZmVyKCl7fSAgYmFzZTY0KCl7fVxuXG5cbmV4cG9ydCBjb25zdCBzeW1fc3BsaXQgPSBTeW1ib2woJ3BrdCBzcGxpdCcpXG5leHBvcnQgY29uc3Qga19kYXRhID0gJz0nLCBrX3NwbGl0X2RhdGEgPSAnPydcbmV4cG9ydCBjb25zdCBrX2pzb24gPSAnQCcsIGtfc3BsaXRfanNvbiA9ICcjJ1xuXG5leHBvcnQgY29uc3QgUGt0U3BsaXRKc29uID0gQHt9IF9fcHJvdG9fXzogUGt0QmFzZVxuICBwa3Rfa2luZDogJ3NwbGl0X2pzb24nLCBpc19wa3Rfc3BsaXQ6IHRydWVcblxuZXhwb3J0IGNvbnN0IFBrdFNwbGl0RGF0YSA9IEB7fSBfX3Byb3RvX186IFBrdEJhc2VcbiAgcGt0X2tpbmQ6ICdzcGxpdF9kYXRhJywgaXNfcGt0X3NwbGl0OiB0cnVlXG5cbmV4cG9ydCBjb25zdCBQa3RTcGxpdERhdGE2NCA9IEB7fSBfX3Byb3RvX186IFBrdEJhc2VcbiAgcGt0X2tpbmQ6ICdzcGxpdF9iNjQnLCBpc19wa3Rfc3BsaXQ6IHRydWVcblxuXG5leHBvcnQgZnVuY3Rpb24gYmluZF9wYWNrT2JqUGFja2V0KHtQa3REYXRhLCBQa3RKc29uLCBwYWNrQm9keX0sIHJlcGFjaykgOjpcbiAgY29uc3QgcGt0QnlLaW5kID0gQHt9XG4gICAgW2tfZGF0YV06IFBrdERhdGEsIFtrX3NwbGl0X2RhdGFdOiBQa3RTcGxpdERhdGFcbiAgICBba19qc29uXTogUGt0SnNvbiwgW2tfc3BsaXRfanNvbl06IFBrdFNwbGl0SnNvblxuXG4gIHJldHVybiBmdW5jdGlvbiAob2JqKSA6OlxuICAgIGlmICdmdW5jdGlvbicgPT09IHR5cGVvZiBvYmoucmVwYWNrX3BrdCA6OlxuICAgICAgcmV0dXJuIG9iai5yZXBhY2tfcGt0KHJlcGFjaylcblxuICAgIGNvbnN0IGhkcj1hc19oZHIob2JqKSwge2JvZHksIG1ldGF9PW9iaiwga190b2tlbj1ib2R5W3N5bV9zcGxpdF1cbiAgICByZXR1cm4gdW5kZWZpbmVkICE9PSBrX3Rva2VuXG4gICAgICA/IEAgdW5kZWZpbmVkICE9PSBib2R5LnNyY1xuICAgICAgICAgID8gYXNfcGt0MCBAIGhkciwgbWV0YSwgYm9keS5zcmMsIHBrdEJ5S2luZFtrX3Rva2VuXVxuICAgICAgICAgIDogYXNfcGt0MCBAIGhkciwgbWV0YSwgYm9keS5idWYsIHBrdEJ5S2luZFtrX3Rva2VuXVxuXG4gICAgICA6IEAgaXNfanNvbl9ib2R5KGJvZHkpXG4gICAgICAgICAgPyBhc19wa3QwIEAgaGRyLCBqc29uX3N0cmluZ2lmeShtZXRhKXx8JycsIGpzb25fc3RyaW5naWZ5KGJvZHkpfHwnJywgUGt0SnNvblxuICAgICAgICAgIDogYXNfcGt0MCBAIGhkciwganNvbl9zdHJpbmdpZnkobWV0YSl8fCcnLCBwYWNrQm9keShib2R5KSwgUGt0RGF0YVxuXG4iLCJpbXBvcnQgeyBpc19qc29uX2JvZHksIGpzb25fc3RyaW5naWZ5LCBqc29uX3BhcnNlLCBiaW5kX3JlcGFjayB9IGZyb20gJy4vY29tbW9uX2Jhc2UuanN5J1xuaW1wb3J0IHsgYXNfaGRyLCBhc19wa3QwIH0gZnJvbSAnLi9jb21tb25fYmFzZS5qc3knXG5cbmltcG9ydCB7IGtfZGF0YSwga19zcGxpdF9kYXRhLCBrX2pzb24sIGtfc3BsaXRfanNvbiwgc3ltX3NwbGl0IH0gZnJvbSAnLi9jb21tb24uanN5J1xuaW1wb3J0IHsgUGt0U3BsaXRKc29uLCBQa3RTcGxpdERhdGEgfSBmcm9tICcuL2NvbW1vbi5qc3knXG5pbXBvcnQgeyBiaW5kX3BhY2tPYmpQYWNrZXQgfSBmcm9tICcuL2NvbW1vbi5qc3knXG5cbmV4cG9ydCB7IFBrdEpzb25CYXNlLCBQa3REYXRhQmFzZSB9IGZyb20gJy4vY29tbW9uLmpzeSdcblxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRfYmluYXJ5Q2FsbFBhY2tldChvcHRpb25zKSA6OlxuICBjb25zdCBfY29tbW9uXyA9IGJpbmRfYmluYXJ5UGFja2V0Q29tbW9uKG9wdGlvbnMpXG4gIGNvbnN0IF91bnBhY2tCeVNsaWNlID0gX2NvbW1vbl8uX3VucGFja0JpbmFyeVBhY2tldEJ5U2xpY2VcbiAgX2NvbW1vbl8udW5wYWNrQmluYXJ5UGFja2V0ID0gdW5wYWNrQmluYXJ5Q2FsbFBhY2tldFxuICByZXR1cm4gX2NvbW1vbl9cblxuICBmdW5jdGlvbiB1bnBhY2tCaW5hcnlDYWxsUGFja2V0KHBrdF9idWYpIDo6XG4gICAgcmV0dXJuIF91bnBhY2tCeVNsaWNlIEAgcGt0X2J1ZiwgMFxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kX2JpbmFyeUxlblBhY2tldChvcHRpb25zKSA6OlxuICBjb25zdCBfY29tbW9uXyA9IGJpbmRfYmluYXJ5UGFja2V0Q29tbW9uKG9wdGlvbnMpXG4gIGNvbnN0IF91bnBhY2tCeVNsaWNlID0gX2NvbW1vbl8uX3VucGFja0JpbmFyeVBhY2tldEJ5U2xpY2VcbiAgX2NvbW1vbl8udW5wYWNrQmluYXJ5UGFja2V0ID0gdW5wYWNrQmluYXJ5TGVuUGFja2V0XG4gIHJldHVybiBfY29tbW9uX1xuXG4gIGZ1bmN0aW9uIHVucGFja0JpbmFyeUxlblBhY2tldChwa3RfYnVmKSA6OlxuICAgIGNvbnN0IGxlbiA9IHBrdF9idWZbMF0gfCBwa3RfYnVmWzFdPDw4IC8vIGFzIFVpbnQxNiBMRVxuICAgIGlmIGxlbiAhPT0gcGt0X2J1Zi5sZW5ndGggOjpcbiAgICAgIHRocm93IG5ldyBFcnJvciBAICdJbnZhbGlkIHBhY2tldCBsZW5ndGgnXG5cbiAgICByZXR1cm4gX3VucGFja0J5U2xpY2UgQCBwa3RfYnVmLCAyXG5cblxuY29uc3QgX2Zyb21DaGFyQ29kZSA9IFN0cmluZy5mcm9tQ2hhckNvZGVcbmV4cG9ydCBmdW5jdGlvbiBiaW5kX2JpbmFyeVBhY2tldENvbW1vbihvcHRpb25zKSA6OlxuICBjb25zdCBAe31cbiAgICBkZWNvZGVfdXRmOCwgdW5wYWNrX2Jhc2U2NCwgcGFja1BhcnRzXG4gICAgUGt0RGF0YSwgUGt0SnNvblxuICA9IG9wdGlvbnNcblxuICBjb25zdCBwa3RCeUtpbmQgPSBAe31cbiAgICBba19kYXRhXTogUGt0RGF0YSwgW2tfc3BsaXRfZGF0YV06IFBrdFNwbGl0RGF0YVxuICAgIFtrX2pzb25dOiBQa3RKc29uLCBba19zcGxpdF9qc29uXTogUGt0U3BsaXRKc29uXG5cbiAgY29uc3QgcmVwYWNrX2JpbmFyeSA9IGJpbmRfcmVwYWNrIEA6XG4gICAganNvbjogKHBrdCwgaGRyKSA9PiBwYWNrUGFydHMgQCBgJHtoZHJ9XFx0JHtrX2pzb259JHtwa3QuX21ldGFffVxcdCR7cGt0LnRleHQoKX1gXG4gICAgc3BsaXRfanNvbjogKHBrdCwgaGRyKSA9PiBwYWNrUGFydHMgQCBgJHtoZHJ9XFx0JHtrX3NwbGl0X2pzb259JHtwa3QuX21ldGFffVxcdCR7cGt0Ll9ib2R5X31gXG5cbiAgICBkYXRhOiAocGt0LCBoZHIpID0+IHBhY2tQYXJ0cyBAIGAke2hkcn1cXHQke2tfZGF0YX0ke3BrdC5fbWV0YV99XFx0YCwgcGt0LmJ1ZmZlcigpXG4gICAgc3BsaXRfZGF0YTogKHBrdCwgaGRyKSA9PiBwYWNrUGFydHMgQCBgJHtoZHJ9XFx0JHtrX3NwbGl0X2RhdGF9JHtwa3QuX21ldGFffVxcdGAsIHBrdC5fYm9keV9cbiAgICBzcGxpdF9iNjQ6IChwa3QsIGhkcikgPT4gcGFja1BhcnRzIEAgYCR7aGRyfVxcdCR7a19zcGxpdF9kYXRhfSR7cGt0Ll9tZXRhX31cXHRgLCB1bnBhY2tfYmFzZTY0KHBrdC5fYm9keV8pXG5cbiAgcmV0dXJuIEB7fVxuICAgIHBhY2tCaW5hcnlQYWNrZXQob2JqKSA6OlxuICAgICAgaWYgJ2Z1bmN0aW9uJyA9PT0gdHlwZW9mIG9iai5yZXBhY2tfcGt0IDo6XG4gICAgICAgIHJldHVybiBvYmoucmVwYWNrX3BrdChyZXBhY2tfYmluYXJ5KVxuXG4gICAgICBjb25zdCBoZHI9YXNfaGRyKG9iaiksIHtib2R5LCBtZXRhfT1vYmosIGtfdG9rZW49Ym9keVtzeW1fc3BsaXRdXG4gICAgICByZXR1cm4gdW5kZWZpbmVkICE9PSBrX3Rva2VuXG4gICAgICAgID8gQCB1bmRlZmluZWQgIT09IGJvZHkuc3JjXG4gICAgICAgICAgICA/IHBhY2tQYXJ0cyBAIGAke2hkcn1cXHQke2tfdG9rZW59JHtvYmouX21ldGFffVxcdCR7Ym9keS5zcmN9YFxuICAgICAgICAgICAgOiBwYWNrUGFydHMgQCBgJHtoZHJ9XFx0JHtrX3Rva2VufSR7b2JqLl9tZXRhX31cXHRgLCBib2R5LmJ1ZlxuXG4gICAgICAgIDogQCBpc19qc29uX2JvZHkoYm9keSlcbiAgICAgICAgICAgID8gcGFja1BhcnRzIEAgYCR7aGRyfVxcdCR7a19qc29ufSR7anNvbl9zdHJpbmdpZnkobWV0YSl8fCcnfVxcdCR7anNvbl9zdHJpbmdpZnkoYm9keSl8fCcnfWBcbiAgICAgICAgICAgIDogcGFja1BhcnRzIEAgYCR7aGRyfVxcdCR7a19kYXRhfSR7anNvbl9zdHJpbmdpZnkobWV0YSl8fCcnfVxcdGAsIGJvZHlcblxuICAgIF91bnBhY2tCaW5hcnlQYWNrZXRCeVNsaWNlKHBrdF9idWYsIGkwKSA6OlxuICAgICAgLy8gMHg5ID09ICdcXHQnLmNoYXJDb2RlQXQoMClcbiAgICAgIGNvbnN0IGkxID0gcGt0X2J1Zi5pbmRleE9mKDB4OSwgaTApXG4gICAgICBjb25zdCBpMiA9IHBrdF9idWYuaW5kZXhPZigweDksIDEraTEpXG4gICAgICBpZiAtMSA9PT0gaTEgfHwgLTEgPT09IGkyIDo6XG4gICAgICAgIHRocm93IG5ldyBFcnJvciBAICdJbnZhbGlkIHBhY2tldCdcblxuICAgICAgY29uc3QgaGRyID0gZGVjb2RlX3V0ZjggQCBwa3RfYnVmLnNsaWNlKGkwLCBpMSlcbiAgICAgIGNvbnN0IGtpbmQgPSBfZnJvbUNoYXJDb2RlIEAgcGt0X2J1ZlsxK2kxXVxuICAgICAgY29uc3QgbWV0YSA9IGRlY29kZV91dGY4IEAgcGt0X2J1Zi5zbGljZSgyK2kxLCBpMilcbiAgICAgIGNvbnN0IGJvZHkgPSBwa3RfYnVmLnNsaWNlKDEraTIpXG5cbiAgICAgIHJldHVybiBhc19wa3QwIEAgaGRyLCBtZXRhLCBib2R5LCBwa3RCeUtpbmRba2luZF1cblxuICAgIGZyb21PYmpCaW5hcnlQYWNrZXQ6IGJpbmRfcGFja09ialBhY2tldChvcHRpb25zLCByZXBhY2tfYmluYXJ5KVxuXG4iLCJpbXBvcnQgeyBQa3RKc29uQmFzZSwgUGt0RGF0YUJhc2UsIGJpbmRfYmluYXJ5Q2FsbFBhY2tldCB9IGZyb20gJy4uL2NvbW1vbl9iaW5hcnkuanN5J1xuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih7IGRlY29kZV91dGY4LCBlbmNvZGVfdXRmOCwgcGFja19iYXNlNjQsIHVucGFja19iYXNlNjQsIGFzX2RhdGEsIGNvbmNhdF9kYXRhIH0pIDo6XG4gIGNvbnN0IHBhY2tCb2R5PWFzX2RhdGEsIGNvbmNhdEJvZHk9Y29uY2F0X2RhdGFcblxuICBjb25zdCBQa3RKc29uID0gQHt9IF9fcHJvdG9fXzogUGt0SnNvbkJhc2VcbiAgICB0ZXh0KCkgOjogcmV0dXJuIGRlY29kZV91dGY4IEAgdGhpcy5fYm9keV9cblxuICBjb25zdCBQa3REYXRhID0gQHt9IF9fcHJvdG9fXzogUGt0RGF0YUJhc2VcbiAgICB0ZXh0KCkgOjogcmV0dXJuIGRlY29kZV91dGY4IEAgdGhpcy5fYm9keV9cbiAgICBiYXNlNjQoKSA6OiByZXR1cm4gcGFja19iYXNlNjQgQCB0aGlzLl9ib2R5X1xuICAgIGJ1ZmZlcigpIDo6IHJldHVybiB0aGlzLl9ib2R5X1xuXG5cbiAgcmV0dXJuIGJpbmRfYmluYXJ5Q2FsbFBhY2tldCBAOlxuICAgIGRlY29kZV91dGY4LCB1bnBhY2tfYmFzZTY0LCBwYWNrQm9keSwgcGFja1BhcnRzLCBjb25jYXRCb2R5XG4gICAgUGt0SnNvbiwgUGt0RGF0YVxuXG5cbiAgZnVuY3Rpb24gcGFja1BhcnRzKGhkciwgYm9keSkgOjpcbiAgICBpZiBib2R5IDo6XG4gICAgICByZXR1cm4gcGFja1BhcnRzVTggQCBoZHIsIHBhY2tCb2R5KGJvZHkpXG4gICAgZWxzZSByZXR1cm4gaGRyXG5cbiAgZnVuY3Rpb24gcGFja1BhcnRzVTgoaGRyLCBib2R5KSA6OlxuICAgIGhkciA9IGVuY29kZV91dGY4KGhkcilcbiAgICBjb25zdCBsZW4wID0gaGRyLmJ5dGVMZW5ndGhcbiAgICBjb25zdCBsZW4gPSBsZW4wICsgYm9keS5ieXRlTGVuZ3RoXG5cbiAgICBjb25zdCB1OCA9IG5ldyBVaW50OEFycmF5KGxlbilcbiAgICB1OC5zZXQgQCBoZHIsIDBcblxuICAgIGlmIGxlbjAgIT09IGxlbiA6OlxuICAgICAgdTguc2V0IEAgbmV3IFVpbnQ4QXJyYXkoYm9keS5idWZmZXIgfHwgYm9keSksIGxlbjBcbiAgICByZXR1cm4gdThcblxuIiwiaW1wb3J0IHsgaXNfanNvbl9ib2R5LCBqc29uX3N0cmluZ2lmeSwgb19jcmVhdGUgfSBmcm9tICcuL2NvbW1vbl9iYXNlLmpzeSdcblxuaW1wb3J0IHsga19kYXRhLCBrX3NwbGl0X2RhdGEsIGtfanNvbiwga19zcGxpdF9qc29uLCBzeW1fc3BsaXQgfSBmcm9tICcuL2NvbW1vbi5qc3knXG5pbXBvcnQgeyBqc29uIH0gZnJvbSAnLi9jb21tb24uanN5J1xuXG4vLyBNYXggb2YgMTYsMzg0IGJ5dGVzIGlzIHRoZSBwcmFjdGljYWwgU0NUUCBsaW1pdC4gKHJlZjogaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1dlYlJUQ19BUEkvVXNpbmdfZGF0YV9jaGFubmVscyNDb25jZXJuc193aXRoX2xhcmdlX21lc3NhZ2VzKVxuZXhwb3J0IGNvbnN0IG1heGxlbl9wa3QgPSAxNiA8PCAxMFxuZXhwb3J0IGNvbnN0IG1heGxlbl9oZHIgPSAyNTYgLy8gMTkyIGJ5dGVzIGlkX3JvdXRlICsgaWRfdGFyZ2V0OyA1NiBhbGwgb3AgZmllbGRzOyA4IGJ5dGVzIHNwYWNpbmcgb3ZlcmhlYWRcbmV4cG9ydCBjb25zdCBtYXhsZW5fbXNnID0gbWF4bGVuX3BrdCAtIG1heGxlbl9oZHIgLy8gMS42JSBvdmVyaGVhZCByZXNlcnZlZFxuXG5cbmV4cG9ydCBjb25zdCBNdWx0aVBrdEJhc2UgPSBAe31cbiAgX19wcm90b19fOiBudWxsLCBpc19wa3Q6IGZhbHNlLCBpc19tdWx0aV9wa3Q6IHRydWVcbiAgZ2V0IGlkX3JvdXRlKCkgOjogcmV0dXJuIHRoaXMucGt0MC5pZF9yb3V0ZVxuICBnZXQgaWRfdGFyZ2V0KCkgOjogcmV0dXJuIHRoaXMucGt0MC5pZF90YXJnZXRcbiAgZ2V0IG9wKCkgOjogcmV0dXJuIHRoaXMucGt0MC5vcFxuXG4gIGluc3BlY3QoKSA6OiByZXR1cm4gdW5kZWZpbmVkICE9PSB0aGlzLnBrdDBcbiAgICA/IGDCq211bHRpcGt0KCR7dGhpcy5fcGFydHNffSAke3RoaXMucGt0X2tpbmR9KSAke2pzb25fc3RyaW5naWZ5KFt0aGlzLmlkX3JvdXRlLCB0aGlzLmlkX3RhcmdldF0uam9pbignICcpKX3Cu2BcbiAgICA6IGDCq3tNdWx0aVBrdCgke3RoaXMucGt0X2tpbmR9KX3Cu2BcblxuICByZXBhY2tfcGt0KHJlcGFjaykgOjpcbiAgICB0aHJvdyBuZXcgRXJyb3IgQCAnTXVsdGlQa3QgYXJlIG5vdCByZXBhY2thYmxlJ1xuXG4gIGpzb24gLy8gYW5kLi4uIHRleHQoKXt9ICBidWZmZXIoKXt9ICBiYXNlNjQoKXt9XG5cblxuXG5leHBvcnQgZnVuY3Rpb24gc3BsaXRQYXJ0cyhidWYsIGxlbikgOjpcbiAgY29uc3QgcGFydHMgPSBbXVxuICBmb3IgbGV0IGkxPTAsaTA9MDsgaTA8bGVuOyBpMCA9IGkxIDo6XG4gICAgaTEgPSBpMCArIG1heGxlbl9tc2dcbiAgICBwYXJ0cy5wdXNoIEAgYnVmLnNsaWNlKGkwLCBpMSlcbiAgcmV0dXJuIHBhcnRzXG5cblxuZXhwb3J0IGRlZmF1bHQgYmluZF9tdWx0aVBhY2tldFxuZXhwb3J0IGZ1bmN0aW9uIGJpbmRfbXVsdGlQYWNrZXQoe2RlY29kZV91dGY4LCB1bnBhY2tfYmFzZTY0LCBwYWNrQm9keSwgY29uY2F0Qm9keX0pIDo6XG5cbiAgY29uc3QgTXVsdGlQa3RKc29uID0gQHt9IF9fcHJvdG9fXzogTXVsdGlQa3RCYXNlXG4gICAgcGt0X2tpbmQ6ICdqc29uJywgaXNfcGt0X2pzb246IHRydWVcbiAgICB0ZXh0KCkgOjogcmV0dXJuIHRoaXMuX2JvZHlfXG5cbiAgY29uc3QgTXVsdGlQa3REYXRhID0gQHt9IF9fcHJvdG9fXzogTXVsdGlQa3RCYXNlXG4gICAgcGt0X2tpbmQ6ICdkYXRhJywgaXNfcGt0X2RhdGE6IHRydWVcbiAgICB0ZXh0KCkgOjogcmV0dXJuIGRlY29kZV91dGY4IEAgdGhpcy5idWZmZXIoKVxuICAgIGJ1ZmZlcigpIDo6IHJldHVybiB0aGlzLl9ib2R5X1xuXG4gIGNvbnN0IHVucGFja0J5S2luZCA9IEB7fVxuICAgIHNwbGl0X2I2NDogcGt0ID0+IHVucGFja19iYXNlNjQgQCBwa3QuX2JvZHlfXG4gICAgc3BsaXRfZGF0YTogcGt0ID0+IHBrdC5fYm9keV9cbiAgICBzcGxpdF9qc29uOiBwa3QgPT5cbiAgICAgICdzdHJpbmcnID09PSB0eXBlb2YgcGt0Ll9ib2R5XyA/IHBrdC5fYm9keV9cbiAgICAgICAgOiBkZWNvZGVfdXRmOChwa3QuX2JvZHlfKVxuXG4gIHJldHVybiBAe31cbiAgICBzcGxpdEJvZHkoYm9keSwgbWV0YSkgOjpcbiAgICAgIGlmIGlzX2pzb25fYm9keShib2R5KSA6OlxuICAgICAgICBjb25zdCBzcmMgPSBqc29uX3N0cmluZ2lmeShib2R5KXx8JydcbiAgICAgICAgaWYgc3JjLmxlbmd0aCA8PSBtYXhsZW5fbXNnIDo6XG4gICAgICAgICAgcmV0dXJuIFt7W3N5bV9zcGxpdF06IGtfanNvbiwgc3JjfV1cblxuICAgICAgICByZXR1cm4gc3BsaXRQYXJ0cyhzcmMsIHNyYy5sZW5ndGgpXG4gICAgICAgICAgLm1hcCBAIChzcmMsIGlkeCkgPT4gMCA9PT0gaWR4XG4gICAgICAgICAgICA/IEB7fSBbc3ltX3NwbGl0XToga19zcGxpdF9qc29uLCBzcmMsIGlkeCwgbWV0YVxuICAgICAgICAgICAgOiBAe30gW3N5bV9zcGxpdF06IGtfc3BsaXRfanNvbiwgc3JjLCBpZHhcblxuICAgICAgY29uc3QgYnVmID0gcGFja0JvZHkoYm9keSlcbiAgICAgIGlmIGJ1Zi5ieXRlTGVuZ3RoIDw9IG1heGxlbl9tc2cgOjpcbiAgICAgICAgcmV0dXJuIFt7W3N5bV9zcGxpdF06IGtfZGF0YSwgYnVmfV1cblxuICAgICAgcmV0dXJuIHNwbGl0UGFydHMoYnVmLCBidWYuYnl0ZUxlbmd0aClcbiAgICAgICAgLm1hcCBAIChidWYsIGlkeCkgPT4gMCA9PT0gaWR4XG4gICAgICAgICAgPyBAe30gW3N5bV9zcGxpdF06IGtfc3BsaXRfZGF0YSwgYnVmLCBpZHgsIG1ldGFcbiAgICAgICAgICA6IEB7fSBbc3ltX3NwbGl0XToga19zcGxpdF9kYXRhLCBidWYsIGlkeFxuXG5cbiAgICBqb2luUGFja2V0cyhwa3RMaXN0KSA6OlxuICAgICAgY29uc3QgcGt0MD1wa3RMaXN0WzBdLCBwa3Rfa2luZD1wa3QwLnBrdF9raW5kXG4gICAgICBpZiAhIHBrdExpc3QuZXZlcnkocGt0ID0+IHBrdF9raW5kID09PSBwa3QucGt0X2tpbmQpIDo6XG4gICAgICAgIHRocm93IG5ldyBFcnJvciBAIGBNaXNtYXRjaGVkIHBrdF9raW5kYFxuXG4gICAgICBjb25zdCB1bnBhY2tfc3BsaXQ9dW5wYWNrQnlLaW5kW3BrdF9raW5kXVxuICAgICAgaWYgISB1bnBhY2tfc3BsaXQgOjpcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYFVua25vd24gcGt0X2tpbmQ6ICR7cGt0X2tpbmR9YFxuXG4gICAgICBjb25zdCBpc19qc29uID0gJ3NwbGl0X2pzb24nID09PSBwa3Rfa2luZFxuICAgICAgY29uc3QgTXVsdGlQa3QgPSBpc19qc29uID8gTXVsdGlQa3RKc29uIDogTXVsdGlQa3REYXRhXG5cbiAgICAgIGNvbnN0IHBhcnRzID0gcGt0TGlzdC5tYXAodW5wYWNrX3NwbGl0KVxuICAgICAgY29uc3QgX2JvZHlfID0gaXNfanNvbiA/IHBhcnRzLmpvaW4oJycpIDogY29uY2F0Qm9keShwYXJ0cylcblxuICAgICAgcmV0dXJuIG9fY3JlYXRlIEAgTXVsdGlQa3QsIEB7fVxuICAgICAgICBwa3QwOiBAe30gdmFsdWU6IHBrdDBcbiAgICAgICAgX3BhcnRzXzogQHt9IHZhbHVlOiBwYXJ0cy5sZW5ndGhcbiAgICAgICAgX21ldGFfOiBAe30gdmFsdWU6IHBrdDAuX21ldGFfXG4gICAgICAgIF9ib2R5XzogQHt9IHZhbHVlOiBfYm9keV9cblxuIiwiaW1wb3J0IHsgYmluZF9tdWx0aVBhY2tldCB9IGZyb20gJy4uL2NvbW1vbl9tdWx0aS5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uKHsgZGVjb2RlX3V0ZjgsIHVucGFja19iYXNlNjQsIGFzX2RhdGEsIGNvbmNhdF9kYXRhIH0pIDo6XG4gIHJldHVybiBiaW5kX211bHRpUGFja2V0IEA6IGRlY29kZV91dGY4LCB1bnBhY2tfYmFzZTY0LCBwYWNrQm9keTogYXNfZGF0YSwgY29uY2F0Qm9keTogY29uY2F0X2RhdGFcblxuIiwiaW1wb3J0IHBrdF9jYWxsX2JpbmFyeSBmcm9tICcuL2ltcGwvYnJvd3Nlci9jYWxsX2JpbmFyeS5qc3knXG5pbXBvcnQgcGt0X211bHRpIGZyb20gJy4vaW1wbC9icm93c2VyL211bHRpLmpzeSdcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gYnJvd3Nlcl9wa3RfcGx1Z2luKCkgOjpcbiAgcmV0dXJuIEA6IG9yZGVyOiAtMSwgc3ViY2xhc3MoRmFicmljSHViKSA6OlxuICAgIGNvbnN0IGRhdGFfdXRpbHMgPSBGYWJyaWNIdWIucHJvdG90eXBlLmRhdGFfdXRpbHNcblxuICAgIGNvbnN0IGJpbl9jYWxsID0gcGt0X2NhbGxfYmluYXJ5KGRhdGFfdXRpbHMpXG4gICAgY29uc3QgX3BrdHNfID0gT2JqZWN0LmFzc2lnbiBAIHt9XG4gICAgICBAe30gYmluX2NhbGxcbiAgICAgIGJpbl9jYWxsXG4gICAgICBwa3RfbXVsdGkoZGF0YV91dGlscylcblxuICAgIGNvbnN0IF9mcm9tT2JqUGFja2V0ID1cbiAgICAgIF9wa3RzXy5mcm9tT2JqUGFja2V0ID1cbiAgICAgICAgX3BrdHNfLmZyb21PYmpCaW5hcnlQYWNrZXRcblxuICAgIE9iamVjdC5hc3NpZ24gQCBGYWJyaWNIdWIucHJvdG90eXBlLCBAe31cbiAgICAgIF9wa3RzXywgX2Zyb21PYmpQYWNrZXRcblxuIiwiZXhwb3J0IGZ1bmN0aW9uIGRlZmVycmVkKCkgOjpcbiAgY29uc3QgZSA9IHt9XG4gIGUucHJvbWlzZSA9IG5ldyBQcm9taXNlIEAgKHJlc29sdmUsIHJlamVjdCkgPT4gOjpcbiAgICBlLnJlc29sdmUgPSByZXNvbHZlOyBlLnJlamVjdCA9IHJlamVjdFxuICByZXR1cm4gZVxuXG5leHBvcnQgZnVuY3Rpb24gdGltZW91dFJlYXBlcih0aW1lb3V0PTUwMDApIDo6XG4gIGxldCBxPVtdLCByZWFwPVtdXG4gIGNvbnN0IGNpZCA9IHNldEludGVydmFsIEAgdGljaywgTWF0aC5tYXgoMTAwMCwgdGltZW91dClcbiAgaWYgY2lkLnVucmVmIDo6IGNpZC51bnJlZigpXG4gIHJldHVybiBleHBpcmVcblxuICBmdW5jdGlvbiBleHBpcmUoZm4pIDo6XG4gICAgcS5wdXNoKGZuKVxuXG4gIGZ1bmN0aW9uIHRpY2soKSA6OlxuICAgIGlmIDAgIT09IHJlYXAubGVuZ3RoIDo6XG4gICAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoJ1RpbWVvdXQnKVxuICAgICAgY29uc29sZS5sb2cgQCAnRVhQSVJFJywgcmVhcFxuICAgICAgZm9yIGNvbnN0IGZuIG9mIHJlYXAgOjogZm4oZXJyKVxuICAgIHJlYXAgPSBxOyBxID0gW11cblxuIiwiaW1wb3J0IHtkZWZlcnJlZCwgdGltZW91dFJlYXBlcn0gZnJvbSAnLi91dGlsLmpzeSdcblxuZXhwb3J0IGNvbnN0IHN5bV9zYW1waSA9ICdcXHUwM0UwJyAvLyAnz6AnXG5cbmNvbnN0IG9fY3JlYXRlID0gT2JqZWN0LmNyZWF0ZSwgb19hc3NpZ24gPSBPYmplY3QuYXNzaWduXG5cbmV4cG9ydCBmdW5jdGlvbiBhc19zb3VyY2VfaWQoaWQpIDo6XG4gIHJldHVybiAnc3RyaW5nJyA9PT0gdHlwZW9mIGlkID8gaWQuc3BsaXQoJyAnLCAyKVxuICAgIDogJ3N0cmluZycgPT09IHR5cGVvZiBpZFtzeW1fc2FtcGldID8gaWRbc3ltX3NhbXBpXS5zcGxpdCgnICcsIDIpXG4gICAgOiBAW10gaWQuaWRfcm91dGUsIGlkLmlkX3RhcmdldFxuXG5leHBvcnQgZnVuY3Rpb24gYXNfcmVwbHlfaWQoaWQpIDo6XG4gIHJldHVybiAnc3RyaW5nJyA9PT0gdHlwZW9mIGlkID8gaWQuc3BsaXQoJyAnLCAyKVxuICAgIDogJ3N0cmluZycgPT09IHR5cGVvZiBpZFtzeW1fc2FtcGldID8gaWRbc3ltX3NhbXBpXS5zcGxpdCgnICcsIDIpXG4gICAgOiBAW10gaWQuZnJvbV9yb3V0ZSwgaWQuZnJvbV90YXJnZXRcblxuXG5cbmV4cG9ydCBmdW5jdGlvbiBiaW5kX214X2FwaShzb3VyY2VfYXBpLCByZXBseV9hcGkpIDo6XG4gIHJldHVybiAocGt0X29wLCBfbXhfKSA9PiA6OlxuICAgIGNvbnN0IHByb3BzID0gQHt9XG4gICAgICBfbXhfOiB7dmFsdWU6IF9teF99XG4gICAgICBbc3ltX3NhbXBpXTogQHt9IGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgIHZhbHVlOiBgJHtfbXhfLmlkX3JvdXRlfSAke19teF8uaWRfdGFyZ2V0fWBcblxuICAgIGlmIG51bGwgIT0gcGt0X29wICYmIHBrdF9vcC50b2tlbiA6OlxuICAgICAgX214Xy5vcG8wLm1zZ2lkID0gcGt0X29wLnRva2VuXG4gICAgICByZXR1cm4gb19jcmVhdGUgQCByZXBseV9hcGksIHByb3BzXG4gICAgcmV0dXJuIG9fY3JlYXRlIEAgc291cmNlX2FwaSwgcHJvcHNcblxuXG5leHBvcnQgZGVmYXVsdCBtc2dfYmFzZV9hcGlcbmV4cG9ydCBmdW5jdGlvbiBtc2dfYmFzZV9hcGkoaHViLCBvcHRpb25zKSA6OlxuICBjb25zdCB7c3BsaXRCb2R5LCBqb2luUGFja2V0c30gPSBodWIuX3BrdHNfXG4gIGNvbnN0IHJhbmRvbSA9IGh1Yi5kYXRhX3V0aWxzLnJhbmRvbVxuXG4gIGNvbnN0IGNoYW4gPSBvcHRpb25zLmNoYW5uZWwgfHwgaHViLmNoYW5uZWxcbiAgY29uc3QgdG9rZW5MZW4gPSBNYXRoLm1heCBAIDEsIG9wdGlvbnMudG9rZW5MZW4gfHwgMyB8IDBcbiAgY29uc3QgZXhwaXJlID0gdGltZW91dFJlYXBlciBAIG9wdGlvbnMudGltZW91dCB8fCA1MDAwXG4gIGNvbnN0IG5ld1Rva2VuID0gKCkgPT4gcmFuZG9tKHRva2VuTGVuLCB0cnVlKVxuXG4gIGNvbnN0IG1zZ19hcGkwID0gYmluZF9tc2dfYXBpMChjaGFuKVxuXG4gIHJldHVybiBAe31cbiAgICBuZXdUb2tlbiwgZXhwaXJlLCBtc2dfYXBpMFxuICAgIGJpbmRfbXNnX2FwaVxuICAgIGJpbmRfc2VuZG1zZ1xuICAgIGJpbmRfcmVwbHltc2dcblxuICAgIGNyZWF0ZUNvbnRleHQoKSA6OlxuICAgICAgbGV0IGRiID0gbmV3IE1hcCgpXG4gICAgICByZXR1cm4gQHt9IG5ld1Rva2VuXG4gICAgICAgIGRlZmVycmVkRm9yKHRva2VuKSA6OlxuICAgICAgICAgIGlmICEgdG9rZW4gOjogcmV0dXJuXG4gICAgICAgICAgbGV0IGQgPSBkYi5nZXQodG9rZW4pXG4gICAgICAgICAgaWYgdW5kZWZpbmVkICE9PSBkIDo6IHJldHVybiBkXG4gICAgICAgICAgZCA9IGRlZmVycmVkKClcbiAgICAgICAgICBkYi5zZXQodG9rZW4sIGQpXG5cbiAgICAgICAgICBleHBpcmUoZC5yZWplY3QpXG4gICAgICAgICAgY29uc3QgcmVtb3ZlID0gQD0+IGRiLmRlbGV0ZSh0b2tlbilcbiAgICAgICAgICBkLnByb21pc2UudGhlbiBAIHJlbW92ZSwgcmVtb3ZlXG4gICAgICAgICAgcmV0dXJuIGRcblxuICAgICAgICByZXNwb25zZUZvcih0b2tlbikgOjpcbiAgICAgICAgICByZXR1cm4gdGhpcy5kZWZlcnJlZEZvcih0b2tlbikucHJvbWlzZVxuXG4gICAgICAgIG9uX3Jlc29sdmUobXNnaWQsIGFucykgOjpcbiAgICAgICAgICBpZiAhIG1zZ2lkIDo6IHJldHVybiBhbnNcbiAgICAgICAgICBjb25zdCBkID0gZGIuZ2V0KG1zZ2lkKVxuICAgICAgICAgIGlmIHVuZGVmaW5lZCA9PT0gZCA6OiByZXR1cm4gYW5zXG4gICAgICAgICAgZGIuZGVsZXRlKG1zZ2lkKVxuICAgICAgICAgIGQucmVzb2x2ZShhbnMpXG4gICAgICAgICAgcmV0dXJuIG51bGxcblxuICAgICAgICBvbl9zcGxpdF9wa3QocGt0LCBvcCkgOjpcbiAgICAgICAgICBjb25zdCBrZXkgPSAnfiAnICsgKG9wLnRva2VuIHx8IG9wLm1zZ2lkKVxuICAgICAgICAgIGxldCBkID0gZGIuZ2V0KGtleSlcbiAgICAgICAgICBpZiB1bmRlZmluZWQgPT09IGQgOjpcbiAgICAgICAgICAgIGQgPSB0aGlzLmRlZmVycmVkRm9yKGtleSlcbiAgICAgICAgICAgIGQuZmVlZCA9IHRoaXMub25fbmV3X3NwbGl0KGtleSwgZClcbiAgICAgICAgICBlbHNlIGlmIHVuZGVmaW5lZCA9PT0gZC5mZWVkIDo6XG4gICAgICAgICAgICBkLmZlZWQgPSB0aGlzLm9uX25ld19zcGxpdChrZXksIGQpXG5cbiAgICAgICAgICBwa3QuY29tcGxldGUgPSBkLnByb21pc2VcbiAgICAgICAgICByZXR1cm4gZC5mZWVkKHBrdCwgb3ApXG5cbiAgICAgICAgb25fbmV3X3NwbGl0KGtleSwgZCkgOjpcbiAgICAgICAgICBsZXQgZmluLCBwYXJ0cz1bXVxuICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAocGt0LCBvcCkgOjpcbiAgICAgICAgICAgIGNvbnN0IHtzZXF9ID0gb3BcbiAgICAgICAgICAgIGlmIHNlcSA+PSAwIDo6XG4gICAgICAgICAgICAgIHBhcnRzW3NlcV0gPSBwa3RcbiAgICAgICAgICAgICAgaWYgISBmaW4gOjogcmV0dXJuIG51bGxcbiAgICAgICAgICAgIGVsc2UgOjpcbiAgICAgICAgICAgICAgcGFydHNbLXNlcV0gPSBwa3RcbiAgICAgICAgICAgICAgZmluID0gdHJ1ZVxuXG4gICAgICAgICAgICBpZiAhIHBhcnRzLmluY2x1ZGVzKHVuZGVmaW5lZCkgOjpcbiAgICAgICAgICAgICAgLy8gYWxsIHBhcnRzIGFjY291bnRlZCBmb3JcbiAgICAgICAgICAgICAgY29uc3QgbXVsdGkgPSBqb2luUGFja2V0cyhwYXJ0cylcbiAgICAgICAgICAgICAgcGFydHMgPSBudWxsXG4gICAgICAgICAgICAgIGQucmVzb2x2ZShtdWx0aSlcbiAgICAgICAgICAgICAgZGIuZGVsZXRlKGtleSlcbiAgICAgICAgICAgICAgcmV0dXJuIG11bHRpXG4gICAgICAgICAgICByZXR1cm4gbnVsbFxuXG5cbiAgZnVuY3Rpb24gYmluZF9zZW5kbXNnKGt3KSA6OlxuICAgIGNvbnN0IGFwaSA9IGJpbmRfbXNnX2FwaShrdylcbiAgICBhcGkuc2VuZCA9IGFwaS5wb3N0XG4gICAgcmV0dXJuIGFwaVxuXG4gIGZ1bmN0aW9uIGJpbmRfcmVwbHltc2coa3cpIDo6XG4gICAgY29uc3QgYXBpID0gYmluZF9tc2dfYXBpKGt3KVxuICAgIGFwaS5zZW5kID0gYXBpLmFuc3dlclxuICAgIGFwaS5yZXBseUV4cGVjdGVkID0gdHJ1ZVxuICAgIHJldHVybiBhcGlcblxuICBmdW5jdGlvbiBiaW5kX21zZ19hcGkoe2Fub24sIG9wX2FwaX0pIDo6XG4gICAgcmV0dXJuIEB7fSBfX3Byb3RvX186IG1zZ19hcGkwLCBhbm9uXG4gICAgICBhbnN3ZXI6IF9tcF93aXRoX3Jlc3BvbnNlXG4gICAgICBxdWVyeTogX21wX3dpdGhfcmVzcG9uc2VcbiAgICAgIHBvc3Q6IF9tcF9wb3N0XG5cbiAgICAgIGRnX3Bvc3Q6IF9kZ19wb3N0XG4gICAgICBkZ19xdWVyeTogX2RnX3Jlc3BvbnNlXG4gICAgICBkZ19hbnN3ZXI6IF9kZ19yZXNwb25zZVxuXG4gICAgICBzdHJlYW0oZXh0cmEpIDo6XG4gICAgICAgIGNvbnN0IHtyZXNwb25zZSwgb3BvfSA9IHRoaXMuX25ld19yZXNwb25zZSgpXG4gICAgICAgIHJldHVybiBfd3N0cmVhbSh0aGlzLCBvcG8sIG9wX2FwaS5zdHJlYW0sIGV4dHJhLCByZXNwb25zZSlcblxuICAgICAgbXVsdGlwYXJ0KGV4dHJhKSA6OlxuICAgICAgICBjb25zdCB7cmVzcG9uc2UsIG9wb30gPSB0aGlzLl9uZXdfcmVzcG9uc2UoKVxuICAgICAgICByZXR1cm4gX3dzdHJlYW0odGhpcywgb3BvLCBvcF9hcGkubXVsdGlwYXJ0LCBleHRyYSwgcmVzcG9uc2UpXG5cbiAgICAgIGN0cmwoYm9keSwgZXh0cmEpIDo6XG4gICAgICAgIGNvbnN0IG1ldGEgPSB1bmRlZmluZWQgIT09IGV4dHJhICYmIG51bGwgIT09IGV4dHJhXG4gICAgICAgICAgPyBleHRyYS5tZXRhIDogdW5kZWZpbmVkXG5cbiAgICAgICAgY29uc3Qge3Jlc3BvbnNlLCBvcG99ID0gdGhpcy5fbmV3X3Jlc3BvbnNlKClcbiAgICAgICAgY29uc3Qge2lkX3JvdXRlLCBpZF90YXJnZXR9ID0gdGhpcy5fbXhfXG4gICAgICAgIGNvbnN0IG9iaiA9IEB7fSBpZF9yb3V0ZSwgaWRfdGFyZ2V0LCBib2R5LCBtZXRhXG4gICAgICAgIGNvbnN0IHBrdCA9IG9wX2FwaS5jdHJsIEAgb2JqLCBvcG9cbiAgICAgICAgdGhpcy5fc2VuZF9wa3QocGt0KVxuICAgICAgICByZXR1cm4gcmVzcG9uc2VcblxuXG4gICAgZnVuY3Rpb24gX21wX3Bvc3QoYm9keSwgZXh0cmEpIDo6XG4gICAgICBjb25zdCBtZXRhID0gdW5kZWZpbmVkICE9PSBleHRyYSAmJiBudWxsICE9PSBleHRyYVxuICAgICAgICA/IGV4dHJhLm1ldGEgOiB1bmRlZmluZWRcblxuICAgICAgY29uc3QgcGFydHMgPSBzcGxpdEJvZHkoYm9keSwgbWV0YSlcbiAgICAgIGlmIDEgPCBwYXJ0cy5sZW5ndGggOjpcbiAgICAgICAgY29uc3Qge29wb30gPSB0aGlzLl9uZXdfdG9rZW4oKVxuICAgICAgICByZXR1cm4gX21zZW5kKHRoaXMsIHBhcnRzLCBvcG8pXG5cbiAgICAgIGNvbnN0IHtpZF9yb3V0ZSwgaWRfdGFyZ2V0LCBvcG8wfSA9IHRoaXMuX214X1xuICAgICAgY29uc3Qgb2JqID0gQHt9IGlkX3JvdXRlLCBpZF90YXJnZXQsIGJvZHk6IHBhcnRzWzBdLCBtZXRhXG4gICAgICBjb25zdCBwa3QgPSBvcF9hcGkuZGF0YWdyYW0gQCBvYmosIG9wbzBcbiAgICAgIHRoaXMuX3NlbmRfcGt0KHBrdClcblxuICAgIGZ1bmN0aW9uIF9tcF93aXRoX3Jlc3BvbnNlKGJvZHksIGV4dHJhKSA6OlxuICAgICAgY29uc3QgbWV0YSA9IHVuZGVmaW5lZCAhPT0gZXh0cmEgJiYgbnVsbCAhPT0gZXh0cmFcbiAgICAgICAgPyBleHRyYS5tZXRhIDogdW5kZWZpbmVkXG4gICAgICBjb25zdCB7cmVzcG9uc2UsIG9wb30gPSB0aGlzLl9uZXdfcmVzcG9uc2UoKVxuXG4gICAgICBjb25zdCBwYXJ0cyA9IHNwbGl0Qm9keShib2R5LCBtZXRhKVxuICAgICAgaWYgMSA8IHBhcnRzLmxlbmd0aCA6OlxuICAgICAgICByZXR1cm4gX21zZW5kKHRoaXMsIHBhcnRzLCBvcG8sIHJlc3BvbnNlKVxuXG4gICAgICBjb25zdCB7aWRfcm91dGUsIGlkX3RhcmdldH0gPSB0aGlzLl9teF9cbiAgICAgIGNvbnN0IG9iaiA9IEB7fSBpZF9yb3V0ZSwgaWRfdGFyZ2V0LCBib2R5OiBwYXJ0c1swXSwgbWV0YVxuICAgICAgY29uc3QgcGt0ID0gb3BfYXBpLmRpcmVjdCBAIG9iaiwgb3BvXG4gICAgICB0aGlzLl9zZW5kX3BrdChwa3QpXG4gICAgICByZXR1cm4gcmVzcG9uc2VcblxuICAgIGZ1bmN0aW9uIF9kZ19wb3N0KGJvZHksIGV4dHJhKSA6OlxuICAgICAgY29uc3QgbWV0YSA9IHVuZGVmaW5lZCAhPT0gZXh0cmEgJiYgbnVsbCAhPT0gZXh0cmFcbiAgICAgICAgPyBleHRyYS5tZXRhIDogdW5kZWZpbmVkXG4gICAgICBjb25zdCB7aWRfcm91dGUsIGlkX3RhcmdldCwgb3BvMH0gPSB0aGlzLl9teF9cbiAgICAgIGNvbnN0IG9iaiA9IEB7fSBpZF9yb3V0ZSwgaWRfdGFyZ2V0LCBib2R5LCBtZXRhXG4gICAgICBjb25zdCBwa3QgPSBvcF9hcGkuZGF0YWdyYW0gQCBvYmosIG9wbzBcbiAgICAgIHRoaXMuX3NlbmRfcGt0KHBrdClcblxuICAgIGZ1bmN0aW9uIF9kZ19yZXNwb25zZShib2R5LCBleHRyYSkgOjpcbiAgICAgIGNvbnN0IG1ldGEgPSB1bmRlZmluZWQgIT09IGV4dHJhICYmIG51bGwgIT09IGV4dHJhXG4gICAgICAgID8gZXh0cmEubWV0YSA6IHVuZGVmaW5lZFxuICAgICAgY29uc3Qge3Jlc3BvbnNlLCBvcG99ID0gdGhpcy5fbmV3X3Jlc3BvbnNlKClcbiAgICAgIGNvbnN0IHtpZF9yb3V0ZSwgaWRfdGFyZ2V0fSA9IHRoaXMuX214X1xuICAgICAgY29uc3Qgb2JqID0gQHt9IGlkX3JvdXRlLCBpZF90YXJnZXQsIGJvZHksIG1ldGFcbiAgICAgIGNvbnN0IHBrdCA9IG9wX2FwaS5kaXJlY3QgQCBvYmosIG9wb1xuICAgICAgdGhpcy5fc2VuZF9wa3QocGt0KVxuICAgICAgcmV0dXJuIHJlc3BvbnNlXG5cbiAgICBmdW5jdGlvbiBfbXNlbmQobXNnYXBpLCBwYXJ0cywgb3BvLCByZXNwb25zZSkgOjpcbiAgICAgIF93c3RyZWFtKG1zZ2FwaSwgb3BvLCBvcF9hcGkubXVsdGlwYXJ0LCB1bmRlZmluZWQsIHJlc3BvbnNlKVxuICAgICAgICAud3JpdGVBbGwocGFydHMsIHRydWUpXG4gICAgICByZXR1cm4gcmVzcG9uc2VcblxuICAgIGZ1bmN0aW9uIF93c3RyZWFtKG1zZ2FwaSwgb3BvLCBvcF9tZXRob2QsIGV4dHJhLCByZXNwb25zZSkgOjpcbiAgICAgIGNvbnN0IG1ldGEgPSB1bmRlZmluZWQgIT09IGV4dHJhICYmIG51bGwgIT09IGV4dHJhXG4gICAgICAgID8gZXh0cmEubWV0YSA6IHVuZGVmaW5lZFxuXG4gICAgICBjb25zdCB7aWRfcm91dGUsIGlkX3RhcmdldH0gPSBtc2dhcGkuX214X1xuICAgICAgbGV0IHNlcT0wLCBzZWxmXG4gICAgICByZXR1cm4gc2VsZiA9IEB7fSByZXNwb25zZVxuICAgICAgICB3cml0ZU1ldGE6IChib2R5LCBtZXRhKSA9PiA6OlxuICAgICAgICAgIGNvbnN0IG9iaiA9IEB7fSBpZF9yb3V0ZSwgaWRfdGFyZ2V0LCBib2R5LCBtZXRhXG5cbiAgICAgICAgICBjb25zdCBwa3QgPSBvcF9tZXRob2QgQCBvYmosXG4gICAgICAgICAgICBvX2Fzc2lnbih7c2VxOiBzZXErK30sIG9wbylcbiAgICAgICAgICBtc2dhcGkuX3NlbmRfcGt0KHBrdClcblxuICAgICAgICB3cml0ZTogYm9keSA9PiA6OlxuICAgICAgICAgIGNvbnN0IG9iaiA9IEB7fSBpZF9yb3V0ZSwgaWRfdGFyZ2V0LCBib2R5XG5cbiAgICAgICAgICBpZiB1bmRlZmluZWQgIT09IG1ldGEgJiYgbnVsbCAhPT0gbWV0YSA6OlxuICAgICAgICAgICAgb2JqLm1ldGEgPSBtZXRhXG4gICAgICAgICAgICBtZXRhID0gdW5kZWZpbmVkXG5cbiAgICAgICAgICBjb25zdCBwa3QgPSBvcF9tZXRob2QgQCBvYmosXG4gICAgICAgICAgICBvX2Fzc2lnbih7c2VxOiBzZXErK30sIG9wbylcbiAgICAgICAgICBtc2dhcGkuX3NlbmRfcGt0KHBrdClcblxuICAgICAgICB3cml0ZUFsbDogKGJvZHksIGNsb3NlKSA9PiA6OlxuICAgICAgICAgIGxldCBjdXIsIG5leHRcbiAgICAgICAgICBmb3IgbmV4dCBvZiBib2R5IDo6XG4gICAgICAgICAgICBpZiB1bmRlZmluZWQgIT09IGN1ciA6OlxuICAgICAgICAgICAgICBzZWxmLndyaXRlKGN1cilcbiAgICAgICAgICAgIGN1ciA9IG5leHRcblxuICAgICAgICAgIGlmIHVuZGVmaW5lZCAhPT0gY3VyIDo6XG4gICAgICAgICAgICByZXR1cm4gY2xvc2VcbiAgICAgICAgICAgICAgPyBzZWxmLmVuZChjdXIpXG4gICAgICAgICAgICAgIDogc2VsZi53cml0ZShjdXIpXG5cbiAgICAgICAgZW5kOiBib2R5ID0+IDo6XG4gICAgICAgICAgc2VxID0gLXNlcVxuICAgICAgICAgIHNlbGYud3JpdGUoYm9keSlcbiAgICAgICAgICBzZXEgPSBudWxsXG5cblxuICBmdW5jdGlvbiBiaW5kX21zZ19hcGkwKGNoYW4pIDo6XG4gICAgcmV0dXJuIEB7fSBfX3Byb3RvX186IG51bGxcbiAgICAgIGluc3BlY3QoKSA6OiByZXR1cm4gYMKrJHtzeW1fc2FtcGl9ICR7dGhpc1tzeW1fc2FtcGldfcK7YFxuICAgICAgdG9KU09OKG9iaj17fSkgOjogb2JqW3N5bV9zYW1waV0gPSB0aGlzW3N5bV9zYW1waV07IHJldHVybiBvYmpcblxuICAgICAgX3NlbmRfcGt0OiBjaGFuLnNlbmQuYmluZChjaGFuKVxuXG4gICAgICBfbmV3X3Rva2VuKCkgOjpcbiAgICAgICAgY29uc3Qge2N0eCwgb3BvMH0gPSB0aGlzLl9teF9cbiAgICAgICAgY29uc3QgdG9rZW4gPSBjdHgubmV3VG9rZW4oKVxuICAgICAgICByZXR1cm4gQHt9IHRva2VuLFxuICAgICAgICAgIG9wbzogb19hc3NpZ24gQCB7dG9rZW59LCBvcG8wXG5cbiAgICAgIF9uZXdfcmVzcG9uc2UoKSA6OlxuICAgICAgICBjb25zdCB7Y3R4LCBvcG8wfSA9IHRoaXMuX214X1xuICAgICAgICBpZiBvcG8wLm1zZ2lkIDo6IHJldHVybiBAe30gb3BvOiBvcG8wXG5cbiAgICAgICAgY29uc3QgdG9rZW4gPSBjdHgubmV3VG9rZW4oKVxuICAgICAgICByZXR1cm4gQHt9IHRva2VuLFxuICAgICAgICAgIG9wbzogb19hc3NpZ24gQCB7dG9rZW59LCBvcG8wXG4gICAgICAgICAgcmVzcG9uc2U6IGN0eC5yZXNwb25zZUZvcih0b2tlbilcblxuIiwiY29uc3QgX2IxNl91bnBhY2sgPSB2ID0+IHBhcnNlSW50KHYsIDE2KXwwXG5jb25zdCBfYjE2X3BhY2sgPSB2ID0+ICh2fDApLnRvU3RyaW5nKDE2KVxuY29uc3QgX2lzX2RlZmluZWQgPSAoYXR0ciwgdikgPT4gOjpcbiAgaWYgdW5kZWZpbmVkID09PSB2IDo6IHRocm93IG5ldyBFcnJvcihhdHRyKVxuICByZXR1cm4gdlxuXG5jb25zdCBmcm0gPSBAe31cbiAgX2IxNl9wYWNrLCBfYjE2X3VucGFjaywgX2lzX2RlZmluZWRcblxuICBtc2dpZDogQHt9IGF0dHI6ICdtc2dpZCdcbiAgICB1bnBhY2s6ICh2LCBoZHIpID0+IDo6IGhkci5tc2dpZCA9IHZcbiAgICBwYWNrOiBoZHIgPT4gX2lzX2RlZmluZWQgQCAnbXNnaWQnLCBoZHIubXNnaWRcblxuICB0b2tlbjogQHt9IGF0dHI6ICd0b2tlbidcbiAgICB1bnBhY2s6ICh2LCBoZHIpID0+IDo6IGhkci50b2tlbiA9IHZcbiAgICBwYWNrOiBoZHIgPT4gX2lzX2RlZmluZWQgQCAndG9rZW4nLCBoZHIudG9rZW5cblxuICBmcm9tX3JvdXRlOiBAe30gYXR0cjogJ2Zyb21fcm91dGUnXG4gICAgdW5wYWNrOiAodiwgaGRyKSA9PiA6OiBoZHIuZnJvbT10cnVlOyBoZHIuZnJvbV9yb3V0ZSA9IHZcbiAgICBwYWNrOiBoZHIgPT4gX2lzX2RlZmluZWQgQCAnZnJvbV9yb3V0ZScsIGhkci5mcm9tX3JvdXRlXG5cbiAgZnJvbV90YXJnZXQ6IEB7fSBhdHRyOiAnZnJvbV90YXJnZXQnXG4gICAgdW5wYWNrOiAodiwgaGRyKSA9PiA6OiBoZHIuZnJvbV90YXJnZXQgPSB2XG4gICAgcGFjazogaGRyID0+IF9pc19kZWZpbmVkIEAgJ2Zyb21fdGFyZ2V0JywgaGRyLmZyb21fdGFyZ2V0XG5cbiAgc2VxOiBAe30gYXR0cjogJ3NlcSdcbiAgICB1bnBhY2s6ICh2LCBoZHIpID0+IDo6IGhkci5zZXEgPSBfYjE2X3VucGFjayBAIHZcbiAgICBwYWNrOiBoZHIgPT4gX2IxNl9wYWNrIEAgX2lzX2RlZmluZWQgQCAnc2VxJywgaGRyLnNlcVxuXG5cblxuZnVuY3Rpb24gYXNfb3BfZnJhbWUob3BfZnJhbWUpIDo6XG4gIGxldCB7a2luZCwgYWN0aW9uLCBmcmFtZXMsIHBhY2ssIHVucGFja30gPSBvcF9mcmFtZVxuXG4gIGlmIG51bGwgPT0gZnJhbWVzIDo6IGZyYW1lcyA9IFtdXG4gIGZyYW1lcy51bnNoaWZ0IEA6IGF0dHI6ICdhY3Rpb24nXG4gICAgdW5wYWNrOiAodiwgaGRyKSA9PiA6OiBoZHIua2luZCA9IGtpbmRcbiAgICBwYWNrOiBoZHIgPT4gYWN0aW9uXG5cbiAgaWYgbnVsbCA9PSBwYWNrIDo6XG4gICAgY29uc3QgZl9wYWNrID0gZnJhbWVzXG4gICAgICAubWFwIEAgZiA9PiBmLnBhY2sgPyBmLnBhY2suYmluZChmKSA6IG51bGxcbiAgICAgIC5maWx0ZXIgQCBlID0+IG51bGwgIT09IGVcbiAgICBjb25zdCBiaW5kID0gX2FzX3BhY2tfZm5bZl9wYWNrLmxlbmd0aF0gfHwgX2FzX3BhY2tOX2ZuXG4gICAgcGFjayA9IGJpbmQoLi4uZl9wYWNrKVxuXG4gIGlmIG51bGwgPT0gdW5wYWNrIDo6XG4gICAgY29uc3QgZl91bnBhY2sgPSBmcmFtZXNcbiAgICAgIC5tYXAgQCBmID0+IGYudW5wYWNrID8gZi51bnBhY2suYmluZChmKSA6IG51bGxcbiAgICAgIC5maWx0ZXIgQCBlID0+IG51bGwgIT09IGVcblxuICAgIGNvbnN0IGJpbmQgPSBfYXNfdW5wYWNrX2ZuW2ZfdW5wYWNrLmxlbmd0aF0gfHwgX2FzX3VucGFja05fZm5cbiAgICB1bnBhY2sgPSBiaW5kKC4uLmZfdW5wYWNrKVxuXG4gIHJldHVybiBPYmplY3QuYXNzaWduIEAgb3BfZnJhbWUsIEB7fVxuICAgIGF0dHJzOiBmcmFtZXMubWFwIEAgZiA9PiBmLmF0dHJcbiAgICBmcmFtZXMsIHBhY2ssIHVucGFja1xuXG5cbi8vIHVucm9sbCBsb29waW5nIG92ZXIgdGhlIGZ1bmN0aW9uc1xuY29uc3QgX2FzX3BhY2tfZm4gPSBAW11cbiAgKCkgPT4gaGRyID0+IEAjXG4gIChmMCkgPT4gaGRyID0+IEAjIGYwKGhkcilcbiAgKGYwLCBmMSkgPT4gaGRyID0+IEAjIGYwKGhkciksIGYxKGhkcilcbiAgKGYwLCBmMSwgZjIpID0+IGhkciA9PiBAIyBmMChoZHIpLCBmMShoZHIpLCBmMihoZHIpXG4gIChmMCwgZjEsIGYyLCBmMykgPT4gaGRyID0+IEAjIGYwKGhkciksIGYxKGhkciksIGYyKGhkciksIGYzKGhkcilcbiAgKGYwLCBmMSwgZjIsIGYzLCBmNCkgPT4gaGRyID0+IEAjIGYwKGhkciksIGYxKGhkciksIGYyKGhkciksIGYzKGhkciksIGY0KGhkcilcblxuY29uc3QgX2FzX3BhY2tOX2ZuID0gKC4uLmZucykgPT5cbiAgaGRyID0+IGZucy5tYXAgQCBmID0+IGYoaGRyKVxuXG4vLyB1bnJvbGwgbG9vcGluZyBvdmVyIHRoZSBmdW5jdGlvbnNcbmNvbnN0IF9hc191bnBhY2tfZm4gPSBAW11cbiAgKCkgPT4gKGhkciwgb3ApID0+IEAgb3BcbiAgKGYwKSA9PiAoaGRyLCBvcCkgPT4gQCBmMChoZHJbMl0sIG9wKSwgb3BcbiAgKGYwLCBmMSkgPT4gKGhkciwgb3ApID0+IEAgZjAoaGRyWzJdLCBvcCksIGYxKGhkclszXSwgb3ApLCBvcFxuICAoZjAsIGYxLCBmMikgPT4gKGhkciwgb3ApID0+IEAgZjAoaGRyWzJdLCBvcCksIGYxKGhkclszXSwgb3ApLCBmMihoZHJbNF0sIG9wKSwgb3BcbiAgKGYwLCBmMSwgZjIsIGYzKSA9PiAoaGRyLCBvcCkgPT4gQCBmMChoZHJbMl0sIG9wKSwgZjEoaGRyWzNdLCBvcCksIGYyKGhkcls0XSwgb3ApLCBmMyhoZHJbNV0sIG9wKSwgb3BcbiAgKGYwLCBmMSwgZjIsIGYzLCBmNCkgPT4gKGhkciwgb3ApID0+IEAgZjAoaGRyWzJdLCBvcCksIGYxKGhkclszXSwgb3ApLCBmMihoZHJbNF0sIG9wKSwgZjMoaGRyWzVdLCBvcCksIGY0KGhkcls2XSwgb3ApLCBvcFxuXG5jb25zdCBfYXNfdW5wYWNrTl9mbiA9ICguLi5mbnMpID0+XG4gIChoZHIsIG9wKSA9PiA6OlxuICAgIGxldCBpPTJcbiAgICBmb3IgY29uc3QgZiBvZiBmbnMgOjogZihoZHJbaSsrXSwgb3ApXG4gICAgcmV0dXJuIG9wXG5cblxuZXhwb3J0IGZ1bmN0aW9uIHN0YW5kYXJkX2ZyYW1lcygpIDo6XG4gIHJldHVybiBAW11cbiAgICAvLyBjb250cm9sIGRhdGFncmFtOlxuICAgIGFzX29wX2ZyYW1lIEA6IGtpbmQ6ICdjdHJsJywgYWN0aW9uOiAnPycsIGZyYW1lczogQCMgZnJtLnRva2VuXG4gICAgYXNfb3BfZnJhbWUgQDoga2luZDogJ2N0cmwnLCBhY3Rpb246ICchJywgZnJhbWVzOiBAIyBmcm0ubXNnaWRcblxuICAgIC8vIGRhdGFncmFtOlxuICAgIGFzX29wX2ZyYW1lIEA6IGtpbmQ6ICdkYXRhZ3JhbScsIGFjdGlvbjogJy0nLCBmcmFtZXM6IEAjXG4gICAgYXNfb3BfZnJhbWUgQDoga2luZDogJ2RhdGFncmFtJywgYWN0aW9uOiAnQCcsIGZyYW1lczogQCMgZnJtLmZyb21fcm91dGUsIGZybS5mcm9tX3RhcmdldFxuXG4gICAgLy8gZGlyZWN0OiBcbiAgICBhc19vcF9mcmFtZSBAOiBraW5kOiAnZGlyZWN0JywgYWN0aW9uOiAnRScsIGZyYW1lczogQCMgZnJtLnRva2VuXG4gICAgYXNfb3BfZnJhbWUgQDoga2luZDogJ2RpcmVjdCcsIGFjdGlvbjogJ2UnLCBmcmFtZXM6IEAjIGZybS5tc2dpZFxuICAgIGFzX29wX2ZyYW1lIEA6IGtpbmQ6ICdkaXJlY3QnLCBhY3Rpb246ICdEJywgZnJhbWVzOiBAIyBmcm0uZnJvbV9yb3V0ZSwgZnJtLmZyb21fdGFyZ2V0LCBmcm0udG9rZW5cbiAgICBhc19vcF9mcmFtZSBAOiBraW5kOiAnZGlyZWN0JywgYWN0aW9uOiAnZCcsIGZyYW1lczogQCMgZnJtLmZyb21fcm91dGUsIGZybS5mcm9tX3RhcmdldCwgZnJtLm1zZ2lkXG5cbiAgICAvLyBtdWx0aXBhcnQ6XG4gICAgYXNfb3BfZnJhbWUgQDoga2luZDogJ211bHRpcGFydCcsIGFjdGlvbjogJ1UnLCBmcmFtZXM6IEAjIGZybS50b2tlbiwgZnJtLnNlcVxuICAgIGFzX29wX2ZyYW1lIEA6IGtpbmQ6ICdtdWx0aXBhcnQnLCBhY3Rpb246ICd1JywgZnJhbWVzOiBAIyBmcm0ubXNnaWQsIGZybS5zZXFcbiAgICBhc19vcF9mcmFtZSBAOiBraW5kOiAnbXVsdGlwYXJ0JywgYWN0aW9uOiAnTScsIGZyYW1lczogQCMgZnJtLmZyb21fcm91dGUsIGZybS5mcm9tX3RhcmdldCwgZnJtLnRva2VuLCBmcm0uc2VxXG4gICAgYXNfb3BfZnJhbWUgQDoga2luZDogJ211bHRpcGFydCcsIGFjdGlvbjogJ20nLCBmcmFtZXM6IEAjIGZybS5mcm9tX3JvdXRlLCBmcm0uZnJvbV90YXJnZXQsIGZybS5tc2dpZCwgZnJtLnNlcVxuXG4gICAgLy8gc3RyZWFtaW5nOlxuICAgIGFzX29wX2ZyYW1lIEA6IGtpbmQ6ICdzdHJlYW0nLCBhY3Rpb246ICdSJywgZnJhbWVzOiBAIyBmcm0udG9rZW4sIGZybS5zZXFcbiAgICBhc19vcF9mcmFtZSBAOiBraW5kOiAnc3RyZWFtJywgYWN0aW9uOiAncicsIGZyYW1lczogQCMgZnJtLm1zZ2lkLCBmcm0uc2VxXG4gICAgYXNfb3BfZnJhbWUgQDoga2luZDogJ3N0cmVhbScsIGFjdGlvbjogJ1MnLCBmcmFtZXM6IEAjIGZybS5mcm9tX3JvdXRlLCBmcm0uZnJvbV90YXJnZXQsIGZybS50b2tlbiwgZnJtLnNlcVxuICAgIGFzX29wX2ZyYW1lIEA6IGtpbmQ6ICdzdHJlYW0nLCBhY3Rpb246ICdzJywgZnJhbWVzOiBAIyBmcm0uZnJvbV9yb3V0ZSwgZnJtLmZyb21fdGFyZ2V0LCBmcm0ubXNnaWQsIGZybS5zZXFcblxuXG5cbmZ1bmN0aW9uIGlkZW50KG9wKSA6OiByZXR1cm4gb3BcbmV4cG9ydCBmdW5jdGlvbiBiaW5kX29wX3VucGFjayhvcHNfbGlzdCkgOjpcbiAgY29uc3Qgb3BfdW5wYWNrX3RhYmxlID0gQHt9ICcnOiBpZGVudCwgJyAnOiBpZGVudFxuICBmb3IgY29uc3Qgb3Agb2Ygb3BzX2xpc3QgOjpcbiAgICBvcF91bnBhY2tfdGFibGVbb3AuYWN0aW9uXSA9IG9wLnVucGFja1xuICByZXR1cm4gb3BfdW5wYWNrXG5cbiAgZnVuY3Rpb24gb3BfdW5wYWNrKHBrdCwgb3ApIDo6XG4gICAgY29uc3QgaGRyID0gcGt0Ll9oZHJfXG4gICAgY29uc3QgdW5wYWNrID0gb3BfdW5wYWNrX3RhYmxlW2hkclsyXV0gfHwgaWRlbnRcbiAgICB1bnBhY2soaGRyLCBvcClcbiAgICByZXR1cm4gcGt0Lm9wID0gaGRyLm9wID0gb3BcblxuXG5mdW5jdGlvbiBhc19vcHNfYXBpKC4uLm9wc19saXN0KSA6OlxuICBvcHNfbGlzdCA9IFtdLmNvbmNhdCBAIC4uLm9wc19saXN0XG4gIGNvbnN0IGFwaSA9IHt9XG4gIGZvciBjb25zdCB7a2luZCwgYWN0aW9uLCBwYWNrfSBvZiBvcHNfbGlzdCA6OlxuICAgIC8vIHRyaWNrIHRvIGdldCB0aGUgcHJvcGVyIGZ1bmN0aW9uIGRpc3BsYXlOYW1lXG4gICAgY29uc3QgbmFtZSA9IGBvcCAke2FjdGlvbn1gLCB0bXAgPSBAe31cbiAgICAgIFtuYW1lXShvYmosIGhkcikgOjpcbiAgICAgICAgb2JqLm9wID0gcGFjayhoZHIpXG4gICAgICAgIHJldHVybiBvYmpcblxuICAgIGFwaVtraW5kXSA9IHRtcFtuYW1lXVxuICByZXR1cm4gYXBpXG5cblxuXG5leHBvcnQgZGVmYXVsdCBtc2dfZnJhbWluZ19hcGlcbmV4cG9ydCBmdW5jdGlvbiBtc2dfZnJhbWluZ19hcGkoc2hhcmVkLCBwbHVnaW5fZnJhbWVzKSA6OlxuICBsZXQgYWxsX29wcyA9IHN0YW5kYXJkX2ZyYW1lcygpXG4gIGlmIHBsdWdpbl9mcmFtZXMgOjpcbiAgICBhbGxfb3BzID0gcGx1Z2luX2ZyYW1lcyh7ZnJtLCBhc19vcF9mcmFtZX0sIGFsbF9vcHMpXG5cbiAgc2hhcmVkLm9wX3VucGFjayA9IGJpbmRfb3BfdW5wYWNrIEAgYWxsX29wc1xuXG4gIGNvbnN0IGZpbmRfb3BzID0gKHtoYXMsIHNhbnN9KSA9PiBhbGxfb3BzLmZpbHRlciBAIG9wID0+IEBcbiAgICAgICBAICFoYXMgIHx8IGhhcyAuc3BsaXQoJyAnKS5ldmVyeSBAIGEgPT4gb3AuYXR0cnMuaW5jbHVkZXMgQCBhXG4gICAgJiYgQCAhc2FucyB8fCBzYW5zLnNwbGl0KCcgJykuZXZlcnkgQCBhID0+ICEgb3AuYXR0cnMuaW5jbHVkZXMgQCBhXG5cbiAgY29uc3QgYmFzaWNfZnJvbV9vcHMgPSBmaW5kX29wcyBAOiBoYXM6ICdmcm9tX3JvdXRlJywgc2FuczogJ3Rva2VuIG1zZ2lkJ1xuICBjb25zdCBiYXNpY19hbm9uX29wcyA9IGZpbmRfb3BzIEA6IHNhbnM6ICdmcm9tX3JvdXRlIHRva2VuIG1zZ2lkJ1xuXG4gIHNoYXJlZC5vcHNfYXBpID0gQHt9XG4gICAgZnJvbV9zb3VyY2U6IGFzX29wc19hcGkgQFxuICAgICAgYmFzaWNfZnJvbV9vcHNcbiAgICAgIGZpbmRfb3BzIEA6IGhhczogJ2Zyb21fcm91dGUnLCBzYW5zOiAnbXNnaWQnXG5cbiAgICBmcm9tX3JlcGx5OiBhc19vcHNfYXBpIEBcbiAgICAgIGJhc2ljX2Zyb21fb3BzXG4gICAgICBmaW5kX29wcyBAOiBoYXM6ICdmcm9tX3JvdXRlIG1zZ2lkJ1xuXG4gICAgYW5vbl9zb3VyY2U6IGFzX29wc19hcGkgQFxuICAgICAgYmFzaWNfYW5vbl9vcHNcbiAgICAgIGZpbmRfb3BzIEA6IHNhbnM6ICdmcm9tX3JvdXRlIG1zZ2lkJ1xuXG4gICAgYW5vbl9yZXBseTogYXNfb3BzX2FwaSBAXG4gICAgICBiYXNpY19hbm9uX29wc1xuICAgICAgZmluZF9vcHMgQDogaGFzOiAnbXNnaWQnLCBzYW5zOiAnZnJvbV9yb3V0ZSdcblxuIiwiaW1wb3J0IHthc19zb3VyY2VfaWQsIGFzX3JlcGx5X2lkLCBiaW5kX214X2FwaX0gZnJvbSAnLi9iYXNlLmpzeSdcblxuZXhwb3J0IGRlZmF1bHQgbXNnX2Fub25fYXBpXG5leHBvcnQgZnVuY3Rpb24gbXNnX2Fub25fYXBpKHNoYXJlZCkgOjpcbiAgY29uc3QgeyBuZXdUb2tlbiwgYmluZF9zZW5kbXNnLCBiaW5kX3JlcGx5bXNnIH0gPSBzaGFyZWRcblxuICBjb25zdCBzb3VyY2VfYXBpID0gYmluZF9zZW5kbXNnIEA6IGFub24sIG9wX2FwaTogc2hhcmVkLm9wc19hcGkuYW5vbl9zb3VyY2VcbiAgY29uc3QgcmVwbHlfYXBpID0gYmluZF9yZXBseW1zZyBAOiBhbm9uLCBvcF9hcGk6IHNoYXJlZC5vcHNfYXBpLmFub25fcmVwbHlcblxuICBjb25zdCBteF9hcGkgPSBiaW5kX214X2FwaShzb3VyY2VfYXBpLCByZXBseV9hcGkpXG4gIGNvbnN0IGFub25fY3R4ID0gQHt9IG5ld1Rva2VuLCByZXNwb25zZUZvcigpIHt9LCBvbl9yZXNwb25zZSgpIHt9XG5cbiAgYW5vbl9hcGkucm9vdF9zb3VyY2UgPSBwaV9tc2dzID0+IEA6XG4gIHJldHVybiBzaGFyZWQuYW5vbl9hcGkgPSBhbm9uX2FwaVxuXG4gIGZ1bmN0aW9uIGFub25fYXBpKHRvX2lkLCBwa3Rfb3AsIHNvdXJjZSkgOjpcbiAgICBpZiBudWxsID09IHNvdXJjZSA6OiB0aHJvdyBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIHNvdXJjZScpXG5cbiAgICBjb25zdCBbaWRfcm91dGUsIGlkX3RhcmdldF0gPSBudWxsICE9PSB0b19pZFxuICAgICAgPyBhc19zb3VyY2VfaWQodG9faWQpIDogYXNfcmVwbHlfaWQocGt0X29wKVxuXG4gICAgaWYgbnVsbCA9PSBpZF90YXJnZXQgfHwgbnVsbCA9PSBpZF9yb3V0ZSA6OlxuICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYEludmFsaWQgaWRgXG5cbiAgICByZXR1cm4gbXhfYXBpIEAgcGt0X29wLCBAe31cbiAgICAgIGlkX3JvdXRlLCBpZF90YXJnZXQsIGN0eDogYW5vbl9jdHgsIHNvdXJjZSwgb3BvMDoge31cblxuXG5mdW5jdGlvbiBhbm9uKCkgOjogcmV0dXJuIHRoaXNcbiIsImltcG9ydCB7c3ltX3NhbXBpLCBhc19zb3VyY2VfaWR9IGZyb20gJy4vYmFzZS5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IG1zZ19zb3VyY2VfYXBpXG5leHBvcnQgZnVuY3Rpb24gbXNnX3NvdXJjZV9hcGkoc2hhcmVkKSA6OlxuICBjb25zdCB7IG9wX3VucGFjaywgZnJvbV9hcGksIGFub25fYXBpIH0gPSBzaGFyZWRcblxuICByZXR1cm4gc2hhcmVkLnNvdXJjZV9hcGkgPSAoc3JjX2lkLCBwaV9tc2dzKSA9PiA6OlxuXG4gICAgY29uc3QgW2Zyb21fcm91dGUsIGZyb21fdGFyZ2V0XSA9IGFzX3NvdXJjZV9pZChzcmNfaWQpXG4gICAgaWYgbnVsbCA9PSBmcm9tX3JvdXRlIHx8IG51bGwgPT0gZnJvbV90YXJnZXQgOjpcbiAgICAgIHRocm93IG5ldyBFcnJvciBAICdWYWxpZCB0YXJnZXQgYW5kIHJvdXRlIHJlcXVpcmVkJ1xuXG4gICAgY29uc3QgY3R4ID0gcGlfbXNncy5jcmVhdGVDb250ZXh0KClcblxuICAgIGNvbnN0IHNvdXJjZSA9IEB7fSBfcmVjdl9cbiAgICAgIHRvSlNPTihvYmo9e30pIDo6XG4gICAgICAgIG9ialtzeW1fc2FtcGldID0gYCR7ZnJvbV9yb3V0ZX0gJHtmcm9tX3RhcmdldH1gXG4gICAgICAgIHJldHVybiBvYmpcblxuICAgICAgYW5vbihpZCkgOjogcmV0dXJuIGFub25fYXBpIEAgaWQsIG51bGwsIHNvdXJjZVxuICAgICAgdG8oaWQpIDo6IHJldHVybiBmcm9tX3NyYyBAIGlkLCBudWxsXG5cbiAgICBjb25zdCBmcm9tX3NyYyA9IGZyb21fYXBpIEA6XG4gICAgICBmcm9tX3JvdXRlLCBmcm9tX3RhcmdldCwgY3R4LCBzb3VyY2VcblxuICAgIGNvbnN0IHBrdF9hcGkgPSBAe31cbiAgICAgIGFub24oKSA6OiByZXR1cm4gYW5vbl9hcGkgQCBudWxsLCB0aGlzLCBzb3VyY2VcbiAgICAgIHJlcGx5KCkgOjogcmV0dXJuIGZyb21fc3JjIEAgbnVsbCwgdGhpc1xuICAgICAgcmVzb2x2ZShhbnMpIDo6XG4gICAgICAgIGNvbnN0IHttc2dpZH0gPSB0aGlzXG4gICAgICAgIHJldHVybiBtc2dpZCA/IGN0eC5vbl9yZXNvbHZlKG1zZ2lkLCBhbnMpIDogYW5zXG5cbiAgICByZXR1cm4gc291cmNlXG5cbiAgICBmdW5jdGlvbiBfcmVjdl8ocGt0KSA6OlxuICAgICAgY29uc3Qgb3AgPSBvcF91bnBhY2sgQCBwa3QsIHtfX3Byb3RvX186IHBrdF9hcGl9XG4gICAgICBpZiBwa3QuaXNfcGt0X3NwbGl0IDo6XG4gICAgICAgIHJldHVybiBjdHgub25fc3BsaXRfcGt0KHBrdCwgb3ApXG4gICAgICBlbHNlIHJldHVybiBwa3RcblxuIiwiaW1wb3J0IHthc19zb3VyY2VfaWQsIGFzX3JlcGx5X2lkLCBiaW5kX214X2FwaX0gZnJvbSAnLi9iYXNlLmpzeSdcblxuZXhwb3J0IGRlZmF1bHQgbXNnX3NlbmRGcm9tX2FwaVxuZXhwb3J0IGZ1bmN0aW9uIG1zZ19zZW5kRnJvbV9hcGkoc2hhcmVkKSA6OlxuICBjb25zdCB7IGJpbmRfc2VuZG1zZywgYmluZF9yZXBseW1zZyB9ID0gc2hhcmVkXG5cbiAgY29uc3Qgc291cmNlX2FwaSA9IGJpbmRfc2VuZG1zZyBAOiBhbm9uLCBvcF9hcGk6IHNoYXJlZC5vcHNfYXBpLmZyb21fc291cmNlXG4gIGNvbnN0IHJlcGx5X2FwaSA9IGJpbmRfcmVwbHltc2cgQDogYW5vbiwgb3BfYXBpOiBzaGFyZWQub3BzX2FwaS5mcm9tX3JlcGx5XG5cbiAgY29uc3QgbXhfYXBpID0gYmluZF9teF9hcGkoc291cmNlX2FwaSwgcmVwbHlfYXBpKVxuXG4gIHJldHVybiBzaGFyZWQuZnJvbV9hcGkgPSAoe2Zyb21fcm91dGUsIGZyb21fdGFyZ2V0LCBjdHgsIHNvdXJjZX0pID0+IDo6XG4gICAgaWYgbnVsbCA9PSBzb3VyY2UgOjogdGhyb3cgbmV3IFR5cGVFcnJvcignSW52YWxpZCBzb3VyY2UnKVxuXG4gICAgcmV0dXJuICh0b19pZCwgcGt0X29wKSA9PiA6OlxuXG4gICAgICBjb25zdCBbaWRfcm91dGUsIGlkX3RhcmdldF0gPSBudWxsICE9PSB0b19pZFxuICAgICAgICA/IGFzX3NvdXJjZV9pZCh0b19pZCkgOiBhc19yZXBseV9pZChwa3Rfb3ApXG5cbiAgICAgIGlmIG51bGwgPT0gaWRfcm91dGUgfHwgbnVsbCA9PSBpZF90YXJnZXQgOjpcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yIEAgYEludmFsaWQgaWRgXG5cbiAgICAgIHJldHVybiBteF9hcGkgQCBwa3Rfb3AsIEB7fVxuICAgICAgICBpZF9yb3V0ZSwgaWRfdGFyZ2V0LCBjdHgsIHNvdXJjZVxuICAgICAgICBwa3Rfb3AsIG9wbzA6IHtmcm9tX3JvdXRlLCBmcm9tX3RhcmdldH1cblxuXG4gIGZ1bmN0aW9uIGFub24oKSA6OlxuICAgIGNvbnN0IF9teF8gPSB0aGlzLl9teF9cbiAgICByZXR1cm4gc2hhcmVkLmFub25fYXBpIEBcbiAgICAgIF9teF8sIF9teF8ucGt0X29wLCBfbXhfLnNvdXJjZVxuXG4iLCJpbXBvcnQgYmFzZV9hcGkgZnJvbSAnLi9iYXNlLmpzeSdcbmltcG9ydCBmcmFtaW5nX2FwaSBmcm9tICcuL2ZyYW1pbmcuanN5J1xuaW1wb3J0IHNlbmRfYW5vbl9hcGkgZnJvbSAnLi9zZW5kX2Fub24uanN5J1xuaW1wb3J0IHNvdXJjZV9hcGkgZnJvbSAnLi9zb3VyY2UuanN5J1xuaW1wb3J0IHNlbmRfZnJvbV9hcGkgZnJvbSAnLi9zZW5kX2Zyb20uanN5J1xuXG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIG1zZ3NfcGx1Z2luKHBsdWdpbl9vcHRpb25zKSA6OlxuICByZXR1cm4gZnVuY3Rpb24gKGh1YikgOjpcbiAgICBjb25zdCBtc2dzID0gY3JlYXRlTXNnc1BsdWdpbihwbHVnaW5fb3B0aW9ucylcbiAgICBtc2dzLmNyZWF0ZU1zZ3NQbHVnaW4gPSBjcmVhdGVNc2dzUGx1Z2luXG4gICAgcmV0dXJuIGh1Yi5tc2dzID0gbXNnc1xuXG4gICAgZnVuY3Rpb24gY3JlYXRlTXNnc1BsdWdpbihvcHRpb25zPXt9KSA6OlxuICAgICAgY29uc3Qgc2hhcmVkID0gYmFzZV9hcGkoaHViLCBvcHRpb25zKVxuXG4gICAgICBmcmFtaW5nX2FwaShzaGFyZWQsIG9wdGlvbnMuYmluZF9mcmFtaW5ncylcblxuICAgICAgaWYgb3B0aW9ucy5iaW5kX21zZ2FwaXMgOjpcbiAgICAgICAgX2V4dGVuZF9tc2dhcGlzKG9wdGlvbnMsIHNoYXJlZClcblxuICAgICAgY29uc3QgYXNfYW5vbiA9IHNlbmRfYW5vbl9hcGkoc2hhcmVkKVxuICAgICAgc2VuZF9mcm9tX2FwaShzaGFyZWQpXG4gICAgICBjb25zdCBhc19zcmMgPSBzb3VyY2VfYXBpKHNoYXJlZClcblxuICAgICAgcmV0dXJuIEB7fVxuICAgICAgICB0byhpZCkgOjogcmV0dXJuIGFzX2Fub24gQCBpZCwgbnVsbCwgYXNfYW5vbi5yb290X3NvdXJjZSh0aGlzKVxuICAgICAgICBhcyhpZCkgOjogcmV0dXJuIGFzX3NyYyBAIGlkLCB0aGlzXG5cbiAgICAgICAgY3JlYXRlQ29udGV4dDogc2hhcmVkLmNyZWF0ZUNvbnRleHRcbiAgICAgICAgZXhwaXJlOiBzaGFyZWQuZXhwaXJlXG5cblxuZnVuY3Rpb24gX2V4dGVuZF9tc2dhcGlzKG9wdGlvbnMsIHNoYXJlZCkgOjpcbiAgY29uc3Qge2JpbmRfbXNnX2FwaSwgYmluZF9zZW5kbXNnLCBiaW5kX3JlcGx5bXNnfSA9XG4gICAgb3B0aW9ucy5iaW5kX21zZ2FwaXMgQDpcbiAgICAgIGJpbmRfbXNnX2FwaTogc2hhcmVkLmJpbmRfbXNnX2FwaVxuICAgICAgYmluZF9zZW5kbXNnOiBzaGFyZWQuYmluZF9zZW5kbXNnXG4gICAgICBiaW5kX3JlcGx5bXNnOiBzaGFyZWQuYmluZF9yZXBseW1zZ1xuXG4gIGlmIGJpbmRfbXNnX2FwaSA6OiBzaGFyZWQuYmluZF9tc2dfYXBpID0gYmluZF9tc2dfYXBpXG4gIGlmIGJpbmRfc2VuZG1zZyA6OiBzaGFyZWQuYmluZF9zZW5kbXNnID0gYmluZF9zZW5kbXNnXG4gIGlmIGJpbmRfcmVwbHltc2cgOjogc2hhcmVkLmJpbmRfcmVwbHltc2cgPSBiaW5kX3JlcGx5bXNnXG4iLCJpbXBvcnQgRmFicmljSHViIGZyb20gJy4vaW5kZXguanN5J1xuaW1wb3J0IHBsYXRmb3JtIGZyb20gJy4uL3BsdWdpbnMvcGxhdGZvcm0vYnJvd3Nlci5qc3knXG5pbXBvcnQgcGt0IGZyb20gJy4uL3BsdWdpbnMvcGt0L2Jyb3dzZXIuanN5J1xuaW1wb3J0IG1zZ3MgZnJvbSAnLi4vcGx1Z2lucy9tc2dzL3BsdWdpbi5qc3knXG5cbmV4cG9ydCBkZWZhdWx0IEZhYnJpY0h1Yi5wbHVnaW4gQCBwbGF0Zm9ybSgpLCBwa3QoKSwgbXNncygpXG4iLCJ2YXIgSHViXG5leHBvcnQgeyBIdWIgfVxuZXhwb3J0IGZ1bmN0aW9uIF9pbml0KEZhYnJpY0h1YikgOjpcbiAgSHViID0gRmFicmljSHViXG5cbiIsImNvbnN0IGNoYWkgPSByZXF1aXJlKCdjaGFpJylcbmV4cG9ydCBjb25zdCBhc3NlcnQgPSBjaGFpLmFzc2VydFxuZXhwb3J0IGNvbnN0IGV4cGVjdCA9IGNoYWkuZXhwZWN0XG5cbmV4cG9ydCBmdW5jdGlvbiBuZXdMb2coKSA6OlxuICBjb25zdCBfbG9nID0gW11cbiAgY29uc3QgbG9nID0gKC4uLmFyZ3MpID0+XG4gICAgX2xvZy5wdXNoIEAgMSA9PT0gYXJncy5sZW5ndGhcbiAgICAgID8gYXJnc1swXSA6IGFyZ3NcblxuICBsb2cuY2FsbHMgPSBfbG9nXG4gIHJldHVybiBsb2dcbiIsImltcG9ydCB7IGV4cGVjdCB9IGZyb20gJy4vX3V0aWxzJ1xuaW1wb3J0IHsgSHViIH0gZnJvbSAnLi9fc2V0dXAnXG5cbml0IEAgJ3Ntb2tlJywgQD0+PiA6OiBcbiAgZXhwZWN0KEh1YikudG8uYmUuYSBAICdmdW5jdGlvbidcbiAgZXhwZWN0KEh1Yi5jcmVhdGUpLnRvLmJlLmEgQCAnZnVuY3Rpb24nXG4iLCJpbXBvcnQgeyBleHBlY3QgfSBmcm9tICcuL191dGlscydcbmltcG9ydCB7IEh1YiB9IGZyb20gJy4vX3NldHVwJ1xuXG5kZXNjcmliZSBAICdIdWIgY3JlYXRpb24nLCBAPT4gOjpcblxuICBpdCBAICduZXcgSHViJywgQD0+PiA6OiBcbiAgICBjb25zdCBodWIgPSBuZXcgSHViKClcbiAgICBleHBlY3QgQCBodWIubG9jYWwuaWRfcm91dGVcbiAgICAudG8uYmUuYSgnc3RyaW5nJylcblxuICBpdCBAICdIdWIuY3JlYXRlJywgQD0+PiA6OiBcbiAgICBjb25zdCBodWIgPSBIdWIuY3JlYXRlKClcbiAgICBleHBlY3QgQCBodWIubG9jYWwuaWRfcm91dGVcbiAgICAudG8uYmUuYSgnc3RyaW5nJylcblxuICBpdCBAICduZXcgSHViIHdpdGggc3BlY2lmaWVkIGlkX3JvdXRlJywgQD0+PiA6OiBcbiAgICBjb25zdCBodWIgPSBuZXcgSHViKCckdW5pdCQnKVxuICAgIGV4cGVjdCBAIGh1Yi5sb2NhbC5pZF9yb3V0ZVxuICAgIC50by5lcXVhbCBAICckdW5pdCQnXG5cbiAgaXQgQCAnSHViLmNyZWF0ZSB3aXRoIHNwZWNpZmllZCBpZF9yb3V0ZScsIEA9Pj4gOjogXG4gICAgY29uc3QgaHViID0gSHViLmNyZWF0ZSgnJHVuaXQkJylcbiAgICBleHBlY3QgQCBodWIubG9jYWwuaWRfcm91dGVcbiAgICAudG8uZXF1YWwgQCAnJHVuaXQkJ1xuXG4gIGl0IEAgJ25ldyBIdWIgd2l0aCBpZF9wcmVmaXgnLCBAPT4+IDo6IFxuICAgIGNvbnN0IGh1YiA9IG5ldyBIdWIgQDogaWRfcHJlZml4OiAnJHVuaXQkJ1xuICAgIGV4cGVjdCBAIGh1Yi5sb2NhbC5pZF9yb3V0ZS5zdGFydHNXaXRoKCckdW5pdCQnKVxuICAgIC50by5iZS50cnVlXG5cbiAgaXQgQCAnSHViLmNyZWF0ZSB3aXRoIGlkX3ByZWZpeCcsIEA9Pj4gOjogXG4gICAgY29uc3QgaHViID0gSHViLmNyZWF0ZSBAOiBpZF9wcmVmaXg6ICckdW5pdCQnXG4gICAgZXhwZWN0IEAgaHViLmxvY2FsLmlkX3JvdXRlLnN0YXJ0c1dpdGgoJyR1bml0JCcpXG4gICAgLnRvLmJlLnRydWVcblxuIiwiaW1wb3J0IEZhYnJpY0h1YiBmcm9tICcuLi8uLi9jb2RlL2luZGV4LmJyb3dzZXIuanN5J1xuXG5pbXBvcnQgeyBfaW5pdCB9IGZyb20gJy4vX3NldHVwJ1xuX2luaXQoRmFicmljSHViKVxuXG5leHBvcnQgKiBmcm9tICcuL2FsbCdcbiJdLCJuYW1lcyI6WyJwcm9taXNlUXVldWUiLCJzcmMiLCJ0aXAiLCJQcm9taXNlIiwicmVzb2x2ZSIsInRoZW4iLCJjbGVhciIsInN5bV9kZWR1cCIsIlN5bWJvbCIsImRpc2NvdmVyRmlyc3QiLCJsc3RGbnMiLCJxdWVyeSIsIm9uX2Vycm9yIiwia2V5IiwiZGVkdXAiLCJ1bmRlZmluZWQiLCJyZXMiLCJnZXQiLCJNYXAiLCJkZWZpbmVQcm9wZXJ0eSIsInZhbHVlIiwicmVzb2x2ZUlmIiwiZSIsImFsbCIsIkFycmF5IiwiZnJvbSIsImZuIiwic2V0IiwiZGVsZXRlIiwidGltZW91dFJlc29sdmUiLCJtcyIsImFuc3dlciIsInNldFRpbWVvdXQiLCJhcHBseVBsdWdpbnMiLCJwbHVnaW5MaXN0IiwiYXJncyIsInBsdWdpbiIsIkZhYnJpY0Jhc2UiLCJPYmplY3QiLCJhc3NpZ24iLCJwcm90b3R5cGUiLCJzY29wZSIsImVyciIsImVycm9yIiwiRmFicmljUm91dGVyIiwiZGVmaW5lUHJvcGVydGllcyIsIl9kaXNjb3ZlcnlEZWZhdWx0Iiwic2xpY2UiLCJfYmluZERpc3BhdGNoUm91dGVzIiwiaHViX3JvdXRlciIsInJvdXRlc19tYXAiLCJfY3JlYXRlUm91dGVzTWFwIiwicHF1ZXVlIiwiX3Byb21pc2VRdWV1ZSIsImRpc3BhdGNoIiwicmVzb2x2ZVJvdXRlIiwicmVnaXN0ZXJSb3V0ZSIsInVucmVnaXN0ZXJSb3V0ZSIsImlkX3JvdXRlIiwiZGlzY292ZXJSb3V0ZSIsImRpc3BhdGNoX29uZSIsInBrdCIsInBrdGN0eCIsInJvdXRlIiwiY2hhbm5lbCIsInVuZGVsaXZlcmFibGUiLCJfb25fZXJyb3IiLCJwa3RMaXN0IiwicHEiLCJtYXAiLCJUeXBlRXJyb3IiLCJoYXMiLCJzZW5kIiwiX2Rpc2NvdmVyRmlyc3QiLCJyb3V0ZURpc2NvdmVyeSIsImVwaGVtZXJhbCIsInJlZ2lzdGVyUGVlclJvdXRlIiwiVGFyZ2V0Um91dGVyIiwicm91dGVyIiwiZW51bWVyYWJsZSIsIl9iaW5kRGlzcGF0Y2hUYXJnZXQiLCJ0Z3Rfcm91dGVyIiwidGFyZ2V0c19tYXAiLCJfY3JlYXRlVGFyZ2V0c01hcCIsInJlZ2lzdGVyVGFyZ2V0IiwidW5yZWdpc3RlclRhcmdldCIsImRpc3BhdGNoX3RhcmdldCIsImlkX3RhcmdldCIsInRhcmdldCIsImRpc2NvdmVyVGFyZ2V0IiwidGFyZ2V0RGlzY292ZXJ5IiwiUDJQUm91dGVyIiwicHVibGljX3JvdXRlcyIsImluaXRQMlAiLCJpZCIsIkVycm9yIiwicHVzaCIsIl90Z3RfaGVsbG8iLCJiaW5kIiwiX3RndF9vbGxlaCIsInBlZXJfcm91dGVzIiwianNvbiIsIkZhYnJpY0h1YiIsImNyZWF0ZSIsIm9wdGlvbnMiLCJfaW5pdF9mYWJyaWNSb3V0ZXIiLCJwMnAiLCJjcmVhdGVQMlBSb3V0ZSIsImxvY2FsIiwiY3JlYXRlTG9jYWxSb3V0ZSIsInB1Ymxpc2hSb3V0ZSIsIl9iaW5kU2VuZExvY2FsIiwia2xhc3MiLCJjb25zdHJ1Y3RvciIsIm5ld1JvdXRlSWQiLCJkYXRhX3V0aWxzIiwicmFuZG9tIiwicHJlZml4IiwiaWRfcHJlZml4IiwicHJpdmF0ZVJvdXRlIiwiY29ubl91cmwiLCJwYXJzZV91cmwiLCJjb25uZWN0IiwiX2Nvbm5lY3RCeVByb3RvY29sIiwicHJvdG9jb2wiLCJwcm90b2NvbExpc3QiLCJjYl9jb25uZWN0IiwiX2Zyb21PYmpQYWNrZXQiLCJfaHViX2NoYW5uZWxfIiwiaHViX3NlbmQiLCJvYmpzIiwib2JqIiwicGx1Z2luRnVuY3Rpb25zIiwicGx1Z2lucyIsImZyZWV6ZSIsImNvbmNhdCIsInNvcnQiLCJhIiwiYiIsIm9yZGVyIiwibW9kZSIsIndhcm4iLCJGYWJyaWNSb3V0ZXJfQmFzZSIsIlRhcmdldFJvdXRlcl9CYXNlIiwiUDJQUm91dGVyX0Jhc2UiLCJfZnJvbUNoYXJDb2RlIiwiU3RyaW5nIiwiZnJvbUNoYXJDb2RlIiwiX2NoYXJDb2RlQXQiLCJjaGFyQ29kZUF0IiwiYnJvd3Nlcl9wbGF0Zm9ybV9wbHVnaW4iLCJwbHVnaW5fb3B0aW9ucyIsInN1YmNsYXNzIiwidW5wYWNrX2Jhc2U2NCIsImVuY29kZV91dGY4IiwiY29uY2F0X2RhdGEiLCJuIiwiYXNCYXNlNjQiLCJ1YSIsIlVpbnQ4QXJyYXkiLCJjcnlwdG8iLCJnZXRSYW5kb21WYWx1ZXMiLCJwYWNrX2Jhc2U2NCIsInVybCIsIlVSTCIsImRhdGEiLCJ1OCIsImJ1ZmZlciIsImxlbiIsImJ5dGVMZW5ndGgiLCJpIiwid2luZG93IiwiYnRvYSIsInN0cl9iNjQiLCJzeiIsImF0b2IiLCJsZW5ndGgiLCJjYWxsIiwiZGVjb2RlX3V0ZjgiLCJUZXh0RGVjb2RlciIsImRlY29kZSIsInN0ciIsIlRleHRFbmNvZGVyIiwiZW5jb2RlIiwiYXNfZGF0YSIsIkFycmF5QnVmZmVyIiwicGFydHMiLCJqc29uX3BhcnNlIiwiSlNPTiIsInBhcnNlIiwianNvbl9zdHJpbmdpZnkiLCJzdHJpbmdpZnkiLCJhc19oZHIiLCJvcCIsImpvaW4iLCJvX2NyZWF0ZSIsImFzX3BrdDAiLCJoZHIiLCJtZXRhIiwiYm9keSIsImFQa3RCYXNlIiwic3BsaXQiLCJpc19qc29uX2JvZHkiLCJiaW5kX3JlcGFjayIsInJlcGFja0J5S2luZCIsInBrdF9raW5kIiwiX2hkcl8iLCJQa3RCYXNlIiwiaXNfcGt0IiwicmV2aXZlciIsIl9tZXRhXyIsInJlcGFjayIsInRleHQiLCJQa3RKc29uQmFzZSIsIl9fcHJvdG9fXyIsImlzX3BrdF9qc29uIiwiUGt0RGF0YUJhc2UiLCJpc19wa3RfZGF0YSIsInN5bV9zcGxpdCIsImtfZGF0YSIsImtfc3BsaXRfZGF0YSIsImtfanNvbiIsImtfc3BsaXRfanNvbiIsIlBrdFNwbGl0SnNvbiIsImlzX3BrdF9zcGxpdCIsIlBrdFNwbGl0RGF0YSIsImJpbmRfcGFja09ialBhY2tldCIsIlBrdERhdGEiLCJQa3RKc29uIiwicGFja0JvZHkiLCJwa3RCeUtpbmQiLCJyZXBhY2tfcGt0Iiwia190b2tlbiIsImJ1ZiIsImJpbmRfYmluYXJ5Q2FsbFBhY2tldCIsIl9jb21tb25fIiwiYmluZF9iaW5hcnlQYWNrZXRDb21tb24iLCJfdW5wYWNrQnlTbGljZSIsIl91bnBhY2tCaW5hcnlQYWNrZXRCeVNsaWNlIiwidW5wYWNrQmluYXJ5UGFja2V0IiwidW5wYWNrQmluYXJ5Q2FsbFBhY2tldCIsInBrdF9idWYiLCJwYWNrUGFydHMiLCJyZXBhY2tfYmluYXJ5IiwiX2JvZHlfIiwiaTAiLCJpMSIsImluZGV4T2YiLCJpMiIsImtpbmQiLCJjb25jYXRCb2R5IiwicGFja1BhcnRzVTgiLCJsZW4wIiwibWF4bGVuX3BrdCIsIm1heGxlbl9oZHIiLCJtYXhsZW5fbXNnIiwiTXVsdGlQa3RCYXNlIiwiaXNfbXVsdGlfcGt0IiwicGt0MCIsIl9wYXJ0c18iLCJzcGxpdFBhcnRzIiwiYmluZF9tdWx0aVBhY2tldCIsIk11bHRpUGt0SnNvbiIsIk11bHRpUGt0RGF0YSIsInVucGFja0J5S2luZCIsImlkeCIsImV2ZXJ5IiwidW5wYWNrX3NwbGl0IiwiaXNfanNvbiIsIk11bHRpUGt0IiwiYnJvd3Nlcl9wa3RfcGx1Z2luIiwiYmluX2NhbGwiLCJwa3RfY2FsbF9iaW5hcnkiLCJfcGt0c18iLCJwa3RfbXVsdGkiLCJmcm9tT2JqUGFja2V0IiwiZnJvbU9iakJpbmFyeVBhY2tldCIsImRlZmVycmVkIiwicHJvbWlzZSIsInJlamVjdCIsInRpbWVvdXRSZWFwZXIiLCJ0aW1lb3V0IiwicSIsInJlYXAiLCJjaWQiLCJzZXRJbnRlcnZhbCIsInRpY2siLCJNYXRoIiwibWF4IiwidW5yZWYiLCJleHBpcmUiLCJsb2ciLCJzeW1fc2FtcGkiLCJvX2Fzc2lnbiIsImFzX3NvdXJjZV9pZCIsImFzX3JlcGx5X2lkIiwiZnJvbV9yb3V0ZSIsImZyb21fdGFyZ2V0IiwiYmluZF9teF9hcGkiLCJzb3VyY2VfYXBpIiwicmVwbHlfYXBpIiwicGt0X29wIiwiX214XyIsInByb3BzIiwidG9rZW4iLCJvcG8wIiwibXNnaWQiLCJtc2dfYmFzZV9hcGkiLCJodWIiLCJzcGxpdEJvZHkiLCJqb2luUGFja2V0cyIsImNoYW4iLCJ0b2tlbkxlbiIsIm5ld1Rva2VuIiwibXNnX2FwaTAiLCJiaW5kX21zZ19hcGkwIiwiZGIiLCJkIiwicmVtb3ZlIiwiZGVmZXJyZWRGb3IiLCJhbnMiLCJmZWVkIiwib25fbmV3X3NwbGl0IiwiY29tcGxldGUiLCJmaW4iLCJzZXEiLCJpbmNsdWRlcyIsIm11bHRpIiwiYmluZF9zZW5kbXNnIiwia3ciLCJhcGkiLCJiaW5kX21zZ19hcGkiLCJwb3N0IiwiYmluZF9yZXBseW1zZyIsInJlcGx5RXhwZWN0ZWQiLCJhbm9uIiwib3BfYXBpIiwiX21wX3dpdGhfcmVzcG9uc2UiLCJfbXBfcG9zdCIsIl9kZ19wb3N0IiwiX2RnX3Jlc3BvbnNlIiwiZXh0cmEiLCJyZXNwb25zZSIsIm9wbyIsIl9uZXdfcmVzcG9uc2UiLCJfd3N0cmVhbSIsInN0cmVhbSIsIm11bHRpcGFydCIsImN0cmwiLCJfc2VuZF9wa3QiLCJfbmV3X3Rva2VuIiwiX21zZW5kIiwiZGF0YWdyYW0iLCJkaXJlY3QiLCJtc2dhcGkiLCJ3cml0ZUFsbCIsIm9wX21ldGhvZCIsInNlbGYiLCJjbG9zZSIsImN1ciIsIm5leHQiLCJ3cml0ZSIsImVuZCIsImN0eCIsInJlc3BvbnNlRm9yIiwiX2IxNl91bnBhY2siLCJ2IiwicGFyc2VJbnQiLCJfYjE2X3BhY2siLCJ0b1N0cmluZyIsIl9pc19kZWZpbmVkIiwiYXR0ciIsImZybSIsImFzX29wX2ZyYW1lIiwib3BfZnJhbWUiLCJhY3Rpb24iLCJmcmFtZXMiLCJwYWNrIiwidW5wYWNrIiwidW5zaGlmdCIsImZfcGFjayIsImYiLCJmaWx0ZXIiLCJfYXNfcGFja19mbiIsIl9hc19wYWNrTl9mbiIsImZfdW5wYWNrIiwiX2FzX3VucGFja19mbiIsIl9hc191bnBhY2tOX2ZuIiwiZjAiLCJmMSIsImYyIiwiZjMiLCJmNCIsImZucyIsInN0YW5kYXJkX2ZyYW1lcyIsImlkZW50IiwiYmluZF9vcF91bnBhY2siLCJvcHNfbGlzdCIsIm9wX3VucGFja190YWJsZSIsIm9wX3VucGFjayIsImFzX29wc19hcGkiLCJuYW1lIiwidG1wIiwibXNnX2ZyYW1pbmdfYXBpIiwic2hhcmVkIiwicGx1Z2luX2ZyYW1lcyIsImFsbF9vcHMiLCJmaW5kX29wcyIsInNhbnMiLCJhdHRycyIsImJhc2ljX2Zyb21fb3BzIiwiYmFzaWNfYW5vbl9vcHMiLCJvcHNfYXBpIiwibXNnX2Fub25fYXBpIiwiYW5vbl9zb3VyY2UiLCJhbm9uX3JlcGx5IiwibXhfYXBpIiwiYW5vbl9jdHgiLCJvbl9yZXNwb25zZSIsInJvb3Rfc291cmNlIiwicGlfbXNncyIsImFub25fYXBpIiwidG9faWQiLCJzb3VyY2UiLCJtc2dfc291cmNlX2FwaSIsImZyb21fYXBpIiwic3JjX2lkIiwiY3JlYXRlQ29udGV4dCIsIl9yZWN2XyIsImZyb21fc3JjIiwicGt0X2FwaSIsIm9uX3Jlc29sdmUiLCJvbl9zcGxpdF9wa3QiLCJtc2dfc2VuZEZyb21fYXBpIiwiZnJvbV9zb3VyY2UiLCJmcm9tX3JlcGx5IiwibXNnc19wbHVnaW4iLCJtc2dzIiwiY3JlYXRlTXNnc1BsdWdpbiIsImJhc2VfYXBpIiwiYmluZF9mcmFtaW5ncyIsImJpbmRfbXNnYXBpcyIsImFzX2Fub24iLCJzZW5kX2Fub25fYXBpIiwiYXNfc3JjIiwiX2V4dGVuZF9tc2dhcGlzIiwicGxhdGZvcm0iLCJIdWIiLCJfaW5pdCIsImNoYWkiLCJyZXF1aXJlIiwiYXNzZXJ0IiwiZXhwZWN0IiwiaXQiLCJ0byIsImJlIiwiZGVzY3JpYmUiLCJlcXVhbCIsInN0YXJ0c1dpdGgiLCJ0cnVlIl0sIm1hcHBpbmdzIjoiOzs7QUFBTyxTQUFTQSxZQUFULENBQXNCQyxHQUF0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
