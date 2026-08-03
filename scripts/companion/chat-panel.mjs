/** Reuses ChatMessage's own renderHTML() (so vagabond's custom chat cards
 * render identically to the normal sidebar) and ui.chat.processMessage()
 * (so /roll, /whisper, etc. all work exactly as typed in the normal chat
 * box) — no reimplementation, per the module's delegate-to-core strategy. */

const CHAT_LIMIT = 30;

export async function buildChatData() {
  const messages = game.messages.contents.slice(-CHAT_LIMIT);
  const rendered = [];
  for (const message of messages) {
    try {
      const el = await message.renderHTML();
      rendered.push({ id: message.id, html: el.outerHTML });
    } catch (err) {
      console.warn("Play on Mobile | failed to render chat message", message.id, err);
    }
  }
  return { chatMessages: rendered };
}

export function sendChatMessage(text) {
  return ui.chat.processMessage(text);
}
