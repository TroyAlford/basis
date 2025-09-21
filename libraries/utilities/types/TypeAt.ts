import type { PathOf } from './PathOf'

// The “split string by dot” type. E.g. "a.b.c" → ["a","b","c"]
type SplitPath<S extends string> =
  S extends `${infer Head}.${infer Rest}` ? [Head, ...SplitPath<Rest>] : S extends '' ? [] : [S]

// TypeAt: get the type at path P in T
export type TypeAt<T, P extends string> =
  // First ensure P is a valid PathOf<T> to help get good errors
  P extends PathOf<T> ? TypeAtInternal<T, SplitPath<P>> : never

// Internal recursive walking
type TypeAtInternal<T, Parts extends string[]> =
  Parts extends [infer Head, ...infer Rest]
    ? Head extends string
      ? Rest extends string[]
        // If T is an array/tuple and the head is a numeric index, dive into the element type
        ? T extends (infer U)[]
          ? Head extends `${number}`
            ? TypeAtInternal<U, Rest>
            : never
          // Otherwise, treat Head as an object key
          : Head extends keyof T
            ? TypeAtInternal<T[Head], Rest>
            : never
        : never
      : never
    : T
