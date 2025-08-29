const session = '2e612144-6719-4887-a391-1bfa41102101'
const baseURL = 'https://placeholdr.ai'

export const imageURL = (width: number, height: number) => `${baseURL}/${session}/${width}/${height}`
