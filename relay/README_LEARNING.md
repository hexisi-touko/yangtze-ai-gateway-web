# relay：模型协议中转核心

这是 New API 最有特色的一层。它把客户端发来的统一接口请求，转换成对应上游服务实际需要的请求格式；拿到响应后再转换回来。

先看：

- `relay_adaptor.go`：根据渠道类型选择适配器。
- `chat_completions_via_responses.go`、`responses_handler.go`：OpenAI 风格请求处理。
- `claude_handler.go`、`gemini_handler.go`：不同协议的处理入口。
- `channel/`：每一个上游平台的专用适配器。

这层的目标不是“自己生成回答”，而是可靠地把请求送到正确的上游，并维持统一的 API 体验。
