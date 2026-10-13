import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Skin values, then roles, then styles.css (docs/design/themes/SPEC.md §2-§3).
// AFTER App, so the roles' [data-theme] blocks keep the cascade position
// styles.css's token blocks had (after every component sheet App imports).
import './styles/skins/classic.css';
import './styles/skins/present.css';
import './styles/roles.css';
import './styles.css';
import './styles/stage.css';

const root = createRoot(document.getElementById('root'));
root.render(<App />);

