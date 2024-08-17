import { isNil } from './isNil'

type ClassName = (
	| string
	| Set<string>
	| Map<string, boolean | (() => boolean)>
	| Record<string, boolean | (() => boolean)>
)

const reducer = (
  classes: string[],
  [key, value]: [string, boolean | (() => boolean)],
): string[] => {
  if (typeof value === 'function' ? value() : !!value) classes.push(key)
  return classes
}

export function classNames(...values: ClassName[]): string {
  const classes = new Set<string>(
    values.flatMap(declaration => {
      switch (true) {
        case (isNil(declaration)):
          return []
        case (typeof declaration === 'string'):
          return declaration.trim().split(/\s+/g)
        case (declaration instanceof Set):
          return classNames(...declaration)
        case (declaration instanceof Map):
          return classNames(...Array.from(declaration.entries()).reduce(reducer, []))
        case (typeof declaration === 'object'):
          return classNames(...Object.entries(declaration).reduce(reducer, []))
        default:
          return []
      }
    }),
  )
  return Array.from(classes).filter(Boolean).join(' ')
}
