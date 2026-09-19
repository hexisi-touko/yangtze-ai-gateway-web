# web：React 前端项目

这是浏览器里看到的管理后台。它使用 React + TypeScript，源码在 `src`，构建结果在 `dist`。

先看：

- `package.json`：前端依赖和 `bun run dev`、`bun run build` 等命令。
- `rsbuild.config.ts`：前端开发服务器、构建配置和 API 代理。
- `src/`：真正需要学习和修改的前端源码。
- `dist/`：构建产物，不直接修改。

开发时网页常运行在 `localhost:5173`；生产构建后，`dist` 会被 Go 后端嵌入，同一个服务即可同时提供网页与 API。
