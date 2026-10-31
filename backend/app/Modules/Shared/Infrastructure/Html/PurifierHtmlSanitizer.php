<?php

namespace App\Modules\Shared\Infrastructure\Html;

use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use HTMLPurifier;
use HTMLPurifier_Config;
use HTMLPurifier_HTMLDefinition;
use HTMLPurifier_URIDefinition;

/**
 * HTMLPurifier with the ADR-009 whitelist. Built once per process; the compiled
 * definitions are cached under storage/framework/cache/htmlpurifier.
 */
class PurifierHtmlSanitizer implements HtmlSanitizer
{
    private const ALLOWED = 'p,h2,h3,h4,strong,em,u,s,a[href|title|target],ul,ol,li,blockquote,'
        .'img[src|alt|width|height],table,thead,tbody,tr,th,td,figure,figcaption,hr,br';

    private ?HTMLPurifier $purifier = null;

    /**
     * @param  list<string>  $imagePrefixes  URL prefixes images may be loaded from
     */
    public function __construct(private readonly array $imagePrefixes) {}

    public function clean(string $html): string
    {
        return trim(($this->purifier ??= $this->build())->purify($html));
    }

    private function build(): HTMLPurifier
    {
        $config = HTMLPurifier_Config::createDefault();

        $cache = storage_path('framework/cache/htmlpurifier');
        if (! is_dir($cache)) {
            @mkdir($cache, 0775, true);
        }
        $config->set('Cache.SerializerPath', $cache);
        $config->set('HTML.Allowed', self::ALLOWED);
        $config->set('URI.AllowedSchemes', ['http' => true, 'https' => true, 'mailto' => true]);
        $config->set('Attr.AllowedFrameTargets', ['_blank']);
        $config->set('HTML.TargetNoopener', true);
        $config->set('HTML.TargetNoreferrer', true);
        // Bump the revisions whenever the definitions below change (they are cached).
        $config->set('HTML.DefinitionID', 'pos-rich-text');
        $config->set('HTML.DefinitionRev', 1);
        $config->set('URI.DefinitionID', 'pos-rich-text-uri');
        $config->set('URI.DefinitionRev', 1);

        $html = $config->maybeGetRawHTMLDefinition();
        if ($html instanceof HTMLPurifier_HTMLDefinition) {
            $html->addElement('figure', 'Block', 'Optional: (figcaption, Flow) | (Flow, figcaption) | Flow', 'Common');
            $html->addElement('figcaption', 'Inline', 'Flow', 'Common');
        }

        $uri = $config->maybeGetRawURIDefinition();
        if ($uri instanceof HTMLPurifier_URIDefinition) {
            $uri->addFilter(new OwnMediaImagesFilter, $config);
        }

        // The filter instance is cached with the definition, so its settings travel separately.
        OwnMediaImagesFilter::$prefixes = $this->imagePrefixes;

        return new HTMLPurifier($config);
    }
}
