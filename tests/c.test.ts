import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { type Allocator, type C, c, cTarget, emitC, type F64, type I32, type I8, type Ptr } from "../languages/c.ts"
import * as lang from "../src/index.ts"
import { assertType, type Equal } from "./typing.ts"

const i8 = (value: number) => c.literal(c.i8, value)
const i32 = (value: number) => c.literal(c.i32, value)
const u32 = (value: number) => c.literal(c.u32, value)
const f64 = (value: number) => c.literal(c.f64, value)

export const arithmeticContracts = () => {
  const sum = c.add(i8(1), i8(2))
  assertType<Equal<lang.Denotes<typeof sum>, I8>>()
  const compared = c.less(i32(1), i32(2))
  assertType<Equal<lang.Denotes<typeof compared>, boolean>>()

  c.program(function*() {
    yield* c.fn("main", [], c.void, function*() {
      const n = yield* c.let("n", i32(1), c.i32)
      // @ts-expect-error a C binding needs a declared type
      yield* c.let("untyped", n)
      const p = yield* c.let("p", c.address(n), c.ptr(c.i32))
      // @ts-expect-error a pointer has no arithmetic
      c.add(p, i32(1))
      // @ts-expect-error a pointer has no arithmetic, in either order
      c.add(i32(1), p)
      yield* c.let("q", p, c.ptr(c.i32))
      yield* c.let("m", c.deref(p), c.i32)
      // @ts-expect-error int* to double* needs a cast in C
      yield* c.let("r", p, c.ptr(c.f64))
      // @ts-expect-error int32_t* to uint32_t* needs a cast in C
      yield* c.let("u", p, c.ptr(c.u32))
      // @ts-expect-error an int is not a pointer
      yield* c.let("s", n, c.ptr(c.i32))
      // @ts-expect-error a pointer is not arithmetic
      yield* c.let("t", p, c.i32)
      // @ts-expect-error only a pointer can be dereferenced
      c.deref(n)
      // @ts-expect-error two pointers cannot be added
      c.add(p, p)
      // @ts-expect-error a double cannot be added to a pointer
      c.add(p, f64(1))
      // @ts-expect-error a pointer cannot be compared with an int
      c.less(p, n)
      yield* c.while(c.less(n, i32(10)), function*() {
        yield* c.assign(n, c.add(n, i32(1)))
      })
      // @ts-expect-error a value is not assignable to a pointer binding
      yield* c.assign(p, n)
      const letter = yield* c.let("letter", c.literal(c.char, "a"), c.char)
      // @ts-expect-error a char is not an int
      yield* c.let("code", letter, c.i32)
      // @ts-expect-error an int is not a char
      yield* c.let("other", n, c.char)
      // @ts-expect-error a char is not arithmetic
      c.add(letter, i32(1))
      // @ts-expect-error chars cannot be compared yet
      c.less(letter, letter)
    })
  })
}

export const functionContracts = () => {
  c.program(function*() {
    const square = yield* c.fn("square", [c.param("x", c.i32)], c.i32, function*(x) {
      yield* c.if(c.less(x, i32(0)), function*() {
        yield* c.return(i32(0))
      })
      yield* c.return(c.add(x, x))
    })
    yield* c.fn("main", [], c.void, function*() {
      yield* c.let("nine", c.call(square, i32(3)), c.i32)
    })
    c.call(square, c.cast(c.i32, f64(3)))
    const one = yield* c.let("one", i32(1), c.i32)
    // @ts-expect-error a pointer argument does not convert to an int parameter
    c.call(square, c.address(one))
    // @ts-expect-error too many arguments
    c.call(square, i32(1), i32(2))
    // @ts-expect-error too few arguments
    c.call(square)
    // @ts-expect-error a pointer is returned from a function declared to return an int
    yield* c.fn(
      "leak",
      [c.param("p", c.ptr(c.i32))],
      c.i32,
      function*(p) {
        yield* c.return(p)
      },
    )
  })
}

const counter = () =>
  c.program(function*() {
    yield* c.fn("count", [c.param("limit", c.i32)], c.i32, function*(limit) {
      const i = yield* c.let("i", i32(0), c.i32)
      yield* c.while(c.less(i, limit), function*() {
        yield* c.assign(i, c.add(i, i32(1)))
      })
      yield* c.return(i)
    })
  })

test("emit requires a handler for every kind a program uses, nested kinds included", () => {
  const program = counter()
  assertType<
    Equal<
      typeof program,
      lang.Program<C, "function" | "int-type" | "let" | "literal" | "while" | "less" | "ref" | "assign" | "add" | "return">
    >
  >()
  const { less: _less, ...withoutLess } = cTarget.handlers
  lang.emit(program, lang.defineTarget(cTarget.naming, { ...withoutLess, less: cTarget.handlers.less, extra: () => "" }))
  // @ts-expect-error target has no handler for "less", which is only used in a nested while condition
  assert.throws(() => lang.emit(program, lang.defineTarget(cTarget.naming, withoutLess)), /target has no handler for "less"/)
})

test("the C target emits C source", () => {
  assert.equal(
    emitC(counter()),
    `#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

int32_t count(int32_t limit) {
  int32_t i = 0;
  while (i < limit) {
    i = i + 1;
  }
  return i;
}
`,
  )
  const pointers = c.program(function*() {
    yield* c.fn("main", [], c.i32, function*() {
      const x = yield* c.let("int", f64(2), c.f64)
      const p = yield* c.let("p", c.address(x), c.ptr(c.f64))
      yield* c.let("byte", c.literal(c.u8, 255), c.u8)
      yield* c.return(c.cast(c.i32, c.add(c.deref(p), f64(1))))
    })
  })
  assert.equal(
    emitC(pointers),
    `#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

int32_t main(void) {
  double int_2 = 2.0;
  double* p = &int_2;
  uint8_t byte = 255;
  return (int32_t)(*p + 1.0);
}
`,
  )
})

test("C spells leading underscores safely and preserves collisions and references", () => {
  const program = c.program(function*() {
    const first = yield* c.let("_value", i32(1), c.i32)
    const second = yield* c.let("binding_value", i32(2), c.i32)
    yield* c.let("_", i32(3), c.i32)
    yield* c.let("first", c.address(first), c.ptr(c.i32))
    yield* c.let("second", c.address(second), c.ptr(c.i32))
  })
  assert.equal(
    emitC(program),
    "#include <stdbool.h>\n#include <stddef.h>\n#include <stdint.h>\n\nint32_t binding_value = 1;\nint32_t binding_value_2 = 2;\nint32_t binding_ = 3;\nint32_t* first = &binding_value;\nint32_t* second = &binding_value_2;\n",
  )
  for (const hint of ["_bad-name", "_\n", "_\r", "_\u2028", "_\u2029", "bad-name", "1value", ""]) {
    assert.throws(() =>
      emitC(c.program(function*() {
        yield* c.let(hint, i32(1), c.i32)
      })), /invalid identifier/)
  }
})

test("C compiles C11 keywords and reserved underscore names in every binding position", () => {
  const names = ["_Alignas", "_Alignof", "_Atomic", "_Generic", "_Noreturn", "_Static_assert", "_Thread_local", "__LINE__", "__FILE__", "_value"]
  const program = c.program(function*() {
    for (const name of names) {
      const global = yield* c.let(name, i32(1), c.i32)
      yield* c.fn(name, [c.param(name, c.i32)], c.i32, function*(parameter) {
        const local = yield* c.let(name, c.add(global, parameter), c.i32)
        yield* c.return(local)
      })
    }
    yield* c.fn("main", [], c.i32, function*() {
      yield* c.return(i32(0))
    })
  })
  const text = emitC(program)
  for (const name of names) {
    assert.ok(text.includes(`int32_t binding${name} = 1;`))
    assert.ok(text.includes(`int32_t binding${name}_2(int32_t binding${name}_3)`))
    assert.ok(text.includes(`int32_t binding${name}_4 = binding${name} + binding${name}_3;`))
    assert.ok(text.includes(`return binding${name}_4;`))
  }
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, text)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C literals are spelled with their declared type, and must fit it", () => {
  const program = c.program(function*() {
    yield* c.let("int32_t", c.less(u32(1), u32(2)), c.bool)
    yield* c.let("INT64_C", c.add(c.literal(c.i64, -5n), c.literal(c.i64, 9007199254740991n)), c.i64)
    yield* c.let("min", i32(-2147483648), c.i32)
    yield* c.let("small", c.add(i32(65535), i32(-128)), c.i32)
    yield* c.let("big", f64(1e21), c.f64)
    yield* c.let("tiny", f64(-1.5e-7), c.f64)
    yield* c.let("negativeZero", f64(-0), c.f64)
    yield* c.let("notANumber", c.add(f64(NaN), f64(1)), c.f64)
    yield* c.let("infinity", c.less(f64(-Infinity), f64(Infinity)), c.bool)
  })
  assert.equal(
    emitC(program),
    `#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

bool int32_t_2 = UINT32_C(1) < UINT32_C(2);
int64_t INT64_C_2 = -INT64_C(5) + INT64_C(9007199254740991);
int32_t min = INT32_MIN;
int32_t small = 65535 + -128;
double big = 1e+21;
double tiny = -1.5e-7;
double negativeZero = -0.0;
double notANumber = 0.0 / 0.0 + 1.0;
bool infinity = -1.0 / 0.0 < 1.0 / 0.0;
`,
  )
  assert.throws(() => c.literal(c.i8, 300), /int8_t cannot hold the literal 300 exactly/)
  assert.throws(() => c.literal(c.i32, 1.5), /int32_t cannot hold the literal 1.5 exactly/)
  assert.throws(() => c.literal(c.u8, -1), /uint8_t cannot hold the literal -1 exactly/)
  assert.throws(() => c.literal(c.i64, 1n << 63n), /int64_t cannot hold the literal 9223372036854775808 exactly/)
  assert.throws(() => c.literal(c.char, "é"), /char cannot hold the literal "é"/)
  assert.throws(() => c.literal(c.char, "ab"), /char cannot hold the literal "ab"/)
  assert.throws(() => c.literal(c.char, ""), /char cannot hold the literal ""/)
  assert.throws(() => c.literal(c.f64, 1n as never), /double cannot hold the literal 1/)
})

test("C narrow integer sums retain their type and wrap before comparison", () => {
  const program = c.program(function*() {
    yield* c.let("small", c.add(i8(1), i8(2)), c.i8)
    yield* c.let("shortSum", c.add(c.literal(c.i16, 1), c.literal(c.i16, 2)), c.i16)
    yield* c.let("unsignedShortSum", c.add(c.literal(c.u16, 65535), c.literal(c.u16, 1)), c.u16)
    const sum = yield* c.fn("sum", [c.param("a", c.u8), c.param("b", c.u8)], c.u8, function*(a, b) {
      yield* c.return(c.add(a, b))
    })
    yield* c.fn("main", [], c.i32, function*() {
      const result = yield* c.let("result", c.call(sum, c.literal(c.u8, 200), c.literal(c.u8, 100)), c.u8)
      yield* c.if(c.less(c.add(c.literal(c.u8, 200), c.literal(c.u8, 100)), c.literal(c.u8, 50)), function*() {
        yield* c.return(c.cast(c.i32, result))
      })
      yield* c.return(i32(1))
    })
  })
  const emitted = emitC(program)
  assert.match(emitted, /int8_t small = \(int8_t\)\(1 \+ 2\);/)
  assert.match(emitted, /int16_t shortSum = \(int16_t\)\(1 \+ 2\);/)
  assert.match(emitted, /uint16_t unsignedShortSum = \(uint16_t\)\(65535 \+ 1\);/)
  assert.match(emitted, /return \(uint8_t\)\(a \+ b\);/)
  assert.match(emitted, /if \(\(uint8_t\)\(200 \+ 100\) < 50\)/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-narrow-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, emitted)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 44, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C 64-bit literals preserve exact bounds", () => {
  const program = c.program(function*() {
    yield* c.let("minimum", c.literal(c.i64, -(1n << 63n)), c.i64)
    yield* c.let("maximum", c.literal(c.i64, (1n << 63n) - 1n), c.i64)
    yield* c.let("unsignedMaximum", c.literal(c.u64, (1n << 64n) - 1n), c.u64)
    yield* c.let("zero", c.literal(c.u64, 0n), c.u64)
    yield* c.let("negative", c.literal(c.i64, -9007199254740993n), c.i64)
  })
  const emitted = emitC(program)
  assert.match(emitted, /int64_t minimum = INT64_MIN;/)
  assert.match(emitted, /int64_t maximum = INT64_C\(9223372036854775807\);/)
  assert.match(emitted, /uint64_t unsignedMaximum = UINT64_C\(18446744073709551615\);/)
  assert.match(emitted, /uint64_t zero = UINT64_C\(0\);/)
  assert.match(emitted, /int64_t negative = -INT64_C\(9007199254740993\);/)
  assert.throws(() => c.literal(c.i64, -(1n << 63n) - 1n), /cannot hold the literal/)
  assert.throws(() => c.literal(c.i64, 1n << 63n), /cannot hold the literal/)
  assert.throws(() => c.literal(c.u64, -1n), /cannot hold the literal/)
  assert.throws(() => c.literal(c.u64, 1n << 64n), /cannot hold the literal/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-64-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(
      source,
      `${emitted}\nint main(void) {
  return minimum == INT64_MIN && maximum == INT64_MAX && unsignedMaximum == UINT64_MAX
    && zero == 0 && negative == -INT64_C(9007199254740993) ? 0 : 1;
}\n`,
    )
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 0, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C numeric casts preserve target types, precedence, and C semantics", () => {
  const narrowed = c.cast(c.i32, f64(3.9))
  assertType<Equal<lang.Denotes<typeof narrowed>, I32>>()
  const widened = c.cast(c.f64, c.literal(c.i64, 42n))
  assertType<Equal<lang.Denotes<typeof widened>, F64>>()
  const program = c.program(function*() {
    yield* c.let("sum", c.cast(c.i32, c.add(f64(1.5), f64(2.5))), c.i32)
    yield* c.let("truncated", narrowed, c.i32)
    yield* c.let("wrapped", c.cast(c.u8, i32(257)), c.u8)
    yield* c.let("wide", widened, c.f64)
    yield* c.let("nested", c.cast(c.i64, c.cast(c.i32, f64(-3.9))), c.i64)
    yield* c.let("branch", c.cast(c.i32, c.ternary(c.true, f64(1.5), f64(2.5))), c.i32)
    yield* c.let("added", c.add(narrowed, i32(2)), c.i32)
    yield* c.fn("truncate", [c.param("value", c.f64)], c.i32, function*(value) {
      yield* c.return(c.cast(c.i32, value))
    })
  })
  const emitted = emitC(program)
  assert.equal(
    emitted,
    `#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

int32_t sum = (int32_t)(1.5 + 2.5);
int32_t truncated = (int32_t)3.9;
uint8_t wrapped = (uint8_t)257;
double wide = (double)INT64_C(42);
int64_t nested = (int64_t)(int32_t)-3.9;
int32_t branch = (int32_t)(true ? 1.5 : 2.5);
int32_t added = (int32_t)3.9 + 2;
int32_t truncate(double value) {
  return (int32_t)value;
}
`,
  )
  assert.throws(() =>
    c.program(function*() {
      const value = yield* c.let("value", i32(1), c.i32)
      yield* c.let("nonconstant", c.cast(c.f64, value), c.f64)
    }), /needs a constant initializer/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-cast-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(
      source,
      `${emitted}\nint main(void) {
  return sum == 4 && truncated == 3 && wrapped == 1 && wide == 42.0 && nested == -3
    && branch == 1 && added == 5 && truncate(-3.9) == -3 ? 0 : 1;
}\n`,
    )
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 0, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C rejects invalid program structure", () => {
  assert.throws(
    () =>
      c.program(function*() {
        yield* c.run(i32(1))
      }),
    /"expression" cannot appear at the top level of a C program/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        yield* c.fn("outer", [], c.void, function*() {
          yield* c.if(c.true, function*() {
            yield* c.fn("inner", [], c.void, function*() {})
          })
        })
      }),
    /function "inner" cannot be nested in another function in C/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        const one = yield* c.fn("one", [], c.i32, function*() {
          yield* c.return(i32(1))
        })
        yield* c.let("x", c.call(one), c.i32)
      }),
    /the top-level "let" of "x" needs a constant initializer in C/,
  )
  assert.throws(
    () =>
      c.program(function*() {
        const x = yield* c.let("x", i32(1), c.i32)
        yield* c.let("y", c.add(x, i32(1)), c.i32)
      }),
    /the top-level "let" of "y" needs a constant initializer in C/,
  )
  assert.throws(() => c.address(i32(1) as never), /only an lvalue has an address/)
  assert.throws(
    () =>
      c.program(function*() {
        yield* c.fn("invalid", [c.param("v", c.ptr(c.void))], c.void, function*(v) {
          yield* c.run(c.deref(v as never))
        })
      }),
    /a void pointer cannot be dereferenced/,
  )
  const constants = c.program(function*() {
    const x = yield* c.let("x", c.add(i32(1), c.ternary(c.less(i32(2), i32(3)), i32(1), i32(0))), c.i32)
    yield* c.let("p", c.address(x), c.ptr(c.i32))
  })
  assert.equal(
    emitC(constants),
    "#include <stdbool.h>\n#include <stddef.h>\n#include <stdint.h>\n\nint32_t x = 1 + (2 < 3 ? 1 : 0);\nint32_t* p = &x;\n",
  )
})

test("C nullable pointers hold null, accept pointers, and cannot be dereferenced", () => {
  const nullable = c.nullable(c.ptr(c.i32))
  const program = c.program(function*() {
    const empty = yield* c.let("empty", c.null(nullable), nullable)
    const value = yield* c.let("value", i32(1), c.i32)
    const keep = yield* c.fn("keep", [c.param("pointer", nullable)], nullable, function*(pointer) {
      yield* c.return(pointer)
    })
    yield* c.fn("main", [], c.i32, function*() {
      const pointer = yield* c.let("pointer", c.address(value), nullable)
      assertType<Equal<lang.Denotes<typeof pointer>, Ptr<I32> | null>>()
      yield* c.assign(pointer, c.call(keep, empty))
      yield* c.assign(pointer, c.call(keep, c.address(value)))
      yield* c.run(c.call(keep, pointer))
      // @ts-expect-error a nullable pointer is not a pointer
      c.let("other", pointer, c.ptr(c.i32))
      // @ts-expect-error a nullable pointer cannot be dereferenced
      assert.throws(() => c.deref(pointer), /dereference needs a pointer type/)
      yield* c.return(i32(0))
    })
  })
  const emitted = emitC(program)
  assert.match(emitted, /int32_t\* empty = NULL;/)
  assert.match(emitted, /int32_t\* keep\(int32_t\* pointer\)/)
  assert.match(emitted, /int32_t\* pointer = &value;/)
  assert.throws(() => c.nullable(c.i32 as never), /only a pointer can be nullable/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    writeFileSync(source, emitted)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-c", source, "-o", join(directory, "program.o")], {
      encoding: "utf8",
    })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C maybe skips the rest of its body once a bind meets null, with flat non-null bindings", () => {
  const nullable = c.nullable(c.ptr(c.i32))
  const program = c.program(function*() {
    const value = yield* c.let("value", i32(40), c.i32)
    const trace = yield* c.let("trace", i32(0), c.i32)
    yield* c.fn("main", [], c.i32, function*() {
      const empty = yield* c.let("empty", c.null(nullable), nullable)
      const pointer = yield* c.let("pointer", c.address(value), nullable)
      yield* c.maybe(function*() {
        yield* c.defer(function*() {
          yield* c.assign(trace, c.add(trace, i32(1)))
        })
        const found = yield* c.bind("found", pointer)
        const missing = yield* c.bind("missing", empty)
        yield* c.assign(c.deref(found), i32(0))
        yield* c.assign(c.deref(missing), i32(0))
      })
      yield* c.maybe(function*() {
        const found = yield* c.bind("found", pointer)
        assertType<Equal<lang.Denotes<typeof found>, Ptr<I32>>>()
        yield* c.assign(c.deref(found), c.add(c.deref(found), i32(1)))
        yield* c.return(c.add(c.deref(found), trace))
      })
      // @ts-expect-error only a nullable pointer can be bound
      assert.throws(() => c.bind("found", value), /bind needs a nullable pointer/)
      yield* c.return(i32(1))
    })
  })
  const emitted = emitC(program)
  assert.match(
    emitted,
    /\{\n    int32_t\* found = pointer;\n    if \(found != NULL\) \{\n      int32_t\* missing = empty;\n      if \(missing != NULL\) \{\n        \*found = 0;\n        \*missing = 0;\n      \}\n    \}\n    trace = trace \+ 1;\n  \}/,
  )
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, emitted)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 42, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C bind must be directly inside maybe", () => {
  const nullable = c.nullable(c.ptr(c.i32))
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("outside", [], c.void, function*() {
        const empty = yield* c.let("empty", c.null(nullable), nullable)
        yield* c.bind("found", empty)
      })
    }), /"bind" must be directly inside "maybe"/)
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("nested", [], c.void, function*() {
        const empty = yield* c.let("empty", c.null(nullable), nullable)
        yield* c.maybe(function*() {
          yield* c.if(c.true, function*() {
            yield* c.bind("found", empty)
          })
        })
      })
    }), /"bind" must be directly inside "maybe"/)
})

test("C executes assignment through pointers, loops, and typed calls", () => {
  const program = c.program(function*() {
    const count = yield* c.fn("count", [c.param("value", c.ptr(c.i32))], c.i32, function*(value) {
      const total = yield* c.let("total", i32(0), c.i32)
      const i = yield* c.let("i", i32(0), c.i32)
      yield* c.while(c.less(i, i32(3)), function*() {
        yield* c.assign(total, c.add(total, c.deref(value)))
        yield* c.assign(i, c.add(i, i32(1)))
      })
      yield* c.return(total)
    })
    yield* c.fn("main", [], c.i32, function*() {
      const value = yield* c.let("value", i32(0), c.i32)
      const pointer = yield* c.let("pointer", c.address(value), c.ptr(c.i32))
      yield* c.assign(c.deref(pointer), i32(14))
      yield* c.return(c.call(count, pointer))
    })
  })
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, emitC(program))
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 42, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C char literals compile to the ASCII characters they name", () => {
  const codes = Array.from({ length: 128 }, (_, code) => code)
  const program = c.program(function*() {
    for (const code of codes) yield* c.let(`char_${code}`, c.literal(c.char, String.fromCharCode(code)), c.char)
  })
  const emitted = emitC(program)
  assert.match(emitted, /char char_39 = '\\'';\nchar char_40 = '\(';/)
  assert.match(emitted, /char char_10 = '\\n';/)
  assert.match(emitted, /char char_0 = '\\000';/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-char-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, `${emitted}\nint main(void) {\n  return ${codes.map((code) => `char_${code} == ${code}`).join(" && ")} ? 0 : 1;\n}\n`)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 0, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C rejects escaped references and preserves distinct binding names", () => {
  let escaped: lang.Ref<C, I32> | undefined
  c.program(function*() {
    yield* c.fn("outer", [], c.void, function*() {
      escaped = yield* c.let("inner", i32(1), c.i32)
    })
  })
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("other", [], c.i32, function*() {
        yield* c.return(escaped!)
      })
    }), /reference to "inner" does not resolve to an in-scope binding/)
  const program = c.program(function*() {
    const first = yield* c.let("value", i32(1), c.i32)
    yield* c.let("value", i32(2), c.i32)
    yield* c.let("pointer", c.address(first), c.ptr(c.i32))
  })
  assert.match(emitC(program), /int32_t value = 1;\nint32_t value_2 = 2;\nint32_t\* pointer = &value;/)
})

test("C arrays denote exact readonly tuples and print checked scalar literals", () => {
  const type = c.array(c.i32, 2)
  const literal = c.literal(type, [1, -2147483648])
  assertType<Equal<lang.Denotes<typeof type>, readonly [I32, I32]>>()
  assertType<Equal<lang.Denotes<typeof literal>, readonly [I32, I32]>>()
  const union = c.array(c.i32, 1 as 1 | 2)
  assertType<Equal<lang.Denotes<typeof union>, readonly [I32] | readonly [I32, I32]>>()
  assertType<Equal<import("../languages/c.ts").Tuple<I32, number>, never>>()
  assertType<Equal<import("../languages/c.ts").Tuple<I32, 0 | -1 | 1.5>, never>>()
  const program = c.program(function*() {
    yield* c.let("values", literal, type)
    yield* c.let("letters", c.literal(c.array(c.char, 3), ["'", "\n", "\0"]), c.array(c.char, 3))
    yield* c.let("wide", c.literal(c.array(c.i64, 2), [-(1n << 63n), 9007199254740993n]), c.array(c.i64, 2))
    yield* c.fn("local", [], c.void, function*() {
      yield* c.let("values", literal, type)
    })
  })
  assert.equal(
    emitC(program),
    `#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

int32_t values[2] = {1, INT32_MIN};
char letters[3] = {'\\'', '\\n', '\\000'};
int64_t wide[2] = {INT64_MIN, INT64_C(9007199254740993)};
void local(void) {
  int32_t values_2[2] = {1, INT32_MIN};
}
`,
  )
  for (const length of [0, -1, 0.5, NaN, Infinity, 2 ** 53]) {
    assert.throws(() => c.array(c.i32, length as never), /positive safe integer/)
  }
  for (const element of [c.bool, c.void, c.ptr(c.i32), type]) {
    assert.throws(() => c.array(element as never, 2), /numeric or char/)
  }
  assert.throws(() => c.ptr(type as never), /pointer to array/)
  assert.throws(() => c.literal(type, [1] as never), /exactly the declared length/)
  assert.throws(() => c.literal(c.array(c.u8, 1), [256]), /cannot hold the literal/)
  assert.throws(() => c.literal(c.array(c.char, 1), ["é"]), /cannot hold the literal/)
  assert.throws(() => c.literal(c.array(c.i64, 1), [1] as never), /cannot hold the literal/)
})

test("C rejects each whole-array occurrence, even when a literal also initializes a binding", () => {
  const type = c.array(c.i32, 2)
  const literal = c.literal(type, [1, 2])
  for (const use of ["run", "return", "assign", "copy", "address", "ternary", "literal-return"] as const) {
    assert.throws(() =>
      c.program(function*() {
        const array = yield* c.let("values", literal, type)
        yield* c.fn("invalid", [], c.void, function*() {
          if (use === "run") yield* c.run(literal)
          if (use === "return") yield* (c.return(array) as lang.Stmt<C>)
          if (use === "literal-return") yield* (c.return(literal) as lang.Stmt<C>)
          if (use === "assign") yield* c.assign(array, literal)
          if (use === "copy") yield* c.let("copy", array, type)
          if (use === "address") yield* c.run(c.address(array))
          if (use === "ternary") yield* c.let("copy", c.ternary(c.true, literal, literal), type)
        })
      }), /array/)
  }
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("invalid", [], type, function*() {})
    }), /array function parameters and results/)
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("invalid", [c.param("values", type)], c.void, function*() {})
    }), /array function parameters/)
})

test("C indexing retains element lvalues and postfix precedence", () => {
  const program = c.program(function*() {
    const type = c.array(c.i32, 2)
    const array = yield* c.let("values", c.literal(type, [1, 2]), type)
    yield* c.fn("element", [], c.i32, function*() {
      const element = c.index(array, i32(0))
      assertType<Equal<lang.Denotes<typeof element>, I32>>()
      assertType<Equal<typeof element extends lang.Lvalue<C, I32> ? true : false, true>>()
      assert.ok(lang.isLvalue(element))
      const letters = yield* c.let("letters", c.literal(c.array(c.char, 1), ["a"]), c.array(c.char, 1))
      const letter = c.index(letters, i32(0))
      assertType<Equal<lang.Denotes<typeof letter>, import("../languages/c.ts").Char>>()
      yield* c.assign(letter, c.literal(c.char, "b"))
      yield* c.assign(c.index(array, c.literal(c.i8, 0)), i32(3))
      yield* c.assign(c.index(array, c.literal(c.i16, 0)), i32(3))
      yield* c.assign(c.index(array, i32(0)), i32(3))
      yield* c.assign(c.index(array, c.literal(c.u8, 0)), i32(3))
      yield* c.assign(c.index(array, c.literal(c.u16, 0)), i32(3))
      yield* c.assign(c.index(array, u32(0)), i32(3))
      yield* c.assign(c.index(array, c.literal(c.i64, 1n)), i32(4))
      yield* c.assign(c.index(array, c.literal(c.u64, 1n)), i32(4))
      const address = c.address(element)
      assertType<Equal<lang.Denotes<typeof address>, Ptr<I32>>>()
      const pointer = yield* c.let("pointer", address, c.ptr(c.i32))
      yield* c.assign(c.deref(pointer), c.add(element, i32(1)))
      yield* c.return(c.index(array, c.ternary(c.true, i32(0), i32(1))))
    })
  })
  const emitted = emitC(program)
  assert.match(emitted, /int32_t\* pointer = &values\[0\];/)
  assert.match(emitted, /\*pointer = values\[0\] \+ 1;/)
  assert.match(emitted, /values\[INT64_C\(1\)\] = 4;/)
  assert.match(emitted, /values\[UINT64_C\(1\)\] = 4;/)
  assert.match(emitted, /return values\[true \? 0 : 1\];/)
})

test("the C example swaps array elements through typed pointer arguments", () => {
  const emitted = spawnSync(process.execPath, ["examples/c.ts"], { encoding: "utf8" })
  assert.ifError(emitted.error)
  assert.equal(emitted.status, 0, emitted.stderr)
  assert.match(emitted.stdout, /int32_t values\[2\] = \{7, 3\};/)
  assert.match(emitted.stdout, /bool outOfOrder = values\[1\] < values\[0\];/)
  assert.match(emitted.stdout, /swap\(&values\[0\], &values\[1\]\);/)
  assert.match(emitted.stdout, /int32_t result = values\[0\] < values\[1\] \? 0 : 1;\n  calls = 0;\n  return result;/)
})

test("C indexing checks types and literal bounds but leaves expressions unchecked", () => {
  const literal = c.literal(c.array(c.i32, 2), [1, 2])
  for (const at of [i32(-1), i32(2), c.literal(c.i64, -1n), c.literal(c.i64, 2n), c.literal(c.u64, (1n << 64n) - 1n)]) {
    assert.throws(() => c.index(literal, at), /out of bounds/)
  }
  for (const at of [f64(0), c.true, c.literal(c.char, "a")]) {
    assert.throws(() => c.index(literal, at as never), /integer type/)
  }
  assert.throws(() => c.index(i32(0) as never, i32(0)), /array type/)
  assert.doesNotThrow(() => c.index(literal, c.add(i32(1), i32(1))))
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("invalid", [], c.i32, function*() {
        yield* c.return(c.index(literal, i32(0)))
      })
    }), /whole array use/)
  c.program(function*() {
    const type = c.array(c.i32, 2)
    const array = yield* c.let("values", literal, type)
    yield* c.fn("unchecked", [c.param("at", c.i32)], c.i32, function*(at) {
      yield* c.return(c.index(array, at))
    })
  })
})

test("C defer runs at every exit from its block, newest first, after the return value is copied", () => {
  const program = c.program(function*() {
    const trace = yield* c.let("trace", i32(0), c.i32)
    const run = yield* c.fn("run", [], c.i32, function*() {
      const result = yield* c.let("result", i32(40), c.i32)
      yield* c.defer(function*() {
        yield* c.assign(trace, i32(1))
      })
      yield* c.defer(function*() {
        yield* c.assign(trace, i32(2))
      })
      yield* c.defer(function*() {
        yield* c.assign(result, i32(0))
      })
      yield* c.return(result)
    })
    const early = yield* c.fn("early", [c.param("n", c.i32)], c.i32, function*(n) {
      yield* c.defer(function*() {
        yield* c.assign(trace, i32(5))
      })
      yield* c.if(c.less(n, i32(1)), function*() {
        yield* c.return(i32(7))
      })
      yield* c.defer(function*() {
        yield* c.assign(trace, i32(100))
      })
      yield* c.return(i32(8))
    })
    const fall = yield* c.fn("fall", [], c.void, function*() {
      yield* c.defer(function*() {
        yield* c.assign(trace, i32(9))
      })
      yield* c.assign(trace, i32(0))
    })
    yield* c.fn("main", [], c.i32, function*() {
      const a = yield* c.let("a", c.call(run), c.i32)
      const b = yield* c.let("b", c.call(early, i32(0)), c.i32)
      yield* c.if(c.less(trace, i32(5)), function*() {
        yield* c.return(i32(1))
      })
      yield* c.run(c.call(fall))
      yield* c.return(c.add(c.add(a, b), trace))
    })
  })
  const emitted = emitC(program)
  assert.match(emitted, /int32_t result_4 = result;\n  result = 0;\n  trace = 2;\n  trace = 1;\n  return result_4;/)
  assert.match(emitted, /if \(n < 1\) \{\n    int32_t result = 7;\n    trace = 5;\n    return result;\n  \}/)
  assert.match(emitted, /trace = 0;\n  trace = 9;\n\}/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, emitted)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 56, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C defer rejects a return or a defer inside its body", () => {
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("invalid", [], c.i32, function*() {
        yield* c.defer(function*() {
          yield* c.return(i32(0))
        })
        yield* c.return(i32(1))
      })
    }), /"return" cannot appear inside "defer"/)
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("invalid", [], c.void, function*() {
        yield* c.defer(function*() {
          yield* c.defer(function*() {})
        })
      })
    }), /"defer" cannot appear inside "defer"/)
})

test("C arena memory lives for its block, is released at every exit, and new returns null once it is full", () => {
  const program = c.program(function*() {
    const sumTo = yield* c.fn("sumTo", [c.param("n", c.i32)], c.i32, function*(n) {
      yield* c.arena("scratch", 64, function*(scratch) {
        yield* c.maybe(function*() {
          const total = yield* c.bind("total", c.new(scratch, i32(0)))
          assertType<Equal<lang.Denotes<typeof total>, Ptr<I32>>>()
          const i = yield* c.let("i", i32(0), c.i32)
          yield* c.while(c.less(i, n), function*() {
            yield* c.assign(c.deref(total), c.add(c.deref(total), i))
            yield* c.assign(i, c.add(i, i32(1)))
          })
          yield* c.return(c.deref(total))
        })
      })
      yield* c.return(i32(-1))
    })
    const exhausted = yield* c.fn("exhausted", [], c.i32, function*() {
      yield* c.arena("tiny", 4, function*(tiny) {
        yield* c.maybe(function*() {
          const first = yield* c.bind("first", c.new(tiny, i32(1)))
          const second = yield* c.bind("second", c.new(tiny, i32(1)))
          yield* c.return(c.add(c.deref(first), c.deref(second)))
        })
      })
      yield* c.return(i32(2))
    })
    yield* c.fn("main", [], c.i32, function*() {
      yield* c.return(c.add(c.call(sumTo, i32(5)), c.call(exhausted)))
    })
  })
  const emitted = emitC(program)
  assert.match(emitted, /#include <stdlib\.h>\n#include <string\.h>\n\ntypedef struct \{ uint8_t\* data; size_t size; size_t used; \} Arena;/)
  assert.match(
    emitted,
    /\{\n    Arena scratch_arena = arena_make\(64\);\n    Arena\* scratch = &scratch_arena;\n    \{\n      int32_t\* total = arena_new\(scratch, sizeof\(int32_t\), _Alignof\(int32_t\), &\(int32_t\)\{0\}\);/,
  )
  assert.match(emitted, /int32_t result = \*total;\n        arena_free\(scratch\);\n        return result;/)
  assert.match(emitted, /\n    \}\n    arena_free\(scratch\);\n  \}\n  return -1;/)
  assert.throws(() => c.arena("empty", 0, function*() {}), /arena size must be a positive safe integer/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, emitted)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 12, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("C new rejects values that cannot be allocated", () => {
  c.program(function*() {
    yield* c.fn("main", [], c.void, function*() {
      yield* c.arena("scratch", 8, function*(scratch) {
        const values = yield* c.let("values", c.literal(c.array(c.i32, 1), [1]), c.array(c.i32, 1))
        // @ts-expect-error an array cannot be allocated
        assert.throws(() => c.new(scratch, values), /new needs a scalar or pointer value/)
        // @ts-expect-error an allocator cannot be allocated
        assert.throws(() => c.new(scratch, scratch), /new needs a scalar or pointer value/)
        // @ts-expect-error new needs an allocator
        assert.throws(() => c.new(i32(1), i32(1)), /new needs an allocator/)
      })
    })
  })
})

test("C allocators pass through function arguments and nowhere else", () => {
  const program = c.program(function*() {
    const newCounter = yield* c.fn(
      "newCounter",
      [c.param("allocator", c.allocator), c.param("start", c.i32)],
      c.nullable(c.ptr(c.i32)),
      function*(allocator, start) {
        yield* c.return(c.new(allocator, start))
      },
    )
    yield* c.fn("main", [], c.i32, function*() {
      yield* c.arena("scratch", 16, function*(scratch) {
        yield* c.maybe(function*() {
          const counter = yield* c.bind("counter", c.call(newCounter, scratch, i32(41)))
          yield* c.return(c.add(c.deref(counter), i32(1)))
        })
      })
      yield* c.return(i32(0))
    })
  })
  const emitted = emitC(program)
  assert.match(
    emitted,
    /int32_t\* newCounter\(Arena\* allocator, int32_t start\) \{\n  return arena_new\(allocator, sizeof\(int32_t\), _Alignof\(int32_t\), &\(int32_t\)\{start\}\);\n\}/,
  )
  assert.match(emitted, /int32_t\* counter = newCounter\(scratch, 41\);/)
  const directory = mkdtempSync(join(tmpdir(), "ts-emit-c-"))
  try {
    const source = join(directory, "program.c")
    const executable = join(directory, "program")
    writeFileSync(source, emitted)
    const compiled = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", executable], { encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stderr)
    const executed = spawnSync(executable, [], { encoding: "utf8" })
    assert.ifError(executed.error)
    assert.equal(executed.status, 42, executed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }

  const rejected = (body: (scratch: lang.Ref<C, Allocator>) => Generator<lang.Stmt<C, lang.Facts, unknown>, void, unknown>) =>
    assert.throws(() =>
      c.program(function*() {
        yield* c.fn("main", [], c.void, function*() {
          yield* c.arena("scratch", 16, body)
        })
      }), /an allocator can only be passed as an argument/)
  rejected(function*(scratch) {
    yield* c.let("kept", scratch, c.allocator)
  })
  rejected(function*(scratch) {
    yield* c.run(scratch)
  })
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("leak", [c.param("allocator", c.allocator)], c.allocator, function*(allocator) {
        yield* c.return(allocator)
      })
    }), /an allocator can only be passed as an argument/)
  // @ts-expect-error a pointer to an allocator is not supported
  assert.throws(() => c.ptr(c.allocator), /an allocator can only be passed as an argument/)
})

test("C rejects arena and allocator pointers that escape their lifetime", () => {
  const nullable = c.nullable(c.ptr(c.i32))
  const escapes = (
    message: RegExp,
    body: (outer: lang.Ref<C, Ptr<I32> | null>, scratch: lang.Ref<C, Allocator>) => Generator<lang.Stmt<C, lang.Facts, unknown>, void, unknown>,
  ) =>
    assert.throws(() =>
      c.program(function*() {
        yield* c.fn("main", [], c.void, function*() {
          const outer = yield* c.let("outer", c.null(nullable), nullable)
          yield* c.arena("scratch", 16, (scratch) => body(outer, scratch))
        })
      }), message)
  const outlives = /a pointer from arena "scratch" cannot outlive it/
  escapes(outlives, function*(outer, scratch) {
    yield* c.assign(outer, c.new(scratch, i32(1)))
  })
  escapes(outlives, function*(outer, scratch) {
    const inner = yield* c.let("inner", c.new(scratch, i32(1)), nullable)
    yield* c.while(c.true, function*() {
      yield* c.assign(outer, inner)
    })
  })
  escapes(/a pointer from arena "scratch" cannot be stored through a pointer/, function*(outer, scratch) {
    const slot = yield* c.let("slot", c.address(outer), c.ptr(nullable))
    yield* c.assign(c.deref(slot), c.new(scratch, i32(1)))
  })
  assert.throws(() =>
    c.program(function*() {
      const kept = yield* c.let("kept", c.null(nullable), nullable)
      const newCounter = yield* c.fn("newCounter", [c.param("allocator", c.allocator)], nullable, function*(allocator) {
        yield* c.return(c.new(allocator, i32(0)))
      })
      yield* c.fn("main", [], c.void, function*() {
        yield* c.arena("scratch", 16, function*(scratch) {
          yield* c.assign(kept, c.call(newCounter, scratch))
        })
      })
    }), outlives)
  assert.throws(() =>
    c.program(function*() {
      yield* c.fn("leak", [], nullable, function*() {
        yield* c.arena("scratch", 16, function*(scratch) {
          yield* c.return(c.new(scratch, i32(1)))
        })
        yield* c.return(c.null(nullable))
      })
    }), outlives)
  assert.throws(() =>
    c.program(function*() {
      const kept = yield* c.let("kept", c.null(nullable), nullable)
      yield* c.fn("keep", [c.param("allocator", c.allocator)], c.void, function*(allocator) {
        yield* c.assign(kept, c.new(allocator, i32(0)))
      })
    }), /a pointer from allocator "allocator" can only be returned or kept in a local binding/)

  c.program(function*() {
    yield* c.fn("main", [], c.i32, function*() {
      yield* c.arena("scratch", 16, function*(scratch) {
        const inner = yield* c.let("inner", c.new(scratch, i32(1)), nullable)
        yield* c.maybe(function*() {
          const found = yield* c.bind("found", inner)
          yield* c.return(c.deref(found))
        })
      })
      yield* c.return(i32(0))
    })
  })
})
