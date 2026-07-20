import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import type { ToolDef } from "./index.js";

export const generateImageTool: ToolDef = {
  name: "generate_image",
  description:
    "生成电商产品主图。默认使用 gpt-image-2 模型（高质量AI生图），也可通过 model 参数指定 doubao-seedream-5.0。每次调用生成一张图。",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "英文绘图 Prompt" },
      product_name: { type: "string", description: "产品名称（用于文件命名）" },
      scene_type: { type: "string", description: "场景类型，如 lifestyle/studio/detail" },
      model: {
        type: "string",
        enum: ["gpt-image-2", "doubao-seedream-5.0"],
        description: "生图模型，默认 gpt-image-2",
      },
    },
    required: ["prompt", "product_name", "scene_type"],
  },

  async execute(args: Record<string, unknown>) {
    const prompt = args.prompt as string;
    const productName = (args.product_name as string).replace(/[/\\?%*:|"<>]/g, "_");
    const sceneType = args.scene_type as string;
    const model = (args.model as string) || process.env.IMAGE_MODEL || "gpt-image-2";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const llm = new OpenAI({
      apiKey: process.env.ONEAPI_API_KEY!,
      baseURL: process.env.ONEAPI_BASE_URL,
    });

    const outputDir = path.resolve("storage/images");
    fs.mkdirSync(outputDir, { recursive: true });
    const filename = `${productName}_${sceneType}_${timestamp}.png`;
    const outputPath = path.join(outputDir, filename);

    const size = model === "doubao-seedream-5.0" ? "2048x2048" : "1024x1024";

    try {
      const res = await llm.images.generate({
        model,
        prompt,
        n: 1,
        size: size as "1024x1024" | "2048x2048",
        response_format: "url",
      });

      const imageUrl = res.data[0]?.url;
      if (imageUrl) {
        const resp = await fetch(imageUrl);
        const buffer = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(outputPath, buffer);
        return `✅ 图片已生成并保存：${outputPath}`;
      }
      return `⚠️ API 返回了结果但未包含图片 URL。`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return `❌ 生图失败: ${msg}\n请尝试换一个 prompt 或稍后重试。`;
    }
  },
};
