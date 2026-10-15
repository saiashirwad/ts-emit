# ts-emit

TypeScript builders emit C, Prolog, and Lua.

## Core

`src` supports the C builder. Nodes carry their language, denotation, and the kinds needed by a target. Statements are iterable so `yield*` can return a reference to a declared binding. Blocks collect statements. Binding identities keep references separate from emitted names.

`Structure` describes children, declarations, and references. Program construction rejects references outside their scope and duplicate binding identities. Targets assign valid, nonconflicting names and print nodes with precedence-aware fragments.

Rules are type lambdas applied with `Kind`. C provides assignment, condition, addition, and comparison rules. Only an exact `true` accepts a check. Function types retain parameter and return types at runtime for calls.

There is no TypeScript target, static evidence model, symbolic type evaluator, or branch refinement machinery. Prolog and Lua use their own domain structures and do not depend on C's core.

## Checks

`pnpm verify` runs typechecking, paired C type controls, tests, lint, and formatting. Runtime tests compile and execute C and run Prolog and Lua programs. Keep new tests with the language they exercise.

## Scope

C supports fixed-width integers, double, bool, ASCII char, fixed-length numeric and char arrays, pointers, bindings, arithmetic, comparisons, ternaries, conditions, loops, functions, and calls. `I8`, `I16`, `I32`, `U8`, `U16`, `U32`, and `F64` are branded numbers. `I64` and `U64` are branded bigints, and their literals take bigint input. `Char` is a branded string with one ASCII character per literal. `Ptr<T>` carries a pointer brand and its pointee type, and is never null. `c.nullable(type)` denotes `Ptr<T> | null`, which also holds `c.null` and cannot be dereferenced. `c.unwrap(binding, name, body)` runs the body only when the binding is not null, with a scoped `Ptr<T>` binding; only a binding can be unwrapped, so its value is read once. `c.defer(body)` is block-scoped like Odin: its body runs in reverse order at every exit from the enclosing block, once execution has reached it. A `return` first copies its value into a temporary, then runs the deferred bodies, then returns. A `return` or `defer` inside a deferred body is rejected. Bool denotes plain `boolean`, and conditions accept only bool.

`c.array(element, length)` denotes a readonly `Tuple<T, N>`. Lengths are positive integer literals, checked as safe integers at runtime. Array literals take exact-length tuples of raw scalar inputs and are only allowed as direct binding initializers. `c.index(array, at)` returns an element lvalue and accepts any integer type for the index. Literal indices are checked against the array length at construction, including bigint indices; other expressions are unchecked. Nonliteral whole-array expressions are allowed only as indexing targets. Whole-array assignment and other uses, array function parameters and results, and pointers to arrays are rejected.

C has no implicit conversions or promotions, except that a `Ptr<T>` converts to `Ptr<T> | null`. Otherwise assignment, call arguments, and returns require equal denotations. Numeric `add` and `less` require equal numeric types. Addition retains that type, including for integers narrower than 32 bits. Pointers have no arithmetic; `c.index` reaches array elements.

`c.cast(c.i32, value)` explicitly converts between numeric types only. Casts have no runtime range checks. Out-of-range floating-to-integer casts have undefined behavior. Signed integer narrowing is implementation-defined. Unsigned integer narrowing wraps. These remain unchecked, like arithmetic overflow.

C does not prove memory safety or total return coverage. New constructs should name their data shape and add source and runtime checks before expanding shared abstractions.
