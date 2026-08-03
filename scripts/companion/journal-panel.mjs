/** Lists journal entries the player can see; opening one just renders the
 * normal JournalEntry sheet as a floating Application, styled touch-friendly
 * by the same companion.css rule already covering SpellCastDialog etc. —
 * no custom journal viewer built here. */

export function buildJournalData() {
  const entries = game.journal
    .filter((j) => j.testUserPermission(game.user, "OBSERVER"))
    .map((j) => ({ id: j.id, name: j.name, img: j.img || "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { journalEntries: entries };
}

export function openJournalEntry(id) {
  const entry = game.journal.get(id);
  entry?.sheet?.render(true);
}
