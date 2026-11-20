<?php

namespace App\Modules\Cms\Application\Contracts;

/**
 * B4: content pages as the store builder needs them (scoped to the current organization;
 * deleted pages and other organizations' pages are absent): the whole page to design it with
 * the builder ("Design with the builder" imports title, body and translations) and page
 * summaries for the builder's document list.
 */
interface PageContent
{
    /**
     * A page that is not deleted (any status), or null. `translations` are the stored
     * `{bn: {title?, body_html?, seo_title?, seo_description?}}`.
     *
     * @return array{id: string, slug: string, title: string, status: string, template: string, body_html: ?string, translations: array<string, array<string, string>>}|null
     */
    public function find(string $id): ?array;

    /**
     * Summaries of the pages among the ids that are not deleted, keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, title: string, slug: string, status: string, template: string}>
     */
    public function summaries(array $ids): array;

    /**
     * The active FAQ entries grouped as the storefront shows them (the `faq` of a FAQ page and
     * GET /store/faq), in the request's language.
     *
     * @return list<array{group: ?string, items: list<array{id: string, question: string, answer_html: string}>}>
     */
    public function publicFaq(): array;

    /**
     * AI2b: help content matching a shopper's words — active FAQ entries and visible
     * (published, publication time reached) pages, in the request's language (base text as
     * fallback; both are searched), best matches first, at most $limit. `path` is the storefront
     * address: a page's `/pages/<slug>`; an FAQ entry's FAQ page (the first visible page with the
     * `faq` template) or null when there is none. `excerpt` is plain text, at most 400 characters.
     *
     * @return list<array{type: 'faq'|'page', title: string, path: ?string, excerpt: ?string}>
     */
    public function searchHelp(string $query, int $limit): array;

    /**
     * AI2b: the first visible page with the template (`faq`, `contact`), as `{slug, title}`
     * (title in the request's language), or null.
     *
     * @return array{slug: string, title: string}|null
     */
    public function templatePage(string $template): ?array;
}
