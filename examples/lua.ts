import { emitLua, lua } from "../languages/lua.ts"

export const program = lua.program(function*() {
  const sum = yield* lua.fn("sum", [lua.param("count", lua.number)], lua.number, function*(count) {
    const total = yield* lua.let("total", lua.literal(0))
    const i = yield* lua.let("i", lua.literal(0))
    yield* lua.while(lua.less(i, count), function*() {
      yield* lua.assign(total, lua.add(total, i))
      yield* lua.assign(i, lua.add(i, lua.literal(1)))
    })
    yield* lua.return(total)
  })
  yield* lua.run(lua.call(lua.print, lua.call(sum, lua.literal(10))))
})

console.log(emitLua(program))
