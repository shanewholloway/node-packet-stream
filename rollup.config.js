import pkg from './package.json'
import {minify} from 'uglify-es'
import rpi_uglify from 'rollup-plugin-uglify'
import rpi_gzip from "rollup-plugin-gzip"
import rpi_resolve from 'rollup-plugin-node-resolve'
import rpi_jsy from 'rollup-plugin-jsy-babel'


const sourcemap = 'inline'
const plugins = [rpi_jsy()]
const test_plugins = plugins.concat([ rpi_resolve({ module: true }) ])

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
        { file: 'esm/core-node.js', format: 'es', sourcemap },
        { file: pkg.module, format: 'es', sourcemap },
        { file: pkg.main, format: 'cjs', sourcemap },
      ],
      external: ['crypto', 'url'], plugins },

    { input: 'code/index.browser.jsy',
      output: [
        { file: 'cjs/core-browser.js', format: 'cjs', sourcemap },
        { file: 'esm/core-browser.js', format: 'es', sourcemap },
        { file: 'umd/msg-fabric-core.js', format: 'umd', sourcemap, name:'msg-fabric-core' },
      ],
      external: [], plugins },

    prod_plugins &&
      { input: 'code/index.browser.jsy',
        output: [
          { file: pkg.browser, format: 'umd', name:'msg-fabric-core' },
        ],
        external: [], plugins: prod_plugins },

    { input: 'test/unittest/browser.js',
      output: {
        file: 'test/unittest/browser.iife.js',
        format: 'iife', sourcemap },
      external: [], plugins: test_plugins },

  ]}


function package_plugin_pkt() {
  const external = []
  const bundles = {
    'index': ['plugin-pkt-all', external, {exports: 'named'}],
    'node': ['plugin-pkt-node', external],
    'browser': ['plugin-pkt-browser', external],
    'browser_line': ['plugin-pkt-browser-line', external],
  }

  return bundleForPlugin(bundles, 'pkt') }


function package_plugin_platform() {
  const external=[], external_node=['crypto', 'url']
  const bundles = {
    'index': ['plugin-platform-all', external_node, {exports: 'named'}],
    'node': ['plugin-platform-node', external_node],
    'browser': ['plugin-platform-browser', external],
  }

  return bundleForPlugin(bundles, 'platform') }


function package_plugin_net() {
  const external=[], external_node=['crypto', 'url']
  const bundles = {
    'index': ['plugin-net-all', ['net', 'tls', 'stream'], {exports: 'named'}],
    'tcp': ['plugin-net-tcp', ['net']],
    'tls': ['plugin-net-tls', ['tls']],
    'direct': ['plugin-net-direct', ['stream']],
  }

  return bundleForPlugin(bundles, 'net') }


function package_plugin_msgs() {
  const external=[]
  const bundles = {
    'index': ['plugin-msgs-all', external, {exports: 'named'}],
    'plugin': ['plugin-msgs', external],
  }

  return bundleForPlugin(bundles, 'msgs') }



function bundleForPlugin(bundles, plugin_name) {
  const as_bundle = (filename, out, external, {exports}) => (
    { input: `plugins/${plugin_name}/${filename}.jsy`,
      output: [
        { file: `cjs/${out}.js`, format: 'cjs', sourcemap, exports },
        { file: `esm/${out}.js`, format: 'es', sourcemap },
      ],
      external, plugins } )

  return Object.entries(bundles)
    .map(([filename, [out, external, kw]]) =>
      as_bundle( filename, out, external||[], kw||{} ) )}
