import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ALL_TOOLS, toolToOpenAI, getTool } from "../tools/index.js";
import { GlobalCallbacks } from "../tools/callbacks.js";

dotenv.config();

// 模块级 AbortSignal，供工具（如 generate-image）读取
export let currentSignal: AbortSignal | undefined;

// 模块级参考图路径（绝对路径），供 generate_image 尝试图生图
export let currentReferenceImages: string[] = [];

export function setReferenceImages(paths: string[]) {
  currentReferenceImages = paths;
}

// ── 事件类型 ──────────────────────────────────────────────────
export type AgentEvent =
  | { type: "message"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; preview: string }
  | { type: "report_draft"; content: string }
  | { type: "visuals_draft"; content: string }
  | { type: "image"; path: string; filename: string }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

export interface AgentOptions {
  onEvent?: (event: AgentEvent) => void;
  onUserQuestion?: (questions: string[]) => Promise<string>;
  onReportDraft?: (report: string) => Promise<string>;
  onVisualsDraft?: (draft: string) => Promise<string>;
  signal?: AbortSignal;
}

// ── 类型 ──────────────────────────────────────────────────────
type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function buildSystemPrompt(imageCount?: number, hasRefImage?: boolean): string {
  const countHint = imageCount && imageCount > 0
    ? `\n## 本次生图数量限制\n用户指定了生图数量上限：${imageCount} 张。请严格按此数量规划 generate_image 调用。`
    : "";

  const refImageRules = hasRefImage
    ? `\n## ⚠️ 参考图强制规则（最高优先级）
用户上传了产品参考图。你必须：
1. 仔细观察参考图中产品的：形状、材质、颜色、品牌标识、接口位置、比例。
2. 将所有 generate_image 的 Prompt 设计为：**把参考图中的这个产品，原封不动地放到不同场景中**。
3. 生图 Prompt 必须包含对参考图产品外观的详细描述（颜色、形状、材质、特征细节），确保生成的产品和参考图一致。
4. 绝对不能改变产品外观、颜色、形状、品牌标志。只能改变背景、光照、角度、场景。
5. 如果生成了不符合参考图的图片，用户指出后你必须重新生成。`
    : "";

  return `你是电商导购专家 Agent，帮助用户选品并生成电商主图和详情页。

## 可用工具
- search_products: 搜索淘宝/京东/抖音热销商品
- ask_user: 向用户提问以了解需求细节
- analyze_market: 深度选品分析（需先有搜索结果和用户需求）
- present_report: 将选品报告展示给用户在右侧面板编辑确认（必须在 analyze_market 之后、design_visuals 之前调用）
- design_visuals: 设计 5 张电商主图方案（普通主图场景使用）。调用后工具会把方案草稿发给用户编辑确认，你将收到用户修改后的方案，必须严格按照编辑后的方案内容调用 generate_image
- design_detail_page: 设计 8 屏详情页方案（用户需要"详情页/长版"时使用此工具替代 design_visuals）。调用后方案草稿会发给用户编辑，必须按用户确认后的方案调用 generate_image
- generate_image: 调用 AI 生成单张图片（默认 gpt-image-2，每张图单独调用一次）
- combine_detail_page: 将多张已生成的图片垂直拼接成一张1024×3072的详情页长图。支持本地路径、文件名、HTTP URL 作为输入。当用户输入中包含文件名、路径或图片 URL 时直接传入即可。
- save_report: 保存完整报告到文件

## 工作原则
1. 先搜索了解市场，再向用户提问细化需求
2. 信息不足时主动问用户，不要猜测。用户说 skip 就自主决策
3. 不要一次问太多问题（1-3个为宜），问完就停、等用户回答
4. 按逻辑顺序推进：搜索 → 问答 → 选品(analyze_market) → **present_report(用户编辑确认)** → 视觉方案 → 逐张生图 → 保存报告
4a. ⚠️ 选品分析完成后，必须调用 present_report 让用户编辑确认，等用户确认后再继续
5. 可以回头补充搜索或追加问题，不要僵化执行
6. 每步完成后简要告知用户当前进度

## 对话记忆
你会记住之前对话中的所有内容（选品结果、生成的图片、用户偏好）。
如果用户对之前的图片不满意、要求修改，直接调用 generate_image 重新生成，不需要重新搜索或分析。
如果用户问"上一张图"或"刚才的图片"，你能引用之前生成的结果。

## ⛔ 产品主体一致性（最高优先级，违反即为失败）
你必须确保生成的所有图片中的产品外观完全一致。方法如下：

### 第一步：定义产品身份卡
在任何 generate_image 调用之前，你必须先整理一份「产品身份卡」，包含：
- 产品类型（如"入耳式真无线耳机"）
- 外观形状（如"圆角方形充电盒，正面有LED指示灯"）
- 颜色（如"耳机本体为哑光黑色，充电盒为深灰色"）
- 材质（如"耳机为磨砂塑料，充电盒为铝合金"）
- 关键特征（如"耳机柄外侧有银色品牌Logo，耳塞为硅胶材质"）
- 尺寸比例（如"充电盒约为手掌一半大小"）

### 第二步：身份卡嵌入每个 Prompt
每次调用 generate_image 时，Prompt 的开头必须包含身份卡的完整英文翻译，格式为：
"【PRODUCT SPECS - DO NOT CHANGE: (产品详细描述)】"
然后才是场景描述。

例如：
"【PRODUCT SPECS - DO NOT CHANGE: A pair of matte black true wireless earbuds with silver brand logo on the stem, oval-shaped dark gray aluminum charging case with LED indicator on front, silicone ear tips. The charging case is approximately half palm size.】In a bright coffee shop setting, natural lighting..."

### 第三步：不同场景只变背景
- 身份卡部分在每个 Prompt 中保持 100% 一致（复制粘贴）
- 只有背景、光照、角度、场景描述可以变化
- 如果用户上传了参考图，身份卡必须基于参考图中的实际产品外观来写
- 如果无法读取参考图（API 返回错误），不要假装看到了。直接告诉用户"无法读取图片，请文字描述产品外观"，然后根据用户的文字描述来构建身份卡
- 如果用户对某张图不满意要求修改，也只改场景部分，不动身份卡

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
- 所有图片的 Prompt 必须指定同一款产品，不能换款
- 图片比例统一 3:4（移动端标准）
- 至少生成 3-5 张关键的屏

## 特殊规则
- 普通主图场景：generate_image 1-2 张即可
- 详情页场景：逐屏 generate_image，至少覆盖首屏/证据/参数/收官
- 当用户要求"组合为长图"或"拼成详情页"时，先生成各屏图片，再调用 combine_detail_page 拼接
- 必须调用 save_report 保存最终报告${countHint}${refImageRules}`;
}

// ── Agent ─────────────────────────────────────────────────────
export class EcommerceAgent {
  private llm: OpenAI;
  private messages: Message[] = [];
  private maxTurns = 24;
  private onEvent?: (event: AgentEvent) => void;
  private signal?: AbortSignal;
  private turnCount = 0;

  constructor(options?: AgentOptions) {
    const apiKey = process.env.ONEAPI_API_KEY;
    const baseURL = process.env.ONEAPI_BASE_URL;
    if (!apiKey) throw new Error("缺少 ONEAPI_API_KEY");
    this.llm = new OpenAI({ apiKey, baseURL });
    this.onEvent = options?.onEvent;
    this.signal = options?.signal;
    currentSignal = options?.signal;

    if (options?.onUserQuestion) {
      GlobalCallbacks.askUser = options.onUserQuestion;
    }
    if (options?.onReportDraft) {
      GlobalCallbacks.reportDraft = options.onReportDraft;
    }
    if (options?.onVisualsDraft) {
      GlobalCallbacks.visualsDraft = options.onVisualsDraft;
    }
  }

  // 更新中止信号（用于 continue 模式）
  updateSignal(signal?: AbortSignal) {
    this.signal = signal;
    currentSignal = signal;
  }

  private emit(event: AgentEvent) {
    this.onEvent?.(event);
  }

  // ── 首次启动 ──────────────────────────────────────────────
  async run(userGoal: string, imageCount?: number, refImages?: { filename: string; base64: string }[]): Promise<string> {
    // 构建带图片的用户消息
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: userGoal },
    ];
    let sysHint = "";
    if (refImages && refImages.length > 0) {
      // 存储参考图绝对路径，供 generate_image 尝试图生图
      const absPaths = refImages.map(r => path.resolve("storage/uploads", r.filename));
      setReferenceImages(absPaths.filter(p => fs.existsSync(p)));

      sysHint = `\n\n【系统提示：用户刚刚上传了 ${refImages.length} 张图片，如果你需要调用 \`combine_detail_page\` 拼接它们，请直接使用以下真实路径传入 image_paths 数组中：\n` +
        refImages.map(r => `  - storage/uploads/${r.filename}`).join("\n") + "\n】";
      userContent[0].text += sysHint;

      for (const img of refImages) {
        userContent.push({
          type: "image_url",
          image_url: { url: img.base64, detail: "high" },
        });
      }
    } else {
      setReferenceImages([]);
    }

    this.messages = [
      { role: "system", content: buildSystemPrompt(imageCount, !!refImages?.length) },
      { role: "user", content: userContent },
    ];
    this.turnCount = 0;

    this.emit({ type: "message", text: `🎯 目标: ${userGoal}${refImages ? ` (带图 ${refImages.length} 张)` : ""}` });
    return this.loop();
  }

  // ── 继续对话（记忆模式）─────────────────────────────────────
  async continueChat(userMessage: string, refImages?: { filename: string; base64: string }[]): Promise<string> {
    if (this.messages.length === 0) {
      return this.run(userMessage, undefined, refImages);
    }

    // 构建带图片的用户消息
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: userMessage },
    ];
    let sysHint = "";
    if (refImages && refImages.length > 0) {
      // 追加存储参考图绝对路径
      const absPaths = refImages.map(r => path.resolve("storage/uploads", r.filename));
      setReferenceImages([...currentReferenceImages, ...absPaths.filter(p => fs.existsSync(p))]);

      sysHint = `\n\n【系统提示：用户刚刚追加上传了 ${refImages.length} 张图片，如果你需要拼接它们，请使用真实路径：\n` +
        refImages.map(r => `  - storage/uploads/${r.filename}`).join("\n") + "\n】";
      userContent[0].text += sysHint;

      for (const img of refImages) {
        userContent.push({
          type: "image_url",
          image_url: { url: img.base64, detail: "high" },
        });
      }
    }

    this.messages.push({ role: "user", content: userContent });
    this.turnCount = 0;

    this.emit({ type: "message", text: `💬 用户: ${userMessage}${refImages ? ` (带图 ${refImages.length} 张)` : ""}` });
    return this.loop();
  }

  // ── 核心循环 ──────────────────────────────────────────────
  private async loop(): Promise<string> {
    const model = process.env.TEXT_MODEL || "gpt-4o";

    for (let turn = this.turnCount; turn < this.maxTurns; turn++) {
      this.turnCount = turn;

      if (this.signal?.aborted) {
        this.emit({ type: "message", text: "⏹️ Agent 已被用户停止。" });
        this.emit({ type: "done", summary: "已停止。" });
        return "已停止。";
      }

      const res = await this.llm.chat.completions.create({
        model,
        max_tokens: 2048,
        messages: this.messages,
        tools: ALL_TOOLS.map(toolToOpenAI),
        tool_choice: "auto",
      }, {
        signal: this.signal,
      });

      const msg = res.choices[0]?.message;
      const finishReason = res.choices[0]?.finish_reason;

      if (finishReason === "stop") {
        const text = msg?.content || "";
        // 只发 done，不发 message —— 避免前端显示两条相同内容
        this.emit({ type: "done", summary: text || "完成。" });
        return text || "完成。";
      }

      if (msg?.tool_calls && msg.tool_calls.length > 0) {
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
          this.emit({ type: "message", text: msg.content.slice(0, 300) });
        }

        for (const tc of msg.tool_calls) {
          // 每个工具执行前检查是否已停止
          if (this.signal?.aborted) {
            this.emit({ type: "message", text: "⏹️ Agent 已被用户停止。" });
            this.emit({ type: "done", summary: "已停止。" });
            return "已停止。";
          }

          const toolName = tc.function.name;
          const tool = getTool(toolName);

          let args: Record<string, unknown>;
          try { args = JSON.parse(tc.function.arguments); }
          catch { args = {}; }

          this.emit({ type: "tool_call", name: toolName, args });

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

          this.emit({
            type: "tool_result",
            name: toolName,
            preview: result.slice(0, 500),
          });

          const imgMatch = result.match(/已保存[：:]\s*(.+\.png)/i);
          if (imgMatch) {
            const fullPath = imgMatch[1];
            const filename = fullPath.split(/[/\\]/).pop() || fullPath;
            this.emit({ type: "image", path: fullPath, filename });
          }

          this.messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }
        continue;
      }

      this.emit({ type: "error", message: `未知 finish_reason: ${finishReason}` });
      break;
    }

    this.emit({ type: "done", summary: "Agent 达到最大轮次限制。" });
    return "Agent 达到最大轮次限制。";
  }
}
