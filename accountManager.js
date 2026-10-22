import { writeFileSync } from 'node:fs'
import { settingsPath, parseAccounts, accountKey, readAccountSettings, setAccountEnabled } from './utils/accounts.js'
import { maskDisplayName, maskIdentifier } from './utils/safeLog.js'
import { close_api, send, startService, waitForApi } from './utils/utils.js'

function escapeCell(value) {
  return String(value).replace(/[&<>|`*_[\]\\\r\n]/g, char => `&#${char.charCodeAt(0)};`)
}

async function main() {
  const users = parseAccounts(process.env.USERINFO)
  const action = process.env.ACCOUNT_ACTION || '查看账号'
  if (!['查看账号', '启用账号', '停用账号'].includes(action)) {
    throw new Error('不支持的账号管理操作')
  }
  let settings = readAccountSettings()
  if (action !== '查看账号') {
    settings = setAccountEnabled(users, settings, process.env.ACCOUNT, action === '启用账号')
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
    console.log('账号开关已写入本地配置；工作流提交配置成功后生效。')
  }

  const lines = [
    `## ${action}`, '', `共 ${users.length} 个账号。编号按当前登录信息顺序排列。`, '',
    '| 编号 | 昵称（脱敏） | 用户 ID（脱敏） | 签到开关 |',
    '| --- | --- | --- | --- |',
  ]
  const api = action === '查看账号' && users.length > 0 ? startService() : null
  try {
    if (api) await waitForApi()
    for (const [index, user] of users.entries()) {
      let nickname = '未查询'
      if (api) {
        try {
          const detail = await send(`/user/detail?timestrap=${Date.now()}`, 'GET', {
            cookie: `token=${user.token}; userid=${user.userid}`,
          })
          nickname = detail?.data?.nickname == null ? '登录已失效或查询失败' : maskDisplayName(detail.data.nickname)
        } catch {
          nickname = '查询失败'
        }
      }
      const status = settings.disabled.includes(accountKey(user)) ? '停用' : '启用'
      lines.push(`| ${index + 1} | ${escapeCell(nickname)} | ${escapeCell(maskIdentifier(user.userid))} | ${status} |`)
    }
  } finally {
    if (api) close_api(api)
  }
  lines.push('', '单独签到：运行「签到」，账号编号填写上表编号。',
    '单独启停：运行「账号管理」，选择操作并填写编号。停用不会删除登录信息。')
  const summary = lines.join('\n') + '\n'
  console.log(summary)
  // 工作流只在配置提交成功后发布摘要，避免把未保存的开关显示为已生效。
  if (process.env.ACCOUNT_SUMMARY) writeFileSync(process.env.ACCOUNT_SUMMARY, summary)
}

main().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1) })
