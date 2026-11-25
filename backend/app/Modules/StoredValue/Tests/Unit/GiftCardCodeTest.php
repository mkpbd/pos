<?php

namespace App\Modules\StoredValue\Tests\Unit;

use App\Modules\StoredValue\Domain\GiftCardCode;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class GiftCardCodeTest extends TestCase
{
    public function test_generated_codes_use_the_unambiguous_alphabet_and_are_grouped(): void
    {
        $seen = [];
        for ($i = 0; $i < 200; $i++) {
            $code = GiftCardCode::generate();
            $this->assertMatchesRegularExpression('/^[A-HJ-NP-Z2-9]{16}$/', $code->value);
            $this->assertDoesNotMatchRegularExpression('/[01OI]/', $code->value);
            $this->assertSame(implode('-', str_split($code->value, 4)), $code->formatted());
            $this->assertSame(substr($code->value, -4), $code->last4());
            $seen[$code->value] = true;
        }
        $this->assertCount(200, $seen);
    }

    public function test_codes_compare_case_insensitively_without_separators(): void
    {
        $this->assertSame('ABCD2345EFGH6789', GiftCardCode::normalise(' abcd-2345 efgh_6789 '));
        $this->assertSame(hash('sha256', 'ABCD2345EFGH6789'), GiftCardCode::hashOf('abcd 2345-EFGH-6789'));
    }

    public function test_pre_printed_numbers_are_8_to_20_letters_and_digits(): void
    {
        $this->assertSame('CARD0001', GiftCardCode::prePrinted('card-0001')->value);
        $this->assertTrue(GiftCardCode::isValidPrePrinted('12345678901234567890'));
        $this->assertFalse(GiftCardCode::isValidPrePrinted('1234567'));
        $this->assertFalse(GiftCardCode::isValidPrePrinted('123456789012345678901'));
        $this->assertFalse(GiftCardCode::isValidPrePrinted('CARD#0001'));

        $this->expectException(InvalidArgumentException::class);
        GiftCardCode::prePrinted('ÄBC12345');
    }
}
