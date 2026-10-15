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

C supports fixed-width integers, double, bool, pointers, bindings, arithmetic, comparisons, ternaries, conditions, loops, functions, and calls. Conditions accept only bool. It does not prove memory safety or total return coverage. New constructs should name their data shape and add source and runtime checks before expanding shared abstractions.
