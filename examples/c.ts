import { c, emitC } from "../languages/c.ts"

const i32 = (value: number) => c.literal(c.i32, value)

export const program = c.program(function*() {
  const calls = yield* c.let("calls", i32(0), c.i32)
  const lastGrade = yield* c.let("lastGrade", c.literal(c.char, "?"), c.char)
  const lastCounter = yield* c.let("lastCounter", c.null(c.nullable(c.ptr(c.i32))), c.nullable(c.ptr(c.i32)))

  const increment = yield* c.fn("increment", [c.param("counter", c.ptr(c.i32))], c.void, function*(counter) {
    yield* c.assign(c.deref(counter), c.add(c.deref(counter), i32(1)))
    yield* c.assign(lastCounter, counter)
  })

  const swap = yield* c.fn("swap", [c.param("a", c.ptr(c.i32)), c.param("b", c.ptr(c.i32))], c.void, function*(a, b) {
    const t = yield* c.let("t", c.deref(a), c.i32)
    yield* c.assign(c.deref(a), c.deref(b))
    yield* c.assign(c.deref(b), t)
  })

  // TODO: allow recursion. fib loops instead because its binding only exists once c.fn returns.
  const fib = yield* c.fn("fib", [c.param("n", c.i32)], c.i64, function*(n) {
    yield* c.run(c.call(increment, c.address(calls)))
    const a = yield* c.let("a", c.literal(c.i64, 0n), c.i64)
    const b = yield* c.let("b", c.literal(c.i64, 1n), c.i64)
    const i = yield* c.let("i", i32(0), c.i32)
    yield* c.while(c.less(i, n), function*() {
      const sum = yield* c.let("sum", c.add(a, b), c.i64)
      yield* c.assign(a, b)
      yield* c.assign(b, sum)
      yield* c.assign(i, c.add(i, i32(1)))
    })
    yield* c.return(a)
  })

  const max = yield* c.fn("max", [c.param("x", c.i64), c.param("y", c.i64)], c.i64, function*(x, y) {
    yield* c.if(c.less(x, y), function*() {
      yield* c.return(y)
    }, function*() {
      yield* c.return(x)
    })
  })

  const min = yield* c.fn("min", [c.param("x", c.i64), c.param("y", c.i64)], c.i64, function*(x, y) {
    yield* c.return(c.ternary(c.less(x, y), x, y))
  })

  const grade = yield* c.fn("grade", [c.param("score", c.i32)], c.char, function*(score) {
    yield* c.if(c.less(score, i32(50)), function*() {
      yield* c.return(c.literal(c.char, "F"))
    })
    yield* c.if(c.less(score, i32(80)), function*() {
      yield* c.return(c.literal(c.char, "B"))
    })
    yield* c.return(c.literal(c.char, "A"))
  })

  yield* c.fn("main", [], c.i32, function*() {
    const largest = yield* c.let("largest", c.literal(c.i64, 0n), c.i64)
    const i = yield* c.let("i", i32(0), c.i32)
    yield* c.while(c.less(i, i32(12)), function*() {
      yield* c.assign(largest, c.call(max, largest, c.call(fib, i)))
      yield* c.assign(i, c.add(i, i32(1)))
    })
    const capped = yield* c.let("capped", c.cast(c.i32, c.call(min, largest, c.literal(c.i64, 100n))), c.i32)
    yield* c.assign(lastGrade, c.call(grade, capped))
    yield* c.unwrap(lastCounter, "counter", function*(counter) {
      yield* c.assign(c.deref(counter), i32(0))
    })
    const type = c.array(c.i32, 2)
    const values = yield* c.let("values", c.literal(type, [7, 3]), type)
    const outOfOrder = yield* c.let("outOfOrder", c.less(c.index(values, i32(1)), c.index(values, i32(0))), c.bool)
    yield* c.if(outOfOrder, function*() {
      yield* c.run(c.call(swap, c.address(c.index(values, i32(0))), c.address(c.index(values, i32(1)))))
    })
    yield* c.return(c.ternary(c.less(c.index(values, i32(0)), c.index(values, i32(1))), i32(0), i32(1)))
  })
})

console.log(emitC(program))
