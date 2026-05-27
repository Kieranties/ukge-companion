// PWA: install prompt + service worker registration.
import { toast } from './state';

export function wirePWA() {
  const btn = document.getElementById('install-btn') as HTMLButtonElement | null;
  let deferred: BeforeInstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    btn?.classList.add('available');
  });
  btn?.addEventListener('click', async () => {
    if (!deferred) {
      toast("Use your browser's 'Add to Home Screen' option");
      return;
    }
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') toast('Installed');
    deferred = null;
    btn.classList.remove('available');
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      }).catch(() => {});
    });
  }
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}
