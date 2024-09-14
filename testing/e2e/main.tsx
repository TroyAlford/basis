import * as React from 'react'
import { hydrateRoot } from 'react-dom/client'
import { Application } from './components/Application'

hydrateRoot(document.getElementById('root'), <Application />)
