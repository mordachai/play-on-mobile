# Foundry Cast — feasibility research + plan

**Status: ON HOLD.** Research and design only — no code exists. Rev 4, 2026-08-04.

To build this, see the handoff spec:
[foundry-cast-implementation.md](foundry-cast-implementation.md) — phases, todo list, tests,
and the constraints/dead-ends brief for an agent picking it up cold. This document is the
*why*; that one is the *what and in what order*.

## The use case

**One player, at home, alone.** Not the GM. Plays on their phone, wants the game on the big
screen on the wall, controlled from the phone in their hand.

- Phone = the Foundry client. It renders everything and is the input device.
- TV = **dumb display**. No WebGL, no Foundry client, no login. It decodes video, nothing more.
- Exactly one Foundry session exists.

### Settled constraints and decisions

1. **A Foundry user cannot hold two sessions.** No design where the TV is a second client.
2. **The TV cannot run Foundry anyway.** The phone renders and transmits an image.
3. **Transport is WebRTC.** Decided.
4. **HTTPS is a safe assumption for the target audience.** Forge, Oracle Cloud installs, and
   self-hosters with real certs — e.g. `https://foundry.newtales.xyz/game` and
   `https://gusvtt.duckdns.org:8443`. This is the decision that unlocks everything below.

> Rev 1 assumed an in-person table. Rev 2 recommended the TV opening Foundry itself. Rev 3
> concluded the whole thing needed a native phone app with `MediaCodec` and native
> `libwebrtc`. **Rev 3's native-code conclusion was driven entirely by the secure-context
> problem, and constraint 4 dissolves it.** Most of that plumbing is now unnecessary.

---

## 1. Verdict up front

**On an HTTPS Foundry origin, the entire sender is ordinary in-page JavaScript.**

`canvas.captureStream()` → `RTCPeerConnection` → a receiver page on the TV. No native
encoder, no `libwebrtc`, no `MediaProjection`, no Cast SDK required. The browser's WebRTC
stack picks the hardware H.264/VP8 encoder on its own.

What's left to decide is not *how to transmit* — that's solved — but **how the JavaScript
gets into the Foundry page**, because the canvas is only reachable from within that origin.

---

## 2. What changed from rev 3, and what didn't

| | Rev 3 (assumed plain HTTP) | Rev 4 (HTTPS) |
|---|---|---|
| `RTCPeerConnection` in page | blocked — insecure origin | **works** |
| `canvas.captureStream()` on Android | works | works |
| Encoder | native `MediaCodec` | browser picks hardware encoder |
| Sender | full native Kotlin app | **in-page JS** |
| Receiver | native app | **static HTTPS web page** |
| iOS | needs native app | **still needs native app** — unchanged |

**Still true, still fatal where it applies:**

- **iOS Safari does not support `canvas.captureStream()`**
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream),
  [WebKit bug 181663](https://bugs.webkit.org/show_bug.cgi?id=181663)). No iPhone sender from
  a web page, on any origin. Android-first is not a preference, it's the only option.
- **`getDisplayMedia()` is unsupported on every mobile browser**
  ([caniuse](https://caniuse.com/mdn-api_mediadevices_getdisplaymedia)) — irrelevant now,
  since we capture the canvas directly rather than the screen.
- **Cast Web Receiver has no WebGL** — irrelevant, it only has to play video.
- **`CastRemoteDisplay` is deprecated** and slated for removal. Don't build on it.
- **Plain-HTTP Foundry installs are simply not supported.** Document it as a requirement
  rather than trying to engineer around it.

---

## 3. Architecture

### 3.1 Sender: where the JS lives

The canvas is same-origin-only. A separately hosted web app **cannot** reach it — an iframe
of the Foundry page is cross-origin and opaque. So the sender code must execute *inside* the
Foundry page. Three delivery vehicles, and only three:

| Vehicle | Works without GM? | Effort | Notes |
|---|---|---|---|
| **Foundry module** | no — GM must install | lowest | fastest path to a working thing; fine for your own worlds |
| **Bookmarklet / userscript** | yes | low | awkward on Android Chrome, but no install anywhere |
| **Thin WebView app** | yes | medium | loads Foundry, injects the same JS; also fixes wake-lock and lifecycle |

**Recommendation: write the sender as one self-contained JS payload with all three vehicles
in mind, and ship the module first.** It's the cheapest way to get a working cast, it's
immediately useful on your own installs, and the identical payload later gets injected by the
app for players whose GM won't install anything. This mirrors how this repo already separates
a testable core from its delivery shell.

Note the tension with the original "application, not module" framing: the *receiver* and the
*no-GM-cooperation* case are what justify an application. The transport itself no longer
needs one.

### 3.2 The core trick: send a second view, not a mirror

Set the PIXI renderer's **backing store to 1920×1080 landscape** while leaving the canvas
displayed small on the phone via CSS. `captureStream()` captures the **backing store**, not
the CSS size — this is a supported PixiJS pattern (`resolution` / `autoDensity`, normally
used for HiDPI), so the TV gets a full-resolution landscape map while the phone shows a
scaled copy as its touch surface.

Consequences:
- TV gets a proper landscape map at native resolution, no phone chrome in frame.
- Phone stays fully usable as a character sheet — the thing screen mirroring destroys.
- **One canvas, one renderer, one session.** The phone and TV are two display sizes of one
  render, not two views. This is what keeps constraint 1 satisfied.

Risk: Foundry recomputes canvas dimensions on resize and orientation change, so the override
has to survive that. This is the main novel unknown — spike it first (§5).

### 3.3 Receiver: a static HTTPS page

The receiver is a plain web page: `RTCPeerConnection` → `video.srcObject` → fullscreen. It
needs HTTPS too (same secure-context rule applies on both ends), so it gets hosted once —
your existing domains are fine.

Tiers, in preference order:

| Tier | Receiver | Latency | Install |
|---|---|---|---|
| **R1** | Any browser: Android TV, Fire TV Silk, smart-TV browser, PC on HDMI | 50–150 ms | none — open a URL |
| **R2** | Small Android TV / Fire TV app wrapping R1 | 50–150 ms | sideload; fixes D-pad and URL entry |
| **R3** | Cast custom receiver | 100–200 ms | **Chromecast with Google TV / Nest displays only** — WebRTC is unsupported on older dongles |

R1 needs zero software written beyond a static page. R2 exists purely to remove the pain of
typing a URL with a remote. R3 is the only tier that reaches a plain dongle, and only the
recent ones.

### 3.4 Signaling — the one piece of infrastructure

WebRTC needs a side channel to exchange SDP and ICE candidates. Two constraints shape this:

- The phone page is HTTPS, so it **cannot** call a plain-HTTP endpoint on the LAN — mixed
  content is blocked. That rules out "the receiver hosts its own local signaling server,"
  which would otherwise be the obvious zero-infrastructure answer.
- Once signaling completes, **media goes peer-to-peer over the LAN** via ICE host candidates.
  The server never touches video.

So: **a tiny hosted WSS relay** that pairs two clients by short code and forwards a few KB of
SDP. Cloudflare Workers + Durable Objects, or any small VPS — and you already run
`newtales.xyz`, so hosting both the receiver page and the relay is a non-issue.

Pairing UX: receiver page shows a **6-character code + QR**; the phone scans or types it; the
relay matches them; WebRTC connects; the relay drops out.

**TURN is not needed** for same-room use — both devices are on the same LAN and host
candidates connect directly. Phone-on-cellular is explicitly out of scope; it would need a
TURN server relaying real video, which is a different cost structure entirely.

**Bluetooth: rejected.** Nowhere near the bandwidth, worse UX than a QR code.

### 3.5 Control

Control is trivial once the peer connection exists: open a **WebRTC data channel** alongside
the video track. No extra infrastructure, no extra latency. The phone's own scaled canvas is
the touch surface; gestures adjust the shared canvas, and the TV sees the result in the video
stream automatically — there is no separate "control the TV" problem, because the TV is
showing the phone's own render.

That's a genuinely nice property of this architecture: **panning is not a remote-control
command at all.** It's just the phone panning its own canvas.

The data channel is still worth having for receiver-side concerns: resolution/bitrate
changes, letterbox and safe-area adjustment, reconnect, and "sleep the screen".

### 3.6 Performance and thermal budget

Reduced from rev 3, but still the main product risk. The phone renders 1080p PIXI *and*
encodes video for hours.

- Browser WebRTC selects the **hardware** encoder automatically. Verify it actually does on
  target devices rather than assuming.
- Default **720p30**, offer 1080p opt-in. Battle maps are flat art and text; 720p is usually
  indistinguishable at couch distance.
- `captureStream(fps)` caps capture rate independently of Foundry's render loop.
- A VTT map is **static most of the time**, so WebRTC bitrate collapses in steady state. The
  sustained cost is far below continuous video.
- Perf preset disabling soft shadows, weather and fog animation — those are the expensive part.
- Wake lock while casting; the tab must stay foregrounded and the screen on, since a
  backgrounded tab stops producing frames.

### 3.7 Non-goals

Audio. Multiple receivers. Shared/table displays. Anything needing GM permissions. Running
Foundry on the TV. Plain-HTTP Foundry installs. Remote (non-LAN) casting.

---

## 4. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| 1080p backing-store override doesn't survive Foundry's resize handling | **high** | spike first; fall back to capturing at device resolution and upscaling |
| Phone thermals/battery over a 3-hour session | **high** | 720p30, hardware encode, static-frame bitrate collapse, perf presets |
| iOS impossible from the browser | **high** | Android-only v1, stated up front; native iOS app is a separate project |
| Backgrounding the tab kills the stream | medium | wake lock, foreground requirement, clear UX when it drops |
| Old Chromecast dongles can't do WebRTC | medium | R1/R2 tiers; document unsupported hardware |
| Signaling relay is infrastructure someone must run | medium | tiny and stateless; host on existing domain; media never transits it |
| Foundry internals change → canvas override breaks | medium | versioned capability profiles shipped as data, like this repo's descriptors |
| GM's install is plain HTTP | medium | documented requirement, detect and explain rather than fail silently |
| "Cast" is Google's trademark tied to the Cast SDK | low | different product name, no Cast badge |

**Licensing is fine.** Foundry's [license](https://foundryvtt.com/article/license/) restricts
hosted *instances*, not clients — and only one session is ever opened.

---

## 5. Phases

**Phase 0 — spikes.** Cheap now; all of these are browser-only, no app required.

1. **Backing-store override.** Force the Foundry canvas to a 1920×1080 landscape backing
   store, display it small, and confirm `captureStream()` yields 1080p — and that it survives
   a Foundry resize/orientation event. Pass = 1080p frames out, layout intact. *This is the
   novel risk; do it before anything else.*
2. **Loopback WebRTC.** Same phone, second tab: `captureStream` → `RTCPeerConnection` →
   `<video>`. Pass = live map on the second tab. Validates the whole transport with zero
   infrastructure.
3. **Real receiver.** Static page on a Fire TV / smart TV browser, manual SDP paste to skip
   signaling. Pass = <150 ms glass-to-glass on LAN, readable text at couch distance.
4. **Thermal gate.** 3 hours at 720p30 on a mid-range phone while playing. Pass = no thermal
   throttling, survivable battery drain. *Fail here and the whole "phone renders everything"
   model is unviable regardless of how clean the transport is.*
5. **Hardware encoder check.** Confirm via `chrome://webrtc-internals` that the browser picked
   a hardware encoder, not software.

**Phase 1 — module sender + static receiver page + signaling relay.** A working cast on your
own installs. This is the smallest thing that is genuinely useful.

**Phase 2 — no-GM delivery.** Bookmarklet/userscript, and/or the thin Android WebView app
injecting the identical payload. This is where "application, not module" gets satisfied.

**Phase 3 — receiver polish.** Android TV / Fire TV app wrapping the receiver page, QR
pairing, reconnect, letterbox/safe-area handling, perf presets.

**Phase 4 — optional.** Cast custom receiver for Chromecast-with-Google-TV. Native iOS app.

---

## 6. Decisions needed before Phase 1

1. **Ship the module sender first, or hold out for the app?** Recommendation: **module
   first.** It's days of work instead of weeks, it works on your own installs immediately, and
   the JS payload is identical to what the app will inject later. Nothing is thrown away.
2. **Where does the signaling relay live?** Recommendation: Cloudflare Workers + Durable
   Objects on an existing domain — stateless, free tier, no server to maintain.
3. **Capture resolution default.** Recommendation: 720p30, 1080p opt-in, pending spike 4.
4. **Minimum supported phone.** Needs a real answer before the thermal gate, since viability
   is entirely a question of "on what hardware."

---

## Sources

- [MDN: HTMLCanvasElement.captureStream()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream) — not supported in Safari / iOS Safari
- [WebKit bug 181663](https://bugs.webkit.org/show_bug.cgi?id=181663) — canvas.captureStream playback on iOS
- [PixiJS renderers guide](https://pixijs.com/8.x/guides/components/renderers) — `resolution` / `autoDensity`, backing store independent of CSS size
- [Chrome for Developers: capturing a MediaStream from a canvas](https://developer.chrome.com/blog/capture-stream)
- [W3C Secure Contexts](https://www.w3.org/TR/secure-contexts/) — why HTTPS is the enabling constraint
- [caniuse: getDisplayMedia](https://caniuse.com/mdn-api_mediadevices_getdisplaymedia) — unsupported on all mobile browsers
- [Add live support to a Cast Receiver](https://developers.google.com/cast/codelabs/cast-live-receiver) — WebRTC on Chromecast with Google TV / Nest displays only
- [Cast Web Receiver overview](https://developers.google.com/cast/docs/web_receiver) — no WebGL; video playback fine
- [Cast Web Sender setup](https://developers.google.com/cast/docs/web_sender) — Chrome for Android yes, iOS Chrome no, HTTPS required
- [`CastRemoteDisplay`](https://developers.google.com/android/reference/com/google/android/gms/cast/CastRemoteDisplay) — deprecated, slated for removal
- [shokimble/cast-canvas](https://github.com/shokimble/cast-canvas) — canvas→WebRTC reference implementation
- [Foundry VTT software license](https://foundryvtt.com/article/license/)
