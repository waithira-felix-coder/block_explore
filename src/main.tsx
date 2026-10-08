import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Route Google Maps JS SDK auth and project configuration errors into the in-app troubleshooting UI
(window as unknown as Record<string, unknown>).gm_authFailure = () => {
  window.dispatchEvent(
    new CustomEvent('gmp-sdk-error', {
      detail:
        'Google Maps JavaScript API authentication failure (gm_authFailure). Verify that GOOGLE_MAPS_PLATFORM_KEY is configured and Maps JavaScript API is enabled.',
    })
  );
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = args.map((a) => String(a)).join(' ');
  if (
    msg.includes('Google Maps JavaScript API error') ||
    msg.includes('ApiProjectMapError') ||
    msg.includes('MissingKeyMapError') ||
    msg.includes('InvalidKeyMapError') ||
    msg.includes('ApiNotActivatedMapError') ||
    msg.includes('RefererNotAllowedMapError') ||
    msg.includes('BillingNotEnabledMapError')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-sdk-error', { detail: msg }));
    return;
  }
  origConsoleError.apply(console, args);
};

createRoot(document.getElementById('root')!).render(<App />);

