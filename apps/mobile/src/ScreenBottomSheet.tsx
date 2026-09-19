import React, { PropsWithChildren } from 'react';
import AccountActionSheet from './AccountActionSheet';

// Every contextual task uses the shared portal, including tasks opened by pages.
export default function ScreenBottomSheet({ title, onClose, children, dismissible = true }: PropsWithChildren<{ title: string; onClose: () => void; dismissible?: boolean }>) {
  return <AccountActionSheet title={title} onClose={onClose} busy={!dismissible}>{children}</AccountActionSheet>;
}
