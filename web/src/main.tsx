import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled, not loaded from Google: a friend may be on the LAN without the internet (design-spec §7.2).
// Be Vietnam Pro is drawn for Vietnamese (stacked diacritics stay clear); the notes are mostly Vietnamese.
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/400-italic.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/additions.css';
import './styles/notebook.css';
import { applyTheme, theme } from './lib/shell-state';
import { App } from './app';

applyTheme(theme.get());

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
