import { expect, test } from 'vitest'

test('the test runner works', () => {
  expect(1 + 1).toBe(2)
})

test('jsdom provides a document', () => {
  document.body.innerHTML = '<p>hello</p>'
  expect(document.querySelector('p')?.textContent).toBe('hello')
})
