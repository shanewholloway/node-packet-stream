import { Hub, expect, newLog } from '../_setup'

export default function () ::
  let bin_len
  before @=> :: bin_len = Hub.create()._pkts_.bin_len

  it @ `bin_len packPacket with json body`, @=>> ::
    const pkt =
      bin_len.packPacket @:
        id_route: '$route$'
        id_target: '$target$'
        body: @{} msg: 'a test pkt'

    expect(pkt).to.have.lengthOf(41)
    expect(pkt[0]).to.equal(41)
    expect(pkt[1]).to.equal(0)
    expect @ pkt.slice(2).toString()
    .to.be.equal @
      '$route$ $target$\t@\t{"msg":"a test pkt"}'


  it @ `bin_len unpackPacket with json body`, @=>> ::
    const pkt = bin_len.unpackPacket @
      Buffer.concat @#
        Buffer @# 41, 0
        Buffer.from @
          '$route$ $target$\t@\t{"msg":"a test pkt"}'

    expect(pkt.id_route).to.be.equal('$route$')
    expect(pkt.id_target).to.be.equal('$target$')

    expect(pkt._hdr_).to.have.lengthOf(2)
    expect(pkt._hdr_[0]).to.be.equal('$route$')
    expect(pkt._hdr_[1]).to.be.equal('$target$')

    expect @
      Buffer.compare @ pkt._body_,
        Buffer.from @ '{"msg":"a test pkt"}'
    .to.equal(0)
    expect(pkt.json()).to.be.deep.equal @:
      msg: "a test pkt"

    expect(pkt._meta_).to.be.equal('')
    expect(pkt.meta()).to.be.equal(null)


  it @ `bin_len packPacket with json body and meta`, @=>> ::
    const pkt =
      bin_len.packPacket @:
        id_route: '$route$'
        id_target: '$target$'
        body: @{} msg: 'a test pkt'
        meta: @{} kind: '$meta$'

    expect(pkt).to.have.lengthOf(58)
    expect(pkt[0]).to.equal(58)
    expect(pkt[1]).to.equal(0)
    expect @ pkt.slice(2).toString()
    .to.be.equal @
      '$route$ $target$\t@{"kind":"$meta$"}\t{"msg":"a test pkt"}'


  it @ `bin_len unpackPacket with json body and meta`, @=>> ::
    const pkt = bin_len.unpackPacket @
      Buffer.concat @#
        Buffer @# 58, 0
        Buffer.from @
          '$route$ $target$\t@{"kind":"$meta$"}\t{"msg":"a test pkt"}'

    expect(pkt.id_route).to.be.equal('$route$')
    expect(pkt.id_target).to.be.equal('$target$')

    expect(pkt._hdr_).to.have.lengthOf(2)
    expect(pkt._hdr_[0]).to.be.equal('$route$')
    expect(pkt._hdr_[1]).to.be.equal('$target$')

    expect @
      Buffer.compare @ pkt._body_,
        Buffer.from @ '{"msg":"a test pkt"}'
    .to.equal(0)
    expect(pkt.json()).to.be.deep.equal @:
      msg: "a test pkt"

    expect(pkt._meta_).to.be.equal @
      '{"kind":"$meta$"}'
    expect(pkt.meta()).to.be.deep.equal @:
      kind: "$meta$"
