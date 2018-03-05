import test_net from './plugins/net'
import test_web_node from './plugins/web_node'
import test_msgs_streaming_node from './plugins/msgs_streaming_node'

describe @ 'NodeJS Plugins', @=> ::
  describe @ 'msgs streaming with NodeJS', test_msgs_streaming_node
  describe @ 'net', test_net
  describe @ 'web (node side)', test_web_node

