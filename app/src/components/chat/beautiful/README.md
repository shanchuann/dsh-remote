# BeautifulUI native adapters

Visual and interaction references supplied by the user, retrieved 2026-11-12:

- https://www.beautifului.dev/r/loading-state.json — Dots, 3×3 circular wavefront
- https://www.beautifului.dev/r/thinking-state.json — expandable Reasoning trace
- https://www.beautifului.dev/r/streaming-text.json — incremental text reveal and final actions
- https://www.beautifului.dev/r/approval-card.json — selectable answers and explicit confirmation
- https://www.beautifului.dev/r/tool-chips.json — compact call groups, targets and expandable details
- https://www.beautifului.dev/r/task-rows.json — Capsules with task status and optional progress

These adapters use React Native, Reanimated and the existing DSH theme tokens.
They consume real transcript, streaming and approval state. Gallery timers,
sample questions, sample citations, sample diffs and simulated task completion
are not part of the application. Loading elapsed time measures the current wait.
Reduced-motion preferences disable repeating/decorative motion.

The host currently accepts allow/reject tool approvals. The choice card maps
only those two supported decisions; it does not claim support for arbitrary
questionnaires or `ask_user_question`. Streaming replies preserve Markdown,
tables, links and fenced code. Their final action invokes the native share sheet.
