import * as fs from 'fs'
import * as path from 'path'

/**
 * Add .js extensions to import statements that don't have them.
 * @param dir - The directory to search for files.
 */
function addJsExtensions(dir: string): void {
  const files = fs.readdirSync(dir)

  files.forEach(file => {
    const fullPath = path.join(dir, file)
    const stat = fs.lstatSync(fullPath)

    if (stat.isDirectory()) {
      addJsExtensions(fullPath)
    } else if (file.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8')

      content = content.replace(/(import\s+.*?from\s+['"])(\.\/.*?)(['"])/g, (_, p1, p2, p3) => {
        const importPath = path.resolve(dir, p2)
        let resolvedPath = p2

        if (fs.existsSync(importPath) && fs.lstatSync(importPath).isDirectory()) {
          const indexPath = path.join(importPath, 'index.js')
          if (fs.existsSync(indexPath)) {
            resolvedPath = `${p2}/index.js`
          }
        } else if (!p2.endsWith('.js')) {
          resolvedPath = `${p2}.js`
        }

        return `${p1}${resolvedPath}${p3}`
      })

      fs.writeFileSync(fullPath, content, 'utf8')
    }
  })
}

const distDir = path.join(__dirname, '../dist')
addJsExtensions(distDir)
