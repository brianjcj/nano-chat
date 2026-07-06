# Interface Color Refresh Design

## Goal

Refresh Nano Chat's Web application visual palette so the interface feels calmer, more cohesive, and more polished. The current warm peach / purple palette feels playful but visually noisy across navigation, conversation list, chat workspace, message bubbles, and auth pages.

## Approved Direction

Use a restrained “quiet ink-blue + mist surfaces + teal signal” direction.

## Token System

- `background`: #edf4f7 — cool mist page background.
- `foreground`: #12232d — deep ink text and navigation anchor color.
- `surface`: #ffffff — primary card, header, and panel surface.
- `surface-muted`: #f5f9fb — chat canvas and subtle input areas.
- `muted`: #dbe8ee — soft dividers and low-emphasis fills.
- `muted-foreground`: #5d7180 — secondary text.
- `primary`: #0f9f8f — teal action and unread signal.
- `accent`: #315c7c — blue support accent for secondary emphasis.
- `bubble-outgoing`: #d8f4ee — calm outgoing message bubble.
- `bubble-incoming`: #ffffff — clear incoming message bubble.
- `border`: #d3e1e8 — consistent cool border.
- `ring`: #54c3b4 — focus ring.
- `destructive`: #c8465a — error tone that still fits the cool palette.

## Layout / Styling Changes

Keep the existing layout and component structure. This pass is intentionally a visual reskin, not a navigation or interaction redesign.

- App shell: replace warm canvas with cool mist surfaces.
- Desktop and mobile navigation: use deep ink-blue with restrained teal highlights.
- Conversation list: active row gets a subtle teal wash instead of orange.
- Chat view: message area stays light and calm; no large decorative warm gradients.
- Message bubbles: outgoing messages use a soft teal bubble with deep text instead of a saturated coral block.
- Auth pages: keep the two-column structure, but replace candy gradients with layered cool mist / teal / blue glows.
- Buttons and shared controls inherit the new primary and accent tokens.

## Signature Element

Use a very subtle “signal mist” atmosphere: low-opacity radial glows in teal and blue, suggesting realtime presence without visual clutter. This is the only decorative gesture; all other surfaces remain quiet and disciplined.

## Non-goals

- No new features.
- No copy changes.
- No routing, API, realtime, or state changes.
- No structural rewrite of the chat layout.

## Verification

After implementation, run the Web application typecheck and build scripts to verify the visual changes do not break the app.
