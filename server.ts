import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import multer from "multer";
import { EcommerceAgent, type AgentEvent } from "./agents/agent.js";

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// 静态文件
app.use(express.static(path.resolve("public")));
app.use("/images", express.static(path.resolve("storage/images")));
app.use("/uploads", express.static(path.resolve("storage/uploads")));

// 图片上传配置
const uploadDir = path.resolve("storage/uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".png";
      const name = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ext;
      cb(null, name);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── 上传接口 ──────────────────────────────────────────────
app.post("/upload", upload.array("images", 3), (req, res) => {
  const files = req.files as Express.Multer.File[];
  console.log(`📤 收到上传请求: ${files?.length || 0} 个文件`);
  if (!files || files.length === 0) {
    console.log("   ⚠️ 未接收到文件（可能字段名不匹配或文件为空）");
    return res.status(400).json({ error: "未接收到图片" });
  }
  const paths = files.map((f) => {
    const full = path.join(uploadDir, f.filename);
    console.log(`   ✅ ${f.originalname} → ${f.filename} (${f.size} bytes, 存在: ${fs.existsSync(full)})`);
    return f.filename;
  });
  res.json({ filenames: paths });
});

// ── 会话管理（以 clientId 为 key，断线重连不丢失）─────────
interface Session {
  agent: EcommerceAgent | null;
  controller: AbortController | null;
}

const sessions = new Map<string, Session>();

function getSession(clientId: string): Session {
  if (!sessions.has(clientId)) {
    sessions.set(clientId, { agent: null, controller: null });
  }
  return sessions.get(clientId)!;
}

// ── 工具函数：读取图片为 Base64 ───────────────────────────
function imageToBase64(filename: string): string | null {
  console.log(`🔍 查找图片: "${filename}"`);
  try {
    const p = path.join(uploadDir, filename);
    if (fs.existsSync(p)) {
      console.log(`   ✅ 在 uploads/ 找到`);
      return imageToBase64FromPath(p);
    }
    const alt = path.join(path.resolve("storage/images"), filename);
    if (fs.existsSync(alt)) {
      console.log(`   ✅ 在 images/ 找到`);
      return imageToBase64FromPath(alt);
    }
    console.log(`   ❌ 未找到（已检查 storage/uploads/ 和 storage/images/）`);
    return null;
  } catch (e) {
    console.log(`   ❌ 异常: ${(e as Error).message}`);
    return null;
  }
}

function imageToBase64FromPath(filePath: string): string | null {
  try {
    const buf = fs.readFileSync(filePath);
    // 超过 10MB 的图片拒绝（Base64 会 ×1.33）
    if (buf.length > 10 * 1024 * 1024) {
      console.log(`⚠️ 图片过大: ${filePath} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
      return null;
    }
    // 靠文件头魔数识别 MIME
    const head = buf.slice(0, 4);
    let mime = "image/jpeg";
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) mime = "image/png";
    else if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) mime = "image/webp";
    else if (head[0] === 0xff && head[1] === 0xd8) mime = "image/jpeg";
    else if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) mime = "image/gif";
    const b64 = buf.toString("base64");
    console.log(`🖼️ 图片编码: ${path.basename(filePath)} (${(buf.length / 1024).toFixed(0)}KB → ${(b64.length / 1024).toFixed(0)}KB base64)`);
    return `data:${mime};base64,${b64}`;
  } catch (e) {
    console.log(`❌ 图片编码失败: ${filePath} — ${(e as Error).message}`);
    return null;
  }
}

io.on("connection", (socket) => {
  console.log(`🔌 连接: ${socket.id}`);

  // ── 注册 clientId ─────────────────────────────────────
  socket.on("register", (clientId: string) => {
    // 将 socket 绑定到 clientId
    (socket as any).clientId = clientId;
    console.log(`🆔 注册: ${clientId} (socket: ${socket.id})`);
  });

  function getClientId(): string {
    return (socket as any).clientId || socket.id;
  }

  // ── 首次启动 / 重置后启动 ─────────────────────────────
  socket.on("start", async (data: { goal: string; imageCount?: number; refImages?: string[] }) => {
    const goal = data.goal?.trim();
    if (!goal) {
      socket.emit("agent_event", { type: "error", message: "请输入目标" });
      return;
    }

    const cid = getClientId();
    const session = getSession(cid);

    if (session.controller) session.controller.abort();

    const controller = new AbortController();
    session.controller = controller;

    // 读取参考图 Base64 并记录真实文件名
    const refDataList: { filename: string; base64: string }[] = [];
    if (data.refImages) {
      for (const f of data.refImages) {
        const b64 = imageToBase64(f);
        if (b64) refDataList.push({ filename: f, base64: b64 });
      }
    }

    console.log(`🚀 Agent 启动: ${goal} (图片: ${data.imageCount || "不限"}, 参考图: ${refDataList.length})`);

    const agent = new EcommerceAgent({
      signal: controller.signal,
      onEvent: (event: AgentEvent) => socket.emit("agent_event", event),
      onUserQuestion: (questions: string[]) => {
        if (controller.signal.aborted) return Promise.resolve("skip");
        return new Promise((resolve) => {
          socket.emit("agent_event", { type: "question", questions } as AgentEvent);
          socket.once("answer", (d: { answers: string[]; skipped: boolean }) => {
            if (d.skipped) resolve("skip");
            else resolve(questions.map((q, i) => `Q: ${q}\nA: ${d.answers[i] || "(空)"}`).join("\n\n"));
          });
        });
      },
      onReportDraft: (report: string) => {
        if (controller.signal.aborted) return Promise.resolve(report);
        return new Promise((resolve) => {
          socket.emit("agent_event", { type: "report_draft", content: report } as AgentEvent);
          socket.once("report_confirm", (d: { confirmed: boolean; edited_report?: string }) => {
            if (d.confirmed && d.edited_report) resolve(d.edited_report);
            else resolve(report);
          });
        });
      },
      onVisualsDraft: (draft: string) => {
        if (controller.signal.aborted) return Promise.resolve(draft);
        return new Promise((resolve) => {
          socket.emit("agent_event", { type: "visuals_draft", content: draft } as AgentEvent);
          socket.once("report_confirm", (d: { confirmed: boolean; edited_report?: string }) => {
            if (d.confirmed && d.edited_report) resolve(d.edited_report);
            else resolve(draft);
          });
        });
      },
    });

    session.agent = agent;

    try {
      await agent.run(goal, data.imageCount, refDataList.length > 0 ? refDataList : undefined);
    } catch (e: unknown) {
      socket.emit("agent_event", { type: "error", message: (e as Error).message || String(e) });
    } finally {
      session.controller = null;
    }
  });

  // ── 继续对话（记忆模式）────────────────────────────────
  socket.on("continue", async (data: { message: string; refImages?: string[] }) => {
    const msg = data.message?.trim();
    if (!msg) return;

    const cid = getClientId();
    const session = getSession(cid);
    const agent = session.agent;

    // 修复报错：如果没有 Agent 实例，当作首次启动
    if (!agent) {
      console.log(`💡 无 Agent 实例，转为首次启动: ${msg}`);
      socket.emit("agent_event", { type: "message", text: "🔄 检测到新会话，已为您重新启动 Agent..." });
      socket.emit("start", { goal: msg, refImages: data.refImages });
      return;
    }

    if (session.controller) session.controller.abort();
    const controller = new AbortController();
    session.controller = controller;
    agent.updateSignal(controller.signal);

    // 读取参考图
    const refDataList: { filename: string; base64: string }[] = [];
    if (data.refImages) {
      for (const f of data.refImages) {
        const b64 = imageToBase64(f);
        if (b64) refDataList.push({ filename: f, base64: b64 });
      }
    }

    console.log(`💬 Agent 继续: ${msg} (参考图: ${refDataList.length})`);

    try {
      await agent.continueChat(msg, refDataList.length > 0 ? refDataList : undefined);
    } catch (e: unknown) {
      socket.emit("agent_event", { type: "error", message: (e as Error).message || String(e) });
    } finally {
      session.controller = null;
    }
  });

  // ── 停止 ──────────────────────────────────────────────
  socket.on("stop", () => {
    const session = getSession(getClientId());
    if (session.controller) {
      session.controller.abort();
      session.controller = null;
    }
    socket.emit("agent_event", { type: "done", summary: "⏹️ 已停止。" });
  });

  // ── 重置 ──────────────────────────────────────────────
  socket.on("reset", () => {
    const session = getSession(getClientId());
    if (session.controller) {
      session.controller.abort();
      session.controller = null;
    }
    session.agent = null;
    console.log(`🔄 会话重置: ${getClientId()}`);
  });

  socket.on("disconnect", () => {
    // 不删除 session，保留 agent 以便重连
    console.log(`🔌 断开: ${socket.id} (client: ${getClientId()})`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n🛒 电商导购 Agent 已启动`);
  console.log(`   地址: http://localhost:${PORT}\n`);
});
