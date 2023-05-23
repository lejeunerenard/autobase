const test = require('brittle')
const ram = require('random-access-memory')
const Corestore = require('corestore')
const b4a = require('b4a')

const Autobase = require('..')

const {
  create,
  sync,
  apply,
  addWriter,
  confirm,
  compare
} = require('./helpers')

test('basic - two writers', async t => {
  const [base1, base2, base3] = await create(3, apply)

  await base1.append({
    add: base2.local.key.toString('hex'),
    debug: 'this is adding b'
  })

  await confirm([base1, base2, base3])

  await base2.append({
    add: base3.local.key.toString('hex'),
    debug: 'this is adding c'
  })

  await confirm([base1, base2, base3])

  t.is(base2.system.digest.writers.length, 3)
  t.is(base2.system.digest.writers.length, base3.system.digest.writers.length)
  t.is(base2.system.digest.writers.length, base2.writers.length)
  t.is(base3.system.digest.writers.length, base3.writers.length)

  // tests skipped: fix with linearizer update - batching

  // t.alike(await base1.system.checkpoint(), await base2.system.checkpoint())
  // t.alike(await base1.system.checkpoint(), await base3.system.checkpoint())
})

test('basic - view', async t => {
  const [base] = await create(1, apply, store => store.get('test', { valueEncoding: 'json' }))

  const block = { message: 'hello, world!' }
  await base.append(block)

  t.is(base.system.digest.writers.length, 1)
  t.is(base.view.indexedLength, 1)
  t.alike(await base.view.get(0), block)
})

test('basic - view with close', async t => {
  const [base] = await create(1, apply, open, close)

  const block = { message: 'hello, world!' }
  await base.append(block)

  t.is(base.system.digest.writers.length, 1)
  t.is(base.view.core.indexedLength, 1)
  t.alike(await base.view.core.get(0), block)

  t.is(base.view.lastBlock, null)
  await base.close()
  t.is(base.view.lastBlock.message, 'hello, world!')

  function open (store) {
    const core = store.get('test', { valueEncoding: 'json' })
    return {
      core,
      lastBlock: null,
      append: v => core.append(v)
    }
  }

  async function close (view) {
    view.lastBlock = await view.core.get(view.core.length - 1)
    await view.core.close()
  }
})

test('basic - view/writer userdata is set', async t => {
  const bases = await create(2, apply, store => store.get('test', { valueEncoding: 'json' }))
  const [base1, base2] = bases

  await base1.append({ add: base2.local.key.toString('hex') })

  await confirm(bases)

  await verifyUserData(base1)
  await verifyUserData(base2)

  async function verifyUserData (base) {
    const viewData = await Autobase.getUserData(base.view.core.core)
    const systemData = await Autobase.getUserData(base.system.core)

    t.alike(systemData.referrer, base.bootstraps[0])
    t.alike(viewData.referrer, base.bootstraps[0])
    t.is(viewData.view, 'test')

    t.is(base.writers.length, 2)
    for (const writer of base.writers) {
      const writerData = await Autobase.getUserData(writer.core)
      t.alike(writerData.referrer, base.bootstraps[0])
    }
  }
})

test('basic - compare views', async t => {
  const bases = await create(2, apply, store => store.get('test', { valueEncoding: 'json' }))

  const [a, b] = bases
  await a.append({ add: b.local.key.toString('hex') })

  await confirm(bases)

  for (let i = 0; i < 6; i++) await bases[i % 2].append('msg' + i)

  await confirm(bases)

  t.is(a.system.digest.writers.length, b.system.digest.writers.length)
  t.is(a.view.indexedLength, b.view.indexedLength)

  try {
    await compare(a, b)
  } catch (e) {
    t.fail(e.message)
  }
})

test('basic - online majority', async t => {
  const bases = await create(3, apply, store => store.get('test', { valueEncoding: 'json' }))

  const [a, b, c] = bases

  await a.append({ add: b.local.key.toString('hex') })
  await a.append({ add: c.local.key.toString('hex') })

  await confirm(bases)

  await a.append({ message: 'a0' })
  await b.append({ message: 'b0' })
  await c.append({ message: 'c0' })

  await confirm(bases)

  const indexed = a.view.indexedLength

  await a.append({ message: 'a1' })
  await b.append({ message: 'b1' })
  await c.append({ message: 'c1' })
  await a.append({ message: 'a2' })
  await b.append({ message: 'b2' })
  await c.append({ message: 'c2' })

  await confirm([a, b])

  t.not(a.view.indexedLength, indexed)
  t.is(c.view.indexedLength, indexed)
  t.is(a.view.indexedLength, b.view.indexedLength)

  try {
    await compare(a, b)
  } catch (e) {
    t.fail(e.message)
  }

  await sync([b, c])

  t.is(a.view.indexedLength, c.view.indexedLength)

  try {
    await compare(a, c)
  } catch (e) {
    t.fail(e.message)
  }
})

test('basic - rotating majority', async t => {
  const bases = await create(3, apply, store => store.get('test', { valueEncoding: 'json' }))

  const [a, b, c] = bases

  await a.append({ add: b.local.key.toString('hex') })
  await a.append({ add: c.local.key.toString('hex') })

  await confirm(bases)

  await a.append({ message: 'msg a' })
  await b.append({ message: 'msg b' })
  await c.append({ message: 'msg c' })

  await confirm(bases)

  let indexed = a.view.indexedLength

  await a.append({ message: 'msg a' })
  await b.append({ message: 'msg b' })
  await c.append({ message: 'msg c' })
  await a.append({ message: 'msg a' })
  await b.append({ message: 'msg b' })
  await c.append({ message: 'msg c' })

  await confirm([a, b])

  t.not(a.view.indexedLength, indexed)
  t.is(c.view.indexedLength, indexed)
  t.is(a.view.indexedLength, b.view.indexedLength)

  indexed = a.view.indexedLength

  await a.append({ message: 'msg a' })
  await b.append({ message: 'msg b' })
  await c.append({ message: 'msg c' })
  await a.append({ message: 'msg a' })
  await b.append({ message: 'msg b' })
  await c.append({ message: 'msg c' })

  await confirm([b, c])

  t.not(b.view.indexedLength, indexed)
  t.is(a.view.indexedLength, indexed)
  t.is(b.view.indexedLength, c.view.indexedLength)

  indexed = b.view.indexedLength

  await a.append({ message: 'msg a' })
  await b.append({ message: 'msg b' })
  await c.append({ message: 'msg c' })
  await a.append({ message: 'msg a' })
  await b.append({ message: 'msg b' })
  await c.append({ message: 'msg c' })

  await confirm([a, c])

  t.not(c.view.indexedLength, indexed)
  t.is(b.view.indexedLength, indexed)
  t.is(a.view.indexedLength, c.view.indexedLength)

  indexed = a.view.indexedLength

  await a.append({ message: 'msg a' })
  await b.append({ message: 'msg b' })
  await c.append({ message: 'msg c' })
  await a.append({ message: 'msg a' })
  await b.append({ message: 'msg b' })
  await c.append({ message: 'msg c' })

  await confirm(bases)

  t.not(a.view.indexedLength, indexed)
  t.is(a.view.indexedLength, b.view.indexedLength)
  t.is(a.view.indexedLength, c.view.indexedLength)

  try {
    await compare(a, b)
    await compare(a, c)
  } catch (e) {
    t.fail(e.message)
  }
})

test('basic - throws', async t => {
  const bases = await create(2, apply, store => store.get('test', { valueEncoding: 'json' }))

  const [a, b] = bases

  await a.append({ message: 'msg1' })
  await a.append({ message: 'msg2' })
  await a.append({ message: 'msg3' })

  await confirm([a, b])

  await t.exception(b.append({ message: 'not writable' }))
  await t.exception(a.view.append({ message: 'append outside apply' }))
  t.exception(() => a.system.addWriter(b.local.key))
})

test('basic - online minorities', async t => {
  const bases = await create(5, apply, store => store.get('test', { valueEncoding: 'json' }))

  const [a, b, c, d, e] = bases

  await a.append({ add: b.local.key.toString('hex') })
  await a.append({ add: c.local.key.toString('hex') })
  await a.append({ add: d.local.key.toString('hex') })
  await a.append({ add: e.local.key.toString('hex') })

  await confirm(bases)

  t.is(a.view.indexedLength, c.view.indexedLength)

  await a.append({ message: 'msg0' })
  await b.append({ message: 'msg1' })
  await c.append({ message: 'msg2' })
  await d.append({ message: 'msg3' })
  await e.append({ message: 'msg4' })
  await a.append({ message: 'msg5' })
  await b.append({ message: 'msg6' })
  await c.append({ message: 'msg7' })
  await d.append({ message: 'msg8' })
  await e.append({ message: 'msg9' })

  await a.append({ message: 'msg10' })
  await b.append({ message: 'msg11' })
  await a.append({ message: 'msg12' })
  await b.append({ message: 'msg13' })
  await a.append({ message: 'msg14' })

  await d.append({ message: 'msg15' })
  await c.append({ message: 'msg16' })
  await d.append({ message: 'msg17' })
  await c.append({ message: 'msg18' })
  await d.append({ message: 'msg19' })
  await c.append({ message: 'msg20' })
  await d.append({ message: 'msg21' })
  await c.append({ message: 'msg22' })

  await confirm([a, b])
  await confirm([c, d])

  t.is(a.view.indexedLength, b.view.indexedLength)
  t.is(c.view.indexedLength, d.view.indexedLength)

  t.not(a.view.length, a.view.indexedLength)
  t.is(a.view.length, b.view.length)
  t.not(c.view.length, a.view.length)
  t.is(c.view.length, d.view.length)

  try {
    await compare(a, b, true)
    await compare(c, d, true)
  } catch (e) {
    t.fail(e.message)
  }

  await confirm(bases)

  t.is(a.view.length, c.view.length)
  t.is(a.view.indexedLength, c.view.indexedLength)

  try {
    await compare(a, b, true)
    await compare(a, c, true)
    await compare(a, d, true)
    await compare(a, e, true)
  } catch (e) {
    t.fail(e.message)
  }
})

test('basic - restarting sets bootstrap correctly', async t => {
  const store = new Corestore(ram)

  let bootstrapKey = null
  let localKey = null

  {
    const ns = store.namespace('random-name')
    const base = new Autobase(ns, null, {})
    await base.ready()

    bootstrapKey = base.bootstraps[0]
    localKey = base.local.key
  }

  {
    const ns = store.namespace(bootstrapKey)
    const base = new Autobase(ns, [bootstrapKey], {})
    await base.ready()

    t.alike(base.bootstraps[0], bootstrapKey)
    t.alike(base.local.key, base.bootstraps[0])
    t.alike(base.local.key, localKey)
  }
})

test('batch append', async t => {
  const bases = await create(2, apply, store => store.get('test', { valueEncoding: 'json' }))

  const [a, b] = bases
  a.on('error', (e) => console.error(e))
  b.on('error', (e) => console.error(e))

  await addWriter(a, b)

  await confirm(bases)

  await a.append(['a0', 'a1'])
  await t.execution(confirm(bases))
})

test('undoing a batch', async t => {
  const bases = await create(2, apply, store => store.get('test', { valueEncoding: 'json' }))

  const [a, b] = bases
  a.on('error', (e) => console.error(e))
  b.on('error', (e) => console.error(e))

  await addWriter(a, b)

  await confirm(bases)

  await a.append('a0')
  await confirm(bases)

  await Promise.all([
    a.append('a1'),
    b.append(['b0', 'b1'])
  ])

  await t.execution(confirm(bases))
})

test('append during restart', async t => {
  const bases = await create(4, apply, store => store.get('test', { valueEncoding: 'json' }))

  const [a, b, c, d] = bases

  await addWriter(a, b)
  await addWriter(a, c)
  await addWriter(a, d)
  await sync(bases)

  t.ok(!!a.localWriter)
  t.ok(!!b.localWriter)
  t.ok(!!c.localWriter)
  t.ok(!!d.localWriter)

  await addWriter(b, d)

  const s1 = b.store.replicate(true)
  const s2 = d.store.replicate(false)

  s1.on('error', () => {})
  s2.on('error', () => {})

  s1.pipe(s2).pipe(s1)

  for (const w of d.writers) {
    if (w === d.localWriter) continue

    await w.core.update({ wait: true })
    const start = w.core.length
    const end = w.core.core.tree.length

    await w.core.download({ start, end, ifAvailable: true }).done()
  }

  await d.append('hello')

  t.is(await d.view.get(d.view.length - 1), 'hello')
})

test('closing an autobase', async t => {
  const [base] = await create(1, apply, store => store.get('test'))

  // Sanity check
  t.is(base.local.closed, false)

  await base.close()
  t.is(base.local.closed, true)
})

// test should throw for commit f41f5544dbe8743f6ad3b9886e7aa472344bc9c7 (with debug set to false)
test.skip('consistent writers', async t => {
  const bases = await create(5, apply, store => store.get('test', { valueEncoding: 'json' }))

  const [a, b, c, d, e] = bases

  await addWriter(a, b)
  await sync(bases)

  await addWriter(b, c)
  await addWriter(b, d)

  await sync(bases)

  // trigger reorg
  addWriter(a, e)

  const s1 = a.store.replicate(true)
  const s2 = d.store.replicate(false)

  s1.on('error', () => {})
  s2.on('error', () => {})

  s1.pipe(s2).pipe(s1)

  for (const w of d.writers) {
    if (w === d.localWriter) continue

    await w.core.update({ wait: true })
    const start = w.core.length
    const end = w.core.core.tree.length

    await w.core.download({ start, end, ifAvailable: true }).done()
  }

  d.debug = true
  d.update().then(() => { d.debug = false })

  t.ok(await checkWriters(d))

  async function checkWriters (b) {
    while (b.debug) {
      for (const w of b.writers) {
        for (const rem of b._removedWriters) {
          if (b4a.equals(w.core.key, rem.core.key)) return false
        }
      }

      await new Promise(resolve => setImmediate(resolve))
    }

    return true
  }
})
