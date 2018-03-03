import { Hub, expect } from '../_setup'

describe @ 'Plugin platform', @=> ::

  function has_data_utils(host) ::
    expect(host.data_utils).to.not.be.undefined

    expect(host.data_utils.random).to.be.a('function')
    expect(host.data_utils.random_base64).to.be.a('function')
    expect(host.data_utils.parse_url).to.be.a('function')
    expect(host.data_utils.pack_base64).to.be.a('function')
    expect(host.data_utils.unpack_base64).to.be.a('function')
    expect(host.data_utils.decode_utf8).to.be.a('function')
    expect(host.data_utils.encode_utf8).to.be.a('function')
    expect(host.data_utils.as_data).to.be.a('function')
    expect(host.data_utils.concat_data).to.be.a('function')


  it @ 'hub.data_utils members', @=>> ::
    const hub = Hub.create()
    has_data_utils(hub)

  it @ 'hub.local members', @=>> ::
    const hub = Hub.create()
    has_data_utils(hub.local)

  it @ 'hub.p2p members', @=>> ::
    const hub = Hub.create()
    has_data_utils(hub.p2p)

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
