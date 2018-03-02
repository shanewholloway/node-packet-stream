import { Hub, expect } from './_setup'

describe @ 'Plugin platform', @=> ::
  it @ 'data_utils members', @=>> ::
    const hub = Hub.create()

    expect(hub.data_utils.random).to.be.a('function')
    expect(hub.data_utils.random_base64).to.be.a('function')
    expect(hub.data_utils.parse_url).to.be.a('function')
    expect(hub.data_utils.pack_base64).to.be.a('function')
    expect(hub.data_utils.unpack_base64).to.be.a('function')
    expect(hub.data_utils.decode_utf8).to.be.a('function')
    expect(hub.data_utils.encode_utf8).to.be.a('function')
    expect(hub.data_utils.as_data).to.be.a('function')
    expect(hub.data_utils.concat_data).to.be.a('function')

  it @ 'data_utils.url', @=>> ::
    const hub = Hub.create()

    const href = 'https://some-host:1234/a/b/c?s=123#neat'
    const url = hub.data_utils.parse_url(href)

    expect(url.href).to.equal @ href
    expect(url.protocol).to.equal @ 'https:'
    expect(url.host).to.equal @ 'some-host:1234'
    expect(url.hostname).to.equal @ 'some-host'
    expect(url.port).to.equal @ '1234'
    expect(url.pathname).to.equal @ '/a/b/c'
    expect(url.search).to.equal @ '?s=123'
    expect(url.hash).to.equal @ '#neat'
