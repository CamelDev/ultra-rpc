import { ipcMain } from 'electron'
import * as prettier from 'prettier'

export function registerFormatHandlers() {
  ipcMain.handle('code:format', async (_, { code, language }: { code: string; language: string }) => {
    try {
      let contentToFormat = code
      
      // Map common language names to prettier parsers
      let parser = 'babel'
      if (language === 'json') {
        parser = 'json'
        
        // Handle unquoted UltraRPC {{variables}} in JSON by quoting them first
        // similar to handleFormatJson in App.tsx
        let inString = false
        let intermediate = ''
        for (let i = 0; i < code.length; i++) {
          const char = code[i]
          if (char === '"' && (i === 0 || code[i - 1] !== '\\')) {
            inString = !inString
          }
          if (!inString && code.slice(i, i + 2) === '{{') {
            const end = code.indexOf('}}', i)
            if (end !== -1) {
              const varContent = code.slice(i, end + 2)
              intermediate += `"___ULTRA_UNQUOTED___${varContent}"`
              i = end + 1
              continue
            }
          }
          intermediate += char
        }
        contentToFormat = intermediate
      }
      
      if (language === 'typescript') parser = 'typescript'
      if (language === 'css') parser = 'css'
      if (language === 'markdown') parser = 'markdown'

      let formatted = await prettier.format(contentToFormat, {
        parser,
        semi: false,
        singleQuote: true,
        trailingComma: 'es5',
        printWidth: 100,
        tabWidth: 2,
      })
      
      // Restore the unquoted variables after formatting
      if (language === 'json') {
        formatted = formatted.replace(/"___ULTRA_UNQUOTED___(\{\{.*?\}\})"/g, '$1')
      }
      
      return { success: true, formatted }
    } catch (err: any) {
      console.error('Format error:', err)
      return { success: false, error: err.message }
    }
  })
}
