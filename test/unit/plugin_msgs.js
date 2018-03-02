import { Hub, expect, newLog } from './_setup'

describe @ 'Plugin msgs', @=> ::
  var log, test_chan
  beforeEach @=>> ::
    log = newLog()

  it.skip @ 'todo', @=>> ::
