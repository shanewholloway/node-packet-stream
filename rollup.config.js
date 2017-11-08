import rpi_babel from 'rollup-plugin-babel'
import rpi_resolve from 'rollup-plugin-node-resolve'

const sourcemap = 'inline'

const pi_resolve_es6 = rpi_resolve({module: true, jsnext: true})
const plugins = [jsy_plugin()]

export default [].concat(
  package_core(),
  package_plugin_net(),
  package_plugin_router(),
)


function package_core() {
  const external = []

  return [
    { input: 'code/index.jsy',
      output: [
        { file: `dist/index.js`, format: 'cjs', exports: 'named' },
        { file: `dist/index.mjs`, format: 'es' },
      ],
      sourcemap, external, plugins },

    { input: 'code/index.jsy',
      name: 'msg-fabric-core',
      output: [{ file: `dist/index.umd.js`, format: 'umd', exports: 'named' }],
      sourcemap, external, plugins },
  ]}


function package_plugin_net() {
  return [
    { input: 'code/plugins/net/index.jsy',
      output: [
        { file: `dist/plugin-net.js`, format: 'cjs', exports: 'named' },
        { file: `dist/plugin-net.mjs`, format: 'es' },
      ],
      sourcemap, external:['net', 'tls'], plugins },

    { input: 'code/plugins/net/tcp.jsy',
      output: [
        { file: `dist/plugin-tcp.js`, format: 'cjs' },
        { file: `dist/plugin-tcp.mjs`, format: 'es' },
      ],
      sourcemap, external:['net'], plugins },

    { input: 'code/plugins/net/tls.jsy',
      output: [
        { file: `dist/plugin-tls.js`, format: 'cjs' },
        { file: `dist/plugin-tls.mjs`, format: 'es' },
      ],
      sourcemap, external:['tls'], plugins },
  ]}


function package_plugin_router() {
  const external = ['msg-fabric-packet-stream']
  const external_node = external.concat(['crypto', 'url'])
  return [
    { input: 'code/plugins/router/index.jsy',
      output: [
        { file: `dist/plugin-router.js`, format: 'cjs', exports: 'named' },
        { file: `dist/plugin-router.mjs`, format: 'es' },
      ],
      sourcemap, external: external_node, plugins },

    { input: 'code/plugins/router/basic.jsy',
      output: [
        { file: `dist/plugin-router-basic.js`, format: 'cjs', exports: 'named' },
        { file: `dist/plugin-router-basic.mjs`, format: 'es' },
      ],
      sourcemap, external, plugins },

    { input: 'code/plugins/router/node.jsy',
      output: [
        { file: `dist/plugin-router-node.js`, format: 'cjs', exports: 'named' },
        { file: `dist/plugin-router-node.mjs`, format: 'es' },
      ],
      sourcemap, external: external_node, plugins },

    { input: 'code/plugins/router/browser.jsy',
      output: [
        { file: `dist/plugin-router-browser.js`, format: 'cjs', exports: 'named' },
        { file: `dist/plugin-router-browser.mjs`, format: 'es' },
      ],
      sourcemap, external, plugins },

    { input: 'code/plugins/router/browser.jsy',
      name: 'msg-fabric-plugin-router-browser',
      output: [{ file: `dist/plugin-router-browser.umd.js`, format: 'umd', exports: 'named' }],
      sourcemap, external:[], plugins: plugins.concat([pi_resolve_es6]) },
  ]}


function jsy_plugin() {
  const jsy_preset = [ 'jsy/lean', { no_stage_3: true, modules: false } ]
  return rpi_babel({
    exclude: 'node_modules/**',
    presets: [ jsy_preset ],
    plugins: [],
    babelrc: false }) }

