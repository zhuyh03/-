import OpenAI from "openai";
import type { ToolDef } from "./index.js";

function llm() {
  return new OpenAI({
    apiKey: process.env.ONEAPI_API_KEY!,
    baseURL: process.env.ONEAPI_BASE_URL,
  });
}

export const analyzeMarketTool: ToolDef = {
  name: "analyze_market",
  description:
    "对指定产品进行深度选品分析，输出：推荐单品、定价区间、目标人群、3个差异化卖点(USP)、竞品弱点和分析总结。在收集到足够的产品和用户需求信息后使用。",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string", description: "商品品类" },
      context: {
        type: "string",
        description: "已有的市场搜索结果和用户需求描述的摘要，用于精准分析",
      },
    },
    required: ["category", "context"],
  },

  async execute(args: Record<string, unknown>) {
    const category = args.category as string;
    const context = args.context as string;

    const prompt = `你是一位资深电商市场战略专家，专精 TikTok Shop / 抖音电商选品分析。

类目："${category}"
已有信息：${context}

请深度选品分析，输出 JSON：
{
  "category": "类目",
  "recommended_product": "具体单品名称",
  "price_range": "建议定价区间",
  "target_audience": "目标人群画像（年龄/性别/场景）",
  "usps": [
    { "point": "卖点", "pain_point": "痛点", "visual_hint": "视觉线索" },
    { "point": "卖点", "pain_point": "痛点", "visual_hint": "视觉线索" },
    { "point": "卖点", "pain_point": "痛点", "visual_hint": "视觉线索" }
  ],
  "competitor_weakness": "竞品最薄弱环节",
  "summary": "分析总结（80字内）"
}`;

    const res = await llm().chat.completions.create({
      model: process.env.TEXT_MODEL || "gpt-4o",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const text = res.choices[0]?.message?.content || "";
    // 直接返回 JSON 给 Agent
    try {
      const data = JSON.parse(text);
      return (
        `📊 选品分析结果：\n` +
        `推荐单品: ${data.recommended_product}\n` +
        `定价: ${data.price_range}\n` +
        `人群: ${data.target_audience}\n` +
        `卖点: ${data.usps?.map((u: { point: string }) => u.point).join(" / ")}\n` +
        `竞品弱点: ${data.competitor_weakness}\n` +
        `总结: ${data.summary}\n` +
        `\n完整 JSON 供后续步骤使用：\n${text}`
      );
    } catch {
      return text;
    }
  },
};
