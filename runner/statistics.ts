import * as ss from "simple-statistics";

/**
 * Statistical analysis utilities for confidence intervals and significance testing
 */

export interface ConfidenceInterval {
  lower: number;
  upper: number;
  margin: number;
  width: number;
  confidenceLevel: number;
}

export interface TTestResult {
  statistic: number;
  pValue: number;
  significant: boolean;
  effectSize: number;
  degreesOfFreedom: number;
}

export interface SampleQuality {
  sufficient: boolean;
  recommendedSampleSize?: number;
  qualityScore: "excellent" | "good" | "fair" | "poor";
}

/**
 * Calculate confidence interval for a sample of continuous values
 * Uses t-distribution for sample sizes < 30, normal distribution otherwise
 */
export function calculateConfidenceInterval(
  values: number[],
  confidenceLevel = 0.95
): ConfidenceInterval {
  if (values.length === 0) {
    return {
      lower: 0,
      upper: 0,
      margin: 0,
      width: 0,
      confidenceLevel,
    };
  }

  if (values.length === 1) {
    return {
      lower: values[0],
      upper: values[0],
      margin: 0,
      width: 0,
      confidenceLevel,
    };
  }

  const mean = ss.mean(values);
  const stdDev = ss.sampleStandardDeviation(values);
  const n = values.length;
  const stdError = stdDev / Math.sqrt(n);

  // Use t-distribution critical value
  const alpha = 1 - confidenceLevel;
  const df = n - 1;
  const tCritical = tDistributionCriticalValue(df, alpha / 2);
  
  const margin = tCritical * stdError;
  const lower = mean - margin;
  const upper = mean + margin;

  return {
    lower,
    upper,
    margin,
    width: upper - lower,
    confidenceLevel,
  };
}

/**
 * Calculate confidence interval for a proportion using Wilson score interval
 * More accurate than normal approximation, especially for small samples or extreme proportions
 */
export function calculateProportionCI(
  successes: number,
  total: number,
  confidenceLevel = 0.95
): ConfidenceInterval {
  if (total === 0) {
    return {
      lower: 0,
      upper: 0,
      margin: 0,
      width: 0,
      confidenceLevel,
    };
  }

  const p = successes / total;
  
  if (total === 1) {
    return {
      lower: p,
      upper: p,
      margin: 0,
      width: 0,
      confidenceLevel,
    };
  }

  // Wilson score interval
  const alpha = 1 - confidenceLevel;
  const z = zScoreCriticalValue(alpha / 2);
  const z2 = z * z;
  
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) / total) + (z2 / (4 * total * total)))) / denominator;
  
  const lower = Math.max(0, center - margin);
  const upper = Math.min(1, center + margin);

  return {
    lower,
    upper,
    margin: upper - lower,
    width: upper - lower,
    confidenceLevel,
  };
}

/**
 * Calculate standard error for a sample
 */
export function calculateSampleStdError(values: number[]): number {
  if (values.length <= 1) return 0;
  const stdDev = ss.sampleStandardDeviation(values);
  return stdDev / Math.sqrt(values.length);
}

/**
 * Recommend sample size needed to achieve target CI width
 */
export function recommendSampleSize(
  currentCI: ConfidenceInterval,
  targetWidth: number
): number {
  if (currentCI.width === 0 || targetWidth >= currentCI.width) {
    return 0; // Already sufficient
  }
  
  // CI width is proportional to 1/sqrt(n)
  // width = 2 * t * s / sqrt(n)
  // To halve width, need 4x samples
  const ratio = currentCI.width / targetWidth;
  return Math.ceil(ratio * ratio);
}

/**
 * Calculate minimum sample size for desired margin of error
 * Based on pilot data or assumed variance
 */
export function calculateMinimumSampleSize(
  estimatedStdDev: number,
  targetMargin: number,
  confidenceLevel = 0.95
): number {
  if (targetMargin === 0 || estimatedStdDev === 0) return 1;
  
  const alpha = 1 - confidenceLevel;
  const z = zScoreCriticalValue(alpha / 2);
  
  // n = (z * σ / E)^2
  const n = Math.pow((z * estimatedStdDev) / targetMargin, 2);
  return Math.ceil(n);
}

/**
 * Validate sample quality based on metrics with confidence intervals
 */
export function validateSampleQuality(
  n: number,
  ciWidth: number,
  targetWidth = 0.1 // 10% default for proportions
): SampleQuality {
  // Quality based on CI width relative to target
  let qualityScore: "excellent" | "good" | "fair" | "poor";
  let sufficient = true;
  let recommendedSampleSize: number | undefined;

  if (ciWidth <= targetWidth * 0.5) {
    qualityScore = "excellent";
  } else if (ciWidth <= targetWidth) {
    qualityScore = "good";
  } else if (ciWidth <= targetWidth * 2) {
    qualityScore = "fair";
    sufficient = false;
    // Estimate samples needed
    const ratio = ciWidth / targetWidth;
    recommendedSampleSize = Math.ceil(n * ratio * ratio);
  } else {
    qualityScore = "poor";
    sufficient = false;
    const ratio = ciWidth / targetWidth;
    recommendedSampleSize = Math.ceil(n * ratio * ratio);
  }

  return {
    sufficient,
    recommendedSampleSize,
    qualityScore,
  };
}

/**
 * Perform independent two-sample t-test (Welch's t-test)
 * Does not assume equal variances
 */
export function twoSampleTTest(
  baseline: number[],
  current: number[],
  alpha = 0.05
): TTestResult {
  if (baseline.length === 0 || current.length === 0) {
    return {
      statistic: 0,
      pValue: 1,
      significant: false,
      effectSize: 0,
      degreesOfFreedom: 0,
    };
  }

  const mean1 = ss.mean(baseline);
  const mean2 = ss.mean(current);
  const var1 = baseline.length > 1 ? ss.sampleVariance(baseline) : 0;
  const var2 = current.length > 1 ? ss.sampleVariance(current) : 0;
  const n1 = baseline.length;
  const n2 = current.length;

  // Welch's t-statistic
  const stdError = Math.sqrt(var1 / n1 + var2 / n2);
  const tStatistic = stdError === 0 ? 0 : (mean2 - mean1) / stdError;

  // Welch-Satterthwaite degrees of freedom
  const df = welchDegreesOfFreedom(var1, n1, var2, n2);

  // Calculate p-value (two-tailed)
  const pValue = tDistributionPValue(Math.abs(tStatistic), df);

  // Cohen's d effect size
  const pooledStdDev = Math.sqrt((var1 + var2) / 2);
  const effectSize = pooledStdDev === 0 ? 0 : (mean2 - mean1) / pooledStdDev;

  return {
    statistic: tStatistic,
    pValue,
    significant: pValue < alpha,
    effectSize,
    degreesOfFreedom: df,
  };
}

/**
 * Perform two-proportion z-test
 */
export function proportionZTest(
  successes1: number,
  total1: number,
  successes2: number,
  total2: number,
  alpha = 0.05
): TTestResult {
  if (total1 === 0 || total2 === 0) {
    return {
      statistic: 0,
      pValue: 1,
      significant: false,
      effectSize: 0,
      degreesOfFreedom: total1 + total2 - 2,
    };
  }

  const p1 = successes1 / total1;
  const p2 = successes2 / total2;
  
  // Pooled proportion
  const pPooled = (successes1 + successes2) / (total1 + total2);
  
  // Standard error under null hypothesis
  const stdError = Math.sqrt(pPooled * (1 - pPooled) * (1 / total1 + 1 / total2));
  
  // Z-statistic
  const zStatistic = stdError === 0 ? 0 : (p2 - p1) / stdError;
  
  // Two-tailed p-value
  const pValue = 2 * (1 - standardNormalCDF(Math.abs(zStatistic)));
  
  // Effect size (difference in proportions)
  const effectSize = p2 - p1;

  return {
    statistic: zStatistic,
    pValue,
    significant: pValue < alpha,
    effectSize,
    degreesOfFreedom: total1 + total2 - 2,
  };
}

/**
 * Calculate statistical power for detecting an effect
 */
export function calculatePower(
  n: number,
  effectSize: number,
  alpha = 0.05
): number {
  // Simplified power calculation for two-sample t-test
  // Power = P(reject H0 | H1 is true)
  
  const df = 2 * n - 2;
  const criticalT = tDistributionCriticalValue(df, alpha / 2);
  const noncentrality = effectSize * Math.sqrt(n / 2);
  
  // Approximate power using normal distribution
  const power = 1 - standardNormalCDF(criticalT - noncentrality);
  
  return Math.max(0, Math.min(1, power));
}

// Helper functions for statistical distributions

/**
 * Get critical value from t-distribution for two-tailed test
 */
function tDistributionCriticalValue(df: number, alpha: number): number {
  // Approximate using normal distribution for large df
  if (df > 30) {
    return zScoreCriticalValue(alpha);
  }
  
  // T-distribution critical values (two-tailed, common alphas)
  const tTable: Record<number, Record<number, number>> = {
    1: { 0.025: 12.706, 0.005: 63.657 },
    2: { 0.025: 4.303, 0.005: 9.925 },
    3: { 0.025: 3.182, 0.005: 5.841 },
    4: { 0.025: 2.776, 0.005: 4.604 },
    5: { 0.025: 2.571, 0.005: 4.032 },
    6: { 0.025: 2.447, 0.005: 3.707 },
    7: { 0.025: 2.365, 0.005: 3.499 },
    8: { 0.025: 2.306, 0.005: 3.355 },
    9: { 0.025: 2.262, 0.005: 3.250 },
    10: { 0.025: 2.228, 0.005: 3.169 },
    15: { 0.025: 2.131, 0.005: 2.947 },
    20: { 0.025: 2.086, 0.005: 2.845 },
    25: { 0.025: 2.060, 0.005: 2.787 },
    30: { 0.025: 2.042, 0.005: 2.750 },
  };
  
  // Find closest df in table
  const availableDf = Object.keys(tTable).map(Number).sort((a, b) => a - b);
  let closestDf = availableDf[0];
  for (const testDf of availableDf) {
    if (testDf <= df) closestDf = testDf;
  }
  
  const alphaKey = alpha <= 0.005 ? 0.005 : 0.025;
  return tTable[closestDf]?.[alphaKey] ?? 1.96;
}

/**
 * Get critical value from standard normal distribution (z-score)
 */
function zScoreCriticalValue(alpha: number): number {
  // Common z-scores
  if (alpha <= 0.005) return 2.807; // 99.5%
  if (alpha <= 0.01) return 2.576;  // 99%
  if (alpha <= 0.025) return 1.96;  // 97.5% (95% CI)
  if (alpha <= 0.05) return 1.645;  // 95%
  return 1.96; // Default to 95% CI
}

/**
 * Calculate p-value from t-statistic (two-tailed)
 */
function tDistributionPValue(tStat: number, df: number): number {
  // For large df, approximate with normal
  if (df > 30) {
    return 2 * (1 - standardNormalCDF(tStat));
  }
  
  // Approximate p-value using relationship between t and F distributions
  // This is a simplified approximation
  const tSquared = tStat * tStat;
  const x = df / (df + tSquared);
  
  // Approximate using incomplete beta function (simplified)
  // For practical purposes, use rough approximation
  if (tStat > 4) return 0.0001;
  if (tStat > 3) return 0.01;
  if (tStat > 2.5) return 0.02;
  if (tStat > 2) return 0.05;
  if (tStat > 1.5) return 0.15;
  if (tStat > 1) return 0.3;
  return 0.5;
}

/**
 * Standard normal cumulative distribution function
 */
function standardNormalCDF(z: number): number {
  // Approximation of the standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - prob : prob;
}

/**
 * Calculate Welch-Satterthwaite degrees of freedom
 */
function welchDegreesOfFreedom(
  var1: number,
  n1: number,
  var2: number,
  n2: number
): number {
  const s1Squared = var1 / n1;
  const s2Squared = var2 / n2;
  const numerator = Math.pow(s1Squared + s2Squared, 2);
  const denominator = 
    Math.pow(s1Squared, 2) / (n1 - 1) + 
    Math.pow(s2Squared, 2) / (n2 - 1);
  
  return denominator === 0 ? n1 + n2 - 2 : numerator / denominator;
}

