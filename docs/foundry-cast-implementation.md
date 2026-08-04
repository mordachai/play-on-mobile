# Foundry Cast — implementation handoff

**STATUS: ON HOLD.** Nothing has been built. No code exists. This document is written so a
different agent can pick the project up cold, without the conversation that produced it.

Rationale, research and rejected alternatives live in
[foundry-cast-plan.md](foundry-cast-plan.md). **Read that first.** This document is the
executable part: what to build, in what order, and how to prove each step works.

---

## 0. Orientation for whoever picks this up

### What it is

A player is running Foundry VTT on their Android phone. They want the map on the TV on their
wall, while the phone stays usable as a character sheet. The phone renders everything and
streams the canvas to the TV over WebRTC on the local network.

### Non-negotiable constraints — do not redesign around these

These came from the project owner directly. An earlier revision of the plan violated each of
them and had to be thrown away.

1. **A Foundry user cannot hold two sessions.** The TV can never be a second Foundry client.
2. **The TV is a dumb display.** No WebGL, no Foundry, no login. It decodes video only.
3. **Transport is WebRTC.** Settled.
4. **HTTPS Foundry origins are assumed.** Forge, Oracle Cloud, and self-hosters with certs.
   Plain-HTTP installs are explicitly unsupported — detect and explain, don't engineer around.
5. **The target user is a player, not a GM**, and may be unable to install modules. The core
   payload must therefore not *depend* on being a module.

### Dead ends — already investigated, do not retry

| Idea | Why it's dead |
|---|---|
| Run Foundry on the TV / Chromecast | Cast Web Receiver has no WebGL; also violates constraints 1 and 2 |
| `CastRemoteDisplay` (phone renders, dongle presents) | deprecated by Google, slated for removal |
| `getDisplayMedia()` screen capture on the phone | unsupported on every mobile browser |
| Any iOS browser sender | Safari/iOS Safari has no `canvas.captureStream()`, on any origin |
| A separately hosted web app that reads the Foundry canvas | canvas is same-origin only; an iframe of Foundry is opaque |
| Receiver hosting its own LAN signaling server | phone page is HTTPS, cannot call plain-HTTP LAN endpoints (mixed content) |
| Bluetooth transport | nowhere near the bandwidth; worse pairing UX than a QR code |

### The one idea the whole thing rests on

Set the PIXI renderer's **backing store** to 1920×1080 landscape while the canvas is
*displayed* small on the phone via CSS. `captureStream()` captures the backing store, not the
CSS size. So the TV gets a full-resolution landscape map and the phone simultaneously shows a
scaled copy as its touch surface.

Because the TV displays the phone's own render, **panning is not a remote-control command** —
the phone pans its own canvas and the TV follows in the video. There is no control-latency
problem to solve.

---

## 1. Component layout

Build as a **standalone project**, not inside play-on-mobile. The core must be wrappable three
different ways, and play-on-mobile is a full companion UI with its own concerns. Reuse its
conventions (see its `CLAUDE.md`), not its code.

```
foundry-cast/
  core/                     # vehicle-agnostic; no Foundry globals at module scope
    capture.mjs             # backing-store override + captureStream lifecycle
    peer.mjs                # RTCPeerConnection, data channel, ICE handling
    signal.mjs              # relay client: pair, exchange SDP/ICE, disconnect
    presets.mjs             # resolution/bitrate/fps presets            [PURE]
    pairing.mjs             # pair-code generation + validation         [PURE]
    profiles.mjs            # per-Foundry-version capability profiles   [PURE]
    profiles/*.json         # data, shipped separately from code
  vehicles/
    module/                 # Foundry module wrapper (module.json + init hook)
    bookmarklet/            # build target: single javascript: URL
    webview/                # Android app injection entry point (Phase 3)
  receiver/                 # static HTTPS page: RTCPeerConnection -> <video>
  relay/                    # Cloudflare Worker + Durable Object signaling
  tests/                    # node --test
  tools/                    # build + validation scripts
```

**Testability rule, copied from play-on-mobile and important here:** anything marked `[PURE]`
takes its inputs through an explicit `ctx` object and must never read `game`, `canvas`,
`CONFIG` or `window` at module scope. That is what makes it unit-testable under plain
`node --test` with no browser. Keep that boundary; it is the difference between a suite that
runs in CI and one that needs a phone.

---

## 2. Phases and todo list

Each phase has an explicit gate. **Do not start a phase until the previous gate passes.**
Phase 0 exists to kill the project cheaply if it can't work — take it seriously and do not
skip ahead to building infrastructure.

### Phase 0 — Spikes (throwaway code, no infrastructure)

Goal: prove the four things that could each independently sink the project. All of these run
in a browser against a real Foundry world. No relay, no app, no receiver hosting.

- [ ] **0.1 Backing-store override.** Force the Foundry canvas to a 1920×1080 landscape
      backing store, display it scaled-down, confirm `captureStream()` emits 1080p frames.
      Then fire a window resize and an orientation change and confirm the override survives.
      **Gate: 1080p frames out, phone layout intact, survives resize.**
      *This is the novel risk. Do it first. If it fails, fall back to capturing at device
      resolution and upscaling on the TV, and re-evaluate whether the product is still worth
      building.*
- [ ] **0.2 Loopback WebRTC.** Same phone, second tab. `captureStream` →
      `RTCPeerConnection` → `<video>`, signaling by manual copy-paste.
      **Gate: live map visible in the second tab.** Validates the whole transport with zero
      infrastructure.
- [ ] **0.3 Real receiver.** Static page opened on a Fire TV / smart-TV browser, manual SDP
      paste. **Gate: <150 ms glass-to-glass on LAN, map text readable at couch distance.**
- [ ] **0.4 Thermal gate.** 3 hours at 720p30 on a mid-range phone during actual play.
      **Gate: no thermal throttling, battery drain survives a session.**
      *If this fails, the entire "phone renders everything" model is unviable regardless of
      how clean the transport is. Stop and report rather than optimising around it.*
- [ ] **0.5 Hardware encoder check.** `chrome://webrtc-internals` during 0.3.
      **Gate: a hardware encoder is selected, not software.**

### Phase 1 — Working cast on a friendly install

Goal: the owner can cast from their own Foundry (`https://foundry.newtales.xyz/game`) to a TV.
Module vehicle only — it is the cheapest path to something real, and the payload is identical
to what later vehicles inject.

- [ ] 1.1 `core/presets.mjs` — resolution/bitrate/fps presets. Pure, unit-tested.
- [ ] 1.2 `core/pairing.mjs` — 6-character pair codes. Unambiguous alphabet (no `0/O`, `1/I`).
      Pure, unit-tested.
- [ ] 1.3 `core/capture.mjs` — backing-store override, `captureStream(fps)`, teardown that
      restores the canvas exactly as found.
- [ ] 1.4 `core/peer.mjs` — offer/answer, ICE, video track, data channel, reconnect.
- [ ] 1.5 `relay/` — Cloudflare Worker + Durable Object. Pairs two clients by code, forwards
      SDP/ICE, then drops out. Stateless beyond the pairing window; **never carries media**.
- [ ] 1.6 `core/signal.mjs` — relay client implementing that protocol.
- [ ] 1.7 `receiver/` — static page: enter/scan code, connect, fullscreen video, letterbox
      correctly, show connection state, auto-reconnect.
- [ ] 1.8 `vehicles/module/` — Foundry module: a cast button, preset picker, pair-code UI.
- [ ] 1.9 Plain-HTTP detection with a clear explanatory message, not a silent failure.
- [ ] 1.10 Wake lock while casting; explicit UX when the tab is backgrounded and frames stop.

**Gate:** owner casts from phone to TV, one pair-code entry, survives a Foundry reload and a
Wi-Fi blip.

### Phase 2 — Works without GM cooperation

Goal: satisfy the original "application, not module" requirement — a player whose GM installs
nothing can still cast.

- [ ] 2.1 `vehicles/bookmarklet/` — build the core into a single `javascript:` URL.
- [ ] 2.2 Document the Android Chrome bookmarklet flow honestly; it is awkward.
- [ ] 2.3 `core/profiles.mjs` + `profiles/*.json` — per-Foundry-version capability profiles,
      shipped as data so a Foundry update doesn't require a release.
- [ ] 2.4 Graceful degradation when a profile is missing for the detected version.

**Gate:** cast works on a world where nothing was installed server-side.

### Phase 3 — Receiver and sender polish

- [ ] 3.1 Android TV / Fire TV receiver app wrapping `receiver/` — exists purely to avoid
      typing a URL with a D-pad.
- [ ] 3.2 QR pairing (receiver displays, phone scans).
- [ ] 3.3 Safe-area / overscan handling for TVs that crop edges.
- [ ] 3.4 Perf presets: disable soft shadows, weather, fog animation.
- [ ] 3.5 Bitrate/resolution renegotiation over the data channel.
- [ ] 3.6 `vehicles/webview/` — thin Android app that loads Foundry and injects the core.

### Phase 4 — Optional, only if demand exists

- [ ] 4.1 Cast custom receiver for Chromecast with Google TV / Nest displays.
      **Older Chromecast dongles do not support WebRTC — do not promise them.**
- [ ] 4.2 Native iOS app (WKWebView + external `UIScreen`). A separate project, not a flag.

---

## 3. Test strategy

Three tiers. Most bugs should be caught by tier 1, which needs no hardware.

### Tier 1 — Unit, `node --test tests/*.test.mjs`

No browser, no Foundry, no devices. Matches play-on-mobile's existing convention. Everything
`[PURE]` belongs here.

- [ ] `presets.test.mjs` — preset lookup, clamping, invalid input, bitrate derived from
      resolution×fps stays within bounds.
- [ ] `pairing.test.mjs` — code format, alphabet excludes ambiguous characters, validation
      rejects malformed/expired codes, collision behaviour.
- [ ] `profiles.test.mjs` — version matching and fallback ordering, missing-profile handling,
      malformed profile JSON rejected with a useful error.
- [ ] `signal-protocol.test.mjs` — the relay protocol as a **pure state machine**: pair,
      offer, answer, ICE, disconnect, timeout, duplicate code, peer-vanishes. Drive it with
      fake messages; no sockets.
- [ ] `capture-math.test.mjs` — the pure part of the backing-store calculation: given a
      viewport and a target, produce backing-store dimensions and CSS scale. Aspect-ratio
      handling and rounding.

### Tier 2 — Browser automation, Playwright, one machine

Two pages on one machine can form a real peer connection, so most of the transport is
automatable without a TV.

- [ ] Loopback: page A captures a canvas, page B receives; assert `videoWidth`/`videoHeight`
      match the requested resolution.
- [ ] Backing-store override against a **real Foundry world**, asserting `canvas.width` and
      the captured track's `getSettings()`.
- [ ] Override survives `resize` and `orientationchange`.
- [ ] Teardown restores the canvas to its original dimensions exactly.
- [ ] Reconnect after the receiver page is closed and reopened.
- [ ] Relay: two headless clients pair by code and exchange SDP.

Driving a real Foundry from Playwright has known traps documented in the memory note
`reference_foundry-live-testing-technique` — read it before writing these. In particular:
Foundry blocks small viewports, client-scoped settings live in localStorage and reset per
browser launch, and ApplicationV2 instances are not in `ui.windows`.

### Tier 3 — Manual, requires devices

Cannot be automated. Each needs a written result recorded in the repo, not just a thumbs-up.

- [ ] **Glass-to-glass latency.** Render a monotonic frame counter into the canvas, photograph
      the phone and TV in one shot, subtract. Target <150 ms on LAN. Repeat 5×, record the
      spread, not just the best number.
- [ ] **3-hour thermal/battery run** on the declared minimum phone, during real play. Record
      battery percentage per hour and whether throttling occurred.
- [ ] **Hardware encoder confirmation** via `chrome://webrtc-internals`.
- [ ] **Readability** — map text and token names legible at couch distance at 720p and 1080p.
- [ ] **Receiver matrix** — Fire TV Silk, an Android TV browser, a Samsung Tizen browser, a PC
      browser, and Chromecast with Google TV. Record which work.
- [ ] **Network hostility** — client-isolated AP, guest Wi-Fi, VLAN. Confirm the failure
      message is honest and actionable rather than a spinner.

### What must not be claimed without Tier 3

Do not report latency, battery life, or "it works on TVs" from unit tests or a five-minute
demo. The project owner has explicitly required live validation against real Foundry for
render-pipeline work rather than inference from unit tests.

---

## 4. Open questions for the project owner

Answer before Phase 1; none of them block Phase 0.

1. **Minimum supported phone.** Needed before the thermal gate — viability is entirely a
   question of what hardware it must run on.
2. **Where does the relay live?** Cloudflare Workers on an existing domain is the
   recommendation; confirm the domain and account.
3. **Default capture resolution** — 720p30 recommended, 1080p opt-in. Confirm after 0.4.
4. **Repo and licence** — new standalone repo, or a subdirectory alongside play-on-mobile?
5. **Product name.** Avoid "Cast" in anything user-facing: it is Google's trademark, tied to
   the Cast SDK, which this deliberately does not use.

---

## 5. Resuming this project

1. Read [foundry-cast-plan.md](foundry-cast-plan.md) for why the architecture is what it is.
2. Read §0 of this document for the constraints and dead ends. **Do not re-derive them** —
   three prior revisions were discarded by re-litigating settled points.
3. Start at Phase 0.1. It is the cheapest thing that can kill the project.
4. Ask the owner the §4 questions when Phase 0 passes, not before.
