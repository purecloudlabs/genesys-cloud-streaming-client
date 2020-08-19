import * as stanzaioLight from '../../src/stanzaio-light';

test('should use default field if exists', () => {
  const fn = jest.fn();

  expect(stanzaioLight.getActualFunction(fn)).toBe(fn);
  expect(stanzaioLight.getActualFunction({ default: fn })).toBe(fn);
});
