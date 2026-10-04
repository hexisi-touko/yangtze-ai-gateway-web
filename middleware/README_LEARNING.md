# middleware：请求通用关卡

请求进入 controller 之前，通常会先经过这里的通用检查。

重点关注：

- `auth.go`：登录、用户身份与 API Key 鉴权。
- `cors.go`：浏览器跨域访问规则。
- 限流相关文件：限制单个用户或模型请求频率。
- `distributor.go`：为模型请求准备渠道分发信息。
- `audit.go`：审计和安全记录。

模型 API 的正常路线是：`router` -> `middleware` -> `controller`，因此 API Key 失效、额度限制或访问被拒绝时，常从这里开始排查。
