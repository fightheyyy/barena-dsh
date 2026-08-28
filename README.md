# Barena for DeepSeek Harness

一个独立安装、原生嵌入 DeepSeek Harness（DSH）的 Agent Preset 配对评估插件。

Barena 固定模型、任务与验证条件，只切换 baseline / candidate Agent Preset；每次尝试都创建新的顶层 DSH Agent 和独立工作区，并由 DSH 默认 `AgentLoop` 完成。最终输出可复查的 Session 证据、通过率、稳定性、观察提升与四态结论：

- `improved`
- `no_effect`
- `regressed`
- `insufficient_evidence`

> 结论只描述候选 preset 在当前用例上的表现，不声称某个插件普遍更好。

## 已实现

- 可安装的 DSH Bundle，Host 与 Web Client 在同一个包中。
- DSH 左侧栏 Logo 下方的一级 Barena 入口，点击后在主内容区打开完整评估工作台。
- DSH「设置 → 插件 → Barena 评估」次级入口，无需修改或重新编译 DSH 前端。
- 自动发现当前 DSH Agent Preset。
- A/B 交替顺序复跑，降低始终先跑同一组造成的时序偏差。
- 两组使用同一份 DSH 默认模型选择。
- 每次尝试使用全新 Session id 与独立 workspace。
- 通过 `ctx.agents.create()` 和 `ctx.agentPresets.mount()` 运行，不导入、不替换 `dsh-agent-loop`。
- 基于最终 assistant 文本的确定性包含验证器（大小写不敏感）。
- 持久化 run、attempt、原生 Session id、最终回复、turn end reason 和耗时。
- 中英文界面、键盘焦点、窄容器与 reduced-motion 适配。

## 本地安装

要求 Node.js `^22.19.0 || >=24.0.0`、pnpm，以及一个已可运行的 DSH checkout。

```bash
cd /path/to/barena-dsh
pnpm install
pnpm check

# 把 Bundle 安装进 DSH Web profile
dsh plugin --profile web add /absolute/path/to/barena-dsh

# 添加或更新 Bundle 后重启 profile
dsh web
```

如果你直接从 DSH 源码运行 CLI：

```bash
cd /path/to/deepseek-harness
pnpm install --frozen-lockfile
pnpm build

node apps/cli/lib/bin.js plugin --profile web add /absolute/path/to/barena-dsh
node apps/cli/lib/bin.js web --no-open
```

安装成功后打开 DSH，点击左侧栏 Logo 下方的「Barena」；「设置 → 插件 → Barena 评估」也保留为次级入口。先在 DSH 中准备至少两个健康的 Agent Preset，再选择基线与候选、填写同一任务和目标文本并启动实验。

开发时使用目录依赖安装，DSH profile 会以 `link:` 指向本仓库；修改代码后运行 `pnpm build` 并刷新 DSH 页面即可。发布到 registry 后，同一命令也可以直接使用包名。

## 什么可以被公平比较

当前 MVP 的实验变量是 **Agent Preset**。适合比较 preset 内不同的：

- 工具及其配置
- system prompt / persona
- skills
- Agent-scoped 插件组合

Host-global 插件会影响同一 DSH 进程里的两组，不能被本模式隔离。因此本版本不会伪装成“任意 Host 插件开关 A/B”。后续若支持 Host-global 评估，应为两组启动独立 DSH profile / 进程，同时保持当前证据 schema。

## 评估协议

一次请求示例：

```json
{
  "baselinePreset": "standard",
  "candidatePreset": "my-plugin",
  "case": {
    "name": "Create the release marker",
    "prompt": "Create RELEASE_OK.txt containing ready, then report completion.",
    "expectedText": "ready"
  },
  "attempts": 3,
  "timeoutMs": 180000
}
```

执行顺序会按 replay 轮换：`A1 → B1 → B2 → A2 → A3 → B3`。每个 attempt 走 DSH 默认 loop，结束后读取原生 Session events 中最后一条 assistant message 与最后一个 turn-end reason。

聚合规则：

- 候选通过率下降：`regressed`
- 候选通过率上升且候选稳定通过：`improved`
- 通过率相同：`no_effect`
- 任一组 blocked / incomplete，或提升但候选仍 flaky：`insufficient_evidence`

所有证据默认写入：

```text
$DSH_HOME/barena/runs/<run-id>/
├── run.json
├── attempts/baseline/<n>.json
├── attempts/candidate/<n>.json
└── workspaces/<arm>-<n>/
```

## HTTP API

Web Client 只访问同源接口：

- `GET /barena/api/snapshot`
- `POST /barena/api/runs`
- `GET /barena/api/runs/:runId`

POST 会拒绝跨站浏览器请求，请求体限制为 128 KiB。默认最多每组 5 次、单次最多 10 分钟，可在 Bundle config 中下调。

## 开发

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm pack --dry-run
```

主要文件：

```text
src/core.ts          纯数据契约、验证、排程与聚合
src/index.ts         DSH Host runtime、默认 loop 编排、持久化与 HTTP API
src/client/index.tsx DSH 侧栏入口、主工作台、Plugins tab 与 A/B 证据界面
cordis.patch.yml     Bundle Host patch
scripts/build.mjs    Host ESM + DSH lazy-CJS Client 构建
test/core.test.ts    纯内核回归测试
```

## 当前限制

- 验证器是最终文本包含检查，适合 smoke case，不替代任务级代码测试或领域评审。
- 同一进程只允许一个实验运行，避免模型资源竞争污染结果。
- 没有配置模型或 API Key 时，两组会保留为 `blocked` 证据并给出 `insufficient_evidence`，不会制造通过结果。
- DSH 仍处于 alpha；本仓库当前按本地验证的 `0.1.2-alpha.1` Client Module 与插件契约实现。
- DSH `0.1.2-alpha.1` 尚未提供 Logo 与“新会话”之间的公开插槽；当前版本通过官方 `shell.overlay` 注册，并以结构锚点 Portal 到该位置，不依赖中文文案或 CSS Module 类名。未来出现官方一级导航插槽后应直接迁移。

## License

MIT
