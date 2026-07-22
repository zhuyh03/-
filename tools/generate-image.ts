import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import type { ToolDef } from "./index.js";
import { currentSignal, currentReferenceImages } from "../agents/agent.js";

// 把参考图压到 1MB 以下，避免 OneAPI 前置 nginx 返回 413
// （images.edit 走 multipart 上传原图，超过 client_max_body_size 会被拒）
async function shrinkForEdit(filePath: string): Promise<Buffer> {
  const raw = fs.readFileSync(filePath);
  const resizeOpts = { width: 1024, height: 1024, fit: "inside" as const, withoutEnlargement: true };

  // 先试 PNG（保留透明度）
  let out = await sharp(raw).rotate().resize(resizeOpts).png().toBuffer();
  // 仍超过 900KB → 转 JPEG（质量 85，通常 100~300KB）
  if (out.length > 900 * 1024) {
    out = await sharp(raw).rotate().resize(resizeOpts).jpeg({ quality: 85 }).toBuffer();
  }
  return out;
}

export const generateImageTool: ToolDef = {
  name: "generate_image",
  description:
    "生成电商产品主图。默认使用 gpt-image-2 模型。如果用户上传了参考图，工具会自动尝试图生图（保持产品像素一致），失败则回退到文生图。每次调用生成一张图。",
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
    const signal = currentSignal;

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

    // ── 兜底一致性检查 ──────────────────────────────────────
    const hasProductSpecs = /PRODUCT SPECS|product specs|产品外观|product identity/i.test(prompt);
    const hasDetailedDescription = prompt.length > 200;
    if (!hasProductSpecs && !hasDetailedDescription) {
      return (
        `⚠️ 一致性风险：Prompt 缺少产品外观详细描述。\n` +
        `请确保每个 generate_image 的 Prompt 包含产品的形状、颜色、材质、品牌标识位置、尺寸比例。\n` +
        `当前 Prompt: ${prompt.slice(0, 100)}...`
      );
    }

    // ── 优先：图生图（有参考图时）──────────────────────────
    const refImages = currentReferenceImages.filter((p) => fs.existsSync(p));
    if (refImages.length > 0) {
      console.log(`🖼️ 尝试图生图（参考图 ${refImages.length} 张）...`);
      try {
        // 压缩参考图到 1MB 以下，规避 OneAPI 前置 nginx 的 413 限制
        const shrunkImages = await Promise.all(refImages.slice(0, 4).map((p) => shrinkForEdit(p)));
        console.log(`   📦 压缩后: ${shrunkImages.map(b => (b.length / 1024).toFixed(0) + "KB").join(", ")}`);
        const editResult = await llm.images.edit({
          model,
          image: shrunkImages,
          prompt: `${prompt}\n\nIMPORTANT: Keep the product in the reference image EXACTLY the same (same shape, color, material, logo, proportions). Only change the background/scene/lighting/angle as described above.`,
          n: 1,
          size: size as "1024x1024" | "2048x2048",
        });

        const imgData = editResult.data?.[0];
        if (imgData?.url) {
          const resp = await fetch(imgData.url, { signal });
          const buffer = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(outputPath, buffer);
          return `✅ 图生图完成（产品保持参考图一致性）：${outputPath}`;
        }
        if (imgData?.b64_json) {
          fs.writeFileSync(outputPath, Buffer.from(imgData.b64_json, "base64"));
          return `✅ 图生图完成（产品保持参考图一致性）：${outputPath}`;
        }
        console.log("⚠️ 图生图无返回数据，回退到文生图...");
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return "⏹️ 生图已被用户停止。";
        }
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`⚠️ 图生图失败（${msg}），回退到文生图...`);
      }
    }

    // ── 回退：文生图 ──────────────────────────────────────
    try {
      const res = await llm.images.generate({
        model,
        prompt,
        n: 1,
        size: size as "1024x1024" | "2048x2048",
        response_format: "url",
      }, {
        signal,
      });

      const imageUrl = res.data[0]?.url;
      if (imageUrl) {
        const resp = await fetch(imageUrl, { signal });
        const buffer = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(outputPath, buffer);
        const refNote = refImages.length > 0 ? "（文生图模式，产品一致性依赖文字描述）" : "";
        return `✅ 图片已生成并保存：${outputPath}${refNote}`;
      }
      return `⚠️ API 返回了结果但未包含图片 URL。`;
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return "⏹️ 生图已被用户停止。";
      }
      const msg = e instanceof Error ? e.message : String(e);
      return `❌ 生图失败: ${msg}\n请尝试换一个 prompt 或稍后重试。`;
    }
  },
};
