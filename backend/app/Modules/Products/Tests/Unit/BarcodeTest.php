<?php

namespace App\Modules\Products\Tests\Unit;

use App\Modules\Products\Domain\Barcode;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class BarcodeTest extends TestCase
{
    /**
     * @return array<string, array{string, bool}>
     */
    public static function barcodes(): array
    {
        return [
            'valid EAN-13' => ['4006381333931', true],
            'EAN-13 wrong check digit' => ['4006381333932', false],
            'valid EAN-8' => ['96385074', true],
            'EAN-8 wrong check digit' => ['96385075', false],
            'valid UPC-A' => ['036000291452', true],
            'valid GTIN-14' => ['10012345678902', true],
            'numeric but not GTIN length' => ['123456789', true],
            'Code 128 alphanumeric' => ['ABC-123/xyz', true],
            'QR payload' => ['https://example.test/p?id=42', true],
            'contains space' => ['ABC 123', false],
            'empty' => ['', false],
            'non-ASCII' => ['ক১২৩', false],
            'too long' => [str_repeat('A', 129), false],
        ];
    }

    #[DataProvider('barcodes')]
    public function test_validation(string $barcode, bool $valid): void
    {
        $this->assertSame($valid, Barcode::isValid($barcode));
    }

    public function test_gs1_check_digit(): void
    {
        $this->assertSame(1, Barcode::gs1CheckDigit('400638133393'));
        $this->assertSame(4, Barcode::gs1CheckDigit('9638507'));
        $this->assertSame(2, Barcode::gs1CheckDigit('03600029145'));
    }
}
