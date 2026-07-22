import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import type { ToolDef } from "./index.js";

// ── 智能解析图片路径 ──────────────────────────────────────────
// 按优先级尝试：1) 绝对路径 2) storage/images/ 3) storage/uploads/ 4) HTTP URL 下载
async function resolveImage(raw: string): Promise<{ found: boolean; absPath: string; detail: string }> {
  // 去掉引号和首尾空白
  let input = raw.trim().replace(/^["']|["']$/g, "");

  // ── 1. 绝对路径 ──────────────────────────────────────────
  if ((input.startsWith("/") || /^[A-Z]:[/\\]/i.test(input)) && fs.existsSync(input)) {
    return { found: true, absPath: input, detail: "本地绝对路径" };
  }

  // ── 2. storage/images/ 目录 ──────────────────────────────
  const imagesDir = path.resolve("storage/images");
  const imgPath = path.join(imagesDir, input);
  if (fs.existsSync(imgPath)) {
    return { found: true, absPath: imgPath, detail: "已生成图片" };
  }

  // ── 3. storage/uploads/ 目录 ─────────────────────────────
  const uploadsDir = path.resolve("storage/uploads");
  const upPath = path.join(uploadsDir, input);
  if (fs.existsSync(upPath)) {
    return { found: true, absPath: upPath, detail: "上传图片" };
  }

  // ── 4. 相对路径（相对于 cwd）──────────────────────────────
  const relPath = path.resolve(input);
  if (fs.existsSync(relPath)) {
    return { found: true, absPath: relPath, detail: "相对路径" };
  }

  // ── 5. HTTP(S) URL ──────────────────────────────────────
  if (/^https?:\/\//i.test(input)) {
    try {
      const resp = await fetch(input);
      if (!resp.ok) return { found: false, absPath: "", detail: `URL HTTP ${resp.status}` };
      const buffer = Buffer.from(await resp.arrayBuffer());
      // 保存到 storage/images/
      const urlFilename = "dl_" + Date.now() + "_" + (input.split("/").pop() || "img.png");
      const dlPath = path.join(imagesDir, urlFilename);
      fs.writeFileSync(dlPath, buffer);
      return { found: true, absPath: dlPath, detail: "从URL下载" };
    } catch {
      return { found: false, absPath: "", detail: "URL下载失败" };
    }
  }

  return { found: false, absPath: "", detail: "未找到（已尝试：绝对路径、storage/images/、storage/uploads/、相对路径）" };
}

// ── 主工具 ──────────────────────────────────────────────────
export const combineDetailPageTool: ToolDef = {
  name: "combine_detail_page",
  description:
    "将多张已生成的图片垂直拼接成一张电商详情页长图（宽1024px，高3072px）。支持输入：本地路径、storage/images/文件名、storage/uploads/文件名、HTTP URL。在用户要求'组合为长图'或'拼成详情页'时使用。",
  parameters: {
    type: "object",
    properties: {
      image_paths: {
        type: "array",
        items: { type: "string" },
        description: "要拼接的图片来源（本地路径、文件名、或 HTTP URL，按从上到下顺序）",
      },
      product_name: {
        type: "string",
        description: "产品名称（用于文件命名）",
      },
    },
    required: ["image_paths", "product_name"],
  },

  async execute(args: Record<string, unknown>) {
    const imageInputs = args.image_paths as string[];
    const productName = ((args.product_name as string) || "detail").replace(/[/\\?%*:|"<>]/g, "_");

    if (!imageInputs || imageInputs.length === 0) {
      return (
        "❌ 没有指定要拼接的图片。\n\n" +
        "请提供图片来源，支持以下格式：\n" +
        "  • 之前生成的图片文件名（如 product_lifestyle_xxx.png）\n" +
        "  • 上传的图片文件名（如 abc123.png）\n" +
        "  • 完整的本地路径（如 C:\\Users\\...\\image.png）\n" +
        "  • HTTP 图片链接（如 https://example.com/img.png）"
      );
    }

    // ── 逐个解析图片 ──────────────────────────────────────
    const resolved: { absPath: string; input: string; detail: string }[] = [];
    const failed: { input: string; detail: string }[] = [];

    for (const raw of imageInputs) {
      const r = await resolveImage(raw);
      if (r.found) {
        resolved.push({ absPath: r.absPath, input: raw, detail: r.detail });
      } else {
        failed.push({ input: raw, detail: r.detail });
      }
    }

    if (resolved.length === 0) {
      const failReport = failed.map((f) => `  ✗ "${f.input}" → ${f.detail}`).join("\n");
      return (
        `❌ 所有 ${imageInputs.length} 张图片都无法读取：\n\n${failReport}\n\n` +
        `💡 提示：\n` +
        `  • 如果是刚生成的图片，请使用右侧面板显示的文件名\n` +
        `  • 如果是网络图片，请确保 URL 以 http:// 或 https:// 开头且可公开访问\n` +
        `  • 或者使用左侧 📷 按钮上传图片后再操作`
      );
    }

    if (failed.length > 0) {
      const failWarn = failed.map((f) => `  ⚠️ "${f.input}" → ${f.detail}`).join("\n");
      console.log(`⚠️ ${failed.length}/${imageInputs.length} 张图片无法读取:\n${failWarn}`);
    }

    // ── 拼接 ──────────────────────────────────────────────
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = path.resolve("storage/images");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `detail_long_${productName}_${timestamp}.png`);

    try {
      const CANVAS_WIDTH = 1024;
      const CANVAS_HEIGHT = 3072;
      const perImageHeight = Math.floor(CANVAS_HEIGHT / resolved.length);
      const buffers: Buffer[] = [];

      for (let i = 0; i < resolved.length; i++) {
        const img = sharp(resolved[i].absPath);
        const meta = await img.metadata();
        const origW = meta.width || CANVAS_WIDTH;
        const origH = meta.height || perImageHeight;
        const scale = CANVAS_WIDTH / origW;
        const scaledHeight = Math.round(origH * scale);

        let processed: sharp.Sharp;
        if (scaledHeight >= perImageHeight) {
          processed = img
            .resize(CANVAS_WIDTH, scaledHeight, { fit: "fill" })
            .extract({ left: 0, top: 0, width: CANVAS_WIDTH, height: perImageHeight });
        } else {
          processed = img
            .resize(CANVAS_WIDTH, scaledHeight, { fit: "fill" })
            .extend({
              bottom: perImageHeight - scaledHeight,
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            });
        }
        buffers.push(await processed.png().toBuffer());
      }

      // 补齐高度
      const totalHeight = buffers.length * perImageHeight;
      if (totalHeight < CANVAS_HEIGHT && buffers.length > 0) {
        const extendBy = CANVAS_HEIGHT - totalHeight;
        buffers[buffers.length - 1] = await sharp(buffers[buffers.length - 1])
          .extend({ bottom: extendBy, background: { r: 255, g: 255, b: 255, alpha: 1 } })
          .png()
          .toBuffer();
      }

      const compositeLayers = buffers.map((buf, i) => ({
        input: buf,
        top: i * perImageHeight,
        left: 0,
      }));

      await sharp({
        create: {
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .composite(compositeLayers)
        .png()
        .toFile(outputPath);

      const srcReport = resolved.map((r) => `  ✓ "${r.input}" (${r.detail})`).join("\n");
      return (
        `✅ 详情页长图已生成：${outputPath}\n` +
        `   尺寸：${CANVAS_WIDTH}×${CANVAS_HEIGHT}\n` +
        `   包含 ${resolved.length} 张图片：\n${srcReport}`
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return `❌ 拼接失败: ${msg}`;
    }
  },
};
