import { expect } from './_utils'
import { Hub } from './_setup'

describe @ 'Hub creation', @=> ::

  it @ 'new Hub', @=>> :: 
    const hub = new Hub()
    expect @ hub.local.id_route
    .to.be.a('string')

  it @ 'Hub.create', @=>> :: 
    const hub = Hub.create()
    expect @ hub.local.id_route
    .to.be.a('string')

  it @ 'new Hub with specified id_route', @=>> :: 
    const hub = new Hub('$unit$')
    expect @ hub.local.id_route
    .to.equal @ '$unit$'

  it @ 'Hub.create with specified id_route', @=>> :: 
    const hub = Hub.create('$unit$')
    expect @ hub.local.id_route
    .to.equal @ '$unit$'

  it @ 'new Hub with id_prefix', @=>> :: 
    const hub = new Hub @: id_prefix: '$unit$'
    expect @ hub.local.id_route.startsWith('$unit$')
    .to.be.true

  it @ 'Hub.create with id_prefix', @=>> :: 
    const hub = Hub.create @: id_prefix: '$unit$'
    expect @ hub.local.id_route.startsWith('$unit$')
    .to.be.true

