#!/usr/bin/env python3
"""
Long-running iTerm2 bridge — reads JSON commands from stdin, applies themes
via batched protobuf API (one message for all 22 color properties).

Pinned to the iTerm2 session running Pi via ITERM_SESSION_ID env var.

Protocol: one JSON object per line on stdin.
  {"cmd":"apply","colors":{...}}      Session-local preview (ephemeral).
  {"cmd":"persist","colors":{...}}    Write to profile (persists, updates all tabs).
  {"cmd":"snapshot"}                  Capture current colors.
  {"cmd":"restore","snapshot":{...}}  Restore session-local from snapshot.
  {"cmd":"quit"}

Fire-and-forget commands (apply, persist, restore) do not send responses
unless {"reply":true} is set. Only snapshot always responds.
"""
import asyncio
import json
import os
import sys

import iterm2
import iterm2.rpc
import iterm2.api_pb2


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

    # Pin to Pi's session via ITERM_SESSION_ID env var.
    raw_session_id = os.environ.get("ITERM_SESSION_ID", "")
    session_guid = raw_session_id.split(":")[-1] if ":" in raw_session_id else ""
    pinned_session = await find_session_by_id(app, session_guid) if session_guid else None

    def get_session():
        return pinned_session or app.current_terminal_window.current_tab.current_session

    def respond(obj):
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    # Discover profile GUID for persistence.
    # The correct GUID comes from PartialProfile -> async_get_full_profile,
    # NOT from session.async_get_profile().all_properties["Guid"].
    profile_guids = None
    profile_name = None
    try:
        session = get_session()
        session_profile = await session.async_get_profile()
        profile_name = session_profile.all_properties.get("Name")
        if profile_name:
            partials = await iterm2.PartialProfile.async_query(conn)
            for p in partials:
                if p.name == profile_name:
                    full = await p.async_get_full_profile()
                    profile_guids = full._guids_for_set()
                    break
    except Exception:
        pass

    respond({
        "ok": True,
        "ready": True,
        "sessionId": session_guid,
        "profileName": profile_name,
        "hasProfileGuids": profile_guids is not None,
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
        reply = msg.get("reply", False)

        if cmd == "quit":
            if reply:
                respond({"ok": True})
            break

        elif cmd == "apply":
            # Session-local preview — ephemeral
            try:
                session = get_session()
                lwop = build_lwop(msg["colors"])
                await session.async_set_profile_properties(lwop)
                if reply:
                    respond({"ok": True})
            except Exception as e:
                if reply:
                    respond({"error": str(e)})

        elif cmd == "persist":
            # Batch write to the actual profile — persists, updates all tabs
            try:
                if not profile_guids:
                    if reply:
                        respond({"error": "no profile GUID discovered"})
                    continue
                lwop = build_lwop(msg["colors"])
                assignments = list(lwop.values.items())
                resp = await iterm2.rpc.async_set_profile_properties_json(
                    conn, None, assignments, guids=profile_guids)
                status = resp.set_profile_property_response.status
                ok = status == iterm2.api_pb2.SetProfilePropertyResponse.Status.Value("OK")
                if reply:
                    respond({"ok": ok, "status": status})
            except Exception as e:
                if reply:
                    respond({"error": str(e)})

        elif cmd == "snapshot":
            # Always responds
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
            # Session-local restore from snapshot
            try:
                session = get_session()
                snap = msg["snapshot"]
                lwop = iterm2.LocalWriteOnlyProfile()
                for key, rgb in snap.items():
                    lwop._color_set(key, iterm2.Color(rgb["r"], rgb["g"], rgb["b"]))
                await session.async_set_profile_properties(lwop)
                if reply:
                    respond({"ok": True})
            except Exception as e:
                if reply:
                    respond({"error": str(e)})

        else:
            respond({"error": f"unknown cmd: {cmd}"})


asyncio.run(main())
