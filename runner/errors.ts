/**
 * Error Handling System
 *
 * Provides error codes, custom error classes, and utilities for better error handling.
 */

// =============================================================================
// Error Codes
// =============================================================================

export enum ErrorCode {
	// Provider errors (1xxx)
	PROVIDER_NOT_FOUND = 1001,
	PROVIDER_NOT_AVAILABLE = 1002,
	PROVIDER_INIT_FAILED = 1003,
	PROVIDER_MISSING_ENV = 1004,
	PROVIDER_INGEST_FAILED = 1005,
	PROVIDER_SEARCH_FAILED = 1006,
	PROVIDER_RESET_FAILED = 1007,

	// Benchmark errors (2xxx)
	BENCHMARK_NOT_FOUND = 2001,
	BENCHMARK_LOAD_FAILED = 2002,
	BENCHMARK_EVALUATION_FAILED = 2003,

	// Network/Transient errors (3xxx)
	NETWORK_ERROR = 3001,
	TIMEOUT_ERROR = 3002,
	RATE_LIMIT_ERROR = 3003,
	SERVICE_UNAVAILABLE = 3004,

	// Configuration errors (4xxx)
	INVALID_CONFIG = 4001,
	MISSING_REQUIRED_OPTION = 4002,

	// Checkpoint errors (5xxx)
	CHECKPOINT_READ_FAILED = 5001,
	CHECKPOINT_WRITE_FAILED = 5002,
	CHECKPOINT_CORRUPTED = 5003,

	// File/IO errors (6xxx)
	FILE_READ_ERROR = 6001,
	FILE_WRITE_ERROR = 6002,
	FILE_NOT_FOUND = 6003,

	// Unknown errors (9xxx)
	UNKNOWN_ERROR = 9001,
}

// =============================================================================
// Error Type Detection
// =============================================================================

export interface TransientError {
	readonly isTransient: true;
	readonly retryable: boolean;
	readonly retryAfter?: number; // milliseconds
}

export function isTransientError(error: unknown): error is TransientError {
	return (
		typeof error === "object" &&
		error !== null &&
		"isTransient" in error &&
		(error as TransientError).isTransient === true
	);
}

export function isNetworkError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const message = error.message.toLowerCase();
	const name = error.name.toLowerCase();

	return (
		name === "networkerror" ||
		name === "fetcherror" ||
		message.includes("network") ||
		message.includes("econnrefused") ||
		message.includes("enotfound") ||
		message.includes("etimedout") ||
		message.includes("econnreset") ||
		message.includes("socket hang up")
	);
}

export function isTimeoutError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const message = error.message.toLowerCase();
	const name = error.name.toLowerCase();

	return (
		name === "timeouterror" ||
		message.includes("timeout") ||
		message.includes("timed out") ||
		message.includes("deadline exceeded")
	);
}

export function isRateLimitError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const message = error.message.toLowerCase();
	const status = (error as any).status || (error as any).statusCode;

	return (
		status === 429 ||
		message.includes("rate limit") ||
		message.includes("too many requests") ||
		message.includes("quota exceeded")
	);
}

export function isServiceUnavailableError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;

	const status = (error as any).status || (error as any).statusCode;

	return (
		status === 503 ||
		status === 502 ||
		status === 504 ||
		(error.message.toLowerCase().includes("service unavailable") &&
			!error.message.toLowerCase().includes("permanently"))
	);
}

// =============================================================================
// Custom Error Classes
// =============================================================================

export class MemoryBenchError extends Error {
	readonly code: ErrorCode;
	readonly context?: Record<string, unknown>;
	readonly actionable?: string[];

	constructor(
		code: ErrorCode,
		message: string,
		options?: {
			context?: Record<string, unknown>;
			actionable?: string[];
			cause?: Error;
		},
	) {
		super(message, { cause: options?.cause });
		this.name = "MemoryBenchError";
		this.code = code;
		this.context = options?.context;
		this.actionable = options?.actionable;
	}

	toJSON() {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			context: this.context,
			actionable: this.actionable,
			cause: this.cause,
		};
	}
}

export class TransientMemoryBenchError extends MemoryBenchError implements TransientError {
	readonly isTransient = true as const;
	readonly retryable: boolean;
	readonly retryAfter?: number;

	constructor(
		code: ErrorCode,
		message: string,
		options?: {
			retryable?: boolean;
			retryAfter?: number;
			context?: Record<string, unknown>;
			actionable?: string[];
			cause?: Error;
		},
	) {
		super(code, message, options);
		this.name = "TransientMemoryBenchError";
		this.retryable = options?.retryable ?? true;
		this.retryAfter = options?.retryAfter;
	}
}

// =============================================================================
// Error Factory Functions
// =============================================================================

export function createProviderError(
	code: ErrorCode,
	message: string,
	providerName?: string,
	cause?: Error,
	options?: { actionable?: string[] },
): MemoryBenchError {
	const actionable: string[] = options?.actionable ?? [];

	if (actionable.length === 0) {
		switch (code) {
			case ErrorCode.PROVIDER_NOT_FOUND:
				actionable.push(`Check that the provider "${providerName}" exists in providers/`);
				actionable.push(`Run 'memorybench list' to see available providers`);
				break;
			case ErrorCode.PROVIDER_NOT_AVAILABLE:
				actionable.push(`Check that required environment variables are set`);
				actionable.push(`Run 'memorybench list' to see required env vars for "${providerName}"`);
				break;
			case ErrorCode.PROVIDER_MISSING_ENV:
				actionable.push(`Set the required environment variables`);
				actionable.push(`Check the provider's README for configuration details`);
				break;
			case ErrorCode.PROVIDER_INIT_FAILED:
				actionable.push(`Check provider configuration and dependencies`);
				actionable.push(`Verify that the provider service is running (if applicable)`);
				actionable.push(`Check logs for more details`);
				break;
			case ErrorCode.PROVIDER_INGEST_FAILED:
			case ErrorCode.PROVIDER_SEARCH_FAILED:
				if (isNetworkError(cause)) {
					actionable.push(`Check network connectivity`);
					actionable.push(`Verify provider service is accessible`);
				}
				actionable.push(`Check provider logs for detailed error information`);
				break;
		}
	}

	return new MemoryBenchError(code, message, {
		context: providerName ? { provider: providerName } : undefined,
		actionable,
		cause,
	});
}

export function createBenchmarkError(
	code: ErrorCode,
	message: string,
	benchmarkName?: string,
	cause?: Error,
	options?: { actionable?: string[] },
): MemoryBenchError {
	const actionable: string[] = options?.actionable ?? [];

	if (actionable.length === 0) {
		switch (code) {
			case ErrorCode.BENCHMARK_NOT_FOUND:
				actionable.push(`Check that the benchmark "${benchmarkName}" exists in benchmarks/`);
				actionable.push(`Run 'memorybench list' to see available benchmarks`);
				break;
			case ErrorCode.BENCHMARK_LOAD_FAILED:
				actionable.push(`Verify benchmark data files are present and accessible`);
				actionable.push(`Check file permissions and disk space`);
				break;
		}
	}

	return new MemoryBenchError(code, message, {
		context: benchmarkName ? { benchmark: benchmarkName } : undefined,
		actionable,
		cause,
	});
}

export function createTransientError(
	code: ErrorCode,
	message: string,
	error: unknown,
): TransientMemoryBenchError {
	const cause = error instanceof Error ? error : new Error(String(error));
	const retryAfter = isRateLimitError(error) ? 5000 : undefined; // 5s default for rate limits

	return new TransientMemoryBenchError(code, message, {
		retryable: true,
		retryAfter,
		cause,
		actionable: [
			`This error may be temporary. The operation will be retried automatically.`,
			`If the error persists, check your network connection and service status.`,
		],
	});
}

// =============================================================================
// Error Classification
// =============================================================================

export function classifyError(error: unknown): MemoryBenchError {
	if (error instanceof MemoryBenchError) {
		return error;
	}

	const baseError = error instanceof Error ? error : new Error(String(error));
	let code = ErrorCode.UNKNOWN_ERROR;
	let message = baseError.message;

	// Classify based on error characteristics
	if (isNetworkError(error)) {
		code = ErrorCode.NETWORK_ERROR;
		message = `Network error: ${baseError.message}`;
		return createTransientError(code, message, error);
	}

	if (isTimeoutError(error)) {
		code = ErrorCode.TIMEOUT_ERROR;
		message = `Timeout error: ${baseError.message}`;
		return createTransientError(code, message, error);
	}

	if (isRateLimitError(error)) {
		code = ErrorCode.RATE_LIMIT_ERROR;
		message = `Rate limit exceeded: ${baseError.message}`;
		return createTransientError(code, message, error);
	}

	if (isServiceUnavailableError(error)) {
		code = ErrorCode.SERVICE_UNAVAILABLE;
		message = `Service unavailable: ${baseError.message}`;
		return createTransientError(code, message, error);
	}

	// Check for common error patterns
	if (baseError.message.includes("ENOENT") || baseError.message.includes("not found")) {
		code = ErrorCode.FILE_NOT_FOUND;
		message = `File not found: ${baseError.message}`;
	}

	if (baseError.message.includes("EACCES") || baseError.message.includes("permission denied")) {
		code = ErrorCode.FILE_READ_ERROR;
		message = `Permission denied: ${baseError.message}`;
	}

	return new MemoryBenchError(code, message, { cause: baseError });
}

// =============================================================================
// Retry Logic
// =============================================================================

export interface RetryOptions {
	maxRetries?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	backoffMultiplier?: number;
	retryable?: (error: unknown) => boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
	maxRetries: 3,
	initialDelayMs: 1000,
	maxDelayMs: 10000,
	backoffMultiplier: 2,
	retryable: (error) => {
		if (isTransientError(error)) return error.retryable;
		return isNetworkError(error) || isTimeoutError(error) || isServiceUnavailableError(error);
	},
};

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
	let lastError: unknown;
	let delay = opts.initialDelayMs;

	for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// Don't retry if not retryable
			if (!opts.retryable(error)) {
				throw classifyError(error);
			}

			// Don't retry if we've exhausted attempts
			if (attempt >= opts.maxRetries) {
				break;
			}

			// Wait before retrying
			const waitTime = isTransientError(error) && error.retryAfter ? error.retryAfter : delay;
			await new Promise((resolve) => setTimeout(resolve, Math.min(waitTime, opts.maxDelayMs)));

			// Exponential backoff
			delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
		}
	}

	throw classifyError(lastError);
}

