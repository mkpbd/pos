<?php

namespace App\Modules\Storefront\Domain\Builder;

use DateTimeImmutable;

/**
 * B13: A/B tests of a builder document.
 *
 * - The document's `experiments: [{id, name, status, goal, split, started_at, ended_at, winner}]`
 *   (at most 3; pages, content pages and shop areas; kept only when not empty). `status`
 *   draft | running | stopped | ended, `goal` orders | add_to_cart | clicks, `split` the % of
 *   visitors shown version B (10–90), `winner` null | A | B (stopped / ended only).
 * - A top-level section belongs to a version with `experiment: {id, arm: A | B}`. The sections of
 *   one test are one block of siblings (A and B in any order), each version 1–3 sections; a
 *   running test has both versions.
 * - status, started_at, ended_at and winner are the server's: a draft save keeps them from the
 *   stored draft (withManagedFields()), the start / stop / keep actions change them.
 *
 * Everything here is pure (no database); errors are reported through a callback with their
 * path and node id (EXPERIMENT_INVALID).
 */
final class Experiments
{
    public const ERROR_CODE = 'EXPERIMENT_INVALID';

    public const MAX = 3;

    public const MAX_ARM_SECTIONS = 3;

    public const STATUSES = ['draft', 'running', 'stopped', 'ended'];

    public const GOALS = ['orders', 'add_to_cart', 'clicks'];

    public const ARMS = ['A', 'B'];

    public const SPLIT = [10, 90];

    public const NAME_MAX = 60;

    /** The contexts whose documents may have A/B tests. */
    public const CONTEXTS = ['page', 'cms', 'zone'];

    /** The fields only the server changes. */
    public const MANAGED = ['status', 'started_at', 'ended_at', 'winner'];

    private const INSTANT = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/';

    /**
     * The canonical list of tests (an empty list for none).
     *
     * @param  callable(string, ?string, string): void  $error  (path, node id, message)
     * @return list<array{id: string, name: string, status: string, goal: string, split: int, started_at: ?string, ended_at: ?string, winner: ?string}>
     */
    public static function normalize(mixed $value, callable $error): array
    {
        if ($value === null) {
            return [];
        }
        if (! is_array($value) || ! array_is_list($value)) {
            $error('experiments', null, 'The A/B tests must be a list.');

            return [];
        }
        if (count($value) > self::MAX) {
            $error('experiments', null, 'A page can have at most '.self::MAX.' A/B tests.');

            return [];
        }
        $result = [];
        $ids = [];
        foreach ($value as $i => $raw) {
            $path = "experiments.{$i}";
            if (! is_array($raw)) {
                $error($path, null, 'An A/B test must be an object.');

                continue;
            }
            $id = $raw['id'] ?? null;
            if (! is_string($id) || preg_match('/'.BuilderDocumentSchema::ID_PATTERN.'/', $id) !== 1) {
                $error("{$path}.id", null, 'An id is 2–32 lower-case letters, digits, "_" or "-", starting with a letter.');

                continue;
            }
            if (isset($ids[$id])) {
                $error("{$path}.id", null, "The A/B test id \"{$id}\" is used more than once.");

                continue;
            }
            $ids[$id] = true;
            $name = $raw['name'] ?? null;
            if (! is_string($name) || trim($name) === '' || mb_strlen($name) > self::NAME_MAX) {
                $error("{$path}.name", null, 'Enter a name of 1 to '.self::NAME_MAX.' characters.');
                $name = '';
            }
            $status = $raw['status'] ?? 'draft';
            if (! in_array($status, self::STATUSES, true)) {
                $error("{$path}.status", null, 'Choose one of: '.implode(', ', self::STATUSES).'.');
                $status = 'draft';
            }
            $goal = $raw['goal'] ?? 'orders';
            if (! in_array($goal, self::GOALS, true)) {
                $error("{$path}.goal", null, 'Choose one of: '.implode(', ', self::GOALS).'.');
                $goal = 'orders';
            }
            $split = $raw['split'] ?? 50;
            if (! is_int($split) || $split < self::SPLIT[0] || $split > self::SPLIT[1]) {
                $error("{$path}.split", null, 'Enter a whole number from '.self::SPLIT[0].' to '.self::SPLIT[1].' (% of visitors who see version B).');
                $split = 50;
            }
            $instants = [];
            foreach (['started_at', 'ended_at'] as $key) {
                $instant = $raw[$key] ?? null;
                if ($instant !== null && ! self::instant($instant)) {
                    $error("{$path}.{$key}", null, 'Use an ISO 8601 date and time with a time zone.');
                    $instant = null;
                }
                $instants[$key] = $instant;
            }
            $winner = $raw['winner'] ?? null;
            if ($winner !== null && (! in_array($winner, self::ARMS, true) || ! in_array($status, ['stopped', 'ended'], true))) {
                $error("{$path}.winner", null, 'Only a stopped or ended test has a winner (A or B).');
                $winner = null;
            }
            $result[] = [
                'id' => $id,
                'name' => $name,
                'status' => $status,
                'goal' => $goal,
                'split' => $split,
                'started_at' => $instants['started_at'],
                'ended_at' => $instants['ended_at'],
                'winner' => $winner,
            ];
        }

        return $result;
    }

    /**
     * A section's `experiment: {id, arm}`, or null for none (the test's existence is check()'s).
     *
     * @param  callable(string, ?string, string): void  $error
     * @return array{id: string, arm: string}|null
     */
    public static function arm(mixed $value, string $path, ?string $nodeId, callable $error): ?array
    {
        if ($value === null) {
            return null;
        }
        $id = is_array($value) ? ($value['id'] ?? null) : null;
        if (! is_string($id) || preg_match('/'.BuilderDocumentSchema::ID_PATTERN.'/', $id) !== 1) {
            $error("{$path}.id", $nodeId, 'Choose the A/B test this section is a version of.');

            return null;
        }
        if (! in_array($value['arm'] ?? null, self::ARMS, true)) {
            $error("{$path}.arm", $nodeId, 'A section is version A or B of a test.');

            return null;
        }

        return ['id' => $id, 'arm' => $value['arm']];
    }

    /**
     * The tests' sections: each section's test exists, a test's sections are one block of
     * siblings, each version has at most 3 sections and a running test has both versions.
     *
     * @param  list<array<string, mixed>>  $experiments  normalized
     * @param  list<array<string, mixed>>  $sections  normalized top-level sections
     * @param  callable(string, ?string, string): void  $error
     */
    public static function check(array $experiments, array $sections, callable $error): void
    {
        $known = [];
        foreach ($experiments as $i => $experiment) {
            $known[$experiment['id']] = $i;
        }
        /** @var array<string, list<int>> $positions */
        $positions = [];
        $arms = [];
        foreach ($sections as $i => $section) {
            $arm = $section['experiment'] ?? null;
            if (! is_array($arm)) {
                continue;
            }
            if (! isset($known[$arm['id']])) {
                $error("sections.{$i}.experiment.id", $section['id'] ?? null, 'This section is a version of an A/B test that no longer exists.');

                continue;
            }
            $positions[$arm['id']][] = $i;
            $arms[$arm['id']][$arm['arm']] = ($arms[$arm['id']][$arm['arm']] ?? 0) + 1;
        }
        foreach ($positions as $id => $list) {
            $first = $list[0];
            if (end($list) - $first + 1 !== count($list)) {
                foreach ($list as $k => $position) {
                    if ($k > 0 && $position !== $list[$k - 1] + 1) {
                        $error("sections.{$position}.experiment", $sections[$position]['id'] ?? null, 'The versions of an A/B test must be next to each other.');
                        break;
                    }
                }
            }
            foreach (self::ARMS as $arm) {
                if (($arms[$id][$arm] ?? 0) > self::MAX_ARM_SECTIONS) {
                    $error("sections.{$first}.experiment", $sections[$first]['id'] ?? null, "Version {$arm} can have at most ".self::MAX_ARM_SECTIONS.' sections.');
                }
            }
        }
        foreach ($experiments as $i => $experiment) {
            if ($experiment['status'] === 'running' && (($arms[$experiment['id']]['A'] ?? 0) === 0 || ($arms[$experiment['id']]['B'] ?? 0) === 0)) {
                $error("experiments.{$i}", null, 'A running A/B test needs a version A and a version B. Stop it or keep one version first.');
            }
        }
    }

    /**
     * The raw document with the server's fields of its tests: those of a test already in the
     * stored draft come from there, a new test starts as a draft without dates or winner.
     *
     * @param  array<string, mixed>  $content  as sent
     * @param  array<string, mixed>|null  $stored  the stored draft
     * @return array<string, mixed>
     */
    public static function withManagedFields(array $content, ?array $stored): array
    {
        if (! is_array($content['experiments'] ?? null) || ! array_is_list($content['experiments'])) {
            return $content;
        }
        $previous = [];
        foreach (is_array($stored['experiments'] ?? null) ? $stored['experiments'] : [] as $experiment) {
            if (is_array($experiment) && is_string($experiment['id'] ?? null)) {
                $previous[$experiment['id']] = $experiment;
            }
        }
        foreach ($content['experiments'] as $i => $experiment) {
            if (! is_array($experiment)) {
                continue;
            }
            $before = is_string($experiment['id'] ?? null) ? ($previous[$experiment['id']] ?? null) : null;
            foreach (self::MANAGED as $field) {
                $content['experiments'][$i][$field] = $before === null
                    ? ($field === 'status' ? 'draft' : null)
                    : ($before[$field] ?? ($field === 'status' ? 'draft' : null));
            }
        }

        return $content;
    }

    /**
     * A test of a (normalized) document with its index, or null.
     *
     * @param  array<string, mixed>  $content
     * @return array{0: int, 1: array<string, mixed>}|null
     */
    public static function find(array $content, string $id): ?array
    {
        foreach ($content['experiments'] ?? [] as $i => $experiment) {
            if (($experiment['id'] ?? null) === $id) {
                return [$i, $experiment];
            }
        }

        return null;
    }

    /**
     * The section ids of each version of a test.
     *
     * @param  array<string, mixed>  $content
     * @return array{A: list<string>, B: list<string>}
     */
    public static function armSections(array $content, string $id): array
    {
        $result = ['A' => [], 'B' => []];
        foreach ($content['sections'] ?? [] as $section) {
            $arm = is_array($section) ? ($section['experiment'] ?? null) : null;
            if (is_array($arm) && ($arm['id'] ?? null) === $id && isset($result[$arm['arm'] ?? ''])) {
                $result[$arm['arm']][] = (string) $section['id'];
            }
        }

        return $result;
    }

    /**
     * The document after keeping one version: the other version's sections removed, the kept
     * sections plain sections again, the test ended with that winner.
     *
     * @param  array<string, mixed>  $content  normalized
     * @return array<string, mixed>
     */
    public static function keep(array $content, string $id, string $arm, string $now): array
    {
        $sections = [];
        foreach ($content['sections'] ?? [] as $section) {
            $experiment = $section['experiment'] ?? null;
            if (is_array($experiment) && $experiment['id'] === $id) {
                if ($experiment['arm'] !== $arm) {
                    continue;
                }
                unset($section['experiment']);
            }
            $sections[] = $section;
        }
        $content['sections'] = $sections;

        return self::update($content, $id, ['status' => 'ended', 'winner' => $arm, 'ended_at' => self::find($content, $id)[1]['ended_at'] ?? $now]);
    }

    /**
     * The document with some fields of a test changed.
     *
     * @param  array<string, mixed>  $content
     * @param  array<string, mixed>  $fields
     * @return array<string, mixed>
     */
    public static function update(array $content, string $id, array $fields): array
    {
        foreach ($content['experiments'] ?? [] as $i => $experiment) {
            if (($experiment['id'] ?? null) === $id) {
                $content['experiments'][$i] = array_replace($experiment, $fields);
            }
        }

        return $content;
    }

    /**
     * What shoppers' browsers need of the tests (published payloads): `{id, status, split, winner}`.
     *
     * @param  list<array<string, mixed>>  $experiments
     * @return list<array{id: string, status: string, split: int, winner: ?string}>
     */
    public static function public(array $experiments): array
    {
        return array_map(fn (array $e) => [
            'id' => $e['id'],
            'status' => $e['status'],
            'split' => $e['split'],
            'winner' => $e['winner'] ?? null,
        ], $experiments);
    }

    private static function instant(mixed $value): bool
    {
        if (! is_string($value) || preg_match(self::INSTANT, $value) !== 1) {
            return false;
        }
        try {
            new DateTimeImmutable($value);

            return true;
        } catch (\Exception) {
            return false;
        }
    }
}
