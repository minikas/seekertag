import { AppState } from 'react-native';

// MWA can return its signature before Android has resumed the dapp. Android 15
// blocks networking from cached apps, so submit proofs only after resuming.
export async function waitForWalletReturn(): Promise<void> {
  if (AppState.currentState === 'active') return;
  await new Promise<void>((resolve, reject) => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { clearTimeout(timeout); subscription.remove(); resolve(); }
    });
    const timeout = setTimeout(() => {
      subscription.remove();
      reject(new Error('Volte ao SeekerTag para concluir a confirmação da carteira.'));
    }, 15_000);
    if (AppState.currentState === 'active') { clearTimeout(timeout); subscription.remove(); resolve(); }
  });
}
