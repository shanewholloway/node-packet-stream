import pkg from './package.json'
import {minify} from 'uglify-es'
import rpi_jsy from 'rollup-plugin-jsy-babel'
import rpi_uglify from 'rollup-plugin-uglify'

const sourcemap = 'inline'
const plugins = [rpi_jsy()]

const ugly = { warnings: true, output: {comments: false, max_line_len: 256}}
const prod_plugins = plugins.concat([rpi_uglify(ugly, minify)])

export default [].concat(
  package_core(),
  package_plugin_pkt(),
  package_plugin_net(),
  package_plugin_router(),
)


function package_core() {
  const external = []

  return [
    { input: 'code/index.jsy',
      output: { file: pkg.module, format: 'es', sourcemap },
      external, plugins },

    { input: 'code/index.nodejs.jsy',
      output: { file: pkg.main, format: 'cjs', sourcemap },
      external: ['crypto', 'url'], plugins },

    { input: 'code/index.browser.jsy',
      output: { file: pkg.browser, name:'msg_fabric', format: 'umd', sourcemap },
      external, plugins: prod_plugins },
  ]}


function package_plugin_pkt() {
  return [
    { input: 'code/plugins/pkt/index.jsy',
      output: [
        { file: `dist/plugin-pkt-all.js`, format: 'cjs', sourcemap, exports: 'named'  },
        { file: `dist/plugin-pkt-all.mjs`, format: 'es', sourcemap },
      ],
      external:[], plugins },

    { input: 'code/plugins/pkt/node.jsy',
      output: [
        { file: `dist/plugin-pkt-nodejs.js`, format: 'cjs', sourcemap, exports: 'named'  },
        { file: `dist/plugin-pkt-nodejs.mjs`, format: 'es', sourcemap },
      ],
      external:[], plugins },

    { input: 'code/plugins/pkt/browser.jsy',
      output: [
        { file: `dist/plugin-pkt-browser.js`, format: 'cjs', sourcemap, exports: 'named'  },
        { file: `dist/plugin-pkt-browser.mjs`, format: 'es', sourcemap },
      ],
      external:[], plugins },

    { input: 'code/plugins/pkt/browser_binary.jsy',
      output: [
        { file: `dist/plugin-pkt-browser-binary.js`, format: 'cjs', sourcemap, exports: 'named'  },
        { file: `dist/plugin-pkt-browser-binary.mjs`, format: 'es', sourcemap },
      ],
      external:[], plugins },

    { input: 'code/plugins/pkt/browser_line.jsy',
      output: [
        { file: `dist/plugin-pkt-browser-line.js`, format: 'cjs', sourcemap, exports: 'named'  },
        { file: `dist/plugin-pkt-browser-line.mjs`, format: 'es', sourcemap },
      ],
      external:[], plugins },
  ]}


function package_plugin_net() {
  return [
    { input: 'code/plugins/net/index.jsy',
      output: [
        { file: `dist/plugin-net.js`, format: 'cjs', sourcemap, exports: 'named' },
        { file: `dist/plugin-net.mjs`, format: 'es', sourcemap },
      ],
      external:['net', 'tls', 'stream'], plugins },

    { input: 'code/plugins/net/tcp.jsy',
      output: [
        { file: `dist/plugin-tcp.js`, format: 'cjs', sourcemap, exports: 'named'  },
        { file: `dist/plugin-tcp.mjs`, format: 'es', sourcemap },
      ],
      external:['net'], plugins },

    { input: 'code/plugins/net/tls.jsy',
      output: [
        { file: `dist/plugin-tls.js`, format: 'cjs', sourcemap, exports: 'named'  },
        { file: `dist/plugin-tls.mjs`, format: 'es', sourcemap },
      ],
      external:['tls'], plugins },

    { input: 'code/plugins/net/direct.jsy',
      output: [
        { file: `dist/plugin-direct.js`, format: 'cjs', sourcemap, exports: 'named'  },
        { file: `dist/plugin-direct.mjs`, format: 'es', sourcemap },
      ],
      external:['stream'], plugins },
  ]}


function package_plugin_router() {
  const external = ['msg-fabric-packet-stream']
  const external_node = external.concat(['crypto', 'url'])
  return [
    { input: 'code/plugins/router/index.jsy',
      output: [
        { file: `dist/plugin-router.js`, format: 'cjs', sourcemap, exports: 'named' },
        { file: `dist/plugin-router.mjs`, format: 'es', sourcemap },
      ],
      external: external_node, plugins },

    { input: 'code/plugins/router/basic.jsy',
      output: [
        { file: `dist/plugin-router-basic.js`, format: 'cjs', sourcemap, exports: 'named' },
        { file: `dist/plugin-router-basic.mjs`, format: 'es', sourcemap },
      ],
      external, plugins },

    { input: 'code/plugins/router/node.jsy',
      output: [
        { file: `dist/plugin-router-node.js`, format: 'cjs', sourcemap, exports: 'named' },
        { file: `dist/plugin-router-node.mjs`, format: 'es', sourcemap },
      ],
      external: external_node, plugins },

    { input: 'code/plugins/router/browser.jsy',
      output: [
        { file: `dist/plugin-router-browser.js`, format: 'cjs', sourcemap, exports: 'named' },
        { file: `dist/plugin-router-browser.mjs`, format: 'es', sourcemap },
      ],
      external, plugins },
  ]}

