# Conversation List Time Design

## Goal
Show each conversation's latest-message time in the conversation list, using compact calendar-aware formatting and the current UI language for weekday names.

## Requirements
- Show a time only when `conversation.latest_message.created_at` exists.
- Today: show local hour and minute as `HH:mm`, for example `14:05`.
- Same week but not today: show localized weekday name. Weeks start on Monday. Examples: `星期一` in `zh-CN`, `Monday` in `en-US`.
- Same year but not same week: show `MM/DD`, for example `07/06`.
- Different year: show two-digit year plus month/day as `YY/MM/DD`, for example `26/07/06`.
- Preserve the existing unread badge, title, subtitle, and latest preview layout.

## Design
Add a focused formatter in `web/src/shared/utils/message.ts` so date boundary logic is unit-tested outside React. `ConversationList` will call the formatter with `i18n.language` from `useTranslation()` and render the result in the title row's right-side metadata area. Empty conversations render no timestamp.

## Testing
- Unit-test formatter branches for today, same Monday-start week, same year, different year, and localized weekday output.
- Component-test that a conversation with a latest message renders the formatted timestamp and an empty conversation does not render a timestamp.
