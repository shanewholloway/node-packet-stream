
function sleep(ms, ctx) {
  return new Promise(resolve => setTimeout(resolve, ms, ctx)) }


function logSWIMEvents(swimDisco) {
  swimDisco.swim
    .on('error', err => { console.log('swim error', err) })
    .on('ready', () => { console.log('swim ready') })

  dumpTableEverySoOften(swimDisco)
  return swimDisco
}

function dumpTableEverySoOften(swimDisco) {
  setTimeout(dumpTable, 1000)
  setInterval(dumpTable, 15000)
  return dumpTable

  function dumpTable() {
    console.log('\nbyId table:')
    console.dir(Array.from(swimDisco.byId.values()), {colors: true})
    console.log('\n')
  }
}

module.exports = exports = {
  sleep, 
  logSWIMEvents,
  dumpTableEverySoOften,
}
