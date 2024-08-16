
(() => {
	if (typeof window === 'undefined') return

	const apply = (target, thisArg, args) => {
		target.apply(thisArg, args)
		window.dispatchEvent(new CustomEvent('history'))
	}

	window.history.pushState = new Proxy(window.history.pushState, { apply })
	window.history.replaceState = new Proxy(window.history.replaceState, { apply })

	window.addEventListener('popstate', () => {
		window.dispatchEvent(new CustomEvent('history'))
	})
})()
