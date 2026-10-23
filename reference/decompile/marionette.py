#!/usr/bin/env python3
"""Minimal Marionette client: navigate, wait for a condition, screenshot.

Talks the raw Marionette wire protocol (length-prefixed JSON over TCP) to the
Firefox instance started with --marionette. Used to capture the game at a
given state instead of relying on --screenshot, which fires at first paint.
"""
import json
import socket
import sys
import time


class Marionette:
    def __init__(self, host="127.0.0.1", port=2828, timeout=60):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        self.buf = b""
        self.msgid = 0
        first = self._read_packet()
        if isinstance(first, dict) and first.get("applicationType") == "gecko":
            # A session may already exist; ignore failure and continue.
            try:
                self.send("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {}}})
            except Exception as exc:  # noqa: BLE001
                print("NewSession:", exc)

    def _read_packet(self):
        while b":" not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("connection closed")
            self.buf += chunk
        length, _, rest = self.buf.partition(b":")
        length = int(length)
        self.buf = rest
        while len(self.buf) < length:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("connection closed")
            self.buf += chunk
        payload, self.buf = self.buf[:length], self.buf[length:]
        return json.loads(payload.decode("utf-8"))

    def send(self, command, params=None):
        self.msgid += 1
        packet = {"id": self.msgid, "name": command, "params": params or {}}
        raw = json.dumps(packet).encode("utf-8")
        self.sock.sendall(str(len(raw)).encode() + b":" + raw)
        while True:
            reply = self._read_packet()
            if isinstance(reply, dict) and reply.get("id") == self.msgid:
                if reply.get("error"):
                    raise RuntimeError(f"{command}: {reply['error']}")
                return reply.get("result")

    def navigate(self, url):
        return self.send("WebDriver:Navigate", {"url": url})

    def execute(self, script, args=None, timeout_ms=None):
        params = {"script": script, "args": args or [], "newSandbox": False}
        if timeout_ms:
            params["scriptTimeout"] = timeout_ms
        return self.send("WebDriver:ExecuteScript", params)

    def screenshot(self, path):
        import base64
        result = self.send("WebDriver:TakeScreenshot", {"full": False})
        data = result.get("value") or result.get("path")
        # Marionette returns either base64 or a path to a temp file
        if isinstance(data, str) and data.startswith("/"):
            open(path, "wb").write(open(data, "rb").read())
        else:
            open(path, "wb").write(base64.b64decode(data))
        return path

    def wait_for(self, script, timeout=45, interval=0.5):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.execute(script):
                return True
            time.sleep(interval)
        return False


if __name__ == "__main__":
    url = sys.argv[1]
    out = sys.argv[2]
    ready = sys.argv[3] if len(sys.argv) > 3 else "true"
    m = Marionette()
    m.navigate(url)
    ok = m.wait_for(ready)
    print("ready condition met:", ok)
    print("saved:", m.screenshot(out))
