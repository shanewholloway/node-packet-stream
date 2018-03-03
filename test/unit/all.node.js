import test_net from './plugin/net'
import test_web_node from './plugin/web_node'

describe @ 'NodeJS Plugins', @=> ::
  describe @ 'net', test_net
  describe @ 'web (node side)', test_web_node
