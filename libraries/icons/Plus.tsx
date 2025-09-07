import * as React from 'react'
import { IconBase } from './IconBase/IconBase'

export class Plus extends IconBase {
  static displayName = 'PlusIcon'
  renderContent = (): React.ReactNode => (
    <path d="M75 -18.75H18.75V-75C18.75 -81.9023 13.1523 -87.5 6.25 -87.5H-6.25C-13.1523 -87.5 -18.75 -81.9023 -18.75 -75V-18.75H-75C-81.9023 -18.75 -87.5 -13.1523 -87.5 -6.25V6.25C-87.5 13.1523 -81.9023 18.75 -75 18.75H-18.75V75C-18.75 81.9023 -13.1523 87.5 -6.25 87.5H6.25C13.1523 87.5 18.75 81.9023 18.75 75V18.75H75C81.9023 18.75 87.5 13.1523 87.5 6.25V-6.25C87.5 -13.1523 81.9023 -18.75 75 -18.75Z" />
  )
}
