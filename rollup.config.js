import pkg from './package.json'
import {minify} from 'uglify-es'
import rpi_uglify from 'rollup-plugin-uglify'
import rpi_gzip from "rollup-plugin-gzip"
import rpi_jsy from 'rollup-plugin-jsy-babel'


const sourcemap = 'inline'
const plugins = [rpi_jsy()]

const ugly = { warnings: true, output: {comments: false, max_line_len: 256}}
const prod_plugins = plugins.concat([
  rpi_uglify(ugly, minify),
  rpi_gzip({ options: {level: 9 } }),
])

export default [].concat(
  package_core(),
  package_plugin_platform(),
  package_plugin_pkt(),
  package_plugin_net(),
  package_plugin_msgs()
).filter(e => e)


function package_core() {
  return [
    { input: 'code/index.jsy',
      output: [
        { file: 'esm/index.js', format: 'es', sourcemap },
        { file: 'cjs/index.js', format: 'cjs', sourcemap, exports: 'named' },
      ],
      external: [], plugins },

    { input: 'code/index.node.jsy',
      output: [
        { file: pkg.module, format: 'es', sourcemap },
        { file: pkg.main, format: 'cjs', sourcemap },
      ],
      external: ['crypto', 'url'], plugins },

    { input: 'code/index.browser.jsy',
      output: 
        { file: 'esm/msg-fabric-core-browser', format: 'es', sourcemap },
      external: [], plugins },

    prod_plugins &&
      { input: 'code/index.browser.jsy',
        output: [
          { file: pkg.browser, name:'msg-fabric-core', format: 'umd', sourcemap },
        ],
        external: [], plugins: prod_plugins },
  ]}


function package_plugin_pkt() {
  const external = []
  const bundles = {
    'index': ['plugin-pkt-all', external],
    'node': ['plugin-pkt-node', external],
    'browser': ['plugin-pkt-browser', external],
    'browser_binary': ['plugin-pkt-browser-binary', external],
    'browser_line': ['plugin-pkt-browser-line', external],
  }

  return Object.entries(bundles).map(bundleForPlugin('pkt')) }


function package_plugin_platform() {
  const external=[], external_node=['crypto', 'url']
  const bundles = {
    'index': ['plugin-platform-all', external_node],
    'node': ['plugin-platform-node', external_node],
    'browser': ['plugin-platform-browser', external],
  }

  return Object.entries(bundles).map(bundleForPlugin('platform')) }


function package_plugin_net() {
  const external=[], external_node=['crypto', 'url']
  const bundles = {
    'index': ['plugin-net-all', ['net', 'tls', 'stream']],
    'tcp': ['plugin-net-tcp', ['net']],
    'tls': ['plugin-net-tls', ['tls']],
    'direct': ['plugin-net-direct', ['stream']],
  }

  return Object.entries(bundles).map(bundleForPlugin('net')) }


function package_plugin_msgs() {
  const external=[]
  const bundles = {
    'index': ['plugin-msgs-all', external],
    'plugin': ['plugin-msgs', external],
  }

  return Object.entries(bundles).map(bundleForPlugin('msgs')) }



function bundleForPlugin(plugin_name) {
  return ([filename, [out, external]]) => (
    { input: `plugins/${plugin_name}/${filename}.jsy`,
      output: [
        { file: `cjs/${out}.js`, format: 'cjs', sourcemap, exports: 'named'  },
        { file: `esm/${out}.js`, format: 'es', sourcemap },
      ],
      external, plugins } )}
