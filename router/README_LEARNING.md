# router：请求分流层

这里决定“哪个网址由哪一块代码处理”，相当于项目的总路线图。

先看：

1. `main.go`：把后台管理接口、模型中转接口、网页接口注册到 Gin 服务。
2. `api-router.go`：`/api/...`，供管理后台页面调用。
3. `relay-router.go`：`/v1/...`，供项目组的程序调用模型。
4. `web-router.go`：返回 React 网页和静态资源。

例如 `/v1/chat/completions` 会从 `relay-router.go` 进入，而管理后台的初始化请求会从 `api-router.go` 的 `/setup` 进入。
