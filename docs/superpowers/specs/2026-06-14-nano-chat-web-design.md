# Nano Chat Web 应用 v1 设计

## 背景

Nano Chat 已有 Rust/Axum/Postgres 后台，提供认证、会话、消息历史、WebSocket 实时事件和 Postgres NOTIFY 跨实例 fan-out。Web v1 的目标是在不扩大聊天业务 API 范围的前提下，交付一个可在移动端和桌面端使用的 IM Web 应用。

## 目标

- 提供 Nano Chat 的用户可见 Web 应用，而不是改变后台中“客户端”的领域含义。
- 严格贴合现有后台能力，交付完整但克制的 IM v1。
- 移动端可用，桌面端高效，并为未来功能区预留产品壳层。
- 使用轻量、可定制的 React 技术栈，避免引入重型 UI 框架。
- 生产环境由现有 Rust 服务托管 Web 静态产物，保持 API、WebSocket、Web 应用同源。

## 非目标

Web v1 不做：

- 图片、文件、语音、富文本消息。
- 消息编辑、删除、撤回。
- 联系人系统。
- 模糊用户搜索。
- 已退出群历史入口。
- 浏览器通知、PWA、Service Worker。
- 本地持久化消息历史。
- 完整深色主题。
- Playwright 端到端测试硬要求。
- 聊天业务 API 改动。

## 产品范围

### 认证与用户

- 未登录用户只能访问登录/注册界面。
- 注册和登录成功后进入 Web 应用。
- 登录态保存 `access_token`、`client_id`、`expires_at`。
- 用户菜单展示当前用户，支持修改显示名、切换语言、登出。
- 登出只清除本地 session 并关闭 WebSocket；后台 v1 不做 token revocation。
- 401 或 token 过期时清除本地 session 并回到登录页。

### IM 功能区

v1 只有 IM 功能区真正可用。产品壳层为未来功能区预留导航结构，但不展示不可用的假功能。

IM 功能包括：

- 会话列表。
- 单聊。
- 群聊。
- 消息历史。
- 文本消息发送。
- WebSocket 实时事件。
- 已读位置更新。
- 群成员列表、添加成员、退出群。

### 单聊发起

后台不支持空单聊会话，Web 使用“单聊草稿”表达第一条消息发送前的状态。

流程：

1. 用户点击新建聊天。
2. 输入完整用户名并执行精确查找。
3. 找到用户后进入单聊草稿聊天页。
4. 发送第一条消息时调用 `direct_message.send`。
5. 成功后服务端创建或复用单聊会话，Web 将草稿替换为真实会话。

### 群聊创建与成员

- 创建群聊必须填写群名并至少添加 1 个其他用户。
- 成员通过完整用户名精确查找添加。
- 创建成功后进入该群聊；空消息历史的群聊仍出现在会话列表。
- 群成员页展示活跃成员。
- 退出群或群解散后，当前会话关闭并回到会话列表，同时展示提示。
- v1 不提供已退出群或已解散群的历史入口。

### 会话事件

会话事件不是聊天消息。v1 不把成员加入、成员离开、解散、已读更新渲染成消息流中的“系统消息”。这些事件只用于更新成员列表、会话状态、输入可用性、未读状态和提示。

## 布局与视觉设计

### 桌面端

桌面采用 Slack-lite shell：

- 最左侧是功能区 rail，承载品牌、功能区入口、当前用户入口。
- 中间是当前功能区的列表栏；IM 中显示会话列表。
- 右侧是主工作区；IM 中显示聊天页或空状态。

v1 只有 IM 功能区可用。功能区 rail 保持结构可扩展，但不放不可用入口。

### 移动端

- 底部功能栏承载功能区入口。
- IM 内部使用会话列表和聊天页的栈式导航。
- 从聊天页返回会话列表应符合浏览器后退和移动端返回预期。
- 创建群、添加成员、用户查找、用户菜单、退出确认等次级任务在移动端使用 sheet，在桌面端使用 dialog 或侧边 panel。

### 视觉风格

采用“软社交”方向：

- 明亮背景。
- 大圆角。
- 柔和渐变。
- 轻量阴影和动效。
- 比工具型更年轻，但不使用重霓虹或重糖果风格。

头像策略：后台没有头像 URL，Web 用用户 display name 或 username 的首字母/缩写，加基于 `user_id` 的稳定渐变色生成头像。

v1 交付浅色主题。颜色、圆角、阴影通过 CSS variables 组织，为未来深色主题预留。

### 可访问性底线

- 关键交互可键盘操作。
- 按钮、表单、导航使用语义元素。
- Dialog、Sheet 等复杂交互基于 Radix/shadcn 的可访问 primitives。
- 保留可见焦点态。
- 图标按钮提供 `aria-label`。
- 关键文本保持可读对比度。

v1 不承诺完整 WCAG 审计。

## 技术栈

- React + TypeScript + Vite。
- pnpm。
- Tailwind CSS。
- shadcn/ui 按需拷贝基础组件。
- Radix primitives 用于复杂可访问交互。
- TanStack Query 管理服务端状态。
- Zustand 管理本地 UI 状态。
- React Router 管理轻量路由。
- i18next + react-i18next + browser language detector。
- Vitest + React Testing Library。

## 仓库与代码结构

Web 应用放在 `web/` 子目录，Rust 后台继续位于仓库根目录。

建议结构：

```text
web/
  package.json
  pnpm-lock.yaml
  vite.config.ts
  src/
    app/
    features/
      auth/
      im/
      shell/
    shared/
      api/
      i18n/
      realtime/
      session/
      ui/
      utils/
```

边界：

- `features/auth`：登录、注册、认证页。
- `features/im`：会话列表、聊天页、消息输入、群成员、单聊草稿。
- `features/shell`：功能区 rail、移动底部栏、应用布局。
- `shared/api`：手写 DTO、API client、错误 envelope 处理。
- `shared/realtime`：WebSocket client、事件分发、重连状态。
- `shared/session`：本地登录态存取。
- `shared/i18n`：语言资源、初始化、语言切换。
- `shared/ui`：项目自有基础 UI 和 shadcn 组件。

## 路由

轻量路由：

- `/login`
- `/register`
- `/app/im`
- `/app/im/conversations/:conversation_id`

行为：

- 未登录访问 `/app/*` 时跳转到 `/login`。
- 已登录访问 `/login` 或 `/register` 时跳转到 `/app/im`。
- 桌面端选择会话会更新 URL。
- 移动端从会话详情返回会话列表可通过浏览器后退实现。
- Dialog、Sheet、Panel 不进入 URL 状态。
- 单聊草稿可以用内存状态表示；刷新后草稿丢失是可接受行为。

## 环境配置

- `VITE_API_BASE_URL` 可配置 HTTP API base，默认同源 `/api/v1`。
- `VITE_WS_URL` 可配置 WebSocket URL，默认从当前 origin 推导 `/ws?version=1`。
- 本地开发使用 Vite dev server proxy，将 `/api/v1` 和 `/ws` 转发到 Rust 后台。
- 生产环境由 Rust 服务托管 Web 构建产物，默认同源访问 API 和 WebSocket。

## HTTP 数据流

- API client 统一附加 Bearer token。
- API client 统一解析成功 JSON 和错误 envelope。
- TypeScript DTO 手写维护，与 `docs/api.md` 保持同步。
- 不引入 OpenAPI 生成。
- 不对每个后端响应引入 runtime schema 校验；环境变量、session 数据和错误 envelope 可做轻量防御式校验。
- TanStack Query 缓存会话列表、消息历史、成员列表、当前用户等服务端状态。

## WebSocket 与实时同步

### 连接生命周期

- 登录后建立一个全局 WebSocket 连接。
- 所有会话共享该连接。
- 登出关闭连接。
- 断线自动重连。
- 多标签页 v1 允许每个标签各自连接；不做 BroadcastChannel 主标签选举。

### 事件处理

- `message.created`：更新对应会话消息缓存和会话列表摘要；非当前会话增加本地未读修正。
- `conversation.read_updated`：更新会话 read state。
- `conversation.member_added` / `conversation.member_left`：刷新或更新成员列表和会话状态。
- `conversation.dissolved`：禁用当前输入，提示用户，并回到会话列表。
- `server.draining`：显示服务正在重启/重连提示，并等待连接断开后重连。

### 重连与补同步

- 重连后刷新会话列表。
- 当前打开会话立即用 `after_seq` 从本地最高连续可见 seq 补漏。
- 其他会话等用户打开时再补。
- 如果收到 `message.created` 后发现 sequence gap，当前会话立即补漏。
- 后台消息历史和会话列表始终是权威来源。

## 消息历史与滚动

- 进入会话时，从会话列表拿 `latest_message_seq`。
- 请求 `GET /messages?before_seq=<latest_message_seq + 1>&limit=50` 获取最新 50 条。
- 返回升序后渲染。
- 上拉加载更早消息时，用 `before_seq = 当前最小 message_seq`。
- 补漏时，用 `after_seq = 当前最高连续 message_seq`。
- v1 不做虚拟滚动；只做分页加载和普通滚动容器。
- 需要处理 prepend 历史后的滚动位置保持。
- 当前会话收到新消息时，如果用户接近底部则自动滚到底；否则显示新消息提示。

## 消息发送

- 输入框为自动增高 textarea。
- Enter 发送，Shift+Enter 换行。
- 发送前校验 `body.trim()` 非空。
- 发送前按 UTF-8 bytes 校验最大 4096 bytes。
- 每次发送生成 `client_msg_id`。
- 发送后立即插入乐观 pending 消息。
- 收到 `message.send.ok` 或 `direct_message.send.ok` 后，用服务端消息替换 pending。
- 业务错误时 pending 变为 failed，并提供重试。
- 刷新页面后 pending 消息丢失是可接受行为；v1 不做离线发送队列。

## 已读与未读

- 后台 `read_seq` 是权威。
- 前端只做即时 UI 修正，并在刷新会话列表或重连后校准。
- 当前会话、页面/tab 可见、滚动接近底部时，将最高连续可见 message seq 发送为 `conversation.read`。
- 发送成功后更新本地 read state。
- 如果服务端返回 out-of-range 或其他业务错误，回滚到服务端会话列表数据。

## 错误处理

- 登录、注册、创建群、用户查找等表单错误内联展示。
- 消息发送失败显示在对应 failed 消息旁，并允许重试。
- WebSocket 断线、重连中、服务 draining 显示应用级 banner。
- 后端错误码映射为中英文用户友好文案。
- 开发环境保留详细 console 日志；生产环境不向用户暴露内部错误细节。

## i18n

- 支持 `zh-CN` 和 `en-US`。
- 默认语言跟随浏览器，兜底 `zh-CN`。
- 用户可在用户菜单切换语言。
- 语言偏好持久化到浏览器。
- 所有用户可见文案、错误码文案、空状态、连接状态都走 i18n 字典。

## 部署

开发：

- `cargo run` 启动 Rust 后台。
- `pnpm dev` 在 `web/` 启动 Vite dev server。
- Vite proxy 转发 `/api/v1` 和 `/ws`。

生产：

- 构建 `web/dist`。
- Rust 服务托管静态 assets。
- 非 `/api/v1`、`/ws`、健康检查等后端路径的 Web route fallback 到 `index.html`。
- Docker 镜像包含 Web 构建产物。

该部署决策记录在 `docs/adr/0002-serve-web-app-from-chat-service.md`。

## 测试与质量门禁

必需命令：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

测试范围：

- API client：成功响应、错误 envelope、401/session 清理。
- SessionStore：读写、过期判断、清理。
- Realtime client：事件解析、重连状态、事件分发。
- IM 状态更新：message created、pending ack、failed retry、read update、conversation list cache 更新。
- 组件流程：登录/注册、会话列表、单聊草稿、群聊创建、消息输入、移动/桌面关键布局。

Bundle 采用软预算：记录 initial JS gzip size，目标小于 250KB，但 v1 不因超出软预算直接失败。若产物明显变大，应检查是否引入了不必要的大依赖。

## 已接受的关键决策

- Web 应用放在 `web/`。
- 使用 pnpm。
- 使用 Tailwind CSS + shadcn/ui selective components + Radix primitives。
- 使用 TanStack Query + Zustand。
- 使用 React Router 轻量路由。
- 使用 i18next + react-i18next。
- 移动端底部功能栏，桌面端 Slack-lite shell。
- 软社交视觉方向。
- 生产由 Rust 服务托管 Web 静态产物。
- 只新增静态资源托管能力，不改聊天业务 API。

## 待实现前需要验证

- shadcn/ui、Tailwind CSS 与当前 Vite 模板版本的配置细节。
- WebSocket client 在 Vite proxy 下的 `/ws?version=1&token=...` 行为。
- Rust 静态托管 fallback 不应吞掉 `/api/v1`、`/ws`、`/healthz`、`/readyz` 等后端路径。
