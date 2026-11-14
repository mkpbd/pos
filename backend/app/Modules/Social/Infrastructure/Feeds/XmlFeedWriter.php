<?php

namespace App\Modules\Social\Infrastructure\Feeds;

/**
 * P2b: RSS 2.0 with the Google Merchant namespace (`g:`): `<title>`, `<link>`, `<description>`
 * per item and the other attributes as `g:` elements. Characters XML 1.0 does not allow are
 * dropped; text is escaped.
 */
final class XmlFeedWriter implements FeedWriter
{
    public const NAMESPACE = 'http://base.google.com/ns/1.0';

    public function begin($stream, string $title, string $link, string $description): void
    {
        fwrite($stream, '<?xml version="1.0" encoding="UTF-8"?>'."\n"
            .'<rss version="2.0" xmlns:g="'.self::NAMESPACE.'">'."\n"
            ."<channel>\n"
            .'<title>'.self::text($title).'</title>'."\n"
            .'<link>'.self::text($link).'</link>'."\n"
            .'<description>'.self::text($description).'</description>'."\n");
    }

    public function item($stream, array $row): void
    {
        $xml = "<item>\n".self::element('g:id', $row['id']);
        if ($row['item_group_id'] !== null) {
            $xml .= self::element('g:item_group_id', $row['item_group_id']);
        }
        $xml .= self::element('title', $row['title'])
            .self::element('description', $row['description'])
            .self::element('link', $row['link']);
        if ($row['image_link'] !== null) {
            $xml .= self::element('g:image_link', $row['image_link']);
        }
        foreach ($row['additional_image_links'] as $url) {
            $xml .= self::element('g:additional_image_link', $url);
        }
        $xml .= self::element('g:availability', $row['availability'])
            .self::element('g:condition', $row['condition'])
            .self::element('g:price', $row['price']);
        foreach (['sale_price', 'sale_price_effective_date', 'brand', 'product_type', 'color', 'size'] as $key) {
            if ($row[$key] !== null && $row[$key] !== '') {
                $xml .= self::element('g:'.$key, $row[$key]);
            }
        }
        fwrite($stream, $xml."</item>\n");
    }

    public function end($stream): void
    {
        fwrite($stream, "</channel>\n</rss>\n");
    }

    public function contentType(): string
    {
        return 'application/xml; charset=UTF-8';
    }

    private static function element(string $name, string $value): string
    {
        return '<'.$name.'>'.self::text($value).'</'.$name.">\n";
    }

    public static function text(string $value): string
    {
        $clean = (string) preg_replace('/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]/u', '', $value);

        return htmlspecialchars($clean, ENT_XML1 | ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
