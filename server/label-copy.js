const copies = {
  pt: { print: 'Imprima em tamanho real. Recorte e prenda ao seu item.', test: 'Teste o QR no aplicativo SeekerTag antes de usar a etiqueta.', found: 'Encontrou este item?', scan: 'Leia no app SeekerTag. Não precisa de conta.' },
  en: { print: 'Print at actual size. Cut out and attach to your item.', test: 'Test the QR in the SeekerTag app before using the label.', found: 'Found this item?', scan: 'Scan in the SeekerTag app. No account needed.' },
  es: { print: 'Imprime a tamaño real. Recorta y coloca en tu objeto.', test: 'Prueba el QR en la app SeekerTag antes de usar la etiqueta.', found: '¿Encontraste este objeto?', scan: 'Escanea en SeekerTag. No necesitas una cuenta.' },
};
export const labelCopy = language => typeof language === 'string' && Object.hasOwn(copies, language) ? copies[language] : copies.pt;
