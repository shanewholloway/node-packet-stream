import rpi_resolve from 'rollup-plugin-node-resolve'
import rpi_commonjs from 'rollup-plugin-commonjs'
import rpi_jsy from 'rollup-plugin-jsy-lite'


const sourcemap = 'inline'
const test_plugins = [
  rpi_resolve({ module: true, main: true }),
  rpi_commonjs({ include: 'node_modules/**'}),
]

const test_plugins_nodejs = [
  rpi_jsy({defines: {PLAT_NODEJS: true}})
].concat(test_plugins)

const test_plugins_web = [
  rpi_jsy({defines: {PLAT_WEB: true}})
].concat(test_plugins)

export default [

    { input: './browser.hub.js',
      output: {
        file: './__unittest.hub.umd.js',
        format: 'umd', name:'MsgFabricTestHub', sourcemap },
      external: [], plugins: test_plugins_web },

    { input: './unittest.jsy',
      output: {
        file: './__unittest.iife.js',
        format: 'iife', sourcemap },
      external: [], plugins: test_plugins_web },

    { input: './unittest.jsy',
      output: {
        file: './__unittest.cjs.js',
        format: 'cjs', sourcemap },
      external: ['stream', 'net', 'tls', 'zlib', 'crypto'],
      plugins: test_plugins_nodejs },

]
