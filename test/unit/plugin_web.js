import { Hub, expect, newLog } from './_setup'

describe @ 'Browser Plugin web', @=> ::
  var log, test_chan
  beforeEach @=>> ::
    log = newLog()

  it.skip @ 'todo', @=>> ::
