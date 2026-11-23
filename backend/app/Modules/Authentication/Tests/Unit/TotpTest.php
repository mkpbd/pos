<?php

namespace App\Modules\Authentication\Tests\Unit;

use App\Modules\Authentication\Domain\TwoFactor\Totp;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class TotpTest extends TestCase
{
    /** RFC 6238 appendix B, SHA1 key "12345678901234567890". */
    private const RFC_SECRET_ASCII = '12345678901234567890';

    /**
     * @return array<string, array{int, string}>
     */
    public static function rfc6238Vectors(): array
    {
        return [
            'T=59' => [59, '94287082'],
            'T=1111111109' => [1111111109, '07081804'],
            'T=1111111111' => [1111111111, '14050471'],
            'T=1234567890' => [1234567890, '89005924'],
            'T=2000000000' => [2000000000, '69279037'],
            'T=20000000000' => [20000000000, '65353130'],
        ];
    }

    #[DataProvider('rfc6238Vectors')]
    public function test_rfc_6238_sha1_vectors_with_8_and_6_digits(int $time, string $expected): void
    {
        $totp = new Totp;
        $secret = Totp::base32Encode(self::RFC_SECRET_ASCII);

        $this->assertSame($expected, $totp->at($secret, $time, 8));
        $this->assertSame(substr($expected, -6), $totp->at($secret, $time));
    }

    #[DataProvider('rfc6238Vectors')]
    public function test_verify_returns_the_matched_time_step(int $time, string $expected): void
    {
        $secret = Totp::base32Encode(self::RFC_SECRET_ASCII);

        $this->assertSame(intdiv($time, 30), (new Totp)->verify($secret, substr($expected, -6), $time));
    }

    public function test_verify_accepts_one_step_of_drift_either_way_and_no_more(): void
    {
        $totp = new Totp;
        $secret = Totp::base32Encode(self::RFC_SECRET_ASCII);
        $time = 1111111111;
        $step = intdiv($time, 30);

        $this->assertSame($step - 1, $totp->verify($secret, $totp->at($secret, $time - 30), $time));
        $this->assertSame($step + 1, $totp->verify($secret, $totp->at($secret, $time + 30), $time));
        $this->assertNull($totp->verify($secret, $totp->at($secret, $time - 90), $time));
        $this->assertNull($totp->verify($secret, $totp->at($secret, $time + 90), $time));
    }

    public function test_verify_rejects_malformed_codes(): void
    {
        $totp = new Totp;
        $secret = Totp::base32Encode(self::RFC_SECRET_ASCII);

        $this->assertNull($totp->verify($secret, '28708', 59));
        $this->assertNull($totp->verify($secret, '2870822', 59));
        $this->assertNull($totp->verify($secret, 'abcdef', 59));
        $this->assertNull($totp->verify($secret, ' 287082', 59));
    }

    public function test_generated_secrets_are_20_random_bytes_in_unpadded_base32(): void
    {
        $totp = new Totp;
        $a = $totp->generateSecret();
        $b = $totp->generateSecret();

        $this->assertMatchesRegularExpression('/^[A-Z2-7]{32}$/', $a);
        $this->assertNotSame($a, $b);
        $this->assertSame(20, strlen(Totp::base32Decode($a)));
        $this->assertSame($a, Totp::base32Encode(Totp::base32Decode($a)));
    }

    public function test_base32_matches_rfc_4648(): void
    {
        $this->assertSame('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', Totp::base32Encode(self::RFC_SECRET_ASCII));
        $this->assertSame('MZXW6YTBOI', Totp::base32Encode('foobar'));
        $this->assertSame('foobar', Totp::base32Decode('mzxw6ytboi'));
    }

    public function test_provisioning_uri(): void
    {
        $uri = (new Totp)->uri('JBSWY3DPEHPK3PXP', 'Acme Retail: Dhaka', 'owner@acme.test');

        $this->assertSame(
            'otpauth://totp/Acme%20Retail%3A%20Dhaka:owner%40acme.test?secret=JBSWY3DPEHPK3PXP&issuer=Acme%20Retail%3A%20Dhaka&algorithm=SHA1&digits=6&period=30',
            $uri,
        );
    }
}
