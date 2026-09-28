// The capsule is too narrow for the full error the dashboard shows. These rules
// turn each known message into a short phrase naming what broke; the detail
// stays in the dashboard, one click away. First match wins, so the specific
// causes come before the generic prefixes they share.
const ERROR_LABELS = [
  [/acessar o microfone:.*permissão foi bloqueada/i, "Microfone bloqueado"],
  [/acessar o microfone:.*nenhum microfone/i, "Nenhum microfone"],
  [/acessar o microfone/i, "Microfone indisponível"],
  [/ainda não foi baixado/i, "Modelo não baixado"],
  [/motor de transcrição.*não foi encontrado/i, "Motor não encontrado"],
  [/terminou com código/i, "Motor não carregou"],
  [/excedeu o limite de/i, "Transcrição demorou demais"],
  [/não reconheceu fala/i, "Nenhuma fala reconhecida"],
  [/nenhum áudio foi capturado/i, "Nenhum áudio captado"],
  [/atalho não pôde iniciar/i, "Atalho não iniciou"],
  [/transcrição da reunião/i, "Reunião não transcrita"],
  [/^falha na transcrição/i, "Falha na transcrição"],
  [/^falha ao iniciar/i, "Falha ao iniciar"],
];

const MAX_RAW_LABEL = 26;

export function capsuleErrorLabel(message) {
  const text = String(message || "").trim();
  for (const [pattern, label] of ERROR_LABELS) {
    if (pattern.test(text)) return label;
  }
  return text && text.length <= MAX_RAW_LABEL ? text : "Algo deu errado";
}
