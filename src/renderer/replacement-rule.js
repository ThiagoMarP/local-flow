export function appendReplacementRule(rules, from, to) {
  const source = String(from ?? "").trim();
  const target = String(to ?? "").trim();
  if (!source || source.length > 120 || /\r|\n|=>/.test(source)) {
    throw new Error("Informe um trecho errado de até 120 caracteres, sem quebra de linha ou =>.");
  }
  if (target.length > 500 || /\r|\n/.test(target)) {
    throw new Error("O trecho correto pode ter até 500 caracteres em uma linha.");
  }
  if (source === target) {
    throw new Error("O trecho errado e o correto são iguais.");
  }
  if (rules.length >= 100) {
    throw new Error("Limite de 100 regras atingido.");
  }
  if (rules.some((rule) =>
    rule.from.toLocaleLowerCase("pt-BR") === source.toLocaleLowerCase("pt-BR"))) {
    throw new Error("Já existe uma regra para esse trecho. Edite-a em Configurações.");
  }
  return [...rules, { from: source, to: target }];
}
