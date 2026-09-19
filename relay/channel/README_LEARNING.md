# relay/channel：上游渠道适配器

一个子目录通常对应一种上游平台或协议，例如 `openai`、`claude`、`gemini`、`codex`、`sub2api`。

每个适配器通常负责三件事：

1. 把统一请求转换为该平台需要的请求头、地址和 JSON 格式。
2. 发送请求并处理流式/非流式响应。
3. 将上游返回的结果转换回 New API 对外统一的格式。

学习时先打开 `openai`，再与 `claude` 或 `gemini` 对比；不需要一开始把所有平台都看完。
