import React from 'react'; import {createRoot} from 'react-dom/client'
import {Excalidraw} from '@excalidraw/excalidraw'; import '@excalidraw/excalidraw/index.css'
createRoot(document.getElementById('root')).render(<Excalidraw initialData={{elements:[],appState:{viewBackgroundColor:'#fff'}}}/>)
