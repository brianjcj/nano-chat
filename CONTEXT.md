# Nano Chat

Nano Chat is a small chat service focused on realtime messaging and keeping a user's chat state consistent across active clients.

## Language

**即时聊天 (IM)**:
The product capability where users exchange chat messages and see those messages reflected across their active clients.
_Avoid_: 聊天后台, 消息系统

**会话**:
The place where chat messages are exchanged and preserved as history; direct chat and group chat are both conversations.
_Avoid_: 房间, 频道

**会话内消息序号**:
A conversation-local position that gives messages in the same conversation a stable order.
_Avoid_: 全局消息序号, 时间戳排序

**已读位置**:
A user's unread watermark in a conversation; visible messages at or below this conversation-local sequence no longer count as unread, even if invisible gaps exist.
_Avoid_: 客户端已读, 逐消息送达回执, 逐序号真实阅读证明

**消息同步**:
The process of bringing a client's chat state up to date with conversation activity it missed while inactive or disconnected.
_Avoid_: 全局时间线同步, 仅靠实时推送

**消息历史**:
The durable record of user-sent messages that belong to a conversation.
_Avoid_: 临时推送记录, 本地聊天记录, 系统事件记录

**会话事件**:
A non-message change in a conversation, such as a member being added, a member leaving, or a read position changing.
_Avoid_: 系统消息, 聊天消息

**会话列表**:
A user's view of their conversations, ordered by the latest user-sent message rather than by non-message conversation events.
_Avoid_: 全局时间线, 事件收件箱

**文本消息**:
A chat message whose user-visible content is plain text.
_Avoid_: 富媒体消息, 文件消息

**单聊会话**:
A conversation with exactly two users; each pair of users has at most one direct conversation.
_Avoid_: 私聊房间, direct room

**群聊会话**:
A named conversation whose membership is managed as a group rather than as the unique direct conversation between two users.
_Avoid_: 群房间, group room

**已解散群聊**:
A group conversation with no active members that can no longer be used for new messages or membership changes, while its visible history remains readable to former members.
_Avoid_: 已删除群, 空群

**会话成员**:
A user who belongs to a conversation and has one or more defined ranges of message history they may see.
_Avoid_: 订阅者, 参与者, member session

**活跃成员**:
A conversation member who currently participates in a group conversation and may receive new group activity.
_Avoid_: 历史成员, 在线成员

**可见区间**:
A contiguous range of conversation-local message sequences that a conversation member may read.
_Avoid_: 权限规则, 订阅区间

**用户**:
The account identity that owns chat state and participates in conversations.
_Avoid_: 账号, account

**客户端**:
A logged-in instance of a user on a device or browser; a user may have multiple clients.
_Avoid_: 设备, 终端, session

**连接**:
A currently active realtime link between one client and the service; reconnecting creates a new connection for the same client.
_Avoid_: 客户端, session, socket 用户

**实时通道**:
The internal delivery path used by IM to reach active clients for direct delivery and group fan-out; it is not a standalone realtime platform.
_Avoid_: 长连接产品, 通用消息网关, 通用 pub/sub 平台
