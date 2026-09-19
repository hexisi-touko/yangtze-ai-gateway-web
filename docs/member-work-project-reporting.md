# 客户端工作项目上报（第一版）

## 行为

成员在桌面客户端选择一个项目目录。客户端只读取目录是否存在、Git 仓库根目录名称和当前分支；非 Git 目录使用目录名称。成员确认后，客户端通过现有登录会话创建项目会话，每分钟发送一次心跳，停止上报或客户端离线后管理员页最多约 3 分钟显示为中断。

管理员在“成员使用分析 → 客户端项目”查看最近 100 条会话，可按成员、项目和用途搜索，并看到 Git/目录识别、分支、开始时间、最近上报和停止/中断状态。

## API

客户端身份由 `UserAuth` 从登录会话确定，不接受客户端传来的 `user_id`。请求体只允许 `session_id`、`project`、`branch`、`source`、`purpose`。

- `POST /api/work-sessions`
- `POST /api/work-sessions/:session_id/heartbeat`
- `POST /api/work-sessions/:session_id/stop`
- `GET /api/member-usage/work-sessions`（管理员）

## 边界

项目会话是成员主动报告的工作上下文，不是工作时长证明，也不会把历史 Token/请求自动归因到项目。请求日志仍按原有用户、模型和时间记录；没有项目会话的请求仍正常执行。第一版不扫描电脑、不上传源码、路径、Git 远程地址、密钥、提示词或响应内容，不做 KPI 评分和 Token 限制。

## 部署

后端迁移由 GORM 自动创建 `member_work_sessions`，SQLite、MySQL 和 PostgreSQL 均支持。云端部署时上传 New API 源码并重新编译后端、构建前端；桌面客户端只需把配置中的 `serverUrl` 指向云端 HTTPS 地址并重新打包。旧客户端调用不到这些接口时不会影响原有工具配置功能。
