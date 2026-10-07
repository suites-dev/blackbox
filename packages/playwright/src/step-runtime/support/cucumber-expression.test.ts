import { describe, expect, it } from 'vitest';

import { compileExpression } from './cucumber-expression.js';

// Requirement: the step library matches step text exactly as Cucumber
// Expressions does for the subset it is written in ({int}, {string}, {word}
// and optional text), with Cucumber's built-in patterns and conversions, and
// refuses any expression outside that subset instead of matching it some
// other way. The expected values are what @cucumber/cucumber-expressions 20.1.0
// returns for the same expression and text.

describe('compileExpression', () => {
  it('converts {int}, {string} and {word} as Cucumber does', () => {
    const expression = compileExpression('the client sends {word} {string} and gets {int}');
    expect(expression.match('the client sends POST "/a b" and gets 201')).toEqual([
      'POST',
      '/a b',
      201,
    ]);
    expect(expression.match("the client sends GET '/x' and gets -1")).toEqual(['GET', '/x', -1]);
    expect(expression.match('the client sends GET "say \\"hi\\"" and gets 0')).toEqual([
      'GET',
      'say "hi"',
      0,
    ]);
    expect(expression.match('the client sends GET "" and gets 7')).toEqual(['GET', '', 7]);
  });

  it('matches the whole text only', () => {
    const expression = compileExpression('the response status is {int}');
    expect(expression.match('the response status is 201')).toEqual([201]);
    expect(expression.match('the response status is 201 within 5 seconds')).toBeNull();
    expect(expression.match('then the response status is 201')).toBeNull();
    expect(expression.match('the response status is two')).toBeNull();
  });

  it('treats optional text as optional and every other character literally', () => {
    const expression = compileExpression('the response has {int} item(s) at {string}.*');
    expect(expression.match('the response has 1 item at "/data".*')).toEqual([1, '/data']);
    expect(expression.match('the response has 3 items at "/data".*')).toEqual([3, '/data']);
    expect(expression.match('the response has 3 items at "/data"xx')).toBeNull();
  });

  it('describes its parameters with Cucumber patterns', () => {
    expect(compileExpression('the {string} participant has {int} {word}').parameterTypes).toEqual([
      { name: 'string', pattern: String.raw`"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'` },
      { name: 'int', pattern: String.raw`(?:-?\d+)|(?:\d+)` },
      { name: 'word', pattern: String.raw`[^\s]+` },
    ]);
  });

  it('refuses expressions outside the supported subset', () => {
    expect(() => compileExpression('the user has {float} points')).toThrow(
      'Step expression "the user has {float} points" uses parameter type {float}, which the step library does not support',
    );
    expect(() => compileExpression('the user is admin/owner')).toThrow('uses "/"');
    expect(() => compileExpression('the user is \\{admin}')).toThrow('uses "\\\\"');
    expect(() => compileExpression('the user {string')).toThrow('has an unclosed {');
    expect(() => compileExpression('the user (has {int})')).toThrow(
      'has optional text the step library does not support',
    );
  });
});
