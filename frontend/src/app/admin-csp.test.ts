/// <reference types="node" />
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * G1a: the admin app's Content-Security-Policy (docs/DEPLOYMENT_GUIDE.md, Nginx) allows the one inline
 * script in index.html by its sha256 hash. Changing that script without updating the documented hash
 * would break the theme bootstrap in production — this keeps the two in step.
 */
describe('admin CSP', () => {
  const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

  it('documents the hash of the inline theme script in index.html', () => {
    // Browsers hash the script text after normalising line breaks to LF.
    const html = read('../../index.html').replace(/\r\n/g, '\n')
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '')
    expect(inline).toHaveLength(1)
    const hash = createHash('sha256').update(inline[0]!, 'utf8').digest('base64')
    // G1c: the shipped Nginx snippet carries the same header.
    const sources = ['../../../docs/DEPLOYMENT_GUIDE.md', '../../../deploy/nginx/snippets/pos-admin-headers.conf']
    const documented = sources.flatMap((source) => {
      const found = [...read(source).matchAll(/script-src 'self' 'sha256-([A-Za-z0-9+/=]+)'/g)].map((match) => match[1])
      expect(found.length, source).toBeGreaterThan(0)
      return found
    })
    for (const value of documented) expect(value).toBe(hash)
  })
})
