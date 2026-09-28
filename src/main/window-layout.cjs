function calculateCapsuleBounds(
  workArea,
  { width = 420, height = 82, margin = 24, anchor = "bottom" } = {},
) {
  if (!workArea) {
    throw new Error("A área útil da tela é obrigatória.");
  }
  const y =
    anchor === "top"
      ? Math.round(workArea.y + margin)
      : Math.round(workArea.y + workArea.height - height - margin);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y,
    width,
    height,
  };
}

module.exports = { calculateCapsuleBounds };

