/** AST node type names used by the local linter rules. */
export const AST_NODE_TYPES = {
  Identifier: 'Identifier',
  Literal: 'Literal',
  TSEnumDeclaration: 'TSEnumDeclaration',
  TSEnumMember: 'TSEnumMember',
  TSIndexSignature: 'TSIndexSignature',
  TSInterfaceDeclaration: 'TSInterfaceDeclaration',
  TSMethodSignature: 'TSMethodSignature',
  TSPropertySignature: 'TSPropertySignature',
  TSTypeLiteral: 'TSTypeLiteral',
} as const

/** AST token type names used by the local linter rules. */
export const AST_TOKEN_TYPES = {
  Punctuator: 'Punctuator',
} as const

/** A source position. */
export interface Position {
  /** Zero-based column. */
  column: number,
  /** One-based line. */
  line: number,
}

/** A source location. */
export interface SourceLocation {
  /** End position. */
  end: Position,
  /** Start position. */
  start: Position,
}

/** A source range. */
export type Range = [number, number]

/** The base ESTree node shape. */
export interface Node {
  /** Optional computed property marker. */
  computed?: boolean,
  /** Optional enum member id. */
  id?: Node,
  /** Optional initializer. */
  initializer?: Node,
  /** Optional property key. */
  key?: Node,
  /** Source location. */
  loc: SourceLocation,
  /** Optional index-signature parameters. */
  parameters?: Node[],
  /** Source range. */
  range: Range,
  /** Node type. */
  type: string,
  /** Optional literal value. */
  value?: unknown,
}

/** An identifier. */
export interface Identifier extends Node {
  /** Identifier name. */
  name: string,
  /** Identifier type. */
  type: 'Identifier',
}

/** A literal. */
export interface Literal extends Node {
  /** Literal type. */
  type: 'Literal',
  /** Literal value. */
  value: unknown,
}

/** A comment. */
export interface Comment extends Node {
  /** Comment text. */
  value: string,
}

/** A token. */
export interface Token extends Node {
  /** Token text. */
  value: string,
}

/** A member of an interface, type literal, or enum. */
export interface Member extends Node {
  /** Whether the member is computed. */
  computed?: boolean,
  /** Enum member id. */
  id?: Node,
  /** Member initializer. */
  initializer?: Node,
  /** Member key. */
  key?: Node,
  /** Index-signature parameters. */
  parameters?: Identifier[],
}

/** A TypeScript interface declaration. */
export interface TSInterfaceDeclaration extends Node {
  /** Interface body. */
  body: { body: Member[] },
  /** Interface type. */
  type: 'TSInterfaceDeclaration',
}

/** A TypeScript type literal. */
export interface TSTypeLiteral extends Node {
  /** Type members. */
  members: Member[],
  /** Type literal type. */
  type: 'TSTypeLiteral',
}

/** A TypeScript enum declaration. */
export interface TSEnumDeclaration extends Node {
  /** Enum body. */
  body: { members: Member[] },
  /** Enum type. */
  type: 'TSEnumDeclaration',
}

/** A TypeScript enum member. */
export interface TSEnumMember extends Member {
  /** Enum member type. */
  type: 'TSEnumMember',
}

/** A TypeScript property signature. */
export interface TSPropertySignature extends Member {
  /** Property type. */
  type: 'TSPropertySignature',
}

/** A TypeScript method signature. */
export interface TSMethodSignature extends Member {
  /** Method type. */
  type: 'TSMethodSignature',
}

/** A TypeScript index signature. */
export interface TSIndexSignature extends Member {
  /** Index parameters. */
  parameters: Identifier[],
  /** Index signature type. */
  type: 'TSIndexSignature',
}

/** An import specifier. */
export interface ImportSpecifier extends Node {
  /** Type or value import. */
  importKind?: string,
  /** Imported name. */
  imported: Identifier | Literal,
}

/** An import declaration. */
export interface ImportDeclaration extends Node {
  /** Module specifier. */
  source: { value: string },
  /** Imported specifiers. */
  specifiers: ImportSpecifier[],
  /** Declaration type. */
  type: 'ImportDeclaration',
}

/** A JSX attribute. */
export interface JSXAttribute extends Node {
  /** Attribute name. */
  name: Node,
  /** Attribute type. */
  type: 'JSXAttribute',
  /** Attribute value. */
  value: Node | null,
}

/** A spread JSX attribute. */
export interface JSXSpreadAttribute extends Node {
  /** Spread type. */
  type: 'JSXSpreadAttribute',
}

/** A JSX opening element. */
export interface JSXOpeningElement extends Node {
  /** Element attributes. */
  attributes: (JSXAttribute | JSXSpreadAttribute)[],
  /** Element name. */
  name: Node,
  /** Whether the element self-closes. */
  selfClosing: boolean,
  /** Opening element type. */
  type: 'JSXOpeningElement',
}

/** A JSX child. */
export interface JSXChild extends Node {
  /** Element children. */
  children?: JSXChild[],
  /** Closing element. */
  closingElement?: JSXOpeningElement | null,
  /** Closing fragment. */
  closingFragment?: Node,
  /** Expression container expression. */
  expression?: Node,
  /** Opening element. */
  openingElement?: JSXOpeningElement,
  /** Opening fragment. */
  openingFragment?: Node,
}

/** A JSX element. */
export interface JSXElement extends JSXChild {
  /** Element children. */
  children: JSXChild[],
  /** Closing element. */
  closingElement: JSXOpeningElement | null,
  /** Opening element. */
  openingElement: JSXOpeningElement,
  /** Element type. */
  type: 'JSXElement',
}

/** A JSX fragment. */
export interface JSXFragment extends JSXChild {
  /** Fragment children. */
  children: JSXChild[],
  /** Closing fragment. */
  closingFragment: Node,
  /** Opening fragment. */
  openingFragment: Node,
  /** Fragment type. */
  type: 'JSXFragment',
}
