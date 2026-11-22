const element = document.querySelector<HTMLElement>('[data-testid="basic"]')
if (!element) throw new Error('missing basic element')
element.textContent = 'native-ts-ok'
element.addEventListener('click', () => {
  element.dataset.clicked = 'yes'
})
