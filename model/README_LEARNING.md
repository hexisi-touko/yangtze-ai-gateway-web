# model：数据库模型层

这里定义系统保存哪些数据，以及如何读写 PostgreSQL、MySQL 或 SQLite。

先看：

- `main.go`：数据库连接与初始化。
- `user.go`：用户数据。
- `token.go`：用户 API Key 数据。
- `channel.go`：上游渠道数据。
- `log.go`：调用、错误和用量日志。

后台新增一个渠道或 API Key，最终都会由这一层写入数据库。虚拟机实验环境当前使用 PostgreSQL。
