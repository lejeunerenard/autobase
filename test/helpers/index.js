const Corestore = require('corestore')
const ram = require('random-access-memory')

const Autobase = require('../..')

async function create (n, opts = {}) {
  const store = new Corestore(ram)
  const bases = []
  for (let i = 0; i < n; i++) {
    bases.push(new Autobase(store.namespace('base-' + i), opts.opts))
  }
  await Promise.all(bases.map(b => b.ready()))
  if (opts.noInputs === true) return bases
  for (let i = 0; i < n; i++) {
    const batch = bases[i].memberBatch()
    for (let j = 0; j < n; j++) {
      batch.addInput(bases[j].localInputKey)
    }
    await batch.commit()
  }
  if (opts.view) {
    if (opts.view.localOnly) {
      for (let i = 0; i < n; i++) {
        console.log('ADDING OUTPUT HERE')
        await bases[i].addOutput(bases[i].localOutputKey)
      }
    }
  }
  return bases
}

async function causalValues (base, clock) {
  return collect(base.createCausalStream({ clock }))
}

async function collect (stream, map) {
  const buf = []
  for await (const node of stream) {
    buf.push(map ? map(node) : node)
  }
  return buf
}

async function linearizedValues (index, opts = {}) {
  const buf = []
  if (opts.update !== false) await index.update()
  for (let i = index.length - 1; i >= 0; i--) {
    const indexNode = await index.get(i)
    buf.push(indexNode)
  }
  return buf
}

function debugInputNode (inputNode) {
  if (!inputNode) return null
  return {
    ...inputNode,
    key: inputNode.id,
    value: inputNode.value.toString()
  }
}

function bufferize (arr) {
  return arr.map(b => Buffer.from(b))
}

module.exports = {
  create,
  bufferize,
  collect,
  causalValues,
  linearizedValues,
  debugInputNode
}
