import type { BunPlugin } from 'bun'

/** Base build configuration */
export interface BaseBuildConfig {
  /** Entry points for the build */
  entrypoints: string[],
  /** External dependencies */
  external: string[],
  /** Minification options */
  minify: {
    /** Whether to mangle identifiers */
    identifiers: boolean,
    /** Whether to simplify syntax */
    syntax: boolean,
    /** Whether to remove whitespace */
    whitespace: boolean,
  },
  /** Output directory */
  outdir: string,
  /** Source map generation */
  sourcemap: 'external' | 'inline' | boolean,
}

/** Browser-specific build configuration */
export interface BrowserBuildConfig extends BaseBuildConfig {
  /** Environment variable definitions */
  define: Record<string, string>,
  /** Build plugins */
  plugins: BunPlugin[],
  /** Build target */
  target: 'browser',
}

/** Bun-specific build configuration */
export interface BunBuildConfig extends BaseBuildConfig {
  /** Build target */
  target: 'bun',
}

/** Combined build configuration */
export type BuildConfig = BrowserBuildConfig | BunBuildConfig
