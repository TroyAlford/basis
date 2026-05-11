import type { ComponentType } from 'react'
import { AutoCompleteDocs } from './pages/AutoComplete.docs.tsx'
import { AwaitDocs } from './pages/Await.docs.tsx'
import { ButtonDocs } from './pages/Button.docs.tsx'
import { CarouselDocs } from './pages/Carousel.docs.tsx'
import { CheckboxEditorDocs } from './pages/CheckboxEditor.docs.tsx'
import { ComponentDocs } from './pages/Component.docs.tsx'
import { DialogDocs } from './pages/Dialog.docs.tsx'
import { DropdownMenuDocs } from './pages/DropdownMenu.docs.tsx'
import { EditorDocs } from './pages/Editor.docs.tsx'
import { EnumEditorDocs } from './pages/EnumEditor.docs.tsx'
import { IconsDocs } from './pages/Icons.docs.tsx'
import { ImageDocs } from './pages/Image.docs.tsx'
import { MenuDocs } from './pages/Menu.docs.tsx'
import { MixinsDocs } from './pages/Mixins.docs.tsx'
import { MoonPhaseDocs } from './pages/MoonPhase.docs.tsx'
import { NotificationDocs } from './pages/Notification.docs.tsx'
import { NumberEditorDocs } from './pages/NumberEditor.docs.tsx'
import { OptionGroupDocs } from './pages/OptionGroup.docs.tsx'
import { OverlayProviderDocs } from './pages/OverlayProvider.docs.tsx'
import { OverviewDocs } from './pages/Overview.docs.tsx'
import { RouterDocs } from './pages/Router.docs.tsx'
import { RouterGuardDocs } from './pages/RouterGuardDocs.docs.tsx'
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
  /** Parent route for nested navigation */
  parent?: string,
  /** The path for the route */
  path: string,
  /** The title to display in navigation */
  title: string,
}

/**
 * Avoids TS2589 when doc page classes extend {@link Editor} with deep generics.
 * @param route - Doc route with an untyped component reference.
 * @param route.component - Page component constructor.
 * @param route.default - When true, this route is the docs home.
 * @param route.parent - Optional parent path for nested nav.
 * @param route.path - URL path segment.
 * @param route.title - Sidebar / nav label.
 * @returns A {@link DocRoute} with the component cast for rendering.
 */
function docs(route: {
  component: unknown,
  default?: boolean,
  parent?: string,
  path: string,
  title: string,
}): DocRoute {
  return { ...route, component: route.component as ComponentType<unknown> }
}

export const routes = ([
  docs({ component: AutoCompleteDocs, path: '/components/auto-complete', title: 'AutoComplete' }),
  docs({ component: AwaitDocs, path: '/components/await', title: 'Await' }),
  docs({ component: ButtonDocs, path: '/components/button', title: 'Button' }),
  docs({ component: CarouselDocs, path: '/components/carousel', title: 'Carousel' }),
  docs({ component: CheckboxEditorDocs, path: '/components/checkbox-editor', title: 'CheckboxEditor' }),
  docs({ component: ComponentDocs, path: '/components/component', title: 'Component' }),
  docs({ component: DialogDocs, path: '/components/dialog', title: 'Dialog' }),
  docs({ component: DropdownMenuDocs, path: '/components/dropdown-menu', title: 'DropdownMenu' }),
  docs({ component: EditorDocs, path: '/components/editor', title: 'Editor' }),
  docs({ component: EnumEditorDocs, path: '/components/enum-editor', title: 'EnumEditor' }),
  docs({ component: IconsDocs, path: '/icons', title: 'Icons' }),
  docs({ component: ImageDocs, path: '/components/image', title: 'Image' }),
  docs({ component: MenuDocs, path: '/components/menu', title: 'Menu' }),
  docs({ component: MixinsDocs, path: '/mixins', title: 'Mixins' }),
  docs({ component: MoonPhaseDocs, parent: '/icons', path: '/icons/MoonPhase', title: 'Icons/MoonPhase' }),
  docs({ component: NumberEditorDocs, path: '/components/number-editor', title: 'NumberEditor' }),
  docs({ component: NotificationDocs, path: '/components/notification', title: 'Notification' }),
  docs({ component: OptionGroupDocs, path: '/components/option-group', title: 'OptionGroup' }),
  docs({ component: OverlayProviderDocs, path: '/components/overlay-provider', title: 'OverlayProvider' }),
  docs({ component: OverviewDocs, default: true, path: '/', title: 'Overview' }),
  docs({ component: RouterDocs, path: '/components/router', title: 'Router' }),
  docs({
    component: RouterGuardDocs,
    parent: '/components/router',
    path: '/components/router/guard-demo',
    title: 'Router/Guard Demo',
  }),
  docs({ component: TableDocs, path: '/components/table', title: 'Table' }),
  docs({ component: TagDocs, path: '/components/tag', title: 'Tag' }),
  docs({ component: TagsEditorDocs, path: '/components/tags-editor', title: 'TagsEditor' }),
  docs({ component: TextEditorDocs, path: '/components/text-editor', title: 'TextEditor' }),
  docs({ component: ThemeDocs, path: '/components/theme', title: 'Theme' }),
  docs({ component: ToggleEditorDocs, path: '/components/toggle-editor', title: 'ToggleEditor' }),
  docs({ component: TooltipDocs, path: '/components/tooltip', title: 'Tooltip' }),
]).sort((a, b) => {
  if (a.default) return -1
  if (b.default) return 1
  return a.title.localeCompare(b.title)
})

export const defaultRoute = routes.find(route => route.default) || routes[0]
