#!/usr/bin/env python3
"""
Long-running iTerm2 bridge — reads JSON commands from stdin, applies themes
via batched protobuf API (one message for all 22 color properties).

The bridge is started with the ITERM_SESSION_ID env var to pin it to the
correct iTerm2 session (the one running Pi), regardless of which tab is
currently focused.

Protocol: one JSON object per line on stdin.
  {"cmd":"apply","colors":{"Background Color":"282a36",...}}
    Session-local preview (ephemeral, doesn't affect new tabs).
  {"cmd":"persist","colors":{"Background Color":"282a36",...}}
    Writes to the actual profile (persists across new tabs/windows).
  {"cmd":"snapshot"}
    Capture current colors. Response: {"ok":true,"snapshot":{...}}
  {"cmd":"restore","snapshot":{...}}
    Restore session-local colors from a snapshot.
  {"cmd":"quit"}

Responses: one JSON object per line on stdout.
  {"ok":true}
  {"ok":true,"snapshot":{...}}
  {"error":"..."}
"""
import asyncio
import json
import os
import sys

import iterm2
import iterm2.rpc


def build_lwop(colors: dict) -> iterm2.LocalWriteOnlyProfile:
    """Build a LocalWriteOnlyProfile from a hex color dict."""
    lwop = iterm2.LocalWriteOnlyProfile()
    for key, hex_val in colors.items():
        h = hex_val.lstrip("#")
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        lwop._color_set(key, iterm2.Color(r, g, b))
    return lwop


async def find_session_by_id(app, session_id: str):
    """Find a session by its GUID across all windows/tabs."""
    for window in app.terminal_windows:
        for tab in window.tabs:
            for session in tab.sessions:
                if session.session_id == session_id:
                    return session
    return None


async def main():
    conn = await iterm2.Connection.async_create()
    app = await iterm2.async_get_app(conn)

    # Pin to the specific session running Pi, not whatever is focused.
    # ITERM_SESSION_ID format: "w0t0p0:GUID"
    raw_session_id = os.environ.get("ITERM_SESSION_ID", "")
    session_guid = raw_session_id.split(":")[-1] if ":" in raw_session_id else ""

    pinned_session = None
    if session_guid:
        pinned_session = await find_session_by_id(app, session_guid)

    def get_session():
        """Return the pinned session, falling back to focused session."""
        return pinned_session or app.current_terminal_window.current_tab.current_session

    def respond(obj):
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    # Discover the real profile GUID at startup.
    # session.async_get_profile() returns a session-local copy with a different GUID.
    # The real GUID comes from PartialProfile.async_query matching by name.
    profile_guid = None
    try:
        session = get_session()
        profile = await session.async_get_profile()
        profile_name = profile.all_properties.get("Name")
        if profile_name:
            partials = await iterm2.PartialProfile.async_query(conn)
            for p in partials:
                if p.name == profile_name:
                    profile_guid = p.all_properties.get("Guid")
                    break
    except Exception:
        pass

    respond({
        "ok": True,
        "ready": True,
        "sessionId": session_guid,
        "profileGuid": profile_guid,
    })

    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        line = await reader.readline()
        if not line:
            break
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            respond({"error": "invalid json"})
            continue

        cmd = msg.get("cmd")

        if cmd == "quit":
            respond({"ok": True})
            break

        elif cmd == "apply":
            # Session-local preview — doesn't persist to profile
            try:
                session = get_session()
                lwop = build_lwop(msg["colors"])
                await session.async_set_profile_properties(lwop)
                respond({"ok": True})
            except Exception as e:
                respond({"error": str(e)})

        elif cmd == "persist":
            # Batch write to the actual profile via guid_list, PLUS
            # apply session-local so the current session reflects it too.
            try:
                if not profile_guid:
                    respond({"error": "no profile GUID cached"})
                    continue
                lwop = build_lwop(msg["colors"])
                assignments = list(lwop.values.items())
                resp = await iterm2.rpc.async_set_profile_properties_json(
                    conn, None, assignments, guids=[profile_guid])
                status = resp.set_profile_property_response.status
                # Also apply session-local for immediate effect
                session = get_session()
                await session.async_set_profile_properties(lwop)
                respond({"ok": status == 0, "status": status})
            except Exception as e:
                respond({"error": str(e)})

        elif cmd == "snapshot":
            try:
                session = get_session()
                profile = await session.async_get_profile()
                snap = {}
                for key in [
                    "Background Color", "Foreground Color",
                    "Cursor Color", "Cursor Text Color",
                    "Selection Color", "Selected Text Color",
                ] + [f"Ansi {i} Color" for i in range(16)]:
                    try:
                        c = profile.get_color_with_key(key)
                        snap[key] = {"r": c.red, "g": c.green, "b": c.blue}
                    except Exception:
                        pass
                respond({"ok": True, "snapshot": snap})
            except Exception as e:
                respond({"error": str(e)})

        elif cmd == "restore":
            try:
                session = get_session()
                snap = msg["snapshot"]
                lwop = iterm2.LocalWriteOnlyProfile()
                for key, rgb in snap.items():
                    lwop._color_set(key, iterm2.Color(rgb["r"], rgb["g"], rgb["b"]))
                await session.async_set_profile_properties(lwop)
                respond({"ok": True})
            except Exception as e:
                respond({"error": str(e)})

        else:
            respond({"error": f"unknown cmd: {cmd}"})


asyncio.run(main())
