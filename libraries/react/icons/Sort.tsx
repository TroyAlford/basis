import * as React from 'react'
import { SortBy } from '../types/SortBy'
import { SortDirection } from '../types/SortDirection'
import type { IconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'
import { SortByNameAsc } from './SortByNameAsc'
import { SortByNameDesc } from './SortByNameDesc'
import { SortBySizeAsc } from './SortBySizeAsc'
import { SortBySizeDesc } from './SortBySizeDesc'
import { SortByValueAsc } from './SortByValueAsc'
import { SortByValueDesc } from './SortByValueDesc'
import { SortNone } from './SortNone'

interface Props extends IconProps {
  direction?: SortDirection,
  sortBy?: SortBy,
}

export class Sort extends IconBase<Props> {
  static By = SortBy
  static Direction = SortDirection

  static defaultProps = {
    ...IconBase.defaultProps,
    direction: SortDirection.Asc,
    sortBy: SortBy.Name,
  }

  static None = SortNone

  renderContent = (): React.ReactNode => null
  render = (): React.ReactNode => {
    const { direction, sortBy, ...rest } = this.props

    let Component
    if (!sortBy || sortBy === SortBy.None) {
      Component = SortNone
    } else if (sortBy === SortBy.Name) {
      Component = direction === SortDirection.Asc ? SortByNameAsc : SortByNameDesc
    } else if (sortBy === SortBy.Size) {
      Component = direction === SortDirection.Asc ? SortBySizeAsc : SortBySizeDesc
    } else if (sortBy === SortBy.Value) {
      Component = direction === SortDirection.Asc ? SortByValueAsc : SortByValueDesc
    }

    return Component ? <Component {...rest} /> : null
  }
}
