import { isNativePlatform } from './platform';

export async function initCapacitor(): Promise<void> {
  if (!isNativePlatform()) return;

  const [
    { StatusBar, Style },
    { SplashScreen },
    { App: CapApp },
    { Keyboard },
  ] = await Promise.all([
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
    import('@capacitor/app'),
    import('@capacitor/keyboard'),
  ]);

  await StatusBar.setStyle({ style: Style.Dark });
  await StatusBar.setBackgroundColor({ color: '#0a0a0a' });

  CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      CapApp.exitApp();
    }
  });

  CapApp.addListener('appStateChange', (state) => {
    if (state.isActive) {
      console.log('[Capacitor] App resumed');
    }
  });

  Keyboard.addListener('keyboardWillShow', (info) => {
    document.documentElement.style.setProperty(
      '--keyboard-height',
      `${info.keyboardHeight}px`
    );
  });

  Keyboard.addListener('keyboardWillHide', () => {
    document.documentElement.style.setProperty('--keyboard-height', '0px');
  });

  await SplashScreen.hide();
}
