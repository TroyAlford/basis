/* eslint-disable @stylistic/ts/indent, @typescript-eslint/no-unsafe-function-type */
export type Primitive =
  | bigint
  | boolean
  | Date
  | Function
  | null
  | number
  | string
  | symbol
  | undefined

export type PathOf<T> = T extends Primitive
  ? never
  // array / tuple case
  : T extends (infer U)[]
    // You can index by number (as string) into array elements
    ? `${number}` | `${number}.${PathOf<U>}`
    : {
      [K in keyof T & string]:
      // leaf primitive
      T[K] extends Primitive
        ? K
        // array in property
        : T[K] extends (infer U)[]
          /*
           * K alone (property holding the array),
           * or K + numeric index into it, or nested within that
           */
          ? K | `${K}.${number}` | `${K}.${number}.${PathOf<U>}`
          // nested object
          : T[K] extends object
            ? K | `${K}.${PathOf<T[K]>}`
            : K
    }[keyof T & string]
