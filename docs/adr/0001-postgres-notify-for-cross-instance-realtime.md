# Use Postgres LISTEN/NOTIFY for cross-instance realtime fan-out

Nano Chat supports running multiple service instances while keeping deployment small. We will use Postgres `LISTEN/NOTIFY` for cross-instance realtime fan-out instead of introducing Redis in v1. For v1 text messages, notifications may carry a complete directly-deliverable realtime event so receiving instances can forward it without an extra database read; persisted messages remain the source of truth, and clients use sequence-based synchronization to recover from missed or out-of-order notifications.

## Considered Options

- **Postgres LISTEN/NOTIFY with complete small events**: keeps v1 to one required middleware and reduces database reads on the realtime fast path.
- **Postgres LISTEN/NOTIFY with ID-only hints**: minimizes notification payload size but forces every receiving instance to re-read each event before forwarding.
- **Redis Pub/Sub**: better fit for higher fan-out throughput, but adds another required service before the need is proven.

## Consequences

Realtime delivery across instances is best-effort. Correctness must come from persisted message history and client synchronization, not from notification reliability. Notification payloads must remain small enough for Postgres `NOTIFY`; future large events should fall back to ID-only hints or a dedicated fan-out backend.
