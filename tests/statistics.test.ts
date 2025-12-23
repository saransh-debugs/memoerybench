/** Test CI calculations with known distributions
Test significance testing with known samples
Test sample size recommendations
Edge cases (small n, zero variance, etc.)
**/
import { describe, test, expect } from "bun:test";
import { calculateConfidenceInterval, calculateProportionCI, calculateMinimumSampleSize, proportionZTest, twoSampleTTest, calculatePower } from "../runner/statistics";

describe("Statistics", () => {
    describe("Confidence Interval", () => {
        test("should correctly calculate confidence interval for a normal distribution", () => {
            const data = [1, 2, 3, 4, 5];
            const ci = calculateConfidenceInterval(data);
            expect(ci.lower).toBeCloseTo(1.4, 1);
            expect(ci.upper).toBeCloseTo(3.6, 1);
        });
    });
});
describe("Statistics", () => {
    describe("Proportion CI", () => {
        test("should correctly calculate proportion CI for a binomial distribution", () => {
            const successes = 10;
            const total = 20;
            const ci = calculateProportionCI(successes, total);
            expect(ci.lower).toBeCloseTo(0.4, 1);
            expect(ci.upper).toBeCloseTo(0.6, 1);
        });
    });
});

describe("Statistics", () => {
    describe("Minimum Sample Size", () => {
        test("should correctly calculate minimum sample size for a desired margin of error", () => {
            const estimatedStdDev = 1;
            const targetMargin = 0.1;
            const minimumSampleSize = calculateMinimumSampleSize(estimatedStdDev, targetMargin);
            expect(minimumSampleSize).toBeCloseTo(100, 1);
        });
    });
});
describe("Statistics", () => {
    describe("Proportion Z-Test", () => {
        test("should correctly calculate proportion Z-Test for a binomial distribution", () => {
            const successes1 = 10;
            const total1 = 20;
            const successes2 = 15;
            const total2 = 25;
            const zTest = proportionZTest(successes1, total1, successes2, total2);
            expect(zTest.statistic).toBeCloseTo(1.4, 1);
            expect(zTest.pValue).toBeCloseTo(0.1587, 3);
            expect(zTest.significant).toBe(false);
        });
    });
});
describe("Statistics", () => {
    describe("Two-Sample T-Test", () => {
        test("should correctly calculate two-sample T-Test for a normal distribution", () => {
            const baseline = [1, 2, 3, 4, 5];
            const current = [1, 2, 3, 4, 5];
            const tTest = twoSampleTTest(baseline, current);
            expect(tTest.statistic).toBeCloseTo(0, 1);
            expect(tTest.pValue).toBeCloseTo(1, 3);
            expect(tTest.significant).toBe(false);
        });
    });
});

describe("Statistics", () => {
    describe("Power Calculation", () => {
        test("should correctly calculate power for a two-sample t-test", () => {
            const n = 10;
            const effectSize = 0.5;
            const power = calculatePower(n, effectSize);
            expect(power).toBeCloseTo(0.5, 1);
        });
    });
});

describe("Statistics", () => {
    describe("Edge Cases", () => {
        test("should correctly handle edge cases", () => {
            const data = [1, 1, 1, 1, 1];
            const ci = calculateConfidenceInterval(data);
            expect(ci.lower).toBeCloseTo(1, 1);
            expect(ci.upper).toBeCloseTo(1, 1);
        });
    });
});

describe("Statistics", () => {
    describe("Sample Size Recommendation", () => {
        test("should correctly recommend sample size for a desired margin of error", () => {
            function calculateSampleSizeRecommendation(estimatedStdDev: number, targetMargin: number): number {
                // Assuming 95% confidence (Z ≈ 2)
                const z = 2;
                return Math.pow((z * estimatedStdDev) / targetMargin, 2);
            }
            const estimatedStdDev = 1;
            const targetMargin = 0.1;
            const sampleSize = calculateSampleSizeRecommendation(estimatedStdDev, targetMargin);
            expect(sampleSize).toBeCloseTo(100, 1);
        });
    });
});
