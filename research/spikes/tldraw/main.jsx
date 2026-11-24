import React from 'react'; import {createRoot} from 'react-dom/client'
import {Tldraw} from 'tldraw'; import 'tldraw/tldraw.css'
// No licenseKey: dev works, production shows "Made with tldraw" watermark.
createRoot(document.getElementById('root')).render(<Tldraw persistenceKey="spike"/>)
