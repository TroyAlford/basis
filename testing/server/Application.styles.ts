import { css, style } from 'basis/react'

style('basis:fixture', css`
  .basis-fixture {
    color: var(--basis-color-primary);
  }
`)

style('basis:fixture-unsafe', css`
  .basis-fixture-unsafe::after {
    content: '</style><script>not markup</script>';
  }
`)
