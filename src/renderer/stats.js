// "Time saved" on Início is an estimate: typing at 40 words per minute against
// speaking at 150. The assumption is shown in the tooltip next to the number.
export const TYPING_WPM = 40;
export const SPEAKING_WPM = 150;

export function timeSavedMinutes(words) {
  const count = Math.max(0, Number(words) || 0);
  return count / TYPING_WPM - count / SPEAKING_WPM;
}

export function formatTimeSaved(minutes) {
  if (minutes <= 0) return "0 min";
  if (minutes < 1) return "< 1 min";
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
