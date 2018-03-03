import { Hub, expect, newLog } from '../_setup'

import pkts_json from './pkt_json'
import pkts_line_binary from './pkt_line_binary'
import pkts_call_binary from './pkt_call_binary'

import pkts_len_json from './pkt_len_json'
import pkts_len_binary from './pkt_len_binary'

describe @ 'Plugin pkt', @=> ::

  describe @ '_pkts_ api', @=> ::
    let hub
    before @=> :: hub = Hub.create()

    it @ '_pkts_ api', @=>> ::
      expect(hub._pkts_).to.not.be.undefined
      has_bin_pkts_api @ hub._pkts_

    it @ '_pkts_.line api', @=>> ::
      expect(hub._pkts_.line).to.not.be.undefined
      has_line_pkts_api @ hub._pkts_.line

    it @ '_pkts_.bin_call api', @=>> ::
      expect(hub._pkts_.bin_call).to.not.be.undefined
      has_bin_pkts_api @ hub._pkts_.bin_call

    it @ '_pkts_.bin_len api', @=>> ::
      if 'undefined' === typeof window ::
        expect(hub._pkts_.bin_len).to.not.be.undefined
        has_bin_pkts_api @ hub._pkts_.bin_len

      else if undefined !== hub._pkts_.bin_len ::
        has_bin_pkts_api @ hub._pkts_.bin_len


    function has_bin_pkts_api(pkts) ::
      has_base_pkts_api(pkts)
      expect(pkts.packBinaryPacket).to.be.a('function')
      expect(pkts.fromObjBinaryPacket).to.be.a('function')
      expect(pkts.unpackBinaryPacket).to.be.a('function')

    function has_line_pkts_api(pkts) ::
      has_base_pkts_api(pkts)
      expect(pkts.fromObjLinePacket).to.be.a('function')
      expect(pkts.unpackLinePacket).to.be.a('function')
      expect(pkts.packLinePacket).to.be.a('function')

    function has_base_pkts_api(pkts) ::
      expect(pkts.unpackPacket).to.be.a('function')
      expect(pkts.packPacket).to.be.a('function')
      expect(pkts.createChannel).to.be.a('function')


  describe @ '_pkts_.line', @=> ::
    describe @ 'json', @=> pkts_json('line')
    describe @ 'binary', pkts_line_binary

  describe @ '_pkts_.bin_call', @=> ::
    describe @ 'json', @=> pkts_json('bin_call')
    describe @ 'binary', pkts_call_binary

  if 'undefined' === typeof window ::
    describe @ '_pkts_.bin_len', @=> ::
      describe @ 'json', pkts_len_json
      describe @ 'binary', pkts_len_binary
