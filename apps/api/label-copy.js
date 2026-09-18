const copies = {
  pt: { print: 'Imprima em tamanho real. Recorte na linha pontilhada e prenda ao item.', test: 'Teste o QR no aplicativo SeekerTag antes de usar.', found: 'Encontrou este item?', item: 'ITEM PROTEGIDO', scan: 'Aponte a câmera e avise o dono.', privacy: 'Contato privado · sem cadastro' },
  en: { print: 'Print at actual size. Cut along the dotted line and attach to the item.', test: 'Test the QR in the SeekerTag app before use.', found: 'Found this item?', item: 'PROTECTED ITEM', scan: 'Scan the code and notify the owner.', privacy: 'Private contact · no account needed' },
  es: { print: 'Imprime a tamaño real. Recorta por la línea punteada y fija al objeto.', test: 'Prueba el QR en la app SeekerTag antes de usar.', found: '¿Encontraste este objeto?', item: 'OBJETO PROTEGIDO', scan: 'Escanea el código y avisa al dueño.', privacy: 'Contacto privado · sin registro' },
};
export const labelCopy = language => typeof language === 'string' && Object.hasOwn(copies, language) ? copies[language] : copies.pt;
