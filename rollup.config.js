import rpi_resolve from 'rollup-plugin-node-resolve'
import rpi_jsy from 'rollup-plugin-jsy-lite'

import pkg from './package.json'
const pkg_name = pkg.name.replace('-', '_')

const configs = []
export default configs

const sourcemap = true

const plugins_base = [ rpi_resolve({ modulesOnly: true }) ]
const plugins_generic = [ rpi_jsy() ].concat(plugins_base)
const plugins_nodejs = [ rpi_jsy({defines: {PLAT_NODEJS: true}}) ].concat(plugins_base)
const plugins_web = [ rpi_jsy({defines: {PLAT_WEB: true}}) ].concat(plugins_base)

import { terser as rpi_terser } from 'rollup-plugin-terser'
const min_plugins = true
const plugins_min = plugins_web.concat([ rpi_terser({}) ])


add_core_jsy('all', null)
add_core_jsy('core', true, {module_name: pkg_name})
add_core_jsy('index', true, {module_name: pkg_name})

pi_standard()
pi_cbor()
//pi_shadow()

pi_direct()
pi_net()
pi_web()


function pi_standard() {
  add_plugin_jsy('standard/all', 'plugin-standard-all', {exports: 'named'})
  add_plugin_jsy('standard/index', 'plugin-standard', {})
}

function pi_cbor() {
  add_plugin_jsy('cbor/all', 'plugin-cbor-all', {exports: 'named'})
  add_plugin_jsy('cbor/index', 'plugin-cbor', {})
}

function pi_shadow() {
  add_plugin_jsy('shadow/index', 'plugin-shadow', {})
}

function pi_direct() {
  add_plugin_jsy('direct/all', 'plugin-direct-all', {exports: 'named'})
  add_plugin_jsy('direct/index', 'plugin-direct', {})
}
function pi_net() {
  const external_nodejs = ['net', 'tls', 'stream']

  add_plugin_jsy('net/index', 'plugin-net-all', {plat_web: false, external_nodejs, exports: 'named'})
  add_plugin_jsy('net/tcp', 'plugin-net-tcp', {plat_web: false, external_nodejs})
  add_plugin_jsy('net/tls', 'plugin-net-tls', {plat_web: false, external_nodejs})
  add_plugin_jsy('net/direct', 'plugin-net-direct', {plat_web: false, external_nodejs})
}
function pi_web() {
  add_plugin_jsy('web/all', 'plugin-web-all', {exports: 'named'})
  add_plugin_jsy('web/basic', 'plugin-web-basic', {exports: 'default'})
  add_plugin_jsy('web/index', 'plugin-web', {exports: 'default'})
}




function add_core_jsy(src_name, inc_min, kw) {
  return _add_jsy('code', src_name, src_name, inc_min, kw) }
function add_plugin_jsy(src_name, module_name, kw) {
  const out_name = kw.out_name || ('plugin-'+src_name.replace(/\//g,'-')).replace('-index', '')
  return _add_jsy('plugins', src_name, out_name, min_plugins, {module_name, ... kw}) }

function _add_jsy(src_root, src_name, out_name, inc_min, {module_name, plat_nodejs, plat_web, exports, external, external_nodejs, external_web}={}) {
  if (null == plat_nodejs) plat_nodejs = true
  if (null == plat_web) plat_web = ! src_name.endsWith('/all')

  if (null == external) external = []
  if (null == external_web) external_web = external.concat([])
  if (null == external_nodejs) external_nodejs = external.concat(['url', 'crypto', 'stream', 'net', 'tls'])

  if (plat_nodejs && plugins_nodejs)
    configs.push({
      input: `${src_root}/${src_name}.jsy`,
      plugins: plugins_nodejs, external: external_nodejs,
      output: [
        null !== inc_min &&
          { file: `cjs/${out_name}.js`, format: 'cjs', exports, sourcemap },
        { file: `esm/${out_name}.js`, format: 'es', sourcemap },
      ].filter(Boolean)})

  if (plat_web && plugins_web)
    configs.push({
      input: `${src_root}/${src_name}.jsy`,
      plugins: plugins_web, external: external_web,
      output: [
        null !== inc_min &&
          { file: `umd/${out_name}${inc_min ? '.dbg' : ''}.js`, format: 'umd', name:module_name, exports, sourcemap },
        { file: `esm/web/${out_name}.js`, format: 'es', sourcemap },
      ].filter(Boolean)})

  if (plat_web && inc_min && 'undefined' !== typeof plugins_min)
    configs.push({
      input: `${src_root}/${src_name}.jsy`,
      plugins: plugins_min, external: external_web,
      output: { file: `umd/${out_name}.min.js`, format: 'umd', name:module_name, exports }})
}

