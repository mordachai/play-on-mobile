/** Basic GM playlist control mirrored to the phone — play/stop a playlist or
 * individual sound, adjust per-sound volume. Delegates entirely to Playlist's
 * own playAll/stopAll/playSound/stopSound (same calls the sidebar Playlists
 * tab makes), no reimplementation. GM-only: playlists aren't a per-player
 * permissioned view the way journals/actors are. */

export function buildAudioData() {
  if (!game.user.isGM) return { playlists: [] };

  const playlists = game.playlists.contents
    .map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      playing: playlist.playing,
      sounds: playlist.sounds.contents
        .map((sound) => ({
          id: sound.id,
          name: sound.name,
          playing: sound.playing,
          volume: sound.volume,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { playlists };
}

export function toggleAudioPlaylist(playlistId) {
  const playlist = game.playlists.get(playlistId);
  if (!playlist) return;
  if (playlist.playing) playlist.stopAll();
  else playlist.playAll();
}

export function toggleAudioSound(playlistId, soundId) {
  const playlist = game.playlists.get(playlistId);
  const sound = playlist?.sounds.get(soundId);
  if (!playlist || !sound) return;
  if (sound.playing) playlist.stopSound(sound);
  else playlist.playSound(sound);
}

export function setAudioSoundVolume(playlistId, soundId, volume) {
  const sound = game.playlists.get(playlistId)?.sounds.get(soundId);
  sound?.update({ volume });
}

/** Core's own Music/Environment/Interface sliders (Sidebar > Playlists >
 * "User Volume Controls" — see playlist-directory.mjs _prepareControlsContext)
 * are unreachable from the phone since companion mode hides the whole
 * sidebar. Per-user client setting, not GM-gated like the rest of this file.
 * Uses AudioHelper's own input<->volume conversion so the slider position
 * and percentage readout match core's exactly. */
export function buildVolumeControls() {
  const { volumeToInput, volumeToPercentage } = foundry.audio.AudioHelper;
  const channels = [
    { key: "globalPlaylistVolume", label: "AUDIO.CHANNELS.MUSIC.label" },
    { key: "globalAmbientVolume", label: "AUDIO.CHANNELS.ENVIRONMENT.label" },
    { key: "globalInterfaceVolume", label: "AUDIO.CHANNELS.INTERFACE.label" },
  ];
  return channels.map(({ key, label }) => {
    const value = volumeToInput(game.settings.get("core", key));
    return {
      key,
      label: game.i18n.localize(label),
      value,
      percent: volumeToPercentage(value, { label: true }),
    };
  });
}
