import { Hub, expect } from './_setup'

it @ 'smoke', @=>> :: 
  expect(Hub).to.be.a @ 'function'
  expect(Hub.create).to.be.a @ 'function'
