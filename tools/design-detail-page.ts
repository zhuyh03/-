import OpenAI from "openai";
import type { ToolDef } from "./index.js";

function llm() {
  return new OpenAI({
    apiKey: process.env.ONEAPI_API_KEY!,
    baseURL: process.env.ONEAPI_BASE_URL,
  });
}

export const designDetailPageTool: ToolDef = {
  name: "design_detail_page",
  description:
    "为电商详情页设计完整的 8 屏图片方案。当用户需要详情页/长版时使用，替代 design_visuals。每屏有明确的转化目标：抓眼球→建信任→促成交。",
  parameters: {
    type: "object",
    properties: {
      product_name: {
        type: "string",
        description: "产品名称，如'漫步者LolliPods Pro'",
      },
      usps: {
        type: "string",
        description: "产品核心卖点，逗号分隔",
      },
      target_audience: {
        type: "string",
        description: "目标人群画像",
      },
      price_range: {
        type: "string",
        description: "定价区间",
      },
      competitor_context: {
        type: "string",
        description: "竞品对比参考（可选）",
      },
    },
    required: ["product_name", "usps"],
  },

  async execute(args: Record<string, unknown>) {
    const productName = args.product_name as string;
    const usps = args.usps as string;
    const target = (args.target_audience as string) || "通用人群";
    const price = (args.price_range as string) || "";
    const competitor = (args.competitor_context as string) || "";

    const systemInstruction = `你是顶级电商详情页策划师。为产品"${productName}"设计 8 屏详情页。

## 8 步详情页漏斗

### 第 1 屏：产品实拍 / 事实锚点
- 目标：只看产品本身，提取可见事实（外观、材质、接口、尺寸感）
- 如果用户未上传产品图，选该品类的标杆产品为范本
- Prompt 方向：纯白/灰背景，产品多角度展示，清晰看到所有物理特征

### 第 2 屏：卖点翻译 → 买家顾虑
- 目标：把每个 USP 翻译成买家心里的担忧，然后一一回应
- 格式："担心 X？→ 我们有 Y"
- Prompt 方向：左右分屏或图标+文字排版，左边写顾虑，右边写解决方案

### 第 3 屏：首屏购买理由
- 目标：一句话讲清楚"凭什么买它"，形成核心购买理由
- 这是整个详情页最重要的转化屏
- Prompt 方向：产品居中，大标题文字，强视觉冲击，突出一个核心承诺

### 第 4 屏：可视窗口 → 画面证据
- 目标：把功能演示做成视觉证据（对比图、动效示意、数据可视化）
- 买家不相信说的，只相信看到的
- Prompt 方向：对比展示（使用前/后、有/无此功能），或数据可视化图表+产品

### 第 5 屏：清理冗要 → "用完麻不麻烦"
- 目标：回答售后顾虑——好不好清理、充电麻烦吗、配件好买吗、保修怎样
- 这是降低决策阻力的关键屏
- Prompt 方向：展示配件全家福、充电场景、清洁方式、保修标签

### 第 6 屏：参数页 → 购买判断
- 目标：用规格参数帮买家做最后判断
- 不是罗列数据，而是"这些参数对你意味着什么"
- Prompt 方向：简洁参数表+产品图，每个参数附一行"对您的意义"

### 第 7 屏：菜单页 → 降低选择成本
- 目标：多 SKU 时帮买家快速决策（颜色、配置、套装）
- 如果是单品，展示搭配建议或使用场景菜单
- Prompt 方向：颜色/配置并列展示，标注差异和推荐款

### 第 8 屏：收官页 → 把整组图串起来
- 目标：回顾全篇，形成完整叙事，给出行动号召
- 包含：产品+Slogan+价格+行动按钮（"立即购买"/"加入购物车"）
- Prompt 方向：产品+全套配件+品牌 Slogan，底部价格和 CTA 按钮文字

## 关键规则
1. 所有 8 屏必须使用同一款产品（${productName}），不能换款
2. 每屏 Prompt 用英文，120-180 词，包含构图/光影/材质/情绪
3. 所有图片 aspect_ratio 为 "3:4"（移动端详情页标准比例）
4. negative_prompt 统一为英文`;

    const userPrompt = `【产品信息】
产品: ${productName}
卖点: ${usps}
人群: ${target}${price ? `\n定价: ${price}` : ""}${competitor ? `\n竞品: ${competitor}` : ""}

请输出 8 屏方案，严格按此 JSON 格式：
{
  "product_name": "${productName}",
  "detail_page_strategy": "整体详情页策略（100字）",
  "screens": [
    {
      "step": 1,
      "title": "第1屏标题（中文，如：产品实拍·所见即所得）",
      "purpose": "本屏转化目标（20字内）",
      "scene_description": "画面描述（中文，50字）",
      "prompt": "英文AI绘图Prompt（120-180词）",
      "negative_prompt": "英文负面提示词",
      "aspect_ratio": "3:4"
    }
    // ... 共 8 屏
  ]
}`;

    const res = await llm().chat.completions.create({
      model: process.env.TEXT_MODEL || "gpt-4o",
      max_tokens: 8192,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    });

    const text = res.choices[0]?.message?.content || "";

    try {
      const data = JSON.parse(text);
      const screens = data.screens || [];
      let summary = `📋 详情页策略: ${data.detail_page_strategy || "未指定"}\n\n`;
      summary += `共 ${screens.length} 屏：\n\n`;

      for (const s of screens) {
        summary += `第${s.step}屏「${s.title}」— ${s.purpose}\n`;
        summary += `  场景: ${s.scene_description}\n`;
        summary += `  Prompt: ${(s.prompt || "").slice(0, 100)}...\n\n`;
      }

      summary += `\n完整 JSON（供 generate_image 逐屏调用）:\n${text}`;
      return summary;
    } catch {
      return text;
    }
  },
};
