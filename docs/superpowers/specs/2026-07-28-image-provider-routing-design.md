# 多生图引擎与后台模型控制设计

日期：2026-07-28

## 目标

- 成员只选择生图引擎类型，例如“自动”“GPT”“Gemini”，不接触渠道、Key 和具体模型版本。
- 管理员在后台配置每个引擎使用的渠道池、模型、开放范围、自动路由优先级和启停状态。
- 同一引擎支持多个渠道，自动轮询、故障切换、冷却和健康状态判断。
- “自动”模式可在多个已启用引擎之间路由；手动模式只在选中的引擎内部切换渠道。
- 使用提供商适配器接入不同协议。首批支持 OpenAI Images 兼容协议和 Gemini 原生 `generateContent` 协议。
- 新增其他生图提供商时，成员端自动出现对应按钮，主任务流程不需要增加硬编码分支。
- 保持现有 GPTeam、本地历史、管理员与成员身份及当前渠道指派可用。
- 开源时不包含 Key、历史图片、审计日志、运行状态或本机密钥。

## 非目标

- 不让成员直接选择具体渠道、Key、Base URL 或模型版本。
- 不在本轮实现计费系统、配额购买或多租户组织管理。
- 不自动把已发出、可能计费的失败请求切换到另一引擎，避免重复扣费。
- 不根据渠道名称猜测协议类型；协议由管理员明确配置。

## 成员体验

生成区域增加稳定尺寸的分段选择控件：

- `自动`：使用管理员允许参与自动模式的所有引擎。
- `GPT`：只使用 GPT 引擎对应的渠道池和后台指定模型。
- `Gemini`：只使用 Gemini 原生渠道池和后台指定模型。
- 未来引擎：管理员启用后，根据配置的显示名称动态增加按钮。

成员请求只提交 `engineId`。成员无法提交可信的 `channelId` 或 `model`；服务端始终以后台配置为准。

手动选择某个引擎后，该任务不会跨引擎降级。选择“自动”时，服务端才可按照优先级在不同引擎之间尝试。

## 管理员体验

设置抽屉新增“生图引擎”区域。每个引擎配置包含：

- 唯一 ID，例如 `gpt`、`gemini`。
- 成员端显示名称。
- 提供商适配器类型，例如 `openai-images`、`gemini-native`。
- 实际生图模型，例如 `gpt-image-2`、`gemini-3.1-flash-image`。
- 一个或多个渠道 ID，按优先级排列。
- 是否对成员开放。
- 是否参与“自动”模式。
- 自动模式优先级。
- 是否启用。

管理员可以读取所选渠道的模型列表并进行真实生图测试。测试必须通过对应适配器，不能统一假设 `/images/generations` 可用。

现有“成员使用渠道”和“管理员使用渠道”单选配置保留为迁移兜底，直到管理员保存第一份引擎配置。保存后由引擎配置接管路由。

## 数据结构

渠道继续保存在私有 Key 存储中，并新增明确的 `providerType` 字段：

```json
{
  "id": "channel-id",
  "name": "Gemini upstream",
  "providerType": "gemini-native",
  "baseURL": "https://api.example.com/v1",
  "key": "private",
  "enabled": true
}
```

非敏感的引擎配置保存在系统设置中：

```json
{
  "imageEngines": [
    {
      "id": "gpt",
      "label": "GPT",
      "providerType": "openai-images",
      "model": "gpt-image-2",
      "channelIds": ["channel-a", "channel-b"],
      "memberEnabled": true,
      "autoEnabled": true,
      "priority": 10,
      "enabled": true
    }
  ]
}
```

公开状态接口只返回成员需要的 `id`、`label`、能力和可用状态，不返回渠道 ID、Base URL、Key 或管理员优先级细节。

## 提供商适配器

每个适配器实现相同边界：

- `listModels(channel)`：读取模型列表并标记生图候选。
- `probe(channel)`：验证认证和基本可用性。
- `generate(channel, request)`：构建提供商请求并返回统一图片结果。
- `capabilities(channel, model)`：声明批量、Seed、图生图和格式能力。
- `classifyError(error)`：标记是否可重试、是否可能已计费。

首批适配器：

1. `openai-images`：复用现有 `/images/generations` 请求、图片下载和本地保存逻辑。
2. `gemini-native`：调用 `/v1beta/models/{model}:generateContent`，使用 `responseModalities: ["TEXT", "IMAGE"]`，解析 `inlineData` 图片。已实测 `gemini-3.1-flash-image` 可成功返回 PNG。

`gemini-3.5-flash` 当前不接受图片输出参数，`gemini-3.5-flash-image` 在当前上游未配置，因此不作为默认生图模型。

## 路由与故障切换

手动模式：

1. 读取指定引擎。
2. 过滤禁用、冷却或不兼容的渠道。
3. 按引擎内渠道优先级和轮询位置选择。
4. 只在该引擎内尝试下一个渠道。

自动模式：

1. 读取所有 `enabled && memberEnabled && autoEnabled` 的引擎。
2. 按优先级、健康状态和轮询位置排序。
3. 在引擎内先进行渠道故障切换，再考虑下一个引擎。
4. 记录每次尝试的引擎、提供商、模型、渠道掩码和失败分类。

只有明确可重试且未进入可能计费阶段的错误才能自动切换。连接中断且标记 `maybeCharged`、请求超时后状态未知或已经返回图片解析异常时停止自动重试，并提示管理员核对。

模型不存在、参数不兼容等配置错误不应反复尝试同一引擎的其他渠道；它们会在后台显示为配置问题。

## API 变化

- `GET /api/status`：增加经过裁剪的成员可用引擎列表和默认选择。
- `GET /api/admin/image-engines`：管理员读取完整引擎配置与渠道健康信息。
- `POST /api/admin/image-engines`：管理员校验并保存引擎配置。
- `GET /api/models?channelId=...`：通过渠道的适配器读取模型。
- `POST /api/test-model`：通过渠道的适配器进行真实生图测试。
- `POST /api/jobs`：接受 `engineId`；成员提交的 `model` 和 `channelId` 不参与可信路由。

任务结果与审计记录增加：`requestedEngineId`、`resolvedEngineId`、`providerType`、`model` 和完整尝试列表。

## 兼容迁移

- 旧渠道缺少 `providerType` 时默认使用 `openai-images`，行为与当前版本一致。
- 当前 GPTeam 管理员和成员渠道继续工作，不要求升级后立即重新配置。
- 管理员创建 Gemini 引擎时，显式把 Gemini 渠道设为 `gemini-native`。
- 在管理员保存第一份 `imageEngines` 前，服务端继续使用现有单渠道设置和 `IMAGE2_MODEL` 默认值。
- 历史记录保留原始模型和渠道快照，不进行批量改写。

## 图片预览交互

灯箱增加“点击图片外暗色边缘关闭”：

- 点击舞台空白区域关闭。
- 点击图片、缩放按钮、翻页、下载和底部工具栏不关闭。
- 图片拖拽结束后抑制随后的点击关闭，避免误操作。
- 保留最外层遮罩、`Esc` 和显式关闭按钮。
- 鼠标和触屏遵循相同行为。

## 开源安全

- `.env`、`data/`、`.local/`、输出图片、缩略图、审计日志、身份密钥和真实 Key 必须被忽略。
- 提供 `.env.example`、空的配置示例和渠道/适配器接入文档。
- API 与日志只展示掩码 Key；异常响应不得包含认证头或完整请求配置。
- README 说明本地数据目录、备份方式、Gemini 原生协议要求和第三方上游风险。
- 发布前执行密钥扫描和 Git 历史检查；仅清理开源副本，不改动本地运行数据。
- 保持 MIT 许可证，并明确第三方模型和上游服务受各自条款约束。

## 测试策略

- 适配器单元测试：OpenAI 请求体、Gemini `generateContent` 请求体、`inlineData` 解析和错误分类。
- 路由测试：手动模式不跨引擎、自动模式跨引擎、渠道轮询、冷却、不可重试和可能计费错误。
- 权限测试：成员不能指定渠道或覆盖后台模型，公开状态不泄露敏感配置。
- 迁移测试：没有新配置时继续使用当前 GPTeam 设置。
- 浏览器测试：动态引擎按钮、自动/GPT/Gemini 切换、管理员保存、真实测试反馈。
- 灯箱测试：点击边缘关闭，点击图片和工具栏不关闭，拖动后不误关。
- 完整回归：`npm run check`、`npm test` 和桌面/移动端浏览器验证。

## 实施顺序

1. 提取提供商适配器接口，并让现有 OpenAI Images 流程通过适配器运行。
2. 实现 Gemini 原生适配器和单元测试。
3. 增加引擎配置校验、存储、迁移和管理员 API。
4. 实现手动与自动路由、审计字段和故障切换规则。
5. 增加管理员引擎配置界面和成员动态选择按钮。
6. 完成灯箱边缘关闭交互。
7. 增加开源示例配置、README、安全检查和发布清单。
8. 执行完整自动化与浏览器回归测试。
