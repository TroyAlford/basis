import { AwaitDocs } from './pages/Await.docs.tsx'
import { ButtonDocs } from './pages/Button.docs.tsx'
import { CarouselDocs } from './pages/Carousel.docs.tsx'
import { CheckboxEditorDocs } from './pages/CheckboxEditor.docs.tsx'
import { ComponentDocs } from './pages/Component.docs.tsx'
import { DropdownMenuDocs } from './pages/DropdownMenu.docs.tsx'
import { EditorDocs } from './pages/Editor.docs.tsx'
import { EnumEditorDocs } from './pages/EnumEditor.docs.tsx'
import { IconsDocs } from './pages/Icons.docs.tsx'
import { ImageDocs } from './pages/Image.docs.tsx'
import { MenuDocs } from './pages/Menu.docs.tsx'
import { MixinsDocs } from './pages/Mixins.docs.tsx'
import { MoonPhaseDocs } from './pages/MoonPhase.docs.tsx'
import { NumberEditorDocs } from './pages/NumberEditor.docs.tsx'
import { OptionGroupDocs } from './pages/OptionGroup.docs.tsx'
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
  component: React.ComponentType,
  /** Whether this is the default/home page */
  default?: boolean,
  /** Parent route for nested navigation */
  parent?: string,
  /** The path for the route */
  path: string,
  /** The title to display in navigation */
  title: string,
}

export const routes: DocRoute[] = [
  { component: AwaitDocs, path: '/components/await', title: 'Await' },
  { component: ButtonDocs, path: '/components/button', title: 'Button' },
  { component: CarouselDocs, path: '/components/carousel', title: 'Carousel' },
  { component: CheckboxEditorDocs, path: '/components/checkbox-editor', title: 'CheckboxEditor' },
  { component: ComponentDocs, path: '/components/component', title: 'Component' },
  { component: DropdownMenuDocs, path: '/components/dropdown-menu', title: 'DropdownMenu' },
  { component: EditorDocs, path: '/components/editor', title: 'Editor' },
  { component: EnumEditorDocs, path: '/components/enum-editor', title: 'EnumEditor' },
  { component: IconsDocs, path: '/icons', title: 'Icons' },
  { component: ImageDocs, path: '/components/image', title: 'Image' },
  { component: MenuDocs, path: '/components/menu', title: 'Menu' },
  { component: MixinsDocs, path: '/mixins', title: 'Mixins' },
  { component: MoonPhaseDocs, parent: '/icons', path: '/icons/MoonPhase', title: 'Icons/MoonPhase' },
  { component: NumberEditorDocs, path: '/components/number-editor', title: 'NumberEditor' },
  { component: OptionGroupDocs, path: '/components/option-group', title: 'OptionGroup' },
  { component: OverviewDocs, default: true, path: '/', title: 'Overview' },
  { component: RouterDocs, path: '/components/router', title: 'Router' },
  { component: TableDocs, path: '/components/table', title: 'Table' },
  { component: TagDocs, path: '/components/tag', title: 'Tag' },
  { component: TagsEditorDocs, path: '/components/tags-editor', title: 'TagsEditor' },
  { component: TextEditorDocs, path: '/components/text-editor', title: 'TextEditor' },
  { component: ThemeDocs, path: '/components/theme', title: 'Theme' },
  { component: ToggleEditorDocs, path: '/components/toggle-editor', title: 'ToggleEditor' },
  { component: TooltipDocs, path: '/components/tooltip', title: 'Tooltip' },
].sort((a, b) => {
  if (a.default) return -1
  if (b.default) return 1
  return a.title.localeCompare(b.title)
})

export const defaultRoute = routes.find(route => route.default) || routes[0]
