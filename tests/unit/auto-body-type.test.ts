/// <reference types="bun" />
import { describe, it, expect } from 'bun:test'
import { getAutoBodyType } from '../../src/lib/helpers'

describe('getAutoBodyType — automatic active type selection', () => {
  it('selects "none" when content is undefined or null', () => {
    expect(getAutoBodyType(undefined)).toBe('none')
    expect(getAutoBodyType(null)).toBe('none')
  })

  it('selects "none" when content is empty string', () => {
    expect(getAutoBodyType('')).toBe('none')
  })

  it('selects "none" when content contains only whitespace', () => {
    expect(getAutoBodyType('   ')).toBe('none')
    expect(getAutoBodyType('\n\t  \r\n')).toBe('none')
  })

  it('selects "json" when there is a curly bracket at the beginning', () => {
    expect(getAutoBodyType('{}')).toBe('json')
    expect(getAutoBodyType('{"name": "test"}')).toBe('json')
    expect(getAutoBodyType('{\n  "nested": {\n    "key": "val"\n  }\n}')).toBe('json')
    expect(getAutoBodyType('{')).toBe('json')
  })

  it('selects "json" when leading whitespace precedes a curly bracket', () => {
    expect(getAutoBodyType('   {"key": 1}')).toBe('json')
    expect(getAutoBodyType('\n\t { "foo": "bar" }')).toBe('json')
  })

  it('selects "text" when there is non-json content', () => {
    expect(getAutoBodyType('Hello World')).toBe('text')
    expect(getAutoBodyType('plain text content')).toBe('text')
    expect(getAutoBodyType('<xml><user>john</user></xml>')).toBe('text')
    expect(getAutoBodyType('12345')).toBe('text')
    expect(getAutoBodyType('true')).toBe('text')
    expect(getAutoBodyType('[1, 2, 3]')).toBe('text')
  })
})
