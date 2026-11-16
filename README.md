# API 消耗确认 · dsh-api-spend-gate

> DeepSeek Harness（DSH）插件：在会消耗 API 余额的工具运行前先弹窗征求同意，批准一次即覆盖本轮剩余调用。

## 解决什么问题

在 DSH 里，模型推理与工具调用可能消耗你的账户余额。`subagent`、`workflow` 这类工具会派生出额外的模型推理，成倍放大开销。本插件在**工具真正执行之前**用 DSH 自带的审批弹窗拦住它们，让你决定是否放行——而不是事后看账单才后悔。

## 工作原理

```
模型决定调用 subagent
        │
        ▼
tools/pre-execute  ──►  插件检查：受管工具？本轮已授权？
        │                     │否
        │                     ▼
        │            ctx.approval.request()  ──►  审批弹窗
        │                     │
        │         ┌───────────┴───────────┐
        │      允许                      拒绝/取消/不可用
        │         │                         │
        │   记入本轮授权                 拒绝执行（fail closed）
        ▼
     执行工具  ◄──────────────────────────┘
```

- **批准一次 = 本轮放行**：从当前用户消息到下一次用户消息之间，同类工具不再重复弹窗。
- **新消息重置**：你下一次发言后，授权失效，新一轮重新询问。
- **失败即拒绝**：审批通道不可用或用户拒绝时，工具一律不执行。

## 安装

### 方式一：Plugins 页面安装（推荐本地开发）

1. 打开 DSH 的 **Plugins** 页面。
2. 选择 **Add plugin**，指向本目录（含 `package.json` 的目录）。
3. 或在会话里让我用 `plugin_manager` 安装。

### 方式二：手动放进 profile

把整个目录复制到 `~/.dsh/profiles/<profile>/` 之外的位置，再通过 profile 的 `package.json` `dsh.profile.bundles` 引入（不推荐手改，容易漏依赖）。建议仍用 Plugins 页面安装。

## 配置

`cordis.patch.yml`：

```yaml
- insert:
    - id: api-spend-gate
      name: '@local/dsh-api-spend-gate'
      config:
        tools:
          - subagent
          - subagent_fork
          - workflow
```

`config.tools` 可自由增删，例如把外部检索也纳入：

```yaml
config:
  tools: [subagent, subagent_fork, workflow, web_search, web_fetch]
```

> 注意：子 Agent 一般没有独立的浏览器审批界面。如果把子 Agent 内部也会调用的工具（如 `web_search`）纳入，子 Agent 的调用可能因无人应答而被拒绝。遇到这种情况，从列表移除该工具即可。

## 已知限制

- 审批走 Agent 作用域的 `approval/request` 通道；没有可用答复方时一律拒绝（fail closed）。
- 「本轮」以会话的 `turn` 计数为准；同一条用户消息内的多次调用共享一次授权。
- 只拦工具调用层，不改变模型基础推理本身的消耗。

## 文件结构

```
dsh-api-spend-gate/
├── package.json        # bundle 清单，声明 dsh.bundle.patch
├── cordis.patch.yml    # 插入插件行与默认配置
├── index.js            # 插件入口：tools/pre-execute 拦截
├── locale/
│   ├── en.json         # 英文标题/描述
│   └── zh.json         # 中文标题/描述
├── docs/DETAIL.md      # Plugins 详情页内容
├── icon.svg            # 图标
└── README.md
```

## 开发

```bash
node --check index.js
```

修改后重新安装（或重启 DSH）即可生效。

## License

MIT
