# New API 项目导览

这份文件只用于学习，不参与编译、不会改变 New API 的运行结果。打开项目后，先看本文件，再按编号打开源码。

## 先把学姐截图翻译成 New API 的结构

| 学姐 Java 项目里看到的内容 | New API 中对应的位置 | 作用 |
| --- | --- | --- |
| `src/main/java/...Application.java` | `main.go` | 后端程序总入口：初始化数据库、Redis、路由和 HTTP 服务。 |
| `application.yml` | `.env.example` | 环境变量的说明和样例，例如端口、数据库、Redis。 |
| `application-dev.yml` / `application-prod.yml` | `docker-compose.yml`、`docker-compose.dev.yml`、服务器上的 `new-api.env` | New API 不用 Spring Profile；开发/生产差异由容器编排和环境变量决定。 |
| `pom.xml` | `go.mod` 与 `web/package.json` | 后端 Go 依赖与前端 React 依赖。 |
| `target/` | `web/dist/` | 构建产物，不是日常修改的源码。 |

当前虚拟机的实际运行配置在 Ubuntu 的 `/opt/new-api/new-api.env`，其中包含数据库和 Redis 连接地址。它不应提交到 Git，也不应在截图或文档中写入真实密钥。

## 建议在 IDEA 展开的项目树

```text
new-api/
|
|-- NEW_API_LEARNING_GUIDE.md    [你当前看的学习导览]
|-- main.go                      [1. 后端总入口]
|-- go.mod                       [后端 Go 依赖]
|-- .env.example                 [2. 环境变量配置样例]
|-- docker-compose.yml           [3. 官方完整容器部署]
|-- docker-compose.dev.yml       [开发：后端 + PostgreSQL + Redis]
|-- Dockerfile                   [构建前端和 Go 后端]
|-- new-api.service              [Linux 开机自动运行服务模板]
|
|-- router/                      [4. URL 到功能的分流表]
|   |-- main.go                  [注册 API、Relay、Web 路由]
|   |-- api-router.go            [`/api/...` 管理后台接口]
|   |-- relay-router.go          [`/v1/...` 对外模型 API 中转接口]
|   `-- web-router.go            [网页静态资源和 SPA 页面回退]
|
|-- middleware/                  [5. 鉴权、限流、跨域、审计等通用关卡]
|-- controller/                  [6. HTTP 请求的接收与响应]
|-- service/                     [7. 业务处理：选渠道、额度、计费、任务]
|-- model/                       [8. 数据表模型与数据库读写]
|-- relay/                       [9. 协议转换和上游渠道适配的核心]
|   `-- channel/                [OpenAI、Claude、Gemini、Codex 等适配器]
|
|-- common/                      [环境变量、Redis、数据库和公共能力]
|-- setting/                     [系统、模型、倍率、性能等设置逻辑]
|-- oauth/                       [第三方登录]
|-- docs/                        [项目文档]
|
`-- web/                         [React + TypeScript 前端]
    |-- package.json             [前端依赖和命令]
    |-- rsbuild.config.ts        [前端开发/构建配置]
    |-- src/
    |   |-- main.tsx             [10. 前端总入口]
    |   |-- routes/              [网页地址对应页面]
    |   |   `-- setup/           [`/setup` 初始化页面路由]
    |   |-- features/            [页面按业务拆分]
    |   |   |-- setup/           [初始化向导]
    |   |   |-- channels/        [渠道管理]
    |   |   |-- keys/            [API Key 管理]
    |   |   |-- dashboard/       [仪表盘]
    |   |   `-- system-settings/ [系统设置]
    |   |-- components/          [可复用前端组件]
    |   `-- stores/              [前端状态]
    `-- dist/                    [编译产物，不直接修改]
```

## New API 到底做什么

它是一个统一入口：项目组成员和程序只面对一个地址、一个 API Key；New API 再把请求鉴权、限流、记账，并转给配置好的上游模型渠道。管理后台则用于创建用户、令牌、渠道、模型和费率规则。

```text
客户端 / 项目组成员
        |
        | 调用 /v1/chat/completions 等标准接口
        v
New API：鉴权 -> 限流 -> 选择可用渠道 -> 转换协议 -> 计费/日志
        |
        v
OpenAI / Claude / Gemini / 其他已配置上游
```

## 两条最重要的源码路线

### A. 管理后台网页

```text
浏览器访问 /setup、/channels 等页面
  -> `web/src/main.tsx` 启动 React
  -> `web/src/routes` 找到页面地址
  -> `web/src/features` 显示页面、调用接口
  -> `/api/...`
  -> `router/api-router.go`
  -> `controller`
  -> `service` / `model`
  -> PostgreSQL、Redis
```

具体例子：首次管理员初始化。

```text
浏览器 /setup
  -> `web/src/routes/setup/index.tsx`
  -> `web/src/features/setup`
  -> POST /api/setup
  -> `router/api-router.go`
  -> `controller.PostSetup`
  -> 数据库保存初始化结果
```

### B. 真正的模型 API 中转

```text
客户端 POST /v1/chat/completions
  -> `router/relay-router.go`
  -> `middleware.TokenAuth()` 校验项目组 API Key
  -> 限流和渠道分发
  -> `controller.Relay(...)`
  -> `service` 选择渠道、检查额度并记账
  -> `relay/channel` 转成上游需要的协议
  -> 上游模型 API
  -> 将结果返回客户端，同时记录日志/用量
```

## 配置应该看哪里

不要寻找 Java 的 `application-dev.yml`。New API 的配置分三层：

1. `.env.example`：有哪些环境变量可以配置，先从这里学习，例如 `PORT`、`SQL_DSN`、`REDIS_CONN_STRING`、`SESSION_SECRET`。
2. `docker-compose.yml`：Docker 容器怎样互相连接、端口怎样映射。
3. `/opt/new-api/new-api.env`：虚拟机实际使用的值，属于部署机密，不提交到仓库。

## 在 IDEA 中的阅读顺序

1. `main.go`：理解服务如何启动。
2. `.env.example`：理解运行它需要哪些配置。
3. `router/main.go`：理解请求被分成网页、后台 API 和模型 API 三类。
4. `router/api-router.go`：理解后台按钮对应哪些 `/api` 接口。
5. `router/relay-router.go`：理解 `/v1` 的中转接口。
6. `controller`、`service`、`model`：理解业务、数据库和日志。
7. `relay/channel`：理解上游协议适配。
8. `web/src/main.tsx`、`web/src/routes`、`web/src/features`：理解页面怎样连接后端。

先不要把注意力放在 `web/dist`、`web/node_modules`、`.dev-cache` 和 `logs` 上，它们不是需要学习或直接修改的源码。
