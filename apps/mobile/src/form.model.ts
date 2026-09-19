import { z } from 'zod';
import { receivingWalletAddress } from '@seekertag/shared/wallet-address';

const nameCharacters = /^[\p{L}\p{N}]+(?:[ '\-][\p{L}\p{N}]+)*$/u;
const normalizedText = (max: number) => z.string()
  .trim()
  .max(max, `Use no máximo ${max} caracteres.`);

// Keep text inputs unmasked while making their stored representation predictable.
// Object/category names intentionally allow Unicode letters, numbers, one space,
// hyphens and apostrophes; punctuation such as commas is not part of an identity.
export const nameSchema = (label: string, max: number) => normalizedText(max)
  .min(1, `${label} é obrigatório.`)
  .regex(nameCharacters, `${label} use apenas letras, números, espaços simples, hífen ou apóstrofo.`);

export const optionalNameSchema = (label: string, max: number) => z.string()
  .trim()
  .max(max, `Use no máximo ${max} caracteres.`)
  .refine(value => !value || nameCharacters.test(value), `${label} use apenas letras, números, espaços simples, hífen ou apóstrofo.`);

export const tagFormSchema = z.object({
  name: nameSchema('O nome do objeto', 80),
  description: normalizedText(500),
  publicMessage: normalizedText(500),
});

export const categoryFormSchema = z.object({ name: nameSchema('O nome da categoria', 32) });
export const finderFormSchema = z.object({
  finderName: optionalNameSchema('Seu nome', 60),
  message: normalizedText(2000).min(1, 'Escreva uma mensagem para o dono.'),
});
export const messageFormSchema = z.object({ body: normalizedText(2000).min(1, 'Escreva uma mensagem.') });
export const receivingWalletFormSchema = z.object({
  address: z.string().trim().refine(value => receivingWalletAddress(value) !== null, 'Informe um endereço de carteira Solana válido.'),
});

export type TagFormValues = z.output<typeof tagFormSchema>;
export type CategoryFormValues = z.output<typeof categoryFormSchema>;
export type FinderFormValues = z.output<typeof finderFormSchema>;
export type MessageFormValues = z.output<typeof messageFormSchema>;
export type ReceivingWalletFormValues = z.output<typeof receivingWalletFormSchema>;
