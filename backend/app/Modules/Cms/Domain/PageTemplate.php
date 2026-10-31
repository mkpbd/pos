<?php

namespace App\Modules\Cms\Domain;

/**
 * How the storefront lays out a page: plain rich text, rich text followed by the FAQ
 * accordion, or rich text next to the contact form and the store's contact details.
 */
enum PageTemplate: string
{
    case Default = 'default';
    case Faq = 'faq';
    case Contact = 'contact';
}
