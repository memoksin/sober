import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './theme.css'
import { claimToken } from './wire.js'

const mount = document.getElementById('root')
if (mount === null) throw new Error('index.html has no #root — the build is wrong, not the board')

// Read once, then gone. The fragment is the one part of a URL a browser keeps
// to itself, and leaving it in the address bar would put a live credential in
// whatever gets pasted out of there.
const claim = (): string | null => {
	const token = claimToken(location.hash, sessionStorage)
	if (location.hash !== '') history.replaceState(null, '', location.pathname)
	return token
}

const root = createRoot(mount)
const draw = (): void =>
	root.render(
		<StrictMode>
			<App token={claim()} />
		</StrictMode>,
	)

// A restarted `sober dashboard` mints a new token, and the obvious thing to do
// with the new address is paste it into the tab that is already open. Changing
// only the fragment is a same-document navigation: nothing reloads, and without
// this the page goes on presenting a token that died with the last process.
addEventListener('hashchange', draw)
draw()
