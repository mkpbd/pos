<?php

namespace App\Modules\Social\Infrastructure\Feeds;

/**
 * P2b: the same feed as CSV (UTF-8, comma-separated, header row); additional images are one
 * comma-separated field. Cells starting with = + - @ are prefixed with a quote so spreadsheet
 * programs never run them as formulas.
 */
final class CsvFeedWriter implements FeedWriter
{
    public const COLUMNS = [
        'id', 'item_group_id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'sale_price_effective_date',
        'link', 'image_link', 'additional_image_link', 'brand', 'product_type', 'color', 'size',
    ];

    public function begin($stream, string $title, string $link, string $description): void
    {
        fputcsv($stream, self::COLUMNS, ',', '"', '');
    }

    public function item($stream, array $row): void
    {
        $values = [
            $row['id'], $row['item_group_id'], $row['title'], $row['description'], $row['availability'], $row['condition'], $row['price'],
            $row['sale_price'], $row['sale_price_effective_date'], $row['link'], $row['image_link'], implode(',', $row['additional_image_links']),
            $row['brand'], $row['product_type'], $row['color'], $row['size'],
        ];
        fputcsv($stream, array_map(fn ($v) => self::cell($v), $values), ',', '"', '');
    }

    public function end($stream): void {}

    public function contentType(): string
    {
        return 'text/csv; charset=UTF-8';
    }

    private static function cell(?string $value): string
    {
        $value = (string) preg_replace('/[\r\n\t]+/', ' ', (string) $value);

        return $value !== '' && in_array($value[0], ['=', '+', '-', '@'], true) ? "'".$value : $value;
    }
}
