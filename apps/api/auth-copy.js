const statements = {
  pt: { login: 'Entrar no SeekerTag. Esta assinatura não autoriza transações.', link: 'Vincular esta carteira à minha conta SeekerTag.', reauth: 'Confirmar uma transferência de etiqueta no SeekerTag.' },
  en: { login: 'Sign in to SeekerTag. This signature does not authorize transactions.', link: 'Link this wallet to my SeekerTag account.', reauth: 'Confirm a label transfer in SeekerTag.' },
  es: { login: 'Entrar en SeekerTag. Esta firma no autoriza transacciones.', link: 'Vincular esta cartera a mi cuenta SeekerTag.', reauth: 'Confirmar una transferencia de etiqueta en SeekerTag.' },
};
export function walletStatement(language, mode) {
  const copy = typeof language === 'string' && Object.hasOwn(statements, language) ? statements[language] : statements.pt;
  return copy[mode];
}
