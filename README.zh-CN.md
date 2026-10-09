# TubeInsight

[English](README.md) | [简体中文](README.zh-CN.md)

> 把 YouTube 视频转化为可阅读、可分析、可比较、可沉淀的知识资产。

TubeInsight 是一款运行在 Chrome 侧边栏中的 YouTube AI 研究助手。它围绕视频字幕建立完整的信息处理流程，将双语阅读、AI 概览、产品情报、行业洞察、PRD 草稿、多视频对比、时间戳笔记和 Markdown 导出集中在一个工作空间中。

无论你在研究产品、跟踪行业趋势、学习专业知识，还是整理视频资料，TubeInsight 都能帮助你减少反复拖动进度条和手工摘录，把长视频快速转化为结构化成果。

点击查看演示和教学视频（小白友好）：[https://www.bilibili.com/video/BV1dnuq6dEak/](https://www.bilibili.com/video/BV1dnuq6dEak/)

![TubeInsight 最新功能界面](TubeInsight-demo.png)

## 核心能力

### 字幕阅读与双语学习

- 提取带时间戳的 YouTube 原生字幕，并按完整语义重新组织内容。
- 支持 Original、中文和双语对照三种阅读模式。
- 支持字幕全文搜索、匹配跳转和跟随视频播放。
- 点击任意时间戳即可回到视频对应位置。

### AI 概览与内容理解

- 自动生成视频章节、关键时刻和重点引用。
- 选中字幕即可获取结合上下文的 AI 讲解。
- 概览、字幕和笔记共享语言模式，翻译结果按需生成并缓存。

### 产品情报与 PRD

- **Intel** 先判断视频是否以产品为主题。产品类视频提炼产品功能、用户痛点、竞品信息和商业模式关键词；访谈、经验分享等非产品视频则提炼核心方法论、关键原则、可迁移场景和方法论关键词。
- 情报以结构化卡片呈现，每类内容均可独立复制。
- 基于视频内容生成包含背景目标、目标用户、用户故事、核心功能和验收标准的 PRD 草稿。非产品视频会把核心方法论转化为产品构想来撰写。
- PRD 支持 Markdown 渲染和一键复制。

### 行业洞察与观点提炼

- **Insights** 自动识别 AI、科技和产品领域的专业术语，点击即可查看中文解释。
- 按“发言人 → 核心观点”的方式梳理视频观点。
- **For PM** 板块分为两个标签：“产品洞察”呈现对产品经理最有价值的内容；“技术边界”梳理视频中人物提到的技术能力、实现方式、当前局限和突破判断。

### 多视频对比分析

- **Compare** 可将最多 10 个视频加入本地对比库。
- 横向比较核心功能、用户痛点、技术方案和商业模式。
- 自动总结共同趋势、差异化亮点和可执行的产品行动建议。

### 笔记与知识库导出

- 保存带时间戳的笔记，并通过 AI 自动整理表达。
- 将视频摘要、产品情报、PRD、行业洞察和个人笔记整合为 Markdown 知识卡片。
- 文件按 `视频标题_YYYY-MM-DD.md` 自动命名，可直接在 Obsidian、Typora 等工具中使用。

## 从视频到知识资产

1. 打开带原生字幕的 YouTube 视频。
2. 在 **Transcript** 阅读、搜索或翻译字幕。
3. 在 **Overview** 建立对视频结构和重点内容的整体理解。
4. 使用 **Intel**、**Insights** 和 **Compare** 完成产品与行业研究。
5. 在 **Notes** 保存观点，并将完整分析结果导出为 Markdown。

## 产品特点

- **侧边栏工作流**：分析过程不离开 YouTube 页面，视频与资料始终保持同步。
- **结构化输出**：重要结果以卡片、列表、表格和 Markdown 文档呈现。
- **本地优先**：设置、笔记、缓存和对比库保存在 Chrome 本地存储。
- **自带 API Key**：直接连接 Supadata 和 DeepSeek，不经过开发者中转服务器。
- **隐私透明**：无账号系统、无广告、无分析统计、无行为追踪。

TubeInsight 是一个通过 GitHub 分发的开源项目，目前未上架 Chrome 应用商店，也不附带第三方 API 额度。

## 让你的编程 Agent 帮你安装

你不需要看懂代码，也不需要会使用命令行。把下面这段话发送给你的编程 Agent：

> 请把这个项目下载或克隆到我选择的长期保留文件夹，告诉我准确的完整路径，并让 Chrome“加载已解压的扩展程序”使用同一个文件夹。如果我在第一次安装时需要位置建议，可以推荐 macOS 或 Linux 上的 `~/Documents/tube-insight`，或 Windows 上的 `%USERPROFILE%\Documents\tube-insight`，但不要假设我一定使用这些路径。请用简单易懂的语言一步一步指导我完成安装和配置。https://github.com/rubyzhao666/tube-insight

你的 Agent 应该帮你：

1. 先询问你想把项目长期保存在哪里，再下载或克隆到那里，并告诉你准确的完整路径。如果你需要建议，可以推荐 macOS 或 Linux 上的 `~/Documents/tube-insight`，或 Windows 上的 `%USERPROFILE%\Documents\tube-insight`。
2. 打开下方 Supadata 和 DeepSeek 官方页面，指导你创建自己的账号。
3. 指导你在 Chrome 中通过“加载已解压的扩展程序”选择你刚才确定的那个准确项目文件夹。
4. 告诉你应该在扩展的“设置”页面哪个位置填写 API Key。
5. 打开一个带字幕的 YouTube 视频，确认字幕和翻译功能可以使用。

安装后请让这个文件夹留在原位。如果移动或删除它，Chrome 中加载的本地扩展会失效，需要从新的长期存放位置重新加载。

不要把 API Key 发送到 AI 对话、源代码、截图或公开消息中。请你自己在 TubeInsight 的设置页面直接填写。编程 Agent 可以告诉你填写位置，但不需要看到 Key。

## 手动安装

如果你想自己操作：

1. 打开 [github.com/rubyzhao666/tube-insight](https://github.com/rubyzhao666/tube-insight)。
2. 点击 **Code**，再选择 **Download ZIP**。
3. 选择一个长期保留的文件夹，并把项目解压到这里。可选建议是 macOS 或 Linux 上的 `~/Documents/tube-insight`，或 Windows 上的 `%USERPROFILE%\Documents\tube-insight`。你也可以使用其他文件夹。
4. 在 Chrome 地址栏打开 `chrome://extensions`。
5. 打开右上角的“开发者模式”。
6. 点击“加载已解压的扩展程序”。
7. 选择你刚才确定的那个准确项目文件夹，其中必须包含 `manifest.json`。
8. 如果需要，可以在 Chrome 扩展菜单中固定 TubeInsight。

这是一个本地加载的扩展，不会自动更新。下载新版或让 Agent 修改代码后，请在 `chrome://extensions` 中找到 TubeInsight 并点击“重新加载”，然后刷新已经打开的 YouTube 页面。如果移动或删除源代码文件夹，Chrome 中加载的扩展会失效，需要从新的位置重新加载。

## 设置 API Key

TubeInsight 需要你在自己的服务账号中准备两个 Key：

1. **Supadata API Key**，用于获取 YouTube 字幕。
2. **DeepSeek API Key**，用于生成概览、讲解内容、翻译和自动润色笔记。

### 获取 Supadata API Key

1. 打开 Supadata 官方[注册页面](https://dash.supadata.ai/auth/sign-up)。
2. 创建账号并完成简短的新手引导。
3. Supadata 会在新手引导过程中自动生成 API Key。
4. 之后可以随时打开 [Supadata 控制台](https://dash.supadata.ai/)查找或管理 Key。
5. 复制 Key，并粘贴到 TubeInsight 设置中的 **Supadata API key**。

如果页面流程发生变化，请查看 [Supadata 官方文档](https://docs.supadata.ai/)。

### 获取 DeepSeek API Key

1. 打开 DeepSeek 官方 [API Keys 页面](https://platform.deepseek.com/api_keys)。
2. 按照提示登录，或创建 DeepSeek 开放平台账号。
3. 点击 **Create new API key**，填写容易识别的名称，例如 `TubeInsight`，然后创建 Key。
4. 立即复制 Key。完整 Key 可能只会显示一次。
5. 把 Key 粘贴到 TubeInsight 设置中的 **DeepSeek API key**。
6. 如果 DeepSeek 提示余额不足，请在 DeepSeek 开放平台账号中充值后再试。

当前账号和接口说明请查看 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/)。

在侧边栏中打开 **Settings**。你也可以在 `chrome://extensions` 的 TubeInsight 卡片中打开扩展选项。Key 只能粘贴到这些设置输入框中。不要把 Key 发送到 AI 对话、项目文件、截图或公开消息中。

发布版本只支持 DeepSeek V4 Flash：

```text
Base URL: https://api.deepseek.com
Model: deepseek-v4-flash
```

TubeInsight 会让所有 DeepSeek 请求使用非思考模式，以获得更快、更稳定的交互。设置中的接口地址和模型固定，只需要填写 DeepSeek API Key。如果想使用其他服务或模型，请在设置中复制安全的自定义 prompt，让编程 Agent 修改你自己的本地副本。不要把任何 API Key 放进 prompt 或对话。

API Key 和设置保存在你设备上的 Chrome 扩展本地存储中。发布包不会包含或使用 `config.js`。

## 使用 TubeInsight

1. 打开一个有字幕的普通 YouTube 视频页面。
2. 点击 TubeInsight 扩展图标，打开侧边栏。
3. 阅读带时间戳的字幕，或选择 **Original**、**中文**、**双语**。
4. 打开 **Overview**，查看 AI 生成的章节和重点引用。
5. 选中字幕，获取 AI 内容讲解。
6. 从播放器或重点引用中保存笔记，之后可以在 **Notes** 中查看。

## 当前支持范围

- Chrome 116 或更高版本。
- 标准的 `youtube.com/watch` 视频页面。
- Supadata 能够返回的原生字幕。TubeInsight 会优先请求英文字幕，也可能显示其他可用的原生语言。
- 原文、简体中文和双语对照字幕。
- AI 概览、选中文本讲解、翻译和自动润色笔记。
- 本地笔记，以及最近字幕、概览和翻译的本地缓存。
- 发布版本的所有 AI 功能都使用 DeepSeek V4 Flash。其他服务需要修改本地代码，不属于发布版本的支持范围。

Shorts、直播、私密视频、受访问限制的视频，以及没有原生字幕的视频可能无法使用。目前没有测试 Firefox、Safari、移动浏览器或其他 Chromium 浏览器。

TubeInsight 强制使用 Supadata 的 `mode=native`，不会在没有原生字幕时请求 AI 生成转录，也不会在本地转录音频。

## Supadata 免费额度和请求成本

截至 2026 年 8 月 9 日，[Supadata 价格页面](https://supadata.ai/pricing)显示免费版每月提供 **100 credits**，不需要信用卡，未使用的额度不会结转。价格可能变化，使用前请查看最新页面。

[Supadata 字幕接口文档](https://docs.supadata.ai/get-transcript)说明了不同模式的计费方式：

- 获取一次原生字幕消耗 **1 credit**，与视频时长无关。
- AI 生成字幕每分钟消耗 **2 credits**。TubeInsight 不会使用这条路径，因为它强制使用 `mode=native`。
- 如果没有可用原生字幕并返回 HTTP `206`，仍会消耗 **1 credit**。

按照当前只获取原生字幕的方式，如果每次请求都成功，免费版每月大约可以查询 100 个视频。重试和没有字幕的查询也会消耗额度，所以实际成功数量可能更少。

DeepSeek 的额度与 Supadata 分开计算。TubeInsight 不收款，也不转售 API 服务。建议为两个账号设置消费上限并定期查看用量。

## DeepSeek V4 Flash 价格

截至 2026 年 8 月 27 日，DeepSeek 官方[价格页面](https://api-docs.deepseek.com/quick_start/pricing/)列出的每 100 万 token 美元价格如下：

| Token 类型 | 非高峰 | 高峰 |
| --- | ---: | ---: |
| 缓存命中输入 | $0.007 | $0.014 |
| 缓存未命中输入 | $0.22 | $0.44 |
| 输出 | $0.66 | $1.32 |

高峰时段为周一至周五 UTC 01:00–04:00 和 06:00–10:00，其他时间使用非高峰价格。

一个实测的 20 分钟英文视频使用约 **32,600 个输入 token**，并在 43 个小批次中产生约 **3,500 到 4,500 个输出 token**。按当前价格，完整翻译该视频的费用约为：

- **非高峰：$0.003 到 $0.010 USD**。
- **高峰：$0.005 到 $0.020 USD**。

低值假设大部分重复输入命中 DeepSeek 缓存，高值假设输入未命中缓存。翻译按需执行并复用缓存，只翻译部分视频时费用会更低。使用前请查看官方页面确认最新价格。

## 使用编程 Agent 扩展 TubeInsight

TubeInsight 使用原生 HTML、CSS 和 JavaScript，没有构建步骤，便于阅读、调试和扩展。你可以 Fork 项目，并让编程 Agent 根据自己的工作流继续开发。

可以尝试：

- 增加更多翻译语言，并让每个人选择自己的学习语言。
- 为课程、访谈、教程、测评或研究视频增加自定义总结模板。
- 增加生词本，保存单词、原句、解释和视频时间戳。
- 把笔记和生词导出到 Markdown、CSV、Anki 或其他学习工具。
- 增加个人主题筛选，只突出与你目标相关的章节。
- 增加本地模型选项，获得不同的隐私和成本方案。
- 改善键盘操作、字体大小和高对比度等无障碍体验。

请让 Agent 保留用户自带 API Key 的模式，不要把秘密写入源代码，并运行下方检查。分享自己的版本前，也要在真实视频上测试。

如果想使用其他 AI 服务或模型，请先在编程 Agent 中打开 Chrome 通过“加载已解压的扩展程序”使用的那个准确的 TubeInsight 项目文件夹。然后打开 TubeInsight 设置并点击 **Copy customization prompt**。发送前替换 `[PROVIDER]` 和 `[MODEL]`，但不要加入任何 API Key。Agent 完成本地代码修改后，请你自己在它指出的设置位置填写 Key。

## 隐私和数据流向

TubeInsight 会直接从扩展向服务商发送请求：

1. 把标准化的 YouTube 视频地址发送给 Supadata，用于获取原生字幕。
2. 当你使用 AI 功能时，把字幕和相关视频信息发送给 DeepSeek。
3. 翻译或讲解等功能只发送当前需要的内容，例如选中的文本和上下文，或少量字幕分段。
4. API Key、设置、笔记和最近缓存保存在 Chrome 本地。

TubeInsight 没有账号系统、广告、分析统计或行为追踪。Supadata 和 DeepSeek 仍会按照各自的条款和隐私政策处理数据。详情请查看 [PRIVACY.md](PRIVACY.md)。

## 常见问题

### YouTube 视频页面没有显示 TubeInsight 按钮

- 在 `chrome://extensions` 中找到 TubeInsight，点击“重新加载”，然后刷新 YouTube 页面。
- 确认当前页面是标准 `https://www.youtube.com/watch?...` 页面，而不是 Shorts、嵌入页面或直播页面。
- 当前版本会在 YouTube 响应式操作栏变化时自动重新定位按钮。页面加载完成后可以稍等片刻。
- 如果你使用的是较早下载的版本，可以先横向调整一次 YouTube 窗口宽度让按钮出现，然后下载最新版，这样之后不再需要调整窗口。
- 如果按钮仍然没有出现，让你的编程 Agent 在这个具体视频页面检查 content script。

### 侧边栏无法打开

- 确认你打开的是标准 `https://www.youtube.com/watch?...` 页面。
- 在 `chrome://extensions` 中确认 TubeInsight 已启用，并点击“重新加载”。
- 重新加载扩展后，刷新 YouTube 页面。
- 如果问题仍然存在，让你的编程 Agent 检查扩展。

### TubeInsight 提示需要设置

- 打开 **Settings**，保存 Supadata Key 和 DeepSeek Key。
- 发布版本固定使用 DeepSeek V4 Flash，没有需要填写的 Base URL 或 Model 字段。
- 如果设置提示旧的自定义服务已移除，请重新填写 DeepSeek Key。旧 AI Key 已安全清除，避免被错误用于 DeepSeek。

### 找不到字幕

- 确认视频是公开的，并且有原生字幕。
- 检查 Supadata Key、剩余额度、限速和账号状态。
- 没有字幕的查询和手动重试也可能消耗额度。

TubeInsight 不会自动改用 AI 生成字幕。

### AI 请求失败

- `401` 或 `403` 通常表示 DeepSeek Key 或账号权限有问题。
- `429` 通常表示达到了 DeepSeek 服务限速或消费上限。
- 确认 Key 来自上方链接的 DeepSeek 开放平台账号，并且账号有可用额度。
- 如果你把本地副本改成了其他模型，请再次使用设置中的自定义 prompt，让编程 Agent 检查本地实现。

不要在对话、截图或日志中分享 API Key、私密字幕或个人笔记。

## 给编程 Agent 的检查命令

修改项目后，让你的编程 Agent 运行：

```bash
npm test
npm run check
npm run package
```

Agent 还应该在 Chrome 中重新加载扩展，并测试多个真实 YouTube 视频。自动检查通过，不代表真实服务请求和 YouTube 交互一定正常。

## 开源许可

MIT，详见 [LICENSE](LICENSE)。
