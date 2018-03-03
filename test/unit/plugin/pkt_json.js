import { Hub, expect, newLog } from '../_setup'

export default function (pkts_kind) ::
  let pkts_api
  before @=> :: pkts_api = Hub.create()._pkts_[pkts_kind]

  it @ `${pkts_kind} packPacket with json body`, @=>> ::
    expect @
      pkts_api.packPacket @:
        id_route: '$route$'
        id_target: '$target$'
        body: @{} msg: 'a test pkt'

    .to.be.equal @
      '$route$ $target$\t@\t{"msg":"a test pkt"}'


  it @ `${pkts_kind} unpackPacket with json body`, @=>> ::
    const pkt = pkts_api.unpackPacket @
      '$route$ $target$\t@\t{"msg":"a test pkt"}'

    expect(pkt.id_route).to.be.equal('$route$')
    expect(pkt.id_target).to.be.equal('$target$')

    expect(pkt._hdr_.length).to.be.equal(2)
    expect(pkt._hdr_[0]).to.be.equal('$route$')
    expect(pkt._hdr_[1]).to.be.equal('$target$')

    expect(pkt._body_).to.be.equal @
      '{"msg":"a test pkt"}'
    expect(pkt.json()).to.be.deep.equal @:
      msg: "a test pkt"

    expect(pkt._meta_).to.be.equal('')
    expect(pkt.meta()).to.be.equal(null)


  it @ `${pkts_kind} packPacket with json body and meta`, @=>> ::
    expect @
      pkts_api.packPacket @:
        id_route: '$route$'
        id_target: '$target$'
        body: @{} msg: 'a test pkt'
        meta: @{} kind: '$meta$'

    .to.be.equal @
      '$route$ $target$\t@{"kind":"$meta$"}\t{"msg":"a test pkt"}'


  it @ `${pkts_kind} unpackPacket with json body and meta`, @=>> ::
    const pkt = pkts_api.unpackPacket @
      '$route$ $target$\t@{"kind":"$meta$"}\t{"msg":"a test pkt"}'

    expect(pkt.id_route).to.be.equal('$route$')
    expect(pkt.id_target).to.be.equal('$target$')

    expect(pkt._hdr_.length).to.be.equal(2)
    expect(pkt._hdr_[0]).to.be.equal('$route$')
    expect(pkt._hdr_[1]).to.be.equal('$target$')

    expect(pkt._body_).to.be.equal @
      '{"msg":"a test pkt"}'
    expect(pkt.json()).to.be.deep.equal @:
      msg: "a test pkt"

    expect(pkt._meta_).to.be.equal @
      '{"kind":"$meta$"}'
    expect(pkt.meta()).to.be.deep.equal @:
      kind: "$meta$"
