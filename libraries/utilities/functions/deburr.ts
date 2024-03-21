export const deburr = (input: string): string => (
	input
		.normalize('NFD') // decompose diacriticals into separate characters
		.replace(/[\u0300-\u036f]/g, '') // remove all diacritical characters
)