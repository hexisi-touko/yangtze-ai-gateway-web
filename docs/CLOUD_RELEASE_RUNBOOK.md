# 管理端 1.0.2 云端发布手册

本手册对应 `admin-v1.0.2`。本地准备阶段只生成源码版本和构建配置，不连接服务器、不上传文件、不切换线上容器。正式发布时由管理员在已有 root PowerShell 会话中执行命令，Xftp 只用于传输版本包和备份文件。

## 发布前检查

1. 在本地分支 `fix/admin-v1.0.2-deployment` 完成前端测试、类型检查、生产构建、管理员更新日志检查和 Dockerfile 静态检查。
2. 只提交源码、测试、版本清单、Dockerfile 和本手册。不要提交真实 `.env`、数据库、日志、成员正文、归档、客户端安装包、`node_modules` 或构建产物。
3. 合并到 `main` 后创建不可改写的 `admin-v1.0.2` 标签。用 `git archive` 生成完整源码包，上传前记录源码提交编号和压缩包 SHA-256。
4. 云端先确认当前 Compose 文件、服务名、数据挂载、数据库类型、Redis 配置、当前镜像 ID 和磁盘空间。不能假定生产数据库是 SQLite。

## Xftp 传输目录

在服务器创建版本目录，保留旧版本目录：

```text
/opt/yangtze-admin/releases/admin-v1.0.2/
```

上传完整源码压缩包和 SHA-256 校验文件。不要覆盖 `/opt/yangtze-admin/.env`、数据库卷、`data/`、`logs/` 或成员正文归档目录。

## 备份

备份当前 Compose 配置、生产环境文件、旧镜像准确标识、数据库和正文归档。数据库命令根据实际服务类型选择：

```bash
cd /opt/yangtze-admin
mkdir -p backups/$(date +%Y%m%d-%H%M%S)
cp compose.yaml .env backups/$(date +%Y%m%d-%H%M%S)/
docker compose ps
docker images --no-trunc | head -n 30
```

PostgreSQL 使用 `pg_dump`，MySQL 使用 `mysqldump`，SQLite 在停止写入或使用一致性备份方式后复制数据库文件。成员正文归档目录必须单独打包并记录文件数量和大小。禁止使用 `docker compose down -v`，防止删除数据卷。

## 构建自研镜像

源码包解压到版本目录后，在该目录构建。生产密钥只从服务器环境读取：

```bash
cd /opt/yangtze-admin/releases/admin-v1.0.2
export ADMIN_IMAGE_NAME=yangtze-new-api
export ADMIN_IMAGE_TAG=admin-v1.0.2
export BUILD_COMMIT=<合并到-main-后的提交编号>
export BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

docker build \
  --build-arg BUILD_VERSION="$ADMIN_IMAGE_TAG" \
  --build-arg BUILD_COMMIT="$BUILD_COMMIT" \
  --build-arg BUILD_TIME="$BUILD_TIME" \
  -t "$ADMIN_IMAGE_NAME:$ADMIN_IMAGE_TAG" .
```

现有生产 Compose 如果仍然写着上游 `calciumion/new-api:latest`，必须只把 `new-api` 服务的镜像改为自研镜像 `yangtze-new-api:admin-v1.0.2`。数据库、Redis、端口、`/data`、日志和正文归档挂载保持原配置。修改前复制原文件，修改后运行：

```bash
docker compose config
docker compose up -d new-api
docker compose ps
docker compose logs --tail=200 new-api
```

## 验收

- `/api/status` 返回 HTTP 200。
- 管理员可以登录，更新日志页面可以上下滚动。
- `/api/admin-updates` 管理员访问返回 200，返回内容包含 `1.0.2`、提交编号和构建时间。
- 成员请求正文可以完整显示，长对话和短对话均可查看。
- 成员月度归档和 HTML 导出可以按成员 ID、管理员显示名、登录名和日期读取。
- 成员分析、官方价格、参考价值、节省金额和缓存指标仍可显示。
- 新测试成员发送请求后，管理员端能看到新正文、时间和工作项目。
- `docker compose logs` 没有数据库迁移失败、Redis 认证失败、静态资源缺失或归档路径错误。

## 回滚

验收失败时，记录错误日志和当前容器 ID，把 Compose 中的镜像改回备份的旧镜像标签，再执行：

```bash
docker compose up -d new-api
docker compose ps
docker compose logs --tail=200 new-api
```

不要删除新旧数据卷。若新版本产生数据库结构变化，镜像回退不等于数据库回退，必须根据发布前的数据库备份决定是否恢复。

## 发布记录

验收成功后记录：源码提交编号、源码包 SHA-256、镜像 digest、构建时间、切换时间、数据库类型、备份位置和验收结果。云端正式发布时间补写到 `pkg/adminversion/versions.json` 和 `docs/ADMIN_CHANGELOG.md`，不要提前伪造部署成功状态。
