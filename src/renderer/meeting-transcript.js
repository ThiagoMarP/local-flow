// A meeting transcript as speech turns for the card: speaker, label, text and
// start time. New meetings carry turns.json (with timestamps); older ones only
// have the "[Você] …" / "[Chamada] …" text, parsed here without times.
export function transcriptTurns(meeting) {
  if (Array.isArray(meeting?.transcriptTurns)) {
    return meeting.transcriptTurns.map((turn) => ({
      speaker: turn.speaker === "mic" ? "mic" : "system",
      label: String(turn.label || ""),
      text: String(turn.text || ""),
      from: Number.isFinite(turn.from) ? turn.from : null,
    }));
  }
  const turns = [];
  for (const line of String(meeting?.transcript || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const labeled = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (labeled) {
      turns.push({
        speaker: labeled[1] === "Você" ? "mic" : "system",
        label: labeled[1],
        text: labeled[2],
        from: null,
      });
    } else if (turns.length) {
      turns.at(-1).text += `\n${line}`;
    } else {
      turns.push({ speaker: "system", label: "", text: line, from: null });
    }
  }
  return turns;
}

export function formatOffset(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "";
  const total = Math.floor(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
