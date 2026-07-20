import OpenAI from "openai";
import type { ToolDef } from "./index.js";

function llm() {
  return new OpenAI({
    apiKey: process.env.ONEAPI_API_KEY!,
    baseURL: process.env.ONEAPI_BASE_URL,
  });
}

export const designVisualsTool: ToolDef = {
  name: "design_visuals",
  description:
    "为选定产品设计电商主图方案，生成 5 张不同场景类型（lifestyle/studio/comparison/detail/banner）的英文 Prompt。在选品分析完成后使用。",
  parameters: {
    type: "object",
    properties: {
      product_name: { type: "string", description: "产品名称" },
      usps: { type: "string", description: "产品核心卖点，逗号分隔" },
      target_audience: { type: "string", description: "目标人群" },
    },
    required: ["product_name", "usps"],
  },

  async execute(args: Record<string, unknown>) {
    const productName = args.product_name as string;
    const usps = args.usps as string;
    const target = (args.target_audience as string) || "通用人群";

    const prompt = `你是顶级电商视觉设计专家。为产品"${productName}"设计5张主图方案。
卖点: ${usps} | 人群: ${target}

输出 JSON：
{
  "product_name": "产品名",
  "visual_strategy": "整体视觉策略（50字）",
  "images": [
    {
      "scene_type": "lifestyle",
      "scene_description": "中文场景描述",
      "prompt": "英文AI绘图Prompt（60-120词，含构图/光影/材质/情绪/相机参数）",
      "negative_prompt": "英文负面提示词",
      "aspect_ratio": "1:1"
    }...
  ]
}`;

    const res = await llm().chat.completions.create({
      model: process.env.TEXT_MODEL || "gpt-4o",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const text = res.choices[0]?.message?.content || "";
    try {
      const data = JSON.parse(text);
      const imgs = (data.images || []).map(
        (img: { scene_type: string; scene_description: string; prompt: string }, i: number) =>
          `  图${i + 1} [${img.scene_type}]: ${img.scene_description}\n    Prompt: ${img.prompt?.slice(0, 120)}...`
      );
      return (
        `🎨 视觉方案：${data.visual_strategy}\n\n图片方案：\n${imgs.join("\n\n")}\n\n完整 JSON：\n${text}`
      );
    } catch {
      return text;
    }
  },
};
