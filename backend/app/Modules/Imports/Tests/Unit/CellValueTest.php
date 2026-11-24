<?php

namespace App\Modules\Imports\Tests\Unit;

use App\Modules\Imports\Domain\CellValue;
use App\Modules\Imports\Domain\ColumnType;
use App\Modules\Imports\Domain\HeaderMatcher;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

/**
 * ST1: how import cells and headers are read.
 */
class CellValueTest extends TestCase
{
    public function test_decimals_are_exact_strings(): void
    {
        $this->assertSame(['1234.50', null], CellValue::read(ColumnType::Decimal, '1,234.50'));
        $this->assertSame(['12.3', null], CellValue::read(ColumnType::Decimal, 12.3));
        $this->assertSame(['0.5', null], CellValue::read(ColumnType::Decimal, '.5'));
        $this->assertSame(['-3', null], CellValue::read(ColumnType::Decimal, ' -3 '));
        $this->assertSame(['1000000', null], CellValue::read(ColumnType::Decimal, '1 000 000'));
        $this->assertSame([null, null], CellValue::read(ColumnType::Decimal, ''));
        $this->assertNotNull(CellValue::read(ColumnType::Decimal, '12,5')[1]);
        $this->assertNotNull(CellValue::read(ColumnType::Decimal, '1.2.3')[1]);
        $this->assertSame(['30', null], CellValue::read(ColumnType::Integer, '30.00'));
        $this->assertNotNull(CellValue::read(ColumnType::Integer, '30.5')[1]);
    }

    public function test_dates_from_text_date_cells_and_excel_serials(): void
    {
        $this->assertSame(['2027-06-30', null], CellValue::read(ColumnType::Date, '2027-06-30'));
        $this->assertSame(['2027-06-30', null], CellValue::read(ColumnType::Date, new DateTimeImmutable('2027-06-30 00:00')));
        $this->assertSame(['2025-01-01', null], CellValue::read(ColumnType::Date, 45658));
        $this->assertSame(['1900-01-01', null], CellValue::read(ColumnType::Date, 1));
        $this->assertSame(['1900-03-01', null], CellValue::read(ColumnType::Date, '61'));
        $this->assertNotNull(CellValue::read(ColumnType::Date, '2027-02-30')[1]);
        $this->assertNotNull(CellValue::read(ColumnType::Date, '30/06/2027')[1]);
    }

    public function test_booleans_and_text(): void
    {
        $this->assertSame([true, null], CellValue::read(ColumnType::Boolean, 'Yes'));
        $this->assertSame([false, null], CellValue::read(ColumnType::Boolean, 0));
        $this->assertNotNull(CellValue::read(ColumnType::Boolean, 'maybe')[1]);
        $this->assertSame(['01711', null], CellValue::read(ColumnType::Text, " 01711\u{00A0}"));
        $this->assertSame(2, CellValue::scaleOf('1.25'));
    }

    public function test_headers_match_keys_or_labels_ignoring_case_and_spacing(): void
    {
        $columns = [
            ['key' => 'name', 'label' => 'Product name', 'required' => true],
            ['key' => 'selling_price', 'label' => 'Selling price', 'required' => false],
        ];
        $match = HeaderMatcher::match($columns, ["\u{FEFF}PRODUCT NAME", ' Selling-Price ', null]);
        $this->assertSame([0 => 'name', 1 => 'selling_price'], $match['map']);
        $this->assertSame([], $match['missing']);

        $match = HeaderMatcher::match($columns, ['selling price', 'colour', 'Selling_Price']);
        $this->assertSame(['name'], $match['missing']);
        $this->assertSame(['colour'], $match['unknown']);
        $this->assertSame(['Selling_Price'], $match['duplicate']);
    }
}
