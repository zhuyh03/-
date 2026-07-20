import OpenAI from "openai";
import type { ToolDef } from "./index.js";

function llm() {
  return new OpenAI({
    apiKey: process.env.ONEAPI_API_KEY!,
    baseURL: process.env.ONEAPI_BASE_URL,
  });
}

export const searchProductsTool: ToolDef = {
  name: "search_products",
  description:
    "搜索淘宝、京东、抖音等平台指定品类的热销商品，返回销量和好评率最高的商品列表。在分析市场前使用此工具。",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string", description: "商品品类，如'防晒霜'、'蓝牙耳机'" },
      count: { type: "number", description: "返回数量，默认 10" },
    },
    required: ["category"],
  },

  async execute(args: Record<string, unknown>) {
    const category = args.category as string;
    const count = (args.count as number) || 10;

    const prompt = `列出"${category}"品类在淘宝、京东、抖音商城中销量最高且好评率最高的 ${count} 款热销产品。
使用真实品牌名称和合理价格。直接输出 JSON：

{
  "products": [
    { "rank": 1, "name": "品牌 产品名", "price": "¥XX-XX", "sales": "XX万+", "rating": "XX%", "platform": "淘宝/京东/抖音" }
  ]
}`;

    const res = await llm().chat.completions.create({
      model: process.env.TEXT_MODEL || "gpt-4o",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const text = res.choices[0]?.message?.content || "";
    try {
      const data = JSON.parse(text);
      const products = data.products || [];
      if (products.length === 0) {
        return `未找到 "${category}" 的相关商品，请尝试调整品类关键词。`;
      }
      return products
        .map(
          (p: { rank: number; name: string; price: string; sales: string; rating: string; platform: string }) =>
            `${p.rank}. [${p.platform}] ${p.name} — ${p.price} | 销量 ${p.sales} | ⭐${p.rating}`
        )
        .join("\n");
    } catch {
      return text.slice(0, 2000);
    }
  },
};
