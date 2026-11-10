/**
 * Session sound effects — Web Audio, no assets, no library.
 *
 * These were duplicated verbatim in SessionPage.tsx and AssessmentMode.tsx, and puzzles played
 * no sound at all. One copy, used by quizzes, puzzles and the manipulatives.
 */

function ctx(): AudioContext | null {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  try {
    return new AC();
  } catch {
    return null;
  }
}

/** Two-note major third — the "that's right" chime. */
export function playCorrectSound() {
  const audio = ctx();
  if (!audio) return;
  [523.25, 659.25].forEach((freq, i) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    const t = audio.currentTime + i * 0.09;
    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.33);
    osc.start(t);
    osc.stop(t + 0.33);
  });
}

/** Soft "oops" blip — wrong, but gentle, not a harsh buzz. */
export function playWrongSound() {
  const audio = ctx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.type = "triangle";
  osc.frequency.setValueAtTime(330, audio.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, audio.currentTime + 0.18);
  gain.gain.setValueAtTime(0.14, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.22);
  osc.start();
  osc.stop(audio.currentTime + 0.23);
}

/** A short blip for each tap/placement — makes a manipulative feel physical. */
export function playTapSound() {
  const audio = ctx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.type = "triangle";
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.09, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audio.currentTime + 0.08);
  osc.start();
  osc.stop(audio.currentTime + 0.09);
}

/** Rising blip — a streak is building. Pitch climbs with the streak, then caps. */
export function playStreakSound(streak: number) {
  const audio = ctx();
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.type = "sine";
  osc.frequency.value = 520 + Math.min(streak, 10) * 45;
  gain.gain.setValueAtTime(0.2, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audio.currentTime + 0.16);
  osc.start();
  osc.stop(audio.currentTime + 0.17);
}
