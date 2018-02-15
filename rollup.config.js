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
      output: [
        { file: 'dist/esm/index.js', format: 'es', sourcemap },
        { file: 'dist/cjs/index.js', format: 'cjs', sourcemap, exports: 'named' },
      ],
      external, plugins },

    { input: 'code/index.nodejs.jsy',
      output: { file: pkg.main, format: 'cjs', sourcemap },
      external: ['crypto', 'url'], plugins },

    { input: 'code/index.browser.jsy',
      output: { file: pkg.browser, name:'msg_fabric_core', format: 'umd', sourcemap },
      external, plugins: prod_plugins },
  ]}


function package_plugin_pkt() {
  const external = []
  const bundles = {
    'index': ['plugin-pkt-all', external],
    'node': ['plugin-pkt-nodejs', external],
    'browser': ['plugin-pkt-browser', external],
    'browser_binary': ['plugin-pkt-browser-binary', external],
    'browser_line': ['plugin-pkt-browser-line', external],
  }

  return Object.entries(bundles).map(bundleForPlugin('pkt')) }


function package_plugin_net() {
  const external=[], external_node=['crypto', 'url']
  const bundles = {
    'index': ['plugin-net-all', ['net', 'tls', 'stream']],
    'tcp': ['plugin-tcp', ['net']],
    'tls': ['plugin-tls', ['tls']],
    'direct': ['plugin-direct', ['stream']],
  }

  return Object.entries(bundles).map(bundleForPlugin('net')) }


function package_plugin_router() {
  const external=[], external_node=['crypto', 'url']
  const bundles = {
    'index': ['plugin-router', external_node],
    'basic': ['plugin-router-basic', external],
    'node': ['plugin-router-node', external_node],
    'browser': ['plugin-router-browser', external],
  }

  return Object.entries(bundles).map(bundleForPlugin('router')) }



function bundleForPlugin(plugin_name) {
  return ([name, [out, external]]) => (
    { input: `code/plugins/${plugin_name}/${name}.jsy`,
      output: [
        { file: `dist/cjs/${out}.js`, format: 'cjs', sourcemap, exports: 'named'  },
        { file: `dist/esm/${out}.js`, format: 'es', sourcemap },
      ],
      external, plugins } )}
