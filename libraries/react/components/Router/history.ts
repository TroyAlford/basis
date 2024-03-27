(() => {
	if (typeof window === 'undefined') return

	window.history.replaceState = new Proxy(window.history.replaceState, {
		apply: (target, thisArg, args) => {
			target.apply(thisArg, args)
			window.dispatchEvent(new Event('history'))
		},
	})
	window.history.pushState = new Proxy(window.history.pushState, {
		apply: (target, thisArg, args) => {
			target.apply(thisArg, args)
			window.dispatchEvent(new Event('history'))
		},
	})
})()