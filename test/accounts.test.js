import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAccounts, accountKey, selectAccounts, setAccountEnabled } from '../utils/accounts.js'
import { upsertUser } from '../utils/userinfo.js'

const fixture = () => [
  { userid: '123456789', token: 'test-token-one' },
  { userid: '987654321', token: 'test-token-two' },
]

test('existing accounts default to enabled; selecting one keeps its original object', () => {
  const users = fixture()
  assert.deepEqual(selectAccounts(users, { disabled: [] }).map(x => x.number), [1, 2])
  const selected = selectAccounts(users, { disabled: [] }, '2')
  assert.equal(selected.length, 1)
  assert.equal(selected[0].user, users[1])
  selected[0].user.token = 'refreshed-test-token'
  assert.equal(users[1].token, 'refreshed-test-token')
  assert.equal(users[0].token, 'test-token-one')
})

test('disable and enable affect only the chosen account and never change credentials', () => {
  const users = fixture()
  const original = structuredClone(users)
  const initial = { disabled: [] }
  const disabled = setAccountEnabled(users, initial, '2', false)
  assert.deepEqual(users, original)
  assert.deepEqual(initial, { disabled: [] })
  assert.deepEqual(selectAccounts(users, disabled).map(x => x.number), [1])
  assert.throws(() => selectAccounts(users, disabled, '2'), /停用/)
  assert.deepEqual(selectAccounts(users, setAccountEnabled(users, disabled, '2', true)).map(x => x.number), [1, 2])
  assert.equal(JSON.stringify(disabled).includes(users[1].userid), false)
  assert.equal(JSON.stringify(disabled).includes(users[1].token), false)
})

test('disabled state follows account identity after reordering, refresh, and appending', () => {
  const users = fixture()
  const settings = setAccountEnabled(users, { disabled: [] }, '2', false)
  upsertUser(users, { userid: 987654321, token: 'new-test-token' }, true)
  upsertUser(users, { userid: '555555555', token: 'third-test-token' }, true)
  users.reverse()
  assert.deepEqual(selectAccounts(users, settings).map(x => x.user.userid), ['555555555', '123456789'])
  assert.equal(accountKey({ userid: 987654321 }), accountKey({ userid: '987654321' }))
})

test('invalid or missing account numbers fail instead of falling back to all accounts', () => {
  for (const value of ['', '0', '-1', '3', '1.5', '1,2', 'all', 'abc', '999999999999999999999']) {
    assert.throws(() => setAccountEnabled(fixture(), { disabled: [] }, value, false), /编号/)
  }
  for (const value of ['', ' ', '0', '-1', '3', '1.5', '1,2', 'abc']) {
    assert.throws(() => selectAccounts(fixture(), { disabled: [] }, value), /编号/)
  }
})

test('all accounts disabled yields an empty selection', () => {
  const users = fixture()
  let settings = setAccountEnabled(users, { disabled: [] }, '1', false)
  settings = setAccountEnabled(users, settings, '2', false)
  assert.deepEqual(selectAccounts(users, settings), [])
})

test('invalid USERINFO never leaks its original content in errors', () => {
  for (const raw of ['test-secret', '{}', '[null]', '[{"userid":"123","token":""}]', '']) {
    assert.throws(() => parseAccounts(raw), error => !error.message.includes('test-secret') && /USERINFO/.test(error.message))
  }
  assert.deepEqual(parseAccounts(JSON.stringify(fixture())), fixture())
})
