import { emitLua, lua } from "../languages/lua.ts"

export const program = lua.program(function*() {
  // fib loops instead of recursing because its binding only exists once lua.fn returns.
  const fib =yield* lua.fn("fib", [lua.param("n", lua.number)], lua.number, function*(n) {
    const a = yield* lua.let("a", lua.literal(0))
    const b = yield* lua.let("b", lua.literal(1))
    const i = yield* lua.let("i", lua.literal(0))
    yield* lua.while(lua.less(i, n), function*() {
      const sum = yield* lua.let("sum", lua.add(a, b))
      yield* lua.assign(a, b)
      yield* lua.assign(b, sum)
      yield* lua.assign(i, lua.add(i, lua.literal(1)))
    })
    yield* lua.return(a)
  })
  const max = yield* lua.fn("max", [lua.param("x", lua.number), lua.param("y", lua.number)], lua.number, function*(x, y) {
    yield* lua.if(lua.less(x, y), function*() {
      yield* lua.return(y)
    }, function*() {
      yield* lua.return(x)
    })
  })
  // Each function names its parameter n, so the emitted Lua renames the later ones to n_2 and n_3.
  const size =yield* lua.fn("size", [lua.param("n", lua.number)], lua.string, function*(n) {
    yield* lua.if(lua.less(n, lua.literal(10)), function*() {
      yield* lua.return(lua.literal("small"))
    }, function*() {
      yield* lua.return(lua.literal("large"))
    })
  })
  const show = yield* lua.fn("show", [lua.param("n", lua.number), lua.param("value", lua.number)], lua.nil, function*(n, value) {
    yield* lua.run(lua.call(lua.print, n, value, lua.call(size, value)))
  })

  const largest = yield* lua.let("largest", lua.literal(0))
  const i = yield* lua.let("i", lua.literal(0))
  yield* lua.while(lua.less(i, lua.literal(12)), function*() {
    const value = yield* lua.let("value", lua.call(fib, i))
    yield* lua.run(lua.call(show, i, value))
    yield* lua.assign(largest, lua.call(max, largest, value))
    yield* lua.assign(i, lua.add(i, lua.literal(1)))
  })
  yield* lua.run(lua.call(lua.print, lua.literal("largest"), largest))
})

console.log(emitLua(program))
