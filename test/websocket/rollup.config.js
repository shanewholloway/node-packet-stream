import rpi_resolve from 'rollup-plugin-node-resolve'
import rpi_commonjs from 'rollup-plugin-commonjs'
import rpi_jsy from 'rollup-plugin-jsy-lite'

const sourcemap = 'inline'
const test_plugins = [
  rpi_resolve({ module: true, main: true }),
  rpi_commonjs({ include: 'node_modules/**'}),
]

const plugins_nodejs = [ rpi_jsy({defines: {PLAT_NODEJS: true}}) ].concat(test_plugins)
const plugins_web = [ rpi_jsy({defines: {PLAT_WEB: true}}) ].concat(test_plugins)


export default [
  { input: '../browser.hub.js', plugins: plugins_web,
    output: { file: `umd/browser.js`, format: 'umd', name: 'msg-fabric-core', sourcemap } },

  { input: 'websocket-WS.jsy', plugins: plugins_nodejs,
    output: { file: `cjs/websocket-WS.js`, format: 'cjs', sourcemap } },

  { input: 'websocket-FAYE.jsy', plugins: plugins_nodejs,
    output: { file: `cjs/websocket-FAYE.js`, format: 'cjs', sourcemap } },

].filter(Boolean)
