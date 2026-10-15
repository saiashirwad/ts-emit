export interface TypeLambda {
  readonly Args: readonly unknown[]
  readonly type: unknown
}

export type Kind<F extends TypeLambda, Args extends readonly unknown[]> = (F & { readonly Args: Args })["type"]

export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

export type Accepts<Output> =
    [Output] extends [never] ? false
  : [Output] extends [true] ? true
  : false

export type Check<Ok, Message extends string, Details = unknown> = Accepts<Ok> extends true ? unknown : Rejected<Message, Details>

export type Rejected<Message extends string, Details = unknown> = { readonly error: Message } & Details
