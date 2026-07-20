import * as fs from "fs";
import * as path from "path";
import type { ToolDef } from "./index.js";

export const saveReportTool: ToolDef = {
  name: "save_report",
  description:
    "将选品分析和视觉方案的完整报告保存到 storage/reports/ 目录。在全部分析和生图完成后使用。",
  parameters: {
    type: "object",
    properties: {
      report_content: {
        type: "string",
        description: "完整报告内容（包含选品分析、视觉方案、生成结果等），纯文本格式",
      },
      title: { type: "string", description: "报告标题/产品名" },
    },
    required: ["report_content", "title"],
  },

  async execute(args: Record<string, unknown>) {
    const content = args.report_content as string;
    const title = (args.title as string).replace(/[/\\?%*:|"<>]/g, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const reportDir = path.resolve("storage/reports");
    fs.mkdirSync(reportDir, { recursive: true });

    const filename = `report_${title}_${timestamp}.txt`;
    const filePath = path.join(reportDir, filename);

    const header =
      `${"=".repeat(60)}\n` +
      `  电商导购选品分析报告\n` +
      `${"=".repeat(60)}\n` +
      `标题: ${title}\n生成时间: ${new Date().toLocaleString("zh-CN")}\n\n`;

    fs.writeFileSync(filePath, header + content, "utf-8");

    return `✅ 报告已保存：${filePath}`;
  },
};
