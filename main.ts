import * as dotenv from "dotenv";
import { EcommerceAgent } from "./agents/agent.js";

dotenv.config();

// ── 入口 ────────────────────────────────────────────────────────
const goal = process.argv.slice(2).join(" ") || "";

if (!goal) {
  console.log("用法: npm start <你的需求>");
  console.log('示例: npm start "帮我为夏季防晒用品做电商选品和主图"');
  console.log('      npm start "分析蓝牙耳机市场，生成带货主图"');
  console.log('      npm start "我想在抖音卖宠物用品，帮我选品+做图"');
  console.log("");
  console.log("Agent 会自主决定：搜索市场 → 向你提问 → 选品分析 → 设计视觉方案 → 生图 → 保存报告");
  console.log("你可以随时输入 skip 跳过 Agent 的提问。");
  process.exit(0);
}

const agent = new EcommerceAgent();
agent.run(goal).catch((e) => {
  console.error("\n❌ Agent 执行失败:", e.message);
  console.error(e.stack);
  process.exit(1);
});
