import { MODULE_ID } from "../settings.mjs";
import { getAdapter } from "../adapters/adapter-registry.mjs";
import { buildChatData, sendChatMessage } from "./chat-panel.mjs";
import { buildJournalData, openJournalEntry } from "./journal-panel.mjs";
import {
  buildAudioData,
  buildVolumeControls,
  toggleAudioPlaylist,
  toggleAudioSound,
  setAudioSoundVolume,
} from "./audio-panel.mjs";
import { setPanNibEnabled, setPanNibSensitivity } from "../gestures/pan-nib.mjs";
import { buildForeignSettingsGroups } from "./foundry-settings-panel.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const LONG_PRESS_MS = 500;

// Companion visual theme — see styles/companion.css THEME COLOR TOKENS block
// for what each value actually changes. Shared between _prepareContext (swatch
// selected-state) and _onRender (class toggling on the app root).
const THEME_COLORS = ["forest", "ocean", "sunset", "sakura", "oldschool"];
const THEME_MODES = ["dark", "light"];
const THEME_STYLES = ["round", "smooth", "square"];
const HANDEDNESS_OPTIONS = ["right", "left"];

export class PhoneCompanionApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "play-on-mobile-companion",
    classes: ["pom-companion-app"],
    tag: "div",
    window: { title: "Play on Mobile", resizable: false, minimizable: false },
    position: { width: 420, height: 720 },
    actions: {
      pickActor: PhoneCompanionApp._onPickActor,
      switchTab: PhoneCompanionApp._onSwitchTab,
      entryPress: PhoneCompanionApp._onEntryPress,
      entryDelta: PhoneCompanionApp._onEntryDelta,
      entryAction: PhoneCompanionApp._onEntryAction,
      rawRoll: PhoneCompanionApp._onRawRoll,
      togglePanel: PhoneCompanionApp._onTogglePanel,
      toggleAccordion: PhoneCompanionApp._onToggleAccordion,
      sendChat: PhoneCompanionApp._onSendChat,
      openJournal: PhoneCompanionApp._onOpenJournal,
      toggleAudioPlaylist: PhoneCompanionApp._onToggleAudioPlaylist,
      toggleAudioSound: PhoneCompanionApp._onToggleAudioSound,
      setThemeColor: PhoneCompanionApp._onSetThemeColor,
      setThemeMode: PhoneCompanionApp._onSetThemeMode,
      setThemeStyle: PhoneCompanionApp._onSetThemeStyle,
      setHandedness: PhoneCompanionApp._onSetHandedness,
      toggleNib: PhoneCompanionApp._onToggleNib,
      toggleFastRolls: PhoneCompanionApp._onToggleFastRolls,
      toggleForeignSetting: PhoneCompanionApp._onToggleForeignSetting,
      openSettingsMenu: PhoneCompanionApp._onOpenSettingsMenu,
    },
  };

  static PARTS = {
    app: { template: "modules/play-on-mobile/templates/companion-sheet.hbs" },
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
    this.adapter = getAdapter();
    this._activeTab = "sheet";
    this._data = null;
    this._handlersReady = false;
    this._renderQueued = false;
    // Panel has two states: "collapsed" (small name tab, map is the focus)
    // and "expanded" (open dock). Start expanded when there's no actor yet
    // (the actor picker needs room to show), collapsed otherwise.
    this._panelState = this.actor ? "collapsed" : "expanded";
    // Settings groups default open — they're short, and requiring a tap
    // before you can even see/change a setting is just friction. Only this
    // module's own group and the system's are opened by default among the
    // dynamic foreign-settings groups (see foundry-settings-panel.mjs) —
    // Core alone can be a dozen-plus entries, too long to dump open unasked.
    this._expandedAccordions = new Set([
      "settings-module",
      `settings-group-${MODULE_ID}`,
      `settings-group-${game.system.id}`,
      "audio-volume-controls",
    ]);
    this._closeItemMenuBound = this._closeItemMenu.bind(this);

    const onActorDoc = (doc) => this._onDocChange(doc);
    const onItemDoc = (doc) => this._onDocChange(doc.actor);
    const onCanvasEvent = () => this._scheduleRender();

    this._hooks = [
      ["updateActor", onActorDoc],
      ["updateItem", onItemDoc],
      ["createItem", onItemDoc],
      ["deleteItem", onItemDoc],
      ["createChatMessage", onCanvasEvent],
      ["updatePlaylist", onCanvasEvent],
      ["updatePlaylistSound", onCanvasEvent],
      ["play-on-mobile.reconnected", onCanvasEvent],
    ];
    for (const [name, fn] of this._hooks) Hooks.on(name, fn);
  }

  /** Coalesce bursts of Foundry hooks (e.g. an update triggering derived-data
   * recalculation on related documents) into a single re-render per tick —
   * matters on weak mobile CPUs where redundant Handlebars re-renders are costly. */
  _scheduleRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    Promise.resolve().then(() => {
      this._renderQueued = false;
      if (this.rendered) this.render();
    });
  }

  _onDocChange(actor) {
    if (actor && this.actor && actor.id === this.actor.id) this._scheduleRender();
  }

  async _prepareContext(_options) {
    if (!this.actor) {
      return {
        needsActorPick: true,
        actors: game.actors.filter((a) => a.isOwner),
      };
    }

    if (!this._handlersReady) {
      await this.adapter.initHandlers(this);
      this._handlersReady = true;
    }

    const sheetData = await this.adapter.buildSheetData(this);
    // Chat rendering calls each message's own renderHTML() — real work, so
    // only pay for it when that tab is actually the one showing.
    const chatData = this._activeTab === "chat" ? await buildChatData() : { chatMessages: [] };
    const journalData = this._activeTab === "journal" ? buildJournalData() : { journalEntries: [] };
    const audioData =
      this._activeTab === "audio"
        ? { ...buildAudioData(), volumeControls: buildVolumeControls() }
        : { playlists: [], volumeControls: [] };

    // Normalizes whatever `sections` the active adapter (hand-written JS
    // today, JSON descriptor from Phase C on) produced into what the generic
    // template needs: accordion open/closed state (namespaced `sectionId:
    // entryId` so ids from different sections never collide), the header-
    // reveal gate for stat-row, and a render-type flag per section so the
    // template can branch without a Handlebars string-equality helper. This
    // is the one place in the module that still needs to enumerate the six
    // renderer names — see docs/system-adapters-plan.md §5.6.
    const sections = (sheetData.sections ?? [])
      .filter((s) => s.hideIfEmpty === false || (s.entries?.length ?? 0) > 0)
      .map((s) => {
        const isItemList = s.render === "item-list";
        const isEntryList = s.render === "entry-list";
        for (const entry of s.entries ?? []) {
          if (isItemList || isEntryList) entry.open = this._expandedAccordions.has(`${s.id}:${entry.id}`);
        }
        return {
          ...s,
          open: isItemList && s.collapsible ? this._expandedAccordions.has(s.id) : undefined,
          visible: s.revealWith === "header" ? this._expandedAccordions.has("name") : true,
          isStatRow: s.render === "stat-row",
          isResources: s.render === "resources",
          isCheckGrid: s.render === "check-grid",
          isItemList,
          isEntryList,
        };
      });

    this._data = { ...sheetData, sections, ...chatData, ...journalData, ...audioData };
    return {
      ...this._data,
      activeTab: this._activeTab,
      nameExpanded: this._expandedAccordions.has("name"),
      tabs: {
        sheet: this._activeTab === "sheet",
        chat: this._activeTab === "chat",
        journal: this._activeTab === "journal",
        audio: this._activeTab === "audio",
        settings: this._activeTab === "settings",
      },
      unsupportedSystem: this.adapter.id === "generic",
      settingsModuleExpanded: this._expandedAccordions.has("settings-module"),
      volumeControlsExpanded: this._expandedAccordions.has("audio-volume-controls"),
      themeColorOptions: THEME_COLORS.map((value) => ({
        value,
        label: game.i18n.localize(`PLAYONMOBILE.Companion.Settings.ThemeColor.${value}`),
        selected: value === game.settings.get(MODULE_ID, "companionThemeColor"),
      })),
      themeModeOptions: THEME_MODES.map((value) => ({
        value,
        label: game.i18n.localize(`PLAYONMOBILE.Companion.Settings.ThemeMode.${value}`),
        selected: value === game.settings.get(MODULE_ID, "companionThemeMode"),
      })),
      themeStyleOptions: THEME_STYLES.map((value) => ({
        value,
        label: game.i18n.localize(`PLAYONMOBILE.Companion.Settings.ThemeStyle.${value}`),
        selected: value === game.settings.get(MODULE_ID, "companionThemeStyle"),
      })),
      nibEnabled: game.settings.get(MODULE_ID, "panNibEnabled"),
      nibSensitivity: game.settings.get(MODULE_ID, "panNibSensitivity"),
      // Only meaningful for a system whose descriptor declares
      // `fastForward` (see _onEntryPress) — shown regardless, since a
      // toggle that quietly does nothing for the current system is more
      // confusing than one that's always visible.
      fastRolls: game.settings.get(MODULE_ID, "fastRolls"),
      // Also registered config:true (see settings.mjs) so it still shows in
      // Foundry's own Configure Settings menu for the GM — duplicated here,
      // not moved, so a mobile player (no sidebar access, see
      // foundry-settings-panel.mjs header comment) can reach it without
      // hunting through the generic foundryGroups accordion below.
      handednessOptions: HANDEDNESS_OPTIONS.map((value) => ({
        value,
        label: game.i18n.localize(`PLAYONMOBILE.Companion.Settings.Handedness.${value}`),
        selected: value === game.settings.get(MODULE_ID, "companionHandedness"),
      })),
      // Every module/system's own player-facing settings, not just this
      // module's — see foundry-settings-panel.mjs. Only built while the
      // Settings tab is actually showing (walks every registered setting).
      foundryGroups: this._activeTab === "settings" ? buildForeignSettingsGroups(this._expandedAccordions) : [],
    };
  }

  /** Every accordion toggle / actor update / setting flip goes through a
   * full Handlebars re-render (see _prepareContext — server-side
   * {{#if this.open}} means there's no cheap DOM-only toggle), which
   * replaces the .pom-tab content and resets its scrollTop to 0. Snapshot
   * it here (old DOM still present) and restore in _onRender below. */
  _preRender(context, options) {
    super._preRender?.(context, options);
    this._savedScrollTop = this.element?.querySelector(".pom-tab")?.scrollTop ?? null;
  }

  /** ApplicationV2's own _onRender only runs after re-render, but the
   * expanded/collapsed class needs to be correct immediately on first paint
   * too. Also auto-scrolls chat, wires Enter-to-send, wires long-press
   * on inventory/magic items (no native long-press action type exists), and
   * wires chat messages (button listeners + long-press context menu). */
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this._savedScrollTop != null) {
      const tab = this.element.querySelector(".pom-tab");
      if (tab) tab.scrollTop = this._savedScrollTop;
      this._savedScrollTop = null;
    }
    this.element.classList.toggle("pom-expanded", this._panelState === "expanded");
    this.element.classList.toggle(
      "pom-left-handed",
      game.settings.get(MODULE_ID, "companionHandedness") === "left"
    );

    const themeColor = game.settings.get(MODULE_ID, "companionThemeColor");
    const themeMode = game.settings.get(MODULE_ID, "companionThemeMode");
    const themeStyle = game.settings.get(MODULE_ID, "companionThemeStyle");
    for (const c of THEME_COLORS) this.element.classList.toggle(`pom-theme-${c}`, c === themeColor);
    for (const s of THEME_STYLES) this.element.classList.toggle(`pom-style-${s}`, s === themeStyle);
    // Mode goes on document.body, not this.element — the long-press context
    // menu (_showPopupMenu) is appended straight to body rather than inside
    // .pom-companion-app, and still needs the mode-driven surface/overlay
    // tokens (see companion.css MODE block) to not always render dark.
    for (const m of THEME_MODES) document.body.classList.toggle(`pom-mode-${m}`, m === themeMode);

    if (this._activeTab === "chat") {
      const log = this.element.querySelector(".pom-chat-log");
      if (log) {
        log.scrollTop = log.scrollHeight;
        this._wireChatMessages(log);
      }

      const input = this.element.querySelector('input[name="chat-message"]');
      input?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        PhoneCompanionApp._onSendChat.call(this, event, input);
      });
    }

    for (const el of this.element.querySelectorAll("[data-longpress-toggle]")) {
      const { sectionId, entryId } = el.dataset;
      this._attachLongPress(el, () => this._toggleAccordion(`${sectionId}:${entryId}`), { suppressClick: true });
    }

    if (this._activeTab === "audio") {
      for (const input of this.element.querySelectorAll("input.pom-audio-volume")) {
        input.addEventListener("input", (event) => {
          setAudioSoundVolume(input.dataset.playlistId, input.dataset.soundId, Number(event.target.value));
        });
      }

      for (const input of this.element.querySelectorAll("input.pom-audio-global-volume")) {
        input.addEventListener("input", (event) => {
          const { inputToVolume, volumeToPercentage } = foundry.audio.AudioHelper;
          const value = Number(event.target.value);
          game.settings.set("core", input.dataset.key, inputToVolume(value));
          if (game.audio.globalMute) game.audio.globalMute = false;
          const readout = input.nextElementSibling;
          if (readout) readout.textContent = volumeToPercentage(value, { label: true });
        });
      }
    }

    if (this._activeTab === "settings") {
      const slider = this.element.querySelector('input[name="nib-sensitivity"]');
      slider?.addEventListener("input", (event) => {
        const value = Number(event.target.value);
        game.settings.set(MODULE_ID, "panNibSensitivity", value);
        setPanNibSensitivity(value);
        const readout = this.element.querySelector(".pom-nib-sensitivity-value");
        if (readout) readout.textContent = value.toFixed(2);
      });

      this._wireForeignSettingFields();
    }

    const handle = this.element.querySelector(".pom-panel-handle");
    if (handle) this._wireResizeHandle(handle);
  }

  /** Text/number/select/range fields for every OTHER module's own settings
   * (see foundry-settings-panel.mjs) — arbitrary and unbounded, so wired
   * generically by data-foreign-field rather than one listener per setting
   * the way the fixed nib-sensitivity slider above is. Range mirrors the
   * nib-sensitivity slider's live readout; select/number/text commit on
   * change (not on every keystroke) since typed values aren't valid
   * mid-edit and re-rendering on every keystroke would fight the caret. */
  _wireForeignSettingFields() {
    for (const el of this.element.querySelectorAll("[data-foreign-field]")) {
      const { namespace, key, foreignField } = el.dataset;
      if (foreignField === "range") {
        el.addEventListener("input", (event) => {
          const value = Number(event.target.value);
          game.settings.set(namespace, key, value);
          const readout = el.nextElementSibling;
          if (readout?.classList.contains("pom-nib-sensitivity-value")) readout.textContent = value;
        });
      } else {
        el.addEventListener("change", (event) => {
          const value = foreignField === "number" ? Number(event.target.value) : event.target.value;
          game.settings.set(namespace, key, value);
        });
      }
    }
  }

  /** Drag the handle to freely slide the panel between collapsed (only the
   * handle's own size on-screen) and fully open (--pom-panel-h portrait /
   * --pom-panel-w landscape, both fixed box sizes now — see companion.css)
   * instead of only the binary tap-toggle. Sets an inline --pom-panel-offset
   * (px) on the app root — 0 = collapsed, maxOffset = fully open — which
   * overrides the class-driven default in companion.css and drives the
   * bottom/right (or left) position, same technique a native bottom-sheet
   * drawer uses. A drag is distinguished from a tap by movement past
   * DRAG_THRESHOLD; a real drag marks the handle so the trailing click
   * (pointerup always fires one) doesn't also toggle via _onTogglePanel. */
  _wireResizeHandle(handle) {
    const DRAG_THRESHOLD = 10; // px — touch jitter on a small tap easily exceeds 6px
    // Landscape has exactly 3 fixed rest widths, no others: 0 (closed,
    // handle only), 160 (half-open, 1 column everywhere incl. saves), and
    // maxOffset (fully open, 2 columns / 3 for saves — see the @container
    // breakpoint on .pom-resource-substat-grid / .pom-checks-row in
    // companion.css, set well above 160 so only fully-open ever shows
    // multi-column). The drag preview itself is continuous (live width
    // follows the finger exactly); release always snaps to whichever of
    // the 3 stops is nearest, so you only need to drag past a stop's
    // midpoint toward an edge to commit to it.
    const LANDSCAPE_HALF_OFFSET = 160;
    let dragging = false;
    let moved = false;
    let portrait = true;
    let pointerId = null;
    let startPos = 0;
    let startOffset = 0;
    let maxOffset = 0;
    // The exact value last written to --pom-panel-offset during the drag —
    // used at release instead of re-measuring the DOM (see onPointerUp).
    let liveOffset = 0;

    const axisPos = (event) => (portrait ? event.clientY : event.clientX);
    // Portrait always slides via `bottom`; landscape via `right`, or `left`
    // when left-handed (see companion.css .pom-left-handed) — used only for
    // portrait below now, landscape no longer slides (see currentOffset).
    const sideProp = () =>
      portrait ? "bottom" : this.element.classList.contains("pom-left-handed") ? "left" : "right";
    const handleSize = () => {
      const raw = parseFloat(getComputedStyle(this.element).getPropertyValue("--pom-handle-size"));
      return Number.isNaN(raw) ? (portrait ? 60 : 36) : raw;
    };
    // Portrait: read the real `bottom` position — the box is a constant
    // size and only slides, so its distance off-screen IS the offset.
    // getComputedStyle on a custom property directly would hand back its
    // literal (possibly still-calc()) text, e.g.
    // "calc(var(--pom-panel-h) - var(--pom-handle-size, 50px))" while
    // .pom-expanded is driving it via the class default, which parseFloat
    // can't use — `bottom` itself is a real CSS property, always resolved
    // to px. Landscape: the box itself now RESIZES (see companion.css),
    // right/left stay pinned at 0, so the box's actual current width minus
    // the handle IS the offset instead.
    const currentOffset = () => {
      if (portrait) {
        const raw = parseFloat(getComputedStyle(this.element).getPropertyValue(sideProp()));
        const offset = (Number.isNaN(raw) ? -maxOffset : raw) + maxOffset;
        return Math.max(0, Math.min(maxOffset, offset));
      }
      const rect = this.element.getBoundingClientRect();
      return Math.max(0, Math.min(maxOffset, rect.width - handleSize()));
    };
    // Box size minus the handle's own size is how far there is left to
    // slide/grow — the same figure companion.css's bottom/width calc() uses
    // for its "fully open" offset. Portrait's box is a constant size, so
    // getBoundingClientRect() at drag-start reliably gives the true max
    // even while it sits mostly off-screen. Landscape's box now resizes
    // live, so reading its CURRENT rect at drag-start would only capture
    // whatever width it happens to be at right now (e.g. the collapsed
    // peek) — read the fixed --pom-panel-w custom prop instead, which is a
    // plain length (not calc()), so getComputedStyle hands back a
    // parseFloat-able value directly.
    const computeMaxOffset = () => {
      if (portrait) {
        const rect = this.element.getBoundingClientRect();
        return rect.height - handleSize();
      }
      const raw = parseFloat(getComputedStyle(this.element).getPropertyValue("--pom-panel-w"));
      const panelW = Number.isNaN(raw) ? 350 : raw;
      return panelW - handleSize();
    };

    const onPointerDown = (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      portrait = window.matchMedia("(orientation: portrait)").matches;
      dragging = true;
      moved = false;
      pointerId = event.pointerId;
      startPos = axisPos(event);
      maxOffset = computeMaxOffset();
      startOffset = currentOffset();
      handle.setPointerCapture(pointerId);
    };

    const onPointerMove = (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const delta = axisPos(event) - startPos;
      if (!moved && Math.abs(delta) > DRAG_THRESHOLD) {
        moved = true;
        this.element.classList.add("pom-dragging");
      }
      if (!moved) return;
      // Portrait sheet is always bottom-anchored (drag up = open, i.e.
      // -delta) — no handedness variance there, only one dock edge exists.
      // Landscape flips with the dock: right-anchored (right-handed) opens
      // on drag-left (-delta), but left-anchored (left-handed) is a mirror
      // image — its handle sits on the box's opposite (right) edge, so
      // opening it means dragging RIGHT, i.e. +delta. Both are still "away
      // from the pinned edge grows offset", just opposite delta signs.
      const sign = portrait || !this.element.classList.contains("pom-left-handed") ? -1 : 1;
      const offset = Math.max(0, Math.min(maxOffset, startOffset + sign * delta));
      liveOffset = offset;
      this.element.style.setProperty("--pom-panel-offset", `${offset}px`);
      event.preventDefault();
    };

    // Nearest of the 3 rest stops: closed, half-open (160), fully open.
    const snappedOffset = (offset) => {
      const stops = [0, LANDSCAPE_HALF_OFFSET, maxOffset];
      return stops.reduce((nearest, stop) =>
        Math.abs(offset - stop) < Math.abs(offset - nearest) ? stop : nearest
      );
    };

    const onPointerUp = (event) => {
      if (event.pointerId !== pointerId) return;
      dragging = false;
      this.element.classList.remove("pom-dragging");
      if (moved) {
        handle.dataset.suppressClick = "1";
        if (portrait) {
          // Binary: always settle fully open or fully closed. Re-measured
          // from the DOM (not liveOffset) — portrait's offset comes from
          // the `bottom` position, and this has always worked reliably.
          const rawOffset = currentOffset();
          this._panelState = rawOffset > maxOffset / 2 ? "expanded" : "collapsed";
          this.element.classList.toggle("pom-expanded", this._panelState === "expanded");
          this.element.style.removeProperty("--pom-panel-offset");
        } else {
          // Landscape: snap to the nearest of the 3 rest stops, using the
          // exact value already written to --pom-panel-offset during the
          // drag (liveOffset) rather than re-reading the DOM — avoids any
          // chance of an in-flight layout read landing on a stale width.
          const offset = snappedOffset(liveOffset);
          // Tied to the fully-open stop specifically (not a fuzzy
          // halfway point) — half-open (160) must NOT count as expanded,
          // it's the 1-column state, same visual weight as closed.
          this._panelState = offset >= maxOffset ? "expanded" : "collapsed";
          this.element.classList.toggle("pom-expanded", this._panelState === "expanded");
          this.element.style.setProperty("--pom-panel-offset", `${offset}px`);
        }
      }
      moved = false;
    };

    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  }

  /** Timer-based long-press, shared by inventory/magic item rows and chat
   * messages. `suppressClick` marks the element so a caller-owned click
   * handler (e.g. _onEntryPress) can bail out when the touch was consumed by
   * the long-press instead of a tap. */
  _attachLongPress(el, onLongPress, { suppressClick = false } = {}) {
    let timer = null;
    const start = () => {
      timer = setTimeout(() => {
        timer = null;
        if (suppressClick) el.dataset.suppressClick = "1";
        onLongPress();
      }, LONG_PRESS_MS);
    };
    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchend", cancel, { passive: true });
    el.addEventListener("touchmove", cancel, { passive: true });
    el.addEventListener("touchcancel", cancel, { passive: true });
  }

  /** buildChatData() serializes each message's rendered DOM to an HTML
   * string (message.outerHTML) and the template reinjects it via {{{html}}}
   * — Handlebars reparses that string into new DOM nodes, which discards any
   * listeners a system/module attached before serialization. Systems like
   * vagabond wire their chat-card buttons (damage/save/macro/reroll) off the
   * `renderChatMessageHTML` hook when core's own chat log renders a message;
   * replay that hook here against the live nodes so the same listeners get
   * (re)attached. Also wires long-press → context menu per message, since
   * touch has no right-click to hang core's ContextMenu off of. */
  _wireChatMessages(log) {
    for (const el of log.querySelectorAll("[data-message-id]")) {
      const message = game.messages.get(el.dataset.messageId);
      if (!message) continue;
      Hooks.callAll("renderChatMessageHTML", message, el);
      this._attachLongPress(el, () => this._openChatMessageMenu(el, message));
    }
  }

  /** Shared by the toggleAccordion action (tap on a section/trait/item title)
   * and the inventory/magic/spells long-press (no title button there — the
   * item row itself doubles as the accordion trigger, tap still uses/casts
   * it per _onEntryPress's suppressClick handoff above). */
  _toggleAccordion(id) {
    if (!id) return;
    if (this._expandedAccordions.has(id)) this._expandedAccordions.delete(id);
    else this._expandedAccordions.add(id);
    this.render();
  }

  /** Same options core's ContextMenu would show on right-click, gathered via
   * the same `getChatMessageContextOptions` hook (e.g. vagabond's Luck
   * Reroll/Force Critical entries), plus a Delete Message entry mirroring
   * core's default since that one isn't hook-registered. */
  _openChatMessageMenu(el, message) {
    const options = [];
    Hooks.callAll("getChatMessageContextOptions", this, options);
    const entries = options
      .filter((o) => (o.condition ?? o.visible ?? (() => true))(el))
      .map((o) => ({ label: o.name, onSelect: () => o.callback(el) }));
    if (message.canUserModify(game.user, "delete")) {
      entries.push({ label: "Delete Message", onSelect: () => message.delete() });
    }
    this._showPopupMenu(el, entries);
  }

  _showPopupMenu(anchorEl, entries) {
    this._closeItemMenu();
    if (!entries.length) return;

    const menu = document.createElement("div");
    menu.className = "pom-item-menu";
    for (const { label, onSelect } of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", async () => {
        this._closeItemMenu();
        await onSelect();
      });
      menu.appendChild(btn);
    }
    const rect = anchorEl.getBoundingClientRect();
    Object.assign(menu.style, {
      position: "fixed",
      left: `${Math.round(rect.left)}px`,
      top: `${Math.round(rect.bottom + 4)}px`,
    });
    document.body.appendChild(menu);
    this._itemMenuEl = menu;
    requestAnimationFrame(() => {
      document.addEventListener("pointerdown", this._closeItemMenuBound, { once: true });
    });
  }

  _closeItemMenu() {
    this._itemMenuEl?.remove();
    this._itemMenuEl = null;
  }

  _onClose(options) {
    for (const [name, fn] of this._hooks ?? []) Hooks.off(name, fn);
    this._closeItemMenu();
    return super._onClose(options);
  }

  static _onPickActor(_event, target) {
    const actorId = target.dataset.actorId;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    game.settings.set(MODULE_ID, "companionActorId", actorId);
    this.actor = actor;
    this._handlersReady = false;
    this._panelState = "collapsed";
    this.render();
  }

  static _onSwitchTab(_event, target) {
    const tab = target.dataset.tab;
    if (!tab || tab === this._activeTab) return;
    this._activeTab = tab;
    this.render();
  }

  /** Fires on tap for every entry type (resources have no press, so this
   * never applies to them) — check-grid rolls, item-list use/attack/cast,
   * regardless of which system adapter produced the section. A long-press
   * (item-list rows, see _attachLongPress wiring above) marks suppressClick
   * so the trailing click the touch also fires doesn't double-activate.
   *
   * Fast Rolls (Settings tab): when on and the descriptor declares
   * `fastForward.event`, a plain tap with no real modifier held gets that
   * fast-forward mod substituted in — skipping a system's own roll-config
   * dialog is the point of a one-tap mobile sheet. Actually holding
   * shift/ctrl always wins over the substitution, matching desktop
   * convention where a held modifier means "I want something different".
   * Vagabond declares no fastForward (its own rolls never dialog in the
   * first place), so this is a no-op for it today — it exists for systems
   * whose own rolls do. */
  static _onEntryPress(event, target) {
    if (target.dataset.suppressClick === "1") {
      delete target.dataset.suppressClick;
      return;
    }
    const { sectionId, entryId } = target.dataset;
    const section = this._data?.sections?.find((s) => s.id === sectionId);
    const entry = section?.entries?.find((e) => e.id === entryId);

    const held = event.shiftKey || event.ctrlKey;
    const fastForward = this.adapter.descriptor?.fastForward?.event;
    const mods =
      !held && fastForward && game.settings.get(MODULE_ID, "fastRolls")
        ? { shiftKey: false, ctrlKey: false, ...fastForward }
        : { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey };

    entry?.onPress?.(mods);
  }

  static _onEntryDelta(_event, target) {
    const { sectionId, entryId, delta } = target.dataset;
    const section = this._data?.sections?.find((s) => s.id === sectionId);
    const entry = section?.entries?.find((e) => e.id === entryId);
    entry?.onDelta?.(Number(delta));
  }

  /** Icon-row buttons inside an item's expanded accordion body (equipped,
   * inventory, magic) — same Use/Send to Chat/Equip-Unequip/Bind/Edit/Delete
   * set vagabond's own sheet shows on right-click, built per-item in the
   * active adapter's item-list section. */
  static _onEntryAction(_event, target) {
    const { sectionId, entryId, actionIndex } = target.dataset;
    const section = this._data?.sections?.find((s) => s.id === sectionId);
    const entry = section?.entries?.find((e) => e.id === entryId);
    entry?.actions?.[Number(actionIndex)]?.onSelect?.();
  }

  static _onRawRoll(_event, _target) {
    const input = this.element.querySelector('input[name="raw-formula"]');
    const formula = input?.value?.trim();
    if (formula) this._data?.onRawRoll?.(formula);
  }

  /** Tap toggles collapsed <-> expanded. The tab's label never changes
   * (always the actor name), so this is a cheap direct class toggle — no
   * Handlebars re-render needed. */
  static _onTogglePanel(_event, target) {
    // A drag release also fires a trailing click — _wireResizeHandle marks
    // it so it doesn't also toggle on top of the size the drag just set.
    if (target.dataset.suppressClick === "1") {
      delete target.dataset.suppressClick;
      return;
    }
    this._panelState = this._panelState === "expanded" ? "collapsed" : "expanded";
    this.element.style.removeProperty("--pom-panel-offset");
    this.element.classList.toggle("pom-expanded", this._panelState === "expanded");
  }

  static _onToggleAccordion(_event, target) {
    this._toggleAccordion(target.dataset.accordionId);
  }

  static async _onSendChat(_event, target) {
    const input = target.matches?.('input[name="chat-message"]')
      ? target
      : this.element.querySelector('input[name="chat-message"]');
    const text = input?.value?.trim();
    if (!text) return;
    input.value = "";
    await sendChatMessage(text);
  }

  static _onOpenJournal(_event, target) {
    openJournalEntry(target.dataset.journalId);
  }

  static _onToggleAudioPlaylist(_event, target) {
    toggleAudioPlaylist(target.dataset.playlistId);
  }

  static _onToggleAudioSound(_event, target) {
    toggleAudioSound(target.dataset.playlistId, target.dataset.soundId);
  }

  static _onSetThemeColor(_event, target) {
    game.settings.set(MODULE_ID, "companionThemeColor", target.dataset.value);
    this.render();
  }

  static _onSetThemeMode(_event, target) {
    game.settings.set(MODULE_ID, "companionThemeMode", target.dataset.value);
    this.render();
  }

  static _onSetThemeStyle(_event, target) {
    game.settings.set(MODULE_ID, "companionThemeStyle", target.dataset.value);
    this.render();
  }

  // The setting's own onChange (settings.mjs) already flips the pan nib
  // side and re-renders this app — kept here too, same belt-and-suspenders
  // pattern as the theme setters above, in case onChange ever stops firing
  // synchronously with this render cycle.
  static _onSetHandedness(_event, target) {
    game.settings.set(MODULE_ID, "companionHandedness", target.dataset.value);
    this.render();
  }

  static _onToggleNib(_event, _target) {
    const next = !game.settings.get(MODULE_ID, "panNibEnabled");
    game.settings.set(MODULE_ID, "panNibEnabled", next);
    setPanNibEnabled(next);
    this.render();
  }

  static _onToggleFastRolls(_event, _target) {
    game.settings.set(MODULE_ID, "fastRolls", !game.settings.get(MODULE_ID, "fastRolls"));
    this.render();
  }

  static _onToggleForeignSetting(_event, target) {
    const { namespace, key } = target.dataset;
    game.settings.set(namespace, key, !game.settings.get(namespace, key));
    this.render();
  }

  /** Same instantiate-and-render core does for any settings submenu button
   * (e.g. vagabond's "Configure HUD Display") — floats its own window on
   * top of the companion panel exactly as it would on desktop. */
  static _onOpenSettingsMenu(_event, target) {
    const { namespace, key } = target.dataset;
    const menu = game.settings.menus.get(`${namespace}.${key}`);
    if (!menu) return;
    new menu.type().render(true);
  }
}
