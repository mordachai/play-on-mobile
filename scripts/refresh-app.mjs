const { ApplicationV2 } = foundry.applications.api;

/** Settings-menu entry that just reloads the page — no dialog, no form.
 * render() is what Foundry calls when the menu button is clicked, so
 * overriding it to reload skips ever building a window. */
export class RefreshApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "play-on-mobile-refresh" };

  render() {
    window.location.reload();
    return this;
  }
}
