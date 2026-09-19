# controller：接口处理层

这一层接收路由转来的 HTTP 请求，读取参数、调用业务逻辑，并把成功或失败结果返回给浏览器/客户端。

先看：

- `setup.go`：首次初始化管理员。
- `channel.go`：上游渠道的新增、修改、测试。
- `token.go`：用户 API Key 的管理。
- `user.go`：用户相关接口。
- `relay.go`：模型请求的中转入口。

controller 不应承担复杂规则；“如何选渠道、扣多少额度”等核心判断通常继续交给 `service` 或 `model`。

## 按业务浏览 controller

本目录的 Go 文件都声明为 `package controller`。为了便于初学者阅读，目录中增加了带编号的 Markdown 导航文件，并在 `new-api/.vscode/settings.json` 中配置了 VS Code 的文件嵌套：

```text
01-认证与用户.md
  ├─ setup.go
  ├─ user.go
  └─ auth_session.go
02-渠道与模型.md
  ├─ channel.go
  └─ model.go
03-请求中转与协议适配.md
  └─ relay.go
...
```

这些分组只是 IDE 的显示方式，源码仍在同一个目录和同一个 Go 包中，不要把它们当成 Java 那样的真实子包。若看不到嵌套效果，请用 VS Code/Cursor 打开 `new-api` 根目录，并确认文件嵌套设置已启用。

建议先打开 `00-先看这里.md`，再按编号阅读；每个导航文件都列出了职责、推荐顺序和它与 `router`、`service`、`model`、`relay` 的关系。
