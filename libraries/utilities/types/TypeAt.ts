import type { PathOf, Primitive } from './PathOf'

// The “split string by dot” type. E.g. "a.b.c" → ["a","b","c"]
type SplitPath<S extends string> =
  S extends `${infer Head}.${infer Rest}` ? [Head, ...SplitPath<Rest>] : S extends '' ? [] : [S]

// TypeAt: get the type at path P in T
export type TypeAt<T, P extends string> =
  // First ensure P is a valid PathOf<T> to help get good errors
  P extends PathOf<T> ? TypeAtInternal<T, SplitPath<P>> : never

// Internal recursive walking
type TypeAtInternal<T, Parts extends string[]> =
  // **Add a guard: if T is a Primitive, stop here**
  T extends Primitive
    ? T : Parts extends [infer Head, ...infer Rest]
      ? Head extends string
        ? Rest extends string[]
          ? T extends (infer U)[]
            ? Head extends `${number}`
              // array element, go into U
              ? TypeAtInternal<U, Rest>
              : never
            : Head extends keyof T
              ? TypeAtInternal<T[Head], Rest>
              : never
          : never
        : never
      : T
