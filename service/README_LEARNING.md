# service：业务逻辑层

这一层处理项目真正的业务规则，连接“接口层”和“数据库/上游渠道”。

先看：

- `channel_select.go`：一次模型请求应选择哪个可用渠道。
- `channel.go`：渠道相关业务处理。
- `billing.go`、`billing_usage.go`：用量和计费相关逻辑。
- `codex_credential_refresh.go`：Codex 授权信息刷新。

学习时记住：controller 负责接收请求，service 决定怎么处理，model 负责保存和读取数据。
