import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  safeJsonParse,
  safeParseNotebook,
  verifyJsonDepth,
  JsonSecurityError
} from '../parser/safe-json.js';

describe('Prototype-Pollution-Proof JSON Parser', () => {
  it('parses valid JSON successfully', () => {
    const input = '{"title":"Analysis","version":1,"tags":["ml","ai"]}';
    const result = safeJsonParse<{ title: string; version: number }>(input);
    assert.equal(result.title, 'Analysis');
    assert.equal(result.version, 1);
  });

  it('rejects prototype pollution attacks with __proto__', () => {
    const malicious = '{"title":"Safe","__proto__":{"isAdmin":true}}';

    assert.throws(
      () => safeJsonParse(malicious),
      (err: Error) => {
        return err instanceof JsonSecurityError &&
          err.message.includes('Dangerous prototype pollution key detected in JSON: "__proto__"');
      }
    );

    // Verify global Object.prototype was NOT polluted
    assert.equal((Object.prototype as { isAdmin?: boolean }).isAdmin, undefined);
  });

  it('rejects prototype pollution attacks with constructor and prototype', () => {
    const maliciousConstructor = '{"constructor":{"evil":true}}';
    assert.throws(
      () => safeJsonParse(maliciousConstructor),
      /Dangerous prototype pollution key detected/
    );

    const maliciousPrototype = '{"prototype":{"evil":true}}';
    assert.throws(
      () => safeJsonParse(maliciousPrototype),
      /Dangerous prototype pollution key detected/
    );
  });

  it('strips dangerous keys when actionOnDisallowed is strip', () => {
    const input = '{"title":"Good","__proto__":{"pollute":true},"constructor":{"evil":true},"valid":123}';
    const stripped = safeJsonParse<Record<string, unknown>>(input, {
      actionOnDisallowed: 'strip'
    });

    assert.equal(stripped['title'], 'Good');
    assert.equal(stripped['valid'], 123);
    assert.equal(Object.hasOwn(stripped, '__proto__'), false);
    assert.equal(Object.hasOwn(stripped, 'constructor'), false);
    assert.equal((Object.prototype as { pollute?: unknown }).pollute, undefined);
  });

  it('enforces maximum recursion depth check', () => {
    // Construct JSON nested 15 levels deep
    let deep = '{"val":1}';
    for (let i = 0; i < 15; i++) {
      deep = `{"nested":${deep}}`;
    }

    // With maxDepth: 10, it should throw
    assert.throws(
      () => verifyJsonDepth(deep, 10),
      /JSON nesting depth exceeded safety threshold/
    );

    // With maxDepth: 20, it should pass
    assert.doesNotThrow(() => verifyJsonDepth(deep, 20));
  });

  it('handles strings with brackets and quotes without false depth triggers', () => {
    const trickyJson = JSON.stringify({
      code: 'def func():\n    return [[[[1, 2], [3, 4]]]]\n'
    });

    // Even with maxDepth: 5, the brackets inside the string should not trigger depth error
    assert.doesNotThrow(() => verifyJsonDepth(trickyJson, 5));
  });

  it('enforces maximum payload size', () => {
    const payload = JSON.stringify({ data: 'a'.repeat(2000) });
    assert.throws(
      () => safeJsonParse(payload, { maxPayloadBytes: 1000 }),
      /JSON payload size .* exceeds maximum limit/
    );
  });

  it('enforces notebook cell count limits', () => {
    const cells = Array.from({ length: 50 }, (_, i) => ({
      cell_type: 'code',
      source: `x = ${i}`,
      metadata: {},
      outputs: []
    }));

    const notebookJson = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells
    });

    // Should succeed with maxCellCount: 100
    const ok = safeParseNotebook(notebookJson, { maxCellCount: 100 });
    assert.equal(ok.cells.length, 50);

    // Should reject with maxCellCount: 30
    assert.throws(
      () => safeParseNotebook(notebookJson, { maxCellCount: 30 }),
      /Notebook cell count \(50\) exceeds safety limit of 30/
    );
  });
});
