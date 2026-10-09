// 产品情报雷达 Prompt
// 用途：先判断视频是否为产品相关内容；产品类提炼结构化产品情报，非产品类提炼核心方法论
// 调用方式：将 {transcript} 替换为实际字幕文本

export const PRODUCT_INTELLIGENCE_PROMPT = `
你是一名资深 AI 产品经理，擅长从视频内容中快速提炼产品情报和可复用的方法论。

请基于以下 YouTube 视频字幕内容，先判断内容类型，再输出对应的结构化分析。

【字幕内容】
{transcript}

【第一步：判断内容类型】
- product（产品相关）：视频主要在介绍、演示、评测、对比某个具体产品、工具、服务或商业项目，或在讨论产品设计、产品策略、商业模式。
- methodology（非产品相关）：视频主要是人物访谈、经验分享、训练方法、学习方法、行业观点或人生思考等，没有以某个具体产品为主题。
- 只在视频中顺带提及某个产品（例如片头赞助、配音技术说明、广告）时，不能据此判定为 product。

【第二步：按内容类型输出】
请严格按照以下 JSON 格式输出，不要输出任何其他内容：

{
  "content_type": "product 或 methodology",
  "content_type_reason": "一句话说明判断依据",
  "one_line_summary": "product 类：一句话总结视频的核心产品价值；methodology 类：一句话总结视频的核心方法论",

  "product_features": ["功能点（一句话描述）"],
  "user_pain_points": ["用户痛点（一句话描述）"],
  "competitor_info": ["竞品信息（竞品名 + 关键信息）"],
  "business_model_keywords": ["商业模式关键词"],

  "core_methodologies": ["方法论名称：一句话说明它是什么、怎么做"],
  "key_principles": ["关键原则或执行要点（一句话描述）"],
  "application_scenarios": ["可迁移的应用场景，例如如何借鉴到产品、团队或个人成长中"],
  "methodology_keywords": ["方法论关键词"]
}

【字段规则】
- content_type 为 product 时：填写 product_features、user_pain_points、competitor_info、business_model_keywords；四个方法论字段返回空数组 []
- content_type 为 methodology 时：填写 core_methodologies、key_principles、application_scenarios、methodology_keywords；四个产品字段返回空数组 []

【注意事项】
- 所有输出使用中文
- 每个数组最多输出 5 条，优先选择最有价值的信息
- 如果某个维度在视频中没有相关内容，对应数组返回空数组 []
- 方法论必须来自视频中人物的实际讲述或做法，不要套用通用道理
- 不要编造视频中没有提及的信息
- 输出必须是合法 JSON，可以被 JSON.parse() 正确解析，不要包含任何 Markdown 代码块标记
`;
