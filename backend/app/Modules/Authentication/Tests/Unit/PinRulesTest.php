<?php

namespace App\Modules\Authentication\Tests\Unit;

use App\Modules\Authentication\Domain\Pin\PinRules;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class PinRulesTest extends TestCase
{
    /**
     * @return iterable<string, array{string, bool}>
     */
    public static function pins(): iterable
    {
        yield 'four digits' => ['2580', true];
        yield 'six digits' => ['135790', true];
        yield 'leading zero' => ['0472', true];
        yield 'almost a run' => ['1235', true];
        yield 'wraps around' => ['8901', true];
        yield 'too short' => ['123', false];
        yield 'too long' => ['1357913', false];
        yield 'letters' => ['12a4', false];
        yield 'spaces' => [' 2580', false];
        yield 'empty' => ['', false];
        yield 'one digit repeated' => ['1111', false];
        yield 'six zeros' => ['000000', false];
        yield 'run up' => ['1234', false];
        yield 'run up from zero' => ['012345', false];
        yield 'run down' => ['4321', false];
        yield 'run down six' => ['987654', false];
    }

    #[DataProvider('pins')]
    public function test_pin_rules(string $pin, bool $acceptable): void
    {
        $this->assertSame($acceptable, PinRules::violation($pin) === null);
    }
}
