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

export const designDetailPageTool: ToolDef = {
  name: "design_detail_page",
  description:
    "为电商详情页设计完整的 8 屏图片方案。工具返回方案草稿，并等待用户在界面中确认/修改后，再将最终方案返回给你。",
  parameters: {
    type: "object",
    properties: {
      product_name: { type: "string", description: "产品名称" },
      usps: { type: "string", description: "核心卖点" },
      target_audience: { type: "string", description: "目标人群" },
      price_range: { type: "string", description: "定价" },
    },
    required: ["product_name", "usps"],
  },

  async execute(args: Record<string, unknown>) {
    const productName = args.product_name as string;
    const usps = args.usps as string;
    const target = (args.target_audience as string) || "通用人群";
    const price = (args.price_range as string) || "";

    const systemInstruction = `你是顶级电商详情页策划师。为产品"${productName}"设计 8 屏详情页。

## 8 步详情页漏斗
1. 产品实拍·事实锚点
2. 卖点翻译·买家顾虑
3. 首屏购买理由
4. 画面证据
5. 用完麻不麻烦
6. 参数页·购买判断
7. 菜单页·降低选择成本
8. 收官页·把整组图串起来

每屏 Prompt 用英文，120-180 词。所有图片 aspect_ratio "3:4"。`;

    const userPrompt = `产品: ${productName}\n卖点: ${usps}\n人群: ${target}\n定价: ${price}

输出 JSON：
{
  "detail_page_strategy": "整体详情页策略（100字）",
  "screens": [
    {
      "step": 1,
      "title": "第1屏标题",
      "purpose": "转化目标",
      "scene_description": "画面描述",
      "prompt": "英文 Prompt"
    }
  ]
}`;

    let text = "";
    try {
      const res = await llm().chat.completions.create({
        model: process.env.TEXT_MODEL || "gpt-4o",
        max_tokens: 8192,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }, { signal: currentSignal });

      text = res.choices[0]?.message?.content || "";
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return "⏹️ 已被用户停止。";
      throw e;
    }

    // 格式化给用户看的内容
    let draftForUser = text;
    try {
      const data = JSON.parse(text);
      const parts = [`📋 详情页策略：${data.detail_page_strategy || ""}\n`];
      for (const s of (data.screens || [])) {
        parts.push(`【第${s.step}屏 - ${s.title}】\n目标：${s.purpose}\n场景：${s.scene_description}\nPrompt：${s.prompt}\n`);
      }
      draftForUser = parts.join("\n");
    } catch { }

    if (!GlobalCallbacks.visualsDraft) {
      return "✅ 详情页方案已生成：\n\n" + draftForUser + "\n\n(原始JSON数据附后)\n" + text;
    }

    const editedDraft = await GlobalCallbacks.visualsDraft(draftForUser);

    return "✅ 以下是用户确认并修改后的详情页方案。请严格按照这个编辑后的方案内容提取 Prompt 调用 generate_image：\n\n" + editedDraft;
  },
};
