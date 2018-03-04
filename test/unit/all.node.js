import test_net from './plugins/net'
import test_web_node from './plugins/web_node'

describe @ 'NodeJS Plugins', @=> ::
  describe @ 'net', test_net
  describe @ 'web (node side)', test_web_node
