class TranscriptionPipeline {
  constructor({ projectRoot, transcribeWav, revisionService }) {
    this.projectRoot = projectRoot;
    this.transcribeWav = transcribeWav;
    this.revisionService = revisionService;
  }

  async run({
    wavBuffer,
    profile = "standard",
    vocabulary = [],
    threads = 24,
    revisionMode = "literal",
    revisionModel,
    revisionTimeoutMs,
    onProgress,
  }) {
    const startedAt = Date.now();
    onProgress?.({ stage: "transcribing" });
    const transcription = await this.transcribeWav({
      projectRoot: this.projectRoot,
      wavBuffer,
      profile,
      vocabulary,
      threads,
    });
    if (revisionMode !== "literal") {
      onProgress?.({ stage: "revising", mode: revisionMode });
    }
    const revision = await this.revisionService.revise(
      transcription.text,
      {
        mode: revisionMode,
        model: revisionModel,
        timeoutMs: revisionTimeoutMs,
      },
    );
    return {
      ...transcription,
      text: revision.text,
      totalElapsedMs: Date.now() - startedAt,
      revision: {
        mode: revision.mode,
        model: revision.model,
        applied: revision.applied,
        fallback: revision.fallback,
        reason: revision.reason,
        elapsedMs: revision.elapsedMs,
      },
    };
  }
}

module.exports = { TranscriptionPipeline };
