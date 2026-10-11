# admin-v1.0.1 本地验证记录

日期：2026-10-11。本次未推送 GitHub，未修改云服务器。

## 验证结果

- `go test ./service ./controller ./model ./pkg/adminversion` 通过。
- 前端成员分析和更新日志相关 7 个测试文件、28 个用例通过。
- `bun run typecheck`、改动文件的 oxlint 检查和 `bun run build` 通过。
- `go build -o .dev-cache/new-api-admin-v101.exe main.go` 通过，包含新的生产前端。
- `node scripts/generate-admin-changelog.mjs --check` 通过，网页与文档版本记录一致。
- 本地原开发后端已重启，PostgreSQL 自动迁移成功，`http://127.0.0.1:3000/api/status` 返回成功。
- 未登录访问 `/api/admin-updates` 返回 401；管理员及普通成员权限在控制器集成测试中分别验证。

## 正文和归档回归

覆盖正常中文、英文结论、日志关键字、代码、内部提醒、旧完整请求结构及超过 512 KB 的正文。
测试导出同一成员的 1004 条请求，单条超过 64 KB，验证日期顺序、正文结尾、HTML 转义及不同成员/月份隔离。
删除已验证的在线正文后仍能读取压缩归档；文件缺失或损坏、源记录新增时阻止清理。
分页遇到整页内部消息仍能推进游标，继续读取更早真实正文。

## 浏览器验收

使用已安装的 Microsoft Edge，无需下载浏览器。
1440px 与 390px 宽度检查管理端更新日志；桌面检查长正文弹窗、按成员导出按钮和下载文件名。
页面无 JavaScript 未捕获异常，更新日志没有横向溢出。检查用 API 数据为独立模拟数据，未调用上游模型、未消耗成员额度，未向实际数据库注入成员记录。
截图位于 `E:\AI\admin-v101-verification`，工具和安装依赖位于 `E:\AI\admin-ui-verify-tools`。两者均不提交。

## 版本边界

真实云端请求、服务器数据备份和镜像切换仍需在后续发布阶段验收。
旧正文未保存、已截断或已删除的部分无法通过这次升级恢复；页面提供补建入口和缺失说明。
测试验证 SQLite，以及本地 PostgreSQL 的启动迁移；未在 MySQL 实例或云端服务器运行本次验收。
首次远程分支核对因 GitHub 连接被重置未完成，未删除任何远程分支。
本地依赖 react-day-picker 曾指向另一套 React 类型，已换成当前项目版本的独立本地依赖副本；未更改 package.json 或依赖版本。
