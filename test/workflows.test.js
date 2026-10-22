import test from 'node:test'
import assert from 'node:assert/strict'
import * as accounts from '../utils/accounts.js'

const users = [
  { userid: '123456789', token: 'test-token-one' },
  { userid: '987654321', token: 'test-token-two' },
]
let runId = 0

async function runScript(t, script, { account = 'all', action = '查看账号', disabled = [] } = {}) {
  const previousEnv = { ...process.env }
  Object.assign(process.env, {
    USERINFO: JSON.stringify(users), ACCOUNT: account, ACCOUNT_ACTION: action,
    ACCOUNT_SUMMARY: 'test-summary.md',
  })
  t.after(() => { process.env = previousEnv })
  const result = { requests: [], secrets: [], writes: [], notifications: [], logs: [], started: 0, closed: 0 }
  t.mock.module('../utils/accounts.js', {
    namedExports: { ...accounts, readAccountSettings: () => ({ disabled }) },
  })
  t.mock.module('../utils/utils.js', {
    namedExports: {
      startService: () => { result.started++; return {} },
      close_api: () => { result.closed++ },
      waitForApi: async () => {},
      delay: async () => {},
      send: async (path, method, headers) => {
        result.requests.push({ path, method, cookie: headers.cookie })
        if (path.startsWith('/user/detail')) return { data: { nickname: '测试昵称' } }
        if (path.startsWith('/login/token')) return { status: 1, data: { token: 'refreshed-test-token' } }
        if (path.startsWith('/user/vip/detail')) return { status: 1, data: { busi_vip: [{ vip_end_time: '2027-01-01' }] } }
        return { status: 1 }
      },
    },
  })
  t.mock.module('../utils/githubSecrets.js', {
    namedExports: {
      hasSecretWriteToken: () => true,
      setRepoSecret: (name, value) => result.secrets.push({ name, value: JSON.parse(value) }),
    },
  })
  t.mock.module('../utils/notify.js', {
    namedExports: { sendNotify: async (title, content) => result.notifications.push({ title, content }) },
  })
  t.mock.module('node:fs', {
    namedExports: { writeFileSync: (path, value) => result.writes.push({ path: String(path), value }) },
  })
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-25T00:00:00Z') })
  t.mock.method(console, 'log', (...args) => result.logs.push(args.join(' ')))
  t.mock.method(console, 'error', (...args) => result.logs.push(args.map(String).join(' ')))
  let exited
  const done = new Promise(resolve => { exited = resolve })
  t.mock.method(process, 'exit', exited)
  await import(`../${script}?test=${++runId}`)
  result.exitCode = await done
  return result
}

test('single-account check-in calls only account 2 and refresh saves both accounts', async t => {
  const result = await runScript(t, 'main.js', { account: '2' })
  assert.equal(result.exitCode, 0)
  assert.equal(result.started, 1)
  assert.equal(result.closed, 1)
  assert.ok(result.requests.some(request => request.path.startsWith('/youth/vip')))
  assert.ok(result.requests.every(request => request.cookie.endsWith('userid=987654321')))
  assert.ok(result.requests.filter(request => request.path.startsWith('/youth/')).every(request => request.cookie.startsWith('token=refreshed-test-token;')))
  assert.deepEqual(result.secrets, [{ name: 'USERINFO', value: [users[0], { ...users[1], token: 'refreshed-test-token' }] }])
  assert.equal(result.notifications.length, 1)
})

test('scheduled all selection skips a disabled account', async t => {
  const result = await runScript(t, 'main.js', { disabled: [accounts.accountKey(users[1])] })
  assert.equal(result.exitCode, 0)
  assert.ok(result.requests.length > 0)
  assert.ok(result.requests.every(request => request.cookie.endsWith('userid=123456789')))
  assert.deepEqual(result.secrets[0].value[1], users[1])
})

test('invalid target fails before starting API or rewriting credentials', async t => {
  const result = await runScript(t, 'main.js', { account: '3' })
  assert.equal(result.exitCode, 1)
  assert.equal(result.started, 0)
  assert.deepEqual(result.secrets, [])
})

test('all disabled exits without API calls, notifications or secret writes', async t => {
  const result = await runScript(t, 'main.js', { disabled: users.map(accounts.accountKey) })
  assert.equal(result.exitCode, 0)
  assert.equal(result.started, 0)
  assert.deepEqual(result.requests, [])
  assert.deepEqual(result.secrets, [])
  assert.deepEqual(result.notifications, [])
})

test('account list is read-only and exposes neither tokens nor full user IDs', async t => {
  const result = await runScript(t, 'accountManager.js')
  assert.equal(result.exitCode, 0)
  assert.equal(result.closed, 1)
  assert.equal(result.requests.length, 2)
  assert.ok(result.requests.every(request => request.path.startsWith('/user/detail')))
  assert.deepEqual(result.secrets, [])
  assert.equal(result.writes.length, 1)
  const summary = result.writes[0].value
  assert.match(summary, /共 2 个账号/)
  for (const user of users) {
    assert.equal(summary.includes(user.userid), false)
    assert.equal(summary.includes(user.token), false)
  }
  assert.equal(result.logs.join('\n').includes('测试昵称'), false)
})

test('disabling account 2 persists only its settings key, without API or secret writes', async t => {
  const result = await runScript(t, 'accountManager.js', { action: '停用账号', account: '2' })
  assert.equal(result.exitCode, 0)
  assert.equal(result.started, 0)
  assert.deepEqual(result.secrets, [])
  const settings = result.writes.find(write => write.path.endsWith('/.github/account-settings.json'))
  assert.deepEqual(JSON.parse(settings.value), { disabled: [accounts.accountKey(users[1])] })
})

test('management rejects a missing target without modifying any file', async t => {
  const result = await runScript(t, 'accountManager.js', { action: '停用账号', account: '' })
  assert.equal(result.exitCode, 1)
  assert.equal(result.started, 0)
  assert.deepEqual(result.writes, [])
})
