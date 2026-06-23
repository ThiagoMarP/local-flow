function calculateCapsuleBounds(
  workArea,
  { width = 420, height = 82, margin = 24 } = {},
) {
  if (!workArea) {
    throw new Error("A área útil da tela é obrigatória.");
  }
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height - height - margin),
    width,
    height,
  };
}

module.exports = { calculateCapsuleBounds };

