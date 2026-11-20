const result = document.querySelector('#result')
if (result) result.textContent = (globalThis as Record<string, unknown>).vendorLoaded ? 'loaded' : 'missing'
