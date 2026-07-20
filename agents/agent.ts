import OpenAI from "openai";
import * as dotenv from "dotenv";
import { ALL_TOOLS, toolToOpenAI, getTool } from "../tools/index.js";

dotenv.config();

// ── 类型 ──────────────────────────────────────────────────────
type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `你是电商导购专家 Agent，帮助用户选品并生成电商主图和详情页。

## 可用工具
- search_products: 搜索淘宝/京东/抖音热销商品
- ask_user: 向用户提问以了解需求细节
- analyze_market: 深度选品分析（需先有搜索结果和用户需求）
- design_visuals: 设计 5 张电商主图方案（普通主图场景使用）
- design_detail_page: 设计 8 屏详情页方案（用户需要"详情页/长版"时使用此工具替代 design_visuals）
- generate_image: 调用 AI 生成单张图片（默认 gpt-image-2，每张图单独调用一次）
- save_report: 保存完整报告到文件

## 工作原则
1. 先搜索了解市场，再向用户提问细化需求
2. 信息不足时主动问用户，不要猜测。用户说 skip 就自主决策
3. 不要一次问太多问题（1-3个为宜），问完就停、等用户回答
4. 按逻辑顺序推进：搜索 → 问答 → 选品 → 视觉方案 → 逐张生图 → 保存报告
5. 可以回头补充搜索或追加问题，不要僵化执行
6. 每步完成后简要告知用户当前进度

## 详情页流程（用户提到"详情页/长版/详情"时启用）
识别到详情页需求后，必须严格按以下 8 步漏斗执行：

第1屏 → 产品实拍·事实锚点（白底多角度，只展示产品本身）
第2屏 → 卖点翻译·买家顾虑（"担心X？→ 我们有Y"）
第3屏 → 首屏购买理由（一句核心承诺，最强转化屏）
第4屏 → 画面证据（对比图/数据可视化，眼见为实）
第5屏 → 用完麻不麻烦（配件/充电/清洁/保修）
第6屏 → 参数页·购买判断（参数+对你的意义）
第7屏 → 菜单页·降低选择成本（颜色/配置一目了然）
第8屏 → 收官页·串联全篇（产品+Slogan+价格+CTA按钮）

详情页规则：
- 用 design_detail_page 一次性规划全部 8 屏
- 然后逐屏调用 generate_image，每屏一张图
- 所有 8 张图片的 Prompt 必须指定同一款产品，不能换款
- 图片比例统一 3:4（移动端标准）
- 至少生成 3-5 张关键的屏（不要试图生成全部 8 张除非用户明确要求）

## 特殊规则
- 普通主图场景：generate_image 1-2 张即可
- 详情页场景：逐屏 generate_image，至少覆盖首屏/证据/参数/收官
- 必须调用 save_report 保存最终报告`;

// ── Agent ─────────────────────────────────────────────────────
export class EcommerceAgent {
  private llm: OpenAI;
  private messages: Message[] = [];
  private maxTurns = 24;

  constructor() {
    const apiKey = process.env.ONEAPI_API_KEY;
    const baseURL = process.env.ONEAPI_BASE_URL;
    if (!apiKey) throw new Error("缺少 ONEAPI_API_KEY");
    this.llm = new OpenAI({ apiKey, baseURL });
  }

  async run(userGoal: string): Promise<string> {
    this.messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userGoal },
    ];

    console.log("╔══════════════════════════════════════════╗");
    console.log("║   🤖 电商导购 Agent（Tool-Use Loop）    ║");
    console.log("╚══════════════════════════════════════════╝\n");
    console.log(`🎯 目标: ${userGoal}\n`);

    const model = process.env.TEXT_MODEL || "gpt-4o";

    for (let turn = 0; turn < this.maxTurns; turn++) {
      // 调用 LLM
      const res = await this.llm.chat.completions.create({
        model,
        max_tokens: 2048,
        messages: this.messages,
        tools: ALL_TOOLS.map(toolToOpenAI),
        tool_choice: "auto",
      });

      const msg = res.choices[0]?.message;
      const finishReason = res.choices[0]?.finish_reason;

      // Agent 决定停止
      if (finishReason === "stop") {
        const text = msg?.content || "";
        console.log(`\n${"━".repeat(44)}`);
        console.log("✅ Agent 完成任务\n");
        if (text) console.log(text + "\n");
        return text || "完成。";
      }

      // Agent 调用了工具
      if (msg?.tool_calls && msg.tool_calls.length > 0) {
        // 记录 assistant 消息（含 tool_calls）
        this.messages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        });

        if (msg.content) {
          console.log(`💭 ${msg.content.slice(0, 200)}\n`);
        }

        // 逐个执行工具
        for (const tc of msg.tool_calls) {
          const toolName = tc.function.name;
          const tool = getTool(toolName);

          let args: Record<string, unknown>;
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = {};
          }

          console.log(`🔧 调用工具: ${toolName}`);
          if (toolName !== "ask_user") {
            console.log(`  参数: ${JSON.stringify(args).slice(0, 150)}`);
          }

          let result: string;
          if (!tool) {
            result = `错误：未知工具 "${toolName}"`;
          } else {
            try {
              result = await tool.execute(args);
            } catch (e: unknown) {
              result = `工具执行失败: ${e instanceof Error ? e.message : String(e)}`;
            }
          }

          // 工具结果塞回消息
          this.messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });

          console.log(`📋 结果: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}\n`);
        }

        // 继续下一轮
        continue;
      }

      // 异常情况：既没 stop 也没 tool_calls
      console.log(`⚠️  未知 finish_reason: ${finishReason}`);
      break;
    }

    return "Agent 达到最大轮次限制，任务可能未完成。请重试或简化需求。";
  }
}
