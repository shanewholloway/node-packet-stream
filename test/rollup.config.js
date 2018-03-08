import rpi_resolve from 'rollup-plugin-node-resolve'
import rpi_commonjs from 'rollup-plugin-commonjs'
import rpi_jsy from 'rollup-plugin-jsy-babel'


const sourcemap = 'inline'
const plugins = [rpi_jsy()]
const test_plugins = plugins.concat([
  rpi_resolve({ module: true, main: true }),
  rpi_commonjs({ include: 'node_modules/**'}),
])

export default [
    { input: './unittest/browser.hub.js',
      output: {
        file: './unittest/browser.hub.umd.js',
        format: 'umd', name:'MsgFabricTestHub', sourcemap },
      external: [], plugins: test_plugins },

    { input: './unittest/browser.js',
      output: {
        file: './unittest/browser.iife.js',
        format: 'iife', sourcemap },
      external: [], plugins: test_plugins },

].filter(e => e)
