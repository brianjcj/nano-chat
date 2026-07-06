# WeChat-style Chat Main UI Design

Date: 2026-07-06

## Goal

Reshape the authenticated chat main interface so it behaves more like a mature IM client, especially WeChat's desktop/mobile interaction model, while keeping Nano Chat's existing visual palette and product identity.

The redesign focuses on layout and interaction, not on copying WeChat's colors or adding new backend features.

## Scope

In scope:

- Authenticated chat main UI only.
- Desktop three-column client layout: feature rail, conversation list, chat workspace.
- Mobile conversation-to-chat flow: conversation list as the default screen, full-screen chat detail after selecting a conversation, and a clear back path.
- Chat workspace structure: fixed header, independently scrollable message area, fixed composer.
- IM-style conversation list density and message bubble treatment.
- Empty chat workspace state.

Out of scope:

- Login and registration pages.
- New backend API behavior.
- QR-code login, contacts modules, payments, moments, or other WeChat feature areas.
- Exact WeChat color matching.
- Large unrelated component refactors.

## Existing Context

The current React/Vite web client already has the right high-level component boundaries:

- `web/src/features/shell/AppShell.tsx` owns the authenticated shell and mobile panel switching.
- `web/src/features/shell/DesktopRail.tsx` owns the desktop feature rail.
- `web/src/features/shell/MobileFeatureBar.tsx` owns the mobile bottom feature bar.
- `web/src/features/im/components/ConversationList.tsx` owns the conversation list.
- `web/src/features/im/components/ChatView.tsx` owns the loaded chat workspace.
- `web/src/features/im/components/MessageList.tsx` owns message scrolling and rendering.
- `web/src/features/im/components/MessageInput.tsx` owns the composer.

The redesign should preserve those boundaries and mainly adjust layout, conditional visibility, and styling.

## Desktop Layout

Desktop uses a full-height IM client layout:

```text
┌──────────┬────────────────────┬──────────────────────────────┐
│ Rail     │ Conversation list  │ Chat workspace                │
│          │                    │                              │
│ Account  │ Header/actions     │ Fixed chat header             │
│ IM entry │ Conversations      │ Scrollable messages           │
│ Settings │                    │ Fixed message composer        │
└──────────┴────────────────────┴──────────────────────────────┘
```

Design choices:

- The app shell should feel like a full-screen client, not a floating marketing card.
- The feature rail remains narrow and stable.
- The conversation list has a fixed desktop width and full-height scrolling.
- The chat workspace fills the remaining space without extra outer card padding.
- Borders and background separation should define regions more than shadows.
- Existing project colors remain in use, but effects should be quieter and less glassy.

## Mobile Layout

Mobile follows the familiar IM app flow:

```text
Conversation list screen
┌────────────────────┐
│ Header + actions    │
│ Conversation list   │
│ Mobile feature bar  │
└────────────────────┘

Chat screen
┌────────────────────┐
│ Back + chat header  │
│ Messages            │
│ Composer            │
└────────────────────┘
```

Interaction requirements:

- `/app/im` shows the conversation list by default.
- Selecting a conversation navigates to its chat route and switches to the chat panel.
- Directly opening a chat route shows the chat panel.
- The chat screen has an obvious back control that returns to `/app/im`.
- The mobile bottom feature bar should not compete with the composer on the chat screen; hide it or only show it on the conversation-list screen.

## Conversation List

The list should look like an IM conversation roster rather than a set of cards.

Conversation list item structure:

- Left: avatar.
- Middle: conversation title and latest message preview.
- Right: latest message time and unread badge.

Behavior and styling:

- Use denser row spacing.
- Use a light active-row highlight for the selected conversation.
- Use subtle hover background changes instead of elevated card hover effects.
- Keep the existing new-direct and create-group actions, but present them as compact header actions.
- Preserve loading, error, and empty states.

## Chat Workspace

Loaded chat uses a fixed three-zone structure:

```text
┌──────────────────────────────┐
│ Header: title, subtitle, ops  │
├──────────────────────────────┤
│ Messages: independent scroll  │
├──────────────────────────────┤
│ Composer: fixed bottom input  │
└──────────────────────────────┘
```

Header:

- Displays conversation type, title, and subtitle.
- Keeps existing call buttons and group member panel action.
- On mobile, includes the back control as part of the chat header area or immediately above it.

Messages:

- Keep existing history loading, timestamp suppression, call-event messages, pending state, failed state, retry action, and back-to-bottom control.
- Make message bubbles more IM-like: slightly less rounded, less card-like shadow, clearer incoming/outgoing alignment.
- Incoming messages should include an avatar when practical within the existing message data.
- Outgoing messages stay right-aligned and may omit the avatar to reduce noise.

Composer:

- Stays fixed at the bottom of the chat workspace.
- Keeps Enter-to-send and Shift+Enter-for-newline behavior.
- Uses a compact client-style input area rather than a large floating form.
- Keeps validation and disabled-conversation messaging.

## Empty Workspace

When no conversation is selected on desktop, show a quiet client-style empty state:

- Centered icon or brand mark.
- Short instruction such as selecting a conversation to start chatting.
- Background matches the chat workspace instead of using a large promotional card.

On mobile, the empty workspace normally should not be shown because `/app/im` displays the conversation list.

## Data Flow

No data flow changes are required.

- Conversation selection continues to update `useImStore` state and navigate via React Router.
- `ChatView` continues to derive the selected conversation from `useConversationsQuery`.
- `MessageList` continues to receive messages from `useConversationMessages` through `ChatView`.
- `MessageInput` continues to call `useSendMessage` through its `onSend` prop.

## Error Handling and States

Preserve existing behavior for:

- Conversation list loading and error states.
- Empty conversation list state.
- Chat not found/loading notice.
- Disabled/dissolved conversation composer state.
- Message send validation errors.
- Failed message retry.
- Realtime connection status banner.

The redesign should restyle these states only where needed to fit the client layout.

## Accessibility

- Keep existing labels and landmark semantics.
- Preserve keyboard focus visibility.
- Ensure mobile back and send buttons have accessible labels.
- Avoid hiding focusable controls with CSS-only visibility in the wrong panel.
- Keep status banners and validation messages announced with their current roles.

## Implementation Notes

Expected files to change:

- `web/src/features/shell/AppShell.tsx`
- `web/src/features/shell/DesktopRail.tsx`
- `web/src/features/shell/MobileFeatureBar.tsx`
- `web/src/features/im/components/ConversationList.tsx`
- `web/src/features/im/components/ChatView.tsx`
- `web/src/features/im/components/MessageList.tsx`
- `web/src/features/im/components/MessageInput.tsx`
- `web/src/styles.css` only if global tokens or base background need minor support

Testing and verification should include:

- `pnpm typecheck`
- `pnpm test`
- Relevant test updates for intentional class/layout changes

## Open Decisions Resolved

- Use the WeChat layout and interaction model as inspiration, not its color palette.
- Limit the redesign to the authenticated chat main UI.
- Implement the medium-depth shell redesign rather than a minimal restyle or a deep feature expansion.
