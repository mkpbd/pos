<?php

namespace App\Modules\Marketing\Domain;

/**
 * B13: Bayesian A/B test maths (no dependency). Each version's conversion rate has a
 * Beta(1 + conversions, 1 + visitors − conversions) posterior (uniform prior); the chance that B
 * beats A is P(p_B > p_A), computed exactly with the closed form
 *
 *   P = Σ_{i=0}^{α_B − 1} B(α_A + i, β_A + β_B) / ((β_B + i) · B(1 + i, β_B) · B(α_A, β_A))
 *
 * (log-gamma via Lanczos, summed in log space), or — beyond 20 000 conversions of B, where the
 * sum would be slow and both posteriors are practically normal — with the normal approximation.
 * These are statistics, not money: floats are fine here.
 */
final class BetaBinomial
{
    public const EXACT_LIMIT = 20000;

    private const LANCZOS = [
        676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
        12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];

    /**
     * P(B's rate > A's rate), 0 … 1.
     */
    public static function probabilityBBeatsA(int $visitorsA, int $conversionsA, int $visitorsB, int $conversionsB): float
    {
        $conversionsA = max(0, min($conversionsA, $visitorsA));
        $conversionsB = max(0, min($conversionsB, $visitorsB));
        $alphaA = 1 + $conversionsA;
        $betaA = 1 + $visitorsA - $conversionsA;
        $alphaB = 1 + $conversionsB;
        $betaB = 1 + $visitorsB - $conversionsB;

        if ($alphaB - 1 > self::EXACT_LIMIT) {
            return self::normal($alphaA, $betaA, $alphaB, $betaB);
        }
        $constant = self::logBeta($alphaA, $betaA);
        $total = 0.0;
        for ($i = 0; $i < $alphaB; $i++) {
            $total += exp(self::logBeta($alphaA + $i, $betaA + $betaB) - log($betaB + $i) - self::logBeta(1 + $i, $betaB) - $constant);
        }

        return max(0.0, min(1.0, $total));
    }

    /**
     * ln Γ(x) for x > 0 (Lanczos, g = 7, n = 9).
     */
    public static function logGamma(float $x): float
    {
        if ($x < 0.5) {
            // Reflection: Γ(x)Γ(1 − x) = π / sin(πx).
            return log(M_PI / abs(sin(M_PI * $x))) - self::logGamma(1 - $x);
        }
        $x -= 1;
        $a = 0.99999999999980993;
        $t = $x + 7.5;
        foreach (self::LANCZOS as $k => $c) {
            $a += $c / ($x + $k + 1);
        }

        return 0.5 * log(2 * M_PI) + ($x + 0.5) * log($t) - $t + log($a);
    }

    public static function logBeta(float $a, float $b): float
    {
        return self::logGamma($a) + self::logGamma($b) - self::logGamma($a + $b);
    }

    private static function normal(int $alphaA, int $betaA, int $alphaB, int $betaB): float
    {
        [$meanA, $varA] = self::moments($alphaA, $betaA);
        [$meanB, $varB] = self::moments($alphaB, $betaB);
        $sd = sqrt($varA + $varB);

        return $sd <= 0.0 ? ($meanB > $meanA ? 1.0 : 0.0) : self::phi(($meanB - $meanA) / $sd);
    }

    /**
     * @return array{0: float, 1: float} mean and variance of Beta(α, β)
     */
    private static function moments(int $alpha, int $beta): array
    {
        $sum = $alpha + $beta;

        return [$alpha / $sum, ($alpha * $beta) / ($sum * $sum * ($sum + 1))];
    }

    /**
     * The standard normal CDF (Abramowitz & Stegun 7.1.26 erf, error < 1.5e-7).
     */
    private static function phi(float $z): float
    {
        $x = abs($z) / M_SQRT2;
        $t = 1 / (1 + 0.3275911 * $x);
        $erf = 1 - ((((1.061405429 * $t - 1.453152027) * $t + 1.421413741) * $t - 0.284496736) * $t + 0.254829592) * $t * exp(-$x * $x);

        return $z >= 0 ? 0.5 * (1 + $erf) : 0.5 * (1 - $erf);
    }
}
