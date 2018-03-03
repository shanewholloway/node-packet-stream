import { Hub, expect, newLog } from '../_setup'

export default function () ::
  let line
  before @=> :: line = Hub.create()._pkts_.line

  it @ 'line packPacket with binary body', @=>> ::
    expect @
      line.packPacket @:
        id_route: '$route$'
        id_target: '$target$'
        body: new Uint8Array @# 1,2,3,4

    .to.be.equal @
      '$route$ $target$\t=\tAQIDBA=='


  it @ 'line unpackPacket with binary body', @=>> ::
    const pkt = line.unpackPacket @
      '$route$ $target$\t=\tAQIDBA=='

    expect(pkt.id_route).to.be.equal('$route$')
    expect(pkt.id_target).to.be.equal('$target$')

    expect(pkt._hdr_).to.have.lengthOf(2)
    expect(pkt._hdr_[0]).to.be.equal('$route$')
    expect(pkt._hdr_[1]).to.be.equal('$target$')

    expect(pkt._body_).to.be.equal('AQIDBA==')
    expect @ Array.from @ pkt.buffer()
    .to.be.deep.equal @# 1,2,3,4

    expect(pkt._meta_).to.be.equal('')
    expect(pkt.meta()).to.be.equal(null)


  it @ 'line packPacket with binary body and meta', @=>> ::
    expect @
      line.packPacket @:
        id_route: '$route$'
        id_target: '$target$'
        body: new Uint8Array @# 1,2,3,4
        meta: @{} kind: '$meta$'

    .to.be.equal @
      '$route$ $target$\t={"kind":"$meta$"}\tAQIDBA=='


  it @ 'line unpackPacket with binary body and meta', @=>> ::
    const pkt = line.unpackPacket @
      '$route$ $target$\t={"kind":"$meta$"}\tAQIDBA=='

    expect(pkt.id_route).to.be.equal('$route$')
    expect(pkt.id_target).to.be.equal('$target$')

    expect(pkt._hdr_).to.have.lengthOf(2)
    expect(pkt._hdr_[0]).to.be.equal('$route$')
    expect(pkt._hdr_[1]).to.be.equal('$target$')

    expect(pkt._body_).to.be.equal('AQIDBA==')
    expect @ Array.from @ pkt.buffer()
    .to.be.deep.equal @# 1,2,3,4

    expect(pkt._meta_).to.be.equal @
      '{"kind":"$meta$"}'
    expect(pkt.meta()).to.be.deep.equal @:
      kind: "$meta$"
