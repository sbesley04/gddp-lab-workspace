import { describe, expect, it } from 'vitest'
import { classifyValue, identifierText } from '@core/values'
import { applyTint, resolveColor, colorKey } from '@core/colors'
import { toCsv } from '@core/csv'
import { variableKey, columnLetter, columnIndexFromLetter } from '@core/hash'

describe('value classification', () => {
  it('never turns missing into zero', () => {
    expect(classifyValue(null)).toEqual({ k: 'missing' })
    expect(classifyValue('   ')).toEqual({ k: 'missing' })
    expect(classifyValue(0)).toEqual({ k: 'number', v: 0, raw: '0' })
    expect(classifyValue('0')).toEqual({ k: 'number', v: 0, raw: '0' })
  })
  it('keeps censored bounds without substituting them', () => {
    expect(classifyValue('<0.5')).toEqual({ k: 'censored', op: '<', bound: 0.5, raw: '<0.5' })
    expect(classifyValue('≥ 100')).toMatchObject({ k: 'censored', op: '>=', bound: 100 })
  })
  it('keeps non-numeric text as text', () => {
    expect(classifyValue('N/A')).toEqual({ k: 'text', raw: 'N/A' })
    expect(classifyValue('QNS')).toEqual({ k: 'text', raw: 'QNS' })
    expect(classifyValue('1.2.3')).toEqual({ k: 'text', raw: '1.2.3' })
  })
  it('treats numeric-looking identifiers as text identifiers', () => {
    expect(identifierText(101)).toBe('101')
    expect(identifierText('0101')).toBe('0101')
    expect(identifierText(null)).toBeNull()
  })
})

describe('colour decoding', () => {
  it('applies OOXML tints by luminance', () => {
    expect(applyTint('000000', 0.5)).toBe('808080')
    expect(applyTint('FFFFFF', -0.5)).toBe('808080')
    expect(applyTint('FF0000', 0)).toBe('FF0000')
  })
  it('resolves theme references and keeps the reference form in the key', () => {
    const theme = ['FFFFFF', '000000', 'EEECE1', '1F497D', '4F81BD', 'C0504D']
    expect(resolveColor({ theme: 5 }, theme)).toBe('C0504D')
    expect(resolveColor({ rgb: 'FFFF0000' }, theme)).toBe('FF0000')
    expect(colorKey({ theme: 4, tint: 0.7999816888943144 })).toBe('theme:4:0.80')
    expect(colorKey({ rgb: 'FFFFD1D1' })).toBe('rgb:FFD1D1')
  })
})

describe('csv writer', () => {
  it('escapes and guards formula-like text but never numbers', () => {
    const r = toCsv([['a', 'b,c', 'say "hi"'], ['=SUM(A1)', '-5', -5], ['@x', null, 1.5]])
    expect(r.text).toBe('a,"b,c","say ""hi"""\r\n\'=SUM(A1),-5,-5\r\n\'@x,,1.5\r\n')
    expect(r.guardedCells).toBe(2)
  })
})

describe('identifiers', () => {
  it('derives stable variable keys and column letters', () => {
    expect(variableKey('IL6')).toBe(variableKey('  IL6 '))
    expect(variableKey('IL6')).not.toBe(variableKey('IL6R'))
    expect(columnLetter(1)).toBe('A')
    expect(columnLetter(284)).toBe('JX')
    expect(columnIndexFromLetter('DI')).toBe(113)
  })
})
