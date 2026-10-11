import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = new URL('../pkg/adminversion/versions.json', import.meta.url)
const target = new URL('../docs/ADMIN_CHANGELOG.md', import.meta.url)
const manifest = JSON.parse(readFileSync(source, 'utf8'))
const lines = ['# 管理员端业务更新日志', '', '> 从 pkg/adminversion/versions.json 生成，与管理员端页面共用同一份版本记录。', '', manifest.scope, '']
for (const version of manifest.versions) {
  lines.push(`## v${version.version} · ${version.title}`, '', `建档日期：${version.date}；状态：${version.status}；标签：\`${version.tag}\`。`, '', version.summary, '')
  for (const [key, label] of [['changes', '业务变化'], ['technical', '接手与维护'], ['limitations', '已知限制']]) {
    lines.push(`### ${label}`, '', ...version[key].map((item) => `- ${item}`), '')
  }
}
const output = lines.join('\n')
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output) {
    throw new Error('管理员更新日志与版本清单不一致，请运行 node scripts/generate-admin-changelog.mjs')
  }
} else {
  writeFileSync(target, output, 'utf8')
}
console.log(`Admin changelog ${process.argv.includes('--check') ? 'verified' : 'generated'}: ${fileURLToPath(target)}`)
