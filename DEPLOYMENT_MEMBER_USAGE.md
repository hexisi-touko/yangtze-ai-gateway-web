# 管理端部署说明

稳定源码分支：`main`。管理员业务版本标签：`admin-v1.0.0` 和 `admin-v1.0.1`；后者包含本次请求正文、月度文档和更新日志修复。旧开发分支已归并，不能继续把旧分支名作为部署入口。

本仓库保存完整的 new-api 管理端源码，包括 Go 后端、React 管理页面、数据模型、路由、成员使用分析和 Docker 构建文件。云服务器必须从仓库源码构建镜像，不能继续直接使用官方 `calciumion/new-api:latest` 镜像。

## 构建与启动

1. 准备 Docker、Docker Compose、PostgreSQL 和 Redis。
2. 复制 `.env.example` 的配置到云服务器的环境变量管理中，替换数据库、Redis、会话密钥和管理员密码；不要把真实 `.env` 提交到仓库。
3. 在仓库根目录执行（不要使用本地 SQLite 数据库或本地客户端配置）：

```powershell
docker compose build --no-cache
docker compose up -d
docker compose logs -f new-api
```

`docker-compose.yml` 已配置为使用当前目录的 `Dockerfile` 构建，因此前端会在镜像构建阶段生成并嵌入 Go 服务。首次部署或代码更新后必须重新构建，不能只执行 `docker compose up -d`。

更新已有云端部署时执行：

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
docker compose build --no-cache new-api
docker compose up -d new-api
docker compose logs --tail=200 new-api
```

## 部署后检查

- 打开管理端并确认版本、成员使用分析、成员每日请求、价格快照和归档页可以访问。
- 使用测试成员发送一条请求，确认 Go 服务日志、成员请求内容和使用统计都有记录。
- 检查数据库自动迁移是否创建成员分析、请求内容、工作会话和价值核算相关表。
- 检查 `docker compose ps` 和 `docker compose logs --tail=200 new-api`，确认没有迁移或数据库连接错误。
- 客户端热更新发布后，确认 `GET /api/client-releases/latest` 能从正式 HTTPS 域名访问；下载地址不能指向 `127.0.0.1` 或本地磁盘路径。
- 成员请求内容只在管理员页面查询；本版本默认完整保存，配置正数 `MEMBER_REQUEST_CONTENT_MAX_BYTES` 才限制长度。月度正文按成员压缩归档，导出带北京时间日期的 HTML 文档。
- 数据库和正文归档目录必须一起持久化和备份。默认正文目录在 `/data/member-request-archives`，可用 `MEMBER_REQUEST_ARCHIVE_DIR` 指定。
- 旧月报在管理员页面补建正文时只能恢复仍保存在数据库中的内容，不能恢复未采集或已清理的正文。

现有服务器切换前必须备份实际 Compose 配置、数据库、归档目录和旧镜像；不要直接使用示例配置覆盖生产密钥或数据库卷。以上是后续部署步骤，本次仓库整理未执行云端部署。

云服务器上的客户端地址应使用正式 HTTPS 域名；本地测试客户端中的 `127.0.0.1:3000` 配置不属于本仓库。
