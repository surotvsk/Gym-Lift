#!/usr/bin/env python3
"""Loopback viewer for an actual Android emulator; never controls physical devices."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import struct
import subprocess
import threading
import time


HTML = r"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GymLift · Watch</title>
<style>
:root{--d:min(80vw,62vh,400px);--lime:#d6f35a}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:radial-gradient(circle at 50% 38%,#2a2c27 0,#10110f 70%);color:#f4f3ef;font:15px system-ui,sans-serif;overflow:hidden}
.wrist{position:relative;display:flex;flex-direction:column;align-items:center}
.strap{width:calc(var(--d)*.46);height:calc(var(--d)*.42);background:linear-gradient(90deg,#161615,#2b2b28 45%,#161615);
border:1px solid #333;box-shadow:inset 0 0 18px #000}
.strap.top{border-radius:18px 18px 0 0;margin-bottom:-6px}
.strap.bottom{border-radius:0 0 18px 18px;margin-top:-6px}
.strap::after{content:"";display:block;height:100%;background:repeating-linear-gradient(0deg,transparent 0 22px,#0007 22px 24px)}
.case{position:relative;width:calc(var(--d)*1.14);height:calc(var(--d)*1.14);border-radius:50%;padding:calc(var(--d)*.07);
background:conic-gradient(from 210deg,#8a8c86,#d9dad4,#6f716c,#c9cac4,#8a8c86);
box-shadow:0 18px 50px #000b,inset 0 0 0 3px #4a4b47,inset 0 0 14px #000a;z-index:1}
.bezel{width:100%;height:100%;border-radius:50%;background:#000;padding:calc(var(--d)*.025);
box-shadow:inset 0 0 0 2px #1d1d1b,inset 0 0 20px #000}
#screen{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover;background:#000;cursor:pointer;
box-shadow:0 0 0 1px #111;touch-action:manipulation}
.glass{position:absolute;inset:calc(var(--d)*.095);border-radius:50%;pointer-events:none;
background:linear-gradient(145deg,#ffffff1f 0,#ffffff00 38%)}
.crown,.side{position:absolute;right:calc(var(--d)*-.03);border:0;padding:0;cursor:pointer;
background:linear-gradient(90deg,#55564f,#c8c9c2 40%,#6a6b65);color:transparent;box-shadow:2px 3px 6px #000a}
.crown{top:30%;width:calc(var(--d)*.085);height:calc(var(--d)*.2);border-radius:5px;
background:repeating-linear-gradient(0deg,#6a6b65 0 3px,#c8c9c2 3px 6px)}
.side{top:57%;width:calc(var(--d)*.06);height:calc(var(--d)*.12);border-radius:4px}
.crown:focus-visible,.side:focus-visible,#screen:focus-visible{outline:3px solid var(--lime);outline-offset:3px}
.tools{display:flex;gap:10px;margin-top:14px;z-index:2}
.tools button{border:1px solid #3a3b37;border-radius:22px;padding:0 16px;min-height:44px;background:#1a1a1c;color:var(--lime);font:inherit;cursor:pointer}
.tools button:focus-visible{outline:3px solid var(--lime)}
#status{min-height:36px;max-width:min(92vw,520px);margin:8px 12px 0;text-align:center;color:#a6a5a0;font-size:13px}
.hint{color:#6f706b;font-size:12px;margin-top:2px}
</style>
<main class="wrist">
<div class="strap top" aria-hidden="true"></div>
<div class="case">
<div class="bezel"><img id="screen" alt="GymLift on a Wear OS watch (live emulator)" tabindex="0" role="button" aria-label="Watch screen: click to tap, Enter taps the centre"></div>
<div class="glass" aria-hidden="true"></div>
<button class="crown" data-action="home" aria-label="Crown: Home (wheel over the watch scrolls)" title="Crown · Home">Crown</button>
<button class="side" data-action="back" aria-label="Side button: Back" title="Side button · Back">Back</button>
</div>
<div class="strap bottom" aria-hidden="true"></div>
</main>
<div class="tools"><button data-action="down">Scroll up</button><button data-action="up">Scroll down</button><button data-action="wake">Wake</button></div>
<p id="status" role="status" aria-live="polite">Connecting…</p>
<p class="hint">Mouse wheel = rotary crown · arrow keys scroll · Esc = Back · live Wear OS emulator, not a mockup.</p>
<script>
const token = __TOKEN__, screen = document.querySelector('#screen'), status = document.querySelector('#status');
let imageUrl, working = false, connected = false;
const headers = {'X-GymLift-Token':token};
async function frame() {
  try {
    const response = await fetch('/screen', {headers,cache:'no-store'});
    if (!response.ok) throw new Error(await response.text());
    const next = URL.createObjectURL(await response.blob()), old = imageUrl;
    await new Promise((resolve,reject) => {screen.onload=resolve;screen.onerror=reject;screen.src=next;});
    imageUrl = next; if (old) URL.revokeObjectURL(old);
    if (!connected) status.textContent = 'Connected. Emulator only; phone pairing is separate.';
    connected = true;
  } catch (error) {
    connected = false; status.textContent = 'Unavailable: ' + error.message;
  }
}
async function action(value) {
  if (working) return;
  working = true;
  try {
    const response = await fetch('/action', {method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify(value)});
    if (!response.ok) throw new Error(await response.text());
    status.textContent = 'Input delivered to emulator.';
    await frame();
  } catch (error) { status.textContent = 'Input failed: ' + error.message; }
  finally {working = false;}
}
screen.addEventListener('click', event => {
  if (!connected || !screen.naturalWidth) return;
  const box = screen.getBoundingClientRect();
  action({action:'tap',x:Math.floor((event.clientX-box.left)*screen.naturalWidth/box.width),
    y:Math.floor((event.clientY-box.top)*screen.naturalHeight/box.height)});
});
screen.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (connected) action({action:'tap',x:Math.floor(screen.naturalWidth/2),y:Math.floor(screen.naturalHeight/2)});
  }
});
document.querySelectorAll('[data-action]').forEach(button =>
  button.addEventListener('click', () => action({action:button.dataset.action})));
let wheelAt = 0;
document.addEventListener('wheel', event => {
  event.preventDefault();
  if (Date.now() - wheelAt < 450) return;
  wheelAt = Date.now();
  action({action:event.deltaY > 0 ? 'up' : 'down'});
}, {passive:false});
document.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); action({action:'up'}); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); action({action:'down'}); }
  else if (event.key === 'Escape') { action({action:'back'}); }
});
(async function poll(){if (!working) await frame();setTimeout(poll,1000);})();
</script></html>"""


class Viewer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port, serial, adb):
        self.serial, self.adb = serial, str(Path(adb).expanduser())
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()
        self.png, self.size, self.captured = b"", None, 0
        self.hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
        super().__init__(("127.0.0.1", port), Handler)

    def run_adb(self, *args):
        result = subprocess.run([self.adb, "-s", self.serial, *args], timeout=8,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return result.stdout

    def capture(self):
        if time.monotonic() - self.captured >= .5:
            png = self.run_adb("exec-out", "screencap", "-p")
            if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n":
                raise RuntimeError("Emulator did not return a screenshot")
            size = struct.unpack(">II", png[16:24])
            if not all(0 < n <= 4096 for n in size):
                raise RuntimeError("Unsupported emulator display")
            self.png, self.size, self.captured = png, size, time.monotonic()
        return self.png


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        return

    def respond(self, code, body, content_type="text/plain; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "frame-ancestors http://localhost:8126 http://127.0.0.1:8126")
        self.end_headers()
        self.wfile.write(body)

    def allowed(self, action=False):
        host = self.headers.get("Host", "")
        if host not in self.server.hosts:
            self.respond(403, "Invalid host")
            return False
        if action and self.headers.get("Origin") != "http://" + host:
            self.respond(403, "Invalid origin")
            return False
        return True

    def authenticated(self):
        if not secrets.compare_digest(self.headers.get("X-GymLift-Token", ""), self.server.token):
            self.respond(403, "Invalid viewer token")
            return False
        return True

    def do_GET(self):
        if not self.allowed():
            return
        if self.path == "/":
            self.respond(200, HTML.replace("__TOKEN__", json.dumps(self.server.token)), "text/html; charset=utf-8")
        elif self.path == "/screen" and self.authenticated():
            try:
                with self.server.lock:
                    image = self.server.capture()
                self.respond(200, image, "image/png")
            except (OSError, RuntimeError, subprocess.SubprocessError):
                self.respond(503, "Start the selected emulator and open GymLift.")
        elif self.path != "/screen":
            self.respond(404, "Not found")

    def do_POST(self):
        if not self.allowed(action=True) or not self.authenticated():
            return
        if self.path != "/action":
            self.respond(404, "Not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 512 or self.headers.get_content_type() != "application/json":
                raise ValueError("Expected small JSON action")
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError("Expected action object")
            action = value.get("action")
            if action not in ("tap", "up", "down", "back", "wake", "home"):
                raise ValueError("Unsupported action")
            with self.server.lock:
                if action in ("back", "wake", "home"):
                    key = {"back": "4", "wake": "224", "home": "3"}[action]
                    self.server.run_adb("shell", "input", "keyevent", key)
                else:
                    self.server.capture()
                    width, height = self.server.size
                    if action == "tap":
                        x, y = value.get("x"), value.get("y")
                        if type(x) is not int or type(y) is not int or not 0 <= x < width or not 0 <= y < height:
                            raise ValueError("Tap outside emulator display")
                        self.server.run_adb("shell", "input", "tap", str(x), str(y))
                    else:
                        start, end = (3, 1) if action == "up" else (1, 3)
                        self.server.run_adb("shell", "input", "swipe", str(width//2), str(height*start//4),
                                            str(width//2), str(height*end//4), "350")
                self.server.captured = 0
            self.respond(200, '{"ok":true}', "application/json")
        except (ValueError, TypeError):
            self.respond(400, "Invalid action or coordinates")
        except (OSError, RuntimeError, subprocess.SubprocessError):
            self.respond(503, "Emulator input failed; no success assumed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--adb", default="~/Android/Sdk/platform-tools/adb")
    parser.add_argument("--port", type=int, default=8127)
    args = parser.parse_args()
    if not re.fullmatch(r"emulator-[0-9]+", args.serial):
        parser.error("Only emulator serials are allowed")
    if args.port in (8124, 8125, 8126) or not 1024 <= args.port <= 65535:
        parser.error("Choose an unoccupied preview port, not 8124–8126")
    server = Viewer(args.port, args.serial, args.adb)
    print(f"Watch viewer ready: http://localhost:{args.port}/ ({args.serial})", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()