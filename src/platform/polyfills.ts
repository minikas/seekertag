import { Buffer } from 'buffer';

// Some Solana dependencies read Buffer at module initialization. This module must
// be the first app-entry import, before importing App or any wallet dependencies.
const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (!scope.Buffer) scope.Buffer = Buffer;
