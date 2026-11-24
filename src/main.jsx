import React from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App.jsx';
import Transmitter from './components/Transmitter.jsx';
import { parseSessionLink } from './lib/api.js';

// Lien « émetteur » (QR code du téléphone) : page dédiée, sans carte.
const link = parseSessionLink();
const root = link?.mode === 'emetteur' && link.key
  ? <Transmitter sid={link.sid} writeKey={link.key} />
  : <App />;

createRoot(document.getElementById('root')).render(<React.StrictMode>{root}</React.StrictMode>);
