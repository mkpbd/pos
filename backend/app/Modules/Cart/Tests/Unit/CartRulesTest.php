<?php

namespace App\Modules\Cart\Tests\Unit;

use App\Modules\Cart\Domain\CartOwner;
use App\Modules\Cart\Domain\CartRules;
use App\Modules\Shared\Domain\BangladeshMobile;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class CartRulesTest extends TestCase
{
    public function test_quantities_display_without_trailing_zeros(): void
    {
        $this->assertSame('2', CartRules::display('2.000'));
        $this->assertSame('1.5', CartRules::display('1.500'));
        $this->assertSame('0.125', CartRules::display('0.125'));
        $this->assertSame('10', CartRules::display('10'));
        $this->assertSame('0', CartRules::display('0'));
    }

    public function test_lines_count_with_at_most_what_is_available(): void
    {
        $this->assertSame('3.000', CartRules::countable('3.000', null));
        $this->assertSame('2.000', CartRules::countable('5.000', '2.000'));
        $this->assertSame('1.000', CartRules::countable('1.000', '2.000'));
    }

    public function test_merged_quantities_are_summed_and_capped(): void
    {
        $this->assertSame(['3.000', false], CartRules::merged('1.000', '2.000', '5.000'));
        $this->assertSame(['5.000', true], CartRules::merged('4.000', '3.000', '5.000'));
        // Untracked: only the 999 ceiling.
        $this->assertSame(['999.000', true], CartRules::merged('990.000', '20.000', null));
        $this->assertSame(['7.000', false], CartRules::merged('4.000', '3.000', null));
        // Nothing on hand: kept as is (the line shows out of stock), never zeroed.
        $this->assertSame(['3.000', false], CartRules::merged('0', '3.000', '0.000'));
        // Never below what the customer already had.
        $this->assertSame(['6.000', true], CartRules::merged('6.000', '1.000', '5.000'));
    }

    public function test_guest_tokens_are_long_random_url_safe_strings(): void
    {
        $a = CartOwner::newToken();
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{54}$/', $a);
        $this->assertNotSame($a, CartOwner::newToken());
        $this->assertSame(hash('sha256', $a), CartOwner::hashToken($a));
    }

    #[DataProvider('mobiles')]
    public function test_bangladeshi_mobile_numbers_are_normalized(string $input, ?string $expected): void
    {
        $this->assertSame($expected, BangladeshMobile::normalize($input));
    }

    /**
     * @return array<string, array{string, ?string}>
     */
    public static function mobiles(): array
    {
        return [
            'national' => ['01712345678', '01712345678'],
            'spaces and dashes' => ['017 1234-5678', '01712345678'],
            'country code' => ['+8801912345678', '01912345678'],
            'country code with spaces' => ['+88 019 1234 5678', '01912345678'],
            'without plus' => ['8801312345678', '01312345678'],
            'international prefix' => ['008801512345678', '01512345678'],
            'bad operator' => ['01212345678', null],
            'too short' => ['0171234567', null],
            'too long' => ['017123456789', null],
            'letters' => ['01712abc678', null],
        ];
    }
}
