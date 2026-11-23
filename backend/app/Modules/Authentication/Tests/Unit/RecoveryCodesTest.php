<?php

namespace App\Modules\Authentication\Tests\Unit;

use App\Modules\Authentication\Domain\TwoFactor\RecoveryCodes;
use PHPUnit\Framework\TestCase;

class RecoveryCodesTest extends TestCase
{
    public function test_generates_ten_distinct_codes_without_look_alike_characters(): void
    {
        $codes = (new RecoveryCodes)->generate();

        $this->assertCount(10, $codes);
        $this->assertCount(10, array_unique($codes));
        foreach ($codes as $code) {
            $this->assertMatchesRegularExpression('/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/', $code);
        }
    }

    public function test_matches_a_code_by_its_keyed_hash_ignoring_case_spaces_and_dash(): void
    {
        $recovery = new RecoveryCodes;
        $codes = $recovery->generate();
        $hashes = array_map(fn ($c) => $recovery->hash($c, 'key-1'), $codes);

        $this->assertSame(3, $recovery->match($codes[3], $hashes, 'key-1'));
        $this->assertSame(3, $recovery->match(strtoupper(str_replace('-', ' ', $codes[3])), $hashes, 'key-1'));
        $this->assertNull($recovery->match($codes[3], $hashes, 'another-key'));
        $this->assertNull($recovery->match('short', $hashes, 'key-1'));
        $this->assertStringNotContainsString(str_replace('-', '', $codes[0]), implode(',', $hashes));
    }
}
