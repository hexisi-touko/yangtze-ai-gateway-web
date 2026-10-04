# common：全项目通用能力

这里不是具体业务页面，而是被多个模块共用的基础能力，例如环境变量读取、数据库/Redis 初始化、加密、日志、缓存和嵌入式前端资源。

先看：

- `database.go`：数据库相关公共配置。
- `crypto.go`：敏感信息加密。
- `embed-file-system.go`：生产环境把 `web/dist` 前端文件嵌入后端。

`.env.example` 中的 `PORT`、`SQL_DSN`、`REDIS_CONN_STRING` 等变量，最终会被这里或相邻初始化代码读取。
