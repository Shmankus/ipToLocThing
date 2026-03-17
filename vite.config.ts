import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function devLogsPlugin(): Plugin {
  const logsDir = path.resolve(__dirname, 'logs')

  return {
    name: 'dev-logs-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.startsWith('/__dev/logs')) {
          next()
          return
        }

        if (!fs.existsSync(logsDir)) {
          res.statusCode = 404
          res.end('Missing logs directory')
          return
        }

        const relativePath = decodeURIComponent(url.slice('/__dev/logs'.length) || '/')
        if (relativePath === '/' || relativePath === '') {
          const logFiles = fs
            .readdirSync(logsDir)
            .filter((fileName) => /^log.*\.json$/i.test(fileName))
            .sort((left, right) => right.localeCompare(left))

          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(logFiles))
          return
        }

        const requestedName = relativePath.replace(/^\/+/, '')
        const safeName = path.basename(requestedName)
        if (!/^log.*\.json$/i.test(safeName)) {
          res.statusCode = 400
          res.end('Invalid log file')
          return
        }

        const filePath = path.join(logsDir, safeName)
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404
          res.end('Log file not found')
          return
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), devLogsPlugin()],
})
