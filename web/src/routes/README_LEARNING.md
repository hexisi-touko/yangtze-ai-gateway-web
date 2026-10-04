# routes：前端页面路由

这里把浏览器地址映射成 React 页面。它相当于前端的“网址分流表”。

例如：

- `setup/index.tsx`：首次访问的 `/setup` 初始化页面。
- `_authenticated/`：登录之后可访问的后台页面。
- `(auth)/`：登录、注册等认证页面。

不要手动修改 `routeTree.gen.ts` 一类生成文件；需要理解或修改页面时，从这里的实际路由文件开始。
