const chai = require('chai')
export const assert = chai.assert
export const expect = chai.expect

export function newLog() ::
  const _log = []
  const log = (...args) =>
    _log.push @ 1 === args.length
      ? args[0] : args

  log.calls = _log
  return log
