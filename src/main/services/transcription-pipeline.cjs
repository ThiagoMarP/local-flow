const {
  PersonalizationService,
} = require("./personalization-service.cjs");
const { throwIfAborted } = require("./cancellation.cjs");

class TranscriptionPipeline {
  constructor({
    projectRoot,
    whisperCli,
    modelsDir,
    transcribeWav,
    revisionService,
    personalizationService = new PersonalizationService(),
  }) {
    this.projectRoot = projectRoot;
    this.whisperCli = whisperCli;
    this.modelsDir = modelsDir;
    this.transcribeWav = transcribeWav;
    this.revisionService = revisionService;
    this.personalizationService = personalizationService;
  }

  async run({
    wavBuffer,
    profile = "standard",
    vocabulary = [],
    threads = 24,
    revisionMode = "literal",
    revisionModel,
    revisionTimeoutMs,
    writingProfile = "neutral",
    replacements = [],
    snippets = [],
    onProgress,
    signal,
  }) {
    const startedAt = Date.now();
    throwIfAborted(signal);
    onProgress?.({ stage: "transcribing" });
    throwIfAborted(signal);
    const transcription = await this.transcribeWav({
      projectRoot: this.projectRoot,
      whisperCli: this.whisperCli,
      modelsDir: this.modelsDir,
      wavBuffer,
      profile,
      vocabulary,
      threads,
      signal,
    });
    throwIfAborted(signal);
    const personalized =
      this.personalizationService.applyReplacements(
        transcription.text,
        replacements,
      );
    if (revisionMode !== "literal") {
      onProgress?.({ stage: "revising", mode: revisionMode });
    }
    throwIfAborted(signal);
    const revision = await this.revisionService.revise(
      personalized.text,
      {
        mode: revisionMode,
        model: revisionModel,
        timeoutMs: revisionTimeoutMs,
        styleInstruction:
          this.personalizationService.writingInstruction(
            writingProfile,
          ),
        signal,
      },
    );
    throwIfAborted(signal);
    const expanded = this.personalizationService.expandSnippets(
      revision.text,
      snippets,
    );
    throwIfAborted(signal);
    return {
      ...transcription,
      originalText: transcription.text,
      text: expanded.text,
      totalElapsedMs: Date.now() - startedAt,
      revision: {
        mode: revision.mode,
        model: revision.model,
        applied: revision.applied,
        fallback: revision.fallback,
        reason: revision.reason,
        elapsedMs: revision.elapsedMs,
        path: revision.path || (revisionMode === "literal" ? "literal" : "model"),
      },
      personalization: {
        writingProfile,
        replacementsApplied: personalized.applied,
        snippetsExpanded: expanded.applied,
      },
    };
  }
}

module.exports = { TranscriptionPipeline };
