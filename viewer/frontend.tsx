/**
 * MemoryBench Viewer Frontend
 * 
 * React-based dashboard for viewing benchmark results.
 * Inspired by https://evals.honcho.dev/
 */

import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// Types
interface ResultFile {
	path: string;
	name: string;
	runId: string;
	completedAt: string;
	accuracy: number;
	testCases: number;
}

interface SearchResult {
	id: string;
	content: string;
	score: number;
}

interface EvaluationResult {
	passed: boolean;
	score: number;
	details?: {
		foundAnswer?: string;
		reason?: string;
		matchedResults?: SearchResult[];
	};
}

interface TestCaseResult {
	testCaseId: string;
	query: string;
	searchResults: SearchResult[];
	evaluation: EvaluationResult;
	latencyMs: number;
	error?: string;
}

interface ConfidenceInterval {
	lower: number;
	upper: number;
	margin: number;
	width: number;
	confidenceLevel: number;
}

interface SampleQuality {
	sufficient: boolean;
	recommendedSampleSize?: number;
	qualityScore: "excellent" | "good" | "fair" | "poor";
}

interface Metrics {
	total: number;
	passed: number;
	failed: number;
	accuracy: number;
	avgScore: number;
	avgLatencyMs: number;
	p50LatencyMs: number;
	p95LatencyMs: number;
	accuracyCI?: ConfidenceInterval;
	avgScoreCI?: ConfidenceInterval;
	avgLatencyCI?: ConfidenceInterval;
	sampleQuality?: SampleQuality;
}

interface TaskTypeBreakdown {
	taskType: string;
	total: number;
	passed: number;
	accuracy: number;
	avgScore: number;
	avgLatencyMs: number;
}

interface BenchmarkProviderResult {
	benchmark: string;
	provider: string;
	testCases: TestCaseResult[];
	metrics: Metrics;
	breakdownByTaskType?: TaskTypeBreakdown[];
	startedAt: string;
	completedAt: string;
}

interface RunResult {
	metadata: {
		runId: string;
		startedAt: string;
		completedAt: string;
		durationMs: number;
		version: string;
	};
	results: BenchmarkProviderResult[];
	summary: {
		totalBenchmarks: number;
		totalProviders: number;
		totalTestCases: number;
		overallAccuracy: number;
	};
}

// Utility functions
function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

function getAccuracyClass(accuracy: number): string {
	if (accuracy >= 0.8) return "high";
	if (accuracy >= 0.5) return "medium";
	return "low";
}

function getAccuracyColor(accuracy: number): string {
	if (accuracy >= 0.8) return "var(--accent-success)";
	if (accuracy >= 0.5) return "var(--accent-warning)";
	return "var(--accent-error)";
}

function formatConfidenceInterval(value: number, ci?: ConfidenceInterval, isPercent = false): string {
	if (!ci) {
		return isPercent ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
	}
	
	const displayValue = isPercent ? value * 100 : value;
	const lowerBound = isPercent ? ci.lower * 100 : ci.lower;
	const upperBound = isPercent ? ci.upper * 100 : ci.upper;
	const margin = isPercent ? ci.margin * 100 : ci.margin;
	
	if (isPercent) {
		return `${displayValue.toFixed(1)}% ± ${margin.toFixed(1)}% (${lowerBound.toFixed(1)}% - ${upperBound.toFixed(1)}%)`;
	} else {
		return `${displayValue.toFixed(2)} ± ${margin.toFixed(2)} (${lowerBound.toFixed(2)} - ${upperBound.toFixed(2)})`;
	}
}

function getSampleQualityBadge(quality?: SampleQuality): { text: string; color: string; emoji: string } | null {
	if (!quality) return null;
	
	switch (quality.qualityScore) {
		case "excellent":
			return { text: "Excellent", color: "var(--accent-success)", emoji: "✓" };
		case "good":
			return { text: "Good", color: "var(--accent-primary)", emoji: "✓" };
		case "fair":
			return { text: "Fair", color: "var(--accent-warning)", emoji: "⚠" };
		case "poor":
			return { text: "Poor", color: "var(--accent-error)", emoji: "⚠" };
		default:
			return null;
	}
}

// Toast Notification System
interface Toast {
	id: string;
	message: string;
	type: 'success' | 'error' | 'info';
}

const ToastContext = React.createContext<{
	showToast: (message: string, type: Toast['type']) => void;
} | null>(null);

function ToastProvider({ children }: { children: React.ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);
	
	const showToast = (message: string, type: Toast['type'] = 'info') => {
		const id = Math.random().toString(36).substr(2, 9);
		setToasts(prev => [...prev, { id, message, type }]);
		
		setTimeout(() => {
			setToasts(prev => prev.filter(t => t.id !== id));
		}, 3000);
	};
	
	return (
		<ToastContext.Provider value={{ showToast }}>
			{children}
			<div style={{
				position: 'fixed',
				top: '1rem',
				right: '1rem',
				zIndex: 9999,
				display: 'flex',
				flexDirection: 'column',
				gap: '0.5rem',
				pointerEvents: 'none'
			}}>
				{toasts.map(toast => (
					<div
						key={toast.id}
						className="fade-in"
						style={{
							background: toast.type === 'success' ? 'var(--gradient-success)' :
										toast.type === 'error' ? 'var(--gradient-error)' :
										'var(--gradient-accent)',
							color: 'white',
							padding: '0.75rem 1rem',
							borderRadius: 'var(--radius-lg)',
							boxShadow: 'var(--shadow-lg)',
							fontSize: '0.875rem',
							fontWeight: 500,
							maxWidth: '300px',
							pointerEvents: 'auto'
						}}
					>
						{toast.message}
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
}

function useToast() {
	const context = React.useContext(ToastContext);
	if (!context) throw new Error('useToast must be used within ToastProvider');
	return context;
}

// Copy to Clipboard Hook
function useCopyToClipboard() {
	const { showToast } = useToast();
	
	return (text: string) => {
		navigator.clipboard.writeText(text).then(
			() => showToast('Copied to clipboard!', 'success'),
			() => showToast('Failed to copy', 'error')
		);
	};
}

// Animated Counter Hook
function useAnimatedCounter(end: number, duration: number = 1000, decimals: number = 0) {
	const [count, setCount] = useState(0);
	
	useEffect(() => {
		let startTime: number | null = null;
		const startValue = 0;
		
		const animate = (currentTime: number) => {
			if (!startTime) startTime = currentTime;
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			
			// Easing function for smooth animation
			const easeOutQuart = 1 - Math.pow(1 - progress, 4);
			const current = startValue + (end - startValue) * easeOutQuart;
			
			setCount(current);
			
			if (progress < 1) {
				requestAnimationFrame(animate);
			} else {
				setCount(end);
			}
		};
		
		requestAnimationFrame(animate);
	}, [end, duration]);
	
	return decimals > 0 ? count.toFixed(decimals) : Math.floor(count).toString();
}

// Components
function Header() {
	const [scrolled, setScrolled] = useState(false);
	
	useEffect(() => {
		const handleScroll = () => {
			setScrolled(window.scrollY > 10);
		};
		window.addEventListener('scroll', handleScroll);
		return () => window.removeEventListener('scroll', handleScroll);
	}, []);
	
	return (
		<header className="header" style={{
			boxShadow: scrolled ? '0 4px 6px rgba(0, 0, 0, 0.4)' : 'none',
		}} role="banner">
			<div className="header-content">
				<a href="/" className="logo" aria-label="MemoryBench Home">
					<span className="logo-icon" aria-hidden="true">📊</span>
					<span>MemoryBench</span>
				</a>
				<nav className="nav" role="navigation" aria-label="Main navigation">
					<a href="/" className="nav-link active" aria-current="page">Results</a>
					<a 
						href="https://github.com/supermemoryai/memorybench" 
						className="nav-link" 
						target="_blank" 
						rel="noopener noreferrer"
						aria-label="View on GitHub (opens in new tab)"
					>
						GitHub
					</a>
				</nav>
			</div>
		</header>
	);
}

function LoadingSpinner() {
	return (
		<div className="loading fade-in" role="status" aria-live="polite">
			<div className="loading-spinner" aria-hidden="true" />
			<p style={{ marginTop: "1rem", fontWeight: 500 }}>Loading results...</p>
			<span className="sr-only">Loading benchmark results, please wait...</span>
		</div>
	);
}

function SkeletonCard() {
	return (
		<div className="stat-card">
			<div className="skeleton" style={{ height: '1rem', width: '60%', marginBottom: '0.5rem' }} />
			<div className="skeleton" style={{ height: '2rem', width: '80%' }} />
		</div>
	);
}

function LoadingSkeleton() {
	return (
		<div className="dashboard fade-in">
			<div className="page-header">
				<div className="skeleton" style={{ height: '2rem', width: '300px' }} />
			</div>
			<div className="stats-grid">
				{[...Array(5)].map((_, i) => (
					<SkeletonCard key={i} />
				))}
			</div>
			<div className="results-section">
				<div className="section-header">
					<div className="skeleton" style={{ height: '1.5rem', width: '200px' }} />
				</div>
				<div style={{ padding: '2rem' }}>
					{[...Array(3)].map((_, i) => (
						<div key={i} style={{ marginBottom: '1rem' }}>
							<div className="skeleton" style={{ height: '4rem', width: '100%' }} />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

// Simple inline progress bar for visualizations
function ProgressBar({ value, max = 100, color = "var(--accent-primary)", height = "6px" }: { 
	value: number; 
	max?: number; 
	color?: string; 
	height?: string;
}) {
	const percentage = Math.min((value / max) * 100, 100);
	
	return (
		<div style={{
			width: '100%',
			height,
			background: 'var(--bg-tertiary)',
			borderRadius: 'var(--radius-sm)',
			overflow: 'hidden',
			position: 'relative'
		}}>
			<div 
				style={{
					width: `${percentage}%`,
					height: '100%',
					background: color,
					transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)',
					boxShadow: `0 0 10px ${color}40`
				}}
			/>
		</div>
	);
}

// Sparkline mini chart
function Sparkline({ data, color = "var(--accent-primary)", height = 40 }: {
	data: number[];
	color?: string;
	height?: number;
}) {
	if (data.length === 0) return null;
	
	const max = Math.max(...data);
	const min = Math.min(...data);
	const range = max - min || 1;
	
	const points = data.map((value, i) => {
		const x = (i / (data.length - 1)) * 100;
		const y = ((max - value) / range) * 100;
		return `${x},${y}`;
	}).join(' ');
	
	return (
		<svg 
			width="100%" 
			height={height} 
			viewBox="0 0 100 100" 
			preserveAspectRatio="none"
			style={{ display: 'block' }}
		>
			<polyline
				points={points}
				fill="none"
				stroke={color}
				strokeWidth="3"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{
					filter: `drop-shadow(0 0 4px ${color}60)`
				}}
			/>
		</svg>
	);
}

function EmptyState({ title, description }: { title: string; description: string }) {
	return (
		<div className="empty-state" role="status" aria-live="polite">
			<div className="empty-icon" aria-hidden="true">📭</div>
			<h3 className="empty-title">{title}</h3>
			<p className="empty-description">{description}</p>
		</div>
	);
}

function StatCard({ label, value, className, delay = 0, progress }: { 
	label: string; 
	value: string | number; 
	className?: string; 
	delay?: number;
	progress?: number;
}) {
	const [isVisible, setIsVisible] = useState(false);
	
	useEffect(() => {
		const timer = setTimeout(() => setIsVisible(true), delay);
		return () => clearTimeout(timer);
	}, [delay]);
	
	const getProgressColor = () => {
		if (!progress) return 'var(--accent-primary)';
		if (className?.includes('high')) return 'var(--accent-success)';
		if (className?.includes('medium')) return 'var(--accent-warning)';
		if (className?.includes('low')) return 'var(--accent-error)';
		return 'var(--accent-primary)';
	};
	
	return (
		<div 
			className={`stat-card ${isVisible ? 'fade-in' : ''}`}
			style={{
				opacity: isVisible ? 1 : 0,
				transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
				transition: 'all 0.5s ease-out'
			}}
		>
			<div className="stat-label">{label}</div>
			<div className={`stat-value ${className || ''}`}>
				{value}
			</div>
			{progress !== undefined && (
				<div style={{ marginTop: '0.75rem' }}>
					<ProgressBar 
						value={progress} 
						max={100} 
						color={getProgressColor()}
						height="8px"
					/>
				</div>
			)}
		</div>
	);
}

function StatsGrid({ result }: { result: RunResult }) {
	const { summary, metadata } = result;
	
	const accuracyPercent = useAnimatedCounter(summary.overallAccuracy * 100, 1000, 1);
	const testCasesCount = useAnimatedCounter(summary.totalTestCases, 800, 0);
	const benchmarksCount = useAnimatedCounter(summary.totalBenchmarks, 600, 0);
	const providersCount = useAnimatedCounter(summary.totalProviders, 600, 0);

	return (
		<div className="stats-grid" role="region" aria-label="Benchmark statistics">
			<StatCard 
				label="Overall Accuracy" 
				value={`${accuracyPercent}%`}
				className={getAccuracyClass(summary.overallAccuracy)}
				delay={0}
				progress={summary.overallAccuracy * 100}
			/>
			<StatCard 
				label="Test Cases" 
				value={testCasesCount}
				delay={100}
			/>
			<StatCard 
				label="Benchmarks" 
				value={benchmarksCount}
				delay={200}
			/>
			<StatCard 
				label="Providers" 
				value={providersCount}
				delay={300}
			/>
			<StatCard 
				label="Duration" 
				value={formatDuration(metadata.durationMs)}
				delay={400}
			/>
		</div>
	);
}

function ResultsMatrix({ 
	result, 
	onSelectResult,
	filters,
}: { 
	result: RunResult; 
	onSelectResult: (r: BenchmarkProviderResult) => void;
	filters?: {
		taskType?: string;
		accuracyRange?: [number, number];
		showFailuresOnly?: boolean;
		showRegressionsOnly?: boolean;
		provider?: string;
		benchmark?: string;
	};
}) {
	// Apply filters
	let filteredResults = result.results;
	if (filters) {
		if (filters.taskType && filters.taskType !== "all") {
			filteredResults = filteredResults.filter(r => 
				r.breakdownByTaskType?.some(b => b.taskType === filters.taskType)
			);
		}
		if (filters.accuracyRange) {
			filteredResults = filteredResults.filter(r => {
				const acc = r.metrics.accuracy * 100;
				return acc >= filters.accuracyRange![0] && acc <= filters.accuracyRange![1];
			});
		}
		if (filters.showFailuresOnly) {
			filteredResults = filteredResults.filter(r => r.metrics.failed > 0);
		}
		if (filters.provider && filters.provider !== "all") {
			filteredResults = filteredResults.filter(r => r.provider === filters.provider);
		}
		if (filters.benchmark && filters.benchmark !== "all") {
			filteredResults = filteredResults.filter(r => r.benchmark === filters.benchmark);
		}
	}

	// Group results by benchmark
	const benchmarks = useMemo(() => {
		const map = new Map<string, BenchmarkProviderResult[]>();
		for (const r of filteredResults) {
			const list = map.get(r.benchmark) ?? [];
			list.push(r);
			map.set(r.benchmark, list);
		}
		return map;
	}, [filteredResults]);

	return (
		<div className="matrix-section">
			<div className="section-header">
				<h2 className="section-title">Benchmark × Provider Matrix</h2>
			</div>
			<div style={{ padding: "1rem" }}>
				{Array.from(benchmarks.entries()).map(([benchmark, providers], benchmarkIndex) => (
					<div key={benchmark} style={{ marginBottom: "1.5rem" }}>
						<h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
							{benchmark}
						</h3>
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.75rem" }}>
							{providers.map((p, providerIndex) => {
								const delay = (benchmarkIndex * providers.length + providerIndex) * 50;
								return (
									<div
										key={`${p.benchmark}-${p.provider}`}
										className="matrix-cell slide-up"
										onClick={() => onSelectResult(p)}
										style={{ 
											borderRadius: "var(--radius-lg)", 
											border: "1px solid var(--glass-border)",
											animationDelay: `${delay}ms`,
											cursor: 'pointer'
										}}
										title={
											p.metrics.accuracyCI 
												? `${p.provider} - ${formatConfidenceInterval(p.metrics.accuracy, p.metrics.accuracyCI, true)}\nSample: ${p.metrics.sampleQuality?.qualityScore || 'N/A'}`
												: `View ${p.provider} results for ${p.benchmark}`
										}
									>
										<div className="cell-provider" style={{ position: 'relative', zIndex: 1 }}>{p.provider}</div>
										<div className="cell-accuracy" style={{ color: getAccuracyColor(p.metrics.accuracy), position: 'relative', zIndex: 1 }}>
											{(p.metrics.accuracy * 100).toFixed(1)}%
											{p.metrics.accuracyCI && (
												<span style={{ fontSize: "0.6rem", opacity: 0.7, marginLeft: "0.25rem" }}>
													±{(p.metrics.accuracyCI.margin * 100).toFixed(1)}%
												</span>
											)}
										</div>
										<div className="cell-stats" style={{ position: 'relative', zIndex: 1 }}>
											<span>{p.metrics.passed}/{p.metrics.total} passed</span>
											<span>P50: {p.metrics.p50LatencyMs.toFixed(0)}ms</span>
										</div>
										{p.metrics.sampleQuality && (() => {
											const badge = getSampleQualityBadge(p.metrics.sampleQuality);
											return badge && badge.text !== "Good" && badge.text !== "Excellent" ? (
												<div style={{ 
													position: 'absolute', 
													top: '0.25rem', 
													right: '0.25rem',
													fontSize: '0.75rem',
													opacity: 0.8
												}}>
													{badge.emoji}
												</div>
											) : null;
										})()}
									</div>
								);
							})}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function TestCasesList({ result }: { result: BenchmarkProviderResult }) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [filter, setFilter] = useState("");
	const [showPassed, setShowPassed] = useState<boolean | null>(null);

	const toggleExpand = (id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const filteredTestCases = useMemo(() => {
		return result.testCases.filter((tc) => {
			if (filter && !tc.query.toLowerCase().includes(filter.toLowerCase()) && !tc.testCaseId.toLowerCase().includes(filter.toLowerCase())) {
				return false;
			}
			if (showPassed !== null) {
				if (showPassed && !tc.evaluation.passed) return false;
				if (!showPassed && tc.evaluation.passed) return false;
			}
			return true;
		});
	}, [result.testCases, filter, showPassed]);

	return (
		<div className="test-cases-section">
			<div className="section-header">
				<h2 className="section-title">
					Test Cases ({result.metrics.passed}/{result.metrics.total} passed)
				</h2>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
									<input
										type="text"
										placeholder="Filter test cases..."
										value={filter}
										onChange={(e) => setFilter(e.target.value)}
										aria-label="Filter test cases by query or ID"
										style={{
											padding: "0.5rem 0.75rem",
											background: "var(--bg-tertiary)",
											border: "1px solid var(--border-primary)",
											borderRadius: "var(--radius-md)",
											color: "var(--text-primary)",
											fontSize: "0.875rem",
											minWidth: "200px",
										}}
									/>
					<button
						className={`btn ${showPassed === true ? "btn-primary" : "btn-secondary"}`}
						onClick={() => setShowPassed(showPassed === true ? null : true)}
						aria-label="Show only passed test cases"
						aria-pressed={showPassed === true}
					>
						<span aria-hidden="true">✓</span> Passed
					</button>
					<button
						className={`btn ${showPassed === false ? "btn-primary" : "btn-secondary"}`}
						onClick={() => setShowPassed(showPassed === false ? null : false)}
						aria-label="Show only failed test cases"
						aria-pressed={showPassed === false}
					>
						<span aria-hidden="true">✗</span> Failed
					</button>
					{filter || showPassed !== null ? (
						<button className="btn btn-ghost" onClick={() => { setFilter(""); setShowPassed(null); }}>
							Clear
						</button>
					) : null}
				</div>
			</div>
			<div>
				{filteredTestCases.length === 0 ? (
					<div style={{ padding: "2rem", textAlign: "center", color: "var(--text-tertiary)" }} className="fade-in">
						No test cases match your filter
					</div>
				) : (
					filteredTestCases.map((tc, index) => {
						const isExpanded = expanded.has(tc.testCaseId);
						return (
							<div 
								key={tc.testCaseId} 
								className="test-case-item fade-in"
								onClick={() => toggleExpand(tc.testCaseId)}
								style={{ 
									cursor: "pointer",
									animationDelay: `${index * 30}ms`
								}}
							>
								<div className={`test-case-status ${tc.evaluation.passed ? "passed" : "failed"}`}>
									{tc.evaluation.passed ? "✓" : "✗"}
								</div>
								<div className="test-case-content">
									<div className="test-case-id">{tc.testCaseId}</div>
									<div className="test-case-query">{tc.query}</div>
									{tc.evaluation.details?.reason && (
										<div className="test-case-details">{tc.evaluation.details.reason}</div>
									)}
									{isExpanded && tc.searchResults.length > 0 && (
										<div 
											className="fade-in"
											style={{ 
												marginTop: "0.75rem", 
												padding: "0.75rem", 
												background: "var(--bg-tertiary)", 
												borderRadius: "var(--radius-md)", 
												fontSize: "0.8125rem",
												border: "1px solid var(--glass-border)"
											}}
										>
											<div style={{ color: "var(--text-tertiary)", marginBottom: "0.5rem", fontWeight: 600 }}>
												Retrieved Results ({tc.searchResults.length}):
											</div>
											{tc.searchResults.slice(0, 3).map((sr, i) => (
												<div 
													key={i} 
													style={{ 
														color: "var(--text-secondary)", 
														marginBottom: "0.5rem",
														padding: "0.5rem",
														background: "var(--bg-primary)",
														borderRadius: "var(--radius-sm)",
														borderLeft: "3px solid var(--accent-primary)"
													}}
												>
													<span style={{ 
														color: "var(--accent-primary)", 
														fontFamily: "var(--font-mono)",
														fontWeight: 600,
														marginRight: "0.5rem"
													}}>
														[{sr.score.toFixed(2)}]
													</span> 
													{sr.content.substring(0, 150)}...
												</div>
											))}
										</div>
									)}
								</div>
								<div className="test-case-score" style={{ 
									color: getAccuracyColor(tc.evaluation.score),
									fontWeight: 700
								}}>
									{tc.evaluation.score.toFixed(2)}
								</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}

function ResultDetail({ result, onBack }: { result: BenchmarkProviderResult; onBack: () => void }) {
	const exportToCSV = () => {
		const headers = ["Test Case ID", "Query", "Passed", "Score", "Latency (ms)", "Error"];
		const rows = result.testCases.map((tc) => [
			tc.testCaseId,
			tc.query,
			tc.evaluation.passed ? "Yes" : "No",
			tc.evaluation.score.toFixed(3),
			tc.latencyMs.toFixed(0),
			tc.error || "",
		]);

		const csv = [
			headers.join(","),
			...rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")),
		].join("\n");

		const blob = new Blob([csv], { type: "text/csv" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `memorybench-${result.benchmark}-${result.provider}-${new Date().toISOString().split("T")[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const exportToJSON = () => {
		const json = JSON.stringify(result, null, 2);
		const blob = new Blob([json], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `memorybench-${result.benchmark}-${result.provider}-${new Date().toISOString().split("T")[0]}.json`;
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="result-detail">
			<button className="back-link" onClick={onBack}>
				← Back to overview
			</button>
			
			<div className="result-header">
				<h1 className="page-title">{result.benchmark} × {result.provider}</h1>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<div className="result-meta">
						<span className={`accuracy-badge ${getAccuracyClass(result.metrics.accuracy)}`}>
							{result.metrics.accuracyCI 
								? formatConfidenceInterval(result.metrics.accuracy, result.metrics.accuracyCI, true)
								: `${(result.metrics.accuracy * 100).toFixed(1)}% accuracy`
							}
						</span>
						{result.metrics.sampleQuality && (() => {
							const badge = getSampleQualityBadge(result.metrics.sampleQuality);
							return badge ? (
								<span style={{ 
									padding: "0.25rem 0.5rem", 
									borderRadius: "var(--radius-sm)", 
									fontSize: "0.75rem",
									background: `${badge.color}20`,
									color: badge.color,
									border: `1px solid ${badge.color}40`
								}}>
									{badge.emoji} {badge.text} Sample
								</span>
							) : null;
						})()}
						<span className="meta-item">
							<span className="meta-label">Tests:</span> {result.metrics.total}
						</span>
						<span className="meta-item">
							<span className="meta-label">Avg Score:</span> {
								result.metrics.avgScoreCI 
									? formatConfidenceInterval(result.metrics.avgScore, result.metrics.avgScoreCI, false)
									: result.metrics.avgScore.toFixed(3)
							}
						</span>
						<span className="meta-item">
							<span className="meta-label">P50:</span> {result.metrics.p50LatencyMs.toFixed(0)}ms
						</span>
						<span className="meta-item">
							<span className="meta-label">P95:</span> {result.metrics.p95LatencyMs.toFixed(0)}ms
						</span>
					</div>
					<div style={{ display: "flex", gap: "0.5rem" }}>
						<button className="btn btn-secondary" onClick={exportToCSV} title="Export to CSV">
							📥 CSV
						</button>
						<button className="btn btn-secondary" onClick={exportToJSON} title="Export to JSON">
							📥 JSON
						</button>
					</div>
				</div>
			</div>

			<TestCasesList result={result} />
		</div>
	);
}

type SortField = "runId" | "accuracy" | "testCases" | "completedAt";
type SortDirection = "asc" | "desc";

function ResultsTable({ results, onSelect }: { results: ResultFile[]; onSelect: (runId: string) => void }) {
	const [sortField, setSortField] = useState<SortField>("completedAt");
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
	const [filterText, setFilterText] = useState("");
	const copyToClipboard = useCopyToClipboard();

	const handleSort = (field: SortField) => {
		if (sortField === field) {
			setSortDirection(sortDirection === "asc" ? "desc" : "asc");
		} else {
			setSortField(field);
			setSortDirection("asc");
		}
	};

	const sortedAndFiltered = useMemo(() => {
		let filtered = results;
		
		if (filterText) {
			const lowerFilter = filterText.toLowerCase();
			filtered = results.filter(
				(r) =>
					r.runId.toLowerCase().includes(lowerFilter) ||
					r.name.toLowerCase().includes(lowerFilter)
			);
		}

		return [...filtered].sort((a, b) => {
			let aVal: string | number;
			let bVal: string | number;

			switch (sortField) {
				case "runId":
					aVal = a.runId;
					bVal = b.runId;
					break;
				case "accuracy":
					aVal = a.accuracy;
					bVal = b.accuracy;
					break;
				case "testCases":
					aVal = a.testCases;
					bVal = b.testCases;
					break;
				case "completedAt":
					aVal = new Date(a.completedAt).getTime();
					bVal = new Date(b.completedAt).getTime();
					break;
				default:
					return 0;
			}

			if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
			if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
			return 0;
		});
	}, [results, sortField, sortDirection, filterText]);

	const SortIcon = ({ field }: { field: SortField }) => {
		if (sortField !== field) {
			return <span style={{ opacity: 0.3 }}>↕</span>;
		}
		return sortDirection === "asc" ? "↑" : "↓";
	};

	const exportToCSV = () => {
		const headers = ["Run ID", "Accuracy", "Test Cases", "Date"];
		const rows = sortedAndFiltered.map((r) => [
			r.runId,
			(r.accuracy * 100).toFixed(1) + "%",
			r.testCases.toString(),
			formatDate(r.completedAt),
		]);

		const csv = [
			headers.join(","),
			...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
		].join("\n");

		const blob = new Blob([csv], { type: "text/csv" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `memorybench-results-${new Date().toISOString().split("T")[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const exportToJSON = () => {
		const json = JSON.stringify(sortedAndFiltered, null, 2);
		const blob = new Blob([json], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `memorybench-results-${new Date().toISOString().split("T")[0]}.json`;
		a.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="results-section">
			<div className="section-header">
				<h2 className="section-title">Recent Runs</h2>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					<input
						type="text"
						placeholder="Filter by run ID or name..."
						value={filterText}
						onChange={(e) => setFilterText(e.target.value)}
						style={{
							padding: "0.5rem 0.75rem",
							background: "var(--bg-tertiary)",
							border: "1px solid var(--border-primary)",
							borderRadius: "var(--radius-md)",
							color: "var(--text-primary)",
							fontSize: "0.875rem",
							minWidth: "200px",
						}}
					/>
					<button className="btn btn-secondary" onClick={exportToCSV} title="Export to CSV">
						📥 CSV
					</button>
					<button className="btn btn-secondary" onClick={exportToJSON} title="Export to JSON">
						📥 JSON
					</button>
				</div>
			</div>
			<table className="results-table">
				<thead>
					<tr>
						<th
							style={{ cursor: "pointer", userSelect: "none" }}
							onClick={() => handleSort("runId")}
						>
							Run ID <SortIcon field="runId" />
						</th>
						<th
							style={{ cursor: "pointer", userSelect: "none" }}
							onClick={() => handleSort("accuracy")}
						>
							Accuracy <SortIcon field="accuracy" />
						</th>
						<th
							style={{ cursor: "pointer", userSelect: "none" }}
							onClick={() => handleSort("testCases")}
						>
							Test Cases <SortIcon field="testCases" />
						</th>
						<th
							style={{ cursor: "pointer", userSelect: "none" }}
							onClick={() => handleSort("completedAt")}
						>
							Date <SortIcon field="completedAt" />
						</th>
					</tr>
				</thead>
				<tbody>
					{sortedAndFiltered.length === 0 ? (
						<tr>
							<td colSpan={4} style={{ textAlign: "center", padding: "2rem", color: "var(--text-tertiary)" }}>
								No results match your filter
							</td>
						</tr>
					) : (
						sortedAndFiltered.map((r, index) => (
							<tr key={r.runId} className="fade-in" style={{ animationDelay: `${index * 30}ms` }}>
								<td>
									<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
										<button
											className="run-id"
											onClick={() => onSelect(r.runId)}
											style={{ 
												background: 'none', 
												border: 'none', 
												padding: 0,
												cursor: 'pointer'
											}}
											aria-label={`View details for run ${r.runId}`}
										>
											{r.runId}
										</button>
										<button
											className="btn-ghost"
											onClick={(e) => {
												e.stopPropagation();
												copyToClipboard(r.runId);
											}}
											aria-label={`Copy run ID ${r.runId} to clipboard`}
											style={{
												padding: '0.25rem',
												fontSize: '0.75rem',
												opacity: 0.5,
												transition: 'opacity var(--transition-fast)'
											}}
											onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
											onMouseLeave={(e) => e.currentTarget.style.opacity = '0.5'}
										>
											<span aria-hidden="true">📋</span>
										</button>
									</div>
								</td>
								<td>
									<span className={`accuracy-badge ${getAccuracyClass(r.accuracy)}`}>
										{(r.accuracy * 100).toFixed(1)}%
									</span>
								</td>
								<td>{r.testCases}</td>
								<td className="timestamp">{formatDate(r.completedAt)}</td>
							</tr>
						))
					)}
				</tbody>
			</table>
		</div>
	);
}

interface StatisticalTest {
	pValue: number;
	significant: boolean;
	effectSize: number;
	testStatistic?: number;
}

interface ComparisonData {
	key: string;
	result1?: BenchmarkProviderResult;
	result2?: BenchmarkProviderResult;
	accuracyTest?: StatisticalTest;
	scoreTest?: StatisticalTest;
	latencyTest?: StatisticalTest;
}

function ComparisonView({ run1, run2 }: { run1: RunResult; run2: RunResult }) {
	// Create a map of benchmark×provider combinations and calculate statistical tests
	const comparisonMap = new Map<string, ComparisonData>();

	for (const r of run1.results) {
		const key = `${r.benchmark}×${r.provider}`;
		comparisonMap.set(key, { key, result1: r });
	}

	for (const r of run2.results) {
		const key = `${r.benchmark}×${r.provider}`;
		const existing = comparisonMap.get(key) || { key };
		comparisonMap.set(key, { ...existing, result2: r });
	}

	// Calculate statistical tests for each comparison
	const comparisons: ComparisonData[] = Array.from(comparisonMap.values()).map((comp) => {
		if (!comp.result1 || !comp.result2) return comp;
		
		// Extract test case data for statistical tests
		const testCases1 = comp.result1.testCases;
		const testCases2 = comp.result2.testCases;
		
		if (testCases1.length > 0 && testCases2.length > 0) {
			// Calculate accuracy test (proportion z-test)
			const passed1 = testCases1.filter(tc => tc.evaluation.passed).length;
			const passed2 = testCases2.filter(tc => tc.evaluation.passed).length;
			
			// Simple p-value approximation (you could import the actual test from statistics.ts)
			const p1 = passed1 / testCases1.length;
			const p2 = passed2 / testCases2.length;
			const pooledP = (passed1 + passed2) / (testCases1.length + testCases2.length);
			const stdError = Math.sqrt(pooledP * (1 - pooledP) * (1/testCases1.length + 1/testCases2.length));
			const zStat = stdError === 0 ? 0 : (p2 - p1) / stdError;
			const pValue = 2 * (1 - standardNormalCDF(Math.abs(zStat)));
			
			comp.accuracyTest = {
				pValue,
				significant: pValue < 0.05,
				effectSize: p2 - p1,
				testStatistic: zStat,
			};
		}
		
		return comp;
	});

	const calculateDelta = (val1: number, val2: number): { value: number; percent: number } => {
		if (val1 === 0) return { value: val2, percent: val2 > 0 ? 100 : -100 };
		const delta = val2 - val1;
		const percent = (delta / val1) * 100;
		return { value: delta, percent };
	};
	
	// Standard normal CDF approximation
	const standardNormalCDF = (z: number): number => {
		const t = 1 / (1 + 0.2316419 * Math.abs(z));
		const d = 0.3989423 * Math.exp(-z * z / 2);
		const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
		return z > 0 ? 1 - prob : prob;
	};

	return (
		<div className="comparison-section fade-in">
			<div className="section-header">
				<h2 className="section-title">Comparison</h2>
				<div style={{ display: "flex", gap: "0.5rem", fontSize: "0.875rem", color: "var(--text-secondary)", flexWrap: "wrap" }}>
					<span className="comparison-badge baseline">Baseline: {run1.metadata.runId}</span>
					<span className="comparison-badge current">Current: {run2.metadata.runId}</span>
				</div>
			</div>
			<div className="comparison-grid">
				{comparisons.map((comp, index) => {
					const { key, result1, result2, accuracyTest } = comp;
					
					if (!result1 || !result2) {
						return (
							<div 
								key={key} 
								className="comparison-card slide-up"
								style={{ animationDelay: `${index * 50}ms` }}
							>
								<div className="comparison-header">
									<span className="comparison-title">{key}</span>
									<span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
										{result1 ? "Baseline only" : "Current only"}
									</span>
								</div>
							</div>
						);
					}

					const accuracyDelta = calculateDelta(result1.metrics.accuracy, result2.metrics.accuracy);
					const latencyDelta = calculateDelta(result1.metrics.avgLatencyMs, result2.metrics.avgLatencyMs);
					const hasRegression = accuracyTest?.significant && accuracyDelta.value < -0.05;

					return (
						<div 
							key={key} 
							className="comparison-card slide-up"
							style={{ 
								animationDelay: `${index * 50}ms`,
								borderColor: hasRegression ? 'var(--accent-error)' : undefined,
								boxShadow: hasRegression ? 'var(--shadow-glow-error)' : undefined
							}}
						>
							<div className="comparison-header">
								<span className="comparison-title">{key}</span>
								{hasRegression && (
									<span style={{ 
										fontSize: "0.75rem", 
										color: "var(--accent-error)",
										fontWeight: 600,
										animation: 'pulse 2s ease-in-out infinite'
									}}>
										⚠ Regression
									</span>
								)}
								{accuracyTest && !hasRegression && Math.abs(accuracyDelta.value) > 0.01 && (
									<span style={{ 
										fontSize: "0.75rem", 
										color: "var(--text-tertiary)",
										fontWeight: 500
									}}>
										{accuracyTest.significant ? "Significant" : "Not significant"}
									</span>
								)}
							</div>
							<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
								<div>
									<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", alignItems: "center" }}>
										<span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Accuracy</span>
										<span className={`delta-indicator ${accuracyDelta.value >= 0 ? "positive" : "negative"}`}>
											{accuracyDelta.value >= 0 ? "↑" : "↓"} {Math.abs(accuracyDelta.percent).toFixed(1)}%
										</span>
									</div>
									<div style={{ 
										display: "flex", 
										justifyContent: "space-between", 
										fontSize: "0.875rem",
										padding: "0.5rem",
										background: "var(--bg-primary)",
										borderRadius: "var(--radius-sm)",
										fontFamily: "var(--font-mono)"
									}}>
										<span style={{ color: "var(--text-secondary)" }}>
											{(result1.metrics.accuracy * 100).toFixed(1)}%
										</span>
										<span style={{ color: "var(--text-tertiary)" }}>→</span>
										<span style={{ 
											color: accuracyDelta.value >= 0 ? "var(--accent-success)" : "var(--accent-error)",
											fontWeight: 700
										}}>
											{(result2.metrics.accuracy * 100).toFixed(1)}%
										</span>
									</div>
									{accuracyTest && (
										<div style={{ 
											marginTop: "0.5rem", 
											fontSize: "0.75rem", 
											color: "var(--text-tertiary)",
											fontFamily: "var(--font-mono)"
										}}>
											p-value: {accuracyTest.pValue < 0.001 ? "< 0.001" : accuracyTest.pValue.toFixed(3)}
											{accuracyTest.significant && (
												<span style={{ color: "var(--accent-warning)", marginLeft: "0.5rem" }}>*</span>
											)}
										</div>
									)}
								</div>
								<div>
									<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", alignItems: "center" }}>
										<span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Avg Latency</span>
										<span className={`delta-indicator ${latencyDelta.value <= 0 ? "positive" : "negative"}`}>
											{latencyDelta.value <= 0 ? "↓" : "↑"} {Math.abs(latencyDelta.percent).toFixed(1)}%
										</span>
									</div>
									<div style={{ 
										display: "flex", 
										justifyContent: "space-between", 
										fontSize: "0.875rem",
										padding: "0.5rem",
										background: "var(--bg-primary)",
										borderRadius: "var(--radius-sm)",
										fontFamily: "var(--font-mono)"
									}}>
										<span style={{ color: "var(--text-secondary)" }}>
											{result1.metrics.avgLatencyMs.toFixed(0)}ms
										</span>
										<span style={{ color: "var(--text-tertiary)" }}>→</span>
										<span style={{ 
											color: latencyDelta.value <= 0 ? "var(--accent-success)" : "var(--accent-warning)",
											fontWeight: 700
										}}>
											{result2.metrics.avgLatencyMs.toFixed(0)}ms
										</span>
									</div>
								</div>
								<div style={{ 
									display: "flex", 
									justifyContent: "space-between", 
									fontSize: "0.75rem", 
									color: "var(--text-tertiary)", 
									paddingTop: "0.75rem", 
									borderTop: "1px solid var(--border-primary)" 
								}}>
									<span>Passed: {result1.metrics.passed}/{result1.metrics.total} → {result2.metrics.passed}/{result2.metrics.total}</span>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function Dashboard() {
	const [loading, setLoading] = useState(true);
	const [results, setResults] = useState<ResultFile[]>([]);
	const [selectedRun, setSelectedRun] = useState<RunResult | null>(null);
	const [selectedResult, setSelectedResult] = useState<BenchmarkProviderResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [comparisonMode, setComparisonMode] = useState(false);
	const [baselineRunId, setBaselineRunId] = useState<string | null>(null);
	const [baselineRun, setBaselineRun] = useState<RunResult | null>(null);
	
	// Filter state
	const [taskTypeFilter, setTaskTypeFilter] = useState<string>("all");
	const [accuracyRange, setAccuracyRange] = useState<[number, number]>([0, 100]);
	const [showFailuresOnly, setShowFailuresOnly] = useState(false);
	const [showRegressionsOnly, setShowRegressionsOnly] = useState(false);
	const [providerFilter, setProviderFilter] = useState<string>("all");
	const [benchmarkFilter, setBenchmarkFilter] = useState<string>("all");

	// Load results list
	useEffect(() => {
		async function loadResults() {
			try {
				const response = await fetch("/api/results");
				if (!response.ok) {
					const text = await response.text();
					throw new Error(`HTTP ${response.status}: ${text}`);
				}
				const data = await response.json() as ResultFile[];
				setResults(data);
				
				// Auto-load latest if available
				if (data.length > 0) {
					loadRun(data[0]!.runId);
				} else {
					setLoading(false);
				}
			} catch (err) {
				console.error("Error loading results:", err);
				setError(err instanceof Error ? err.message : String(err));
				setLoading(false);
			}
		}
		loadResults();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const loadRun = async (runId: string) => {
		setLoading(true);
		setSelectedResult(null);
		setError(null);
		try {
			const response = await fetch(`/api/results/${runId}`);
			if (!response.ok) {
				const text = await response.text();
				throw new Error(`HTTP ${response.status}: ${text}`);
			}
			const data = await response.json() as RunResult;
			setSelectedRun(data);
		} catch (err) {
			console.error("Error loading run:", err);
			const errorMessage = err instanceof Error ? err.message : String(err);
			setError(`Failed to load run: ${errorMessage}`);
		} finally {
			setLoading(false);
		}
	};

	const loadBaselineRun = async (runId: string) => {
		try {
			const response = await fetch(`/api/results/${runId}`);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const data = await response.json() as RunResult;
			setBaselineRun(data);
		} catch (err) {
			console.error("Error loading baseline run:", err);
			setError(`Failed to load baseline run: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const exportRunToJSON = () => {
		if (!selectedRun) return;
		const json = JSON.stringify(selectedRun, null, 2);
		const blob = new Blob([json], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `memorybench-run-${selectedRun.metadata.runId}-${new Date().toISOString().split("T")[0]}.json`;
		a.click();
		URL.revokeObjectURL(url);
	};

	if (loading && !selectedRun) {
		return <LoadingSpinner />;
	}

	if (error && !selectedRun) {
		return (
			<div style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
				<div style={{ 
					background: "var(--bg-secondary)", 
					border: "1px solid var(--accent-error)", 
					borderRadius: "var(--radius-lg)", 
					padding: "1.5rem",
					marginBottom: "1rem"
				}}>
					<h2 style={{ color: "var(--accent-error)", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
						<span>⚠️</span> Error Loading Results
					</h2>
					<p style={{ color: "var(--text-secondary)", marginBottom: "1rem", fontFamily: "var(--font-mono)", fontSize: "0.875rem" }}>
						{error}
					</p>
					<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
						<button className="btn btn-primary" onClick={() => window.location.reload()}>
							Reload Page
						</button>
						<button className="btn btn-secondary" onClick={() => { setError(null); setLoading(true); window.location.reload(); }}>
							Retry
						</button>
					</div>
				</div>
				<div style={{ fontSize: "0.875rem", color: "var(--text-tertiary)" }}>
					<p>If this error persists, check:</p>
					<ul style={{ marginLeft: "1.5rem", marginTop: "0.5rem" }}>
						<li>That the viewer server is running</li>
						<li>That results files exist in the results directory</li>
						<li>The browser console (F12) for more details</li>
					</ul>
				</div>
			</div>
		);
	}

	if (results.length === 0) {
		return (
			<EmptyState
				title="No results found"
				description="Run a benchmark to see results here. Try: memorybench run -b quicktest -p mock"
			/>
		);
	}

	// Show detail view if a specific benchmark×provider is selected
	if (selectedResult) {
		return (
			<ResultDetail
				result={selectedResult}
				onBack={() => setSelectedResult(null)}
			/>
		);
	}

	return (
		<div className="dashboard">
			<div className="page-header">
				<div>
					<h1 className="page-title">Benchmark Results</h1>
					{selectedRun && (
						<p className="page-subtitle">
							Run: {selectedRun.metadata.runId} • {formatDate(selectedRun.metadata.completedAt)}
						</p>
					)}
				</div>
				<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
					{selectedRun && (
						<>
							<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
								<input
									type="checkbox"
									checked={comparisonMode}
									onChange={(e) => {
										setComparisonMode(e.target.checked);
										if (e.target.checked && baselineRunId && !baselineRun) {
											loadBaselineRun(baselineRunId);
										}
									}}
									style={{ cursor: "pointer" }}
								/>
								Compare with baseline
							</label>
							{comparisonMode && (
								<select
									value={baselineRunId || ""}
									onChange={(e) => {
										const runId = e.target.value;
										setBaselineRunId(runId);
										if (runId) {
											loadBaselineRun(runId);
										} else {
											setBaselineRun(null);
										}
									}}
									style={{
										padding: "0.5rem 0.75rem",
										background: "var(--bg-tertiary)",
										border: "1px solid var(--border-primary)",
										borderRadius: "var(--radius-md)",
										color: "var(--text-primary)",
										fontSize: "0.875rem",
										cursor: "pointer",
									}}
								>
									<option value="">Select baseline...</option>
									{results.filter((r) => r.runId !== selectedRun.metadata.runId).map((r) => (
										<option key={r.runId} value={r.runId}>
											{r.runId} ({formatDate(r.completedAt)})
										</option>
									))}
								</select>
							)}
							<button className="btn btn-secondary" onClick={exportRunToJSON} title="Export run to JSON">
								📥 Export JSON
							</button>
						</>
					)}
				</div>
			</div>

			{error && selectedRun && (
				<div style={{ 
					background: "rgba(239, 68, 68, 0.1)", 
					border: "1px solid var(--accent-error)", 
					borderRadius: "var(--radius-md)", 
					padding: "1rem",
					marginBottom: "1rem",
					color: "var(--accent-error)",
					fontSize: "0.875rem"
				}}>
					⚠️ {error}
				</div>
			)}

			{selectedRun && (
				<>
					<StatsGrid result={selectedRun} />
					
					{/* Filters */}
					<div style={{ marginBottom: "1.5rem", padding: "1rem", background: "var(--bg-secondary)", borderRadius: "var(--radius-md)" }}>
						<div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
							<label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
								Task Type:
								<select
									value={taskTypeFilter}
									onChange={(e) => setTaskTypeFilter(e.target.value)}
									style={{ padding: "0.5rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-primary)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
								>
									<option value="all">All Types</option>
									{Array.from(new Set(selectedRun.results.flatMap(r => 
										r.breakdownByTaskType?.map(b => b.taskType) || []
									))).map(tt => (
										<option key={tt} value={tt}>{tt}</option>
									))}
								</select>
							</label>

							<label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
								Accuracy Range:
								<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
									<input
										type="number"
										min="0"
										max="100"
										value={accuracyRange[0]}
										onChange={(e) => setAccuracyRange([Number(e.target.value), accuracyRange[1]])}
										style={{ width: "60px", padding: "0.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-primary)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
									/>
									<span>-</span>
									<input
										type="number"
										min="0"
										max="100"
										value={accuracyRange[1]}
										onChange={(e) => setAccuracyRange([accuracyRange[0], Number(e.target.value)])}
										style={{ width: "60px", padding: "0.25rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-primary)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
									/>
									<span>%</span>
								</div>
							</label>

							<label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
								<input
									type="checkbox"
									checked={showFailuresOnly}
									onChange={(e) => setShowFailuresOnly(e.target.checked)}
									style={{ cursor: "pointer" }}
								/>
								Show Failures Only
							</label>

							{(taskTypeFilter !== "all" || accuracyRange[0] !== 0 || accuracyRange[1] !== 100 || showFailuresOnly) && (
								<button 
									onClick={() => {
										setTaskTypeFilter("all");
										setAccuracyRange([0, 100]);
										setShowFailuresOnly(false);
									}}
									style={{ padding: "0.5rem 1rem", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-primary)", background: "var(--bg-primary)", color: "var(--text-primary)", cursor: "pointer" }}
								>
									Clear Filters
								</button>
							)}
						</div>
					</div>

					{comparisonMode && baselineRun && (
						<ComparisonView run1={baselineRun} run2={selectedRun} />
					)}
					<ResultsMatrix 
						result={selectedRun} 
						onSelectResult={setSelectedResult}
						filters={{
							taskType: taskTypeFilter,
							accuracyRange,
							showFailuresOnly,
							provider: providerFilter,
							benchmark: benchmarkFilter,
						}}
					/>
				</>
			)}

			<ResultsTable results={results} onSelect={loadRun} />
		</div>
	);
}

function App() {
	// Add error boundary
	const [hasError, setHasError] = useState(false);
	const [errorInfo, setErrorInfo] = useState<string | null>(null);

	useEffect(() => {
		// Catch unhandled errors
		const handleError = (event: ErrorEvent) => {
			console.error("Unhandled error:", event.error);
			setHasError(true);
			setErrorInfo(event.error?.message || String(event.error));
		};

		window.addEventListener("error", handleError);
		return () => window.removeEventListener("error", handleError);
	}, []);

	if (hasError) {
		return (
			<div style={{ padding: "2rem", color: "var(--text-error)", background: "var(--bg-primary)", minHeight: "100vh" }}>
				<h1>Error Loading Viewer</h1>
				<p>{errorInfo || "Unknown error"}</p>
				<button className="btn btn-primary" onClick={() => window.location.reload()}>
					Reload Page
				</button>
			</div>
		);
	}

	return (
		<ToastProvider>
			<div className="app">
				<Header />
				<main className="main">
					<Dashboard />
				</main>
			</div>
		</ToastProvider>
	);
}

// Mount React app
console.log("MemoryBench Viewer: Starting...");
console.log("React version:", React.version);
console.log("Root element:", document.getElementById("root"));

const rootElement = document.getElementById("root");
if (!rootElement) {
	console.error("❌ Root element '#root' not found!");
	document.body.innerHTML = `
		<div style="padding: 2rem; color: #ef4444; font-family: monospace;">
			<h1>❌ Error</h1>
			<p>Root element '#root' not found in HTML.</p>
			<p>Check that index.html has: &lt;div id="root"&gt;&lt;/div&gt;</p>
		</div>
	`;
} else {
	try {
		console.log("✅ Root element found, creating React root...");
		const root = createRoot(rootElement);
		console.log("✅ Rendering App component...");
		root.render(<App />);
		console.log("✅ React app mounted successfully!");
	} catch (err) {
		console.error("❌ Failed to mount React app:", err);
		rootElement.innerHTML = `
			<div style="padding: 2rem; color: #ef4444; font-family: monospace; background: #0a0a0b; min-height: 100vh;">
				<h1>❌ Failed to load viewer</h1>
				<p><strong>Error:</strong> ${err instanceof Error ? err.message : String(err)}</p>
				<p><strong>Stack:</strong></p>
				<pre style="background: #111; padding: 1rem; border-radius: 4px; overflow: auto;">${err instanceof Error ? err.stack : String(err)}</pre>
				<p>Check the browser console (F12) for more details.</p>
				<button onclick="window.location.reload()" style="padding: 0.5rem 1rem; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 1rem;">
					Reload Page
				</button>
			</div>
		`;
	}
}

