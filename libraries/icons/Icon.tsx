import * as React from 'react'
import { pascalCase } from '@basis/utilities'
import type { IconProps as BaseIconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'
import * as Icons from './index'

interface IconProps extends BaseIconProps {
  named: string,
}
export class Icon extends IconBase<IconProps> {
  renderContent = (): React.ReactNode => null
  render = (): React.ReactNode => {
    const { named, ...iconProps } = this.props
    const name = Object.keys(Icons).find(key => (
      key.toLowerCase() === pascalCase(named ?? '').toLowerCase()
    ))

    const NamedIcon = typeof Icons[name] === 'function' ? Icons[name] : Icons.Blank
    return <NamedIcon {...iconProps} />
  }
}
