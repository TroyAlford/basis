#!/usr/bin/env bun
import { runBunLint } from './lint'

if (import.meta.main) process.exit(runBunLint(process.argv.includes('--fix')))
