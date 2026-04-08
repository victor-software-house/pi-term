# pi-term execution plan

## Status: working baseline restored

Commit `136587b` on `feat/iterm2-migration` — tree identical to `45a423b` (the only operator-confirmed working state) plus a response-queue fix in the bridge.

Preview works. Persistence to iTerm2 profiles does not exist yet. Bridge process lifecycle is not managed.

---

## Current working architecture

```
picker.ts handleInput
  → updates selectedTheme + tui.requestRender()   (sync, <1ms)
  → schedules applyPreview via trailing debounce   (200ms cooldown)

applyPreview (debounce fires)
  → applyThemeToItermSync(entry)                   (stdin write, 0ms caller cost)
  → buildThemeInstance + ctx.ui.setTheme            (sync, ~24ms Pi re-render)

iterm2.ts applyThemeToItermSync
  → _bridge.stdin.write(JSON.stringify({cmd:"apply", colors}) + "\n")
  → returns immediately — no await, no callback

iterm2-bridge.py apply handler
  → LocalWriteOnlyProfile accumulates 22 colors
  → session.async_set_profile_properties(lwop)     (single batched protobuf, ~14ms)
  → no response sent (fire-and-forget, response-queue fix)
```

**Two key factors enabling instantaneous feel:**
1. Fire-and-forget stdin write — caller never waits for the bridge
2. Single batched protobuf message for all 22 color properties — one round-trip, not 22

All debouncing and event handling architecture was carried over from `pi-cmux-theme-picker` and is a given.

---

## Confirmed facts

| Fact | Evidence |
|:--|:--|
| Bridge batched apply works and feels instantaneous | Operator confirmed at entry `93c7e2db`: "it works quite well in the preview screen" |
| Bridge `apply` is session-local only | `session.async_set_profile_properties(lwop)` changes the current session, not the profile. New tabs are unaffected. |
| `session.async_get_profile().all_properties["Guid"]` returns a session-local copy GUID | Proven in session `bdc641ec` — batched persist to that GUID had no effect on new tabs |
| `PartialProfile.async_get_full_profile()._guids_for_set()` returns the correct profile GUID | Proven in session `bdc641ec` at entry `38e78863`: "that definitely worked, updated all tabs simultaneously" |
| Batched `async_set_profile_properties_json(conn, None, assignments, guids=...)` writes to the real profile | Same evidence as above — but needs re-validation in the current clean baseline |
| Direct plist writes do not affect running iTerm2 | Proven failed at entry `0d87d69c` |
| OSC escape sequences to `/dev/tty` change terminal colors | Proven in eval during session `bdc641ec` — but never tested in the actual working picker. Unknown whether this is the same mechanism as the protobuf API or a different subsystem. |
| Bridge response queue corruption | `apply`/`restore` responses can resolve a pending `snapshot` promise. Fixed by making them fire-and-forget (current state). |

## Unconfirmed claims that need investigation

| Claim | Status | How to verify |
|:--|:--|:--|
| `process.on("exit")` reliably kills spawned children | Unverified | Check Node docs for spawn cleanup guarantees on exit vs SIGTERM vs SIGINT vs uncaughtException |
| `session_shutdown` Pi hook fires reliably on all session end paths | Unverified | Check Pi docs/source for when session_shutdown fires (reload, new session, quit, crash) |
| Whether both `process.on("exit")` and `session_shutdown` are needed or redundant | Unverified | Investigate which scenarios each covers |
| `ITERM_SESSION_ID` env var is always available in Pi's process | Unverified | Check `process.env.ITERM_SESSION_ID` in the current environment via probe_eval |
| Session pinning does not break preview | Unverified | Must be tested as an isolated commit against the working baseline |
| OSC escape sequences are a different iTerm2 subsystem than the protobuf API | Unverified | Needs research — do not assume they are interchangeable or equivalent |
| Bridge asyncio loop blocks during ~530ms persist | Unverified | Would matter if preview uses the bridge. If preview moves to escape sequences, irrelevant — but escape sequences are not yet proven in the picker. |

---

## Decisions

1. **Preview stays on the bridge.** The fire-and-forget stdin write + batched protobuf is the proven hot path. Do not replace it until an alternative is proven in the actual picker, not just eval.

2. **Persistence is deferred to `session_start` reapply.** Store the full color mapping (not just the name) in the extension settings JSON. On `session_start`, if a stored theme exists, apply it via the bridge. This sidesteps the profile persistence latency problem entirely for now.

3. **Profile-level persistence is a separate investigation.** The `PartialProfile.async_get_full_profile()._guids_for_set()` + batched `async_set_profile_properties_json` path was proven once. It needs re-validation against the current clean baseline before being wired in. It is not a blocker for the extension being usable.

4. **Each change is an isolated commit tested against the working baseline.** No multi-concern commits. Operator re-confirms after each install.

---

## Next steps (ordered)

### Step 1 — Investigate bridge process lifecycle

Research (not implement) the exact behavior of:
- `process.on("exit")` — does it fire on SIGTERM? SIGINT? uncaughtException? Does `child.kill()` work inside it?
- `process.on("SIGTERM")` and `process.on("SIGINT")` — overlap with exit handler?
- Pi's `session_shutdown` hook — when exactly does it fire? reload? new session? quit? crash?
- Which combination is actually needed to guarantee the bridge subprocess is killed in all cases?

Output: a decision on which handlers to use, with evidence.

### Step 2 — Investigate and test session pinning

- Verify `ITERM_SESSION_ID` is present in `process.env` via `probe_eval`
- Research whether the bridge's `get_session()` following keyboard focus causes real problems (does the user switch tabs during picker use?)
- If pinning is needed: implement as an isolated commit, test that preview still works after install

### Step 3 — Implement `session_start` theme reapply

- On confirm, store the full color mapping (all hex values from the `ThemeEntry`) in `~/.pi/agent/extensions/pi-term.json`
- On `session_start`, if stored colors exist, apply via `applyThemeToItermSync` (the bridge fire-and-forget path)
- This gives every new Pi session the correct terminal theme without needing profile-level persistence

### Step 4 — Investigate profile-level persistence

- Re-validate the `PartialProfile.async_get_full_profile()._guids_for_set()` + `async_set_profile_properties_json` path using `probe_eval` against the current baseline
- Measure latency
- Determine if it blocks the bridge asyncio loop and whether that matters
- If proven: add a `persist` bridge command, called fire-and-forget on confirm only. Isolated commit.

---

## Smoke test checklist (current baseline)

1. `bun run typecheck` passes ✔
2. Load extension in Pi against an active iTerm2 session
3. `/theme` opens picker; arrow keys navigate without lag ✔
4. Preview applies to both iTerm2 and Pi UI ✔
5. `esc` restores original terminal and Pi colors exactly ✔
6. `enter` confirms Pi theme; terminal colors stay (session-local only)
7. New tabs do NOT get the theme (expected — persistence not implemented)
