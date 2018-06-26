import pkg from './package.json'
import {minify} from 'uglify-es'
import {uglify as rpi_uglify} from 'rollup-plugin-uglify'
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
  package_plugin_msgs(),
  package_plugin_shadow(),
  package_plugin_direct(),
  package_plugin_net(),
  package_plugin_web(),
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
      external: ['crypto', 'url', 'stream'], plugins },

    { input: 'code/index.browser.jsy',
      output: [
        { file: 'cjs/core-browser.js', format: 'cjs', sourcemap },
        { file: 'esm/core-browser.js', format: 'es', sourcemap },
        { file: 'umd/msg-fabric-core.js', format: 'umd', sourcemap, name:'msg-fabric-core' },
        { file: 'test/manual/browser.umd.js', format: 'umd', sourcemap, name:'msg-fabric-core' },
      ],
      external: [], plugins },

    prod_plugins &&
      { input: 'code/index.browser.jsy',
        output: [
          { file: pkg.browser, format: 'umd', name:'msg-fabric-core' },
        ],
        external: [], plugins: prod_plugins },

  ]}


function package_plugin_platform() {
  const external_node=['crypto', 'url']
  const bundles = {
    'index': ['plugin-platform-all', external_node, {exports: 'named'}],
    'node': ['plugin-platform-node', external_node],
    'browser': ['plugin-platform-browser', []],
  }

  return bundleForPlugin(bundles, 'platform') }


function package_plugin_pkt() {
  const bundles = {
    'index': ['plugin-pkt-all', [], {exports: 'named'}],
    'node': ['plugin-pkt-node', []],
    'browser': ['plugin-pkt-browser', []],
    'browser_line': ['plugin-pkt-browser-line', []],
  }

  return bundleForPlugin(bundles, 'pkt') }


function package_plugin_msgs() {
  const bundles = {
    'index': ['plugin-msgs-all', ['stream'], {exports: 'named'}],
    'node': ['plugin-msgs-node', ['stream']],
    'plugin': ['plugin-msgs', []],
  }

  return bundleForPlugin(bundles, 'msgs') }


function package_plugin_shadow() {
  const bundles = {
    'index': ['plugin-shadow', []],
  }

  return bundleForPlugin(bundles, 'shadow') }


function package_plugin_direct() {
  const bundles = {
    'index': ['plugin-js-direct-all', [], {exports: 'named'}],
    'direct': ['plugin-js-direct', []],
  }

  return bundleForPlugin(bundles, 'direct') }


function package_plugin_net() {
  const bundles = {
    'index': ['plugin-net-all', ['net', 'tls', 'stream'], {exports: 'named'}],
    'tcp': ['plugin-net-tcp', ['net']],
    'tls': ['plugin-net-tls', ['tls']],
    'direct': ['plugin-net-direct', ['stream']],
  }

  return bundleForPlugin(bundles, 'net') }


function package_plugin_web() {
  const bundles = {
    'index': ['plugin-web-all', [], {exports: 'named'}],
    'web': ['plugin-web', []],
  }

  return bundleForPlugin(bundles, 'web') }



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
