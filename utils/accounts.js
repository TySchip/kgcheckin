import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const settingsPath = new URL('../.github/account-settings.json', import.meta.url)

function parseAccounts(raw) {
  try {
    const users = JSON.parse(raw)
    if (!Array.isArray(users) || users.some(user => !user ||
      !['string', 'number'].includes(typeof user.userid) || !/^\d+$/.test(String(user.userid)) ||
      typeof user.token !== 'string' || !user.token.trim())) {
      throw new Error()
    }
    return users
  } catch {
    throw new Error('USERINFO 未配置或格式错误，请先完成账号登录')
  }
}

function accountKey(user) {
  return createHash('sha256').update(String(user.userid)).digest('hex')
}

function readAccountSettings() {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  if (!Array.isArray(settings?.disabled) || settings.disabled.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) {
    throw new Error('账号开关配置格式错误')
  }
  return settings
}

function accountNumber(users, input) {
  const value = String(input ?? '').trim()
  const number = Number(value)
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number) || number > users.length) {
    throw new Error(`账号编号无效，请先查看账号列表，再填写 1 至 ${users.length} 的编号`)
  }
  return number
}

function selectAccounts(users, settings, input = 'all') {
  const target = String(input).trim()
  const accounts = users.map((user, index) => ({ user, number: index + 1 }))
  if (target === 'all') {
    return accounts.filter(({ user }) => !settings.disabled.includes(accountKey(user)))
  }
  const account = accounts[accountNumber(users, target) - 1]
  if (settings.disabled.includes(accountKey(account.user))) {
    throw new Error(`账号 ${account.number} 已停用，请在「账号管理」中启用后再签到`)
  }
  return [account]
}

function setAccountEnabled(users, settings, input, enabled) {
  const key = accountKey(users[accountNumber(users, input) - 1])
  const disabled = settings.disabled.filter(value => value !== key)
  if (!enabled) disabled.push(key)
  return { ...settings, disabled }
}

export { settingsPath, parseAccounts, accountKey, readAccountSettings, selectAccounts, setAccountEnabled }
