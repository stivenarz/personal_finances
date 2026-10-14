import test from 'node:test';
import assert from 'node:assert/strict';

const { sanitizeDecimal, parseDecimal } = await import('../src/core/utils.js');

test('acepta coma o punto como separador decimal', () => {
    assert.equal(parseDecimal('2,5'), 2.5);
    assert.equal(parseDecimal('2.5'), 2.5);
    assert.equal(parseDecimal('0,75'), 0.75);
    assert.equal(parseDecimal('1500'), 1500);
});

test('sin cifras es null; signos sueltos son NaN', () => {
    assert.equal(parseDecimal(''), null);
    assert.equal(parseDecimal('   '), null);
    assert.equal(parseDecimal('abc'), null);
    assert.ok(Number.isNaN(parseDecimal('-')));
    assert.ok(Number.isNaN(parseDecimal('.')));
});

test('mientras se escribe: un solo separador y sólo dígitos', () => {
    assert.equal(sanitizeDecimal('2,5'), '2.5');
    assert.equal(sanitizeDecimal('2,5,3'), '2.53');
    assert.equal(sanitizeDecimal('2.5.'), '2.5');
    assert.equal(sanitizeDecimal('12abc'), '12');
    assert.equal(sanitizeDecimal('2,'), '2.');
});

test('enteros: sin separador decimal', () => {
    assert.equal(sanitizeDecimal('15,5', { decimals: false }), '155');
    assert.equal(sanitizeDecimal('3.', { decimals: false }), '3');
});

test('negativos sólo si se permiten y el signo sólo al inicio', () => {
    assert.equal(sanitizeDecimal('-5'), '5');
    assert.equal(sanitizeDecimal('-5', { negative: true }), '-5');
    assert.equal(sanitizeDecimal('5-3', { negative: true }), '53');
    assert.equal(parseDecimal('-1500,5'), -1500.5);
});

test('pegar un número con miles (1.500.000) lo normaliza; un solo grupo sigue siendo decimal', () => {
    assert.equal(parseDecimal('1.500.000'), 1500000);
    assert.equal(parseDecimal('12.345.678'), 12345678);
    assert.equal(parseDecimal('1.500'), 1.5);
    assert.equal(parseDecimal('1,500'), 1.5);
});
