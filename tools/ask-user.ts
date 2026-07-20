import * as readline from "readline";
import type { ToolDef } from "./index.js";

export const askUserTool: ToolDef = {
  name: "ask_user",
  description:
    "向用户提问以了解更详细的需求。当需要明确用户场景、预算、偏好或任何信息不足时使用。一次最多问 3 个问题。用户可输入 'skip' 跳过。",
  parameters: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: { type: "string" },
        description: "要问的问题列表，1-3个。问题应具体、有针对性。",
      },
    },
    required: ["questions"],
  },

  async execute(args: Record<string, unknown>) {
    const questions = args.questions as string[];
    if (!questions || questions.length === 0) {
      return "没有问题需要询问。";
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answers: string[] = [];
    let skipped = false;

    console.log("\n💬 Agent 想了解更多：");

    for (let i = 0; i < questions.length; i++) {
      if (skipped) break;

      // 同时等待用户输入或 stdin 关闭（管道场景）
      const answer = await new Promise<string>((resolve) => {
        let settled = false;
        const done = (val: string) => {
          if (!settled) { settled = true; resolve(val); }
        };
        rl.question(`\n  Q${i + 1}: ${questions[i]}\n  > `, done);
        // 管道 EOF 时自动降级为 skip
        rl.on("close", () => done("skip"));
      });

      if (answer.trim().toLowerCase() === "skip") {
        skipped = true;
        console.log("  ⏭️  跳过剩余问题\n");
      } else if (answer.trim()) {
        answers.push(`Q: ${questions[i]}\nA: ${answer.trim()}`);
      }
    }

    rl.close();

    if (answers.length === 0) {
      return "用户选择跳过问答，请根据已有信息自主决策。";
    }

    return "用户回复：\n\n" + answers.join("\n\n");
  },
};
