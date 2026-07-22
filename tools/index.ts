// 工具注册表 — Agent 可调用的所有工具
import { searchProductsTool } from "./search-products.js";
import { askUserTool } from "./ask-user.js";
import { analyzeMarketTool } from "./analyze-market.js";
import { designVisualsTool } from "./design-visuals.js";
import { designDetailPageTool } from "./design-detail-page.js";
import { presentReportTool } from "./present-report.js";
import { combineDetailPageTool } from "./combine-detail-page.js";
import { generateImageTool } from "./generate-image.js";
import { saveReportTool } from "./save-report.js";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export const ALL_TOOLS: ToolDef[] = [
  searchProductsTool,
  askUserTool,
  analyzeMarketTool,
  designVisualsTool,
  presentReportTool,
  designDetailPageTool,
  combineDetailPageTool,
  generateImageTool,
  saveReportTool,
];

export function toolToOpenAI(t: ToolDef) {
  return {
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  };
}

export function getTool(name: string): ToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}
