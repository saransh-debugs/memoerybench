/**
 * Claim-Centric Evaluation Types
 * 
 * The canonical object is: Query → Claims → Supports
 * 
 * All evaluation layers operate on the same claim graph:
 * - Claim correctness (deterministic): Was the right info remembered?
 * - Claim grounding (deterministic): Were claims supported?
 * - Claim usage (LLM judge): Was memory used well?
 */

// ============================================================================
// CORE CLAIM TYPES
// ============================================================================

/**
 * A Support is a memory event that justifies a claim.
 * This is the link between claims and the memory store.
 */
export interface Support {
	/** Unique identifier for the memory event (e.g., "m07", "event_move_to_lisbon") */
	eventId: string;
	/** The actual content/text of the memory event */
	content: string;
	/** When this event occurred (ISO date string) */
	eventTime?: string;
	/** When this memory was recorded (may differ from eventTime) */
	recordedAt?: string;
	/** Optional metadata about the memory event */
	metadata?: Record<string, unknown>;
}

/**
 * A Claim is an atomic, falsifiable statement extracted from or about memory.
 * Example: "User lives in Lisbon"
 * 
 * Claims must be:
 * - Atomic: one fact per claim
 * - Falsifiable: can be verified against memory
 * - Linked: must reference supporting memory events
 */
export interface Claim {
	/** Unique identifier for this claim */
	id: string;
	/** The atomic statement (e.g., "User lives in Lisbon") */
	statement: string;
	/** Memory event IDs that support this claim */
	supportIds: string[];
	/** When this claim is valid (for temporal reasoning) */
	validAt?: string;
	/** Confidence score if provided by the system (0-1) */
	confidence?: number;
}

/**
 * A ClaimGraph is the canonical output of a memory agent.
 * It contains all claims made in response to a query, with their supports.
 */
export interface ClaimGraph {
	/** The original query */
	query: string;
	/** All claims made in response */
	claims: Claim[];
	/** All supporting memory events referenced */
	supports: Support[];
	/** The final answer text (derived from claims) */
	answerText?: string;
	/** Timestamp of generation */
	generatedAt: string;
}

// ============================================================================
// GOLD STORE TYPES
// ============================================================================

/**
 * A GoldClaim is the expected/correct claim for a question.
 */
export interface GoldClaim {
	/** The expected claim statement */
	statement: string;
	/** Memory event IDs that should support this claim */
	expectedSupportIds: string[];
	/** Is this claim required for a correct answer? */
	required: boolean;
	/** Category of claim (for analysis) */
	category?: string;
}

/**
 * A GoldSupport is a memory event in the gold store.
 */
export interface GoldSupport {
	/** Unique identifier */
	eventId: string;
	/** The content that should be in memory */
	content: string;
	/** When this event occurred */
	eventTime?: string;
	/** Is this event still current, or has it been superseded? */
	isCurrent: boolean;
	/** If superseded, what event replaced it? */
	supersededBy?: string;
}

/**
 * The GoldClaimStore is the ground truth for evaluation.
 * It defines what claims should be made and what supports them.
 */
export interface GoldClaimStore {
	/** Question/query being evaluated */
	questionId: string;
	question: string;
	/** Expected claims for correct answer */
	goldClaims: GoldClaim[];
	/** All valid memory events */
	goldSupports: GoldSupport[];
	/** The reference answer (optional, for display) */
	referenceAnswer?: string | number;
}

// ============================================================================
// EVALUATION INPUT
// ============================================================================

/**
 * Input to the claim-centric evaluation system.
 */
export interface EvaluationInput {
	/** Unique identifier for this evaluation */
	questionId: string;
	/** The gold store (ground truth) */
	gold: GoldClaimStore;
	/** The claim graph produced by the system under test */
	produced: ClaimGraph;
}

// ============================================================================
// DETERMINISTIC METRICS (Claim Correctness & Grounding)
// ============================================================================

/**
 * Claim-level deterministic metrics.
 * These catch hallucinations and missing information without LLM.
 */
export interface ClaimMetrics {
	/**
	 * Claim Recall: % of gold claims that are present in produced claims.
	 * Measures: Did we remember the right things?
	 */
	claimRecall: number;
	
	/**
	 * Claim Precision: % of produced claims that match gold claims.
	 * Measures: Did we avoid making false claims?
	 */
	claimPrecision: number;
	
	/**
	 * F1 score combining recall and precision.
	 */
	claimF1: number;
	
	/**
	 * Number of unsupported claims (claims with no valid support in produced graph).
	 * These are potential hallucinations.
	 */
	unsupportedClaims: number;
	
	/**
	 * Number of staleness violations (claims supported by outdated events).
	 * The system used old information when newer exists.
	 */
	stalenessViolations: number;
	
	/**
	 * Number of gold claims that were completely missed.
	 */
	missingClaims: number;
	
	/**
	 * Number of claims made that don't match any gold claim (false claims).
	 */
	falseClaims: number;
	
	/** Detailed breakdown */
	details: {
		/** Gold claims that were found */
		matchedGoldClaims: string[];
		/** Gold claims that were missed */
		missedGoldClaims: string[];
		/** Produced claims that don't match gold */
		falseClaimStatements: string[];
		/** Claims with no support */
		unsupportedClaimStatements: string[];
		/** Claims with stale support */
		staleClaimStatements: string[];
	};
}

// ============================================================================
// LLM JUDGE METRICS (Claim Usage Quality)
// ============================================================================

/**
 * Claim usage quality metrics - evaluated by LLM judge.
 * The judge NEVER decides truth. It only scores how well claims were used.
 */
export interface ClaimUsageMetrics {
	/**
	 * Coherence: Are claims combined logically in the answer? (1-5)
	 */
	coherence: number;
	
	/**
	 * Relevance: Are the claims relevant to the question? (1-5)
	 */
	relevance: number;
	
	/**
	 * Completeness: Does the answer use all necessary claims? (1-5)
	 * (Given the claims that were produced)
	 */
	completeness: number;
	
	/**
	 * Conciseness: Are irrelevant claims avoided/minimized? (1-5)
	 */
	conciseness: number;
	
	/**
	 * Average of all usage metrics.
	 */
	averageScore: number;
	
	/**
	 * Judge's explanation of the scores.
	 */
	explanation: string;
	
	/**
	 * Specific issues identified.
	 */
	issues: {
		/** Claims that were over-emphasized */
		overEmphasized: string[];
		/** Claims that were under-used */
		underUsed: string[];
		/** Claims combined incoherently */
		incoherentCombinations: string[];
	};
}

// ============================================================================
// COMBINED EVALUATION RESULT
// ============================================================================

/**
 * Final evaluation result combining all layers.
 */
export interface EvaluationResult {
	questionId: string;
	
	/** Deterministic: Claim correctness and grounding */
	claimMetrics: ClaimMetrics;
	
	/** LLM Judge: Claim usage quality (only if claims exist) */
	usageMetrics?: ClaimUsageMetrics;
	
	/** Overall pass/fail */
	pass: boolean;
	
	/** Failure reasons (which layer failed) */
	failureReasons: {
		claimCorrectness: boolean; // Missing or false claims
		claimGrounding: boolean;   // Unsupported or stale claims
		claimUsage: boolean;       // Poor claim usage
	};
	
	/** Human-readable explanation */
	explanation: string;
	
	/** Evaluation latency */
	latencyMs: number;
}

// ============================================================================
// EVALUATION OPTIONS
// ============================================================================

export interface EvaluationOptions {
	/** Model for claim usage judge (default: gpt-4o) */
	judgeModel?: string;
	
	/** Minimum claim recall to pass (default: 0.7) */
	minClaimRecall?: number;
	
	/** Minimum claim precision to pass (default: 0.7) */
	minClaimPrecision?: number;
	
	/** Maximum allowed unsupported claims (default: 0) */
	maxUnsupportedClaims?: number;
	
	/** Maximum allowed staleness violations (default: 0) */
	maxStalenessViolations?: number;
	
	/** Minimum usage quality average (default: 3.0) */
	minUsageQuality?: number;
	
	/** Skip LLM judge (deterministic only) */
	deterministicOnly?: boolean;
	
	/** Similarity threshold for claim matching (default: 0.8) */
	claimMatchThreshold?: number;
}

// ============================================================================
// EVALUATION SUMMARY
// ============================================================================

export interface EvaluationSummary {
	total: number;
	passed: number;
	failed: number;
	accuracy: number;
	
	/** Claim metrics averages */
	claimMetrics: {
		averageRecall: number;
		averagePrecision: number;
		averageF1: number;
		totalUnsupportedClaims: number;
		totalStalenessViolations: number;
		totalMissingClaims: number;
		totalFalseClaims: number;
	};
	
	/** Usage metrics averages (if LLM judge was used) */
	usageMetrics?: {
		averageCoherence: number;
		averageRelevance: number;
		averageCompleteness: number;
		averageConciseness: number;
		averageOverall: number;
	};
	
	/** Failure breakdown */
	failureBreakdown: {
		claimCorrectnessFailures: number;
		claimGroundingFailures: number;
		claimUsageFailures: number;
	};
}
