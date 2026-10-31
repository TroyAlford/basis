#!/usr/bin/env bun
import { runMarkdownLint } from './run'

if (import.meta.main) process.exit(await runMarkdownLint(process.argv.slice(2)))
