import OpenAI from "openai";
import type { ToolDef } from "./index.js";
import { currentSignal } from "../agents/agent.js";
import { GlobalCallbacks } from "./callbacks.js";

function llm() {
  return new OpenAI({
    apiKey: process.env.ONEAPI_API_KEY!,
    baseURL: process.env.ONEAPI_BASE_URL,
  });
}

export const designVisualsTool: ToolDef = {
  name: "design_visuals",
  description:
    "为选定产品设计电商主图方案，生成 5 张不同场景类型的 Prompt。工具返回方案草稿，并等待用户在界面中确认/修改后，再将最终方案返回给你。",
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
    }
  ]
}`;

    let text = "";
    try {
      const res = await llm().chat.completions.create({
        model: process.env.TEXT_MODEL || "gpt-4o",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }, { signal: currentSignal });

      text = res.choices[0]?.message?.content || "";
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return "⏹️ 已被用户停止。";
      throw e;
    }

    // 格式化出清晰易读的纯文本给用户编辑
    let draftForUser = text;
    try {
      const data = JSON.parse(text);
      const parts = [`🎨 视觉策略：${data.visual_strategy || ""}\n`];
      for (let i = 0; i < (data.images || []).length; i++) {
        const img = data.images[i];
        parts.push(`【图${i + 1} - ${img.scene_type}】\n描述：${img.scene_description}\nPrompt：${img.prompt}\n`);
      }
      draftForUser = parts.join("\n");
    } catch {
      // JSON 解析失败则使用原始文本
    }

    if (!GlobalCallbacks.visualsDraft) {
      return "✅ 视觉方案已生成：\n\n" + draftForUser + "\n\n(原始JSON数据附后)\n" + text;
    }

    const editedDraft = await GlobalCallbacks.visualsDraft(draftForUser);

    return "✅ 以下是用户确认并修改后的视觉方案。请严格按照这个编辑后的方案内容提取 Prompt 调用 generate_image：\n\n" + editedDraft;
  },
};
