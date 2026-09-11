export type StableErrorCode =
  | "CONFIG_INVALID"
  | "PROOF_INVALID"
  | "PROOF_NOT_FINALIZED"
  | "PROOF_ENCODING_INVALID"
  | "PROOF_SERVICE_FAILED"
  | "PROOF_CAPACITY"
  | "PROOF_TIMEOUT"
  | "RATE_LIMITED"
  | "PROOF_SIMULATION_FAILED"
  | "PROOF_SUBMISSION_FAILED"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_INELIGIBLE"
  | "RPC_MISMATCH"
  | "COMMAND_NOT_IMPLEMENTED";

export class WorkerError extends Error {
  readonly code: StableErrorCode;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(
    code: StableErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "WorkerError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
  }

  toJSON() {
    return {
      ok: false as const,
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        details: this.details,
      },
    };
  }
}

export function stableError(error: unknown): ReturnType<WorkerError["toJSON"]> {
  if (error instanceof WorkerError) return error.toJSON();
  return new WorkerError("PROOF_INVALID", "operation failed").toJSON();
}
