import { c, emitC } from "../languages/c.ts"

const i32 = (value: number) => c.literal(c.int(32), value)

export const program = c.program(function*() {
  const calls = yield* c.let("calls", i32(0), c.int(32))

  const increment = yield* c.fn("increment", [c.param("counter", c.ptr(c.int(32)))], c.void, function*(counter) {
    yield* c.assign(c.deref(counter), c.add(c.deref(counter), i32(1)))
  })

  const swap = yield* c.fn("swap", [c.param("a", c.ptr(c.int(32))), c.param("b", c.ptr(c.int(32)))], c.void, function*(a, b) {
    const t = yield* c.let("t", c.deref(a), c.int(32))
    yield* c.assign(c.deref(a), c.deref(b))
    yield* c.assign(c.deref(b), t)
  })

  // TODO: allow recursion. fib loops instead because its binding only exists once c.fn returns.
  const fib = yield* c.fn("fib", [c.param("n", c.int(32))], c.int(64), function*(n) {
    yield* c.run(c.call(increment, c.address(calls)))
    const a = yield* c.let("a", i32(0), c.int(64))
    const b = yield* c.let("b", i32(1), c.int(64))
    const i = yield* c.let("i", i32(0), c.int(32))
    yield* c.while(c.less(i, n), function*() {
      const sum = yield* c.let("sum", c.add(a, b), c.int(64))
      yield* c.assign(a, b)
      yield* c.assign(b, sum)
      yield* c.assign(i, c.add(i, i32(1)))
    })
    yield* c.return(a)
  })

  const max = yield* c.fn("max", [c.param("x", c.int(64)), c.param("y", c.int(64))], c.int(64), function*(x, y) {
    yield* c.if(c.less(x, y), function*() {
      yield* c.return(y)
    }, function*() {
      yield* c.return(x)
    })
  })

  yield* c.fn("main", [], c.int(32), function*() {
    const largest = yield* c.let("largest", i32(0), c.int(64))
    const i = yield* c.let("i", i32(0), c.int(32))
    yield* c.while(c.less(i, i32(12)), function*() {
      yield* c.assign(largest, c.call(max, largest, c.call(fib, i)))
      yield* c.assign(i, c.add(i, i32(1)))
    })
    const low = yield* c.let("low", i32(1), c.int(32))
    const high = yield* c.let("high", i32(2), c.int(32))
    yield* c.run(c.call(swap, c.address(low), c.address(high)))
    yield* c.return(i32(0))
  })
})

console.log(emitC(program))
