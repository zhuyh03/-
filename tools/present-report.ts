import type { ToolDef } from "./index.js";
import { GlobalCallbacks } from "./callbacks.js";

export const presentReportTool: ToolDef = {
  name: "present_report",
  description:
    "将选品分析报告展示给用户编辑。在完成 analyze_market 后、开始 design_visuals 或 generate_image 之前必须调用此工具。用户可以在报告上直接修改产品定位、卖点、人群、定价等关键信息，Agent 将基于编辑后的报告继续后续步骤。",
  parameters: {
    type: "object",
    properties: {
      report_content: {
        type: "string",
        description:
          "选品分析报告全文，包含：推荐产品、定价区间、目标人群、3个USP卖点、竞品分析、总结。用易读的格式组织。",
      },
    },
    required: ["report_content"],
  },

  async execute(args: Record<string, unknown>) {
    const report = args.report_content as string;
    if (!report) return "报告内容为空，请重新生成。";

    if (!GlobalCallbacks.reportDraft) {
      return "报告已生成（CLI 模式跳过编辑）。\n\n" + report;
    }

    const editedReport = await GlobalCallbacks.reportDraft(report);
    if (!editedReport || editedReport.trim() === report.trim()) {
      return "用户未修改报告，使用原始版本继续。\n\n" + report;
    }
    return "用户编辑后的报告：\n\n" + editedReport;
  },
};
