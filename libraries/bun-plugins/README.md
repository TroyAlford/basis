# @basis/bun-plugins

Internal Bun build/development plugins for Basis. This workspace is not a supported consumer package and is not installed from npm or JSR; applications configure the supported `basis/serve` facade.

The authoritative reference is the documentation site's [Build Plugins & Serve page](../../docs/build-plugins.mdx). This README is an internal maintainer front door.

The plugins cover SASS/SCSS compilation, global variable injection, Markdown/MDX compilation with front-matter stripping and Mermaid fence conversion, and development React refresh registration. They are composed by `libraries/bun-plugins/serve.ts` and exposed to consumers through `basis/serve`.

Internal code imports this workspace package-relatively. Do not add a consumer installation path or a second plugin entrypoint here.
