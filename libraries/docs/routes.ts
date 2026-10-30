import type { ComponentType } from 'react'
import ArchitectureDoc from '../../docs/architecture.mdx'
import BuildPluginsDoc from '../../docs/build-plugins.mdx'
import CiDoc from '../../docs/ci.mdx'
import CliDoc from '../../docs/cli.mdx'
import ComplianceDoc from '../../docs/compliance.mdx'
import ConfigurationDoc from '../../docs/configuration.mdx'
import ContributingDoc from '../../docs/contributing.mdx'
import EngineeringPrinciplesDoc from '../../docs/engineering-principles.mdx'
import EslintDoc from '../../docs/eslint.mdx'
import GuidesDoc from '../../docs/guides.mdx'
import HomeDoc from '../../docs/index.mdx'
import InstallationDoc from '../../docs/installation.mdx'
import LoggingDoc from '../../docs/logging.mdx'
import OAuthDoc from '../../docs/oauth.mdx'
import ReferenceDoc from '../../docs/reference.mdx'
import ReviewDoc from '../../docs/review.mdx'
import ServerDoc from '../../docs/server/index.mdx'
import TestingDoc from '../../docs/testing.md'
import TypeScriptDoc from '../../docs/typescript.mdx'
import UtilitiesDoc from '../../docs/utilities.mdx'
import WorkspacesDoc from '../../docs/workspaces.mdx'
import { AutoCompleteDocs } from './pages/AutoComplete.docs.tsx'
import { AwaitDocs } from './pages/Await.docs.tsx'
import { ButtonDocs } from './pages/Button.docs.tsx'
import { CarouselDocs } from './pages/Carousel.docs.tsx'
import { CheckboxEditorDocs } from './pages/CheckboxEditor.docs.tsx'
import { ComponentDocs } from './pages/Component.docs.tsx'
import { CssLintingDocs } from './pages/CssLinting.docs.tsx'
import { DialogDocs } from './pages/Dialog.docs.tsx'
import { DropdownMenuDocs } from './pages/DropdownMenu.docs.tsx'
import { EditorDocs } from './pages/Editor.docs.tsx'
import { EnumEditorDocs } from './pages/EnumEditor.docs.tsx'
import { IconsDocs } from './pages/Icons.docs.tsx'
import { ImageDocs } from './pages/Image.docs.tsx'
import { MarkdownLintingDocs } from './pages/MarkdownLinting.docs.tsx'
import { MenuDocs } from './pages/Menu.docs.tsx'
import { MermaidDocs } from './pages/Mermaid.docs.tsx'
import { MixinsDocs } from './pages/Mixins.docs.tsx'
import { NotificationDocs } from './pages/Notification.docs.tsx'
import { NumberEditorDocs } from './pages/NumberEditor.docs.tsx'
import { OptionGroupDocs } from './pages/OptionGroup.docs.tsx'
import { OverlayProviderDocs } from './pages/OverlayProvider.docs.tsx'
import { OverviewDocs } from './pages/Overview.docs.tsx'
import { RouterDocs } from './pages/Router.docs.tsx'
import { TableDocs } from './pages/Table.docs.tsx'
import { TagDocs } from './pages/Tag.docs.tsx'
import { TagsEditorDocs } from './pages/TagsEditor.docs.tsx'
import { TextEditorDocs } from './pages/TextEditor.docs.tsx'
import { ThemeDocs } from './pages/Theme.docs.tsx'
import { ToggleEditorDocs } from './pages/ToggleEditor.docs.tsx'
import { TooltipDocs } from './pages/Tooltip.docs.tsx'

export interface DocRoute {
  /** The component to render */
  component: ComponentType<unknown>,
  /** Whether this is the default/home page */
  default?: boolean,
  /** Whether the component is a Markdown/MDX article discovered by the docs build */
  markdown?: boolean,
  /** Parent route for nested navigation */
  parent?: string,
  /** The path for the route, or a stable key for a section heading */
  path: string,
  /** Render a non-clickable section heading */
  section?: boolean,
  /** The title to display in navigation */
  title: string,
}

/**
 * Avoids TS2589 when doc page classes extend {@link Editor} with deep generics.
 * @param route - Doc route with an untyped component reference.
 * @param route.component - Page component constructor.
 * @param route.default - When true, this route is the docs home.
 * @param route.markdown - Whether the docs build discovers this article.
 * @param route.parent - Optional parent path for nested nav.
 * @param route.path - URL path segment or stable section key.
 * @param route.section - Whether this entry is a section heading.
 * @param route.title - Sidebar / nav label.
 * @returns A {@link DocRoute} with the component cast for rendering.
 */
function docs(route: {
  component: unknown,
  default?: boolean,
  markdown?: boolean,
  parent?: string,
  path: string,
  section?: boolean,
  title: string,
}): DocRoute {
  return { ...route, component: route.component as ComponentType<unknown> }
}

/**
 * The documentation route inventory and navigation order.
 *
 * Section entries are headings, not links. The order is authoritative: the
 * live app and static build both feed this array to the shared navigation
 * builder, so neither output re-sorts the site.
 */
export const routes = [
  docs({
    component: HomeDoc,
    path: 'section:philosophy',
    section: true,
    title: 'Philosophy',
  }),
  docs({
    component: HomeDoc,
    default: true,
    markdown: true,
    parent: 'section:philosophy',
    path: '/',
    title: 'Why Basis',
  }),
  docs({
    component: EngineeringPrinciplesDoc,
    markdown: true,
    parent: 'section:philosophy',
    path: '/engineering-principles',
    title: 'Engineering Principles',
  }),
  docs({
    component: ArchitectureDoc,
    markdown: true,
    parent: 'section:philosophy',
    path: '/architecture',
    title: 'Architecture',
  }),

  docs({
    component: HomeDoc,
    path: 'section:getting-started',
    section: true,
    title: 'Getting Started',
  }),
  docs({
    component: InstallationDoc,
    markdown: true,
    parent: 'section:getting-started',
    path: '/installation',
    title: 'Installation',
  }),
  docs({
    component: GuidesDoc,
    markdown: true,
    parent: 'section:getting-started',
    path: '/guides',
    title: 'Guides',
  }),
  docs({
    component: ReferenceDoc,
    markdown: true,
    parent: 'section:getting-started',
    path: '/reference',
    title: 'Reference',
  }),

  docs({
    component: HomeDoc,
    path: 'section:server',
    section: true,
    title: 'Server & Core Libraries',
  }),
  docs({
    component: ServerDoc,
    markdown: true,
    parent: 'section:server',
    path: '/server',
    title: 'Server',
  }),
  docs({
    component: ConfigurationDoc,
    markdown: true,
    parent: 'section:server',
    path: '/configuration',
    title: 'Configuration',
  }),
  docs({
    component: LoggingDoc,
    markdown: true,
    parent: 'section:server',
    path: '/logging',
    title: 'Logging',
  }),
  docs({
    component: OAuthDoc,
    markdown: true,
    parent: 'section:server',
    path: '/oauth',
    title: 'OAuth',
  }),
  docs({
    component: UtilitiesDoc,
    markdown: true,
    parent: 'section:server',
    path: '/utilities',
    title: 'Utilities',
  }),

  docs({
    component: HomeDoc,
    path: 'section:react-foundations',
    section: true,
    title: 'React Foundations',
  }),
  docs({
    component: OverviewDocs,
    parent: 'section:react-foundations',
    path: '/react',
    title: 'React overview',
  }),
  docs({
    component: ComponentDocs,
    parent: 'section:react-foundations',
    path: '/components/component',
    title: 'Component',
  }),
  docs({
    component: EditorDocs,
    parent: 'section:react-foundations',
    path: '/components/editor',
    title: 'Editor',
  }),
  docs({
    component: IconsDocs,
    parent: 'section:react-foundations',
    path: '/icons',
    title: 'Icons',
  }),
  docs({
    component: MixinsDocs,
    parent: 'section:react-foundations',
    path: '/mixins',
    title: 'Mixins',
  }),
  docs({
    component: RouterDocs,
    parent: 'section:react-foundations',
    path: '/components/router',
    title: 'Router',
  }),
  docs({
    component: ThemeDocs,
    parent: 'section:react-foundations',
    path: '/components/theme',
    title: 'Theme',
  }),

  docs({
    component: HomeDoc,
    path: 'section:react-components',
    section: true,
    title: 'React Components',
  }),
  docs({
    component: AutoCompleteDocs,
    parent: 'section:react-components',
    path: '/components/auto-complete',
    title: 'AutoComplete',
  }),
  docs({
    component: AwaitDocs,
    parent: 'section:react-components',
    path: '/components/await',
    title: 'Await',
  }),
  docs({
    component: ButtonDocs,
    parent: 'section:react-components',
    path: '/components/button',
    title: 'Button',
  }),
  docs({
    component: CarouselDocs,
    parent: 'section:react-components',
    path: '/components/carousel',
    title: 'Carousel',
  }),
  docs({
    component: CheckboxEditorDocs,
    parent: 'section:react-components',
    path: '/components/checkbox-editor',
    title: 'CheckboxEditor',
  }),
  docs({
    component: DialogDocs,
    parent: 'section:react-components',
    path: '/components/dialog',
    title: 'Dialog',
  }),
  docs({
    component: DropdownMenuDocs,
    parent: 'section:react-components',
    path: '/components/dropdown-menu',
    title: 'DropdownMenu',
  }),
  docs({
    component: EnumEditorDocs,
    parent: 'section:react-components',
    path: '/components/enum-editor',
    title: 'EnumEditor',
  }),
  docs({
    component: ImageDocs,
    parent: 'section:react-components',
    path: '/components/image',
    title: 'Image',
  }),
  docs({
    component: MenuDocs,
    parent: 'section:react-components',
    path: '/components/menu',
    title: 'Menu',
  }),
  docs({
    component: MermaidDocs,
    parent: 'section:react-components',
    path: '/components/mermaid',
    title: 'Mermaid',
  }),
  docs({
    component: NotificationDocs,
    parent: 'section:react-components',
    path: '/components/notification',
    title: 'Notification',
  }),
  docs({
    component: NumberEditorDocs,
    parent: 'section:react-components',
    path: '/components/number-editor',
    title: 'NumberEditor',
  }),
  docs({
    component: OptionGroupDocs,
    parent: 'section:react-components',
    path: '/components/option-group',
    title: 'OptionGroup',
  }),
  docs({
    component: OverlayProviderDocs,
    parent: 'section:react-components',
    path: '/components/overlay-provider',
    title: 'OverlayProvider',
  }),
  docs({
    component: TableDocs,
    parent: 'section:react-components',
    path: '/components/table',
    title: 'Table',
  }),
  docs({
    component: TagDocs,
    parent: 'section:react-components',
    path: '/components/tag',
    title: 'Tag',
  }),
  docs({
    component: TagsEditorDocs,
    parent: 'section:react-components',
    path: '/components/tags-editor',
    title: 'TagsEditor',
  }),
  docs({
    component: TextEditorDocs,
    parent: 'section:react-components',
    path: '/components/text-editor',
    title: 'TextEditor',
  }),
  docs({
    component: ToggleEditorDocs,
    parent: 'section:react-components',
    path: '/components/toggle-editor',
    title: 'ToggleEditor',
  }),
  docs({
    component: TooltipDocs,
    parent: 'section:react-components',
    path: '/components/tooltip',
    title: 'Tooltip',
  }),

  docs({
    component: HomeDoc,
    path: 'section:developer-tooling',
    section: true,
    title: 'Development & Tooling',
  }),
  docs({
    component: CliDoc,
    markdown: true,
    parent: 'section:developer-tooling',
    path: '/cli',
    title: 'CLI',
  }),
  docs({
    component: EslintDoc,
    markdown: true,
    parent: 'section:developer-tooling',
    path: '/eslint',
    title: 'ESLint',
  }),
  docs({
    component: CssLintingDocs,
    parent: 'section:developer-tooling',
    path: '/css-linting',
    title: 'CSS Linting',
  }),
  docs({
    component: MarkdownLintingDocs,
    parent: 'section:developer-tooling',
    path: '/markdown-linting',
    title: 'Markdown Linting',
  }),
  docs({
    component: ComplianceDoc,
    markdown: true,
    parent: 'section:developer-tooling',
    path: '/compliance',
    title: 'Component Compliance',
  }),
  docs({
    component: TypeScriptDoc,
    markdown: true,
    parent: 'section:developer-tooling',
    path: '/typescript',
    title: 'TypeScript',
  }),
  docs({
    component: BuildPluginsDoc,
    markdown: true,
    parent: 'section:developer-tooling',
    path: '/build-plugins',
    title: 'Build Plugins & Serve',
  }),
  docs({
    component: TestingDoc,
    markdown: true,
    parent: 'section:developer-tooling',
    path: '/testing',
    title: 'Testing & Visual Snapshots',
  }),
  docs({
    component: ReviewDoc,
    markdown: true,
    parent: 'section:developer-tooling',
    path: '/review',
    title: 'Code Review',
  }),
  docs({
    component: WorkspacesDoc,
    markdown: true,
    parent: 'section:developer-tooling',
    path: '/workspaces',
    title: 'Workspaces',
  }),

  docs({
    component: CiDoc,
    markdown: true,
    parent: 'section:developer-tooling',
    path: '/ci',
    title: 'Portable CI contract',
  }),
  docs({
    component: ContributingDoc,
    markdown: true,
    parent: 'section:developer-tooling',
    path: '/contributing',
    title: 'Contributing',
  }),
] satisfies DocRoute[]

export const defaultRoute = routes.find(route => route.default) || routes[0]
