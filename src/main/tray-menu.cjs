const PROFILE_LABELS = {
  fast: "Rápido · Small",
  standard: "Padrão · Medium",
  accurate: "Precisão · Large V3 Turbo",
  parakeet: "Parakeet TDT 0.6B v3",
};

// The dictation entry follows what the capsule shows right now.
function dictationItem(state, toggleDictation) {
  if (state === "recording") {
    return { label: "Parar e transcrever", enabled: true, click: toggleDictation };
  }
  if (state === "processing" || state === "revising") {
    return { label: "Transcrevendo…", enabled: false };
  }
  if (state === "meeting") {
    return { label: "Ditado indisponível durante a reunião", enabled: false };
  }
  return { label: "Iniciar ditado", enabled: true, click: toggleDictation };
}

// Tray context menu as plain Electron menu template. Actions come first; the
// shortcut lines below are information only. Opening the tray takes focus from
// the app the user was in, so tray actions cannot paste there: dictation and
// "last transcription" both land on the clipboard.
function buildTrayTemplate({
  dictationState,
  dashboardVisible,
  profile,
  hotkey,
  shortcut,
  repaste,
  revisionMode,
  revisionEnabled = true,
  revisionModes,
  actions,
}) {
  return [
    dictationItem(dictationState, actions.toggleDictation),
    { label: "Copiar última transcrição", click: actions.copyLast },
    {
      label: revisionEnabled ? "Modo de revisão" : "Modo de revisão (desligada)",
      submenu: [
        {
          label: "Ligada",
          type: "checkbox",
          checked: revisionEnabled,
          click: () => actions.setRevisionEnabled(!revisionEnabled),
        },
        { type: "separator" },
        ...revisionModes.map(({ value, label }) => ({
          label,
          type: "radio",
          checked: value === revisionMode,
          enabled: revisionEnabled,
          click: () => actions.setRevisionMode(value),
        })),
      ],
    },
    { type: "separator" },
    { label: "Abrir Local Flow", click: actions.showDashboard },
    {
      label: dashboardVisible ? "Ocultar painel" : "Mostrar painel",
      click: actions.toggleDashboard,
    },
    { type: "separator" },
    {
      label: `Modelo: ${PROFILE_LABELS[profile] || PROFILE_LABELS.standard}`,
      enabled: false,
    },
    {
      label: hotkey.ready
        ? `Ditado: ${hotkey.display} (2× ou segurar)`
        : `Ditado: ${hotkey.display} indisponível`,
      enabled: false,
    },
    {
      label: shortcut.registered
        ? `Alternativa: ${shortcut.display}`
        : "Atalho alternativo indisponível",
      enabled: false,
    },
    {
      label: repaste.disabled
        ? "Colar última: desativado"
        : repaste.registered
          ? `Colar última: ${repaste.display}`
          : `Colar última: ${repaste.display} indisponível`,
      enabled: false,
    },
    { type: "separator" },
    { label: "Sair", click: actions.quit },
  ];
}

module.exports = { buildTrayTemplate };
