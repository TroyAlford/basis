import * as React from 'react'
import type { IconProps } from '../IconBase/IconBase'
import { IconBase } from '../IconBase/IconBase'
import { SortByNameAsc } from './SortByNameAsc'
import { SortByNameDesc } from './SortByNameDesc'
import { SortBySizeAsc } from './SortBySizeAsc'
import { SortBySizeDesc } from './SortBySizeDesc'
import { SortByValueAsc } from './SortByValueAsc'
import { SortByValueDesc } from './SortByValueDesc'
import { SortNone } from './SortNone'

enum By {
  Name = 'name',
  None = 'none',
  Size = 'size',
  Value = 'value',
}
enum Direction {
  Asc = 'asc',
  Desc = 'desc',
}

interface Props extends IconProps {
  direction?: Direction,
  sortBy?: By,
}

export class Sort extends IconBase<Props> {
  static By = By
  static Direction = Direction

  static defaultProps = {
    ...IconBase.defaultProps,
    direction: Direction.Asc,
    sortBy: By.Name,
  }

  static None = SortNone

  renderContent = (): React.ReactNode => null
  render = (): React.ReactNode => {
    const { direction, sortBy, ...rest } = this.props

    let Component
    if (!sortBy || sortBy === By.None) {
      Component = SortNone
    } else if (sortBy === By.Name) {
      Component = direction === Direction.Asc ? SortByNameAsc : SortByNameDesc
    } else if (sortBy === By.Size) {
      Component = direction === Direction.Asc ? SortBySizeAsc : SortBySizeDesc
    } else if (sortBy === By.Value) {
      Component = direction === Direction.Asc ? SortByValueAsc : SortByValueDesc
    }

    return Component ? <Component {...rest} /> : null
  }
}
