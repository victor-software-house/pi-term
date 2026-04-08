#!/usr/bin/env python3
"""
Long-running iTerm2 bridge — reads JSON commands from stdin, applies themes
via batched protobuf API (one message for all 22 color properties).

Protocol: one JSON object per line on stdin.
  {"cmd":"apply","colors":{"Background Color":"282a36",...}}
  {"cmd":"snapshot"}    -> prints snapshot JSON to stdout
  {"cmd":"restore","snapshot":{...}}
  {"cmd":"quit"}

Responses: one JSON object per line on stdout.
  {"ok":true}
  {"ok":true,"snapshot":{...}}
  {"error":"..."}
"""
import asyncio
import json
import sys

import iterm2


async def main():
    conn = await iterm2.Connection.async_create()
    app = await iterm2.async_get_app(conn)

    def get_session():
        return app.current_terminal_window.current_tab.current_session

    def respond(obj):
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    respond({"ok": True, "ready": True})

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
            try:
                session = get_session()
                colors = msg["colors"]
                lwop = iterm2.LocalWriteOnlyProfile()
                for key, hex_val in colors.items():
                    h = hex_val.lstrip("#")
                    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
                    lwop._color_set(key, iterm2.Color(r, g, b))
                await session.async_set_profile_properties(lwop)
                respond({"ok": True})
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
