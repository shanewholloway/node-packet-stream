export const sym_sampi = '\u03E0' // 'Ϡ'

var Hub
export { Hub }
export function _init(FabricHub) :: Hub = FabricHub

const chai = require('chai')

import chaiAsPromised from 'chai-as-promised'
chai.use @ chaiAsPromised

export const assert = chai.assert
export const expect = chai.expect

export function newLog() ::
  const _log = []
  const log = (...args) =>
    _log.push @ 1 === args.length
      ? args[0] : args

  log.calls = _log
  return log
