import { describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'

describe('FakeClock', () => {
  it('fires timers in deadline order, ties by scheduling order', () => {
    const c = new FakeClock()
    const fired: string[] = []
    c.setTimeout(() => fired.push('b'), 20)
    c.setTimeout(() => fired.push('a'), 10)
    c.setTimeout(() => fired.push('tie1'), 20)
    c.advance(25)
    expect(fired).toEqual(['a', 'b', 'tie1'])
    expect(c.now()).toBe(25)
  })

  it('does not fire timers scheduled beyond the advance window', () => {
    const c = new FakeClock()
    const fired: string[] = []
    c.setTimeout(() => fired.push('later'), 100)
    c.advance(99)
    expect(fired).toEqual([])
    expect(c.pending).toBe(1)
    c.advance(1)
    expect(fired).toEqual(['later'])
    expect(c.pending).toBe(0)
  })

  it('clearTimeout cancels a pending timer', () => {
    const c = new FakeClock()
    const fired: string[] = []
    const h = c.setTimeout(() => fired.push('x'), 10)
    c.clearTimeout(h)
    c.advance(20)
    expect(fired).toEqual([])
  })

  it('a callback may schedule another timer that fires within the same advance', () => {
    const c = new FakeClock()
    const fired: string[] = []
    c.setTimeout(() => {
      fired.push('first@' + c.now())
      c.setTimeout(() => fired.push('second@' + c.now()), 5)
    }, 10)
    c.advance(20)
    expect(fired).toEqual(['first@10', 'second@15'])
  })

  it('runAll drains chained timers and guards against runaways', () => {
    const c = new FakeClock()
    let count = 0
    const chain = () => {
      if (++count < 5) c.setTimeout(chain, 10)
    }
    c.setTimeout(chain, 10)
    c.runAll()
    expect(count).toBe(5)
    expect(c.pending).toBe(0)

    const forever = () => c.setTimeout(forever, 1)
    c.setTimeout(forever, 1)
    expect(() => c.runAll(100)).toThrow(/still pending/)
  })
})
