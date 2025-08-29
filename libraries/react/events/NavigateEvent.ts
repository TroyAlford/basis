export class NavigateEvent extends CustomEvent<{ url: string }> {
  static name = 'basis:router:navigate'

  constructor(url: string) {
    super(NavigateEvent.name, { bubbles: true, detail: { url } })
  }
}
