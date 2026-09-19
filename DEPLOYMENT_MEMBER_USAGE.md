# 管理端部署说明

本仓库保存完整的 new-api 管理端源码，包括 Go 后端、React 管理页面、数据模型、路由、成员使用分析和 Docker 构建文件。云服务器必须从仓库源码构建镜像，不能继续直接使用官方 `calciumion/new-api:latest` 镜像。

## 构建与启动

1. 准备 Docker、Docker Compose、PostgreSQL 和 Redis。
2. 复制 `.env.example` 的配置到云服务器的环境变量管理中，替换数据库、Redis、会话密钥和管理员密码；不要把真实 `.env` 提交到仓库。
3. 在仓库根目录执行：

```powershell
docker compose build --no-cache
docker compose up -d
docker compose logs -f new-api
```

`docker-compose.yml` 已配置为使用当前目录的 `Dockerfile` 构建，因此前端会在镜像构建阶段生成并嵌入 Go 服务。

## 部署后检查

- 打开管理端并确认版本、成员使用分析、成员每日请求、价格快照和归档页可以访问。
- 使用测试成员发送一条请求，确认 Go 服务日志、成员请求内容和使用统计都有记录。
- 检查数据库自动迁移是否创建成员分析、请求内容、工作会话和价值核算相关表。
- 检查 `docker compose ps` 和 `docker compose logs --tail=200 new-api`，确认没有迁移或数据库连接错误。

云服务器上的客户端地址应使用正式 HTTPS 域名；本地测试客户端中的 `127.0.0.1:3000` 配置不属于本仓库。
