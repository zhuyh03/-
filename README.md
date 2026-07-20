# 🛒 电商导购 AI Agent

> 输入一句话需求，AI 自主完成市场搜索 → 用户对话 → 选品分析 → 视觉设计 → 生图 → 保存报告。

**不是固定流程的管道，而是 LLM 自主决策的 Tool-Use Agent。**

## 演示

```
$ npm start "帮我为200-400元价位的蓝牙耳机做详情页"

 Agent: search_products("蓝牙耳机")        → Top10 商品
 Agent: ask_user("预算？品牌？功能？")     → 用户回答
 Agent: analyze_market("漫步者LolliPods Pro")
 Agent: design_detail_page(...)            → 8 屏详情页方案
 Agent: generate_image("第1屏 产品实拍")   → 🖼️
 Agent: generate_image("第4屏 降噪证据")   → 🖼️
 Agent: generate_image("第6屏 参数页")     → 🖼️
 Agent: save_report(...)                   → 📄 完整报告
 Agent: "完成！"                           → 自主停止
```

每一步都是 Agent 自己决定的——搜什么、问什么、生成几张图、何时停。

## 快速开始

```bash
# 1. 克隆
git clone https://github.com/yourname/ecommerce-agent.git
cd ecommerce-agent

# 2. 安装
npm install

# 3. 配置 API Key
cp .env.example .env
# 编辑 .env，填入你的 ONEAPI_API_KEY

# 4. 运行
npm start "帮我为夏季防晒用品做电商选品和主图"
```

Agent 运行时会主动向你提问，在终端直接回答即可。输入 `skip` 跳过让 Agent 自主决策。

## 它能做什么

| 场景 | 示例命令 |
|------|----------|
| 选品分析 + 主图 | `npm start "分析露营装备市场，生成带货主图"` |
| 完整详情页 | `npm start "为XX产品做一版长详情页，要8屏"` |
| 市场调研 | `npm start "看看宠物用品在抖音什么好卖"` |

## 工具箱

Agent 有 7 个工具，按需自主调用：

| 工具 | 用途 |
|------|------|
| `search_products` | 搜索热销商品 |
| `ask_user` | 向用户提问（信息不足时） |
| `analyze_market` | 深度选品分析 |
| `design_visuals` | 普通主图方案 |
| `design_detail_page` | 8 屏详情页方案 |
| `generate_image` | AI 生图（gpt-image-2） |
| `save_report` | 保存报告 |

## 详情页 8 步漏斗

当用户提到"详情页"时，Agent 自动启用：

```
第1屏  产品实拍     → 只展示产品，建立事实锚点
第2屏  卖点→顾虑    → "担心降噪差？→ 40dB深度降噪"
第3屏  购买理由     → 一句话核心承诺
第4屏  画面证据     → 前后对比，眼见为实
第5屏  麻不麻烦     → 配件/充电/保修
第6屏  参数页       → 参数 + 对你的意义
第7屏  菜单页       → 颜色/配置降低选择成本
第8屏  收官页       → 串联全篇 + CTA
```

## 架构

```
main.ts                     ← 入口（一行启动）
agents/agent.ts             ← 核心 Agent Loop（LLM 决策 + 工具调度）
tools/
  ├── search-products.ts    ← 搜索热销商品
  ├── ask-user.ts           ← 向用户提问
  ├── analyze-market.ts     ← 深度选品分析
  ├── design-visuals.ts     ← 普通主图方案
  ├── design-detail-page.ts ← 8屏详情页方案
  ├── generate-image.ts     ← API 生图
  └── save-report.ts        ← 保存报告
```

## 环境变量

```bash
# .env
ONEAPI_API_KEY=sk-xxx              # 必填：API Key
ONEAPI_BASE_URL=https://xxx/v1     # API 地址
TEXT_MODEL=gpt-4o                  # 文本模型
IMAGE_MODEL=gpt-image-2            # 生图模型
```

API 需支持 OpenAI 兼容的 `/v1/chat/completions`（含 function calling）和 `/v1/images/generations` 端点。

## License

MIT
